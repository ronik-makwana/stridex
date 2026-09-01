import type { RequestHandler } from 'express'
import { prisma } from '../../lib/prisma.js'
import { notFound } from '../../lib/errors.js'
import { validatedParams, validatedQuery } from '../../middleware/validate.js'
import { shopListMeta, type SlugParam } from '../../schemas/shop/common.schema.js'
import type {
  CreateReviewInput,
  ReviewListQuery,
  UpdateReviewInput,
} from '../../schemas/shop/review.schema.js'
import {
  serializeReviewSummary,
  serializeShopReview,
} from '../../serializers/shop/review.serializer.js'
import * as reviews from './reviews.service.js'

/**
 * Reviews hang off a product slug, and the slug must resolve to an ACTIVE
 * product — reviewing an archived product, or reading its reviews, would
 * confirm it exists (§18).
 */
async function activeProductIdBySlug(slug: string): Promise<string> {
  const product = await prisma.product.findFirst({
    where: { slug, status: 'ACTIVE' },
    select: { id: true },
  })
  if (!product) throw notFound('Product')
  return product.id
}

export const list: RequestHandler = async (req, res) => {
  const { slug } = validatedParams<SlugParam>(req)
  const query = validatedQuery<ReviewListQuery>(req)
  const viewerId = req.user?.id

  const productId = await activeProductIdBySlug(slug)
  const [{ rows, total }, counts] = await Promise.all([
    reviews.listReviews(productId, query, viewerId),
    reviews.reviewSummary(productId),
  ])

  // One existence check for the whole page rather than one per review.
  const verified = await reviews.verifiedPurchaserIds(
    productId,
    [...new Set(rows.map((row) => row.userId))],
  )

  res.status(200).json({
    data: rows.map((row) =>
      serializeShopReview(row, {
        verifiedPurchase: verified.has(row.userId),
        currentUserId: viewerId,
      }),
    ),
    meta: {
      ...shopListMeta(total, query.page, query.limit),
      summary: serializeReviewSummary(counts),
      /**
       * Whether this viewer already has a review. Saves the client a second
       * request to decide between "Write a review" and "Edit your review",
       * and is null for a guest rather than false — the two mean different
       * things to the UI.
       */
      myReviewId: viewerId
        ? ((await reviews.findMyReview(productId, viewerId))?.id ?? null)
        : null,
    },
  })
}

export const create: RequestHandler = async (req, res) => {
  const { slug } = validatedParams<SlugParam>(req)
  const body = req.body as CreateReviewInput
  const productId = await activeProductIdBySlug(slug)

  const review = await reviews.createReview(productId, req.user!.id, body)
  const verified = await reviews.verifiedPurchaserIds(productId, [req.user!.id])

  res.status(201).json({
    data: serializeShopReview(review, {
      verifiedPurchase: verified.has(req.user!.id),
      currentUserId: req.user!.id,
    }),
  })
}

export const update: RequestHandler = async (req, res) => {
  const { id } = req.params as { id: string }
  const review = await reviews.updateReview(id, req.user!.id, req.body as UpdateReviewInput)
  const verified = await reviews.verifiedPurchaserIds(review.productId, [req.user!.id])

  res.status(200).json({
    data: serializeShopReview(review, {
      verifiedPurchase: verified.has(req.user!.id),
      currentUserId: req.user!.id,
    }),
  })
}

export const remove: RequestHandler = async (req, res) => {
  const { id } = req.params as { id: string }
  await reviews.deleteReview(id, req.user!.id)
  res.status(204).end()
}

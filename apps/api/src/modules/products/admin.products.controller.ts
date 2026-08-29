import type { RequestHandler } from 'express'
import { validatedParams, validatedQuery } from '../../middleware/validate.js'
import { listMeta, type ReorderInput, type UuidParam } from '../../schemas/admin/common.schema.js'
import {
  serializeAdminProduct,
  serializeAdminProductMedia,
  serializeAdminVariant,
} from '../../serializers/admin/product.serializer.js'
import type {
  BulkProductInput,
  BulkVariantInput,
  CreateMediaInput,
  CreateProductInput,
  CreateVariantInput,
  DuplicateProductInput,
  GenerateVariantsInput,
  MediaParam,
  PresignMediaInput,
  ProductListQuery,
  UpdateMediaInput,
  UpdateProductInput,
  UpdateVariantInput,
  VariantParam,
} from '../../schemas/admin/product.schema.js'
import type { EntityStatus } from '@shoe/db'
import * as productService from './products.service.js'
import * as mediaService from './product-media.service.js'
import * as variantService from './product-variants.service.js'

// ─── products ────────────────────────────────────────────────────────────────

export const list: RequestHandler = async (req, res) => {
  const query = validatedQuery<ProductListQuery>(req)
  const { data, total } = await productService.findMany(query)

  res.status(200).json({
    data: data.map(serializeAdminProduct),
    meta: listMeta(total, query.page, query.limit),
  })
}

export const getOne: RequestHandler = async (req, res) => {
  const product = await productService.findById(validatedParams<UuidParam>(req).id)
  res.status(200).json({ data: serializeAdminProduct(product) })
}

export const create: RequestHandler = async (req, res) => {
  const product = await productService.create(req.body as CreateProductInput)
  res.status(201).json({ data: serializeAdminProduct(product) })
}

export const update: RequestHandler = async (req, res) => {
  const product = await productService.update(
    validatedParams<UuidParam>(req).id,
    req.body as UpdateProductInput,
  )
  res.status(200).json({ data: serializeAdminProduct(product) })
}

export const setStatus: RequestHandler = async (req, res) => {
  const product = await productService.setStatus(
    validatedParams<UuidParam>(req).id,
    (req.body as { status: EntityStatus }).status,
  )
  res.status(200).json({ data: serializeAdminProduct(product) })
}

export const remove: RequestHandler = async (req, res) => {
  await productService.remove(validatedParams<UuidParam>(req).id)
  res.status(204).end()
}

/**
 * Read-only, so the popover on the Publish button can show what is missing
 * before anyone clicks it. `publish` runs the same function again — what the
 * operator was shown and what the server enforces cannot drift.
 */
export const getPublishChecklist: RequestHandler = async (req, res) => {
  const checks = await productService.publishChecklist(validatedParams<UuidParam>(req).id)
  res.status(200).json({ data: { checks, ready: checks.every((check) => check.passed) } })
}

export const publish: RequestHandler = async (req, res) => {
  const product = await productService.publish(validatedParams<UuidParam>(req).id)
  res.status(200).json({ data: serializeAdminProduct(product) })
}

export const archive: RequestHandler = async (req, res) => {
  const product = await productService.setStatus(validatedParams<UuidParam>(req).id, 'ARCHIVED')
  res.status(200).json({ data: serializeAdminProduct(product) })
}

export const duplicate: RequestHandler = async (req, res) => {
  const product = await productService.duplicate(
    validatedParams<UuidParam>(req).id,
    req.body as DuplicateProductInput,
    req.user?.id,
  )
  res.status(201).json({ data: serializeAdminProduct(product) })
}

export const bulk: RequestHandler = async (req, res) => {
  const result = await productService.bulk(req.body as BulkProductInput)
  res.status(200).json({ data: result })
}

// ─── media ───────────────────────────────────────────────────────────────────

export const listMedia: RequestHandler = async (req, res) => {
  const media = await mediaService.findMany(validatedParams<UuidParam>(req).id)
  res.status(200).json({ data: media.map(serializeAdminProductMedia) })
}

/** Signs a URL and records nothing — see the note in product-media.service.ts. */
export const presignMedia: RequestHandler = async (req, res) => {
  const upload = await mediaService.presign(
    validatedParams<UuidParam>(req).id,
    req.body as PresignMediaInput,
  )
  res.status(201).json({ data: upload })
}

export const createMedia: RequestHandler = async (req, res) => {
  const media = await mediaService.record(
    validatedParams<UuidParam>(req).id,
    req.body as CreateMediaInput,
  )
  res.status(201).json({ data: serializeAdminProductMedia(media) })
}

export const updateMedia: RequestHandler = async (req, res) => {
  const { id, mediaId } = validatedParams<MediaParam>(req)
  const media = await mediaService.update(id, mediaId, req.body as UpdateMediaInput)
  res.status(200).json({ data: serializeAdminProductMedia(media) })
}

export const removeMedia: RequestHandler = async (req, res) => {
  const { id, mediaId } = validatedParams<MediaParam>(req)
  await mediaService.remove(id, mediaId)
  res.status(204).end()
}

/**
 * Answers with the reordered gallery rather than 204: a drag settles into
 * whatever the server decided, and returning it saves the client a refetch to
 * find out. Setting a cover is this same call with that image first.
 */
export const reorderMedia: RequestHandler = async (req, res) => {
  const media = await mediaService.reorder(
    validatedParams<UuidParam>(req).id,
    (req.body as ReorderInput).ids,
  )
  res.status(200).json({ data: media.map(serializeAdminProductMedia) })
}

// ─── variants ────────────────────────────────────────────────────────────────

export const listVariants: RequestHandler = async (req, res) => {
  const variants = await variantService.findMany(validatedParams<UuidParam>(req).id)
  res.status(200).json({ data: variants.map(serializeAdminVariant) })
}

export const createVariant: RequestHandler = async (req, res) => {
  const variant = await variantService.create(
    validatedParams<UuidParam>(req).id,
    req.body as CreateVariantInput,
    req.user?.id,
  )
  res.status(201).json({ data: serializeAdminVariant(variant) })
}

export const updateVariant: RequestHandler = async (req, res) => {
  const { id, variantId } = validatedParams<VariantParam>(req)
  const variant = await variantService.update(
    id,
    variantId,
    req.body as UpdateVariantInput,
    req.user?.id,
  )
  res.status(200).json({ data: serializeAdminVariant(variant) })
}

export const removeVariant: RequestHandler = async (req, res) => {
  const { id, variantId } = validatedParams<VariantParam>(req)
  await variantService.remove(id, variantId)
  res.status(204).end()
}

export const bulkVariants: RequestHandler = async (req, res) => {
  const variants = await variantService.bulkUpdate(
    validatedParams<UuidParam>(req).id,
    req.body as BulkVariantInput,
    req.user?.id,
  )
  res.status(200).json({ data: variants.map(serializeAdminVariant) })
}

/**
 * One endpoint for both the dry run and the commit, because they must agree.
 * A separate preview endpoint would drift from what apply actually does the
 * first time either changed.
 */
export const generateVariants: RequestHandler = async (req, res) => {
  const result = await variantService.generate(
    validatedParams<UuidParam>(req).id,
    req.body as GenerateVariantsInput,
    req.user?.id,
  )
  res.status(200).json({ data: result })
}

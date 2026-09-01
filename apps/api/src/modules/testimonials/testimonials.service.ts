import type { EntityStatus, Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { notFound } from '../../lib/errors.js'
import {
  serializeAdminTestimonial,
  type AdminTestimonialPayload,
} from '../../serializers/admin/testimonial.serializer.js'
import type {
  CreateTestimonialInput,
  TestimonialListQuery,
  UpdateTestimonialInput,
} from '../../schemas/admin/testimonial.schema.js'

/**
 * Curated quotes for the front page. Ordinary CRUD, with one thing worth
 * saying: nothing here touches `reviews`, and nothing in `reviews` reaches
 * here. A customer's review is theirs and lives on the product; a testimonial
 * is copy a merchandiser chose to publish.
 */

const SORT_COLUMNS = {
  position: 'position',
  created_at: 'createdAt',
} as const satisfies Record<string, keyof Prisma.TestimonialOrderByWithRelationInput>

export async function findMany(query: TestimonialListQuery) {
  const where: Prisma.TestimonialWhereInput = {}
  if (query.status) where.status = query.status
  if (query.q) {
    where.OR = [
      { quote: { contains: query.q, mode: 'insensitive' } },
      { authorName: { contains: query.q, mode: 'insensitive' } },
    ]
  }

  const [rows, total] = await prisma.$transaction([
    prisma.testimonial.findMany({
      where,
      orderBy: [{ [SORT_COLUMNS[query.sort.field]]: query.sort.direction }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.testimonial.count({ where }),
  ])

  return { data: rows.map(serializeAdminTestimonial), total }
}

async function loadOrThrow(id: string) {
  const testimonial = await prisma.testimonial.findUnique({ where: { id } })
  if (!testimonial) throw notFound('Testimonial')
  return testimonial
}

export async function findById(id: string): Promise<AdminTestimonialPayload> {
  return serializeAdminTestimonial(await loadOrThrow(id))
}

export async function create(input: CreateTestimonialInput): Promise<AdminTestimonialPayload> {
  // Appended: a new quote goes to the end of the order rather than jumping the
  // arrangement somebody already made.
  const last = await prisma.testimonial.findFirst({
    orderBy: { position: 'desc' },
    select: { position: true },
  })

  const created = await prisma.testimonial.create({
    data: {
      quote: input.quote,
      authorName: input.authorName,
      authorRole: input.authorRole ?? null,
      rating: input.rating ?? null,
      imageUrl: input.imageUrl ?? null,
      status: input.status,
      position: (last?.position ?? -1) + 1,
    },
  })
  return serializeAdminTestimonial(created)
}

export async function update(
  id: string,
  input: UpdateTestimonialInput,
): Promise<AdminTestimonialPayload> {
  await loadOrThrow(id)
  const updated = await prisma.testimonial.update({
    where: { id },
    data: {
      ...(input.quote !== undefined ? { quote: input.quote } : {}),
      ...(input.authorName !== undefined ? { authorName: input.authorName } : {}),
      ...(input.authorRole !== undefined ? { authorRole: input.authorRole } : {}),
      ...(input.rating !== undefined ? { rating: input.rating } : {}),
      ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  })
  return serializeAdminTestimonial(updated)
}

export async function setStatus(id: string, status: EntityStatus) {
  await loadOrThrow(id)
  return serializeAdminTestimonial(
    await prisma.testimonial.update({ where: { id }, data: { status } }),
  )
}

export async function remove(id: string): Promise<void> {
  await loadOrThrow(id)
  await prisma.testimonial.delete({ where: { id } })
}

/** Positions rewritten from the array index, in one transaction. */
export async function reorder(ids: string[]): Promise<void> {
  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.testimonial.update({ where: { id }, data: { position: index } }),
    ),
  )
}

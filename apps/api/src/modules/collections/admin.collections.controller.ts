import type { RequestHandler } from 'express'
import { validatedParams, validatedQuery } from '../../middleware/validate.js'
import {
  listMeta,
  type PaginationInput,
  type ReorderInput,
  type UuidParam,
} from '../../schemas/admin/common.schema.js'
import { serializeAdminCollection } from '../../serializers/admin/collection.serializer.js'
import type {
  AddProductsInput,
  CollectionListQuery,
  CollectionProductParam,
  CreateCollectionInput,
  PreviewRulesInput,
  UpdateCollectionInput,
} from '../../schemas/admin/collection.schema.js'
import type { EntityStatus } from '@shoe/db'
import * as collectionsService from './collections.service.js'
import { fieldDefinitions } from './rules.engine.js'

export const list: RequestHandler = async (req, res) => {
  const query = validatedQuery<CollectionListQuery>(req)
  const { data, total } = await collectionsService.findMany(query)

  res.status(200).json({
    data: data.map(serializeAdminCollection),
    meta: listMeta(total, query.page, query.limit),
  })
}

/**
 * The field list the rule builder draws itself from — which operators each
 * field accepts, what control to render, and the values an attribute offers.
 * Served rather than duplicated, or the client starts posting rules the engine
 * rejects the first time an attribute is added.
 */
export const ruleFields: RequestHandler = async (_req, res) => {
  res.status(200).json({ data: await fieldDefinitions() })
}

/** Unsaved rules in, count and sample out. Nothing is persisted. */
export const preview: RequestHandler = async (req, res) => {
  const result = await collectionsService.preview(req.body as PreviewRulesInput)
  res.status(200).json({ data: result })
}

export const getOne: RequestHandler = async (req, res) => {
  const collection = await collectionsService.findById(validatedParams<UuidParam>(req).id)
  res.status(200).json({ data: serializeAdminCollection(collection) })
}

export const create: RequestHandler = async (req, res) => {
  const collection = await collectionsService.create(req.body as CreateCollectionInput)
  res.status(201).json({ data: serializeAdminCollection(collection) })
}

export const update: RequestHandler = async (req, res) => {
  const collection = await collectionsService.update(
    validatedParams<UuidParam>(req).id,
    req.body as UpdateCollectionInput,
  )
  res.status(200).json({ data: serializeAdminCollection(collection) })
}

export const setStatus: RequestHandler = async (req, res) => {
  const collection = await collectionsService.setStatus(
    validatedParams<UuidParam>(req).id,
    (req.body as { status: EntityStatus }).status,
  )
  res.status(200).json({ data: serializeAdminCollection(collection) })
}

export const remove: RequestHandler = async (req, res) => {
  await collectionsService.remove(validatedParams<UuidParam>(req).id)
  res.status(204).end()
}

// ─── membership ──────────────────────────────────────────────────────────────

export const listProducts: RequestHandler = async (req, res) => {
  const { id } = validatedParams<UuidParam>(req)
  const query = validatedQuery<PaginationInput>(req)
  const { data, total } = await collectionsService.findProducts(id, query.page, query.limit)

  res.status(200).json({ data, meta: listMeta(total, query.page, query.limit) })
}

export const addProducts: RequestHandler = async (req, res) => {
  const added = await collectionsService.addProducts(
    validatedParams<UuidParam>(req).id,
    req.body as AddProductsInput,
  )
  // Says how many actually landed: adding six of which two were already in is
  // a success, and reporting six would be a lie the operator can see through.
  res.status(200).json({ data: { added } })
}

export const removeProduct: RequestHandler = async (req, res) => {
  const { id, productId } = validatedParams<CollectionProductParam>(req)
  await collectionsService.removeProduct(id, productId)
  res.status(204).end()
}

export const reorderProducts: RequestHandler = async (req, res) => {
  const { id } = validatedParams<UuidParam>(req)
  await collectionsService.reorderProducts(id, (req.body as ReorderInput).ids)
  res.status(204).end()
}

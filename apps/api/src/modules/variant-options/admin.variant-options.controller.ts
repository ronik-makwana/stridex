import type { RequestHandler } from 'express'
import { validatedParams, validatedQuery } from '../../middleware/validate.js'
import {
  listMeta,
  type ReorderInput,
  type UuidParam,
  type ValueParam,
} from '../../schemas/admin/common.schema.js'
import {
  serializeAdminVariantOption,
  serializeAdminVariantOptionValue,
} from '../../serializers/admin/variant-option.serializer.js'
import type {
  CreateVariantOptionInput,
  CreateVariantOptionValueInput,
  UpdateVariantOptionInput,
  UpdateVariantOptionValueInput,
  VariantOptionListQuery,
} from '../../schemas/admin/variant-option.schema.js'
import * as optionService from './variant-options.service.js'

export const list: RequestHandler = async (req, res) => {
  const query = validatedQuery<VariantOptionListQuery>(req)
  const { data, total } = await optionService.findMany(query)

  res.status(200).json({
    data: data.map(serializeAdminVariantOption),
    meta: listMeta(total, query.page, query.limit),
  })
}

export const getOne: RequestHandler = async (req, res) => {
  const option = await optionService.findById(validatedParams<UuidParam>(req).id)
  res.status(200).json({ data: serializeAdminVariantOption(option) })
}

export const create: RequestHandler = async (req, res) => {
  const option = await optionService.create(req.body as CreateVariantOptionInput)
  res.status(201).json({ data: serializeAdminVariantOption(option) })
}

export const update: RequestHandler = async (req, res) => {
  const option = await optionService.update(
    validatedParams<UuidParam>(req).id,
    req.body as UpdateVariantOptionInput,
  )
  res.status(200).json({ data: serializeAdminVariantOption(option) })
}

export const remove: RequestHandler = async (req, res) => {
  await optionService.remove(validatedParams<UuidParam>(req).id)
  res.status(204).end()
}

// ─── values ──────────────────────────────────────────────────────────────────

export const listValues: RequestHandler = async (req, res) => {
  const values = await optionService.findValues(validatedParams<UuidParam>(req).id)
  res.status(200).json({ data: values.map(serializeAdminVariantOptionValue) })
}

export const createValue: RequestHandler = async (req, res) => {
  const value = await optionService.createValue(
    validatedParams<UuidParam>(req).id,
    req.body as CreateVariantOptionValueInput,
  )
  res.status(201).json({ data: serializeAdminVariantOptionValue(value) })
}

export const updateValue: RequestHandler = async (req, res) => {
  const { id, valueId } = validatedParams<ValueParam>(req)
  const value = await optionService.updateValue(
    id,
    valueId,
    req.body as UpdateVariantOptionValueInput,
  )
  res.status(200).json({ data: serializeAdminVariantOptionValue(value) })
}

export const removeValue: RequestHandler = async (req, res) => {
  const { id, valueId } = validatedParams<ValueParam>(req)
  await optionService.removeValue(id, valueId)
  res.status(204).end()
}

/**
 * Answers with the reordered list rather than 204: a drag settles into whatever
 * the server decided, and returning it saves the client a refetch to find out.
 */
export const reorderValues: RequestHandler = async (req, res) => {
  const { id } = validatedParams<UuidParam>(req)
  await optionService.reorderValues(id, (req.body as ReorderInput).ids)

  const values = await optionService.findValues(id)
  res.status(200).json({ data: values.map(serializeAdminVariantOptionValue) })
}

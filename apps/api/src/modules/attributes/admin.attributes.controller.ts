import type { RequestHandler } from 'express'
import { validatedParams, validatedQuery } from '../../middleware/validate.js'
import {
  listMeta,
  type ReorderInput,
  type UuidParam,
  type ValueParam,
} from '../../schemas/admin/common.schema.js'
import {
  serializeAdminAttribute,
  serializeAdminAttributeValue,
} from '../../serializers/admin/attribute.serializer.js'
import type {
  AttributeListQuery,
  CreateAttributeInput,
  CreateAttributeValueInput,
  UpdateAttributeInput,
  UpdateAttributeValueInput,
} from '../../schemas/admin/attribute.schema.js'
import * as attributeService from './attributes.service.js'

export const list: RequestHandler = async (req, res) => {
  const query = validatedQuery<AttributeListQuery>(req)
  const { data, total } = await attributeService.findMany(query)

  res.status(200).json({
    data: data.map(serializeAdminAttribute),
    meta: listMeta(total, query.page, query.limit),
  })
}

export const getOne: RequestHandler = async (req, res) => {
  const attribute = await attributeService.findById(validatedParams<UuidParam>(req).id)
  res.status(200).json({ data: serializeAdminAttribute(attribute) })
}

export const create: RequestHandler = async (req, res) => {
  const attribute = await attributeService.create(req.body as CreateAttributeInput)
  res.status(201).json({ data: serializeAdminAttribute(attribute) })
}

export const update: RequestHandler = async (req, res) => {
  const attribute = await attributeService.update(
    validatedParams<UuidParam>(req).id,
    req.body as UpdateAttributeInput,
  )
  res.status(200).json({ data: serializeAdminAttribute(attribute) })
}

export const remove: RequestHandler = async (req, res) => {
  await attributeService.remove(validatedParams<UuidParam>(req).id)
  res.status(204).end()
}

// ─── values ──────────────────────────────────────────────────────────────────

export const listValues: RequestHandler = async (req, res) => {
  const values = await attributeService.findValues(validatedParams<UuidParam>(req).id)
  res.status(200).json({ data: values.map(serializeAdminAttributeValue) })
}

export const createValue: RequestHandler = async (req, res) => {
  const value = await attributeService.createValue(
    validatedParams<UuidParam>(req).id,
    req.body as CreateAttributeValueInput,
  )
  res.status(201).json({ data: serializeAdminAttributeValue(value) })
}

export const updateValue: RequestHandler = async (req, res) => {
  const { id, valueId } = validatedParams<ValueParam>(req)
  const value = await attributeService.updateValue(
    id,
    valueId,
    req.body as UpdateAttributeValueInput,
  )
  res.status(200).json({ data: serializeAdminAttributeValue(value) })
}

export const removeValue: RequestHandler = async (req, res) => {
  const { id, valueId } = validatedParams<ValueParam>(req)
  await attributeService.removeValue(id, valueId)
  res.status(204).end()
}

/**
 * Answers with the reordered list rather than 204: a drag settles into whatever
 * the server decided, and returning it saves the client a refetch to find out.
 */
export const reorderValues: RequestHandler = async (req, res) => {
  const { id } = validatedParams<UuidParam>(req)
  await attributeService.reorderValues(id, (req.body as ReorderInput).ids)

  const values = await attributeService.findValues(id)
  res.status(200).json({ data: values.map(serializeAdminAttributeValue) })
}

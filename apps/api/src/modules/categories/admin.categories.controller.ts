import type { RequestHandler } from 'express'
import { validatedParams, validatedQuery } from '../../middleware/validate.js'
import { listMeta, type UuidParam } from '../../schemas/admin/common.schema.js'
import { serializeAdminCategory } from '../../serializers/admin/category.serializer.js'
import type {
  CategoryDeleteQuery,
  CategoryListQuery,
  CategoryReorderInput,
  CategoryStatusInput,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../../schemas/admin/category.schema.js'
import * as categoryService from './categories.service.js'

export const list: RequestHandler = async (req, res) => {
  const query = validatedQuery<CategoryListQuery>(req)
  const { data, total } = await categoryService.findMany(query)

  res.status(200).json({
    data: data.map(serializeAdminCategory),
    meta: listMeta(total, query.page, query.limit),
  })
}

/**
 * Unpaginated, deliberately. A page boundary drawn through a tree hands the
 * client children whose parents are on the next page, and there is no correct
 * way to render that. A category tree is a few dozen rows.
 */
export const tree: RequestHandler = async (_req, res) => {
  const nodes = await categoryService.findTree()
  res.status(200).json({ data: nodes.map(serializeAdminCategory) })
}

export const getOne: RequestHandler = async (req, res) => {
  const category = await categoryService.findById(validatedParams<UuidParam>(req).id)
  res.status(200).json({ data: serializeAdminCategory(category) })
}

export const create: RequestHandler = async (req, res) => {
  const category = await categoryService.create(req.body as CreateCategoryInput)
  res.status(201).json({ data: serializeAdminCategory(category) })
}

export const update: RequestHandler = async (req, res) => {
  const category = await categoryService.update(
    validatedParams<UuidParam>(req).id,
    req.body as UpdateCategoryInput,
  )
  res.status(200).json({ data: serializeAdminCategory(category) })
}

export const setStatus: RequestHandler = async (req, res) => {
  const { status } = req.body as CategoryStatusInput
  const category = await categoryService.setStatus(validatedParams<UuidParam>(req).id, status)
  res.status(200).json({ data: serializeAdminCategory(category) })
}

export const remove: RequestHandler = async (req, res) => {
  const { childAction } = validatedQuery<CategoryDeleteQuery>(req)
  await categoryService.remove(validatedParams<UuidParam>(req).id, childAction)
  res.status(204).end()
}

/**
 * Answers with the settled tree rather than 204: a drag reparents one node and
 * renumbers a sibling row, and returning the result saves the client a refetch
 * to find out what the server actually decided.
 */
export const reorder: RequestHandler = async (req, res) => {
  const nodes = await categoryService.reorder((req.body as CategoryReorderInput).moves)
  res.status(200).json({ data: nodes.map(serializeAdminCategory) })
}

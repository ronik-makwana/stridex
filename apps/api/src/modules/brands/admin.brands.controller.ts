import type { RequestHandler } from 'express'
import { validatedParams, validatedQuery } from '../../middleware/validate.js'
import { listMeta, type UuidParam } from '../../schemas/admin/common.schema.js'
import { serializeAdminBrand } from '../../serializers/admin/brand.serializer.js'
import type {
  BrandListQuery,
  BrandStatusInput,
  CreateBrandInput,
  UpdateBrandInput,
} from '../../schemas/admin/brand.schema.js'
import * as brandService from './brands.service.js'

export const list: RequestHandler = async (req, res) => {
  const query = validatedQuery<BrandListQuery>(req)
  const { data, total } = await brandService.findMany(query)

  res.status(200).json({
    data: data.map(serializeAdminBrand),
    meta: listMeta(total, query.page, query.limit),
  })
}

export const getOne: RequestHandler = async (req, res) => {
  const brand = await brandService.findById(validatedParams<UuidParam>(req).id)
  res.status(200).json({ data: serializeAdminBrand(brand) })
}

export const create: RequestHandler = async (req, res) => {
  const brand = await brandService.create(req.body as CreateBrandInput)
  res.status(201).json({ data: serializeAdminBrand(brand) })
}

export const update: RequestHandler = async (req, res) => {
  const brand = await brandService.update(validatedParams<UuidParam>(req).id, req.body as UpdateBrandInput)
  res.status(200).json({ data: serializeAdminBrand(brand) })
}

export const setStatus: RequestHandler = async (req, res) => {
  const { status } = req.body as BrandStatusInput
  const brand = await brandService.setStatus(validatedParams<UuidParam>(req).id, status)
  res.status(200).json({ data: serializeAdminBrand(brand) })
}

export const remove: RequestHandler = async (req, res) => {
  await brandService.remove(validatedParams<UuidParam>(req).id)
  res.status(204).end()
}

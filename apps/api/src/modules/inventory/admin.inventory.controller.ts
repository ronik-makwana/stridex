import type { RequestHandler } from 'express'
import { z } from 'zod'
import { validatedParams, validatedQuery } from '../../middleware/validate.js'
import { listMeta } from '../../schemas/admin/common.schema.js'
import {
  serializeAdminInventoryRow,
  serializeAdminInventoryTransaction,
} from '../../serializers/admin/inventory.serializer.js'
import {
  ADJUST_REASONS,
  type AdjustStockInput,
  type InventoryListQuery,
  type LowStockQuery,
  type RestockInput,
  type TransactionListQuery,
  type VariantParam,
} from '../../schemas/admin/inventory.schema.js'
import * as inventoryService from './inventory.service.js'

export const list: RequestHandler = async (req, res) => {
  const query = validatedQuery<InventoryListQuery>(req)
  const { data, total } = await inventoryService.findMany(query)

  res.status(200).json({
    data: data.map(serializeAdminInventoryRow),
    meta: listMeta(total, query.page, query.limit),
  })
}

export const lowStock: RequestHandler = async (req, res) => {
  const query = validatedQuery<LowStockQuery>(req)
  const { data, total } = await inventoryService.findLowStock(query)

  res.status(200).json({
    data: data.map(serializeAdminInventoryRow),
    meta: listMeta(total, query.page, query.limit),
  })
}

/**
 * The reason list, served rather than duplicated in the client. It maps onto
 * `inventory_transactions.type`, so a client copy would drift the first time a
 * reason is added and start writing rows nobody can explain.
 */
export const reasons: RequestHandler = (_req, res) => {
  res.status(200).json({
    data: Object.entries(ADJUST_REASONS).map(([value, reason]) => ({
      value,
      label: reason.label,
      type: reason.type,
    })),
  })
}

export const transactions: RequestHandler = async (req, res) => {
  const query = validatedQuery<TransactionListQuery>(req)
  const { data, total } = await inventoryService.findTransactions(query)

  res.status(200).json({
    data: data.map(serializeAdminInventoryTransaction),
    meta: listMeta(total, query.page, query.limit),
  })
}

export const getOne: RequestHandler = async (req, res) => {
  const row = await inventoryService.findByVariantId(validatedParams<VariantParam>(req).variantId)
  res.status(200).json({ data: serializeAdminInventoryRow(row) })
}

export const variantTransactions: RequestHandler = async (req, res) => {
  const { variantId } = validatedParams<VariantParam>(req)
  const query = validatedQuery<TransactionListQuery>(req)
  const { data, total } = await inventoryService.findVariantTransactions(variantId, query)

  res.status(200).json({
    data: data.map(serializeAdminInventoryTransaction),
    meta: listMeta(total, query.page, query.limit),
  })
}

export const adjust: RequestHandler = async (req, res) => {
  const row = await inventoryService.adjust(
    validatedParams<VariantParam>(req).variantId,
    req.body as AdjustStockInput,
    req.user?.id,
  )
  res.status(200).json({ data: serializeAdminInventoryRow(row) })
}

export const restock: RequestHandler = async (req, res) => {
  const row = await inventoryService.restock(
    validatedParams<VariantParam>(req).variantId,
    req.body as RestockInput,
    req.user?.id,
  )
  res.status(200).json({ data: serializeAdminInventoryRow(row) })
}

export const setThreshold: RequestHandler = async (req, res) => {
  const row = await inventoryService.setThreshold(
    validatedParams<VariantParam>(req).variantId,
    (req.body as { lowStockThreshold: number }).lowStockThreshold,
  )
  res.status(200).json({ data: serializeAdminInventoryRow(row) })
}

export const thresholdSchema = z.object({
  lowStockThreshold: z.number().int().min(0).max(100_000),
})

import type { RequestHandler } from 'express'
import { validatedQuery } from '../../middleware/validate.js'
import {
  resolveRange,
  type AdminSearchQuery,
  type DashboardRange,
  type SalesQuery,
} from '../../schemas/admin/dashboard.schema.js'
import * as dashboard from './dashboard.service.js'

/**
 * Six small endpoints rather than one big one, deliberately: the summary and
 * the chart return at different speeds, and the screen renders a skeleton per
 * card instead of one spinner over everything.
 */
export const summary: RequestHandler = async (req, res) => {
  const { from, to } = resolveRange(validatedQuery<DashboardRange>(req))
  res.status(200).json({ data: await dashboard.summary(from, to) })
}

export const sales: RequestHandler = async (req, res) => {
  const query = validatedQuery<SalesQuery>(req)
  const { from, to } = resolveRange(query)
  res.status(200).json({ data: await dashboard.sales(from, to, query.interval) })
}

export const recentOrders: RequestHandler = async (_req, res) => {
  res.status(200).json({ data: await dashboard.recentOrders() })
}

export const inventory: RequestHandler = async (_req, res) => {
  res.status(200).json({ data: await dashboard.lowStock() })
}

export const topProducts: RequestHandler = async (req, res) => {
  const { from, to } = resolveRange(validatedQuery<DashboardRange>(req))
  res.status(200).json({ data: await dashboard.topProducts(from, to) })
}

export const attention: RequestHandler = async (_req, res) => {
  res.status(200).json({ data: await dashboard.attention() })
}

/** ⌘K. A jump-to, not a search page — five of each and no pagination. */
export const search: RequestHandler = async (req, res) => {
  const { q } = validatedQuery<AdminSearchQuery>(req)
  res.status(200).json({ data: await dashboard.search(q) })
}

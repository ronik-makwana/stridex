import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import {
  adminSearchSchema,
  dashboardRangeSchema,
  salesQuerySchema,
} from '../../schemas/admin/dashboard.schema.js'
import * as controller from './admin.dashboard.controller.js'

/** Mounted behind `authenticate` + `requireAdminSession`. Read-only, all of it. */
export const adminDashboardRouter: Router = Router()

adminDashboardRouter.get('/summary', validate({ query: dashboardRangeSchema }), controller.summary)
adminDashboardRouter.get('/sales', validate({ query: salesQuerySchema }), controller.sales)
adminDashboardRouter.get('/orders', controller.recentOrders)
adminDashboardRouter.get('/inventory', controller.inventory)
adminDashboardRouter.get('/top-products', validate({ query: dashboardRangeSchema }), controller.topProducts)
adminDashboardRouter.get('/attention', controller.attention)

/** Mounted at the admin root rather than under /dashboard: it is not a card. */
export const adminSearchRouter: Router = Router()
adminSearchRouter.get('/', validate({ query: adminSearchSchema }), controller.search)

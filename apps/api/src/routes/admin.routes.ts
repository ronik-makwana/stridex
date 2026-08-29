import { Router } from 'express'
import { adminAuthRouter } from '../modules/auth/admin.auth.routes.js'

export const adminRouter: Router = Router()

// Public: login, refresh, logout, forgot/reset password.
adminRouter.use('/auth', adminAuthRouter)

// Everything mounted below this line must sit behind `authenticate` +
// `requireAdminSession` in its own router. Phases 1+ add brands, categories,
// attributes, variant options, products, inventory, collections, orders.

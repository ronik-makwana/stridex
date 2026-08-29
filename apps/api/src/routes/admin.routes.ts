import { Router } from 'express'
import { authenticate } from '../middleware/auth.js'
import { requireAdminSession } from '../middleware/requireRole.js'
import { adminAuthRouter } from '../modules/auth/admin.auth.routes.js'
import { adminAttributesRouter } from '../modules/attributes/admin.attributes.routes.js'
import { adminBrandsRouter } from '../modules/brands/admin.brands.routes.js'
import { adminCategoriesRouter } from '../modules/categories/admin.categories.routes.js'
import { adminVariantOptionsRouter } from '../modules/variant-options/admin.variant-options.routes.js'
import { adminUploadsRouter } from '../modules/uploads/admin.uploads.routes.js'

export const adminRouter: Router = Router()

// Public: login, refresh, logout, forgot/reset password.
adminRouter.use('/auth', adminAuthRouter)

// Everything below this line is a signed-in admin or staff member. The guard is
// applied once here rather than repeated in each feature router, so a new
// module cannot ship unauthenticated by omission.
adminRouter.use(authenticate, requireAdminSession)

adminRouter.use('/brands', adminBrandsRouter)
adminRouter.use('/categories', adminCategoriesRouter)
adminRouter.use('/attributes', adminAttributesRouter)
adminRouter.use('/variant-options', adminVariantOptionsRouter)
adminRouter.use('/uploads', adminUploadsRouter)
// Phases 4+: products, inventory, collections, orders.

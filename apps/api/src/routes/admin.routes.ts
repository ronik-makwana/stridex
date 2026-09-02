import { Router } from 'express'
import { authenticate } from '../middleware/auth.js'
import { requireAdminSession } from '../middleware/requireRole.js'
import { invalidateOnWrite } from '../middleware/cacheInvalidation.js'
import { adminAuthRouter } from '../modules/auth/admin.auth.routes.js'
import { adminAttributesRouter } from '../modules/attributes/admin.attributes.routes.js'
import { adminBrandsRouter } from '../modules/brands/admin.brands.routes.js'
import { adminCategoriesRouter } from '../modules/categories/admin.categories.routes.js'
import { adminCollectionsRouter } from '../modules/collections/admin.collections.routes.js'
import { adminInventoryRouter } from '../modules/inventory/admin.inventory.routes.js'
import { adminCustomersRouter } from '../modules/customers/admin.customers.routes.js'
import {
  adminDashboardRouter,
  adminSearchRouter,
} from '../modules/dashboard/admin.dashboard.routes.js'
import { adminOrdersRouter } from '../modules/orders/admin.orders.routes.js'
import { adminPaymentsRouter } from '../modules/payments/admin.payments.routes.js'
import { adminReturnsRouter } from '../modules/refunds/admin.refunds.routes.js'
import { adminProductsRouter } from '../modules/products/admin.products.routes.js'
import { adminReviewsRouter } from '../modules/reviews/admin.reviews.routes.js'
import { adminTestimonialsRouter } from '../modules/testimonials/admin.testimonials.routes.js'
import { adminDiscountsRouter } from '../modules/discounts/admin.discounts.routes.js'
import { adminTagsRouter } from '../modules/tags/admin.tags.routes.js'
import { adminVariantOptionsRouter } from '../modules/variant-options/admin.variant-options.routes.js'
import { adminUploadsRouter } from '../modules/uploads/admin.uploads.routes.js'

export const adminRouter: Router = Router()

// Public: login, refresh, logout, forgot/reset password.
adminRouter.use('/auth', adminAuthRouter)

// Everything below this line is a signed-in admin or staff member. The guard is
// applied once here rather than repeated in each feature router, so a new
// module cannot ship unauthenticated by omission.
adminRouter.use(authenticate, requireAdminSession)

/**
 * After the auth wall, before the feature routers: every catalogue write below
 * drops the customer-facing caches it could have invalidated.
 */
adminRouter.use(invalidateOnWrite)

adminRouter.use('/brands', adminBrandsRouter)
adminRouter.use('/categories', adminCategoriesRouter)
adminRouter.use('/attributes', adminAttributesRouter)
adminRouter.use('/variant-options', adminVariantOptionsRouter)
adminRouter.use('/products', adminProductsRouter)
adminRouter.use('/tags', adminTagsRouter)
adminRouter.use('/inventory', adminInventoryRouter)
adminRouter.use('/collections', adminCollectionsRouter)
adminRouter.use('/uploads', adminUploadsRouter)

// Read-heavy by design: orders are created by the payment webhook, and the only
// thing an operator changes here is where the parcel is.
adminRouter.use('/orders', adminOrdersRouter)
adminRouter.use('/payments', adminPaymentsRouter)

// The returns queue: what customers asked to send back, and the one screen
// where receiving a parcel moves stock and sends money in the same click.
adminRouter.use('/returns', adminReturnsRouter)

// Support: read-heavy, with two writes that can act on an account but never as
// one — no password editing, no impersonation.
adminRouter.use('/customers', adminCustomersRouter)

// Moderation: hide, unhide, and delete for abuse. Never edit — the words are
// the customer's.
adminRouter.use('/reviews', adminReviewsRouter)

// Front-page copy, and deliberately not the same thing as a review: a quote
// somebody chose to publish, rather than a customer's opinion of a product.
adminRouter.use('/testimonials', adminTestimonialsRouter)
adminRouter.use('/discounts', adminDiscountsRouter)

// The first screen anybody opens, and the palette that skips it.
adminRouter.use('/dashboard', adminDashboardRouter)
adminRouter.use('/search', adminSearchRouter)

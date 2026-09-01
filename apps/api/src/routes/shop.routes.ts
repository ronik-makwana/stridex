import { Router } from 'express'
import { shopAuthRouter } from '../modules/auth/shop.auth.routes.js'
import { shopProductsRouter } from '../modules/products/shop.products.routes.js'
import { shopReviewsRouter } from '../modules/reviews/shop.reviews.routes.js'

/**
 * Everything under `/api/storefront/*`.
 *
 * Unlike `adminRouter`, this tree has no blanket `authenticate` after the auth
 * block: most of the storefront is public by design, and the cart and wishlist
 * stay public through Phase 14 — the auth wall sits on checkout, orders and
 * account, and is applied per feature router rather than here.
 *
 * The consequence is that a new module ships public unless it says otherwise,
 * which is the opposite of the admin tree's default. Every router mounted below
 * that touches a customer's own records must carry
 * `authenticate, requireCustomerSession` itself.
 */
export const shopRouter: Router = Router()

shopRouter.use('/auth', shopAuthRouter)

// Public. A product page behind a session is a product page Google cannot read.
shopRouter.use('/products', shopProductsRouter)

// Editing and deleting your own review, by id. Reading and writing a product's
// reviews lives under `/products/:slug/reviews`.
shopRouter.use('/reviews', shopReviewsRouter)

// Phase 13: /categories/tree, /products (list), /products/facets,
//           /collections, /search    Phase 14: /cart, /wishlist
// Phase 15: /addresses, /checkout, /payments
// Phase 16: /orders, /account        Phase 17: /reviews

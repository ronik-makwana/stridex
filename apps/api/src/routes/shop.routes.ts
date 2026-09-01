import { Router } from 'express'
import { shopAuthRouter } from '../modules/auth/shop.auth.routes.js'
import { shopCategoriesRouter } from '../modules/categories/shop.categories.routes.js'
import { shopCollectionsRouter } from '../modules/collections/shop.collections.routes.js'
import { shopAddressesRouter } from '../modules/addresses/shop.addresses.routes.js'
import { shopCartRouter } from '../modules/cart/shop.cart.routes.js'
import { shopHomeRouter } from '../modules/home/shop.home.routes.js'
import { shopCheckoutRouter } from '../modules/checkout/shop.checkout.routes.js'
import { shopAccountRouter } from '../modules/account/shop.account.routes.js'
import { shopOrdersRouter } from '../modules/orders/shop.orders.routes.js'
import { shopPaymentsRouter } from '../modules/payments/shop.payments.routes.js'
import { shopProductsRouter } from '../modules/products/shop.products.routes.js'
import { shopWishlistRouter } from '../modules/wishlist/shop.wishlist.routes.js'
import { shopSearchRouter } from '../modules/search/shop.search.routes.js'
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

// The front page, assembled from queries that already existed.
shopRouter.use('/home', shopHomeRouter)

// Public. A product page behind a session is a product page Google cannot read.
shopRouter.use('/categories', shopCategoriesRouter)
shopRouter.use('/products', shopProductsRouter)
shopRouter.use('/collections', shopCollectionsRouter)
shopRouter.use('/search', shopSearchRouter)

// Editing and deleting your own review, by id. Reading and writing a product's
// reviews lives under `/products/:slug/reviews`.
shopRouter.use('/reviews', shopReviewsRouter)

// Half public, half not, and the routers say which is which: hydrate prices a
// guest's localStorage bag with no account, everything that writes a row is
// behind the customer session. Neither reserves stock (§4).
shopRouter.use('/cart', shopCartRouter)
shopRouter.use('/wishlist', shopWishlistRouter)

// Wholly behind the auth wall, unlike the cart above: an address belongs to
// somebody by definition.
shopRouter.use('/addresses', shopAddressesRouter)

// Where the guest half ends: holding stock needs an account to hold it for.
shopRouter.use('/checkout', shopCheckoutRouter)

// Starting a payment is a customer action; confirming one is not. The webhook
// that does the confirming is mounted outside this router entirely.
shopRouter.use('/payments', shopPaymentsRouter)
// Your own orders, written by the webhook and read here.
shopRouter.use('/orders', shopOrdersRouter)

// Editing yourself: the profile and the password. Reading yourself is /auth/me.
shopRouter.use('/account', shopAccountRouter)

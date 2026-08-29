# Shoe E-Commerce — Implementation Order

Vertical slices. Each phase ships API and UI together, because payload shapes built without a consumer are always wrong.

Admin is built first and completely. The storefront comes after, on a populated catalog.

```
PART A  Phases 0–9    Admin + its API
PART B  Phase 10      Real data
PART C  Phases 11–18  Storefront + its API
```

---

# PART A — ADMIN

## Phase 0 — Foundation

No features. Feels slow, produces nothing visible, and every later phase depends on it.

**Database**
- `packages/db`: full `schema.prisma`, first migration
- Raw SQL migrations: `pgcrypto`, `pg_trgm`, `unaccent`, GIN trigram indexes on `products.title` and `product_variants.sku`, partial unique index for one default address per user
- `prisma.config.ts`, seed script, one admin user

**API**
- Express 5 shell, ESM, `tsx` dev, `tsup` build
- `validate()` middleware (Zod on body, query, params)
- Error handler: `P2002`→409, `P2003`→422, `P2025`→404, `ZodError`→400
- pino, helmet, cors, rate limit, cookie-parser
- Prisma client with `PrismaPg` adapter and explicit pool settings

**Auth module**
```
POST /api/admin/auth/login          rejects non ADMIN | STAFF
POST /api/admin/auth/refresh
POST /api/admin/auth/logout
GET  /api/admin/auth/me
```
argon2id, 15-minute access token, rotating refresh hashed into `user_sessions`, `requireRole` middleware.

**Admin app**
- Vite, Tailwind v4, shadcn init, React Router 7
- `api-client.ts` with the refresh interceptor. Get this right once and every later feature is easy
- `RequireRole` guard, login page, empty dashboard, `AdminLayout` with sidebar

**Done when:** you log in, land on a blank dashboard, survive a page refresh, and stay logged in after the access token expires.

---

## Phase 1 — Brands

Simplest full CRUD. You are really building the shared components; brands are the excuse.

**API** — 6 endpoints: list, get, create, update, delete (422 when products exist), status toggle.

**UI** — list table + drawer. Ships `DataTable`, `FilterBar`, `EntityDrawer`, `ConfirmDialog`, `SlugField`, `StatusBadge`, `EmptyState`, toasts.

**Done when:** create, edit, toggle status, and a blocked delete that explains itself and offers "Set to draft".

---

## Phase 2 — Attributes and variant options

Two near-identical modules. Reuse phase 1, add nested values with inline add and drag reorder.

**API**
```
CRUD /api/admin/attributes           + /:id/values, /values/reorder
CRUD /api/admin/variant-options      + /:id/values, /values/reorder
```
Type is immutable once values exist. Delete blocked when products or variants reference it.

**UI** — list with product counts, detail page with the values panel. Values panel hides for TEXT, NUMBER, BOOLEAN. Swatch picker on variant option values.

**Done when:** Colour exists with Black, White, Red and hex swatches, and Material with four values.

---

## Phase 3 — Categories

**API**
```
GET   /api/admin/categories/tree      nested, with product counts
CRUD  /api/admin/categories
PATCH /api/admin/categories/reorder   [{ id, parentId, position }]
```
Server recomputes `level` and `position` for the whole moved subtree.

**UI** — tree with dnd-kit, drawer for create and edit. Optimistic move with rollback toast. Guard against dropping a parent into its own descendant.

**Done when:** Shoes → Men → Running exists and dragging Running under Women recomputes levels correctly.

---

## Phase 4 — Products, part one

**API**
```
GET   /api/admin/products             ?q=&status=&brandId=&categoryId=&stock=
GET   /api/admin/products/:id         media, attributes, options, variants, inventory
POST  /api/admin/products
PATCH /api/admin/products/:id         full attribute + option lists, server diffs
POST  /api/admin/products/:id/media/presign
POST  /api/admin/products/:id/media
PATCH /api/admin/products/:id/media/reorder
```

**UI**
- Product list with filters and saved views. Stock red at zero even when active
- Editor: basic info, brand, category, status, description
- `MediaUploader`: presign, direct browser PUT to S3/MinIO, record, reorder, cover
- Attributes block: add/remove picker over all attributes, "create new" inline, suggested pre-fill

**Done when:** you create a draft product with four images and five attributes, and Node never touches an image byte.

---

## Phase 5 — Products, part two

The hardest screen in the build.

**API**
```
GET    /api/admin/products/:id/variants
POST   /api/admin/products/:id/variants/generate    dryRun supported
PATCH  /api/admin/products/:id/variants/bulk
POST   /api/admin/products/:id/publish              checklist, 422 with failures
POST   /api/admin/products/:id/duplicate
POST   /api/admin/products/:id/archive
POST   /api/admin/products/bulk
```

Generate takes option and value ids explicitly, since nothing is derivable from the category. It is additive: existing combinations keep SKU, price and stock.

**UI**
- Variant options picker writing `product_variant_options` with drag order (Option 1, Option 2)
- Generate with dry run, showing "Adds 3 · keeps 6 · removes 0" before committing
- Variant grid: tab across, enter down, apply-to-all fills a column, auto-generate SKUs
- Publish checklist in a popover on the button
- Duplicate dialog, archive-instead-of-delete dialog, bulk action bar

**Done when:** Black/White × 8/9/10 generates six variants, and adding Red regenerates to nine without touching the original six.

---

## Phase 6 — Inventory

Backend first here. The transaction logic matters more than the screen.

**API**
```
GET  /api/admin/inventory                        ?stock=in|low|out
POST /api/admin/inventory/:variantId/adjust      { mode: set|change, value, reason, note }
POST /api/admin/inventory/:variantId/restock
GET  /api/admin/inventory/:variantId/transactions
GET  /api/admin/inventory/transactions
GET  /api/admin/inventory/low-stock
```

Every write: `$transaction` + `SELECT ... FOR UPDATE` on the inventory row + a matching `inventory_transactions` insert. No exceptions, or the ledger stops being trustworthy.

**UI** — list showing on hand, reserved and available as three columns. Adjust modal with a live "new on hand" line and a required reason. Append-only ledger with no kebab column.

**Done when:** an adjustment writes both rows atomically and appears in the ledger with its reason and author.

---

## Phase 7 — Collections

**API**
```
CRUD   /api/admin/collections
POST   /api/admin/collections/:id/products
PATCH  /api/admin/collections/:id/products/reorder
CRUD   /api/admin/collections/:id/rules
POST   /api/admin/collections/preview            unsaved rules, returns count + sample
```

`rules.engine.ts` translates rules into a Prisma `where`. Fields: category, brand, price, title, sku, stock, created_at, `attribute:{id}`.

**UI** — manual first, reusing the product picker. Then the rule builder, where the real work is the value control changing shape per field: tree select, dropdown, number, value picker, date picker. Debounced preview, helpful zero-match state.

**Done when:** "Brand is Nike AND Price > 10000" previews the correct count before saving.

---

## Phase 8 — Orders and payments

Read-heavy, so it moves fast. Extend the seed script with orders rather than waiting for a checkout that does not exist yet.

**API**
```
GET   /api/admin/orders                ?status=&paymentStatus=&from=&to=
GET   /api/admin/orders/:id
PATCH /api/admin/orders/:id/status
GET   /api/admin/orders/:id/history
GET   /api/admin/payments
GET   /api/admin/payments/:id/transactions
POST  /api/webhooks/payments/:provider   signature verified, idempotent
```

Webhook idempotency rests on `unique(provider, provider_payment_id)`. Providers retry.

**UI** — order list with two status columns. Order detail rendering snapshot values from `order_items`, not the live product. Status modal with a backwards-transition warning. Payment detail with the transaction ledger and collapsed raw metadata.

**Done when:** a seeded order renders fully and a status change writes history.

---

## Phase 9 — Customers, dashboard, settings

**API**
```
GET   /api/admin/customers                ?q=&status=
GET   /api/admin/customers/:id            + /orders, /addresses
PATCH /api/admin/customers/:id/status
POST  /api/admin/customers/:id/sessions/revoke

GET   /api/admin/dashboard/summary | /sales | /orders | /inventory
                       | /top-products | /attention
GET   /api/admin/search                   ⌘K across products, orders, customers
GET   /api/admin/slug-check
```

**UI** — customer list and detail with tabs. Dashboard cards, sales chart, recent orders, low stock, and the "needs attention" strip where each line links to a pre-filtered list. Settings pages. ⌘K palette.

**Admin is complete.**

---

# PART B

## Phase 10 — Real data

Not optional. The storefront needs something to render, and every list bug you will hit is a volume bug.

- 20+ real products with proper titles, descriptions, images, attributes
- Full variant coverage, realistic stock including some zeroes
- 3 brands, a 3-level category tree, 4 collections (2 manual, 2 dynamic)
- 30 seeded orders across every status
- 50 customers

Do this through the admin UI for at least five products. You will find bugs.

---

# PART C — STOREFRONT

## Phase 11 — Foundation, serializers, customer auth

**The serializers are this phase's real deliverable.** `serializers/shop/` returns `ACTIVE` records only and never exposes cost, draft status, `reserved_quantity` or raw stock counts. Stock goes out as a bucket, never a number.

**API**
```
POST /api/storefront/auth/register        role CUSTOMER
POST /api/storefront/auth/login           rejects ADMIN | STAFF
POST /api/storefront/auth/refresh | logout
GET  /api/storefront/auth/me
POST /api/storefront/auth/verify-email | forgot-password | reset-password
```

**UI** — Vite, Tailwind, shadcn, router, `ShopLayout` with header, nav, footer. `api-client.ts` with refresh interceptor (second time, faster). Login, register, forgot password. `RequireAuth` redirecting to `/login?redirect=`.

**Done when:** register, verify, log in, survive a refresh, and an admin account is rejected at the customer login.

---

## Phase 12 — Product detail

Start here, not the home page. It exercises the whole catalog model.

**API**
```
GET /api/storefront/products/:slug
```
Media, attributes, option list in position order, variants with option assignments, availability per variant.

**UI**
- Image gallery with thumbnails
- Option pickers driven by `product_variant_options` order, colour swatches from `swatch_hex`
- Variant resolution: Black + 9 finds the variant, impossible combinations disabled, sold-out ones marked
- Price with compare-at strikethrough
- Attributes as a spec table
- Add to cart

**Done when:** every variant is reachable, impossible combinations are disabled, and sold-out says so rather than failing later at checkout.

---

## Phase 13 — Category, filters, search

**API**
```
GET /api/storefront/categories/tree
GET /api/storefront/products         ?category=&brand=&attr:{id}=&minPrice=&maxPrice=&sort=&page=
GET /api/storefront/products/facets  counts per filter value for the current query
GET /api/storefront/search           ?q=
```

Facets is the hard part. It reads `product_attributes` filtered by `is_filterable`, which is exactly why that composite index exists.

**UI** — category page with product grid, filter sidebar built from facets with counts and multi-select, URL-synced via nuqs, sort options, pagination or infinite scroll. Search reuses the grid.

**Done when:** Material = Mesh plus Brand = Nike updates the URL, the grid, and the remaining facet counts together.

---

## Phase 14 — Cart and wishlist, no login required

Customers add to cart and wishlist without an account. The auth wall sits on checkout only.

**API**
```
POST   /api/storefront/cart/hydrate      PUBLIC, ids in, display data out
POST   /api/storefront/wishlist/hydrate  PUBLIC
GET    /api/storefront/cart              authed
POST   /api/storefront/cart/items        authed
PATCH  /api/storefront/cart/items/:id
DELETE /api/storefront/cart/items/:id
POST   /api/storefront/cart/merge
CRUD   /api/storefront/wishlist          + /merge
```

Hydrate is public and rate limited. It re-reads live prices and status, so a three-week-old localStorage cart shows today's price and drops anything archived, returning why.

**UI**
- `local-cart.ts` and `local-wishlist.ts`: ids and quantities only, never prices
- `useCart()` and `useWishlist()` hiding the local-vs-server split behind one interface, so no component ever branches on `if (user)`
- Cart drawer, cart page, wishlist page, all public
- `afterAuth()` merging both on login **and** register, clearing local only after the response succeeds
- `storage` event listener so a second tab updates its badge

**Done when:** you fill a cart logged out, register, and it merges with nothing lost or duplicated.

---

## Phase 15 — Checkout

Riskiest phase. Money and stock.

**API**
```
CRUD /api/storefront/addresses
POST /api/storefront/checkout/validate    re-price, re-check stock
POST /api/storefront/checkout             creates order, reserves stock
```

Order creation, one transaction:
1. `SELECT ... FOR UPDATE` on every line's inventory row
2. Fail the whole order if any line is short
3. Snapshot title, SKU, price and options into `order_items`
4. Write `RESERVATION` ledger rows
5. Order as `PENDING` / `PENDING`, payment record, hand off to provider

The webhook flips `payment_status` to `PAID`, converts reservations to `SALE`, clears the cart. A timeout job releases reservations on abandoned orders.

**Never trust client prices.** Re-read every price from the database at order time.

**UI** — checkout guarded by `RequireAuth`, so anyone arriving unauthenticated lands on `/login?redirect=/checkout` with the message "Sign in to complete your order". Address step with saved addresses, order summary with live totals, Razorpay, success and failure pages.

Validate the redirect param starts with `/` or you have built an open redirect.

**Done when:** two browsers racing for the last unit produce exactly one order and one clear failure.

---

## Phase 16 — Account

**API**
```
GET   /api/storefront/orders
GET   /api/storefront/orders/:orderNumber
PATCH /api/storefront/account
POST  /api/storefront/account/password
```

**UI** — order history, order detail with timeline, address book with default handling, profile, password change.

**Done when:** a customer sees exactly what admin sees on their order, minus the internals.

---

## Phase 17 — Home and collections

Left late on purpose. It is merchandising, and it needs the components earlier phases built.

**API**
```
GET /api/storefront/collections/:slug
GET /api/storefront/home                 featured collections, new arrivals
```
Dynamic collections run the rules engine and cache in Redis, invalidated on product publish.

**UI** — hero, featured collections, new arrivals carousel, category tiles.

---

## Phase 18 — SEO and polish

- `react-helmet-async`: per-page title, description, canonical, Open Graph
- Product JSON-LD for rich results
- `vite-plugin-sitemap`
- Image lazy loading, blur placeholders, responsive sizes
- Skeletons on every async region, 404, error boundaries
- Mobile pass. Most of your traffic is phones

Then decide on prerendering. If organic traffic matters, Vike prerender for product and category pages. If the store is B2B or wholesale, skip it.

---

# Rules that hold across every phase

**Build API and UI together, never all endpoints first.** A payload shape designed without a consumer is wrong. `/api/storefront/products` written during the admin phases will over-return.

**Seed data grows with each phase.** 50 products after phase 5, 30 orders after phase 8. Three rows hide every pagination and N+1 bug you have.

**Storefront serializers are never shared with admin.** A shared response shape is how draft variants and inventory internals reach a public page.

**Every stock write is a transaction with a ledger row.** Adjust, restock, reserve, sell, release, return. No exceptions.

**Never send a raw stock number to a customer.** "In stock", "Only a few left", "Sold out". Exact quantities invite scraping and expose your velocity.

**Prices are re-read from the database at order time**, whatever the cart said. The cart is a wish, the order is a commitment.

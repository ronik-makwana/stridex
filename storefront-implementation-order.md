# Storefront — Implementation Order

Supersedes PART C of `implementation-order.md`. Reconciled with
`shoe-storefront-final-spec.md` (the authority — where this doc and the spec
disagree, the spec wins) and `ecommerce_frontend_backend_rules.md` (cited as
§n). Reflects the agreed build-order deviation: storefront before admin
phases 8–9.

Phase 10 is done: 27 brands, 210 ACTIVE products, 3,852 variants, 634 images.

Folder structure is fixed by `repo-structure.md` and is not up for
renegotiation per phase:

- API — services shared, **controllers / schemas / serializers split by audience**.
  `serializers/shop/` is never `serializers/admin/`.
- `apps/storefront` — self-contained Vite SPA, own shadcn install, own tokens.
  **No import ever crosses from `apps/admin`.** Copy the file instead.

---

## Phase 11 — Foundation, shop API surface, customer auth

The serializers are the deliverable, not the login form.

**API**
```
src/routes/shop.routes.ts                    mounts /api/storefront/*
src/serializers/shop/                        ACTIVE only, no cost, no draft,
                                             no reserved_quantity, no raw stock
src/schemas/shop/
src/modules/auth/shop.auth.controller.ts     reuses auth.service.ts + auth.tokens.ts
src/modules/auth/shop.auth.routes.ts

POST /api/storefront/auth/register           forces role CUSTOMER
POST /api/storefront/auth/login              rejects ADMIN | STAFF
POST /api/storefront/auth/refresh | logout
GET  /api/storefront/auth/me
POST /api/storefront/auth/verify-email
POST /api/storefront/auth/forgot-password    same response whether or not the
                                             email exists
POST /api/storefront/auth/reset-password
```

Stock leaves the API as a bucket — `IN_STOCK` / `LOW_STOCK` / `SOLD_OUT` —
never an integer. One shared `stockBucket()` in `serializers/shop/`.

Settle the response conventions here, once, because every later phase inherits
them: lists return `{ data, meta: { page, limit, total, totalPages } }`, errors
return `{ error: { code, message, fields? } }`, and the codes the UI branches on
are `OUT_OF_STOCK`, `PRICE_CHANGED`, `PRODUCT_UNAVAILABLE`, `CHECKOUT_EXPIRED`,
`CHECKOUT_ALREADY_COMPLETED`, `QUANTITY_EXCEEDED`, `COUPON_INVALID`.

**UI** — scaffold `apps/storefront` exactly per `repo-structure.md`. Vite,
Tailwind v4, fresh shadcn, editorial-minimal tokens (white ground, near-black
text, one accent held back for sale prices and CTAs). `ShopLayout`,
`AuthLayout`, `api-client.ts` with the refresh interceptor, `RequireAuth`
redirecting to `/login?redirect=`.

Validate that `redirect` starts with `/` and not `//`, or you have shipped an
open redirect.

**Rules:** §22 authentication and authorization.

**Done when:** register → verify → log in → survive a hard refresh, and an
admin account is rejected at the customer login.

---

## Phase 12 — Product detail

Start here, not the home page. It exercises the whole catalog model — media,
attributes, options, variants and inventory on one screen.

**API**
```
GET /api/storefront/products/:slug     media, attributes, options in position
                                       order, variants with option assignments
                                       + availability bucket
GET /api/storefront/products/:slug/related
```

A non-`ACTIVE` product is a 404, not a 403 — an archived product must not
confirm it exists (§18). `related` resolves same category → same brand →
newest, excluding this product and anything sold out.

**UI** — gallery + buy box → spec table → "You may also like" → reviews slot
(the slot renders empty until Phase 17). Option pickers driven by
`product_variant_options` order, swatches from `swatch_hex`, picking a colour
swaps the gallery via `variant.media_id`. Sold-out sizes struck through, never
hidden. Impossible combinations disabled. Compare-at strikethrough. Discount
badges as quiet pills, not loud red blocks.

**Done when:** every variant is reachable, impossible combinations are
disabled, and sold out says so on the page rather than failing at checkout.

---

## Phase 13 — Category, collections, filters, search

**A collection is a category page with a different filter, so it is built here,
not later.** Same grid, same sidebar, same sort, same pagination — the only new
parts are a banner and an index page. Splitting them across phases is how the
two end up with separate product queries that drift.

**API**
```
GET /api/storefront/categories/tree
GET /api/storefront/products         ?category=&collection=&brand=&attr:{id}=
                                     &minPrice=&maxPrice=&sort=&page=
GET /api/storefront/products/facets  counts per filter value for the current query
GET /api/storefront/collections      index, ACTIVE only
GET /api/storefront/collections/:slug  meta only — name, description, image,
                                       type, count
GET /api/storefront/search           ?q=
GET /api/storefront/search/suggest   ?q= — header overlay, 5 products + 3 categories
```

Facets read `product_attributes` filtered by `is_filterable` — that is what the
composite index is for. Clamp `page` and `pageSize` server-side.

`sort` is an allow-list — `featured | newest | price_asc | price_desc |
name_asc`. **Anything else is a 400, not a silent fallback to newest**; a
mistyped sort that quietly returns newest is a bug you find in production.

Two things the collection half has to get right:

- **Featured sort on a manual collection is the curator's order.** Someone
  dragged those products into `collection_products.position` in the admin.
  Defaulting to Newest discards that silently — nobody reports it, it just
  quietly makes merchandising pointless. `featured` falls back to newest
  everywhere else.
- **Dynamic collections run the rules engine and cache the result** in Redis,
  invalidated whenever a product changes in a way a rule can see: published,
  unpublished, archived, repriced, recategorised, rebranded. The where-clause is
  built once and reused for the grid, the count and the facets, or the facet
  counts will not match the grid.

Sale is a collection wearing a nav item — point the header entry at a slug
rather than building a special page.

**UI** — grid, filter sidebar from facets with counts and multi-select,
URL-synced, sort, pagination. The collection page adds a banner above that same
grid, and `/collections` is a plain tile index.

**Done when:** Material = Mesh plus Brand = Nike updates the URL, the grid and
the remaining facet counts together — and the same components render a manual
collection in the order the admin dragged it into, with no second product
query.

---

## Phase 14 — Cart and wishlist, no login required

Adding to cart **does not reserve inventory** (§4). The auth wall is on
checkout only.

**API**
```
POST   /api/storefront/cart/hydrate      PUBLIC, rate limited, ids in, display out
POST   /api/storefront/wishlist/hydrate  PUBLIC, rate limited
GET    /api/storefront/cart              authed
POST   /api/storefront/cart/items        authed
PATCH  /api/storefront/cart/items/:id
DELETE /api/storefront/cart/items/:id
POST   /api/storefront/cart/merge        on login AND register
GET    /api/storefront/wishlist
POST   /api/storefront/wishlist/items
DELETE /api/storefront/wishlist/items/:productId
POST   /api/storefront/wishlist/merge
```

The request body is `{ variantId, quantity }` and nothing else. A `price` in
the payload is ignored, not echoed, not validated against (§5). Quantity is
validated server-side — `>= 1`, `<= max_allowed`, `<= available` — regardless
of what the UI allowed (§17). Hydrate re-reads live price and status, so a
three-week-old localStorage cart shows today's price and drops anything
archived, **with a reason per line** (§16).

Rate limit hydrate hard. It is an unauthenticated endpoint that takes an array
of ids, which is a catalog-scraping tool if you let it be.

**UI** — `local-cart.ts` / `local-wishlist.ts` store ids and quantities only,
never prices. `useCart()` / `useWishlist()` hide the local-vs-server split so
no component ever writes `if (user)`. Cart drawer, cart page, wishlist page,
all public. `afterAuth()` merges both on login **and** register, clearing local
only after the server responds. `storage` listener so a second tab updates.

**Done when:** fill a cart logged out, register, and it merges with nothing
lost or duplicated.

---

## Phase 15 — Checkout

The risky one, and where every bug costs something real. Budget more than it
looks like it needs. Split into steps and do them in this order; do not start
15.1 before 15.0 is migrated, and do not start 15.5 before 15.3 is quoting
money correctly.

### 15.0 — Schema migration (all of it, before any checkout code)

One migration, not one per sub-phase. `reviews` and the coupon tables land here
even though they are not used until Phase 17 and 15.3 — a second migration on a
live `order_items` later is the thing being avoided.

```
checkout_sessions       user_id, status, expires_at,
                        subtotal, discount_amount, shipping_amount,
                        total_amount, currency,          no tax_amount
                        shipping_address_id, billing_address_id,
                        order_id (null until the webhook lands)
                        status: ACTIVE | PAYMENT_PENDING | COMPLETED
                              | EXPIRED | CANCELLED                       §2

checkout_items          checkout_session_id, variant_id, quantity,
                        unit_price, total_price,
                        discount_amount            item-level discount
                        order_discount_allocated   this line's share of the
                                                   cart-wide discount
                        product_title, sku, variant_options jsonb      §6, §19
                        unique(checkout_session_id, variant_id)

inventory_reservations  checkout_session_id, variant_id, quantity,
                        expires_at, status
                        status: ACTIVE | RELEASED | EXPIRED | CONSUMED  §1, §24
                        unique(checkout_session_id, variant_id)

reviews                 product_id, user_id, rating 1-5, body, status
                        status: PUBLISHED | HIDDEN
                        unique(product_id, user_id)

coupons                 code (upper-case, unique), description,
                        type PERCENT | FIXED | FREE_SHIPPING, value,
                        min_cart_value, max_discount_amount,
                        starts_at, ends_at,
                        usage_limit, per_user_limit, used_count, status   §20
coupon_products         pk(coupon_id, product_id)
coupon_categories       pk(coupon_id, category_id)
coupon_redemptions      coupon_id, user_id, checkout_session_id,
                        order_id (null until confirmed), discount_amount,
                        status: ACTIVE | RELEASED | EXPIRED | CONSUMED
                        unique(coupon_id, order_id)

altered
  payments              + idempotency_key UNIQUE                     §7, §15
                        + provider_response jsonb
                        (provider, provider_payment_id) UNIQUE already exists
  order_items           + discount_amount
                        + order_discount_allocated
```

Three things worth stating plainly before writing the migration:

- **`inventory_reservations` is a row, not a counter.** `reserved_quantity`
  says *how much* is held; only a row says *by whom*, *until when*, and lets a
  sweep release exactly the abandoned ones.
- **`coupon_redemptions` mirrors `inventory_reservations`** — held at session
  creation, consumed by the webhook, released on expiry or failure. Without the
  hold, a single-use coupon is spent by two people who both have it open.
- **`order_items` gains two columns, and it is a shared admin table.**
  `shoe-admin-final-spec.md` §1.2 defines it without either; treat that spec's
  Orders section as stale by two columns, and the admin order detail should
  render a discounted line once they exist.

**There is no tax.** Not a column on `checkout_sessions`, not a line in any
summary, not a figure the API returns. `orders.tax_amount` already exists in
the schema from the admin build and **stays** — dropping a column the admin
order screens already read buys nothing. It is written `0` on every order and
never rendered. If GST is ever added, the column is waiting.

**Shipping is a setting, not a table** — one flat rate with a free-above
threshold, in store settings, applied by the API. No zones, no bands.
Computed server-side is the part of §21 that still applies.

Order state stays the existing two-field model — `orders.status` +
`orders.payment_status`. The machine in §11 is enforced by a transition
allow-list in the service, not by a new enum. `DELIVERED → PAYMENT_PENDING`
throws; it does not silently no-op.

**No `verified_purchase` column.** Derived per query — does this user have a
`PAID` order containing a variant of this product. Storing it means keeping it
true forever.

### 15.1 — Addresses
```
GET/POST /api/storefront/addresses, PATCH/DELETE /addresses/:id,
POST /addresses/:id/default
```
Owner-scoped. Someone else's address id is a 404, not a 403 (§22).

### 15.2 — Create checkout session
`POST /api/storefront/checkout`

One transaction:
1. Revalidate every line: product ACTIVE, variant ACTIVE, live price, quantity
   `>= 1`, `<= max_allowed`, `<= available`. **Collect all failures, do not
   stop at the first** — one reason per line (§16).
2. Atomic reserve per line —
   `UPDATE inventories SET reserved_quantity = reserved_quantity + ? WHERE variant_id = ? AND quantity - reserved_quantity >= ?`
   then check affected rows. 1 → held, 0 → `OUT_OF_STOCK` for that line. Never
   `SELECT` then `UPDATE` (§3).
3. Write the `RESERVATION` ledger row and the `inventory_reservations` row.
4. `expires_at = now + 10 min`.
5. Snapshot title, SKU, options and unit price into `checkout_items` (§6, §19).

Any line short → roll back the whole session. Nothing partially reserved.

### 15.3 — Money: item discount, order discount, shipping
**Before any payment code**, because every screen downstream renders its
output.

```
POST   /api/storefront/checkout/:id/address    shipping + billing, re-quotes
POST   /api/storefront/checkout/:id/coupon     { code } — validate, hold, re-quote
DELETE /api/storefront/checkout/:id/coupon     release the hold, re-quote
DELETE /api/storefront/checkout/:id            explicit cancel, releases stock
                                               and coupon
```

**Three price concepts, and only two of them are discount lines.** Confusing
them is how a summary stops adding up:

1. **Catalog markdown** — `compare_at_price` against `price` on the variant.
   This is **not** a discount line. It is already inside `unit_price`. It shows
   as a strikethrough and a badge on the card and the PDP, and it never appears
   in the order summary as a deduction. Subtracting it *and* charging the
   marked-down price discounts the product twice.
2. **Item discount** — `checkout_items.discount_amount`, carried to
   `order_items.discount_amount`. A deduction attributable to specific lines.
3. **Order discount** — `checkout_sessions.discount_amount`, carried to
   `orders.discount_amount` (which already exists). A cart-wide deduction.

Computed server-side, in this order:

```
line_total     = unit_price × quantity           from the snapshots
subtotal       = Σ line_total
item_discount  = Σ checkout_items.discount_amount
order_discount = cart-wide discount, capped at (subtotal − item_discount)
shipping       = flat rate, waived when
                 (subtotal − item_discount − order_discount) >= free_above
total          = subtotal − item_discount − order_discount + shipping
```

`total` can never fall below `shipping`, and no discount may drive it negative —
that is what the cap on `order_discount` is for. The free-shipping threshold is
tested against the **discounted** goods total, not the raw subtotal, or a
coupon silently buys free delivery as well.

**Which bucket a coupon lands in is derived, not a column.** If
`coupon_products` and `coupon_categories` are both empty the coupon applies to
the whole cart and becomes the order discount; if either is populated it applies
only to eligible lines and becomes item discount, split across them. One coupon
per checkout session — stacking rules are a project of their own, and nothing
in scope needs them.

**The order discount is allocated back to the lines** in
`order_discount_allocated`, by largest remainder so the shares sum to exactly
the order discount. ₹100 across three lines is 33.34 / 33.33 / 33.33, and the
stray paisa has to land somewhere deterministic. This is one extra column in a
migration that is happening anyway; deriving the split later, at refund or
per-line reporting time, means re-deriving it from prices that have since
changed.

Coupon validation runs here *and again* inside `POST /payments`, because a
coupon can expire or hit its limit while the checkout sits open. Every
condition checked server-side: status `ACTIVE`, inside `starts_at`/`ends_at`,
`subtotal >= min_cart_value`, `used_count < usage_limit` incremented
atomically the same way inventory is, `(coupon, user)` redemptions under
`per_user_limit`, and every discounted line in `coupon_products` or its category
in `coupon_categories`. Capped by `max_discount_amount`. A `FREE_SHIPPING`
coupon sets `shipping` to 0 rather than producing a discount amount.

A rejected coupon returns `COUPON_INVALID` with a `reason` the UI prints
verbatim — "expired", "minimum spend ₹1,999 not met", "already used". A generic
"invalid coupon" turns support into guesswork.

### 15.4 — Read checkout session, refresh-safe
`GET /api/storefront/checkout/:id`

- `checkout.user_id != auth user` → **403**, not 404. It exists, it is not
  yours, and the UI needs to tell the two apart (§23).
- `expires_at < now` on read → mark `EXPIRED`, release reservations and coupon
  hold, return that state. Lazy expiry, not only the cron (§24).
- Already `COMPLETED` → return `CHECKOUT_ALREADY_COMPLETED` plus the order
  number, so a second tab redirects to confirmation instead of paying (§25).

Refreshing, or hitting back, restores state from this endpoint and creates
nothing (§26, §27).

### 15.5 — Payments, idempotent
```
POST /api/storefront/payments      header Idempotency-Key: <uuid>
GET  /api/storefront/payments/:id
```

`PaymentProvider` interface — `createPayment` / `getPayment` /
`verifySignature` / `parseWebhook` — with a **mock provider first**. `getPayment`
exists for reconciliation and nothing else, which is why it is easy to forget
until you need it at 2am. The mock is permanent, not scaffolding: webhook
retries, out-of-order delivery, declines and a race for the last unit cannot be
triggered on demand against Razorpay. It signs its webhooks with the same HMAC
scheme, or `verifySignature` stays untested until real money is involved.
Razorpay drops in behind the interface later.

Same key seen twice → return the stored result, create nothing (§7). Rely on
the unique constraint, not a pre-`SELECT`.

### 15.6 — Webhook as source of truth
`POST /api/webhooks/payments/:provider` — unauthenticated, signature verified,
idempotent on `(provider, provider_payment_id)`.

One transaction (§14):
```
verify signature → create order + order_items from checkout_items snapshots
                 → reservations ACTIVE → CONSUMED, ledger RESERVATION → SALE
                 → coupon redemption ACTIVE → CONSUMED, used_count committed
                 → payment CAPTURED, order payment_status PAID
                 → session COMPLETED, order_id set, cart cleared
```
Rollback on any failure. `payment = SUCCESS` with no order is the state this
step exists to make impossible. The frontend never decides order status (§8, §12).

### 15.7 — Expiry, timeout, reconciliation
- Cron sweep: `ACTIVE` reservations past `expires_at` → `EXPIRED`, release
  stock, `RELEASE` ledger row, release the coupon hold, session `EXPIRED` (§24).
- A provider that does not answer leaves `PAYMENT_PENDING`. Do not mark it
  failed on the spot — wait for the webhook or the reconciliation pass (§9).

**Reconciliation, specified.** Webhooks get lost. A job every 5 minutes takes
payments still `PENDING` or `AUTHORIZED`, older than 10 minutes, within a
24-hour lookback, and asks `provider.getPayment()` what actually happened:

| Provider says | Action |
|---|---|
| captured | run the **same handler the webhook runs** — it is idempotent, so this is safe |
| failed / declined | mark `FAILED`, release stock and coupon, session `CANCELLED` |
| still pending | leave it, try again next pass |
| no record of it | the request never landed. After 30 minutes, `FAILED` and release |
| older than the 24h lookback | `FAILED`, release, and **alert a human** — do not retry forever |

The one rule that matters: **reconciliation and the webhook call the same
function.** Two code paths that both confirm orders will diverge, and the one
that runs less often is the one that will be wrong.

### 15.8 — Checkout UI
Last, once the states it has to render actually exist. One page, not a wizard.
Form left, sticky order summary right, under `RequireAuth` →
`/login?redirect=/checkout` with "Sign in to complete your order".

- Every number comes from the server. Subtotal, item discount, order discount,
  shipping and total are displayed, never computed client-side (§21). There is
  no tax row anywhere in the summary.
- Changed-price / short-stock warnings block Pay until acknowledged (§16).
- Coupon field prints the server's `reason` verbatim on rejection.
- Pay disables on click — UX only, the backend still owns correctness (§13).
- Idempotency key generated once per attempt and reused across retries.
- After payment, poll `GET /api/storefront/orders/:orderNumber` for the real
  status rather than trusting the provider callback (§10, §12).
- Failure page states plainly that nothing was charged.
- A countdown for the 10-minute TTL is decoration; the backend rejects on
  `expires_at` either way (§2).

**Done when:** two browsers racing for the last unit produce exactly one order
and one clear failure; a double-clicked Pay produces one payment; a single-use
coupon open in two checkouts is spent once; and killing the tab mid-payment
still confirms the order when the webhook lands.

---

## Phase 16 — Account

```
GET   /api/storefront/orders            ?page=
GET   /api/storefront/orders/:orderNumber
PATCH /api/storefront/account
POST  /api/storefront/account/password
```

Every read verifies resource ownership, not just authentication — another
user's order id is a **404** (§22). Order detail renders the snapshots on
`order_items`, never a join to today's product price (§19).

**UI** — order history, order detail with timeline, address book with default
handling, profile, password change.

---

## Phase 17 — Reviews

Table already migrated in 15.0. **Both open questions are now settled by the
spec:** any signed-in user who has not already reviewed can write one — the
`unique(product_id, user_id)` constraint is the guard and a second attempt is a
409 — and `status` (`PUBLISHED | HIDDEN`) ships now, because adding a
moderation column after launch is a migration on a live table.

```
GET    /api/storefront/products/:slug/reviews   ?page=&sort=   PUBLIC
POST   /api/storefront/products/:slug/reviews   authed, 409 if already reviewed
PATCH  /api/storefront/reviews/:id              own review only
DELETE /api/storefront/reviews/:id              own review only
```

`HIDDEN` reviews are invisible to everyone except their author, who still sees
their own — otherwise they write it again and hit the unique constraint with no
explanation.

"Verified purchase" is derived per query — does this user have a `PAID` order
containing a variant of this product — never stored. It reads false for
everyone until Phase 15 ships, which is why reviews sit here and not in 12.
Averages computed per page with one grouped query; no denormalised column to
drift.

---

## Phase 18 — Home

Late on purpose. It is merchandising, and every component on it — product card,
carousel, collection tile — already exists by now.

```
GET /api/storefront/home           featured collections, new arrivals
```

Hero, featured collection tiles, new arrivals carousel, category tiles. The
tiles link into the collection pages Phase 13 built.

**Done when:** the page is assembled entirely from components that already
existed, with no new grid, card or query written for it.

---

## Phase 19 — SEO and polish

`react-helmet-async` per-page meta, product JSON-LD, sitemap, lazy images with
blur placeholders and responsive sizes, skeletons on every async region, 404,
error boundaries, mobile pass. Then decide on prerendering.

---

## After the storefront

Back to admin **Phase 8** (order and payment read screens) and **Phase 9**
(customers, dashboard, settings) — now against real orders produced by
Phase 15 rather than invented ones. The webhook and payment writes already
shipped with 15.6. Admin coupon management is new scope created by 15.0 and
belongs in that stretch.

---

## Holds across every phase

- Build API and UI together, never all endpoints first.
- Shop serializers are never shared with admin.
- Every stock write is a transaction with a ledger row.
- Never send a raw stock number to a customer.
- Prices are re-read from the database at checkout time, whatever the cart said.
  The cart is a wish, the checkout session is a quote, the order is a commitment.
- The client sends `{ variantId, quantity }`. Everything else is computed.
- Refresh, back, and a second tab are all normal. Every checkout and payment
  screen restores from a GET and creates nothing.

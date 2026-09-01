# StrideX Storefront — Final Build Spec

Postgres + Prisma + Node.js (Express) + Vite React SPA + S3/MinIO. Redis for
collection caching.

Read in order: database, then APIs, then screens. Exact Prisma types are in
`packages/db/prisma/schema.prisma`. This is the customer-facing half of
`shoe-admin-final-spec.md` and assumes that spec's catalog is already built and
populated — 27 brands, 210 ACTIVE products, 3,852 variants.

**The one structural change from the original blueprint:** checkout no longer
creates the order. `ecommerce_frontend_backend_rules.md` puts a *checkout
session* between the cart and the order — the session reserves inventory under a
TTL and snapshots prices, and the **webhook** creates the order once payment is
confirmed. Three tables get added in place of a direct `POST /checkout →
orders` write: `checkout_sessions`, `checkout_items`, `inventory_reservations`.
Without them you cannot expire an abandoned checkout, cannot hold stock without
an order to hang it on, and cannot survive a payment that succeeds while the
browser is offline.

**Second change:** `reviews` is a new table. Nothing review-shaped exists in the
admin schema.

---

# PART 1 — DATABASE

## 1.1 What the storefront touches

| Tables | Access |
|---|---|
| `brands` `categories` `products` `product_media` `product_attributes` `product_variant_options` `product_variants` `variant_option_assignments` `collections` `collection_products` | read only, `ACTIVE` only |
| `inventories` | read as a bucket, written only through the reservation path |
| `users` `user_sessions` `password_reset_tokens` `addresses` | read + write, role `CUSTOMER` |
| `carts` `cart_items` `wishlists` `wishlist_items` | read + write, owner scoped |
| `orders` `order_items` `order_addresses` `order_status_history` `payments` `payment_transactions` | written by the webhook, read by the account |
| `inventory_transactions` | written on every reserve, release and sale |

No storefront code writes a catalog table. Ever.

## 1.2 New tables

```
checkout_sessions      id, user_id→users,
                       status[ACTIVE|PAYMENT_PENDING|COMPLETED|EXPIRED|CANCELLED],
                       expires_at,
                       subtotal, discount_amount, shipping_amount,
                       total_amount, currency,
                       shipping_address_id→addresses,
                       billing_address_id→addresses,
                       order_id→orders (null until the webhook lands),
                       created_at, updated_at

checkout_items         id, checkout_session_id→checkout_sessions,
                       variant_id→product_variants,
                       product_title, sku, variant_options jsonb,
                       unit_price, quantity, total_price,
                       discount_amount, order_discount_allocated,
                       created_at
                       unique(checkout_session_id, variant_id)

inventory_reservations id, checkout_session_id→checkout_sessions,
                       variant_id→product_variants, quantity,
                       status[ACTIVE|RELEASED|EXPIRED|CONSUMED],
                       expires_at, created_at, updated_at
                       unique(checkout_session_id, variant_id)

reviews                id, product_id→products, user_id→users,
                       rating smallint 1-5, body,
                       status[PUBLISHED|HIDDEN], created_at, updated_at
                       unique(product_id, user_id)

coupons                id, code✦ (stored upper-case), description,
                       type[PERCENT|FIXED|FREE_SHIPPING], value,
                       min_cart_value, max_discount_amount,
                       starts_at, ends_at,
                       usage_limit, per_user_limit, used_count,
                       status[DRAFT|ACTIVE|ARCHIVED], timestamps

coupon_products        coupon_id→coupons, product_id→products
                       pk(coupon_id, product_id)
coupon_categories      coupon_id→coupons, category_id→categories
                       pk(coupon_id, category_id)

coupon_redemptions     id, coupon_id→coupons, user_id→users,
                       checkout_session_id→checkout_sessions,
                       order_id→orders (null until confirmed),
                       discount_amount,
                       status[ACTIVE|RELEASED|EXPIRED|CONSUMED],
                       created_at, updated_at
                       unique(coupon_id, order_id)

```

**There is no tax.** Not on `checkout_sessions`, not in any summary, not in any
response. `orders.tax_amount` already exists from the admin build and stays —
dropping a column the admin order screens read buys nothing — written `0` on
every order and never rendered. If GST is ever added, the column is waiting.

**Shipping is a setting, not a table.** One flat rate with a free-above
threshold, stored in store settings and applied by the API. No rate tables, no
zones, no price bands. It is computed server-side — which is the part of §21
that still applies — from a value a human can change in one place.

Altered:
```
payments               + idempotency_key✦
                       + provider_response jsonb

checkout_items         + discount_amount, + order_discount_allocated
order_items            + discount_amount, + order_discount_allocated
```

Why each column earns its place:

- **`checkout_sessions.expires_at`** is the only thing standing between an
  abandoned tab and permanently held stock. Ten minutes. The countdown the UI
  shows is decoration; this column is the authority.
- **`checkout_items.unit_price`** is the price snapshot. A product can be
  repriced by the admin while a customer is paying. Payment charges the
  snapshot; an expired session gets a fresh one at current prices.
- **`checkout_items.product_title` / `sku` / `variant_options`** carry forward
  into `order_items` verbatim. The order never joins to today's product.
- **`inventory_reservations` is a row, not a counter.** `inventories.reserved_quantity`
  tells you *how much* is held; only a reservation row tells you *by whom*, *until
  when*, and lets a sweep release exactly the abandoned ones.
- **`payments.idempotency_key`** with a unique index is the double-click guard.
  A disabled button is UX; this is correctness.
- **`reviews.status`** ships now. Adding a moderation column after launch is a
  migration on a live table.

- **`coupons.used_count` is incremented atomically**, exactly like inventory:
  `UPDATE coupons SET used_count = used_count + 1 WHERE id = $1 AND (usage_limit
  IS NULL OR used_count < usage_limit)`, then check affected rows. Two customers
  racing for the last use of a coupon is the same problem as two racing for the
  last pair of shoes, and it has the same answer.
- **`coupon_redemptions` mirrors `inventory_reservations`.** A coupon is *held*
  when the checkout session is created, *consumed* when the webhook confirms
  payment, and *released* when the session expires or fails. Without the hold, a
  single-use coupon can be spent by two people who both have it in an open
  checkout. `unique(coupon_id, order_id)` is the belt to that braces.
- **Discounts exist at two levels, and both are stored.** Per-line
  `discount_amount` is the *item* discount — a coupon restricted to one brand
  discounts two lines out of four, and the order has to record which.
  `checkout_sessions.discount_amount` / `orders.discount_amount` is the *order*
  discount, applied to the whole cart.
- **`order_discount_allocated` splits the order discount back across the
  lines**, by largest remainder so the shares sum to exactly the order
  discount. ₹100 over three lines is 33.34 / 33.33 / 33.33 and the stray paisa
  must land somewhere deterministic. Deriving the split later, at refund or
  per-line reporting time, means re-deriving it from prices that have moved.
- **A catalog markdown is not a discount line.** `compare_at_price` against
  `price` is already inside `unit_price`; it shows as a strikethrough and a
  badge and never appears in the summary as a deduction. Subtracting it *and*
  charging the marked-down price discounts the product twice.

**No `verified_purchase` column.** It is derived per query — does this user have
a `PAID` order containing a variant of this product. Storing it means keeping it
true forever.

**`order_items` gains one column it did not have in the admin build.**
`shoe-admin-final-spec.md` §1.2 defines that table without `discount_amount`.
Adding it is a migration on a shared table, and the admin order detail should
show a discounted line once it exists — treat that spec's Orders section as
stale by one column.

## 1.3 The checkout lifecycle

```
cart_items                        no reservation, no hold
     │  POST /checkout
     ↓
checkout_sessions  ACTIVE ─────── expires_at = now + 10 min
     ├── checkout_items           price + discount snapshot
     ├── inventory_reservations   ACTIVE, atomic per line
     └── coupon_redemptions       ACTIVE, atomic on used_count
     │
     │  POST /payments  (Idempotency-Key)
     ↓
           PAYMENT_PENDING
     │
     ├── webhook SUCCESS ──→ COMPLETED ──→ orders + order_items
     │                       reservations + coupon CONSUMED, ledger SALE
     │                       cart cleared
     │
     ├── webhook FAILED ───→ CANCELLED
     │                       reservations + coupon RELEASED, stock back
     │
     └── expires_at passed ─→ EXPIRED
                             reservations + coupon EXPIRED, stock back
```

Expiry happens two ways and needs both: **lazily**, whenever a session is read
past `expires_at`, and on a **cron sweep** for sessions nobody comes back to.
A sweep alone means a customer can pay against a session that expired 40 seconds
ago.

## 1.4 Order state machine

`orders.status` and `orders.payment_status` are separate fields because
fulfilment and payment answer different questions and get filtered separately.
Neither is free-form. Every write goes through a transition allow-list in the
service, and an illegal transition **throws** — it does not silently no-op.

```
payment_status   PENDING ──→ PAID ──→ PARTIALLY_REFUNDED ──→ REFUNDED
                     └────→ FAILED

status           PENDING ──→ PROCESSING ──→ SHIPPED ──→ DELIVERED
                     │            │                        │
                     └────────────┘                        ↓
                          ↓                             REFUNDED
                      CANCELLED
```

Allowed: `PENDING → PROCESSING | CANCELLED`, `PROCESSING → SHIPPED |
CANCELLED`, `SHIPPED → DELIVERED`, `DELIVERED → REFUNDED`.

Rejected, and these are the ones the allow-list exists for:
`DELIVERED → PROCESSING`, anything out of `CANCELLED`, and any fulfilment
progress on an order whose `payment_status` is still `PENDING`.

**Naming, because it will confuse someone:** the rules doc's order lifecycle is
`CREATED → PAYMENT_PENDING → CONFIRMED → PROCESSING → …`. Here the first two
states live on the **checkout session**, not the order — an order row does not
exist until payment is confirmed. So `orders.status = PENDING` is the rules
doc's `CONFIRMED`: paid, awaiting fulfilment. There is no order in any other
state, which is what makes "payment succeeded but no order" impossible rather
than merely unlikely.

**The storefront never writes either field.** They are written by the webhook
and by the admin. The account pages display them.

## 1.5 Indexes worth creating on day one

```
checkout_sessions       (user_id, status)
                        (status, expires_at)        the sweep
inventory_reservations  (status, expires_at)        the sweep
                        (variant_id, status)        live held count
                        (checkout_session_id)
checkout_items          (checkout_session_id)
payments                (idempotency_key) unique
reviews                 (product_id, status, created_at)
                        (product_id, rating)        the histogram
coupons                 (code) unique               lookup is by code
                        (status, starts_at, ends_at)
coupon_redemptions      (coupon_id, user_id, status)   per-user limit
                        (checkout_session_id)
                        (coupon_id, order_id) unique
```

`products (status, created_at)` and the `product_attributes (attribute_id,
attribute_value_id)` composite already exist from the admin build. The facet
query is the reason for the second one and it will be the slowest thing on the
site — check its plan before shipping category filters.

---

# PART 2 — API

All routes are `/api/storefront/*`. Conventions:

- List endpoints take `?page=1&limit=24&sort=` plus their own filters and return
  `{ data, meta: { page, limit, total, totalPages } }`.
- Errors: `{ error: { code, message, fields? } }`. Codes the UI branches on:
  `OUT_OF_STOCK`, `PRICE_CHANGED`, `PRODUCT_UNAVAILABLE`, `CHECKOUT_EXPIRED`,
  `CHECKOUT_ALREADY_COMPLETED`, `QUANTITY_EXCEEDED`, `COUPON_INVALID`.
- **Stock is a bucket, never a number:** `IN_STOCK | LOW_STOCK | SOLD_OUT`. One
  `stockBucket()` in `serializers/shop/`, used everywhere.
- **A non-`ACTIVE` record is a 404**, not a 403. An archived product must not
  confirm it exists.
- **Ownership is checked on every authed read.** Another user's order id is a
  404; another user's checkout session is a **403** (it exists, it is not yours,
  and the UI needs to tell the two apart).
- The client sends `{ variantId, quantity }`. A `price` in the body is ignored,
  not echoed, not validated against.
- `serializers/shop/` is never `serializers/admin/`. No shared response shape.

### Auth
```
POST   /auth/register              forces role CUSTOMER
POST   /auth/login                 rejects ADMIN | STAFF
POST   /auth/refresh
POST   /auth/logout
GET    /auth/me
POST   /auth/verify-email
POST   /auth/forgot-password       same response whether or not the email exists
POST   /auth/reset-password
```

### Catalog
```
GET    /categories/tree
GET    /products                   ?category=&collection=&brand=&attr:{id}=
                                   &minPrice=&maxPrice=&sort=&page=
GET    /products/facets            counts per filter value for the current query
GET    /products/:slug             media, attributes, options in position order,
                                   variants with option assignments + bucket
GET    /products/:slug/related     same category → same brand → newest
GET    /search                     ?q=
GET    /search/suggest             ?q=   header overlay, 5 products + 3 categories
GET    /collections                index, ACTIVE only
GET    /collections/:slug          collection meta only — name, description,
                                   image, type, count
GET    /home                       featured collections, new arrivals
```

**`collection` is a filter on `/products`, not its own endpoint.** A collection
page and a category page differ by one query parameter; they must not become two
product queries that drift apart. `GET /collections/:slug` returns the banner
material and nothing else. Both are built in the same step for the same reason.

For a `MANUAL` collection the filter resolves to the `collection_products` id
list and carries its `position`. For a `DYNAMIC` one it resolves to the rules
engine's where-clause, built once and reused for the grid, the count and the
facets — faceting a dynamic collection against the whole catalogue gives counts
that do not match what the grid shows.

`sort` is an allow-list: `featured | newest | price_asc | price_desc |
name_asc`. Anything else is a 400, not a silent default — a mistyped sort that
quietly returns newest is a bug you find in production.

`featured` means `collection_products.position` on a manual collection and
falls back to newest everywhere else.

### Cart and wishlist
```
POST   /cart/hydrate               PUBLIC, rate limited, ids in, display out
POST   /wishlist/hydrate           PUBLIC, rate limited
GET    /cart                       authed
POST   /cart/items                 authed
PATCH  /cart/items/:id
DELETE /cart/items/:id
POST   /cart/merge                 on login AND register
GET    /wishlist
POST   /wishlist/items
DELETE /wishlist/items/:productId
POST   /wishlist/merge
```

`hydrate` is the whole trick. It takes `[{ variantId, quantity }]` from
localStorage and returns today's price, today's status and today's stock bucket,
with a `reason` per line that could not be honoured. A three-week-old cart shows
current prices and drops archived products, and the UI can say which ones.

Rate limit it hard. It is an unauthenticated endpoint that takes an array of
ids, which is a catalog-scraping tool if you let it be.

### Addresses
```
GET    /addresses
POST   /addresses
PATCH  /addresses/:id
DELETE /addresses/:id
POST   /addresses/:id/default
```

### Checkout
```
POST   /checkout                   creates session, reserves stock, snapshots price
GET    /checkout/:id               refresh-safe, lazily expires, 403 if not yours
POST   /checkout/:id/address       shipping + billing, re-quotes shipping
POST   /checkout/:id/coupon        { code } — validate, hold, re-quote
DELETE /checkout/:id/coupon        release the hold, re-quote
DELETE /checkout/:id               explicit cancel, releases stock and coupon
```

`POST /checkout` is one transaction and does these in order:

1. Revalidate every line — product `ACTIVE`, variant `ACTIVE`, live price,
   quantity `>= 1` and `<= max_allowed` and `<= available`. Collect **all**
   failures, do not stop at the first.
2. Reserve each line atomically:
   ```sql
   UPDATE inventories
      SET reserved_quantity = reserved_quantity + $qty
    WHERE variant_id = $id
      AND quantity - reserved_quantity >= $qty
   ```
   Affected rows 1 → held. 0 → `OUT_OF_STOCK` for that line. Never `SELECT`
   then `UPDATE`.
3. Write the `RESERVATION` ledger row and the `inventory_reservations` row.
4. `expires_at = now() + 10 minutes`.
5. Snapshot title, SKU, options and unit price into `checkout_items`.
6. Compute the money server-side, in this order — the order matters, because
   each step feeds the next:
   ```
   line_total     = unit_price × quantity            from the snapshots
   subtotal       = Σ line_total
   item_discount  = Σ checkout_items.discount_amount      per eligible line §20
   order_discount = cart-wide discount, capped at (subtotal − item_discount)
   shipping       = flat rate, waived when
                    (subtotal − item_discount − order_discount) >= free_above
   total          = subtotal − item_discount − order_discount + shipping
   ```
   **There is no tax step.** `total` can never fall below `shipping`, which is
   what the cap on `order_discount` is for. The free-shipping threshold is
   tested against the **discounted** goods total, not the raw subtotal, or a
   coupon quietly buys free delivery too.

   Which bucket a coupon lands in is derived, not a column: `coupon_products`
   and `coupon_categories` both empty → it is the order discount; either
   populated → it is item discount, split across eligible lines. One coupon per
   session. A `FREE_SHIPPING` coupon sets `shipping` to 0 rather than producing
   a discount amount.

Any line short rolls the whole thing back. Nothing is ever partially reserved.

**Coupon validation** runs on `POST /checkout/:id/coupon` and again inside
`POST /payments`, because a coupon can expire or hit its limit while the
checkout sits open. Every condition in §20 is checked server-side:

```
exists and status = ACTIVE
now between starts_at and ends_at
subtotal >= min_cart_value
used_count < usage_limit                        atomically, see §1.2
redemptions for (coupon, user) < per_user_limit
every discounted line is in coupon_products, or its category
  is in coupon_categories                       empty lists mean "everything"
```

The discount is capped by `max_discount_amount` and can never exceed the
eligible subtotal. A rejected coupon returns `COUPON_INVALID` with a `reason`
the UI can print verbatim — "expired", "minimum spend ₹1,999 not met",
"already used". A generic "invalid coupon" turns support into guesswork.

### Payments
```
POST   /payments                   header Idempotency-Key: <uuid>
GET    /payments/:id
POST   /api/webhooks/payments/:provider     unauthenticated, signature verified
```

`PaymentProvider` is an interface — `createPayment` / `getPayment` /
`verifySignature` / `parseWebhook` — with a **mock provider first**.
`getPayment` exists for reconciliation and nothing else, which is why it is easy
to forget until you need it at 2am. The mock is permanent, not
scaffolding: webhook retries, out-of-order delivery, declines and two browsers
racing for the last unit cannot be triggered on demand against a real gateway.
It signs with the same HMAC scheme, or `verifySignature` stays untested until
real money is involved. Razorpay drops in behind it later.

The same `Idempotency-Key` twice returns the stored result and creates nothing.
Rely on the unique constraint, not a pre-`SELECT`.

The **webhook** is the source of truth, and it is one transaction:
```
verify signature
  → create order + order_items from the checkout_items snapshots
  → reservations ACTIVE → CONSUMED, ledger RESERVATION → SALE
  → payment CAPTURED, order payment_status PAID
  → session COMPLETED, order_id set, cart cleared
```
Roll back on any failure. `payment = SUCCESS` with no order is the state this
transaction exists to make impossible.

A provider that does not answer leaves `PAYMENT_PENDING`. Do **not** mark it
failed on the spot — wait for the webhook or the reconciliation pass.

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

### Account
```
GET    /orders                     ?page=
GET    /orders/:orderNumber
PATCH  /account
POST   /account/password
```

### Reviews
```
GET    /products/:slug/reviews     ?page=&sort=   PUBLIC
POST   /products/:slug/reviews     authed, 409 if this user already reviewed
PATCH  /reviews/:id                own review only
DELETE /reviews/:id                own review only
```

`HIDDEN` reviews are invisible to everyone except their author, who still sees
their own — otherwise they write it again and hit the unique constraint with no
explanation.

---

# PART 3 — SCREENS

**Direction: editorial minimal.** White ground, near-black text, one accent held
back for sale prices and CTAs. Big imagery, generous whitespace, restrained
type. Own shadcn install in `apps/storefront` — no `packages/ui`, no import
from `apps/admin`, ever.

## 3.0 Shell

```
┌──────────────────────────────────────────────────────────────┐
│  STRIDEX        Men   Women   Kids   Sale      ⌕   ♡   Bag 2 │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   page                                                       │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  SHOP            HELP            ABOUT                       │
│  Men             Shipping        Our story    [ email     ]  │
│  Women           Returns         Stores       [ Subscribe ]  │
│  Kids            Size guide      Careers                     │
│  Sale            Contact                                     │
│  ──────────────────────────────────────────────────────────  │
│  © 2026 StrideX                          visa  mc  upi  cod  │
└──────────────────────────────────────────────────────────────┘
```

Header is thin, borderless, and grows a hairline on scroll. Hovering a top-level
category opens a full-width panel of its children — the tree is two levels, so
this is one flat column set, not a cascade:

```
├──────────────────────────────────────────────────────────────┤
│  Sneakers        Sports Shoes     Sandals & Floaters         │
│  Casual Shoes    Formal Shoes     Flip Flops & Slippers      │
│  Loafers         Boots            Ethnic Footwear    [ img ] │
└──────────────────────────────────────────────────────────────┘
```

On mobile the nav is a drawer that **drills in one level at a time**. An
accordion showing all 24 categories at once is the thing to avoid.

Build once, use everywhere: `ProductCard`, `Price`, `StockLabel`,
`ImageGallery`, `FilterSidebar`, `CartDrawer`, `QuantityStepper`,
`EmptyState`, `Skeleton`, `Seo`, `Toast`.

Rules that hold on every page: list state lives in the URL, every async region
has a skeleton shaped like its content, prices always render through `Price`
so compare-at and the discount pill never drift, and the cart badge reads from
`useCart()` so a second tab updates through the `storage` event.

## 3.1 Home

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                   [ full-bleed image ]                       │
│                                                              │
│               Built for the long way round                   │
│                     [ Shop new in ]                          │
├──────────────────────────────────────────────────────────────┤
│  ┌──────────────────────┐  ┌──────────────────────┐          │
│  │                      │  │                      │          │
│  │   Monsoon ready      │  │   Under ₹1,499       │          │
│  └──────────────────────┘  └──────────────────────┘          │
├──────────────────────────────────────────────────────────────┤
│  New arrivals                                     ‹    ›     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐             │
│  │         │ │         │ │         │ │         │             │
│  ├─────────┤ ├─────────┤ ├─────────┤ ├─────────┤             │
│  │ ASICS   │ │ Puma    │ │ Mochi   │ │ Campus  │             │
│  │ Japan S │ │ Cool Cat│ │ Zari    │ │ Infant  │             │
│  │ ₹4,739  │ │ ₹649    │ │ ₹1,399  │ │ ₹849    │             │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘             │
├──────────────────────────────────────────────────────────────┤
│  ┌────────────┐ ┌────────────┐ ┌────────────┐                │
│  │    Men     │ │   Women    │ │    Kids    │                │
│  └────────────┘ └────────────┘ └────────────┘                │
└──────────────────────────────────────────────────────────────┘
```

One hero, one sentence, one CTA. Built last on purpose — every component on this
page already exists by then, and merchandising decisions are cheaper once you
can see real products in real grids.

## 3.2 Category

```
Home / Men / Sports Shoes
Sports Shoes                                        24 products
Cushioned trainers for road and treadmill.
──────────────────────────────────────────────────────────────
                              [ Sort: Newest ▼ ]

FILTERS          ┌─────────┐ ┌─────────┐ ┌─────────┐
Clear all        │       ♡ │ │       ♡ │ │       ♡ │
                 │         │ │         │ │         │
BRAND            ├─────────┤ ├─────────┤ ├─────────┤
☑ Under Armour 6 │ Under   │ │ ASICS   │ │ Red Tape│
☐ ASICS        4 │ Armour  │ │ Japan S │ │ Athlei..│
☐ Puma         4 │ HOVR..  │ │ ₹4,739  │ │ ₹2,799  │
☐ Adidas       3 │ ₹5,559  │ │         │ │ ₹3,779  │
                 │ ₹7,499  │ │         │ │  -26%   │
PRICE            │  -26%   │ │         │ │         │
₹449 ──●───● ₹7k └─────────┘ └─────────┘ └─────────┘
                 ┌─────────┐ ┌─────────┐ ┌─────────┐
MATERIAL         │  SOLD   │ │       ♡ │ │       ♡ │
☑ Mesh         5 │  OUT    │ │         │ │         │
☐ Knit         3 ├─────────┤ ├─────────┤ ├─────────┤
☐ Leather      0 │ Campus  │ │ Sparx   │ │ Puma    │
                 │ Rise    │ │ Trail   │ │ Flyer 2 │
CLOSURE          │ ₹2,199  │ │ ₹1,799  │ │ ₹3,499  │
☐ Lace-up     14 └─────────┘ └─────────┘ └─────────┘
☐ Slip-on      6
                              [ ‹  1  2  3  › ]
```

Active filters sit above the grid as dismissible pills with a Clear all.

- **Facet counts move with the query.** Selecting Mesh updates every other
  section's counts. A zero-count value **dims, it does not vanish** — a list
  that reflows on every click is unusable.
- **On mobile the sidebar is a bottom sheet with an Apply button.** Applying
  per-tap means a refetch per tap.
- Sold-out cards render, desaturated, with the label. They do not disappear —
  a customer looking for a specific shoe needs to learn it is sold out, not
  that it does not exist.
- Card hover swaps to the second image. Wishlist heart is on the card, top
  right, and works logged out.
- Empty state names the filters that caused it and offers Clear all. Never a
  bare empty grid.

## 3.3 Collection

A collection is a category page with a banner on top and one difference in how
it is ordered.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                  [ collection image ]                        │
│                                                              │
│                     Monsoon Ready                            │
│           Waterproof and quick-dry, for the wet months        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
Home / Collections / Monsoon Ready                   18 products
──────────────────────────────────────────────────────────────
                              [ Sort: Featured ▼ ]

FILTERS          ┌─────────┐ ┌─────────┐ ┌─────────┐
Clear all        │       ♡ │ │       ♡ │ │       ♡ │
                 │         │ │         │ │         │
BRAND            ├─────────┤ ├─────────┤ ├─────────┤
☐ Crocs        5 │ Crocs   │ │ Adidas  │ │ Paragon │
☐ Adidas       4 │ Classic │ │ Adilette│ │ Blot    │
☐ Puma         3 │ Clog    │ │ Aqua    │ │ Slipper │
☐ Paragon      3 │ ₹2,499  │ │ ₹599    │ │ ₹449    │
                 │         │ │ ₹809    │ │ ₹609    │
PRICE            │         │ │  -26%   │ │  -26%   │
₹449 ─●───● ₹4k  └─────────┘ └─────────┘ └─────────┘

MATERIAL                      [ ‹  1  2  › ]
☐ Rubber       9
☐ EVA          6
```

- **The grid is not a second implementation.** Same `ProductCard`, same
  `FilterSidebar`, same pagination, same `/products` endpoint with
  `?collection=` instead of `?category=`. If the collection page ever grows its
  own product query, something has gone wrong.
- **Default sort is Featured, and on a manual collection Featured is the
  curator's order.** A merchandiser dragged those products into
  `collection_products.position` in the admin; defaulting to Newest throws that
  work away silently. Dynamic collections have no curated order, so Featured
  falls back to newest — the option keeps its name either way so the sort
  control does not change shape between collection types.
- **Filters compose with the collection, they never replace it.** Brand = Crocs
  inside Monsoon Ready means both.
- **Dynamic collections run the rules engine and cache the result** in Redis,
  invalidated whenever a product changes in a way a rule can see — published,
  unpublished, archived, repriced, recategorised, rebranded. A dynamic
  collection that silently goes stale is worse than one that is slow.
- A `DRAFT` or `ARCHIVED` collection is a 404.
- **An empty collection is a real state.** A rule set can match nothing after an
  admin archives a run of products. Say the collection is empty and link back;
  do not render an empty grid under a banner.

Collections are not in the category nav, so the ways in are the home page tiles,
`/collections`, and direct links — **except Sale, which is a collection wearing
a nav item.** Point that nav entry at a collection slug rather than building a
special page for it.

`/collections` is a plain index of `ACTIVE` collections as image tiles, so the
ones not featured on the home page are still reachable and indexable.

---

## 3.4 Search

Same grid and sidebar as category, different header:

```
24 results for "running"                     [ Sort: Relevance ▼ ]
```

The header search opens an overlay, not a page:

```
┌──────────────────────────────────────────────────────────────┐
│  ⌕  running|                                             ✕   │
├──────────────────────────────────────────────────────────────┤
│  [▪] Under Armour HOVR Phantom 3                  ₹5,559     │
│  [▪] ASICS Japan S Sneaker                        ₹4,739     │
│  [▪] Sparx Trail Runner                           ₹1,799     │
│  ──────────────────────────────────────────────────────────  │
│  in Men > Sports Shoes    ·    in Women > Sports Shoes       │
└──────────────────────────────────────────────────────────────┘
```

Debounce 250ms. Enter goes to the full results page. Zero results suggests
categories rather than dead-ending.

## 3.5 Product detail

The screen the whole catalog model exists to render.

```
Home / Men / Sports Shoes / Under Armour HOVR Phantom 3
──────────────────────────────────────────────┬───────────────
┌────────────────────────────────────────────┐│ UNDER ARMOUR
│                                            ││
│                                            ││ HOVR Phantom 3
│                                            ││
│                                            ││ ₹5,559
│                   cover                    ││ ₹7,499   -26%
│                                            ││
│                                            ││ ★★★★☆ 4.2 (18)
│                                            ││
│                                            ││ Colour  Black
└────────────────────────────────────────────┘│ ●  ○  ○
┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐      │
│  ▪   ││  ▪   ││  ▪   ││  ▪   ││  ▪   │      │ Size    UK
└══════┘└──────┘└──────┘└──────┘└──────┘      │ ┌──┐┌──┐┌──┐┌──┐
 selected                                     │ │ 6││ 7││ 8││ 9│
                                              │ └──┘└──┘└──┘└──┘
                                              │ ┌──┐┌──┐┌──┐
                                              │ │10││11││12│
                                              │ └──┘└──┘└──┘
                                              │    ╲╲  (9 sold out)
                                              │
                                              │ ● Only a few left
                                              │
                                              │ [   Add to bag    ]
                                              │ [  ♡  Save        ]
                                              │
                                              │ Free delivery
                                              │ over ₹999
                                              │ 30-day returns
──────────────────────────────────────────────┴───────────────
SPECIFICATIONS
Gender          Men
Material        Mesh
Closure         Lace-up
Sole            Rubber
Weight          280 g
──────────────────────────────────────────────────────────────
YOU MAY ALSO LIKE
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│         │ │         │ │         │ │         │
└─────────┘ └─────────┘ └─────────┘ └─────────┘
──────────────────────────────────────────────────────────────
REVIEWS  4.2 out of 5 · 18 reviews          [ Write a review ]
5 ████████████░░░░  11
4 ██████░░░░░░░░░░   4
3 ███░░░░░░░░░░░░░   2
2 ░░░░░░░░░░░░░░░░   0
1 ██░░░░░░░░░░░░░░   1
──────────────────────────────────────────────────────────────
★★★★★  Rahul S.   ✓ Verified purchase            12 Aug 2026
Runs half a size small but the cushioning is excellent.
```

What this screen has to get right:

- **Option pickers are driven by `product_variant_options.position`**, not by a
  hardcoded Colour-then-Size. The product decides the order and the labels.
- **Variant resolution.** Black + 9 finds exactly one variant. Combinations with
  no variant are **disabled**; combinations whose variant is sold out are
  **struck through and still clickable**, so picking one tells you why rather
  than silently doing nothing. Sold-out sizes are never hidden.
- **Colour swatches come from `swatch_hex`.** Picking one swaps the gallery via
  `variant.media_id` and updates the price if that variant is priced
  differently.
- **Stock is a sentence, not a number.** "In stock" / "Only a few left" /
  "Sold out". Exact quantities invite scraping and expose your sell-through.
- **Price is per variant.** The buy box shows the selected variant's price the
  moment a full combination resolves, and the range (`from ₹5,559`) before that.
- **The gallery is one column: cover image, thumbnail strip underneath.**
  Clicking a thumbnail swaps the main image; the strip sits below the cover,
  never beside it. Both are 4:5, the main image full column width.
- **Five thumbnails, and five is the real ceiling.** No product in the catalogue
  has more than five images, so there is no overflow, no "+2" tile and no
  lightbox to build. If that ever changes, the sixth image is a reason to
  revisit this, not to silently truncate.
- **One image means no strip at all.** 46 products have exactly one image — a
  lone thumbnail duplicating the picture above it looks like a bug. Render the
  strip only from the second image onward.
- The selected thumbnail is marked with a rule under it, not a border box —
  a box around a photo fights the photo.
- The buy box is sticky while the specifications scroll past. With a compact
  gallery this is comfort rather than necessity, so it is the first thing to
  drop if it causes trouble on smaller laptops.
- Discount badges are quiet pills, not loud red blocks.
- **Add to bag works logged out.** The auth wall is on checkout only.
- Related products resolve same category → same brand → newest, excluding this
  product and anything sold out.
- Reviews render `PUBLISHED` only. "Verified purchase" is derived per request.
  The write form appears for signed-in users who have not already reviewed;
  everyone else sees the prompt to sign in.

## 3.6 Cart

```
Bag (3)                                      Continue shopping →
──────────────────────────────────────────┬───────────────────
[▪] Under Armour HOVR Phantom 3           │ SUMMARY
    Black / UK 9                          │
    ⚠ Price changed from ₹7,499           │ Subtotal   ₹12,297
    ₹5,559   [ − 1 + ]   ₹5,559      ✕    │
                                          │ Shipping calculated
[▪] ASICS Japan S Sneaker                 │ at checkout
    White / UK 8                          │
    ₹4,739   [ − 1 + ]   ₹4,739      ✕    │ [  Checkout  ]
                                          │
[▪] Puma Cool Cat Slide                   │ ♡ Move all to
    Navy / UK 10                          │   wishlist
    ⚠ Only 1 left — quantity reduced      │
    ₹649    [ − 1 + ]     ₹649       ✕    │
                                          │
[▪] Liberty Aha Cosy Home Slipper         │
    ⚠ No longer available          [ ✕ ]  │
──────────────────────────────────────────┴───────────────────
```

**The stale-cart states are the point of this screen.** `POST /cart/hydrate`
returns a reason per line and each renders inline, above its own item — amber,
one line, no icon soup. A page-level banner saying "some items changed" makes
the customer hunt for which.

Three reasons, three behaviours:
- `PRICE_CHANGED` — show the old price struck through, keep the line
- `OUT_OF_STOCK` with partial availability — reduce quantity, say so
- `PRODUCT_UNAVAILABLE` — the line cannot proceed, offer only Remove

Subtotal only. Quoting a total here that checkout then contradicts is worse
than not quoting one.

The **cart drawer** is the same line items in a right slide-over, opened by Add
to bag from anywhere. Full-screen sheet on mobile. `/cart` stays a real route so
it is linkable and the back button behaves.

## 3.7 Wishlist

```
Saved (6)
──────────────────────────────────────────────────────────────
┌─────────┐ ┌─────────┐ ┌─────────┐
│       ✕ │ │       ✕ │ │       ✕ │
├─────────┤ ├─────────┤ ├─────────┤
│ Mochi   │ │ Metro   │ │ Khadim's│
│ Zari    │ │ Cambr.. │ │ Cleo    │
│ ₹1,399  │ │ ₹4,099  │ │ ₹2,979  │
│ [Size ▼]│ │ [Size ▼]│ │  SOLD   │
│ [Add]   │ │ [Add]   │ │  OUT    │
└─────────┘ └─────────┘ └─────────┘
```

Public. Wishlist is per product, cart is per variant, so moving to bag needs a
size first — inline on the card, not a trip to the PDP.

## 3.8 Auth

`AuthLayout`: centred card, ~400px, logo above, nothing else on the page.

```
              ┌────────────────────────────────┐
              │           STRIDEX              │
              │                                │
              │  Sign in to complete your      │
              │  order                         │
              │                                │
              │  Email                         │
              │  [                          ]  │
              │  Password                      │
              │  [                       👁 ]  │
              │                                │
              │  [        Sign in           ]  │
              │                                │
              │  Forgot your password?         │
              │  New here?  Create an account  │
              └────────────────────────────────┘
```

- The line above the form is the guard's message, present only when arriving
  from a redirect.
- **Validate `redirect` starts with `/` and not `//`** or you have shipped an
  open redirect.
- Invalid credentials is a banner, never a field error.
- An `ADMIN` or `STAFF` account is rejected here with the same generic message —
  do not confirm that the address belongs to staff.
- Register ends on a "check your email" state, not a redirect.
- Forgot password shows the same confirmation whether or not the email exists.
- **`afterAuth()` merges cart and wishlist on login *and* register**, clearing
  local storage only after the server responds.

## 3.9 Checkout

One page, not a wizard. Guarded — unauthenticated arrivals land on
`/login?redirect=/checkout`.

```
Checkout                                    Expires in 09:41
──────────────────────────────────────────┬───────────────────
CONTACT                                   │ 3 items        ▼
[ ronik@mail.com                       ]  │
                                          │ [▪] HOVR Phantom 3
DELIVERY ADDRESS                          │     Black / 9
┌──────────────────┐ ┌──────────────────┐ │     ₹5,559
│ ● Home           │ │ ○ Office         │ │ [▪] Japan S
│ 12 MG Road       │ │ 4th Flr, Ring Rd │ │     White / 8
│ Surat 395007     │ │ Surat 395002     │ │     ₹4,739
└──────────────────┘ └──────────────────┘ │ [▪] Cool Cat Slide
[ + Use a new address ]                   │     Navy / 10
                                          │     ₹649
BILLING ADDRESS                           │ [ MONSOON20    ] [Apply]
☑ Same as delivery                        │ ✓ MONSOON20 · −₹2,189  ✕
                                          │ ─────────────────
PAYMENT                                   │ Subtotal ₹10,947
( ● ) UPI                                 │ Discount −₹2,189
( ○ ) Card                                │ Shipping      ₹0
( ○ ) Net banking                         │ ─────────────────
┌────────────────────────────────────────┐│ Total     ₹8,758
│ ⚠ Two items changed                    ││
│ HOVR Phantom 3 is now ₹5,559 (was      ││ Free delivery applied
│ ₹5,299). Cool Cat Slide: only 1 left,  ││
│ quantity reduced to 1.                 ││
│ [ I understand, continue ]             ││
└────────────────────────────────────────┘│
                                          │
[            Pay ₹8,758               ]   │
──────────────────────────────────────────┴───────────────────
```

- **Every number in that summary comes from the server.** The browser adds
  nothing up. Not the subtotal, not the discounts, not the total. There is no
  tax row.
- **An item discount and an order discount are different rows.** A per-line
  discount shows against the lines it applies to; a cart-wide one shows once
  against the cart. A single "Discount" row that silently means either is how a
  customer is told the wrong thing about which product was on offer.
- **The revalidation block gates Pay.** Pay stays disabled until "I understand"
  is clicked. It is a block in the flow, not a toast — a toast disappears and
  the customer pays a price they never saw.
- **The countdown is decoration.** The backend rejects on `expires_at` whatever
  the clock says. On expiry the page swaps to a terminal state:
  ```
  ┌────────────────────────────────────────┐
  │  Your checkout expired                 │
  │  Your items are still in your bag.     │
  │  Prices are re-checked on a new        │
  │  checkout.                             │
  │  [ Start checkout again ]              │
  └────────────────────────────────────────┘
  ```
- **Pay disables on click and does not re-enable.** Recovery is a page reload,
  which restores state from `GET /checkout/:id`. Re-enabling after a timeout is
  how you get the double payment the idempotency key then has to catch.
- The idempotency key is generated **once per attempt** and reused across
  retries of that attempt.
- Arriving at a session that is already `COMPLETED` redirects straight to its
  order confirmation. That is the second-tab case, and the backend says
  `CHECKOUT_ALREADY_COMPLETED` rather than letting it pay twice.
- Address cards are radio-selected. "Use a new address" expands the form inline;
  it does not navigate away and lose the session.
- **The coupon field never computes anything.** It posts a code and re-renders
  whatever the server returns. A rejected code shows the server's `reason`
  verbatim — "expired", "minimum spend ₹1,999 not met", "already used" — because
  a bare "invalid coupon" turns every support conversation into guesswork.
- **Applying or removing a coupon re-quotes the whole summary** — shipping
  included, because the free-delivery threshold is tested against the
  discounted total and a coupon can cross it. Re-rendering only the discount
  row produces a total that does not add up.
- The applied coupon is a hold, not a note. It is released if the session
  expires, which is why a customer who abandons checkout can use their
  single-use code again.

## 3.10 Order confirmation and failure

Reached by polling `GET /orders/:orderNumber` while the webhook lands, so the
honest intermediate state is shown, not a fake success:

```
              ┌────────────────────────────────┐
              │            ◐                   │
              │   Confirming your payment      │
              │   This takes a few seconds.    │
              │   Do not close this page.      │
              └────────────────────────────────┘
```

```
──────────────────────────────────────────────────────────────
                          ✓
              Thank you, your order is confirmed

              ORD-1043 · confirmation sent to
              ronik@mail.com
──────────────────────────────────────────┬───────────────────
[▪] Under Armour HOVR Phantom 3           │ DELIVERING TO
    Black / UK 9 · ₹5,559 × 1   ₹5,559    │ Ronik Makwana
[▪] ASICS Japan S Sneaker                 │ 12 MG Road
    White / UK 8 · ₹4,739 × 1   ₹4,739    │ Surat, Gujarat
[▪] Puma Cool Cat Slide                   │ 395007
    Navy / UK 10 · ₹649 × 1       ₹649    │
                                          │ PAYMENT
              Subtotal        ₹10,947     │ UPI
              Shipping            ₹99     │ ₹11,046 captured
              ─────────────────────       │ [ View order ]
              Total           ₹11,046     │
──────────────────────────────────────────┴───────────────────
```

Failure is plain. No red banner, no alarm styling:

```
              ┌────────────────────────────────┐
              │   Payment was not completed    │
              │                                │
              │   Nothing was charged. Your    │
              │   items are still in your bag. │
              │                                │
              │   Your bank declined the       │
              │   transaction.                 │
              │                                │
              │   [ Try again ]                │
              └────────────────────────────────┘
```

"Nothing was charged" is the first line because it is the only thing the
customer wants to know.

## 3.11 Account

```
────────────────┬─────────────────────────────────────────────
Orders          │ Orders
Addresses       │ ──────────────────────────────────────────
Profile         │ ┌───────────────────────────────────────┐
                │ │ ORD-1043    1 Sep 2026    ● Confirmed │
Sign out        │ │ [▪][▪][▪]   3 items         ₹11,046 → │
                │ └───────────────────────────────────────┘
                │ ┌───────────────────────────────────────┐
                │ │ ORD-1038   22 Aug 2026    ● Delivered │
                │ │ [▪]         1 item           ₹4,099 → │
                │ └───────────────────────────────────────┘
```

A list of cards, not a table. Nobody sorts their own order history.

```
← Orders / ORD-1043
● Confirmed · placed 1 Sep 2026
──────────────────────────────────────────────────────────────
  ●─────────●─────────○─────────○─────────○
Confirmed Processing Shipped  Out for   Delivered
                              delivery
──────────────────────────────────────────┬───────────────────
[▪] Under Armour HOVR Phantom 3           │ DELIVERING TO
    Black / UK 9 · SKU UAR-MSPT03-9-BLACK │ Ronik Makwana
    ₹5,559 × 1                  ₹5,559    │ 12 MG Road
[▪] ASICS Japan S Sneaker                 │ Surat 395007
    White / UK 8 · SKU ASC-MSNK01-8-WHITE │
    ₹4,739 × 1                  ₹4,739    │ PAYMENT
                                          │ UPI · ₹11,046
              Subtotal        ₹10,947     │ Paid 1 Sep 14:02
              Shipping            ₹99     │
              Total           ₹11,046     │ [ Need help? ]
──────────────────────────────────────────┴───────────────────
```

**Every row renders `order_items` snapshots.** If the product has since been
renamed or repriced, this page does not follow. That is the whole reason the
snapshot columns exist.

The timeline reads `order_status_history` and shows customer-facing statuses
only — internal notes and the staff member who made the change stay in the
admin.

```
Addresses                                    [ + Add address ]
──────────────────────────────────────────────────────────────
┌──────────────────────┐ ┌──────────────────────┐
│ Home        DEFAULT  │ │ Office               │
│ Ronik Makwana        │ │ Ronik Makwana        │
│ 12 MG Road           │ │ 4th Floor, Ring Road │
│ Surat, Gujarat       │ │ Surat, Gujarat       │
│ 395007               │ │ 395002               │
│ Edit    Delete       │ │ Edit  Delete  Default│
└──────────────────────┘ └──────────────────────┘
```

Profile is two cards: name and email in one, password change in the other.
Changing email re-triggers verification.

## 3.12 Empty, loading and error states

Every one of these is a real screen, not an afterthought:

| Where | State |
|---|---|
| Cart | "Your bag is empty" + Continue shopping |
| Wishlist | "Nothing saved yet" + link to new arrivals |
| Orders | "No orders yet" + link to men/women/kids |
| Category | "No products match these filters" + the active filters + Clear all |
| Collection | "This collection is empty right now" + link to its parent area |
| Search | "No results for X" + category suggestions |
| Reviews | "No reviews yet. Be the first." |
| 404 | short line, link back, popular categories below |
| Route error | retry button, never a white screen |

Skeletons match the shape of what loads: product grid skeletons are cards,
the PDP is a gallery block plus a buy-box block, order lists are cards. A
centred spinner for a page that is 80% grid is a layout shift waiting to
happen.

## 3.13 Mobile

Not a separate design, but these five differ enough to spec:

- Nav drawer drills one level at a time
- Filter sidebar becomes a bottom sheet with Apply
- Cart drawer becomes a full-screen sheet
- PDP gallery swipes horizontally with dots instead of a thumbnail strip —
  five thumbnails at a tappable size do not fit a 390px column — and a sticky
  bottom bar with price and Add to bag takes over once the real one scrolls off
- Checkout summary collapses to a tappable "3 items · ₹11,046 ▼" bar at the top

Hit targets never below 44px. Most of the traffic is phones.

## 3.14 Front-end obligations

Every rule in `ecommerce_frontend_backend_rules.md` that the browser has to
honour, gathered so it can be checked at review time. Each is specified in place
on its screen above; this is the index, not a second source of truth.

| Rule | Obligation | Screen |
|---|---|---|
| §5, §21 | Never compute or send money. Subtotal, item discount, order discount, shipping and total are rendered, never derived | 3.6, 3.9 |
| §5, §17 | Send `{ variantId, quantity }` only. Never a price | 3.5, 3.6 |
| §12 | Never set order status from a payment callback. Read it from `GET /orders/:orderNumber` | 3.10 |
| §13 | Disable the pay button on click, and do not re-enable it on a timer | 3.9 |
| §16 | Make the customer acknowledge a changed cart before pay re-enables | 3.6, 3.9 |
| §17 | Constrain quantity in the UI, but treat the server's answer as final | 3.6 |
| §10, §26 | After a payment, poll the order. Never assume failure from a missing response | 3.10 |
| §25 | A session already `COMPLETED` redirects to its confirmation, it does not offer pay | 3.9 |
| §26 | Every checkout and payment screen restores from a GET. No GET creates anything | 3.9, 3.10 |
| §27 | Back re-reads; it never re-posts and never means "cancel" | 3.9, 3.10 |
| §2 | The expiry countdown is decoration. The terminal state comes from the server | 3.9 |
| §20 | The coupon field posts a code and renders the response. It calculates nothing | 3.9 |
| §22 | Never rely on hiding a control for access control | all |

Two habits that cause most of the violations above, worth naming:

- **Optimistic UI is fine for a cart badge and wrong for money.** Incrementing a
  quantity in place while the request flies is good. Adding ₹649 to a displayed
  total is how the customer sees a number the server never agreed to.
- **`redirect` params are validated before use.** Must start with `/` and not
  `//`, or you have shipped an open redirect on your login page.

---

## 3.15 Routes

```
/                              /search
/c/:slug                       /p/:slug
/collections                   /collections/:slug
/cart                          /wishlist
/login  /register  /forgot-password  /reset-password  /verify-email
/checkout                      guarded
/checkout/failed
/order/:orderNumber            guarded
/account/orders                /account/orders/:orderNumber
/account/addresses             /account/profile
/403  /404
```

---

# Build order

1. `shop.routes.ts`, `serializers/shop/`, `schemas/shop/`, customer auth.
   `apps/storefront` scaffold, shadcn, tokens, `ShopLayout`, `AuthLayout`,
   api-client with the refresh interceptor, `RequireAuth`.
2. Product detail. Start here, not the home page — it exercises media,
   attributes, options, variants and inventory in one screen.
3. Category **and collections**, facets, filters, search. Facets are the hard
   part. A collection page is this same grid with `?collection=` instead of
   `?category=`, so it is built here — splitting them across phases is how the
   two end up with separate product queries that drift.
4. Cart and wishlist, public, with hydrate and merge-on-auth.
5. **Migration:** `checkout_sessions`, `checkout_items`,
   `inventory_reservations`, `reviews`, `payments.idempotency_key`,
   `coupons` + `coupon_redemptions`, and `order_items.discount_amount`.
6. Checkout: addresses → session + reservation → **money (item discount, order
   discount, shipping) before any payment code**, because every screen
   downstream renders its output → payment with idempotency → webhook + transactional order
   creation → expiry sweep and reconciliation → the UI last, once the states it
   has to render actually exist.
7. Account: orders, order detail, addresses, profile.
8. Reviews.
9. Home. Assembled entirely from components that already exist.
10. SEO, skeletons, mobile pass, error boundaries.

Steps 1 to 4 give you a browsable store. Step 6 is where the money is and where
every bug costs something real — budget more than it looks like it needs.

Then return to `shoe-admin-final-spec.md` steps 7 and 8, now against orders that
actually exist.

---

# Rules that hold on every screen

**The backend is the authority for price, stock, order state, payment and
ownership.** The frontend improves the experience of those facts; it never
decides them.

**Never send a raw stock number to a customer.** Buckets only.

**Prices are re-read from the database at checkout time**, whatever the cart
said. The cart is a wish, the checkout session is a quote, the order is a
commitment.

**Storefront serializers are never shared with admin.** A shared response shape
is how a draft variant and a `reserved_quantity` reach a public page.

**Every stock write is a transaction with a ledger row.** Reserve, release,
sell, return. No exceptions.

**Refresh, back, and a second tab are all normal.** Every checkout and payment
screen restores from a GET and creates nothing.

**Adding to cart reserves nothing.** Otherwise filling carts is a free denial
of service on your own inventory.


---

# Appendix — rule coverage

Traceability against `ecommerce_frontend_backend_rules.md`. All 27 rules are
specified above; this maps each to where. Front-end obligations are indexed
separately in §3.14.

| § | Rule | Where it is enforced |
|---|---|---|
| 1 | Inventory reservation with TTL | `inventory_reservations`, §1.2 · `POST /checkout` step 2–4 |
| 2 | Checkout expiry | `checkout_sessions.expires_at` · §1.3 lazy + sweep |
| 3 | Inventory race conditions | conditional `UPDATE` + affected-rows check, `POST /checkout` step 2 |
| 4 | Cart does not reserve | §3.5, and the closing rules |
| 5 | Price validation | API conventions — a `price` in the body is ignored, not echoed |
| 6 | Price changes during checkout | `checkout_items.unit_price` snapshot |
| 7 | Duplicate payment / idempotency | `payments.idempotency_key` unique · `POST /payments` |
| 8 | Webhook is source of truth | `POST /api/webhooks/payments/:provider` |
| 9 | Payment timeout | `PAYMENT_PENDING` held · reconciliation table, PART 2 Payments |
| 10 | Payment succeeded, frontend missed it | §3.10 "Confirming your payment" poll on `GET /orders/:orderNumber` |
| 11 | Order state machine | §1.4 transition allow-list |
| 12 | Frontend does not decide order status | §1.4 · §3.10 |
| 13 | Prevent double clicks | §3.9 — Pay disables and does not re-enable |
| 14 | Transactional order creation | webhook transaction, PART 2 Payments |
| 15 | Database unique constraints | §1.2 and §1.5 — `idempotency_key`, `(provider, provider_payment_id)`, `order_number`, `(session, variant)` |
| 16 | Cart revalidation at checkout | `POST /checkout` step 1 · §3.6 stale-cart rows · §3.9 revalidation block |
| 17 | Quantity validation | `POST /checkout` step 1 — `>= 1`, `<= max_allowed`, `<= available` |
| 18 | Archive, never hard delete | non-`ACTIVE` is a 404 · order item snapshots |
| 19 | Order price snapshots | `checkout_items` → `order_items`, incl. per-line `discount_amount` |
| 20 | Coupon validation | `coupons` + `coupon_redemptions`, §1.2 · `POST /checkout/:id/coupon` · §3.9 |
| 21 | Tax and shipping calculation | **no tax by decision** · one flat shipping rate from settings, applied server-side · `POST /checkout` step 6 |
| 22 | Authentication and authorization | API conventions — ownership checked on every authed read |
| 23 | Checkout ownership | `GET /checkout/:id` returns 403, not 404 |
| 24 | Expired reservation cleanup | §1.3 — lazy on read **and** cron sweep |
| 25 | Multiple browser tabs | `CHECKOUT_ALREADY_COMPLETED` · §3.9 redirect to confirmation |
| 26 | Refresh safety | `GET /checkout/:id` restores; no GET creates anything |
| 27 | Browser back button | same as §26 — back re-reads, never re-posts |

**Closed gaps, and what closing them cost:**

- **§20** brought coupons in properly. The one to get right is the atomic
  `used_count` increment — a single-use coupon under concurrent checkout is the
  same race as the last pair of shoes, and it has the same answer.
- **§21** is satisfied by computing money **server-side**, which is what the
  rule actually requires. **Tax is deliberately not charged at all** — no rate,
  no row, no column on the checkout session. `orders.tax_amount` survives from
  the admin build at `0` because dropping it is a migration for no gain. Also
  deliberately not built: rate tables, zones, price bands, HSN codes. One flat
  shipping rate with a free-above threshold in store settings. Add tax and
  rules later if the business needs them; do not carry the machinery before
  then.
- **§19** adds `discount_amount` and `order_discount_allocated` to
  `order_items`, a table the admin build already defines.
  `shoe-admin-final-spec.md` is stale by those two columns.
- **§9** reconciliation is now a table of five provider answers and what each
  one means. Its single rule: reconciliation and the webhook call the same
  function.

**One thing still open, and it is not a rules-doc gap:**

- **Guest checkout is not supported.** `checkout_sessions.user_id` is not
  nullable and §22–§23 are specified in terms of an authenticated owner. A
  deliberate simplification, not an oversight; supporting guests later means an
  email-keyed session and a different ownership rule.

Front-end obligations are indexed in **§3.14**, with each one specified in place
on the screen that has to honour it.

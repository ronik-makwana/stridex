# StrideX — Platform Spec

**The data model and the HTTP surface, for the whole platform.** This is the
merge of what were `shoe-admin-final-spec.md` and `shoe-storefront-final-spec.md`,
with every screen, layout and interaction note removed: those two documents were
half UI, and the UI is built. What survives is the half that is still consulted
daily — what the tables are, why each column exists, and what every endpoint is.

Postgres + Prisma + Node.js (Express) + Vite React SPA (storefront) + Next.js
(admin) + S3/MinIO. Redis is required — it backs the rate-limit counters and the
BullMQ job queue.

**Authority.** `packages/db/prisma/schema.prisma` is the truth about columns,
types and cascade rules, and it is heavily commented; this document is the map,
not the territory. `ecommerce_frontend_backend_rules.md` holds the 27 rules the
build is measured against, and the `§n` references below point at it.
`repo-structure.md` says where the code lives.

---

# PART 1 — DATABASE

## 1.1 Conventions

| Decision | Choice | Why |
|---|---|---|
| Primary keys | `uuid` with `gen_random_uuid()` | safe to expose in URLs, no enumeration |
| Timestamps | `timestamptz`, `created_at` + `updated_at` | store UTC, format in the client |
| Money | `Decimal(12,2)` + `currency` on the order | INR, no float arithmetic anywhere |
| Minor units | only at the provider boundary | paise cross into Razorpay and back; nowhere else |
| Deletes | no soft delete, `status` enum instead | `ARCHIVED` covers the real need, deletes are blocked by FKs |
| Enums | Postgres enums via Prisma | catches typos at the DB, not in a service |
| Slugs | unique per table, generated from name | a slug is a URL forever |
| Columns | `snake_case` in the DB, `camelCase` in the client | `@map` on every field |
| JSON | `collection_rules.value`, `*_items.variant_options`, `payment_transactions.metadata`, `payments.provider_response`, `refunds.provider_response` | everything else is columns |

Status vocabulary is shared: `EntityStatus` = `DRAFT | ACTIVE | ARCHIVED`, on
brands, categories, products, variants, collections, coupons and testimonials.

**There is no tax.** `orders.tax_amount` exists, is written `0`, and is never
rendered. It is a column waiting for a rate table; nothing computes against it,
and no other table carries one.

**Shipping is a setting plus a static table, not a rate matrix.** Three delivery
methods live in `modules/checkout/shipping.methods.ts` as code; the flat rate and
the free-above threshold live in the one-row `store_settings`.

## 1.2 Tables

### Auth and identity

```
users                     id, email✦, password_hash, first_name, last_name, phone,
                          role[ADMIN|STAFF|CUSTOMER], status[ACTIVE|SUSPENDED],
                          email_verified_at, created_at, updated_at

user_sessions             id, user_id→users, refresh_token_hash✦, user_agent,
                          ip_address, expires_at, revoked_at, created_at

password_reset_tokens     id, user_id→users, token_hash✦, expires_at, used_at, created_at

email_verification_tokens id, user_id→users, token_hash✦, expires_at, used_at, created_at

addresses                 id, user_id→users, full_name, phone, address_line_1,
                          address_line_2, city, state, country, postal_code,
                          is_default, created_at, updated_at
```

The two token tables have the same shape and are deliberately not merged behind a
`purpose` column: they have different lifetimes, and one table would mean every
reset lookup carries a filter that a missed `WHERE` turns into a verification
link that resets a password.

Only hashes are stored — of refresh tokens and of both kinds of link token.

### Catalog

```
brands      id, name, slug✦, logo_url, status, created_at, updated_at

categories  id, name, slug✦, description, parent_id→categories,
            level, position, status, created_at, updated_at
```

`level` and `position` are derived server-side. Nothing references a category
except `products.category_id` and the coupon scoping join — a category is a label
on a product, and it binds neither attributes nor variant options.

### Attributes (global)

```
attributes        id, name, slug✦, type[TEXT|NUMBER|BOOLEAN|SELECT|MULTI_SELECT],
                  unit, is_filterable, is_suggested, position, timestamps

attribute_values  id, attribute_id→attributes, value, slug, position, created_at
                  unique(attribute_id, slug)
```

`is_suggested` means "pre-add this row on a new product form". It is a default,
not a constraint.

### Variant options (global)

```
variant_options        id, name, slug✦, position, timestamps

variant_option_values  id, variant_option_id→variant_options, value, slug,
                       swatch_hex, position, created_at
                       unique(variant_option_id, slug)
```

`swatch_hex` is what a colour picker renders in both apps.

### Products

```
products                    id, brand_id→brands, category_id→categories, title,
                            slug✦, description, status, published_at, timestamps

product_media               id, product_id→products, url, alt_text,
                            type[IMAGE|VIDEO], sort_order, created_at

product_attributes          id, product_id→products, attribute_id→attributes,
                            attribute_value_id→attribute_values (nullable),
                            value_text, value_number, value_boolean,
                            position, created_at
                            unique(product_id, attribute_id, attribute_value_id)

product_variant_options     id, product_id→products, variant_option_id→variant_options,
                            position, created_at
                            unique(product_id, variant_option_id)

product_variants            id, product_id→products, media_id→product_media,
                            sku✦, barcode, price, compare_at_price,
                            position, status, timestamps

variant_option_assignments  variant_id→product_variants,
                            option_value_id→variant_option_values
                            pk(variant_id, option_value_id)
```

Exactly one value column on `product_attributes` is populated, decided by
`attribute.type`. `MULTI_SELECT` is why `attribute_value_id` is in the unique
key: several rows per attribute is how multiple values are stored.

`product_variant_options` is what records which options a product uses and in
what order — without it you cannot label Option 1 and Option 2, because nothing
comes down from the category.

### Tags

```
tags          id, name, slug✦, created_at
product_tags  product_id→products, tag_id→tags   pk(product_id, tag_id)
```

Free-form labels, created by typing them on a product rather than from a screen
of their own. `slug` is what makes two spellings one tag; `name` keeps whichever
casing was typed first.

### Collections

```
collections          id, name, slug✦, description, image_url,
                     type[MANUAL|DYNAMIC], match_type[ALL|ANY], status, timestamps

collection_products  collection_id, product_id, position   pk(collection_id, product_id)

collection_rules     id, collection_id→collections, field, operator,
                     value jsonb, group_id, created_at
```

Rule fields: `category`, `brand`, `price`, `title`, `sku`, `stock`, `created_at`,
and `attribute:{attributeId}`. Operators per field type: `is`, `is_not`,
`contains`, `greater_than`, `less_than`, `is_empty`. The same rules engine that
resolves a dynamic collection also resolves a product discount's scope.

### Inventory

```
inventories             id, variant_id→product_variants✦, quantity,
                        reserved_quantity, low_stock_threshold, timestamps

inventory_transactions  id, inventory_id→inventories,
                        type[RESTOCK|SALE|RESERVATION|RELEASE|RETURN|ADJUSTMENT],
                        quantity, reference_type, reference_id, note,
                        created_by_user_id, created_at
```

Available stock is `quantity - reserved_quantity`, computed, never stored. Every
write to `inventories.quantity` happens inside a transaction that also writes an
`inventory_transactions` row — no exceptions, or the ledger stops being
trustworthy.

Reservations are taken with a conditional update, never a `SELECT` then an
`UPDATE`:

```sql
UPDATE inventories
   SET reserved_quantity = reserved_quantity + $qty
 WHERE variant_id = $id
   AND quantity - reserved_quantity >= $qty
```

Affected rows 1 → held. 0 → `OUT_OF_STOCK` for that line.

### Cart and wishlist

```
carts / cart_items          one cart per user, unique(cart_id, variant_id)
wishlists / wishlist_items  one wishlist per user, unique(wishlist_id, product_id)
```

Neither reserves stock (§4). A guest's bag lives in `localStorage` and is priced
by the `hydrate` endpoints; it becomes rows on login or register, via `merge`.

### Reviews

```
reviews  id, product_id→products, user_id→users, rating (1–5), body,
         status[PUBLISHED|HIDDEN], created_at, updated_at
         unique(product_id, user_id)
```

No `verified_purchase` column: it is derived per query — does this user have a
`PAID` order containing a variant of this product. Storing it means keeping it
true forever, and a refund or chargeback falsifies it with nothing to go back and
fix it.

No denormalised rating average on `products` either. The average is one grouped
query per page; a stored column drifts the first time a moderator hides a review.

`HIDDEN` reviews are invisible to everyone except their author, who still sees
their own — otherwise they write it again and hit the unique constraint with no
explanation.

### Orders

```
orders                id, user_id→users (SET NULL), order_number✦,
                      status[PENDING|PROCESSING|SHIPPED|DELIVERED|CANCELLED|REFUNDED],
                      payment_status[PENDING|PAID|PARTIALLY_REFUNDED|REFUNDED|FAILED],
                      subtotal, discount_amount, shipping_amount, shipping_discount,
                      shipping_method, tax_amount, total_amount, currency,
                      placed_at, delivered_at, confirmation_sent_at, timestamps

order_items           id, order_id→orders, variant_id (nullable, SET NULL),
                      product_title, sku, variant_options jsonb,
                      unit_price, quantity, total_price,
                      discount_code, discount_amount, order_discount_allocated,
                      created_at

order_addresses       id, order_id→orders, type[SHIPPING|BILLING],
                      full name and address fields    unique(order_id, type)

order_status_history  id, order_id→orders, from_status, to_status,
                      changed_by_user_id→users, note, created_at
```

`payment_status` is denormalised from `payments` so the order list can filter and
sort without a join per row. The payments table stays the source of truth, and
the webhook updates both in one transaction.

`order_items.variant_id` is nullable with `ON DELETE SET NULL`: the snapshot
columns are what the order actually needs, and the FK is there for reporting.

`delivered_at` is derivable from `order_status_history` and denormalised anyway,
because the return window is counted from it on every order read. It is rewritten
by the transition rather than written once, since `DELIVERED` can be corrected
back to `SHIPPED`.

`confirmation_sent_at` closes the gap between the order transaction committing
and its confirmation email being queued: a sweep finds `PAID` orders past a grace
period with this still null and queues them. It is the cheap half of a
transactional outbox, without the table or the poller.

### Checkout

```
checkout_sessions       id, user_id→users,
                        status[ACTIVE|PAYMENT_PENDING|COMPLETED|EXPIRED|CANCELLED],
                        expires_at,
                        subtotal, discount_amount, shipping_amount,
                        shipping_discount, shipping_method,
                        total_amount, currency,
                        shipping_address_id→addresses (SET NULL),
                        billing_address_id→addresses (SET NULL),
                        order_id→orders✦ (null until the webhook lands),
                        created_at, updated_at

checkout_items          id, checkout_session_id→checkout_sessions,
                        variant_id→product_variants,
                        product_title, sku, variant_options jsonb,
                        unit_price, quantity, total_price,
                        discount_code, discount_amount, order_discount_allocated,
                        created_at
                        unique(checkout_session_id, variant_id)

inventory_reservations  id, checkout_session_id→checkout_sessions,
                        variant_id→product_variants, quantity,
                        status[ACTIVE|RELEASED|EXPIRED|CONSUMED],
                        expires_at, created_at, updated_at
                        unique(checkout_session_id, variant_id)
```

**Checkout does not create the order.** A cart is a wish and an order is a fact;
the session is the ten minutes in between, during which stock is actually held
and a price is actually promised. The **webhook** creates the order once payment
is confirmed (§8).

- **`expires_at`** is the only thing standing between an abandoned tab and
  permanently held stock. Ten minutes. The countdown the UI draws is decoration;
  this column is the authority.
- **`checkout_items.unit_price`** is the price snapshot. A product can be
  repriced while a customer is paying: payment charges the snapshot, and an
  expired session gets a fresh quote at current prices.
- **`product_title` / `sku` / `variant_options`** carry forward into `order_items`
  verbatim, which is what lets an order render years later without joining to a
  product that has since been renamed, recategorised or archived (§19).
- **`inventory_reservations` is a row, not a counter.**
  `inventories.reserved_quantity` says *how much* is held; only a row says *by
  whom* and *until when*, which is what lets a sweep release exactly the
  abandoned ones.
- **`checkout_items.variant` cascades; `inventory_reservations.variant`
  restricts.** A session is ten minutes of intent and must not block an admin
  deleting a variant. A reservation is the record of stock taken out of
  circulation, and deleting the variant under it would leave `reserved_quantity`
  holding units nothing explains.

### Coupons and discounts

```
coupons             id, code✦ (upper-case), description,
                    kind[PRODUCT|ORDER|SHIPPING], type[PERCENT|FIXED|FREE_SHIPPING],
                    value, min_cart_value, max_discount_amount,
                    starts_at, ends_at, usage_limit, per_user_limit, used_count,
                    status,
                    applies_to[PRODUCTS|CATEGORIES|COLLECTIONS] (PRODUCT kind only),
                    eligibility[ALL_CUSTOMERS|SPECIFIC_CUSTOMERS],
                    min_requirement[NONE|PURCHASE_AMOUNT|ITEM_QUANTITY], min_quantity,
                    max_shipping_amount (SHIPPING kind only),
                    combines_with_product, combines_with_order, combines_with_shipping,
                    timestamps

coupon_products     coupon_id, product_id     pk
coupon_categories   coupon_id, category_id    pk
coupon_collections  coupon_id, collection_id  pk
coupon_customers    coupon_id, user_id        pk

coupon_redemptions  id, coupon_id→coupons, user_id→users,
                    checkout_session_id→checkout_sessions,
                    order_id→orders (null until confirmed), discount_amount,
                    status[ACTIVE|RELEASED|EXPIRED|CONSUMED], timestamps
                    unique(coupon_id, order_id)
```

- **Scoping is empty by default.** A coupon with no rows in any of the four join
  tables applies to the whole catalog. Rows narrow it. A chosen category covers
  its descendants, because products sit on leaves.
- **`used_count` is incremented atomically** and checked by affected rows:
  `UPDATE coupons SET used_count = used_count + 1 WHERE id = $1 AND (usage_limit
  IS NULL OR used_count < usage_limit)`. Two customers racing for the last use of
  a coupon is the same problem as two racing for the last pair of shoes.
- **`coupon_redemptions` mirrors `inventory_reservations`**, with the same
  `HoldStatus` enum and the same lifecycle: *held* when the code is applied,
  *consumed* when the webhook confirms, *released* when the session expires or
  fails. Without the hold, a single-use code is spent by two people who both have
  it open. `unique(coupon_id, order_id)` is the belt to that braces — Postgres
  treats NULLs as distinct, so open holds are unaffected.
- **`combines_with_*` is three flags, not a table of pairs.** There are exactly
  three kinds, and a join to answer a yes/no question is not worth owning.
- **Discounts exist at two levels and both are stored.** Per-line
  `discount_amount` is the item discount — a coupon restricted to one brand
  discounts two lines out of four, and the order has to record which.
  `discount_amount` on the session or order is the order-wide discount.
- **`order_discount_allocated` splits the order discount back across the lines**
  by largest remainder, so the shares sum to exactly the order discount. ₹100
  over three lines is 33.34 / 33.33 / 33.33, and the stray paisa must land
  somewhere deterministic — at refund time it is far too late to decide where.
- **A catalog markdown is not a discount line.** `compare_at_price` against
  `price` is already inside `unit_price`; it renders as a strikethrough and never
  appears in the summary as a deduction.
- A line takes the best single code that applies to it, never two.

### Testimonials and settings

```
testimonials    id, quote, author_name, author_role, rating, image_url,
                status, position, timestamps

store_settings  id = 'store' (one row),
                shipping_flat_rate, free_shipping_threshold, return_window_days,
                updated_at
```

A testimonial is merchandising — a quote somebody chose to put on the front page
— and deliberately not a product review. Sourcing one from the other would let a
shop promote a five-star review without asking, and could never quote anything
that did not arrive through the review form.

`return_window_days` is read at request time, never stamped onto an order: a
window that shortened must not retroactively close a return somebody was already
entitled to raise yesterday.

### Payments

```
payments              id, order_id→orders (nullable), checkout_session_id→checkout_sessions
                      (SET NULL), provider, provider_payment_id,
                      amount, currency,
                      status[PENDING|AUTHORIZED|CAPTURED|FAILED|REFUNDED|VOIDED],
                      method, idempotency_key✦, provider_response jsonb, timestamps
                      unique(provider, provider_payment_id)

payment_transactions  id, payment_id→payments,
                      type[AUTHORIZATION|CAPTURE|REFUND|VOID], amount,
                      provider_transaction_id, metadata jsonb, created_at
```

- `order_id` is null between the attempt and the webhook — that window is the
  whole reason this table can stand alone. `checkout_session_id` is how a webhook
  arriving with only a provider id finds its way home.
- `unique(provider, provider_payment_id)` is the webhook idempotency guard.
  Providers retry, and without it captures get double-counted.
- `idempotency_key` unique is the double-click guard. A disabled button is UX;
  this index is correctness. It is nullable because rows written by the webhook
  or by reconciliation have no client key.

### Refunds

```
refund_requests       id, order_id→orders, user_id→users,
                      type[CANCELLATION|RETURN],
                      status[REQUESTED|APPROVED|REJECTED|WITHDRAWN|RECEIVED|COMPLETED],
                      reason[CHANGED_MIND|WRONG_SIZE|DAMAGED|NOT_AS_DESCRIBED|
                             WRONG_ITEM|LATE_DELIVERY|OTHER],
                      comment, estimated_amount,
                      decided_by_user_id→users (SET NULL), decided_at, decision_note,
                      received_at, timestamps

refund_request_items  id, request_id→refund_requests, order_item_id→order_items (RESTRICT),
                      quantity, amount,
                      restocked_quantity, unsellable_quantity, timestamps
                      unique(request_id, order_item_id)

refunds               id, order_id→orders, payment_id→payments (RESTRICT),
                      request_id→refund_requests (SET NULL, null for discretionary),
                      amount, currency, status[PENDING|PROCESSING|SUCCEEDED|FAILED],
                      reason, note, provider, provider_refund_id,
                      idempotency_key✦, initiated_by_user_id→users (SET NULL),
                      failure_reason, provider_response jsonb, timestamps
                      unique(provider, provider_refund_id)

refund_items          id, refund_id→refunds, order_item_id→order_items (RESTRICT),
                      quantity, amount, created_at
                      unique(refund_id, order_item_id)
```

**The split between a request and a refund is the whole design.** A request is a
conversation: raised, approved or rejected, a parcel waited for. A refund is an
amount at a provider, which either settled or did not. One table would make a
rejected request and a failed refund the same row, and "we said no" would stop
being distinguishable from "the bank said no".

- A **cancellation** is a promise not yet kept — nothing has shipped, so it is
  self-serve and refunds in full, writing a request already `RECEIVED` in the
  same transaction. A **return** is a promise kept and then undone: a parcel
  exists, somebody has to receive it back, and only then does money move.
- `RECEIVED` is the only status that has ever moved stock, and it is what stops a
  second click restocking the same pair twice.
- `restocked_quantity` and `unsellable_quantity` are what make receiving a parcel
  idempotent *and* partial: two of three pairs arrived today, the third next week.
- `refund_items` is a copy of the request's lines, not a pointer to them: a refund
  can be issued with no request at all, and an approval may refund fewer units
  than were asked for. This is the breakdown a credit note has to print years
  later.
- Line amounts are split from the snapshot columns on `order_items` — its own
  discount and its share of the order-wide one, both already allocated at
  checkout precisely so this is not a re-derivation.
- **Nothing but a webhook writes `SUCCEEDED`.** A refund this service believed in
  that the provider never made is the same failure as an order with no payment
  behind it (§8, §12).

## 1.3 Relationships

```
USER ──┬── USER_SESSION
       ├── PASSWORD_RESET_TOKEN / EMAIL_VERIFICATION_TOKEN
       ├── ADDRESS
       ├── CART ── CART_ITEM ──→ VARIANT
       ├── WISHLIST ── WISHLIST_ITEM ──→ PRODUCT
       ├── REVIEW ──→ PRODUCT
       ├── CHECKOUT_SESSION ──┬── CHECKOUT_ITEM ──→ VARIANT
       │                      ├── INVENTORY_RESERVATION ──→ VARIANT
       │                      ├── COUPON_REDEMPTION ──→ COUPON
       │                      └── PAYMENT
       └── ORDER ──┬── ORDER_ITEM ──→ VARIANT (nullable)
                   ├── ORDER_ADDRESS
                   ├── ORDER_STATUS_HISTORY
                   ├── PAYMENT ── PAYMENT_TRANSACTION
                   ├── REFUND_REQUEST ── REFUND_REQUEST_ITEM ──→ ORDER_ITEM
                   └── REFUND ── REFUND_ITEM ──→ ORDER_ITEM

CATEGORY ──(self)── CATEGORY          BRAND
     └──────────────┬───────────────────┘
                    ↓
                 PRODUCT
                    ├── PRODUCT_MEDIA
                    ├── PRODUCT_ATTRIBUTE ──→ ATTRIBUTE ── ATTRIBUTE_VALUE
                    ├── PRODUCT_VARIANT_OPTION ──→ VARIANT_OPTION ── OPTION_VALUE
                    ├── PRODUCT_TAG ──→ TAG
                    ├── PRODUCT_VARIANT
                    │        ├── VARIANT_OPTION_ASSIGNMENT ──→ OPTION_VALUE
                    │        └── INVENTORY ── INVENTORY_TRANSACTION
                    └── COLLECTION_PRODUCT ──→ COLLECTION ── COLLECTION_RULE

COUPON ──┬── COUPON_PRODUCT / COUPON_CATEGORY / COUPON_COLLECTION
         ├── COUPON_CUSTOMER ──→ USER
         └── COUPON_REDEMPTION ──→ CHECKOUT_SESSION, ORDER

TESTIMONIAL   STORE_SETTINGS        standalone
```

Attributes and variant options hang off products only.

## 1.4 The checkout lifecycle

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
     │                       cart cleared, confirmation queued
     │
     ├── webhook FAILED ───→ CANCELLED
     │                       reservations + coupon RELEASED, stock back
     │
     └── expires_at passed ─→ EXPIRED
                             reservations + coupon EXPIRED, stock back
```

Expiry happens two ways and needs both: **lazily**, whenever a session is read
past `expires_at`, and on a **cron sweep** for the sessions nobody comes back to.
A sweep alone means a customer can pay against a session that expired 40 seconds
ago.

The money is computed server-side, in this order, because each step feeds the
next:

```
line_total     = unit_price × quantity            from the snapshots
subtotal       = Σ line_total
item_discount  = Σ checkout_items.discount_amount      per eligible line
order_discount = cart-wide discount, capped at (subtotal − item_discount)
shipping       = the chosen method's rate; STANDARD is waived when
                 (subtotal − item_discount − order_discount) >= free_above
total          = subtotal − item_discount − order_discount + shipping
```

There is no tax step. `total` can never fall below `shipping`, which is what the
cap on `order_discount` is for. The free-shipping threshold is tested against the
**discounted** goods total, or a coupon quietly buys free delivery too — and only
`STANDARD` is waivable, because "free delivery over ₹1,999" is a promise about
the slow van.

## 1.5 Order state machine

`status` and `payment_status` are separate fields because fulfilment and payment
answer different questions and get filtered separately. Every write goes through
a transition allow-list in the service, and an illegal transition **throws** — it
does not silently no-op.

```
payment_status   PENDING ──→ PAID ──→ PARTIALLY_REFUNDED ──→ REFUNDED
                     └────→ FAILED

status           PENDING ──→ PROCESSING ──→ SHIPPED ──→ DELIVERED
                     │            │                        │
                     └────────────┘                        ↓
                          ↓                             REFUNDED
                      CANCELLED
```

Allowed: `PENDING → PROCESSING | CANCELLED`, `PROCESSING → SHIPPED | CANCELLED`,
`SHIPPED → DELIVERED`, `DELIVERED → REFUNDED`.

Rejected, and these are the ones the allow-list exists for: `DELIVERED →
PROCESSING`, anything out of `CANCELLED`, and any fulfilment progress on an order
whose `payment_status` is still `PENDING`.

**Naming, because it will confuse someone:** the rules doc's lifecycle is
`CREATED → PAYMENT_PENDING → CONFIRMED → …`. Here the first two states live on
the **checkout session**, not the order — an order row does not exist until
payment is confirmed. So `orders.status = PENDING` is the rules doc's
`CONFIRMED`: paid, awaiting fulfilment. There is no order in any other state,
which is what makes "payment succeeded but no order" impossible rather than
merely unlikely.

**The storefront never writes either field.** They are written by the webhook and
by the admin.

## 1.6 Refund state machine

```
refund_requests   REQUESTED ──→ APPROVED ──→ RECEIVED ──→ COMPLETED
                      │  └────→ REJECTED
                      └───────→ WITHDRAWN        by the customer

                  a CANCELLATION is written straight to RECEIVED, in the
                  transaction that cancels the order

refunds           PENDING ──→ PROCESSING ──→ SUCCEEDED
                                   └───────→ FAILED
```

The two run independently on purpose: a request can be `RECEIVED` while its money
is still `PROCESSING` at the provider, and the pair must be able to say so.

## 1.7 Indexes worth having

```
users                   (role, status), (created_at), GIN trigram on email
brands                  (status, name), GIN trigram on name
products                (status, created_at), (brand_id), (category_id)
                        GIN trigram on title
product_variants        (product_id, position), unique(sku), GIN trigram on sku
product_attributes      (attribute_id, attribute_value_id)   ← facets, dynamic collections
product_variant_options (product_id, position)
categories              (parent_id, position), (status)
collection_products     (collection_id, position)
inventories             unique(variant_id)
inventory_transactions  (inventory_id, created_at)
reviews                 (product_id, status, created_at), (user_id, created_at)
orders                  (status, created_at), (payment_status), (user_id, created_at)
                        (payment_status, confirmation_sent_at)   ← the mail sweep
order_items             (order_id)
checkout_sessions       (user_id, created_at), (status, expires_at)   ← the sweep
inventory_reservations  (status, expires_at), (variant_id, status)
coupons                 unique(code), (kind, status), (status, ends_at)
coupon_redemptions      (coupon_id, user_id), (status, created_at)
payments                unique(provider, provider_payment_id), unique(idempotency_key),
                        (status, created_at), (order_id), (checkout_session_id)
refund_requests         (status, created_at), (order_id, created_at), (user_id, created_at)
refunds                 unique(idempotency_key), unique(provider, provider_refund_id),
                        (status, created_at), (payment_id), (request_id)
```

The facet query is the slowest thing on the site, and
`product_attributes (attribute_id, attribute_value_id)` is the reason it is not
slower. Partial indexes live in raw SQL under `packages/db/prisma/sql/` — Prisma
cannot see them in a diff, and an index it cannot see is one it generates a DROP
for on the next `migrate dev`.

---

# PART 2 — API

## 2.0 Shared conventions

Three trees, mounted in `app.ts`:

```
/api/admin/*        signed-in ADMIN or STAFF
/api/storefront/*   public by default; the auth wall is per feature router
/api/webhooks/*     unauthenticated, signature-verified
```

**Envelope.** List endpoints take `?page=&limit=&sort=` plus their own filters
and return `{ data, meta: { page, limit, total, totalPages } }`, with
`totalPages` at least 1. Mutations return the full updated entity.

**Errors.** `{ error: { code, message, fields?, reason? } }`. The shared codes are
`BAD_REQUEST` 400, `UNAUTHORIZED` / `INVALID_CREDENTIALS` 401, `FORBIDDEN` 403,
`NOT_FOUND` 404, `CONFLICT` 409 (slug and SKU collisions), `UNPROCESSABLE` 422
(a delete blocked by references, carrying a `reason`), `TOO_MANY_REQUESTS` 429.

Storefront-specific codes, which the UI branches on, are the single list in
`schemas/shop/common.schema.ts` and are mirrored in the client's `ShopErrorCode`
union; the two are kept in step by hand:

```
OUT_OF_STOCK            PRICE_CHANGED           PRODUCT_UNAVAILABLE
CHECKOUT_EXPIRED        CHECKOUT_ALREADY_COMPLETED
QUANTITY_EXCEEDED       COUPON_INVALID
ORDER_NOT_CANCELLABLE   REFUND_ALREADY_REQUESTED   RETURN_WINDOW_CLOSED
```

**Auth.** Access token in a header, refresh token as an httpOnly cookie, hashed in
`user_sessions`. The admin tree applies `authenticate + requireAdminSession` once
at the root, so a new module cannot ship unauthenticated by omission; writes then
re-check against the live user row, because a stateless token keeps working for a
revoked session until it expires — an acceptable window for reading a product
list and not for deleting one. The storefront tree is the opposite default:
public unless the router says otherwise.

**Rules that hold everywhere on the storefront:**

- Stock is a bucket, never a number: `IN_STOCK | LOW_STOCK | SOLD_OUT`.
- A non-`ACTIVE` record is a **404**, not a 403. An archived product must not
  confirm it exists.
- Ownership is checked on every authed read. Another user's order is a 404;
  another user's checkout session is a **403** — it exists, it is not yours, and
  the UI needs to tell the two apart.
- The client sends `{ variantId, quantity }`. A price in the body is ignored, not
  echoed, not validated against.
- `serializers/shop/` is never `serializers/admin/`. No shared response shape.
- `sort` is an allow-list — `featured | newest | price_asc | price_desc |
  name_asc`. Anything else is a 400, never a silent fallback: a mistyped
  `sort=pirce_asc` that quietly returns newest is a bug found in production
  months later. Absence is still absence — `?sort=` means "not set".

---

## 2.1 Admin API — `/api/admin`

### Auth
```
POST   /auth/login                 rate limited
POST   /auth/refresh
POST   /auth/logout
GET    /auth/me
POST   /auth/forgot-password
POST   /auth/reset-password
```

### Brands
```
GET    /brands                     ?q=&status=
POST   /brands
GET    /brands/:id
PATCH  /brands/:id
PATCH  /brands/:id/status
DELETE /brands/:id                 422 if products exist
```

### Categories
```
GET    /categories                 ?q=&status=   flat, paginated
GET    /categories/tree            nested, with productCount per node
PATCH  /categories/reorder         [{ id, parentId, position }]
POST   /categories
GET    /categories/:id
PATCH  /categories/:id
PATCH  /categories/:id/status
DELETE /categories/:id             ?childAction=reparent|block
```

### Attributes
```
GET    /attributes                 ?q=&type=&isFilterable=   returns productCount
POST   /attributes
GET    /attributes/:id
PATCH  /attributes/:id             type is immutable once values exist
DELETE /attributes/:id             422 if used by products
GET    /attributes/:id/values
POST   /attributes/:id/values
PATCH  /attributes/:id/values/reorder
PATCH  /attributes/:id/values/:valueId
DELETE /attributes/:id/values/:valueId
```

### Variant options
```
GET    /variant-options
POST   /variant-options
GET    /variant-options/:id
PATCH  /variant-options/:id
DELETE /variant-options/:id        422 if used by any product
GET    /variant-options/:id/values
POST   /variant-options/:id/values
PATCH  /variant-options/:id/values/reorder
PATCH  /variant-options/:id/values/:valueId
DELETE /variant-options/:id/values/:valueId
```

### Products
```
GET    /products                   ?q=&status=&brandId=&categoryId=&stock=in|out|low
POST   /products
POST   /products/bulk              { ids, action: publish|archive|delete|setCategory, payload }
GET    /products/:id               full payload: media, attributes, options, variants, inventory
PATCH  /products/:id               full replace of attributes and options, server diffs
PATCH  /products/:id/status
DELETE /products/:id               422 if ordered — archive instead
GET    /products/:id/publish-checklist
POST   /products/:id/publish       422 with the list of failures
POST   /products/:id/archive
POST   /products/:id/duplicate     { title, includeMedia, includeVariants, includeInventory }
```

`PATCH /products/:id` takes the **complete** list of attributes and variant
options every time; the server diffs against `product_attributes` and
`product_variant_options` and applies inserts, updates and deletes in one
transaction. Per-attribute endpoints would mean five round trips per save for no
gain.

```jsonc
{
  "title": "Nike Air Max 270",
  "brandId": "…", "categoryId": "…",
  "attributes": [
    { "attributeId": "gender-id", "attributeValueId": "men-id" },
    { "attributeId": "weight-id", "valueNumber": 280 },
    { "attributeId": "waterproof-id", "valueBoolean": false }
  ],
  "variantOptions": [
    { "variantOptionId": "color-id", "position": 0 },
    { "variantOptionId": "size-id",  "position": 1 }
  ]
}
```

### Product media
```
GET    /products/:id/media
POST   /products/:id/media/presign   { filename, contentType } → { uploadUrl, key }
POST   /products/:id/media           { key, type, altText }   record after direct upload
PATCH  /products/:id/media/reorder
PATCH  /products/:id/media/:mediaId
DELETE /products/:id/media/:mediaId
POST   /uploads/:folder              direct upload for non-product images
```
The browser PUTs straight to S3 or MinIO. Node never touches the bytes.

### Variants
```
GET    /products/:id/variants
POST   /products/:id/variants
PATCH  /products/:id/variants/bulk          [{ id, price, compareAtPrice, sku }]
POST   /products/:id/variants/generate
PATCH  /products/:id/variants/:variantId
DELETE /products/:id/variants/:variantId    422 if ordered
```

Generate takes the option values explicitly, because they are not derivable from
the category:

```jsonc
// request
{
  "dryRun": true,
  "options": [
    { "variantOptionId": "color-id", "valueIds": ["black", "white"] },
    { "variantOptionId": "size-id",  "valueIds": ["8", "9", "10"] }
  ],
  "defaults": { "price": 8999, "compareAtPrice": 10999, "skuPattern": "{brand}-{color}-{size}" }
}

// response
{ "added": 3, "kept": 6, "removed": 0,
  "preview": [{ "sku": "NIKE-WHT-10", "options": ["White", "10"], "isNew": true }] }
```

Generate is additive. Existing combinations keep their SKU, price and stock.
Removals only happen when a value is unticked, and they are reported before they
are applied.

### Tags
```
GET    /tags                       ?q=   the typeahead behind the product editor
```

### Collections
```
GET    /collections                ?q=&type=&status=
GET    /collections/rule-fields    the fields and operators the builder offers
POST   /collections/preview        { matchType, rules } → { count, sample[] }   unsaved
POST   /collections
GET    /collections/:id
PATCH  /collections/:id
PATCH  /collections/:id/status
DELETE /collections/:id
GET    /collections/:id/products
POST   /collections/:id/products            { productIds: [] }
PATCH  /collections/:id/products/reorder
DELETE /collections/:id/products/:productId
```
Preview is unsaved by design, so the rule builder can call it on every edit
before anything is persisted.

### Inventory
```
GET    /inventory                  ?q=&brandId=&stock=in|low|out
GET    /inventory/transactions     global ledger, ?type=&from=&to=
GET    /inventory/low-stock        ?threshold=
GET    /inventory/reasons          the adjustment reason list
GET    /inventory/:variantId
GET    /inventory/:variantId/transactions
POST   /inventory/:variantId/adjust    { mode: set|change, value, reason, note }
POST   /inventory/:variantId/restock   { quantity, reference, note }
PATCH  /inventory/:variantId/threshold
```

### Orders
```
GET    /orders                     ?q=&status=&paymentStatus=&from=&to=
GET    /orders/:id
GET    /orders/:id/history
PATCH  /orders/:id/status          { status, note }   allow-listed transitions
POST   /orders/:id/refunds         a discretionary refund, against no request
```
No endpoint edits items or prices after placement. That is deliberate.

### Payments
```
GET    /payments                   ?q=&status=&provider=&from=&to=
GET    /payments/:id
GET    /payments/:id/transactions
```
Read-only. Money moves through the provider and the webhook, never through a
form.

### Returns
```
GET    /returns                    ?status=&type=&q=   the queue, oldest first
GET    /returns/:id
POST   /returns/:id/approve
POST   /returns/:id/reject         decision note required
POST   /returns/:id/receive        { items: [{ requestItemId, restocked, unsellable }] }
```
`receive` is the one call that moves stock and sends money in the same
transaction, and it is partial and idempotent by design: two of three pairs
today, the third next week.

### Customers
```
GET    /customers                  ?q=&status=
GET    /customers/:id
GET    /customers/:id/orders
GET    /customers/:id/addresses
GET    /customers/:id/basket       cart + wishlist, read only
GET    /customers/:id/sessions
POST   /customers/:id/sessions/revoke
PATCH  /customers/:id/status       suspend or reactivate
```
No password editing, no impersonation.

### Reviews
```
GET    /reviews                    ?status=&rating=&q=
GET    /reviews/counts             for the moderation tabs
PATCH  /reviews/:id/status         hide or unhide
DELETE /reviews/:id                abuse only
```
Never edit. The words are the customer's.

### Testimonials
```
GET    /testimonials               ?status=
POST   /testimonials
PATCH  /testimonials/reorder
GET    /testimonials/:id
PATCH  /testimonials/:id
PATCH  /testimonials/:id/status
DELETE /testimonials/:id
```

### Discounts
```
GET    /discounts                  ?kind=&status=&q=
POST   /discounts
GET    /discounts/:id
PUT    /discounts/:id              full replace, including every scoping list
PATCH  /discounts/:id/state        publish, pause, archive
DELETE /discounts/:id
```
`PUT` rather than `PATCH` for the body: a discount is scope plus conditions plus
combination flags, and a partial update of that set is a discount nobody can
reason about.

### Dashboard and shared
```
GET    /dashboard/summary          ?from=&to=   revenue, orders, products, customers + deltas
GET    /dashboard/sales            ?from=&to=&interval=day|week
GET    /dashboard/orders           recent
GET    /dashboard/inventory        low stock
GET    /dashboard/top-products     ?from=&to=
GET    /dashboard/attention        failed payments, stale orders, published with no stock
GET    /search                     ?q=   products, orders, customers for ⌘K
```

Every admin write passes through `invalidateOnWrite`, which drops the
customer-facing read caches the write could have invalidated.

---

## 2.2 Storefront API — `/api/storefront`

### Auth
```
POST   /auth/register              forces role CUSTOMER
POST   /auth/login                 rejects ADMIN | STAFF
POST   /auth/refresh
POST   /auth/logout
GET    /auth/me
POST   /auth/verify-email
POST   /auth/resend-verification
POST   /auth/forgot-password       same response whether or not the email exists
POST   /auth/reset-password
```

### Catalog
```
GET    /home                       featured collections, new arrivals, testimonials
GET    /categories/tree
GET    /categories/:slug
GET    /products                   ?category=&collection=&brand=id,id&attr:{id}=v,v
                                   &minPrice=&maxPrice=&q=&sort=&page=
GET    /products/facets            counts per filter value for the current query
GET    /products/:slug             media, attributes, options in position order,
                                   variants with option assignments + stock bucket
GET    /products/:slug/related     same category → same brand → newest
GET    /collections                index, ACTIVE only
GET    /collections/:slug          banner material only — name, description, image, count
GET    /search/suggest             ?q=   header overlay, products + categories
GET    /sitemap.xml                for crawlers, rewritten to the site root in production
```

**`collection` is a filter on `/products`, not its own endpoint**, and so is
search. A collection page, a category page and a search results page differ by
one query parameter; giving any of them a second endpoint would mean a second
query to keep in step with the facets.

For a `MANUAL` collection the filter resolves to the `collection_products` id
list and carries its `position`; for a `DYNAMIC` one it resolves to the rules
engine's where-clause, built once and reused for the grid, the count *and* the
facets — faceting a dynamic collection against the whole catalog gives counts
that do not match what the grid shows.

`featured` means `collection_products.position` on a manual collection, and falls
back to newest everywhere else.

Attribute filters arrive as `attr:<attributeId>=<valueId>,<valueId>`. Unknown or
malformed keys are ignored rather than rejected — a stale bookmark pointing at a
deleted attribute should still render a grid — and the fan-out is capped, because
an unbounded `IN` clause is a free way to make the database do arbitrary work.

### Reviews
```
GET    /products/:slug/reviews     ?page=&sort=   PUBLIC, marks the caller's own rows
POST   /products/:slug/reviews     authed, 409 if this user already reviewed
PATCH  /reviews/:id                own review only
DELETE /reviews/:id                own review only
```

### Cart and wishlist
```
POST   /cart/hydrate               PUBLIC, rate limited — ids in, display out
POST   /cart/merge                 on login AND register
GET    /cart                       authed
DELETE /cart                       authed
POST   /cart/items
PATCH  /cart/items/:id
DELETE /cart/items/:id

POST   /wishlist/hydrate           PUBLIC, rate limited
POST   /wishlist/merge
GET    /wishlist
POST   /wishlist/items
DELETE /wishlist/items/:productId
```

`hydrate` is the whole trick. It takes `[{ variantId, quantity }]` from
localStorage and returns today's price, today's status and today's stock bucket,
with a `reason` per line that could not be honoured. A three-week-old bag shows
current prices and drops archived products, and the UI can say which ones.

Rate limit it hard: it is an unauthenticated endpoint that takes an array of ids,
which is a catalog-scraping tool if you let it be.

### Addresses
```
GET    /addresses
POST   /addresses
GET    /addresses/:id
PATCH  /addresses/:id
DELETE /addresses/:id
POST   /addresses/:id/default
```

### Checkout
```
POST   /checkout                   creates session, reserves stock, snapshots price
GET    /checkout/active            resume an open session
GET    /checkout/:id               refresh-safe, lazily expires, 403 if not yours
POST   /checkout/:id/address       shipping + billing, re-quotes shipping
POST   /checkout/:id/shipping-method   { method: STANDARD|EXPRESS|PRIORITY }
POST   /checkout/:id/coupons       { code } — validate, hold, re-quote
DELETE /checkout/:id/coupons/:couponId   release the hold, re-quote
DELETE /checkout/:id               explicit cancel, releases stock and coupons
```

`POST /checkout` takes almost nothing — the lines come from the cart and the
prices come from the catalog, because a body that could name either is a body
that could name a price (§5). Both addresses are optional here and settable
afterwards: a session that cannot be created without an address makes the address
form block the stock hold rather than the other way round.

It is one transaction, in this order:

1. Revalidate every line — product `ACTIVE`, variant `ACTIVE`, live price,
   quantity `>= 1` and `<= max_allowed` and `<= available`. Collect **all**
   failures; do not stop at the first.
2. Reserve each line with the conditional update in §1.2. Affected rows 1 → held,
   0 → `OUT_OF_STOCK` for that line.
3. Write the `RESERVATION` ledger row and the `inventory_reservations` row.
4. `expires_at = now() + 10 minutes`.
5. Snapshot title, SKU, options and unit price into `checkout_items`.
6. Compute the money server-side, in the order given in §1.4.

Any line short rolls the whole thing back. Nothing is ever partially reserved.

The shipping method endpoint takes a **code and nothing else** — no rate, no
label. The client naming its own delivery charge is the one thing it exists to
prevent (§21); the quote comes back with every method priced for *this* order, so
"Free" against standard and "₹249" against express are both the server's
arithmetic.

**Coupon validation** runs on apply and again inside `POST /payments`, because a
code can expire or hit its limit while the checkout sits open. Every condition is
checked server-side:

```
exists and status = ACTIVE
now between starts_at and ends_at
subtotal (or matching-line subtotal) meets min_requirement
used_count < usage_limit                        atomically
redemptions for (coupon, user) < per_user_limit
eligibility: ALL_CUSTOMERS, or this user is in coupon_customers
every discounted line is in coupon_products, or its category (with descendants)
  or collection is scoped                       empty lists mean "everything"
combination flags allow whatever else is already on the session
```

A rejected coupon returns `COUPON_INVALID` with a `reason` the UI prints verbatim
— "expired", "minimum spend ₹1,999 not met", "already used". A generic "invalid
coupon" turns support into guesswork.

### Payments
```
POST   /payments                   header Idempotency-Key: <uuid>
GET    /payments/:id
```

`PaymentProvider` is an interface — `createPayment`, `getPayment`,
`verifySignature`, `parseWebhook`, `createRefund`, `getRefund` — and it is the
whole of what the rest of the codebase knows about a gateway. Razorpay is the
live implementation and dropped in behind it without a line changing above the
line. `PAYMENT_PROVIDER` picks who takes *new* money; every other call site
resolves the provider from the row it is acting on, so a payment taken by one is
always refunded by the same one, whatever the setting says today.

Money crosses that boundary in **paise**, never as a float, and nowhere else in
the system is in minor units.

The same `Idempotency-Key` twice returns the stored result and creates nothing.
That relies on the unique constraint, not a pre-`SELECT`.

### Orders and returns
```
GET    /orders                     ?page=
GET    /orders/:orderNumber
POST   /orders/:orderNumber/cancel                     self-serve, before it ships
POST   /orders/:orderNumber/returns                    { items, reason, comment }
DELETE /orders/:orderNumber/returns/:requestId         withdraw
```

A cancellation after the parcel has shipped — including by a second or two — is
`ORDER_NOT_CANCELLABLE`, which is why the check that produces it is a conditional
write rather than a read. The return window is recomputed from `delivered_at` on
every read, so a client that cached "returnable" an hour ago is told
`RETURN_WINDOW_CLOSED` rather than trusted.

Money never moves on the strength of one of these requests alone. The provider
confirms it, exactly as with a payment.

### Account
```
PATCH  /account                    profile
POST   /account/password
```
Reading yourself is `GET /auth/me`.

---

## 2.3 Webhooks — `/api/webhooks`

```
POST   /payments/:provider         unauthenticated, signature verified, idempotent
```

Nothing here is authenticated in the usual sense and nothing here should ever be:
a payment provider has no session with us. It proves who it is by signing the
bytes it sends, which the handler verifies against the **raw body** before
reading a single field (§8). `:provider` resolves against the registry, so an
unknown one fails at the first request rather than being silently accepted.

The webhook is the source of truth, and it is one transaction:

```
verify signature
  → create order + order_items from the checkout_items snapshots
  → reservations ACTIVE → CONSUMED, ledger RESERVATION → SALE
  → coupon redemptions CONSUMED
  → payment CAPTURED, order payment_status PAID
  → session COMPLETED, order_id set, cart cleared
  → COMMIT, then queue the confirmation email
```

Roll back on any failure. `payment = SUCCESS` with no order is the state this
transaction exists to make impossible. The email is queued *after* the commit,
because queuing inside would let the worker read an order that does not exist yet
— and `orders.confirmation_sent_at` plus the mail sweep is what covers the gap
that leaves.

A provider that does not answer leaves the session `PAYMENT_PENDING`. It is **not**
marked failed on the spot; the webhook or reconciliation decides.

Refund webhooks land on the same route and are the only thing that writes
`refunds.status = SUCCEEDED`.

## 2.4 Background jobs

All four live in one list, `apps/api/src/jobs/index.ts`, so "what runs in the
background" is a question with a file for an answer. BullMQ's job scheduler
produces one job per interval across the cluster; every job here is nonetheless
written to be **safe to run twice and safe to miss**, because a sweep that
outruns its interval can still overlap with the next one on another worker.

| Job | Every | What it does |
|---|---|---|
| `checkout.expiry` | 1 min | expires `ACTIVE` sessions past `expires_at`, releases their reservations and coupon holds, and sweeps orphaned holds. Lazy expiry already covers every session somebody looks at; this catches the abandoned ones |
| `mail.confirmations` | 10 min | queues confirmations for `PAID` orders older than five minutes with `confirmation_sent_at` still null |
| `payments.reconcile` | 5 min | asks the provider about payments still `PENDING` or `AUTHORIZED`, older than 10 minutes, within a 24-hour lookback |
| `refunds.reconcile` | 5 min | the same for refunds that never got their webhook — a stuck payment is stock nobody can sell, but a stuck refund is a customer who has posted their shoes back and is waiting |

**Payment reconciliation, specified:**

| Provider says | Action |
|---|---|
| captured | run the **same handler the webhook runs** — it is idempotent, so this is safe |
| failed / declined | mark `FAILED`, release stock and coupons, session `CANCELLED` |
| still pending | leave it, try again next pass |
| no record of it | the request never landed. After 30 minutes, `FAILED` and release |
| older than the 24h lookback | `FAILED`, release, and **alert a human** — do not retry forever |

The one rule that matters: **reconciliation and the webhook call the same
function.** Two code paths that both confirm orders will diverge, and the one
that runs less often is the one that will be wrong.

# Shoe Admin — Final Build Spec

Postgres + Prisma + Node.js + Next.js + S3/MinIO. Redis optional.

Read in order: database, then APIs, then screens. Exact Prisma types are in `schema.prisma` next to this file.

**The one structural change from the original blueprint:** categories no longer bind attributes or variant options. `category_attributes` and `category_variant_options` are gone. Both are global lists that an admin attaches directly to a product. One table gets added in their place, `product_variant_options`, which records which options a product uses and in what order. Without it you cannot render the variant block or label Option 1 and Option 2 correctly.

---

# PART 1 — DATABASE

## 1.1 Conventions

| Decision | Choice | Why |
|---|---|---|
| Primary keys | `uuid` with `gen_random_uuid()` | safe to expose in URLs, no enumeration |
| Timestamps | `timestamptz`, `created_at` + `updated_at` | store UTC, format in the client |
| Money | `Decimal(12,2)` + `currency` on the order | INR, no float arithmetic anywhere |
| Deletes | no soft delete, `status` enum instead | `ARCHIVED` covers the real need, deletes are blocked by FKs |
| Enums | Postgres enums via Prisma | catches typos at the DB, not in a service |
| Slugs | unique per table, generated from name, editable until first publish | |
| JSON | only `collection_rules.value`, `order_items.variant_options`, `payment_transactions.metadata` | everything else is columns |

Status vocabulary is shared: `DRAFT`, `ACTIVE`, `ARCHIVED` on brands, categories, products, variants, collections.

## 1.2 Tables

### Auth
```
users              id, email✦, password_hash, first_name, last_name, phone,
                   role[ADMIN|STAFF|CUSTOMER], status[ACTIVE|SUSPENDED],
                   email_verified_at, created_at, updated_at

user_sessions      id, user_id→users, refresh_token_hash✦, user_agent,
                   ip_address, expires_at, revoked_at, created_at

addresses          id, user_id→users, full_name, phone, address_line_1,
                   address_line_2, city, state, country, postal_code,
                   is_default, created_at, updated_at
```

### Catalog
```
brands             id, name, slug✦, logo_url, status, created_at, updated_at

categories         id, name, slug✦, description, parent_id→categories,
                   level, position, status, created_at, updated_at
```
`level` and `position` are derived server side. Nothing else references a category except `products.category_id`.

### Attributes (global)
```
attributes         id, name, slug✦, type[TEXT|NUMBER|BOOLEAN|SELECT|MULTI_SELECT],
                   unit, is_filterable, is_suggested, position, timestamps

attribute_values   id, attribute_id→attributes, value, slug, position, created_at
                   unique(attribute_id, slug)
```
`is_suggested` replaces the old `is_required`. It means "pre-add this row on a new product form". It is a default, not a constraint.

### Variant options (global)
```
variant_options        id, name, slug✦, position, timestamps

variant_option_values  id, variant_option_id→variant_options, value, slug,
                       swatch_hex, position, created_at
                       unique(variant_option_id, slug)
```
`swatch_hex` is new. Colour pickers need it in both admin and storefront, and backfilling it later is worse than adding it now.

### Products
```
products                  id, brand_id→brands, category_id→categories, title,
                          slug✦, description, status, published_at, timestamps

product_media             id, product_id→products, url, alt_text,
                          type[IMAGE|VIDEO], sort_order, created_at

product_attributes        id, product_id→products, attribute_id→attributes,
                          attribute_value_id→attribute_values (nullable),
                          value_text, value_number, value_boolean,
                          position, created_at
                          unique(product_id, attribute_id, attribute_value_id)

product_variant_options   id, product_id→products, variant_option_id→variant_options,
                          position, created_at
                          unique(product_id, variant_option_id)      ← NEW

product_variants          id, product_id→products, media_id→product_media,
                          sku✦, barcode, price, compare_at_price,
                          position, status, timestamps

variant_option_assignments  variant_id→product_variants,
                            option_value_id→variant_option_values
                            pk(variant_id, option_value_id)
```

Exactly one value column on `product_attributes` is populated, decided by `attribute.type`. MULTI_SELECT is the reason `attribute_value_id` is in the unique key: several rows per attribute is how you store multiple values.

### Collections
```
collections         id, name, slug✦, description, image_url,
                    type[MANUAL|DYNAMIC], match_type[ALL|ANY], status, timestamps

collection_products collection_id, product_id, position   pk(collection_id, product_id)

collection_rules    id, collection_id→collections, field, operator,
                    value jsonb, group_id, created_at
```

### Inventory
```
inventories             id, variant_id→product_variants✦, quantity,
                        reserved_quantity, low_stock_threshold, timestamps

inventory_transactions  id, inventory_id→inventories,
                        type[RESTOCK|SALE|RESERVATION|RELEASE|RETURN|ADJUSTMENT],
                        quantity, reference_type, reference_id, note,
                        created_by_user_id, created_at
```
Available stock is `quantity - reserved_quantity`, computed, never stored. Every write to `inventories.quantity` happens inside a transaction that also writes an `inventory_transactions` row. No exceptions, or the ledger stops being trustworthy.

### Cart and wishlist
```
carts / cart_items          one cart per user, unique(cart_id, variant_id)
wishlists / wishlist_items  unique(wishlist_id, product_id)
```
Not used by the admin except read only on the customer detail page. Keep them.

### Orders
```
orders               id, user_id→users, order_number✦,
                     status[PENDING|PROCESSING|SHIPPED|DELIVERED|CANCELLED|REFUNDED],
                     payment_status[PENDING|PAID|PARTIALLY_REFUNDED|REFUNDED|FAILED],
                     subtotal, discount_amount, shipping_amount, tax_amount,
                     total_amount, currency, placed_at, timestamps

order_items          id, order_id→orders, variant_id (nullable, SET NULL),
                     product_title, sku, variant_options jsonb,
                     unit_price, quantity, total_price, created_at

order_addresses      id, order_id→orders, type[SHIPPING|BILLING], full name
                     and address fields    unique(order_id, type)

order_status_history id, order_id→orders, from_status, to_status,
                     changed_by_user_id→users, note, created_at
```
`payment_status` is denormalized from the payments table so the order list can filter and sort on it without a join per row. The payments table stays the source of truth, and the webhook handler updates both in one transaction.

`order_items.variant_id` is nullable with `ON DELETE SET NULL`, because the snapshot columns are what the order actually needs. The FK is only there for reporting.

### Payments
```
payments             id, order_id→orders, provider, provider_payment_id,
                     amount, currency,
                     status[PENDING|AUTHORIZED|CAPTURED|FAILED|REFUNDED|VOIDED],
                     method, timestamps
                     unique(provider, provider_payment_id)

payment_transactions id, payment_id→payments,
                     type[AUTHORIZATION|CAPTURE|REFUND|VOID], amount,
                     provider_transaction_id, metadata jsonb, created_at
```
The unique on `(provider, provider_payment_id)` is your webhook idempotency guard. Providers retry, and without it you will double count captures.

## 1.3 Relationships

```
USER ──┬── USER_SESSION
       ├── ADDRESS
       ├── CART ── CART_ITEM ──→ VARIANT
       ├── WISHLIST ── WISHLIST_ITEM ──→ PRODUCT
       └── ORDER ──┬── ORDER_ITEM ──→ VARIANT (nullable)
                   ├── ORDER_ADDRESS
                   ├── ORDER_STATUS_HISTORY
                   └── PAYMENT ── PAYMENT_TRANSACTION

CATEGORY ──(self)── CATEGORY          BRAND
     └──────────────┬───────────────────┘
                    ↓
                 PRODUCT
                    ├── PRODUCT_MEDIA
                    ├── PRODUCT_ATTRIBUTE ──→ ATTRIBUTE ── ATTRIBUTE_VALUE
                    ├── PRODUCT_VARIANT_OPTION ──→ VARIANT_OPTION ── OPTION_VALUE
                    ├── PRODUCT_VARIANT
                    │        ├── VARIANT_OPTION_ASSIGNMENT ──→ OPTION_VALUE
                    │        └── INVENTORY ── INVENTORY_TRANSACTION
                    └── COLLECTION_PRODUCT ──→ COLLECTION ── COLLECTION_RULE
```

Attributes and variant options now hang off products only. Category is a label on the product, nothing more.

## 1.4 Indexes worth creating on day one

```
products            (status, created_at), (brand_id), (category_id)
                    GIN trigram on title for admin search
product_variants    (product_id, position), unique(sku)
product_attributes  (attribute_id, attribute_value_id)   ← dynamic collections
categories          (parent_id, position)
inventories         unique(variant_id)
inventory_transactions (inventory_id, created_at)
orders              (status, created_at), (payment_status), (user_id, created_at)
payments            unique(provider, provider_payment_id), (status, created_at)
```

---

# PART 2 — API

All routes are `/api/admin/*` and require an admin session. Conventions:

- List endpoints take `?page=1&limit=25&sort=created_at:desc&q=` plus their own filters, and return `{ data, meta: { page, limit, total, totalPages } }`.
- Mutations return the full updated entity.
- Errors: `{ error: { code, message, fields?: { title: "..." } } }`.
- `409` for slug and SKU conflicts, handled inline in the form.
- `422` when a delete is blocked by references, with a `reason` the dialog can show.

### Auth
```
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
GET    /auth/me
POST   /auth/forgot-password
POST   /auth/reset-password
```

### Brands
```
GET    /brands                     ?q=&status=
GET    /brands/:id
POST   /brands
PATCH  /brands/:id
DELETE /brands/:id                  422 if products exist
PATCH  /brands/:id/status
```

### Categories
```
GET    /categories                 ?q=&status=  flat, paginated
GET    /categories/tree            nested, with productCount per node
GET    /categories/:id
POST   /categories
PATCH  /categories/:id
DELETE /categories/:id             ?childAction=reparent|block
PATCH  /categories/:id/status
PATCH  /categories/reorder         [{ id, parentId, position }]
```
Everything under `/categories/:id/attributes` and `/categories/:id/variant-options` is removed.

### Attributes
```
GET    /attributes                 ?q=&type=&isFilterable=  returns productCount
GET    /attributes/:id
POST   /attributes
PATCH  /attributes/:id             type is immutable once values exist
DELETE /attributes/:id             422 if used by products
GET    /attributes/:id/values
POST   /attributes/:id/values
PATCH  /attributes/:id/values/:valueId
DELETE /attributes/:id/values/:valueId
PATCH  /attributes/:id/values/reorder
```

### Variant options
```
GET    /variant-options
GET    /variant-options/:id
POST   /variant-options
PATCH  /variant-options/:id
DELETE /variant-options/:id        422 if used by any product
GET    /variant-options/:id/values
POST   /variant-options/:id/values
PATCH  /variant-options/:id/values/:valueId
DELETE /variant-options/:id/values/:valueId
PATCH  /variant-options/:id/values/reorder
```

### Products
```
GET    /products                   ?q=&status=&brandId=&categoryId=&stock=in|out|low
GET    /products/:id               full payload: media, attributes, options, variants, inventory
POST   /products
PATCH  /products/:id               full replace of attributes and options, server diffs
DELETE /products/:id               422 if ordered, dialog offers archive
POST   /products/:id/publish       runs the publish checklist, 422 with a list of failures
POST   /products/:id/archive
POST   /products/:id/duplicate     { title, includeMedia, includeVariants, includeInventory }
POST   /products/bulk              { ids, action: publish|archive|delete|setCategory, payload }
```

`PATCH /products/:id` body, the part that matters now that nothing comes from the category:

```jsonc
{
  "title": "Nike Air Max 270",
  "brandId": "...", "categoryId": "...",
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
Send the complete list every time. The server diffs against `product_attributes` and `product_variant_options` and applies inserts, updates and deletes in one transaction. Per attribute endpoints would mean five round trips per save for no gain.

### Product media
```
POST   /products/:id/media/presign   { filename, contentType } → { uploadUrl, key }
POST   /products/:id/media           { key, type, altText }  record after direct upload
PATCH  /products/:id/media/:mediaId
DELETE /products/:id/media/:mediaId
PATCH  /products/:id/media/reorder
```
The browser PUTs straight to S3 or MinIO. Node never touches the bytes.

### Variants
```
GET    /products/:id/variants
POST   /products/:id/variants
PATCH  /products/:id/variants/:variantId
DELETE /products/:id/variants/:variantId    422 if ordered
PATCH  /products/:id/variants/bulk          [{ id, price, compareAtPrice, sku }]
POST   /products/:id/variants/generate
```

Generate takes the option values explicitly, because they are no longer derivable from the category:

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

Generate is additive. Existing combinations keep their SKU, price and stock. Removals only happen when the admin unticks a value, and they are reported before they are applied.

### Collections
```
GET    /collections                ?q=&type=&status=
GET    /collections/:id
POST   /collections
PATCH  /collections/:id
DELETE /collections/:id

POST   /collections/:id/products            { productIds: [] }
DELETE /collections/:id/products/:productId
PATCH  /collections/:id/products/reorder

GET    /collections/:id/rules
POST   /collections/:id/rules
PATCH  /collections/:id/rules/:ruleId
DELETE /collections/:id/rules/:ruleId
POST   /collections/preview        { matchType, rules } → { count, sample[] }
```
Preview is unsaved by design, so the rule builder can call it on every edit before anything is persisted.

Supported rule fields: `category`, `brand`, `price`, `title`, `sku`, `stock`, `created_at`, and `attribute:{attributeId}`. Operators per field type: `is`, `is_not`, `contains`, `greater_than`, `less_than`, `is_empty`.

### Inventory
```
GET    /inventory                  ?q=&brandId=&stock=in|low|out
GET    /inventory/:variantId
POST   /inventory/:variantId/adjust    { mode: set|change, value, reason, note }
POST   /inventory/:variantId/restock   { quantity, reference, note }
GET    /inventory/:variantId/transactions
GET    /inventory/transactions         global ledger, ?type=&from=&to=
GET    /inventory/low-stock            ?threshold=
```

### Orders
```
GET    /orders                     ?q=&status=&paymentStatus=&from=&to=
GET    /orders/:id
PATCH  /orders/:id/status          { status, note }
GET    /orders/:id/payment
GET    /orders/:id/history
GET    /orders/export              CSV
```
No endpoint edits items or prices after placement. That is deliberate.

### Payments
```
GET    /payments                   ?q=&status=&provider=&from=&to=
GET    /payments/:id
GET    /payments/:id/transactions
POST   /webhooks/payments/:provider    public, signature verified, idempotent
```

### Customers
```
GET    /customers                  ?q=&status=
GET    /customers/:id
GET    /customers/:id/orders
GET    /customers/:id/addresses
PATCH  /customers/:id/status       suspend or reactivate
POST   /customers/:id/sessions/revoke
```

### Dashboard and shared
```
GET    /dashboard/summary          ?from=&to=  revenue, orders, products, customers + deltas
GET    /dashboard/sales            ?from=&to=&interval=day|week
GET    /dashboard/orders           recent
GET    /dashboard/inventory        low stock
GET    /dashboard/top-products
GET    /dashboard/attention        failed payments, stale orders, published with no stock

GET    /search                     ?q=  products, orders, customers for ⌘K
GET    /slug-check                 ?entity=product&slug=  → { available }
```

---

# PART 3 — SCREENS

## 3.0 Shell and shared components

```
┌──────────────┬──────────────────────────────────────────────────┐
│ 👟 SHOE ADMIN│  Breadcrumb                   [Search ⌘K] [👤]  │
│              ├──────────────────────────────────────────────────┤
│ Dashboard    │  Page title                     [Primary action] │
│              │  ──────────────────────────────────────────────  │
│ CATALOG      │                                                  │
│  Products    │  Content                                         │
│  Categories  │                                                  │
│  Brands      │                                                  │
│  Attributes  │                                                  │
│  Variants    │                                                  │
│  Collections │                                                  │
│ INVENTORY    │                                                  │
│ SALES        │                                                  │
│ CUSTOMERS    │                                                  │
│ SETTINGS     │                                                  │
└──────────────┴──────────────────────────────────────────────────┘
```

Build once, use everywhere: `DataTable`, `FilterBar`, `StatusBadge`, `SlugField`, `EntityDrawer` (480px right panel), `ConfirmDialog`, `MediaUploader`, `EmptyState`, `Skeleton`, `Toast`.

Rules that hold on every page: list state lives in the URL, drawers for small entities and full pages for products and collections, unsaved changes guard on every form, kebab menu order is always Edit / Duplicate / Toggle status / Delete, and a blocked delete offers archive instead of just failing.

---

## 3.1 Login

```
              ┌────────────────────────────────┐
              │            👟                  │
              │        Shoe Admin              │
              │                                │
              │  Email                         │
              │  [                          ]  │
              │  Password                      │
              │  [                       👁 ]  │
              │                                │
              │  [        Sign in           ]  │
              │  Forgot your password?         │
              └────────────────────────────────┘
```
Invalid credentials is a banner above the form, never a field error, so you do not leak which half was wrong. Also build forgot password, reset password, 403, and a session expired modal for when a refresh fails mid-session.

---

## 3.2 Dashboard

```
┌──────────────────────────────────────────────────────────────┐
│ Dashboard                          [Last 30 days ▼]          │
├──────────────┬──────────────┬──────────────┬─────────────────┤
│ Revenue      │ Orders       │ Products     │ Customers       │
│ ₹2.4L        │ 184          │ 426          │ 1,240           │
│ ↑ 12%        │ ↑ 4%         │ 12 drafts    │ ↑ 8%            │
├──────────────┴──────────────┴──────────────┴─────────────────┤
│ Sales          ╭─╮      ╭──╮                                 │
│               ─╯ ╰──────╯  ╰───   [revenue | orders]         │
├───────────────────────────────┬──────────────────────────────┤
│ Recent orders                 │ Low stock          [View all]│
│ ORD-1042  ₹24,997  Paid    →  │ Nike Air Max / 9        3 ⚠  │
│ ORD-1041  ₹8,999   Paid    →  │ Adidas Runner / 10      2 ⚠  │
│ ORD-1040  ₹14,998  Pending →  │ Puma Flex / 8           0 ✕  │
├───────────────────────────────┴──────────────────────────────┤
│ Needs attention                                              │
│ • 3 payments failed in the last 24h                          │
│ • 5 orders unfulfilled for over 48h                          │
│ • 2 products published with zero stock                       │
└──────────────────────────────────────────────────────────────┘
```
Each attention line links into a pre-filtered list. Skeleton per card, not one page spinner, since summary and chart return at different speeds.

---

## 3.3 Brands

```
Brands                                          [+ Add brand]
───────────────────────────────────────────────────────────
[Search]  [Status ▼]

  LOGO   NAME      SLUG      PRODUCTS  STATUS
  [N]    Nike      nike      128       ● Active   ⋮
  [A]    Adidas    adidas    94        ● Active   ⋮
  [P]    Puma      puma      0         ○ Draft    ⋮
```

Drawer for create and edit: logo upload, name, slug, status. Delete blocked above zero products, dialog offers "Set to draft".

---

## 3.4 Categories

Now one of the small screens. Tree page plus a drawer.

```
Categories                                   [+ Add category]
───────────────────────────────────────────────────────────
[Search]                                    [Expand all]

▾ Shoes                          L0   426    ● Active   ⋮
  ▾ Men                          L1   210    ● Active   ⋮
      Running                    L2    88    ● Active   ⋮
      Casual                     L2    74    ● Active   ⋮
      Basketball                 L2    48    ○ Draft    ⋮
  ▾ Women                        L1   156    ● Active   ⋮
    Kids                         L1    60    ● Active   ⋮
```

```
┌─ Add category ───────────────────────── ✕ ─┐
│ Name    [ Running                       ]  │
│ Slug    [ running                   🔒  ]  │
│ Parent  [ Shoes > Men                ▼ ]   │
│ Status  ( ) Draft   (•) Active             │
│           [ Cancel ]  [ Save category ]    │
└────────────────────────────────────────────┘
```

Drag to reorder and reparent, optimistic with rollback on failure, and block dropping a parent into its own descendant. Deleting with children asks reparent or block. Deleting with products is blocked outright, since `products.category_id` is not nullable.

---

## 3.5 Attributes

```
Attributes                                  [+ Add attribute]
───────────────────────────────────────────────────────────
[Search]  [Type ▼]  [Filterable ▼]

  NAME         TYPE      VALUES  FILTERABLE  SUGGESTED  PRODUCTS
  Gender       SELECT    3       ✓           ✓          426    ⋮
  Sport        SELECT    8       ✓           ✓           92    ⋮
  Material     SELECT    4       ✓           ✗          146    ⋮
  Waterproof   BOOLEAN   —       ✓           ✗           38    ⋮
  Weight       NUMBER    —       ✗           ✗           61    ⋮
```

Detail page:
```
Material                                              [Save]
───────────────────────────────────────────────────────────
Name [ Material ]  Slug [ material 🔒 ]  Type [ SELECT ▼ ]
☑ Filterable on storefront   ☐ Suggested on new products

Values                                          [+ Add value]
⠿  Leather     leather      12 products   ⋮
⠿  Mesh        mesh         88 products   ⋮
⠿  Canvas      canvas        6 products   ⋮
```

Type control is disabled once values exist, with a tooltip saying why, rather than letting the API reject the save. Values panel hides for TEXT, NUMBER and BOOLEAN. Inline add row at the bottom, not a modal, because admins add five values in a row.

The products count is the whole blast radius now. Nothing else references an attribute.

---

## 3.6 Variant options

Same two components as attributes with different labels and endpoints.

```
Color                                                 [Save]
───────────────────────────────────────────────────────────
Name [ Color ]   Slug [ color 🔒 ]

Values                                          [+ Add value]
⠿  ⬛ Black   black   #000000   used by 240 variants   ⋮
⠿  ⬜ White   white   #FFFFFF   used by 180 variants   ⋮
⠿  🟥 Red     red     #D22B2B   used by  60 variants   ⋮
```
Swatch picker on each value. Delete blocked when variants use it.

---

## 3.7 Product list

```
Products                                     [+ Add product]
───────────────────────────────────────────────────────────
[All] [Active] [Drafts] [Out of stock] [Missing images]
[Search title or SKU]  [Status ▼] [Brand ▼] [Category ▼] [Stock ▼]

☐ IMG  TITLE               BRAND   CATEGORY      VARIANTS STOCK  STATUS
☐ [▪]  Nike Air Max 270    Nike    Men>Running   6        69     ● Active ⋮
☐ [▪]  Adidas Ultraboost   Adidas  Men>Running   9        0      ● Active ⋮
☐ [▪]  Puma Flex Runner    Puma    Kids          4        22     ○ Draft  ⋮

3 selected → [Publish] [Archive] [Change category] [Delete]
```
Stock is summed available across variants, red at zero even when active, because active plus zero stock is the combination that costs money.

---

## 3.8 Product editor

The screen that is roughly a third of the build. One scrolling page with a sticky rail, not a wizard, because editing happens far more than creating.

```
← Products / Nike Air Max 270          ● Active   [Save] [⋮]
────────────────────────────────────────────┬──────────────────
BASIC INFORMATION                           │ ORGANIZATION
Title                                       │ Status
[ Nike Air Max 270                       ]  │ [ Active     ▼ ]
Slug                                        │ Brand
[ nike-air-max-270                   🔒 ]  │ [ Nike       ▼ ]
Description                                 │ Category
[ rich text                              ]  │ [ Men>Running ▼]
                                            │
────────────────────────────────────────────│ Collections
MEDIA                                       │ [ Summer Sale ×]
┌────┐ ┌────┐ ┌────┐ ┌────┐                 │ [ + Add        ]
│ ▪  │ │ ▪  │ │ ▪  │ │ +  │  drag to order  │
└────┘ └────┘ └────┘ └────┘                 │ ─────────────────
 cover                                      │ Created 12 Aug
                                            │ Updated 2h ago
────────────────────────────────────────────│
ATTRIBUTES                                  │
⠿ Gender      [ Men       ▼ ]   ✕           │
⠿ Sport       [ Running   ▼ ]   ✕           │
⠿ Material    [ Mesh      ▼ ]   ✕           │
⠿ Waterproof  ( ) Yes  (•) No   ✕           │
⠿ Weight      [ 280      ] g    ✕           │
                                            │
[ + Add attribute ▼ ]                       │
   ┌──────────────────────────┐             │
   │ [search...]              │             │
   │ Closure type     SELECT  │             │
   │ Care instructions  TEXT  │             │
   │ ─────────────────────────│             │
   │ + Create new attribute   │             │
   └──────────────────────────┘             │
                                            │
────────────────────────────────────────────│
VARIANTS                                    │
Option 1  Color   ☑ Black ☑ White ☐ Red  ✕  │
Option 2  Size    ☑ 8 ☑ 9 ☑ 10 ☐ 11      ✕  │
[ + Add option ▼ ]                          │
                                            │
              [ Generate variants ]         │
              Adds 3 · keeps 6 · removes 0  │
                                            │
  SKU          PRICE    COMPARE   STOCK     │
  BLK-8      [ 8999 ] [ 10999 ]  [ 20 ]  ⋮  │
  BLK-9      [ 8999 ] [ 10999 ]  [ 15 ]  ⋮  │
  BLK-10     [ 8999 ] [ 10999 ]  [ 10 ]  ⋮  │
  WHT-8      [ 8999 ] [ 10999 ]  [  8 ]  ⋮  │
  WHT-9      [ 8999 ] [ 10999 ]  [ 12 ]  ⋮  │
  WHT-10     [ 8999 ] [ 10999 ]  [  4 ]  ⋮  │
  [Apply to all: price ▼] [Auto-generate SKUs]│
────────────────────────────────────────────┴──────────────────
```

What this screen has to get right:

- **Attributes and options are picked per product.** The add control searches all attributes minus the ones already on the form, with "create new" at the bottom so nobody has to leave the page. Same for options. Changing category is now a plain field edit with no reload and no warning.
- **Pre-fill so the block is never empty.** Add every attribute flagged suggested, and from the second product onward default to whatever the last product in that category used. Without a category binding, the empty attributes block is the main cost of this design, and this is the cheap fix.
- **Option order matters.** `product_variant_options.position` drives the Option 1 / Option 2 labels and the SKU pattern, so make the rows draggable.
- **Generate is additive.** Call it with `dryRun: true` on click, show the adds / keeps / removes line, and only commit on confirm.
- **The variant grid is a spreadsheet.** Tab across, enter down, apply to all fills a column. At 40 variants a modal per row is unusable.
- **Stock is editable on create, read only on edit** with an Adjust link into the inventory flow. Otherwise you get stock overwrites with no ledger row.
- **Publish checklist** in a popover on the button: at least one image, at least one variant, no empty attribute rows, every variant priced.
- **Consistency hint, not a constraint:** "Other products in Men > Running have Gender and Sport set. Add them?" as a dismissible line under the attributes block. This is the soft version of what the category binding used to enforce, and it keeps storefront filters from going patchy.

Supporting screens: variant drawer (SKU, barcode, price, image from product media, stock with a link to its history), duplicate dialog (new title plus what carries over, inventory off by default), and a delete dialog that swaps to "appears in 14 orders, archive instead".

---

## 3.9 Collections

```
Collections                                [+ Add collection]
───────────────────────────────────────────────────────────
  NAME            TYPE      PRODUCTS  STATUS
  Summer Sale     MANUAL    24        ● Active   ⋮
  Nike Running    DYNAMIC   88        ● Active   ⋮
  Under ₹5000     DYNAMIC   142       ○ Draft    ⋮
```

Type is a segmented control that swaps the lower half of the editor.

**Manual**
```
Products                                      [+ Add products]
⠿ 1  [▪] Nike Air Max 270      Nike    ● Active   ✕
⠿ 2  [▪] Adidas Ultraboost     Adidas  ● Active   ✕
```

**Dynamic**
```
Products match  (•) all conditions   ( ) any condition
───────────────────────────────────────────────────────────
[ Category ▼ ] [ is      ▼ ] [ Men > Running  ▼ ]   ✕
[ Brand    ▼ ] [ is      ▼ ] [ Nike           ▼ ]   ✕
[ Price    ▼ ] [ is more ▼ ] [ 10000          ]     ✕
[+ Add condition]
───────────────────────────────────────────────────────────
  24 products match                        [Refresh]
  [▪] Nike Air Max 270   ₹8,999   Men > Running
  ... showing 6 of 24                      [See all]
```

The real work here is the value control changing shape per field: tree select for category, dropdown for brand, number for price, value picker for `attribute:{id}`, date picker for created. Preview is debounced against `POST /collections/preview` with unsaved rules. Zero matches gets a helpful message, not an empty box.

`group_id` exists for nested groups. Either build nested cards with their own all/any toggle, or leave it at the default and keep the list flat. Do not half build it.

---

## 3.10 Inventory

```
Inventory                                          [Export]
───────────────────────────────────────────────────────────
[Search SKU or product]  [Brand ▼]  [Stock ▼]

  SKU      PRODUCT / VARIANT            ON HAND  RESERVED  AVAILABLE
  BLK-9    Nike Air Max 270 / Black/9    20       5         15    ⋮
  WHT-10   Nike Air Max 270 / White/10    4       4          0 ⚠  ⋮
  ADI-8    Adidas Ultraboost / Black/8    0       0          0 ✕  ⋮
```
Show all three columns. Zero available against twenty on hand only makes sense when you can see the reservations.

```
┌─ Adjust stock ─────────────── ✕ ─┐
│ BLK-9  ·  currently 20 on hand   │
│ Change  ( ) Set to  (•) Change by│
│ [ -3                          ]  │
│ New on hand: 17                  │
│ Reason  [ Damaged             ▼] │
│ Note    [                     ]  │
│        [Cancel]  [Adjust stock]  │
└──────────────────────────────────┘
```
Reason is required and maps to `inventory_transactions.type`. The live "new on hand" line prevents the most common admin mistake, which is confusing set with change by.

Transactions ledger, append only, so no kebab column at all:
```
  DATE          SKU     TYPE         QTY   REFERENCE      BY
  29 Aug 14:02  BLK-9   SALE         -1    ORD-1042 →     system
  29 Aug 11:40  BLK-9   RESTOCK     +20    PO-889         hitarth
  28 Aug 09:15  BLK-9   RESERVATION  -1    ORD-1041 →     system
```

Low stock is the same table filtered, with a threshold control in the header that persists per admin.

---

## 3.11 Orders

```
Orders                                              [Export]
───────────────────────────────────────────────────────────
[Search order or customer]  [Status ▼] [Payment ▼] [Date ▼]

  ORDER      DATE    CUSTOMER    ITEMS  TOTAL     PAYMENT   STATUS
  ORD-1042   29 Aug  Rahul S.    3      ₹24,997   ● Paid    Processing ⋮
  ORD-1041   29 Aug  Priya M.    1      ₹8,999    ● Paid    Shipped    ⋮
  ORD-1040   28 Aug  Amit K.     2      ₹14,998   ○ Pending Pending    ⋮
```
Two status columns, because payment and fulfilment answer different questions and get filtered separately.

```
← Orders / ORD-1042      ● Paid · Processing   [Update status]
────────────────────────────────────────────┬──────────────────
ITEMS                                       │ CUSTOMER
[▪] Nike Air Max 270                        │ Rahul Sharma
    Black / 9 · SKU BLK-9                   │ rahul@mail.com
    ₹8,999 × 2                   ₹17,998    │ 6 previous orders
[▪] Adidas Ultraboost                       │
    Black / 8 · SKU ADI-8                   │ SHIPPING ADDRESS
    ₹6,999 × 1                    ₹6,999    │ 12 MG Road
                                            │ Surat, Gujarat
             Subtotal          ₹24,997      │ 395007
             Discount          -₹1,000      │
             Shipping             ₹200      │ PAYMENT
             Tax                ₹1,800      │ Razorpay · UPI
             ──────────────────────────     │ pay_MkT9... →
             Total             ₹25,997      │ ₹25,997 captured
                                            │ [View payment]
────────────────────────────────────────────│
TIMELINE                                    │
● 29 Aug 15:30  Processing        hitarth   │
   "Packed, awaiting pickup"                │
● 29 Aug 14:02  Payment captured  system    │
● 29 Aug 14:01  Order placed      system    │
────────────────────────────────────────────┴──────────────────
```
Item rows render the snapshot columns, not the live product. If the snapshot title differs from the current product title, add a small "product since renamed" note and link out, but make clear the order does not follow.

The only mutation is the status modal: target status, optional note, warning on a backwards transition.

---

## 3.12 Payments

```
  PAYMENT     ORDER     PROVIDER   METHOD  AMOUNT    STATUS
  pay_MkT9    ORD-1042  Razorpay   UPI     ₹25,997   ● Captured  →
  pay_MkT7    ORD-1040  Razorpay   Card    ₹14,998   ⊗ Failed    →
```

Detail is a header plus the transaction ledger:
```
  TYPE            AMOUNT     PROVIDER TXN   DATE
  AUTHORIZATION   ₹25,997    txn_9921       29 Aug 14:01
  CAPTURE         ₹25,997    txn_9922       29 Aug 14:02
  REFUND          ₹8,999     txn_9987       30 Aug 10:15
```
Metadata goes in a collapsed "Raw provider response" block with a copy button. No action buttons at launch, since mutations arrive through webhooks.

---

## 3.13 Customers

```
  NAME           EMAIL             ORDERS  SPENT     STATUS       JOINED
  Rahul Sharma   rahul@mail.com    7       ₹64,993   Active       12 Jun
  Amit Kumar     amit@mail.com     0       ₹0        Unverified   28 Aug
```

Detail tabs: Overview (contact, verification, lifetime value), Orders, Addresses, Cart and wishlist (read only, genuinely useful on support calls), Sessions with revoke all.

Actions: suspend, resend verification, revoke sessions. No password editing and no impersonation unless you build audit logging for it.

---

## 3.14 Settings

Left sub nav: Store (name, currency, timezone, order number prefix), Admin users (invite, role, deactivate), Inventory (default low stock threshold, allow negative stock), Media (storage target, max size, allowed types), Webhooks and API keys. Add Roles and permissions only if you go past a single admin role.

---

## 3.15 Routes

```
/login  /forgot-password  /reset-password
/dashboard
/brands
/categories
/attributes            /attributes/:id
/variant-options       /variant-options/:id
/products              /products/new      /products/:id
/collections           /collections/new   /collections/:id
/inventory             /inventory/:variantId
/inventory/low-stock   /inventory/transactions
/orders                /orders/:id
/payments              /payments/:id
/customers             /customers/:id
/settings/*
```

---

# Build order

1. Prisma schema, migrations, seed script. Shell, auth, `DataTable`, `EntityDrawer`, `ConfirmDialog`, toasts.
2. Brands, attributes, variant options. Three near identical CRUD screens, so the shared components get proven cheaply.
3. Categories tree. Small now, an afternoon.
4. Product list and product editor, including media presign and variant generate. Budget a third of the project here.
5. Inventory: list, adjust, restock, transactions.
6. Collections, manual first, then the rule builder and preview.
7. Orders and payments, plus the webhook handler.
8. Customers, dashboard, settings.

Steps 1 to 4 give you a working catalog. Everything after that is additive, so ship in that order even if scope moves.

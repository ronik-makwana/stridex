<div align="center">

# 👟 StrideX

**A shoe store, built properly.**

One Express API, two React SPAs, one Postgres schema — with the parts most
storefronts get wrong done deliberately: stock that cannot oversell, payments
that cannot double-charge, and orders that still read correctly years after the
catalogue has moved on.

<br />

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js_22-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express_5-000000?style=for-the-badge&logo=express&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma_7-2D3748?style=for-the-badge&logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_17-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)

![React](https://img.shields.io/badge/React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind_v4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![TanStack Query](https://img.shields.io/badge/TanStack_Query-FF4154?style=for-the-badge&logo=reactquery&logoColor=white)
![Zod](https://img.shields.io/badge/Zod-3E67B1?style=for-the-badge&logo=zod&logoColor=white)

![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![MinIO](https://img.shields.io/badge/MinIO-C72E49?style=for-the-badge&logo=minio&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)

</div>

---

## Contents

- [What it is](#what-it-is) · [Quick start](#quick-start) · [Ports](#ports)
- [What's built](#whats-built) · [Architecture](#architecture)
- [The decisions worth knowing](#the-decisions-worth-knowing)
- [Verification](#verification) · [Commands](#commands) · [Status](#status)

---

## What it is

A full e-commerce build in one monorepo — customer storefront, staff admin, and
the API both talk to.

| | |
|---|---|
| 🛍️ **Storefront** | Browse, filter, search, review, cart, wishlist, checkout, account |
| 🧑‍💼 **Admin** | Catalogue, variants, inventory, orders, payments, customers, reviews, discounts |
| ⚙️ **API** | 24 modules, ~47 tables, money and stock decided server-side, always |

Every rule in [`ecommerce_frontend_backend_rules.md`](ecommerce_frontend_backend_rules.md)
about inventory, payments, idempotency and order state is implemented and
verified — 23 of 27 fully, with tax and refunds the known gaps.

---

## Quick start

```bash
npm install
cp .env.example apps/api/.env       # fill in the two JWT secrets
npm run services:up                 # postgres, minio, redis
npm run db:migrate
npm run db:seed
```

Three terminals:

```bash
npm run dev:api      # http://localhost:4000
npm run dev:admin    # http://localhost:5175
npm run dev:shop     # http://localhost:5174
```

Sign in to the admin with **`admin@shoe.com`** / **`Admin@12345`**.

### Dev fixtures

Seeded only when `NODE_ENV !== 'production'`.

| Email | Password | Why it exists |
|---|---|---|
| `admin@shoe.com` | `Admin@12345` | the real admin |
| `shopper@shoe.com` | `Customer@12345` | CUSTOMER — must be refused at the admin door |
| `benched@shoe.com` | `Customer@12345` | SUSPENDED STAFF — must get 403, not 401 |

---

## Ports

| Service | Port | Note |
|---|---|---|
| API | `4000` | |
| Storefront | `5174` | |
| Admin | `5175` | |
| Postgres | `5433` | 5432 was taken locally — change it back in `docker-compose.yml` and the `DATABASE_URL`s if yours is free |
| MinIO | `9000` / `9001` | object storage for product media |
| Redis | `6379` | shared rate-limit counters; AOF-persisted. Required — the API will not boot without it |

---

## What's built

<details open>
<summary><b>🛍️ Storefront</b></summary>

- **Home** — full-height hero, department tiles, a scrolling top-categories band, curated collections, testimonials
- **Catalogue** — category pages, collections (manual and rule-driven), search with typeahead, faceted filters with live counts, sorting, pagination
- **Product** — gallery, variant picker with per-combination stock, spec table, related products, reviews
- **Reviews** — write, edit and delete your own; verified-purchase badges
- **Cart & wishlist** — drawer, quantity limits, revalidation on load
- **Checkout** — one page: contact, delivery address, shipping method, billing address, payment. Discount codes, a live summary, and a ten-minute stock hold
- **Account** — profile, address book, order history with per-order detail

</details>

<details open>
<summary><b>🧑‍💼 Admin</b></summary>

- **Catalogue** — products with media, variants and option matrices, brands, categories (drag-ordered tree), attributes, variant options, tags
- **Collections** — manual and dynamic, with a rule builder and live preview
- **Inventory** — stock levels, adjustments with a reason ledger, low-stock views
- **Orders & payments** — read screens over real orders, a status machine that refuses illegal moves, payment records and reconciliation
- **Discounts** — product, order and shipping codes with eligibility, minimums, usage limits, combination rules and scheduling
- **Customers** — accounts, their orders, addresses and reviews
- **Reviews & testimonials** — moderation for the first, curation for the second
- **Dashboard** — revenue, orders, top products, low stock — plus ⌘K everywhere

</details>

<details>
<summary><b>⚙️ API modules</b></summary>

```
account      addresses    attributes   auth         brands       cart
categories   checkout     collections  customers    dashboard    discounts
home         inventory    orders       payments     products     reviews
search       tags         testimonials uploads      variant-options  wishlist
```

</details>

---

## Architecture

```
apps/
  api/          Express 5 · Zod validation · Prisma · pino · JWT
  admin/        React 19 · Vite · Tailwind v4 · shadcn · TanStack Query
  storefront/   React 19 · Vite · Tailwind v4 · its own design system
packages/
  db/           Prisma schema, 14 migrations, seed
scripts/verify/ API and Playwright suites, one per phase
```

The two SPAs are deliberately independent — separate component libraries,
separate design languages, separate refresh cookies — so an admin session and a
customer session can coexist in one browser and neither app's styling constrains
the other.

---

## The decisions worth knowing

**Stock cannot oversell.** A checkout reserves inventory with a conditional
`UPDATE … WHERE quantity - reserved >= n`. Affected rows decide the outcome —
never a `SELECT` followed by an `UPDATE`. Holds carry a ten-minute TTL, released
lazily when anyone looks and by a sweep for the sessions nobody returns to.

**Payments cannot double-charge.** An `Idempotency-Key` unique index settles
duplicates by insert-and-catch, not check-then-insert. The provider's **webhook**
is the only thing that creates an order; the browser saying "success" creates
nothing. Payments the provider never confirms are reconciled on a schedule.

**Orders are snapshots.** Title, SKU, options, unit price and discount code are
copied onto `order_items` at purchase. An order renders correctly in five years,
after the product has been renamed, repriced and archived.

**Money is decided in one function.** `quoteSession()` computes subtotal, line
discounts, order discount, shipping and shipping discount in that order, because
each feeds the next. The client renders strings and adds nothing up.

**The access token never touches storage.** It lives in a module variable and
dies with the tab; the refresh token is an httpOnly cookie scoped per app.
Refresh rotates destructively, replay revokes that one session, and the client
single-flights refreshes so ten parallel 401s cost exactly one refresh call.

**Login answers vaguely on purpose.** Unknown email, wrong password and a
customer at the admin door all return the same `401`, with a real argon2 verify
against a dummy hash so the timing matches.

---

## Verification

Every phase ships an executable check — an API suite, a Playwright suite, or
both. They run against the dev servers and clean up after themselves.

```bash
node scripts/verify/discounts-checkout.mjs      # 25 checks
node scripts/verify/discounts-limits.mjs        # 18
node scripts/verify/discounts-shipping.mjs      # 18
node scripts/verify/discounts-order.mjs         # 17
node scripts/verify/shipping-methods-api.mjs    # 19
node scripts/verify/phase-13-api.mjs            # catalogue, facets, search
```

They are not decoration — they have caught a Radix trigger silently submitting a
form, a Prisma `select` missing a field the type claimed was there, and a cart
that reordered itself when a discount was applied.

---

## Commands

```bash
npm run dev:api | dev:admin | dev:shop        # development
npm run build:api | build:admin | build:shop  # production build

npm run db:migrate     # create and apply a migration
npm run db:deploy      # apply pending migrations
npm run db:seed        # admin + dev fixtures
npm run db:studio      # Prisma Studio

npm run services:up    # postgres, minio, redis
npm run services:down
```

---

## Status

**Working end to end**: browse → cart → checkout → reserve stock → pay → webhook
→ order, with discounts, and the admin to run it.

**Known gaps**, in the order they'd block going live:

| | |
|---|---|
| 📧 **Email** | Nothing is sent. Verification tokens are returned by the API instead of mailed |
| 💸 **Refunds** | The statuses exist; no money moves |
| 💳 **Real gateway** | The provider is a mock that signs its own webhooks — the path is real, the gateway isn't |
| 🧾 **Tax** | `taxAmount` is written zero, by decision |
| 🤖 **CI** | The verify suites are excellent and entirely manual |
| 🔭 **Monitoring** | A 500 in production would be invisible |
| 🔍 **SEO** | Phase 19 — page titles, JSON-LD, sitemap, error boundaries |

Redis now backs the rate-limit counters, so a limit means the same thing
across every API process. `REDIS_URL` is **required** and validated at boot
alongside `DATABASE_URL` — there is no fallback path, because the behaviour it
would fall back to (a login limit that means something different on every
instance) is wrong rather than merely slower. Redis going down at runtime is a
separate matter and is handled: requests pass, loudly logged, never 500. Still
to come, in `platform-implementation-order.md`: the job runtime, the email
queue, and the read caches.

<div align="center">
<br />
<sub>Built with an unreasonable amount of attention to the checkout.</sub>
</div>

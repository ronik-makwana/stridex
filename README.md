<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
  <img src="docs/assets/logo-light.svg" alt="StrideX" width="300">
</picture>

<br />
<br />

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

![Razorpay](https://img.shields.io/badge/Razorpay-0C2451?style=for-the-badge&logo=razorpay&logoColor=white)
![Redis](https://img.shields.io/badge/Redis_·_BullMQ-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![MinIO](https://img.shields.io/badge/MinIO-C72E49?style=for-the-badge&logo=minio&logoColor=white)

</div>

---

## Contents

| | |
|---|---|
| **Getting started** | [What it is](#what-it-is) · [Requirements](#requirements) · [Quick start](#quick-start) · [Configuration](#configuration) · [Ports](#ports) |
| **The code** | [What's built](#whats-built) · [Architecture](#architecture) · [The decisions worth knowing](#the-decisions-worth-knowing) |
| **Working on it** | [Commands](#commands) · [Status](#status) |

---

## What it is

A full e-commerce build in one monorepo — customer storefront, staff admin, and
the API both talk to.

| | |
|---|---|
| 🛍️ **Storefront** | Browse, filter, search, review, cart, wishlist, checkout, pay, account, cancel, return |
| 🧑‍💼 **Admin** | Catalogue, variants, inventory, orders, payments, refunds, customers, reviews, discounts |
| ⚙️ **API** | 27 modules, 50 tables, money and stock decided server-side, always |

The rules in [`ecommerce_frontend_backend_rules.md`](ecommerce_frontend_backend_rules.md)
about inventory, payments, idempotency and order state are implemented and
verified — 26 of 27, with tax (rule 21) the one remaining gap.

---

## Requirements

| | |
|---|---|
| **Node** | 22 or newer — enforced by `engines`, and what CI runs |
| **Docker** | for Postgres, Redis, MinIO and Mailpit via `docker-compose.yml` |
| **A Razorpay test account** | keys are free; checkout will not start without them |

---

## Quick start

```bash
npm install
cp .env.example apps/api/.env       # then fill in the secrets — see Configuration
npm run services:up                 # postgres, minio, redis, mailpit
npm run db:generate                 # the Prisma client is gitignored
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

## Configuration

`.env.example` is the whole surface, annotated. Three groups need your attention
before anything works end to end:

| | |
|---|---|
| 🔑 **JWT secrets** | `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` — 32 characters minimum, and different from each other |
| 💳 **Razorpay** | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. All three are required — the API refuses to boot without them, rather than failing at the first Pay on a 401 nobody can read. A `rzp_live_*` key outside production is refused too |
| 🗄️ **Infrastructure** | `DATABASE_URL` and `REDIS_URL` are validated at startup and have no fallback path |

Everything is parsed through a Zod schema in
[`apps/api/src/config/env.ts`](apps/api/src/config/env.ts) before the server
opens a port, so a missing or malformed variable is a startup error with a name
in it — never a `undefined` that surfaces three screens into a checkout.

### Webhooks in development

Razorpay has to reach your machine. `npm run tunnel -w apps/api` opens a
Cloudflare tunnel to :4000; point the dashboard's webhook URL at
`https://<tunnel>/api/webhooks/razorpay` and use the same secret you put in
`RAZORPAY_WEBHOOK_SECRET`.

---

## Ports

| Service | Port | Note |
|---|---|---|
| API | `4000` | |
| Storefront | `5174` | |
| Admin | `5175` | |
| Postgres | `5433` | 5432 was taken locally — change it back in `docker-compose.yml` and the `DATABASE_URL`s if yours is free |
| MinIO | `9000` / `9001` | object storage for product media |
| Redis | `6379` | shared rate-limit counters and the job queue; AOF-persisted. Required |
| Mailpit | `1025` / `8025` | SMTP sink for development — read the mail at :8025 |

---

## What's built

<details open>
<summary><b>🛍️ Storefront</b></summary>

- **Home** — full-height hero, department tiles, a scrolling top-categories band, curated collections, testimonials
- **Catalogue** — category pages, collections (manual and rule-driven), search with typeahead, faceted filters with live counts, sorting, pagination
- **Product** — gallery, variant picker with per-combination stock, spec table, related products, reviews
- **Reviews** — write, edit and delete your own; verified-purchase badges
- **Cart & wishlist** — drawer, quantity limits, revalidation on load
- **Checkout** — one page: contact, delivery address, shipping method, billing address, payment. Discount codes, a live summary, a ten-minute stock hold, and Razorpay Checkout for the payment itself
- **Account** — profile, address book, order history with per-order detail
- **After the sale** — cancel an unshipped order yourself, or request a return inside the window; both refund through the provider
- **SEO** — per-route titles and meta, product JSON-LD, a generated `sitemap.xml` and `robots.txt`

</details>

<details open>
<summary><b>🧑‍💼 Admin</b></summary>

- **Catalogue** — products with media, variants and option matrices, brands, categories (drag-ordered tree), attributes, variant options, tags
- **Collections** — manual and dynamic, with a rule builder and live preview
- **Inventory** — stock levels, adjustments with a reason ledger, low-stock views
- **Orders & payments** — read screens over real orders, a status machine that refuses illegal moves, payment records and reconciliation
- **Refunds** — full and partial, against the original payment, with a reason trail and provider reconciliation
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
home         inventory    mail         orders       payments     products
refunds      reviews      search       seo          tags         testimonials
uploads      variant-options           wishlist
```

</details>

---

## Architecture

```
apps/
  api/          Express 5 · Zod validation · Prisma · pino · JWT
                two entrypoints: server.ts (HTTP) and worker.ts (BullMQ)
  admin/        React 19 · Vite · Tailwind v4 · shadcn · TanStack Query
  storefront/   React 19 · Vite · Tailwind v4 · its own design system
packages/
  db/           Prisma schema, 15 migrations, seed
.github/        CI: lint, types and builds
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
duplicates by insert-and-catch, not check-then-insert. Razorpay's signed
**webhook** is the only thing that creates an order; the browser saying
"success" creates nothing. Payments the provider never confirms are reconciled
on a schedule.

**Orders are snapshots.** Title, SKU, options, unit price and discount code are
copied onto `order_items` at purchase. An order renders correctly in five years,
after the product has been renamed, repriced and archived.

**Money is decided in one function.** `quoteSession()` computes subtotal, line
discounts, order discount, shipping and shipping discount in that order, because
each feeds the next. The client renders strings and adds nothing up.

**Refunds are counted, not trusted.** What has already gone back is summed from
the refund rows before a new one is allowed, so a partial refund issued twice
cannot exceed the captured amount — and a refund made in the Razorpay dashboard
is reconciled back into the same ledger.

**The access token never touches storage.** It lives in a module variable and
dies with the tab; the refresh token is an httpOnly cookie scoped per app.
Refresh rotates destructively, replay revokes that one session, and the client
single-flights refreshes so ten parallel 401s cost exactly one refresh call.

**Login answers vaguely on purpose.** Unknown email, wrong password and a
customer at the admin door all return the same `401`, with a real argon2 verify
against a dummy hash so the timing matches.

**The process says what it can do.** `/health` stays 200 while the process is
alive — a load balancer should not evict a healthy instance because a dependency
blinked. `/ready` is the one that checks the database and Redis and answers
honestly.

---

## Commands

```bash
npm run dev:api | dev:admin | dev:shop        # development
npm run dev:worker                            # background jobs, if run separately
npm run build:api | build:admin | build:shop  # production build

npm run lint | lint:fix                       # eslint
npm run typecheck                             # all three apps
npm run format | format:check                 # prettier

npm run job -w apps/api -- checkout.expiry    # run one job now, no broker
npm run mail:test -w apps/api -- you@x.com    # send a test email through the queue
npm run tunnel -w apps/api                    # expose :4000 for provider webhooks

npm run db:generate    # the Prisma client — gitignored, needed after a fresh clone
npm run db:migrate     # create and apply a migration
npm run db:deploy      # apply pending migrations
npm run db:seed        # admin + dev fixtures
npm run db:studio      # Prisma Studio

npm run services:up    # postgres, minio, redis, mailpit
npm run services:down
```

---

## Status

**Working end to end**: browse → cart → checkout → reserve stock → pay with
Razorpay → webhook → order → cancel or return → refund, with discounts, email at
every step, and the admin to run it.

**Known gaps**, in the order they'd block going live:

| | |
|---|---|
| 🧾 **Tax** | `taxAmount` is written zero, by decision. It is a column and a line in the summary waiting for a rate table |
| 📦 **Tracking** | Orders have no tracking-number field, so the shipped email tells the customer it shipped and nothing more |
| 🔭 **Monitoring** | Structured pino logs and `/health` + `/ready` exist; nothing ships them anywhere. A 500 in production would be recorded and unwatched |
| 📧 **Email** | Sends through the queue — verification, reset, welcome, order confirmation, shipped, cancelled. No bounce handling |
| 🎨 **Formatting** | `format:check` is deliberately not a CI step yet: Prettier agrees with this codebase but would rewrite 243 files on first contact, and that deserves its own commit |

Redis backs the rate-limit counters and the job queue, so a rate limit and a
scheduled sweep each mean the same thing across every API process — where
before, N instances ran N sweeps per interval. `REDIS_URL` is **required** and
validated at boot alongside `DATABASE_URL`; there is no fallback path, because
the behaviour it would fall back to (a login limit that means something
different on every instance) is wrong rather than merely slower. Redis going
down at runtime is a separate matter and is handled: requests pass, loudly
logged, never 500.

---

## Reference

| Document | What's in it |
|---|---|
| [`ecommerce_frontend_backend_rules.md`](ecommerce_frontend_backend_rules.md) | The 27 rules this build is measured against |
| [`repo-structure.md`](repo-structure.md) | Where everything lives and why |
| [`platform-spec.md`](platform-spec.md) | Every table and every endpoint, admin and storefront |

<div align="center">
<br />
<sub>Built with an unreasonable amount of attention to the checkout.</sub>
</div>

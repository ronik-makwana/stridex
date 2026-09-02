# Shoe E-Commerce — Repository Structure

One shared backend. Two fully independent frontends with nothing shared between them.

```
shoe/
├── apps/
│   ├── api/            Express 5      api.shoe.com    :4000
│   ├── admin/          Vite SPA       admin.shoe.com  :5173
│   └── storefront/     Vite SPA       shoe.com        :5174
├── packages/
│   └── db/             Prisma schema, migrations, seed
├── docker-compose.yml
├── package.json
└── .env.example
```

Only one shared package, and only the API touches it. `admin` and `storefront` share no code, no components, no types, no config. Each owns its own everything.

---

## Root

```json
{
  "name": "shoe",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "dev:api": "npm run dev -w apps/api",
    "dev:admin": "npm run dev -w apps/admin",
    "dev:shop": "npm run dev -w apps/storefront",
    "build:api": "npm run build -w apps/api",
    "build:admin": "npm run build -w apps/admin",
    "build:shop": "npm run build -w apps/storefront",
    "db:migrate": "npm run migrate -w packages/db",
    "db:seed": "npm run seed -w packages/db",
    "db:studio": "npm run studio -w packages/db",
    "services:up": "docker compose up -d",
    "services:down": "docker compose down"
  }
}
```

Run each app in its own terminal. With nothing shared between the frontends there is no build ordering to orchestrate, so Turborepo is optional here. Skip it until CI time actually annoys you.

---

## packages/db

The only shared package, and only `apps/api` consumes it.

```
packages/db/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   ├── sql/
│   │   ├── 001_extensions.sql        pgcrypto, pg_trgm, unaccent
│   │   ├── 002_trgm_indexes.sql      GIN on products.title, variants.sku
│   │   └── 003_partial_indexes.sql   one default address per user
│   └── seed.ts
├── src/
│   ├── client.ts                     PrismaClient + PrismaPg adapter
│   ├── generated/                    gitignored
│   └── index.ts
├── prisma.config.ts
└── package.json
```

```json
{
  "name": "@shoe/db",
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "generate": "prisma generate",
    "migrate": "prisma migrate dev && prisma generate",
    "deploy": "prisma migrate deploy && prisma generate",
    "seed": "prisma db seed",
    "studio": "prisma studio",
    "postinstall": "prisma generate"
  }
}
```

If you want literally zero shared packages, move this inside `apps/api/prisma/` and drop workspaces entirely. The only cost is that standalone scripts outside the API can no longer import the client.

---

## apps/api

One server, two route trees, two sets of schemas, two sets of serializers.

```
apps/api/src/
├── modules/
│   ├── auth/
│   │   ├── auth.service.ts           shared login logic
│   │   ├── auth.tokens.ts            sign, verify, rotate refresh
│   │   ├── admin.auth.controller.ts  rejects if role is not ADMIN | STAFF
│   │   └── shop.auth.controller.ts   rejects if role is not CUSTOMER
│   ├── users/
│   ├── brands/
│   ├── categories/
│   ├── attributes/
│   ├── variant-options/
│   ├── products/
│   │   ├── products.service.ts       shared query and write logic
│   │   ├── products.variants.ts      generate, dry run, additive merge
│   │   ├── products.media.ts         presign, record, reorder
│   │   ├── admin.products.controller.ts
│   │   └── shop.products.controller.ts
│   ├── collections/
│   │   └── rules.engine.ts           rules to Prisma where
│   ├── inventory/
│   │   └── inventory.service.ts      FOR UPDATE + ledger, one transaction
│   ├── orders/
│   ├── payments/
│   │   └── webhook.controller.ts     idempotent, signature verified
│   ├── cart/                         storefront only, incl. merge on login
│   ├── wishlist/                     storefront only
│   ├── checkout/                     storefront only
│   └── dashboard/                    admin only
├── schemas/
│   ├── admin/                        Zod, admin request shapes
│   └── shop/                         Zod, storefront request shapes
├── serializers/
│   ├── admin/                        full payloads: drafts, costs, inventory
│   └── shop/                         ACTIVE only, trimmed, no internals
├── middleware/
│   ├── auth.ts                       verify access token, attach req.user
│   ├── requireRole.ts
│   ├── validate.ts                   Zod body / query / params
│   ├── errorHandler.ts               P2002→409, P2003→422, P2025→404, Zod→400
│   └── rateLimit.ts
├── lib/
│   ├── prisma.ts                     re-export from @shoe/db
│   ├── s3.ts                         presigned PUT
│   ├── redis.ts                      required; one client + a BullMQ factory
│   ├── queue.ts                      queues, job options, worker heartbeat
│   ├── logger.ts
│   └── errors.ts
├── jobs/
│   ├── index.ts                      the registry: what runs in the background
│   └── run.ts                        one job, once, from the CLI — no broker
├── routes/
│   ├── admin.routes.ts               mounts /api/admin/*
│   └── shop.routes.ts                mounts /api/storefront/*
├── types/express.d.ts
├── app.ts
├── server.ts                         the API process
└── worker.ts                         the job process

apps/api/tests/
├── integration/                      Supertest + Testcontainers
└── unit/                             services, rules engine, variant generate
```

`server.ts` and `worker.ts` are two entrypoints over one codebase, not two services. The worker imports the same modules and the same Prisma client; what differs is that it processes the queue instead of serving HTTP. In development it runs inside the API process (`RUN_WORKER_INLINE`) so there is still one command to start; in production it is a separate deployment, and `/health` reports whether it is alive.

Services are shared inside the API. Controllers, schemas and serializers split by audience. `productService.findMany()` is one function, but the admin controller returns drafts and cost fields while the shop controller returns only `ACTIVE` products with a public payload.

That split is the whole point. A shared serializer is how inventory internals end up on a public product page.

---

## apps/admin

Self-contained Vite SPA. Own Tailwind config, own shadcn install, own types.

```
apps/admin/
├── src/
│   ├── routes/
│   │   ├── index.tsx                 route tree + guards
│   │   ├── login.tsx
│   │   ├── dashboard/
│   │   ├── products/                 list, editor, variants, media
│   │   ├── categories/               tree + drawer
│   │   ├── brands/
│   │   ├── attributes/
│   │   ├── variant-options/
│   │   ├── collections/              list, editor, rule builder
│   │   ├── inventory/                list, adjust, transactions, low stock
│   │   ├── orders/
│   │   ├── payments/
│   │   ├── customers/
│   │   └── settings/
│   ├── components/
│   │   ├── ui/                       own shadcn primitives
│   │   ├── data-table/               TanStack Table wrapper, filters, bulk bar
│   │   ├── entity-drawer.tsx
│   │   ├── confirm-dialog.tsx
│   │   ├── media-uploader.tsx        presign → direct PUT → record
│   │   ├── slug-field.tsx
│   │   ├── status-badge.tsx
│   │   ├── category-tree.tsx         dnd-kit
│   │   ├── variant-grid.tsx          spreadsheet behaviour
│   │   ├── rule-builder.tsx
│   │   └── empty-state.tsx
│   ├── features/                     one folder per domain
│   │   └── products/
│   │       ├── api.ts                fetchers
│   │       ├── queries.ts            useProducts, useProduct
│   │       ├── mutations.ts          useCreateProduct, useGenerateVariants
│   │       └── schemas.ts            own Zod, admin shapes
│   ├── layouts/AdminLayout.tsx       sidebar, topbar, ⌘K
│   ├── types/api.ts                  own types
│   ├── lib/
│   │   ├── api-client.ts             axios + refresh interceptor
│   │   ├── auth.ts                   token store, useAuth
│   │   └── query-client.ts
│   ├── styles/globals.css
│   └── main.tsx
├── tailwind.config.ts
├── components.json                   shadcn config
├── vite.config.ts
├── tsconfig.json
└── package.json
```

Stack: React 19, React Router 7, TanStack Query, TanStack Table, RHF + Zod, shadcn/ui, Tailwind v4, dnd-kit, nuqs, Recharts, TipTap, sonner, lucide-react.

---

## apps/storefront

Self-contained Vite SPA. Own design system, own everything. Same tooling as admin, entirely separate codebase.

```
apps/storefront/
├── src/
│   ├── routes/
│   │   ├── index.tsx                 route tree + guards
│   │   ├── home.tsx
│   │   ├── category.tsx              /c/:slug
│   │   ├── product.tsx               /p/:slug
│   │   ├── collection.tsx            /collections/:slug
│   │   ├── search.tsx
│   │   ├── auth/                     login, register, forgot-password
│   │   └── account/                  guarded
│   │       ├── cart.tsx    checkout.tsx
│   │       ├── orders.tsx  addresses.tsx  wishlist.tsx
│   ├── components/
│   │   ├── ui/                       own shadcn primitives, own tokens
│   │   ├── product-card.tsx
│   │   ├── image-gallery.tsx
│   │   ├── size-picker.tsx
│   │   ├── filter-sidebar.tsx
│   │   ├── cart-drawer.tsx
│   │   ├── price.tsx
│   │   ├── seo.tsx                   react-helmet-async, per-page meta
│   │   ├── header.tsx
│   │   └── footer.tsx
│   ├── features/
│   │   ├── catalog/                  queries for products, categories, filters
│   │   ├── cart/                     local until login, then merge
│   │   ├── wishlist/
│   │   └── checkout/
│   ├── layouts/
│   │   ├── ShopLayout.tsx            header, nav, cart drawer, footer
│   │   └── AuthLayout.tsx
│   ├── types/api.ts                  own types, storefront shapes only
│   ├── lib/
│   │   ├── api-client.ts             axios + refresh interceptor
│   │   ├── auth.ts                   token store, useAuth
│   │   ├── local-cart.ts             variantId + quantity only, never price
│   │   ├── query-client.ts
│   │   └── format.ts
│   ├── styles/globals.css
│   └── main.tsx
├── tailwind.config.ts
├── components.json                   shadcn config
├── vite.config.ts
├── tsconfig.json
└── package.json
```

Stack: React 19, React Router 7, TanStack Query, RHF + Zod, shadcn/ui, Tailwind v4, react-helmet-async, embla-carousel, sonner, lucide-react.

Route guard on `/cart`, `/checkout` and `/account/*`. Same `RequireAuth` pattern as admin, checking for `role: CUSTOMER`.

### The SEO tradeoff

A Vite SPA ships an empty HTML shell and renders on the client. Google does execute JavaScript, so pages get indexed, but slower and less reliably than server-rendered HTML, and social link previews break entirely without meta tags in the initial response.

Three ways to handle it, cheapest first:

1. **`react-helmet-async` plus `vite-plugin-sitemap`.** Per-page title, description, canonical and Open Graph tags. Covers the basics, still client rendered.
2. **`vite-plugin-ssr` / `vike` prerendering.** Build-time prerender of product and category pages into static HTML from the API. Keeps the SPA model, gives crawlers real HTML. Needs a rebuild or a webhook when the catalog changes.
3. **Prerender proxy** (Prerender.io or a small Puppeteer service) that serves rendered HTML to bots only. No code change, a monthly cost.

Start with option 1. Add option 2 when organic traffic actually matters. If the store is invite-only, B2B or wholesale, none of this matters and the plain SPA is correct.

---

## What "no sharing" costs you

Worth naming so nothing surprises you in month three.

**Types are duplicated.** Both apps hand-write their own request and response types. Rename `compare_at_price` and three places change, but TypeScript only catches two.

Mitigation that keeps the apps independent: generate types from the API rather than sharing a package. Add `zod-to-openapi` + `swagger-ui-express` to the API, then in each frontend:

```json
"scripts": {
  "gen:api": "openapi-typescript http://localhost:4000/openapi.json -o src/types/api.ts"
}
```

Each app runs it separately and commits its own generated file. No shared package, no coupling, and a field rename still becomes a type error in both apps.

**Design drift.** Admin and storefront buttons will diverge. Usually fine, since they are different products for different people, but decide now whether you care.

**Duplicated auth client.** Refresh interceptor, token store and login flow get written twice, roughly 100 lines each. Acceptable.

---

## Local services

```yaml
services:
  postgres:
    image: postgres:17-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: shoe
    volumes: ["pgdata:/var/lib/postgresql/data"]

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    ports: ["9000:9000", "9001:9001"]
    environment:
      MINIO_ROOT_USER: minio
      MINIO_ROOT_PASSWORD: minio123
    volumes: ["miniodata:/data"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

volumes: { pgdata: {}, miniodata: {} }
```

---

## Environment

```bash
# apps/api/.env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shoe
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=7d
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=shoe-media
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio123
REDIS_URL=redis://localhost:6379
CORS_ORIGINS=http://localhost:5173,http://localhost:5174

# apps/admin/.env
VITE_API_URL=http://localhost:4000/api/admin

# apps/storefront/.env
VITE_API_URL=http://localhost:4000/api/storefront
```

Prisma 7 does not auto-load env files. `import 'dotenv/config'` at the top of `prisma.config.ts` and `server.ts`.

---

## Ports

| Service | Port |
|---|---|
| api | 4000 |
| admin | 5173 |
| storefront | 5174 |
| postgres | 5432 |
| minio | 9000 / 9001 |
| redis | 6379 |

---

## Conventions

**Files** kebab-case. **Components** PascalCase. **Hooks** `use` prefix.

**Commits** conventional: `feat(products): additive variant generate`.

**Never import across apps.** No `../../admin/components` from the storefront, ever. If you want to, copy the file. That is the deal this structure makes.

**Every stock write** goes in a `$transaction` with `SELECT ... FOR UPDATE` on the inventory row plus a matching `inventory_transactions` insert. No exceptions, or the ledger stops being trustworthy.

**Auth:** one `users` table with `role`, one `user_sessions` table, one `authService.login()`. Two controllers that check role before issuing a token. Cookies scoped to different subdomains so an admin session and a customer session coexist in one browser.

---

## Build order

1. `packages/db` — schema, migrations, raw SQL indexes, seed
2. `apps/api` — shell, middleware, error handler, auth module
3. `apps/admin` — shell, DataTable, then brands, attributes, variant options
4. `apps/admin` — categories tree, then products (a third of the work)
5. `apps/api` + `apps/admin` — inventory, collections, orders, payments
6. `apps/storefront` — needs a populated catalog, so it comes last

Steps 1 to 4 give you a working catalog. Everything after is additive.

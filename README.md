# Shoe

Shoe e-commerce monorepo. One Express API, two independent Vite SPAs, one Prisma package.

See [implementation-order.md](implementation-order.md) for the build plan and
[repo-structure.md](repo-structure.md) for the layout and its rationale.

**Status: Phase 0 complete.** Database, API shell, and admin auth are in place.
Catalog modules start at Phase 1.

---

## Getting started

```bash
npm install
cp .env.example apps/api/.env       # then fill in the two JWT secrets
npm run services:up                 # postgres, minio, redis
npm run db:migrate
npm run db:seed
```

Then, in two terminals:

```bash
npm run dev:api      # http://localhost:4000
npm run dev:admin    # http://localhost:5173
```

Sign in with `admin@shoe.com` / `Admin@12345`.

### Ports

| Service | Port | Note |
|---|---|---|
| api | 4000 | |
| admin | 5173 | |
| storefront | 5174 | Part C |
| postgres | **5433** | 5432 was already taken locally; change it back in `docker-compose.yml` and the `DATABASE_URL`s if yours is free |
| minio | 9000 / 9001 | |
| redis | 6379 | |

---

## What Phase 0 ships

**`packages/db`** — the full schema from the spec (32 tables), one migration, and
a seed. The migration includes the raw SQL that Prisma cannot express: the
`pgcrypto` / `pg_trgm` / `unaccent` extensions, GIN trigram indexes on
`products.title` and `product_variants.sku`, and the partial unique index that
enforces one default address per user. Because those are inlined into
`migration.sql`, `prisma migrate deploy` builds a correct database from empty.

Two Prisma 7 notes worth carrying forward:

The connection URL is no longer allowed in `schema.prisma`. It lives in
`prisma.config.ts` for Migrate and in the `PrismaPg` adapter for the runtime
client.

**Raw SQL in a migration is not enough to keep an index.** Migrate diffs the
database against `schema.prisma`, so an index it can see but the schema does not
declare is one it emits a `DROP INDEX` for on the next `migrate dev` — which is
exactly what it tried to do to all four trigram indexes here. They are now
declared in the schema as well, with `map:` pinning the names to match the raw
SQL. Partial indexes are the opposite case: Prisma cannot express a `WHERE`
clause and its diff ignores them, so those stay in raw SQL only. Both files in
`prisma/sql/` carry a header saying which rule they fall under.

Verified by deploying the migration into an empty database: all 7 custom
indexes, all 3 extensions, and an empty diff afterwards.

**`apps/api`** — Express 5 on ESM, `tsx` in dev and `tsup` for the build.
`validate()` parses body/query/params with Zod and replaces them with the coerced
output. The error handler maps `P2002 → 409` with the offending column as a field
error, `P2003 → 422` with a reason the delete dialog can show, `P2025 → 404`, and
`ZodError → 400`. pino, helmet, cors with credentials, three tiers of rate limit,
cookie-parser.

**Auth** — one `authService.login()` shared by both audiences, with the caller
passing the roles it accepts. That is what makes it safe to expose the same logic
at `/api/admin/auth/login` and, later, at `/api/storefront/auth/login`.

```
POST /api/admin/auth/login            ADMIN | STAFF only
POST /api/admin/auth/refresh
POST /api/admin/auth/logout
GET  /api/admin/auth/me
POST /api/admin/auth/forgot-password
POST /api/admin/auth/reset-password
```

**`apps/admin`** — Vite, React 19, Tailwind v4, React Router 7, TanStack Query,
RHF + Zod, shadcn primitives. Login, forgot/reset password, 403, the
`RequireRole` guard, `AdminLayout` with the sidebar, an empty dashboard, and the
session-expired modal.

---

## The three decisions worth knowing

**The access token never touches storage.** It lives in a module variable in
`lib/auth-store.ts` and dies with the tab. The refresh token is an httpOnly
cookie the app cannot read, scoped to `/api/admin/auth` and named
`shoe_admin_refresh` so an admin session and a customer session coexist in one
browser. A page reload restores the session by calling `/auth/refresh`, not by
reading a token off disk. XSS therefore has 15 minutes and no way to persist.

**Refresh rotates, and rotation is destructive.** Each refresh issues a new token
and overwrites `user_sessions.refresh_token_hash` in place. A token that arrives
with a valid signature but a stale hash was already rotated away — a replay — and
the server revokes that session. It revokes only that one, not every session for
the user: a second tab racing the refresh reaches the same branch, and signing
someone out of every device for that is worse than the attack it prevents.

That makes concurrent refreshes dangerous, so `api-client.ts` guarantees they
cannot happen. `refreshSession()` is the only caller of the endpoint, it
single-flights the in-flight promise, and app bootstrap goes through it too —
React StrictMode's double-mount is by itself enough to trip reuse detection
otherwise. A 401 arriving after a refresh has already finished is recognised as
stale (the stored token no longer matches what the request was signed with) and
simply retried, rather than starting a second refresh. Ten simultaneous requests
with an expired token cost exactly one refresh call.

**Login answers vaguely on purpose.** Unknown email, wrong password, and a
customer account at the admin door all return the same `401 Invalid email or
password`, and an unknown email still runs a real argon2 verify against a dummy
hash so the timing matches. Only after the password checks out will the API admit
that an account is suspended (`403`). Forgot-password returns the same `202`
whether or not the account exists; in development the reset token goes to the API
log, never to the response.

---

## Verifying it

```bash
npm run typecheck -w @shoe/api
npm run typecheck -w @shoe/admin
npm run build -w @shoe/admin
```

Phase 0 is done when you sign in, land on the dashboard, survive a hard refresh,
and stay signed in after the access token expires. All four are verified, along
with the cookie flags, the redirect guards in both directions, logout, and the
customer-at-the-admin-door rejection.

### Dev fixtures

| Email | Password | Purpose |
|---|---|---|
| `admin@shoe.com` | `Admin@12345` | the real admin |
| `shopper@shoe.com` | `Customer@12345` | CUSTOMER — must be refused at the admin login |
| `benched@shoe.com` | `Customer@12345` | SUSPENDED STAFF — must get a 403, not a 401 |

The last two are seeded only when `NODE_ENV !== 'production'`.

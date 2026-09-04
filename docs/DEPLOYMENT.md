# Deploying StrideX for free

Five accounts, no card except Cloudflare's, about 40 minutes end to end.

| Piece | Host | Free allowance |
|---|---|---|
| API + worker | Render web service | 750 instance-hours/month, sleeps after 15 min idle |
| Redis | Render Key Value | 25 MB, no persistence, no command cap |
| Postgres | Neon | 0.5 GB, 100 compute-hours/month, no expiry |
| Product media | Cloudflare R2 | 10 GB, no egress charges |
| Storefront + admin | Vercel × 2 | Hobby plan, non-commercial |
| Email | Brevo SMTP | 300/day |
| Payments | Razorpay **test** keys | free |

Deploy in the order below — each step needs a value from the one before it.

---

## Why the pieces are arranged this way

Three constraints in this codebase rule out the obvious arrangement, and it is
worth knowing them before something fails and looks inexplicable.

**Redis is not optional.** `config/env.ts` refuses to boot without `REDIS_URL`,
because the rate limiters share their counters through it and BullMQ will not
start without it. That rules out the usual free pick, Upstash: its free tier is
500K commands/month, and BullMQ spends commands per *poll*, not per job. Two
workers blocking on empty queues burn roughly a million a month doing nothing at
all. Render's free Key Value has no command cap, so it is the one that survives.

**Postgres is not on Render.** Render's free Postgres is deleted 30 days after
creation. A portfolio link that dies a month after you post it is worse than no
link. Neon's free tier has no expiry; it suspends after 5 minutes idle and
resumes on the next query in well under a second.

**The SPAs proxy `/api` rather than calling it cross-origin.** The refresh token
is an httpOnly cookie with `SameSite=Lax`. Served from `stridex.vercel.app` while
the API sits on `stridex-api.onrender.com`, that cookie is cross-site and the
browser never sends it — login appears to work, then every refresh fails, and in
Safari it fails from the first request. Each `vercel.json` rewrites `/api/*` to
Render, so the browser only ever sees one origin. The cookie paths already line
up (`/api/storefront/auth`, `/api/admin/auth`), CORS stops mattering, and
`SameSite=Lax` stays as it is — which is the stronger setting.

---

## 1. Neon — Postgres

1. Create a project at [neon.tech](https://neon.tech). Pick the region nearest
   the one you will use on Render.
2. Copy the **pooled** connection string. Keep it as `DATABASE_URL`.

Nothing to migrate by hand — the Render build runs `prisma migrate deploy`.

## 2. Cloudflare R2 — product media

R2 asks for a card on file even on the free plan; it is not charged within the
10 GB allowance.

1. **R2 → Create bucket**, named `stridex`.
2. **Settings → Public access → R2.dev subdomain → Allow.** Copy the
   `https://pub-<hash>.r2.dev` URL — that is `S3_PUBLIC_URL`, and note it has
   **no bucket segment in it**.
3. **Settings → CORS policy.** Without this the admin's direct-to-storage
   uploads fail a preflight. Paste, substituting your admin URL once you have it
   from step 5:

   ```json
   [
     {
       "AllowedOrigins": ["https://stridex-admin.vercel.app"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

4. **R2 → API → Create API token**, Object Read & Write, scoped to this bucket.
   Copy the Access Key ID, Secret Access Key, and the endpoint
   `https://<account-id>.r2.cloudflarestorage.com`.

The bucket is created and made public *here*, not by the app: R2 does not
implement `PutBucketPolicy`, which is why `S3_MANAGED_BUCKET=true` exists and
must be set.

## 3. Brevo — email

Production boot refuses an empty `SMTP_HOST` and refuses a `@stridex.local`
sender, because either one means every verification link is logged and none is
delivered while every job still reports success.

Sign up at [brevo.com](https://www.brevo.com), verify a sender address (a Gmail
address is fine — no domain needed), then **SMTP & API → SMTP** for:

- `SMTP_HOST` `smtp-relay.brevo.com`, `SMTP_PORT` `587`
- `SMTP_USER` — the login shown on that page
- `SMTP_PASSWORD` — the SMTP key, not your account password
- `MAIL_FROM` — `StrideX <your-verified@address>`

## 4. Vercel — the two SPAs

Before Render, not after. A `vercel.json` rewrite target is not resolved at
build time, so these deploy fine against an API that does not exist yet — and
doing them first means Render gets its real `STOREFRONT_URL` and `ADMIN_URL` on
the first attempt instead of failing a deploy on purpose.

Two projects, same repo, different root directory.

**Storefront** — Root Directory `apps/storefront`:

| Variable | Value |
|---|---|
| `VITE_API_URL` | `/api/storefront` |
| `VITE_API_ORIGIN` | your storefront URL |
| `VITE_MEDIA_ORIGIN` | your `https://pub-<hash>.r2.dev` |
| `VITE_SITE_URL` | your storefront URL |

**Admin** — Root Directory `apps/admin`, one variable: `VITE_API_URL` =
`/api/admin`.

`VITE_API_URL` is a **path, not a URL**. That is what routes it through the
proxy and keeps the session cookie same-origin. An absolute URL here is the one
mistake that still builds, still deploys, and breaks every login.

The storefront's own URL is not known until the project is created, so
`VITE_API_ORIGIN` and `VITE_SITE_URL` need a second pass: create the project,
read the assigned URL, set them, redeploy. Both are cosmetic until then — a
preconnect hint and the `Sitemap:` line in `robots.txt`.

Data will 404 until Render exists. That is the expected state at the end of this
step.

## 5. Render — API, worker and Redis

1. **New → Blueprint**, point it at this repo. It reads [`render.yaml`](../render.yaml)
   and creates the web service plus the Key Value instance.
2. Keep the service name **`stridex-api`** — both `vercel.json` files rewrite to
   `https://stridex-api.onrender.com`. If you rename it, edit them and redeploy
   Vercel.
3. Fill in every variable marked `sync: false`, using the values collected in
   steps 1–4. `REDIS_URL` and the two JWT secrets are filled in for you.
   `CORS_ORIGINS` is both Vercel URLs, comma-separated, no spaces.

The worker runs inside the API process (`RUN_WORKER_INLINE=true`). That is only
safe because the free plan runs exactly one instance; the worker was split out
because N instances meant N overlapping sweeps.

The first build runs `prisma migrate deploy`, so the schema lands automatically.
A build that fails here names the missing environment variable — that is the env
schema doing its job, not a broken deploy.

## 6. Close the loop

1. Update the R2 CORS policy from step 2 with the real admin URL.
2. Razorpay dashboard → **Settings → Webhooks → Add**:
   `https://stridex-api.onrender.com/api/webhooks/payments/razorpay`, secret =
   `RAZORPAY_WEBHOOK_SECRET`. It goes straight to Render, not through Vercel —
   a webhook has no session and no origin to preserve.
3. Create the first admin. Render **Shell** is paid, so run it locally against
   the production database:

   ```sh
   NODE_ENV=production \
   DATABASE_URL='<neon-url>' \
   SEED_ADMIN_EMAIL='you@example.com' \
   SEED_ADMIN_PASSWORD='<a real password>' \
   npm run db:seed
   ```

   `NODE_ENV=production` matters: the seed creates the admin and then returns,
   skipping the dev fixtures — the `shopper@shoe.com` account and friends, whose
   passwords are in the repo. Without it you publish a store with known
   credentials in it.

---

## Bringing the local catalogue with you

The 224 products, 4,087 variants and 86 MB of images already in development
move across in three steps. Orders, customers, carts and sessions stay behind:
those twenty catalogue tables form a closed set — every foreign key in them
points at another table in the same set — so the cut is clean rather than
approximate.

Run these **after** the Render deploy has created the schema, and after the R2
bucket exists.

**1. The rows.**

```sh
./scripts/deploy/migrate-catalog.sh '<neon-connection-string>'
```

Everything runs inside the `shoe-postgres` container, which already has psql 17
— nothing to install. The load disables foreign-key triggers for one
transaction, which `categories` requires: it references itself for
sub-categories, pg_dump warns that it cannot order such a table, and Prisma's
keys are not deferrable.

**2. The images.**

```sh
SRC_ACCESS_KEY=minio_user SRC_SECRET_KEY=minio_password \
DST_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com \
DST_ACCESS_KEY=<r2-key> DST_SECRET_KEY=<r2-secret> \
node scripts/deploy/copy-media-to-r2.mjs
```

Use your real MinIO credentials from `apps/api/.env`. Keys are preserved, so
`products/<uuid>.jpg` stays `products/<uuid>.jpg` — which is what makes step 3 a
prefix swap. Re-running skips what is already there, so an interrupted copy
resumes. `DRY_RUN=1` lists without writing.

**3. The URLs.** This is the step that is easy to miss and impossible to ignore
afterwards. `publicUrl()` stores absolute URLs at upload time, so 684 rows
arrive pointing at `http://localhost:9000/stridex/...` — images that resolve for
nobody but you.

```sh
./scripts/deploy/rewrite-media-urls.sh '<neon-connection-string>' 'https://pub-xxxxxxxx.r2.dev'
```

It prints the stragglers afterwards; all four counts should be zero. `DRY_RUN=1`
counts the affected rows first.

### The admin account is not part of this

`users` is deliberately outside the catalogue set, and should stay that way. The
local `admin@shoe.com` was created by the seed with `Admin@12345` — a password
committed to a public repository. Create the production admin with step 6.3
instead, using a password that has never been in git.

## Living with the free tier

**Cold starts.** The API sleeps after 15 minutes idle and takes 30–60 seconds to
wake. The SPAs are static and stay instant, so the symptom is a first page load
that hangs on data while the shell renders immediately.

You can keep it awake with a monitor (UptimeRobot, cron-job.org) hitting
`/health` every 10 minutes — but do the arithmetic first. The allowance is 750
instance-hours per month per workspace; a 31-day month is 744 hours. It fits with
6 hours to spare, and a few redeploys eat into that. Exceeding it suspends the
service until the month rolls over. Pinging only during your waking hours is the
safer version, and a demo link that is warm when anyone actually clicks it.

**Redis has no persistence.** A restart empties it. Job schedulers are re-created
from the registry on boot, the cache refills from Postgres, rate limiters start
from zero. The only real loss is mail queued at the instant of a restart.

**Neon's 100 compute-hours** are consumed only while the database is awake, and
it suspends after 5 minutes idle. Idle demo traffic will not come close.

**Vercel Hobby is non-commercial.** Fine for a portfolio; not fine the day you
take real orders.

**Razorpay test keys only.** Boot rejects an `rzp_live_*` key outside production
on purpose. Use [test cards](https://razorpay.com/docs/payments/payments/test-card-details/)
— card `4111 1111 1111 1111`, any future expiry, any CVV.

## When something breaks

| Symptom | Cause |
|---|---|
| Boot fails naming env vars | The schema listing what is missing. Read the names it prints. |
| Login works, then everything 401s | `VITE_API_URL` is an absolute URL. It must be `/api/storefront`. |
| Uploads fail mentioning the bucket | `S3_MANAGED_BUCKET` is not set. |
| Images 404 | `S3_PUBLIC_URL` has the bucket appended. R2's public origin has none. |
| Upload preflight fails in admin | R2 CORS policy is missing the admin origin. |
| Webhooks 401 | `RAZORPAY_WEBHOOK_SECRET` holds the key secret. They are different strings. |
| `/health` shows `worker: stale` | `RUN_WORKER_INLINE` is not `true`. |
| Email never arrives, logs look fine | `SMTP_HOST` is empty, so the log provider is selected. |

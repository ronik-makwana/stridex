# Platform — Implementation Order

Redis, the job runtime, and transactional email. Picks up two loose ends the
other plans left behind: `implementation-order.md` §9 parked the mailer as
`TODO(phase 9)` in `admin.auth.controller.ts:77`, and the README has listed
Redis as "running, **not yet used**" since Phase 0 stood it up.

Continues the numbering from `storefront-implementation-order.md`, which ends
at 19. Nothing here is customer-visible except Phase 23; that is deliberate,
and it is why 20–22 are ordered the way they are.

```
Phase 20   Redis foundation          no behaviour change
Phase 21   Queue runtime             no behaviour change
Phase 22   The mailer                dev sink only, still no mail sent
Phase 23   Transactional email       the first customer-visible phase
Phase 24   Caches                    optimisation, last on purpose
```

**The build order is by blast radius, not by value.** Phase 23 is the phase
anybody actually wants, and it is fourth because a queue with a bug in it
sends duplicate email to real customers, and a queue that is wrong about
transaction boundaries emails confirmations for orders that were rolled back.
20–22 each land with a verification that does not involve a customer.

---

## Decisions already taken

**BullMQ, not RabbitMQ.** Redis is being stood up either way, so BullMQ costs a
library and RabbitMQ costs a second broker to run, monitor and back up. The
things RabbitMQ is better at — routing topologies, fan-out to independent
consumers, cross-language subscribers — describe a system this is not. There is
one producer (the API) and one consumer (the mailer).

**Redis is required, everywhere.** `REDIS_URL` is validated at boot in
`config/env.ts` exactly like `DATABASE_URL`, and a process that cannot find it
does not start. No consumer carries a fallback path, because a fallback is a
second behaviour to reason about and the one it replaces — per-process rate
limits — is wrong rather than merely slower.

Redis being *configured* and Redis being *reachable* stay separate questions.
The second one is handled per caller: the limiters let requests through and log
it, the queue retries. See Phase 20.

**It must persist.** See Phase 20.

---

## Phase 20 — Redis foundation

No features. Same shape as Phase 0: produces nothing visible and everything
after it depends on it.

**Persistence first, because the default is wrong.** `docker-compose.yml`
currently runs `redis:7-alpine` with no volume and no persistence flags. That
is harmless while nothing uses it and unacceptable the moment a queue is on it —
a restart would silently drop a customer's verification email.

```yaml
redis:
  image: redis:7-alpine
  command: redis-server --appendonly yes
  volumes: ["redisdata:/data"]
```

**`config/env.ts`** — promote `REDIS_URL` from optional to required, same
shape as `DATABASE_URL`. This is what lets every module downstream hold a plain
`Redis` rather than a `Redis | null`, and it is the difference between one code
path and two.

**`lib/redis.ts`** — one client, one import site, mirroring `lib/prisma.ts`.

A connection error must **not** take the process down. ioredis emits `error` on
the process when nothing is listening, and an unhandled `error` event ends it —
so the listener is load-bearing. Log once per outage, not once per retry.

**Rate-limit store.** All four limiters in `middleware/rateLimit.ts` use
`express-rate-limit`'s default `MemoryStore`. With N processes every limit is
N× the limit and each deploy resets every counter. `authLimiter` is the one that
matters: 10 login attempts per 15 minutes becomes 10N, and a restart clears an
in-progress lockout. Swap the store, change nothing else.

**Done when:** two API processes share one login budget — the attempt after
the limit, made against the instance that has served barely half of it, is
refused. And killing Redis mid-run degrades to unlimited-but-logged, not to
500s: `passOnStoreError` defaults to `false`, which would turn an outage of the
cache into an outage of the API.

---

## Phase 21 — Queue runtime

Still no email. This phase moves the two jobs that already exist and proves the
runtime under something whose failure mode is a log line.

**`src/worker.ts`**, beside `src/server.ts`, sharing `lib/prisma` and the
modules. Deployed as a second process. A `RUN_WORKER_INLINE` flag runs it in the
API process so `npm run dev` stays one command.

**`checkout.expiry` and `payments.reconcile` become repeatable jobs.** A
repeatable job fires once cluster-wide rather than once per instance, which is
the multi-instance problem `lib/scheduler.ts` names in its own header comment —
*"the answer is a lock in Redis or a real scheduler"*. This is the real
scheduler, so **no Redis lock is needed and none should be written.**
`setInterval` and the in-process `running` Set both go.

`jobs/index.ts` stays the one list of what runs in the background. `jobs/run.ts`
stays too: an operator running a sweep from the command line, and a test
triggering one deterministically instead of waiting a minute, are both still
worth having and neither should require a broker.

**The new failure mode, named so it is not a surprise.** Today "the API is up"
implies "the sweeps are running". After this it does not. A worker that is down
holds stock indefinitely for sessions nobody revisits. Two mitigations, both
cheap: lazy expiry already covers every session anyone actually looks at, and
the worker gets a liveness check from day one, not later.

**Done when:** two API instances plus one worker run a full expiry cycle and the
sweep executes exactly once per interval, not twice. Killing the worker and
restarting it loses no scheduled run.

---

## Phase 22 — The mailer

A provider, a template layer, and a dev sink. Deliberately no product events yet
— this phase is about being able to send *an* email, not the right one.

- **`MailProvider` interface** in `modules/mail/providers/`, laid out exactly
  like `modules/payments/providers/`: `provider.types.ts`, one file per backend,
  `index.ts` with `getProvider()`.
- **SMTP is the only real implementation**, because it is the same protocol
  everywhere: mailpit on `localhost:1025` in development, Resend or Brevo in
  production. One implementation covers both, so there is no separate "real"
  provider to write. An API-based provider is still worth having eventually —
  it is how bounce and complaint webhooks arrive — and drops in behind the
  interface when it matters.
- **A log provider**, permanent, for tests and CI where no SMTP is listening.
  It renders the message and sends nothing.
- **The choice is derived, not declared.** An empty `SMTP_HOST` selects the log
  provider, because with no host there is no way to send and a preference would
  be a lie. One variable instead of two that can contradict each other.
- **Templates**, plain and server-rendered, in `modules/mail/templates/`. The
  `RenderedMail` type makes the **plain-text twin non-optional** — HTML-only
  mail scores badly with spam filters, and retrofitting text onto twenty
  templates is far harder than making the first one demand it.

**Absolute URLs are new required env.** `STOREFRONT_URL` and `ADMIN_URL`, because
the API had no canonical base for either and `CORS_ORIGINS` is an allowlist with
no meaningful first entry. Storefront is `5174`, admin is `5175`. Phase 23
cannot build a verification link without these.

**One `mail` queue, not one per template.** Per-job `priority` separates
interactive mail (verification, reset — somebody is watching a screen) from
background mail (order confirmation). A shared FIFO would let a confirmation
backlog starve the link somebody is refreshing for. Retries: 5 attempts,
exponential backoff from 30s, because provider outages last minutes.

**Retention on this queue is a security decision, not housekeeping.**
`removeOnComplete: true`, because Phase 23's verification and reset jobs carry a
**raw token** — only the SHA-256 is stored, so the worker cannot re-derive it —
and a kept completed job is that live credential sitting in Redis with no
expiry. Failed jobs are kept by age (`removeOnFail: { age: 3600 }`): they are
the ones worth inspecting *and* the ones holding the token, so an hour is long
enough to diagnose and short enough not to leave one overnight. For the same
reason the worker's `failed` handler logs the template and attempt number and
never the payload.

**Mail sends on its own worker**, not the maintenance one. Sending is IO-bound
on a remote server and wants concurrency; a sweep is a database transaction and
wants none. Sharing would let a slow provider block the expiry sweep, and held
stock should not wait on an inbox.

**Done when:** `npm run mail:test -w apps/api -- you@example.com` lands a
message in mailpit at `localhost:8025` with both an HTML and a plain-text part
and a working absolute link — having gone through the queue, so a run with no
worker listening proves nothing and delivers nothing. And pointing `SMTP_PORT`
at a dead port makes it retry with visible backoff and land in the failed set
rather than vanishing.

---

## Phase 23 — Transactional email

Five messages, with their hook points. Password reset is on the list because it
is the same machinery and its absence was the live `TODO`.

| Message | Enqueued at |
|---|---|
| Verification | `auth.service.ts` `issueEmailVerificationToken` — the single funnel for signup *and* resend |
| Password reset | `auth.service.ts` `createPasswordResetToken` |
| Welcome | `auth.service.ts` `verifyEmail`, **not** register — and customers only |
| Order confirmation | `payments/webhook.service.ts` `handleProviderEvent`, after `capturePayment` returns |
| Order shipped | `orders/admin.orders.service.ts` `updateStatus`, after the transaction |

**Welcome fires on verification, not signup.** Two emails in the same second
means one competes with the link the customer actually needs, and sending it
here means it lands on an address now known to be real.

**Enqueue after commit. Never inside the transaction.** Queuing inside would let
the worker read an order before it exists, or send a confirmation for one a
later failure rolled back. The confirmation hook sits in `handleProviderEvent`
rather than inside `capturePayment` for exactly this reason — and that placement
also means **reconciliation covers it**, since it calls the same function.

**Enqueue failures are logged, never thrown.** A queue that blinks must not turn
a successful signup into a 500 or make a correctly-handled webhook answer 500
and get retried. The cost is that a failure is invisible in the response, which
is what the sweep below is for.

**`mail.confirmations`, a registered job.** `orders.confirmation_sent_at` records
that a confirmation was queued; the sweep finds PAID orders past a five-minute
grace with it still null and queues them. This is the cheap half of a
transactional outbox — one column and one job instead of a table and a poller —
and it is proportionate because the failure it guards is a missing email, not a
lost payment. The money path already has webhook retries and reconciliation.

**Deterministic `jobId`s, separated by `-` and not `:`.** BullMQ composes its
Redis keys as `bull:<queue>:<jobId>` and **rejects any custom id containing a
colon** — it throws at `queue.add`, which combined with the swallowed enqueue
above means the first version of this shipped silently sending nothing.

- `auth.verify-<tokenId>` / `auth.reset-<tokenId>` — keyed on the token row, not
  the user: resend mints a fresh token, and each issued token is its own event.
- `auth.welcome-<userId>` — an account is welcomed once in its life, however
  many times its verification link is double-clicked.
- `order.confirmation-<orderId>` — providers retry and reconciliation re-enters
  on a schedule, both by design.
- `order.shipped-<statusHistoryId>` — **not the order.** `order-status.ts`
  permits SHIPPED → PROCESSING so an operator can correct a mistake and ship
  again; keyed on the order, that second real shipment would send nothing.

**The shipped email ships without tracking.** `orders` carries no carrier or
tracking number and `updateStatus` takes only `{status, note}`. "It has left us"
is still the thing the customer wants to know, and the link goes to the order
page — which is where tracking will appear when the column exists. Adding it is
a migration plus an admin form field, and is not in this phase.

**Cleanups closed here.** `logIssuedToken` is gone from
`shop.auth.controller.ts` and the `TODO(phase 9)` from
`admin.auth.controller.ts`. No token is written to a log or returned in a
response any more; `verificationEmailSent` stays, because the storefront reads
it. The 409 existence-oracle question parked in `register`'s docstring on "needs
a mailer this build does not have yet" is now reopenable, and deliberately not
reopened here.

**Done when:** a real signup delivers a verification email whose link verifies
the account and triggers exactly one welcome however many times it is clicked; a
webhook-created order delivers a confirmation rendering snapshot values; and an
order shipped, reverted and re-shipped delivers two.

---

## Phase 24 — Caches

Last, because a cache is an optimisation and every one of them is a second copy
of something Postgres already knows. Ordered by payoff per line of
invalidation logic, cheapest first.

| Cache | Where | TTL | Busted by |
|---|---|---|---|
| Store settings | `checkout.service.ts:109` and `:348` — one row, read twice per checkout | 5m | settings write |
| Category nav tree | `shop.categories.service.ts:13` — two full reads plus a roll-up, on **every page** | 15m | category or product status write |
| Home | `shop.home.service.ts:145` — six queries on the most-hit URL on the site | 5m | collection or testimonial write |
| Search typeahead | `shop.search.controller.ts` — its own docstring says "almost every keystroke" | 5m | TTL only |
| Facet counts | `shop.facets.service.ts` — eight self-excluded aggregates per page, re-run on every filter click | 60s | product or inventory write |
| Dashboard aggregates | `dashboard.service.ts` — raw SQL over orders and order_items | 60s | TTL only |

Facets are the largest win and the last one to write, because they are the only
entry here whose cache key is non-obvious: it is the **normalised** filter
params, and two requests that mean the same thing with the parameters in a
different order must not be two entries.

**Done when:** every row above is measurably faster, and stopping Redis
mid-suite leaves every page still rendering — slower, from Postgres, with one
log line per outage.

---

## Not doing, and why

These are the plausible-sounding Redis uses that would make this system worse.
Written down so they do not get proposed again.

**Payment idempotency stays in Postgres.** It is a unique index with
insert-and-catch. Moving it to Redis makes it strictly weaker: an eviction or a
restart lets a duplicate charge through, where the index will not.

**Stock holds and reservations stay in Postgres.** The conditional
`UPDATE … WHERE quantity - reserved >= n` is the entire reason overselling is
impossible. A hold in Redis with the truth in Postgres is two sources of truth
for the one number that must have exactly one.

**Checkout sessions stay rows.** They must survive a restart, be joinable, and
be auditable. A TTL is not a reason to move something out of the database.

**`UserSession` and refresh tokens stay in Postgres.** They back the refresh
rotation and the admin revoke screens.

**An access-token revocation denylist is not in this plan.** It is a real
option — it would close the up-to-15-minute revocation window that
`middleware/auth.ts:19` documents as a deliberate tradeoff — but it changes an
existing security decision rather than implementing a missing one, so it is its
own conversation, not a line item here.

---

## Holds across every phase

- **Redis absent is a broken deployment, not a mode.** `config/env.ts` refuses
  to boot without `REDIS_URL`, and no module below it carries a fallback.
- **Redis unreachable is a different question, and every caller answers it.**
  Degrade and log — never 500, never hang. `commandTimeout` bounds the wait.
- **Nothing becomes load-bearing on a cache.** If a cache being empty changes an
  answer rather than its latency, it is not a cache.
- **Job payloads are ids.** The worker re-reads. The auth tokens are the one
  exception and it is written down above.
- **Every enqueue happens after its transaction commits**, never inside it.
- **Every job has a deterministic `jobId`.** A job that cannot be sent twice
  safely needs a key that says so.
- **Every job is safe to run twice and safe to miss** — the rule
  `lib/scheduler.ts` already holds itself to. Retries and duplicate webhook
  deliveries make the first half non-optional.
- **The queue is not a log.** A job is work to do, not a record that something
  happened. What happened goes in Postgres.

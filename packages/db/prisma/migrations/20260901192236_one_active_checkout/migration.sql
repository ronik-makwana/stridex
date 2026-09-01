-- One live checkout per customer, enforced by the database.
--
-- The service checks for an open session before creating one, but a check is
-- not a guarantee: two requests a millisecond apart — a double click, a
-- dev-mode double render, two tabs — both read "none" and both reserve stock.
-- The customer then holds the same pair twice and only one session can ever be
-- paid for.
--
-- A partial unique index is the only thing that can settle that, the same way
-- `addresses_one_default_per_user_idx` settles the default address. The loser
-- gets a P2002 and the service hands it the winner's session.
--
-- Invisible to Prisma's diff, so it lives here and is applied by a migration.
CREATE UNIQUE INDEX IF NOT EXISTS checkout_sessions_one_active_per_user_idx
  ON checkout_sessions (user_id) WHERE status = 'ACTIVE';

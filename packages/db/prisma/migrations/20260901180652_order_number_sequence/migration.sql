-- Order numbers, allocated by the database.
--
-- A customer-facing number cannot be `max(order_number) + 1`: two webhooks
-- landing in the same millisecond would both read the same maximum and one of
-- them would lose to the unique index — after the order had already been built.
-- A sequence hands out numbers without a lock and without a race.
--
-- Invisible to Prisma's diff, like the partial indexes in 003, so it lives here
-- and is applied by a migration.
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 1000 INCREMENT BY 1;

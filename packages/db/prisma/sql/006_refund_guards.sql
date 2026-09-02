-- The two things about refunds the database has to settle by itself.
--
-- Both are invisible to Prisma's diff — a partial unique index and a check
-- constraint — so they live here and are applied by a migration, the same way
-- `checkout_sessions_one_active_per_user_idx` is.

-- 1. One open request per order.
--
-- The service checks before it writes, and a check is not a guarantee: two
-- taps on "Return items" a millisecond apart both read "none open" and both
-- create a request, and the customer is then owed the same pair twice. The
-- loser gets a P2002 and is handed the request that won.
--
-- REJECTED and WITHDRAWN are absent on purpose: a refused request must not
-- block the customer from raising a better one while the window is still open.
CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_one_open_per_order_idx
  ON refund_requests (order_id)
  WHERE status IN ('REQUESTED', 'APPROVED', 'RECEIVED');

-- 2. A parcel cannot be received twice.
--
-- `restocked_quantity + unsellable_quantity` is how many units of this line
-- have physically come back. It can never exceed what was asked for, and the
-- service's conditional writes are what normally hold that line — this is what
-- holds it when a future caller forgets.
ALTER TABLE refund_request_items
  DROP CONSTRAINT IF EXISTS refund_request_items_received_within_requested;
ALTER TABLE refund_request_items
  ADD CONSTRAINT refund_request_items_received_within_requested
  CHECK (quantity > 0 AND restocked_quantity >= 0 AND unsellable_quantity >= 0
         AND restocked_quantity + unsellable_quantity <= quantity);

-- Money only ever goes back in a positive amount. A refund of zero is a row
-- that means nothing; a negative one is a charge wearing a refund's name.
ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_amount_positive;
ALTER TABLE refunds ADD CONSTRAINT refunds_amount_positive CHECK (amount > 0);

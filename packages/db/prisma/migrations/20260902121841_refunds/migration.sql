-- CreateEnum
CREATE TYPE "RefundRequestType" AS ENUM ('CANCELLATION', 'RETURN');

-- CreateEnum
CREATE TYPE "RefundRequestStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'RECEIVED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundReason" AS ENUM ('CHANGED_MIND', 'WRONG_SIZE', 'DAMAGED', 'NOT_AS_DESCRIBED', 'WRONG_ITEM', 'LATE_DELIVERY', 'OTHER');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivered_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "store_settings" ADD COLUMN     "return_window_days" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "refund_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "RefundRequestType" NOT NULL,
    "status" "RefundRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" "RefundReason" NOT NULL,
    "comment" TEXT,
    "estimated_amount" DECIMAL(12,2) NOT NULL,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "received_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_request_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "restocked_quantity" INTEGER NOT NULL DEFAULT 0,
    "unsellable_quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "refund_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "request_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" "RefundReason" NOT NULL,
    "note" TEXT,
    "provider" TEXT NOT NULL,
    "provider_refund_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "initiated_by_user_id" UUID,
    "failure_reason" TEXT,
    "provider_response" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "refund_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refund_requests_order_id_created_at_idx" ON "refund_requests"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "refund_requests_status_created_at_idx" ON "refund_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "refund_requests_user_id_created_at_idx" ON "refund_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "refund_request_items_order_item_id_idx" ON "refund_request_items"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "refund_request_items_request_id_order_item_id_key" ON "refund_request_items"("request_id", "order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_idempotency_key_key" ON "refunds"("idempotency_key");

-- CreateIndex
CREATE INDEX "refunds_order_id_created_at_idx" ON "refunds"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "refunds_status_created_at_idx" ON "refunds"("status", "created_at");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_request_id_idx" ON "refunds"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_provider_provider_refund_id_key" ON "refunds"("provider", "provider_refund_id");

-- CreateIndex
CREATE INDEX "refund_items_order_item_id_idx" ON "refund_items"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "refund_items_refund_id_order_item_id_key" ON "refund_items"("refund_id", "order_item_id");

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_request_items" ADD CONSTRAINT "refund_request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "refund_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_request_items" ADD CONSTRAINT "refund_request_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "refund_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill `orders.delivered_at` from the history that already knows it.
--
-- DISTINCT ON takes the *latest* DELIVERED row per order rather than the first:
-- an order marked delivered, corrected back to shipped and delivered again was
-- delivered the second time, and the return window is counted from then.
UPDATE orders o
   SET delivered_at = h.created_at
  FROM (
    SELECT DISTINCT ON (order_id) order_id, created_at
      FROM order_status_history
     WHERE to_status = 'DELIVERED'
     ORDER BY order_id, created_at DESC
  ) h
 WHERE h.order_id = o.id
   AND o.delivered_at IS NULL;

-- prisma/sql/006_refund_guards.sql
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

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "confirmation_sent_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "orders_payment_status_confirmation_sent_at_idx" ON "orders"("payment_status", "confirmation_sent_at");

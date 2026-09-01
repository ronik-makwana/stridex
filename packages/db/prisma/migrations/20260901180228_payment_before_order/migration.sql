-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "checkout_session_id" UUID,
ALTER COLUMN "order_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "payments_checkout_session_id_idx" ON "payments"("checkout_session_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_checkout_session_id_fkey" FOREIGN KEY ("checkout_session_id") REFERENCES "checkout_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


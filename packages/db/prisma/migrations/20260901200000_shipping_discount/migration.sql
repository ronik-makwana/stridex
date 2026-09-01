-- AlterTable
ALTER TABLE "checkout_sessions" ADD COLUMN     "shipping_discount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "coupons" ADD COLUMN     "max_shipping_amount" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "shipping_discount" DECIMAL(12,2) NOT NULL DEFAULT 0;


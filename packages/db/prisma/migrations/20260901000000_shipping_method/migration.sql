-- AlterTable
ALTER TABLE "checkout_sessions" ADD COLUMN     "shipping_method" TEXT NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "shipping_method" TEXT NOT NULL DEFAULT 'STANDARD';


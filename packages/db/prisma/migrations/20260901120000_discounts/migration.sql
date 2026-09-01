-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('PRODUCT', 'ORDER', 'SHIPPING');

-- CreateEnum
CREATE TYPE "DiscountAppliesTo" AS ENUM ('PRODUCTS', 'CATEGORIES', 'COLLECTIONS');

-- CreateEnum
CREATE TYPE "DiscountEligibility" AS ENUM ('ALL_CUSTOMERS', 'SPECIFIC_CUSTOMERS');

-- CreateEnum
CREATE TYPE "DiscountMinRequirement" AS ENUM ('NONE', 'PURCHASE_AMOUNT', 'ITEM_QUANTITY');

-- AlterTable
ALTER TABLE "coupons" ADD COLUMN     "applies_to" "DiscountAppliesTo",
ADD COLUMN     "combines_with_order" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "combines_with_product" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "combines_with_shipping" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "eligibility" "DiscountEligibility" NOT NULL DEFAULT 'ALL_CUSTOMERS',
ADD COLUMN     "kind" "DiscountKind" NOT NULL DEFAULT 'PRODUCT',
ADD COLUMN     "min_quantity" INTEGER,
ADD COLUMN     "min_requirement" "DiscountMinRequirement" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "coupon_collections" (
    "coupon_id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,

    CONSTRAINT "coupon_collections_pkey" PRIMARY KEY ("coupon_id","collection_id")
);

-- CreateTable
CREATE TABLE "coupon_customers" (
    "coupon_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "coupon_customers_pkey" PRIMARY KEY ("coupon_id","user_id")
);

-- CreateIndex
CREATE INDEX "coupon_collections_collection_id_idx" ON "coupon_collections"("collection_id");

-- CreateIndex
CREATE INDEX "coupon_customers_user_id_idx" ON "coupon_customers"("user_id");

-- CreateIndex
CREATE INDEX "coupons_kind_status_idx" ON "coupons"("kind", "status");

-- AddForeignKey
ALTER TABLE "coupon_collections" ADD CONSTRAINT "coupon_collections_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_collections" ADD CONSTRAINT "coupon_collections_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_customers" ADD CONSTRAINT "coupon_customers_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_customers" ADD CONSTRAINT "coupon_customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


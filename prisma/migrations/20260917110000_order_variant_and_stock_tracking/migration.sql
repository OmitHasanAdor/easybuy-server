-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "variantId" INTEGER;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "stockDeducted" BOOLEAN NOT NULL DEFAULT false;

-- Existing orders that already took stock: cash on delivery orders (stock is
-- deducted at checkout) and paid online orders, unless they were cancelled.
UPDATE "Order"
SET "stockDeducted" = true
WHERE "status" <> 'CANCELLED'
  AND ("paymentMethod" = 'COD' OR "paymentStatus" = 'PAID');

-- CreateIndex
CREATE UNIQUE INDEX "Order_transactionId_key" ON "Order"("transactionId");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

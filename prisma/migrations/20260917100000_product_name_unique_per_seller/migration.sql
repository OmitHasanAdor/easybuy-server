-- Product names were unique across the whole marketplace, which stopped two
-- sellers from listing a product with the same name. Scope it per seller.

-- DropIndex
DROP INDEX IF EXISTS "Product_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "Product_sellerId_name_key" ON "Product"("sellerId", "name");

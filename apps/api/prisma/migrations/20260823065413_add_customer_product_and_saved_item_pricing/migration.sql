-- CreateTable
CREATE TABLE "CustomerProductPrice" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProductPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSavedItemPrice" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "savedItemId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSavedItemPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProductPrice_customerId_productId_key" ON "CustomerProductPrice"("customerId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSavedItemPrice_customerId_savedItemId_key" ON "CustomerSavedItemPrice"("customerId", "savedItemId");

-- AddForeignKey
ALTER TABLE "CustomerProductPrice" ADD CONSTRAINT "CustomerProductPrice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProductPrice" ADD CONSTRAINT "CustomerProductPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSavedItemPrice" ADD CONSTRAINT "CustomerSavedItemPrice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSavedItemPrice" ADD CONSTRAINT "CustomerSavedItemPrice_savedItemId_fkey" FOREIGN KEY ("savedItemId") REFERENCES "SavedLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

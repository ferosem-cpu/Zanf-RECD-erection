-- CreateTable
CREATE TABLE "PaymentOrderTag" (
    "id" TEXT NOT NULL,
    "paymentMadeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentOrderTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrderTag_paymentMadeId_orderId_key" ON "PaymentOrderTag"("paymentMadeId", "orderId");

-- AddForeignKey
ALTER TABLE "PaymentOrderTag" ADD CONSTRAINT "PaymentOrderTag_paymentMadeId_fkey" FOREIGN KEY ("paymentMadeId") REFERENCES "PaymentMade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrderTag" ADD CONSTRAINT "PaymentOrderTag_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

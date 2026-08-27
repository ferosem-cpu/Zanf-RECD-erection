-- CreateTable
CREATE TABLE "CustomerPurchaseOrder" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "poDate" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "invoiceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "placeOfSupply" TEXT,
    "workLocation" TEXT,
    "scopeOfWork" TEXT,
    "paymentDueDate" TIMESTAMP(3),
    "customerRefCode" TEXT,
    "notes" TEXT,
    "sourceType" TEXT,
    "attachmentUrl" TEXT,
    "attachmentMimeType" TEXT,
    "extractionRaw" JSONB,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPurchaseOrderLineItem" (
    "id" TEXT NOT NULL,
    "customerPurchaseOrderId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hsnCode" TEXT,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "taxRatePct" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CustomerPurchaseOrderLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPurchaseOrderAuditLog" (
    "id" TEXT NOT NULL,
    "customerPurchaseOrderId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPurchaseOrderAuditLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CustomerPurchaseOrder" ADD CONSTRAINT "CustomerPurchaseOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPurchaseOrder" ADD CONSTRAINT "CustomerPurchaseOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPurchaseOrder" ADD CONSTRAINT "CustomerPurchaseOrder_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPurchaseOrder" ADD CONSTRAINT "CustomerPurchaseOrder_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPurchaseOrderLineItem" ADD CONSTRAINT "CustomerPurchaseOrderLineItem_customerPurchaseOrderId_fkey" FOREIGN KEY ("customerPurchaseOrderId") REFERENCES "CustomerPurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPurchaseOrderAuditLog" ADD CONSTRAINT "CustomerPurchaseOrderAuditLog_customerPurchaseOrderId_fkey" FOREIGN KEY ("customerPurchaseOrderId") REFERENCES "CustomerPurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPurchaseOrderAuditLog" ADD CONSTRAINT "CustomerPurchaseOrderAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

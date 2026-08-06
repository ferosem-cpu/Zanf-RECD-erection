-- CreateTable
CREATE TABLE "InvoiceEditLog" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "editedById" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceEditLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "InvoiceEditLog" ADD CONSTRAINT "InvoiceEditLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceEditLog" ADD CONSTRAINT "InvoiceEditLog_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Vendor payments: optional TDS (mirrors PaymentReceived.tdsAmount / tdsCertificateRef) and
-- supporting-document attachments. Additive only: two nullable columns on "PaymentMade" and one
-- new table. Own transaction (Prisma does not wrap PostgreSQL migrations); a lock timeout aborts
-- the whole file and nothing changes. NOT applied to any database yet - see docs/HANDOVER.md
-- section 4 (manual apply + _prisma_migrations row).
BEGIN;
SET LOCAL lock_timeout = '5s';

-- AlterTable: nullable, DEFAULT 0 (existing rows read as 0; no table rewrite on PG 11+).
ALTER TABLE "PaymentMade" ADD COLUMN "tdsAmount" DECIMAL(12,2) DEFAULT 0;
ALTER TABLE "PaymentMade" ADD COLUMN "tdsCertificateRef" TEXT;

-- CreateTable
CREATE TABLE "PaymentMadeAttachment" (
    "id" TEXT NOT NULL,
    "paymentMadeId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "dataUrl" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentMadeAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentMadeAttachment_paymentMadeId_idx" ON "PaymentMadeAttachment"("paymentMadeId");

-- AddForeignKey
ALTER TABLE "PaymentMadeAttachment" ADD CONSTRAINT "PaymentMadeAttachment_paymentMadeId_fkey" FOREIGN KEY ("paymentMadeId") REFERENCES "PaymentMade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMadeAttachment" ADD CONSTRAINT "PaymentMadeAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Security (docs/SECURITY-RLS.md): RLS on, no policies, and revoke the Supabase Data API roles'
-- default grants on this table only (RLS does not cover TRUNCATE). The app connects as the owner.
ALTER TABLE "PaymentMadeAttachment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PaymentMadeAttachment" FROM anon, authenticated;

COMMIT;

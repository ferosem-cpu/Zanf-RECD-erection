-- Phase C: payment allocation + advances + TDS tracking (docs/ACCOUNTING_LITE_PLAN.md §2)
-- Applied to production (Supabase project idqzupopsuusoihpmoqc) via the Supabase MCP on
-- 2026-08-28 as migration "add_payment_allocations"; this file mirrors it exactly (plus the
-- pre-existing invoiceId FK, which prisma migrate diff would drop/recreate but production
-- never touched) so `prisma migrate deploy` reconciles the local/dev database the same way.

-- PaymentReceived: invoiceId becomes optional (advances), add customerId/tdsAmount/tdsCertificateRef
ALTER TABLE "PaymentReceived" ALTER COLUMN "invoiceId" DROP NOT NULL;
ALTER TABLE "PaymentReceived" ADD COLUMN "customerId" TEXT;
ALTER TABLE "PaymentReceived" ADD COLUMN "tdsAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "PaymentReceived" ADD COLUMN "tdsCertificateRef" TEXT;

-- Backfill customerId from each row's linked invoice
UPDATE "PaymentReceived" p
SET "customerId" = i."customerId"
FROM "Invoice" i
WHERE p."invoiceId" = i.id AND p."customerId" IS NULL;

-- Enforce NOT NULL + FK now that every existing row has a customerId
ALTER TABLE "PaymentReceived" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "PaymentReceived" ADD CONSTRAINT "PaymentReceived_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- New table: PaymentAllocation (splits one PaymentReceived's cash amount across invoices)
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentAllocation_paymentId_invoiceId_key" ON "PaymentAllocation"("paymentId", "invoiceId");

ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PaymentReceived"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: one full-amount allocation per existing PaymentReceived row, so settlement
-- math (allocation-based, Phase C) matches what the old "sum of PaymentReceived.amount"
-- math already showed for every pre-existing payment.
INSERT INTO "PaymentAllocation" ("id", "paymentId", "invoiceId", "amount", "createdAt")
SELECT gen_random_uuid()::text, p.id, p."invoiceId", p.amount, now()
FROM "PaymentReceived" p
WHERE p."invoiceId" IS NOT NULL;

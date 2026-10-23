-- Invoice numbering: proforma and tax invoice get separate DocumentSequence counters
-- ("proforma", "tax_invoice") instead of the shared "invoice" key, plus a link from a tax
-- invoice to the proforma it was converted from. Additive only. Own transaction; a lock
-- timeout aborts the whole file and nothing changes. The legacy "invoice" row is NOT touched.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- AlterTable: nullable self-reference, unique (a proforma converts at most once).
ALTER TABLE "Invoice" ADD COLUMN "sourceProformaId" TEXT;
CREATE UNIQUE INDEX "Invoice_sourceProformaId_key" ON "Invoice"("sourceProformaId");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_sourceProformaId_fkey" FOREIGN KEY ("sourceProformaId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the new counters for FY 2026-27 from the existing series (last tax invoice
-- INV/2026-27/0004, last proforma PI/2026-27/0017). GREATEST never lowers a higher value.
INSERT INTO "DocumentSequence" ("id", "docType", "fiscalYear", "lastNumber")
VALUES (gen_random_uuid()::text, 'tax_invoice', '2026-27', 4),
       (gen_random_uuid()::text, 'proforma', '2026-27', 17)
ON CONFLICT ("docType", "fiscalYear")
DO UPDATE SET "lastNumber" = GREATEST("DocumentSequence"."lastNumber", EXCLUDED."lastNumber");

COMMIT;

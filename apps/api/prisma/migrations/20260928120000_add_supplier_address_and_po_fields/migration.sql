-- Supplier: structured address fields. The existing "address" column is kept as
-- address line 1, so existing suppliers (and every PO / bill / ledger that points at
-- them) keep working without any data change. All new columns are nullable.
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "addressLine2" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "pincode" TEXT;

-- PurchaseOrder: document fields shown on the detail page and the printed PO.
-- The PO date already exists as "orderDate". All new columns are nullable, so legacy
-- POs are untouched (a null shipToAddress falls back to Zan-F's own address in the UI).
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "vendorQuoteRef" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "vendorQuoteDate" TIMESTAMP(3);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "shipToAddress" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "placeOfSupply" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT;

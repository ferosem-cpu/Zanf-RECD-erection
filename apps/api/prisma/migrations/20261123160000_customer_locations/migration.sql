-- Customer Portal: multi-location customers. Additive and idempotent (safe to run twice): one new table, two nullable columns.
-- Existing users and sites keep NULL = unchanged behaviour (customer admin / unassigned).
CREATE TABLE IF NOT EXISTS "CustomerLocation" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerLocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerLocation_customerId_name_key" ON "CustomerLocation"("customerId", "name");
CREATE INDEX IF NOT EXISTS "CustomerLocation_customerId_idx" ON "CustomerLocation"("customerId");
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "customerLocationId" TEXT;
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "customerLocationId" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CustomerLocation_customerId_fkey') THEN
    ALTER TABLE "CustomerLocation" ADD CONSTRAINT "CustomerLocation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_customerLocationId_fkey') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_customerLocationId_fkey" FOREIGN KEY ("customerLocationId") REFERENCES "CustomerLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Site_customerLocationId_fkey') THEN
    ALTER TABLE "Site" ADD CONSTRAINT "Site_customerLocationId_fkey" FOREIGN KEY ("customerLocationId") REFERENCES "CustomerLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
ALTER TABLE "CustomerLocation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CustomerLocation" FROM anon, authenticated;

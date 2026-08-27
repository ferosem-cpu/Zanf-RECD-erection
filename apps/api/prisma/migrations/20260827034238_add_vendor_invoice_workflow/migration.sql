-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "attachmentMimeType" TEXT,
ADD COLUMN     "attachmentUrl" TEXT,
ADD COLUMN     "extractionRaw" JSONB,
ADD COLUMN     "rejectedReason" TEXT,
ADD COLUMN     "sourceType" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT,
ALTER COLUMN "status" SET DEFAULT 'uploaded';

-- CreateTable
CREATE TABLE "BillLineItem" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hsnCode" TEXT,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "taxRatePct" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BillLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillAllocation" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "siteId" TEXT,
    "orderId" TEXT,
    "invoiceId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillAuditLog" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillAuditLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillLineItem" ADD CONSTRAINT "BillLineItem_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillAllocation" ADD CONSTRAINT "BillAllocation_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillAllocation" ADD CONSTRAINT "BillAllocation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillAllocation" ADD CONSTRAINT "BillAllocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillAllocation" ADD CONSTRAINT "BillAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillAuditLog" ADD CONSTRAINT "BillAuditLog_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillAuditLog" ADD CONSTRAINT "BillAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data migration: bills recorded under the old flat-status model default to "approved" (they
-- were already treated as confirmed obligations, just without the capture/verify workflow).
UPDATE "Bill" SET status = 'approved' WHERE status = 'unpaid';

-- New permissions for the vendor-invoice capture/approval workflow (mirrors seed.ts's
-- seedPermissions/seedRoles - inserted here directly too since seed.ts is not run against
-- production).
INSERT INTO "Permission" (id, key, name, description) VALUES
  (gen_random_uuid()::text, 'record_vendor_invoice', 'Upload / capture a vendor invoice', NULL),
  (gen_random_uuid()::text, 'approve_vendor_invoice', 'Verify, approve, or reject a vendor invoice', NULL)
ON CONFLICT (key) DO NOTHING;

-- record_vendor_invoice: super_admin/owner_admin/management (via ALL_PERMISSIONS in seed.ts),
-- operations_pm, erection_engineer, commissioning_engineer, finance.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r.id, p.id FROM "Role" r, "Permission" p
WHERE p.key = 'record_vendor_invoice'
  AND r.key IN ('super_admin', 'owner_admin', 'management', 'operations_pm', 'erection_engineer', 'commissioning_engineer', 'finance')
ON CONFLICT DO NOTHING;

-- approve_vendor_invoice: super_admin/owner_admin/management, finance only.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r.id, p.id FROM "Role" r, "Permission" p
WHERE p.key = 'approve_vendor_invoice'
  AND r.key IN ('super_admin', 'owner_admin', 'management', 'finance')
ON CONFLICT DO NOTHING;

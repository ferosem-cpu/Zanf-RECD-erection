-- Customer Portal (portal.zanf.org). ADDITIVE ONLY, hand-written, NOT applied to any database by this commit.
-- Apply by hand after a pg_dump backup, then insert the matching _prisma_migrations row.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- AlterTable Site
ALTER TABLE "Site" ADD COLUMN "requestedStartDate" TIMESTAMP(3),
ADD COLUMN "requestedCompletionDate" TIMESTAMP(3),
ADD COLUMN "addressParts" JSONB,
ADD COLUMN "dgLocation" TEXT,
ADD COLUMN "accessNotes" TEXT,
ADD COLUMN "source" TEXT,
ADD COLUMN "installPriority" TEXT,
ADD COLUMN "priorityReason" TEXT;

-- AlterTable Order
ALTER TABLE "Order" ADD COLUMN "portalSubmissionId" TEXT;

-- CreateTable
CREATE TABLE "PortalSubmission" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "submissionKey" TEXT NOT NULL,
    "customerPoNumber" TEXT,
    "customerPoDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortalSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintComment" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorIsCustomer" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "visibleToCustomer" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComplaintComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalAttachment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "submissionId" TEXT,
    "orderId" TEXT,
    "siteId" TEXT,
    "complaintId" TEXT,
    "commentId" TEXT,
    "kind" TEXT NOT NULL,
    "documentTypeKey" TEXT,
    "draftId" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortalAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalNonce" (
    "keyId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PortalNonce_pkey" PRIMARY KEY ("keyId","nonce")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortalSubmission_reference_key" ON "PortalSubmission"("reference");
CREATE UNIQUE INDEX "PortalSubmission_submissionKey_key" ON "PortalSubmission"("submissionKey");
CREATE INDEX "PortalSubmission_customerId_createdAt_idx" ON "PortalSubmission"("customerId", "createdAt");
CREATE INDEX "Order_portalSubmissionId_idx" ON "Order"("portalSubmissionId");
CREATE INDEX "Site_installPriority_idx" ON "Site"("installPriority");
CREATE INDEX "ComplaintComment_complaintId_createdAt_idx" ON "ComplaintComment"("complaintId", "createdAt");
CREATE INDEX "PortalAttachment_customerId_draftId_idx" ON "PortalAttachment"("customerId", "draftId");
CREATE INDEX "PortalAttachment_siteId_idx" ON "PortalAttachment"("siteId");
CREATE INDEX "PortalAttachment_complaintId_idx" ON "PortalAttachment"("complaintId");
CREATE INDEX "PortalAttachment_orderId_idx" ON "PortalAttachment"("orderId");
CREATE INDEX "PortalNonce_expiresAt_idx" ON "PortalNonce"("expiresAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_portalSubmissionId_fkey" FOREIGN KEY ("portalSubmissionId") REFERENCES "PortalSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ComplaintComment" ADD CONSTRAINT "ComplaintComment_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortalAttachment" ADD CONSTRAINT "PortalAttachment_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "PortalSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PortalAttachment" ADD CONSTRAINT "PortalAttachment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PortalAttachment" ADD CONSTRAINT "PortalAttachment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PortalAttachment" ADD CONSTRAINT "PortalAttachment_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PortalAttachment" ADD CONSTRAINT "PortalAttachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "ComplaintComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Grant place_order to the customer role (idempotent; production has no grant today)
INSERT INTO "Permission" ("id", "key", "name")
SELECT 'perm_place_order_portal', 'place_order', 'Submit a new order request (Customer Portal)'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "key" = 'place_order');
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r, "Permission" p
WHERE r."key" = 'customer' AND p."key" = 'place_order'
ON CONFLICT DO NOTHING;

-- Lock down (RLS + revoke anon/authenticated); no policies: the app role bypasses RLS.
ALTER TABLE "PortalSubmission" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PortalSubmission" FROM anon, authenticated;
ALTER TABLE "ComplaintComment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ComplaintComment" FROM anon, authenticated;
ALTER TABLE "PortalAttachment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PortalAttachment" FROM anon, authenticated;
ALTER TABLE "PortalNonce" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PortalNonce" FROM anon, authenticated;

COMMIT;

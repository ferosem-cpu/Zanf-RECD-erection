-- Order: value/orderDate become optional (bulk site-import creates operational orders
-- without commercial figures yet).
ALTER TABLE "Order" ALTER COLUMN "value" DROP NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "orderDate" DROP NOT NULL;

-- Site: end-client/site-owner name + Google Drive folder links for photos/drawings.
ALTER TABLE "Site" ADD COLUMN "companyName" TEXT;
ALTER TABLE "Site" ADD COLUMN "photosDriveFolderId" TEXT;
ALTER TABLE "Site" ADD COLUMN "photosDriveFolderUrl" TEXT;
ALTER TABLE "Site" ADD COLUMN "drawingsDriveFolderId" TEXT;
ALTER TABLE "Site" ADD COLUMN "drawingsDriveFolderUrl" TEXT;

-- SiteContact: multiple contact persons per site.
CREATE TABLE "SiteContact" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteContact_pkey" PRIMARY KEY ("id")
);

-- DocumentRequirementType: lookup table, seeded (police verification, ESIC, insurance, PPE, ...).
CREATE TABLE "DocumentRequirementType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sequenceOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRequirementType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentRequirementType_key_key" ON "DocumentRequirementType"("key");

-- SiteDocumentRequirement: per-site required yes/no + status against each requirement type.
CREATE TABLE "SiteDocumentRequirement" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "requirementTypeId" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'not_submitted',
    "documentUrl" TEXT,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteDocumentRequirement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteDocumentRequirement_siteId_requirementTypeId_key" ON "SiteDocumentRequirement"("siteId", "requirementTypeId");

-- RecdDelivery: per-site material delivery tracking (Product/QTY/Status/Priority).
CREATE TABLE "RecdDelivery" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "productId" TEXT,
    "quantity" INTEGER,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'pending',
    "statusNote" TEXT,
    "priority" INTEGER,
    "expectedDate" TIMESTAMP(3),
    "actualDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecdDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecdDelivery_siteId_key" ON "RecdDelivery"("siteId");

-- Foreign keys
ALTER TABLE "SiteContact" ADD CONSTRAINT "SiteContact_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SiteDocumentRequirement" ADD CONSTRAINT "SiteDocumentRequirement_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteDocumentRequirement" ADD CONSTRAINT "SiteDocumentRequirement_requirementTypeId_fkey" FOREIGN KEY ("requirementTypeId") REFERENCES "DocumentRequirementType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RecdDelivery" ADD CONSTRAINT "RecdDelivery_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecdDelivery" ADD CONSTRAINT "RecdDelivery_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

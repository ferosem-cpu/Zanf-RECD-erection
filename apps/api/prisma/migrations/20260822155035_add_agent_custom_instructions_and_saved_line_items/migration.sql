-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "agentCustomInstructions" TEXT;

-- CreateTable
CREATE TABLE "SavedLineItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hsnCode" TEXT,
    "standardPrice" DECIMAL(12,2) NOT NULL,
    "taxRatePct" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedLineItem_pkey" PRIMARY KEY ("id")
);

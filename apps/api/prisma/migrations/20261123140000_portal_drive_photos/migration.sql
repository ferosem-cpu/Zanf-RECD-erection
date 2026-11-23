-- Customer Portal: photos are stored in Google Drive. Additive only (three nullable columns).
ALTER TABLE "PortalAttachment" ADD COLUMN "driveUrl" TEXT;
ALTER TABLE "PortalAttachment" ADD COLUMN "dgIndex" INTEGER;
ALTER TABLE "PortalAttachment" ADD COLUMN "driveFiledAt" TIMESTAMP(3);

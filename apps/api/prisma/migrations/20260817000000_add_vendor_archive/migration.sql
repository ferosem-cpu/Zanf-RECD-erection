-- Adds the "archived" vendor status support: who archived it and when. History (sites,
-- complaints, work orders) is left fully intact - archiving only removes the vendor from
-- active selection, it never deletes or reassigns anything by itself.
ALTER TABLE "Vendor" ADD COLUMN "archivedById" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

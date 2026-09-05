-- AlterTable
ALTER TABLE "NotificationLog" ADD COLUMN     "readAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerNotes" TEXT,
ADD COLUMN     "requestedByCustomer" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "NotificationLog_recipientId_channel_readAt_idx" ON "NotificationLog"("recipientId", "channel", "readAt");

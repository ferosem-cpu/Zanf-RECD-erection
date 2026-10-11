-- WhatsApp sender mapping (M1). Additive only: one new table, no change to existing tables.
-- Written by hand; NOT applied to any database.

-- CreateTable
CREATE TABLE "WhatsappSenderMapping" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "lid" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "aiPaused" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappSenderMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappSenderMapping_phoneE164_key" ON "WhatsappSenderMapping"("phoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappSenderMapping_lid_key" ON "WhatsappSenderMapping"("lid");

-- CreateIndex
CREATE INDEX "WhatsappSenderMapping_userId_idx" ON "WhatsappSenderMapping"("userId");

-- AddForeignKey
ALTER TABLE "WhatsappSenderMapping" ADD CONSTRAINT "WhatsappSenderMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

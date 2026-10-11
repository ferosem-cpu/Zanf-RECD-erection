-- WhatsApp M2 queue tables + AgentConversation.channel. Additive, hand-written, NOT applied to any database.

-- AlterTable
ALTER TABLE "AgentConversation" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'app';

-- CreateTable
CREATE TABLE "WhatsappInbound" (
    "id" TEXT NOT NULL,
    "waMessageId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "senderJid" TEXT NOT NULL,
    "senderLid" TEXT,
    "resolvedPhone" TEXT,
    "chatJid" TEXT NOT NULL,
    "messageAt" TIMESTAMP(3) NOT NULL,
    "decision" TEXT NOT NULL,
    "mappingId" TEXT,
    "text" TEXT,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappInbound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappOutbox" (
    "id" TEXT NOT NULL,
    "inboundId" TEXT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "waGroup" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "recipientLid" TEXT,
    "text" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "leasedKeyId" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "sendBy" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "waMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappInbound_waMessageId_key" ON "WhatsappInbound"("waMessageId");

-- CreateIndex
CREATE INDEX "WhatsappInbound_status_leaseUntil_idx" ON "WhatsappInbound"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "WhatsappInbound_mappingId_status_idx" ON "WhatsappInbound"("mappingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappOutbox_inboundId_key" ON "WhatsappOutbox"("inboundId");

-- CreateIndex
CREATE INDEX "WhatsappOutbox_status_leaseUntil_idx" ON "WhatsappOutbox"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "AgentConversation_userId_channel_idx" ON "AgentConversation"("userId", "channel");


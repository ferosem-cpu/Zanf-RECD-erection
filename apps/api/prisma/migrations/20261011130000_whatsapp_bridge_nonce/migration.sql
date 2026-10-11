-- WhatsApp bridge nonce store (M2 part A). Additive, hand-written, NOT applied to any database.

-- CreateTable
CREATE TABLE "WhatsappBridgeNonce" (
    "keyId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappBridgeNonce_pkey" PRIMARY KEY ("keyId","nonce")
);

-- CreateIndex
CREATE INDEX "WhatsappBridgeNonce_expiresAt_idx" ON "WhatsappBridgeNonce"("expiresAt");

-- Explicit transaction: Prisma does NOT wrap PostgreSQL migration files in a transaction, so this
-- file carries its own BEGIN/COMMIT. SET LOCAL lock_timeout makes a blocked lock fail fast (5s)
-- and roll everything back, leaving nothing half-applied.
-- RLS + REVOKE at the end: Supabase default privileges grant anon/authenticated full access to new
-- public tables, and RLS alone does not stop TRUNCATE, so each new table is locked down in the same
-- transaction that creates it (no unprotected window). No policies: the app role bypasses RLS.
BEGIN;
SET LOCAL lock_timeout = '5s';

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

-- Lock down (RLS + revoke anon/authenticated)
ALTER TABLE "WhatsappBridgeNonce" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "WhatsappBridgeNonce" FROM anon, authenticated;

COMMIT;

-- Explicit transaction: Prisma does NOT wrap PostgreSQL migration files in a transaction, so this
-- file carries its own BEGIN/COMMIT. SET LOCAL lock_timeout makes a blocked lock fail fast (5s)
-- and roll everything back, leaving nothing half-applied.
-- RLS + REVOKE at the end: Supabase default privileges grant anon/authenticated full access to new
-- public tables, and RLS alone does not stop TRUNCATE, so each new table is locked down in the same
-- transaction that creates it (no unprotected window). No policies: the app role bypasses RLS.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- WhatsApp sender mapping (M1). Additive only: one new table, no change to existing tables.
-- Written by hand; NOT applied to any database (edited in place after the Codex M1 review
-- because this file had never been applied anywhere).

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

-- One enabled mapping per user, enforced by the database. Prisma cannot express a partial
-- index: keep this statement if the schema/migrations are regenerated.
CREATE UNIQUE INDEX "WhatsappSenderMapping_one_enabled_user_idx" ON "WhatsappSenderMapping"("userId") WHERE "enabled" = true;

-- AddForeignKey
ALTER TABLE "WhatsappSenderMapping" ADD CONSTRAINT "WhatsappSenderMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lock down (RLS + revoke anon/authenticated)
ALTER TABLE "WhatsappSenderMapping" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "WhatsappSenderMapping" FROM anon, authenticated;

COMMIT;

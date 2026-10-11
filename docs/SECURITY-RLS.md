# Security: enable RLS on 25 public tables

Status: migration prepared on `fix/enable-rls`. **NOT applied to production.** Applying needs Ferose's approval.

## Problem
Supabase advisor reports 25x "RLS Disabled in Public" (ERROR). On this project default privileges grant
`anon` and `authenticated` full DML on new public tables. The anon key is public: `zanf-ebiz-card` ships
`NEXT_PUBLIC_SUPABASE_ANON_KEY` to browsers on the same Supabase project. Anyone with that key could
read, insert or update these tables over PostgREST, e.g. `AgentConversation` messages, `SiteContact`,
finance tables. `AgentLlmProvider` holds provider API keys only as AES-GCM ciphertext, but is still exposed.

## Tables (25)
AgentConversation, AgentLlmProvider, AgentPendingAction, BackupLog, BackupSettings, BillAllocation,
BillAuditLog, BillLineItem, CreditNote, CreditNoteLineItem, CustomerProductPrice, CustomerPurchaseOrder,
CustomerPurchaseOrderAuditLog, CustomerPurchaseOrderLineItem, CustomerSavedItemPrice, DebitNote,
DocumentRequirementType, OrderLineItem, PaymentAllocation, PaymentOrderTag, RecdDelivery, SavedLineItem,
SiteContact, SiteDocumentRequirement, WorkOrderProduct.

Migration: `apps/api/prisma/migrations/20261011120000_enable_rls_public_tables/migration.sql`
(`ENABLE ROW LEVEL SECURITY` only; no policies, no FORCE). sha256
`42db651073d6247a00b57b9768fde4ab2b06c40b9a63c81b6dd0cc38c716e053` (LF).

## Evidence (read-only, prod, 2026-10-11)
- The app connects through Supavisor as `postgres`: table owner, `rolbypassrls=true`, not superuser.
  FORCE RLS is off, so the owner is unaffected. `service_role` also has BYPASSRLS.
  `anon`/`authenticated` do not.
- The other 39 public tables already have RLS on with 0 policies. `employees` and `company_settings`
  (zanf-ebiz-card) have RLS plus a "public can read" SELECT policy and are untouched.
- `pg_stat_statements` since project creation (2026-07-20): anon/service_role queries only on `employees`,
  `company_settings` and storage (employee-photos). No anon/authenticated/service_role statement touched
  any Zan table. Caveat: pg_stat_statements keeps a bounded number of entries.
- Zan code has no supabase-js, anon key, PostgREST or SUPABASE_* usage. The zan-app-api Vercel env has no SUPABASE vars.

## Throwaway-DB test (PG 17.11, Supabase-like roles; not prod)
- Scenario A (master's 32 migrations, then this one): before, anon read AgentLlmProvider and
  AgentConversation rows and UPDATE succeeded. After, anon sees 0 rows, INSERT fails with
  "violates row-level security policy", UPDATE affects nothing, `authenticated` sees 0 rows,
  `service_role` sees rows, the owner reads/writes normally. 25/25 RLS on, force 0.
- Scenario B (all 35 repo migrations + this + WhatsApp RLS = 37): all applied, 0 failed. WhatsApp store
  tests 5/5 (x3) as owner, Prisma CRUD on Role/User/AgentLlmProvider/AgentConversation OK, anon 0 rows.

## Apply procedure (needs Ferose's approval)
1. Back up first. Free plan has no automated backups: `pg_dump` or a dashboard backup.
2. Prod `_prisma_migrations` lacks 15 already-applied rows (see `docs/whatsapp/MIGRATION-RECONCILE.md` on
   `feat/whatsapp-m2`). Choose one:
   - **Option A**: `npx prisma migrate resolve --applied <name>` for those 15, then
     `npx prisma migrate deploy` (applies only this migration from master). Prod URLs set only in the shell.
   - **Option B** (no connection string; precedent in this repo): run the 25 ALTERs via Supabase MCP
     `apply_migration`, then INSERT one `_prisma_migrations` row: `id` = `gen_random_uuid()`, `checksum` =
     `42db651073d6247a00b57b9768fde4ab2b06c40b9a63c81b6dd0cc38c716e053`, `migration_name` =
     `20261011120000_enable_rls_public_tables`, `finished_at` = `now()`, `applied_steps_count` = 1.
   - Recommendation: B for this single DDL-only migration; A once the WhatsApp tables go in.

## Verification (read-only)
- `relrowsecurity = true` on all 25 tables.
- Supabase advisor shows no "RLS Disabled in Public".
- `has_table_privilege` results unchanged (grants are not touched).
- `anon` via `SET ROLE` in a read-only transaction sees 0 rows.
- App health endpoint returns 200.
- In-app: log in, open the list pages, ask the in-app assistant one question.

## Rollback
```sql
ALTER TABLE "AgentConversation" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentLlmProvider" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentPendingAction" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "BackupLog" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "BackupSettings" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "BillAllocation" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "BillAuditLog" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "BillLineItem" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditNote" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditNoteLineItem" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerProductPrice" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerPurchaseOrder" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerPurchaseOrderAuditLog" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerPurchaseOrderLineItem" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerSavedItemPrice" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "DebitNote" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentRequirementType" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderLineItem" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAllocation" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentOrderTag" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "RecdDelivery" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "SavedLineItem" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteContact" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteDocumentRequirement" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkOrderProduct" DISABLE ROW LEVEL SECURITY;
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261011120000_enable_rls_public_tables';
```

## Follow-up
- Rotate the AI provider API keys stored in `AgentLlmProvider` ("Free LLM API", "Open AI ", "NVIDIA", "Gemini"),
  since the table was readable with the public anon key (ciphertext only, but rotate to be safe).
- Rotate `AGENT_SECRETS_KEY` only if there is any sign it leaked (it lives in Vercel env, not the DB).
- Optionally revoke anon/authenticated table grants in `public` later, as a separate change
  (the ebiz-card tables need theirs).

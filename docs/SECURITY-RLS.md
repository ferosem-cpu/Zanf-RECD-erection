# Security: enable RLS and revoke anon/authenticated grants on 25 public tables

Status: migration prepared on `fix/enable-rls`. **NOT applied to any real database.** Each prod step below
needs Ferose's approval. Nothing here has been run against production.

## Problem
Supabase advisor reports 25x "RLS Disabled in Public" (ERROR). On this project default privileges grant
`anon` and `authenticated` full DML (and TRUNCATE) on new public tables. The anon key is public:
`zanf-ebiz-card` ships `NEXT_PUBLIC_SUPABASE_ANON_KEY` to browsers on the same Supabase project. Anyone with
that key could read, insert or update these tables over PostgREST, e.g. `AgentConversation` messages,
`SiteContact`, finance tables. `AgentLlmProvider` holds provider API keys only as AES-GCM ciphertext, but is
still exposed.

## Tables (25)
AgentConversation, AgentLlmProvider, AgentPendingAction, BackupLog, BackupSettings, BillAllocation,
BillAuditLog, BillLineItem, CreditNote, CreditNoteLineItem, CustomerProductPrice, CustomerPurchaseOrder,
CustomerPurchaseOrderAuditLog, CustomerPurchaseOrderLineItem, CustomerSavedItemPrice, DebitNote,
DocumentRequirementType, OrderLineItem, PaymentAllocation, PaymentOrderTag, RecdDelivery, SavedLineItem,
SiteContact, SiteDocumentRequirement, WorkOrderProduct.

## Migration
`apps/api/prisma/migrations/20261011110000_enable_rls_public_tables/migration.sql`

- Contents: `BEGIN; SET LOCAL lock_timeout='5s';` then 25x `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, then
  25x per-table `REVOKE ALL ON TABLE ... FROM anon, authenticated`, then `COMMIT;`. No policies, no FORCE.
- Own transaction: Prisma does not wrap PostgreSQL migrations, so the file carries its own BEGIN/COMMIT.
  A lock timeout aborts the whole thing: nothing changes.
- Why REVOKE as well: RLS does not restrict `TRUNCATE` (nor `REFERENCES`/`TRIGGER`), and the default grants
  include it. Revoking removes that path too (defense in depth).
- Per-table, never `ON ALL TABLES IN SCHEMA public`: the ebiz tables (`employees`, `company_settings`) need
  their anon grants and are untouched.
- Name: unique timestamp `20261011110000` (renamed from `20261011120000`, which collided with the first
  WhatsApp migration's prefix). It was never applied anywhere, so no history row needs correcting.
- sha256 of the committed (LF) bytes:
  `8d50e9970cfa3c5c41c6f54d6ac5d82624c1725625e2805e1ad698fd67afe1b8`.
  A CRLF copy hashes differently. Always hash the committed bytes
  (`git show HEAD:<path>` to a file, then hash), never text that passed through a shell or editor.
- `.gitattributes`: `*.sql text eol=lf`, with an override leaving the already-applied 2026-06..09 migration
  folders byte-exact (their prod checksums must not change).

## Evidence (read-only, prod, 2026-10-11)
- The app connects through Supavisor as `postgres`: table owner, `rolbypassrls=true`, not superuser.
  FORCE RLS is off, so the owner is unaffected. `service_role` also has BYPASSRLS.
  `anon`/`authenticated` do not.
- The other 39 public tables already have RLS on with 0 policies. `employees` and `company_settings`
  (zanf-ebiz-card) have RLS plus a "public can read" SELECT policy and are untouched.
- `pg_stat_statements` since project creation (2026-07-20): anon/service_role queries only on `employees`,
  `company_settings` and storage (employee-photos). No anon/authenticated/service_role statement touched
  any Zan table. Caveat: pg_stat_statements keeps a bounded number of entries.
- Zan code has no supabase-js, anon key, PostgREST or SUPABASE_* usage. The zan-app-api Vercel env has no
  SUPABASE vars.

## Throwaway-DB results (coordinator, not prod)
- Atomicity: with another session holding a lock on `SiteContact`, applying the file hit
  "canceling statement due to lock timeout" and 0 of 25 tables changed; anon kept SELECT (all-or-nothing).
- After apply via `prisma migrate deploy`: recorded checksum = `8d50e997...e1b8`.
- `anon` and `authenticated`: SELECT, INSERT, TRUNCATE -> "permission denied" on the Zan tables.
- 0 anon/authenticated grants left on the 25. `service_role` still reads rows and keeps its grants.
  The owner reads and writes.
- ebiz-like tables (RLS + public-read policy) still readable by anon and keep their anon SELECT/INSERT grants.
- RLS on 25/25, FORCE 0.
- Manual path (`psql -v ON_ERROR_STOP=1 -f file`, then INSERT the history row): `prisma migrate status`
  -> "Database schema is up to date!".
- Prod `_prisma_migrations` column defaults, verified read-only: `started_at` default `now()`, `logs` and
  `rolled_back_at` nullable, `applied_steps_count` default 0; identical to Prisma's own table.
- Earlier round: Prisma CRUD on Role/User/AgentLlmProvider/AgentConversation OK as owner; WhatsApp store
  tests 5/5 as owner.

## Prod runbook (each step needs Ferose's approval; nothing run yet)
**Step 0 - read-only prechecks.** Re-list RLS-off public tables: must be exactly these 25. Table owner is
`postgres`; `postgres` has `rolbypassrls`. No policies exist on the 25. `_prisma_migrations` has no row
named `*enable_rls*`.

**Step 1 - backup** (see "Backup" below). Do not proceed without a verified dump.

**Step 2 - apply** the committed `migration.sql` bytes exactly (it has its own BEGIN / SET LOCAL
lock_timeout / COMMIT). Preferred: Supabase MCP `execute_sql` / `apply_migration` with the file contents,
or `psql -v ON_ERROR_STOP=1 -f migration.sql`. On lock timeout nothing changed; retry at a quieter time.

**Step 3 - history row, only after COMMIT succeeded:**
```sql
INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
VALUES (gen_random_uuid()::text,
        '8d50e9970cfa3c5c41c6f54d6ac5d82624c1725625e2805e1ad698fd67afe1b8',
        '20261011110000_enable_rls_public_tables', now(), 1);
```
(`started_at` takes its default.) Prod `_prisma_migrations` also lacks 15 already-applied rows; see
`docs/whatsapp/MIGRATION-RECONCILE.md` on `feat/whatsapp-m2`. Apply this migration first (manual path), then
merge master into `feat/whatsapp-m2` so the folder exists locally.

**Step 4 - read-only verification:**
- `relrowsecurity = true` on all 25.
- Zero anon/authenticated grants on the 25 (`information_schema.role_table_grants`).
- ebiz tables: anon SELECT grant and policies unchanged; no unexpected policies anywhere.
- Supabase advisor shows no "RLS Disabled in Public".
- `BEGIN READ ONLY; SET LOCAL ROLE anon; SELECT count(*) FROM "AgentConversation"; ROLLBACK;` ->
  permission denied.
- App: health 200, login, list pages, ask the in-app assistant one question.

**Step 5 - follow-up.** Rotate the AI provider keys stored in `AgentLlmProvider` (names: "Free LLM API",
"Open AI ", "NVIDIA", "Gemini"); the table was readable with the public anon key (ciphertext only, but
rotate to be safe). Rotate `AGENT_SECRETS_KEY` only if there is any sign it leaked.

## Backup (Step 1)
The Free plan has no automated backups or PITR, and the dashboard has no full export. Plan: Ferose runs
`pg_dump` 17.11 (EDB portable binaries at `D:\Tools\pgsql17\pgsql\bin`; server is 17.6, client major 17 >=
server, OK) on the PC.

- Use the Supabase **session pooler** connection string (port 5432, IPv4), copied by Ferose from the
  dashboard (Connect). The direct `db.<ref>.supabase.co` host is IPv6-only and the 6543 transaction pooler
  is unsuitable for pg_dump.
- Enter it at a masked prompt. Never paste it into chat or to agents, never save it. The repo's pulled
  Vercel env is not used (agents may not read it; sensitive values are blank in pulls).
- If the DB password is unknown, do NOT reset it casually: a reset breaks the live API until `DATABASE_URL`
  / `DIRECT_URL` in Vercel are updated and redeployed.

```powershell
New-Item -ItemType Directory -Force D:\Backups\zan-db
$sec = Read-Host 'Supabase session-pooler URI' -AsSecureString
$env:ZAN_PG_URI = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$ts = Get-Date -Format yyyyMMdd-HHmm
& D:\Tools\pgsql17\pgsql\bin\pg_dump.exe --dbname=$env:ZAN_PG_URI --schema=public --format=custom --no-owner --file="D:\Backups\zan-db\zan-app-public-$ts.dump" --verbose
& D:\Tools\pgsql17\pgsql\bin\pg_restore.exe --list "D:\Backups\zan-db\zan-app-public-$ts.dump" | Select-String 'TABLE DATA' | Measure-Object
Remove-Item Env:ZAN_PG_URI
```
Expect ~64 `TABLE DATA` entries and a file size > 0. `--schema=public` covers all Zan and ebiz data.
Supabase-managed schemas are excluded (auth has 0 users; storage holds only ebiz photo metadata; the storage
files themselves are not in Postgres).

## Rollback - EMERGENCY ONLY (restores the exposure)
Only if the app breaks and cannot be fixed forward. One transaction; needs Ferose's approval.
```sql
BEGIN;
ALTER TABLE "AgentConversation" DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE "AgentConversation" TO anon, authenticated;
-- repeat both statements for each of the other 24 tables listed above
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261011110000_enable_rls_public_tables';
COMMIT;
```
`GRANT ALL` restores the previous grants exactly (`arwdDxtm`).

# Production migration reconcile + WhatsApp apply plan

Status: PLAN ONLY. Nothing in this document has been run. Every step needs Ferose's explicit approval. Source of facts: the coordinator's read-only production findings of 2026-10-11 (about 11:50-12:00 IST). We have no database access from this branch.

## 1. Summary in plain words

- Production's migration history table (`_prisma_migrations`) lists 17 migrations. The repo has 35. Fifteen older migrations were applied to production by hand (through the Supabase tool), so their changes are in the database but no history rows exist. Nothing is missing from the database itself.
- Before the WhatsApp migrations can be applied with `prisma migrate deploy`, those 15 history rows must be recorded as "applied" (bookkeeping only, no SQL runs). Otherwise Prisma would try to run them again and fail.
- The WhatsApp change is NOT only new tables. It also alters the existing `AgentConversation` table (new column plus new index). See section 5.
- Production has a pre-existing security gap (25 public tables without row-level security). See section 8.

## 2. Evidence

Method (all read-only, no writes, no DDL):
1. `SELECT`s against production through the Supabase MCP tool: `_prisma_migrations` rows and checksums, `supabase_migrations.schema_migrations`, table sizes and row counts, default privileges, the security advisor.
2. A full catalog comparison (every public column with type, nullability and default; every constraint through `pg_get_constraintdef`; every index definition; every enum) between production and a throwaway PostgreSQL 17 database on the coordinator's Linux box with all 35 repo migrations applied from scratch (Prisma 5.22.0, exit 0, 35/35 finished).

Dates: production reads on 2026-10-11; throwaway run on 2026-10-11 (see REVIEW-M2.md, "Throwaway-Postgres verification").

Production: Supabase project `zan-app`, ap-south-1, Postgres 17.6, Free plan, `lock_timeout=0`, `statement_timeout=2min`, database size 36 MB, `AgentConversation` 48 rows / about 1 MB.

## 3. Production vs repo

| Item | Result |
|---|---|
| In repo, missing from prod `_prisma_migrations` | 15 migrations (list in section 6). Their schema objects ARE present in production (catalog comparison identical). |
| In prod history, not in repo | None. |
| Checksum: matches repo bytes exactly | 3 (`init`, `add_auth_and_settings`, `add_vendors`; repo files are CRLF). |
| Checksum: line-ending-only difference | 13 (the SHA-256 of the repo file with CRLF normalised to LF equals the recorded value; content identical). |
| Checksum: empty | 1 (`add_header_footer_contact_fields`, inserted by hand). |
| Schema differences prod vs repo migrations | Only the WhatsApp objects (absent in prod) and two extra non-Prisma tables in prod, `employees` and `company_settings` (another app's tables, RLS on). |

What this means:
- `prisma migrate deploy` does not re-verify checksums of migrations already recorded as applied. The 13 line-ending mismatches, the empty checksum and the 3 exact ones need no action.
- There is no content drift.
- Optional, LATER and separate: add a `.gitattributes` rule `apps/api/prisma/migrations/**/*.sql text eol=lf` so checksums stop depending on the machine. Never rewrite or re-normalise files that are already applied.
- Note: the 3 WhatsApp migration files are LF in git but CRLF in the Windows working tree (autocrlf), so their recorded checksum depends on where `migrate deploy` runs (section 6).

## 4. PaymentReceived foreign key

`PaymentReceived_invoiceId_fkey` in production is `FOREIGN KEY ("invoiceId") REFERENCES "Invoice"(id) ON UPDATE CASCADE ON DELETE RESTRICT`, identical to what the repo migrations produce. `schema.prisma` (optional relation, no `onDelete`) implies `ON DELETE SET NULL`, so `prisma migrate diff` against the schema shows a difference. This is schema-versus-migrations drift, not production drift. RESTRICT is the safer behaviour. Leave it out of this change; decide separately later.

## 5. What the WhatsApp change does

It is NOT only new tables. Three migrations (four with the RLS proposal) change production as follows.

Change to an EXISTING table:
- `ALTER TABLE "AgentConversation" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'app'`. Metadata-only on PG 11+ (no table rewrite). The 48 existing rows read as `'app'`. Takes a brief ACCESS EXCLUSIVE lock on `AgentConversation`.
- `CREATE INDEX "AgentConversation_userId_channel_idx" ON "AgentConversation"("userId","channel")`. Not concurrent, so it holds a SHARE lock (blocks writes, not reads) while it builds. The table is about 1 MB, so this should take well under a second.

New objects:
- 4 new tables: `WhatsappSenderMapping` (foreign key to `User`), `WhatsappBridgeNonce`, `WhatsappInbound`, `WhatsappOutbox`.
- Proposed (needs review): `20261011150000_whatsapp_enable_rls` enables RLS on those 4 tables (no policies; the app role bypasses RLS).

Compatibility of the existing app code with the new column: `schema.prisma` declares `channel String @default("app")` on `AgentConversation`. The code currently in production does not know about `channel`; an extra NOT NULL column with a default is harmless to it (inserts omit it and get `'app'`; reads select explicit known columns). The reverse is NOT true: the new API code, which reads and filters on `channel`, will fail on `AgentConversation` queries if deployed to a database without the column. Therefore: apply the migrations first, deploy the new API afterwards (consistent with HANDOVER section 5, API first).

## 6. Exact reconcile + apply procedure (ALL need Ferose's explicit approval; nobody has run any of it)

### Pre-checks
1. Backup. The Free plan has NO automated backups. Take a `pg_dump` of schema and data first (`pg_dump --no-owner --format=custom` using the direct connection, stored off the repo), or a Supabase dashboard backup if available. Confirm the dump restores (or at least lists with `pg_restore -l`).
2. Pick a quiet time (few or no users in the app).
3. Re-run the read-only facts: `_prisma_migrations` still has the same 17 rows; the WhatsApp tables and `AgentConversation.channel` still do not exist; `AgentConversation` row count and size are about the same.
4. Where to run from: from `apps/api`, with prod `DATABASE_URL` and `DIRECT_URL` set in that shell only (never printed, never written to a file, never committed). A Linux copy of the repo gives LF checksums for the WhatsApp files; the Windows working tree gives CRLF. Either works. Be consistent, and use the same place for steps 1-3.

### Step 1 - record the 15 pre-WhatsApp migrations as applied (bookkeeping only)
Run from `apps/api`:

```
npx prisma migrate resolve --applied 20260813122825_add_product_shape_dimensions_weight
npx prisma migrate resolve --applied 20260817000000_add_vendor_archive
npx prisma migrate resolve --applied 20260817120000_add_order_line_items
npx prisma migrate resolve --applied 20260822155035_add_agent_custom_instructions_and_saved_line_items
npx prisma migrate resolve --applied 20260823065413_add_customer_product_and_saved_item_pricing
npx prisma migrate resolve --applied 20260823134430_add_product_silencer_type
npx prisma migrate resolve --applied 20260824062957_add_work_order_products
npx prisma migrate resolve --applied 20260827034238_add_vendor_invoice_workflow
npx prisma migrate resolve --applied 20260827094832_add_supplier_pan
npx prisma migrate resolve --applied 20260827144444_add_customer_purchase_orders
npx prisma migrate resolve --applied 20260828111339_add_ledger_opening_balances
npx prisma migrate resolve --applied 20260828120209_add_credit_debit_notes
npx prisma migrate resolve --applied 20260828160000_add_payment_allocations
npx prisma migrate resolve --applied 20260828170000_add_payment_order_tag
npx prisma migrate resolve --applied 20260829054500_add_backup_settings_and_log
```

Recommendation: use `prisma migrate resolve`. It records the checksum of the file as it exists where it is run (so history matches the repo), is the supported path, validates the migration folder name, and is the same tool used afterwards. The alternative (INSERT rows into `_prisma_migrations` through Supabase MCP) means hand-computing SHA-256 checksums and fields, and is how the existing empty-checksum row came about. Use it only if `migrate resolve` cannot connect.

### Step 2 - check
`npx prisma migrate status` must report exactly the WhatsApp migrations as pending: 3 (`20261011120000_whatsapp_sender_mapping`, `20261011130000_whatsapp_bridge_nonce`, `20261011140000_whatsapp_queue_and_channel`), or 4 with `20261011150000_whatsapp_enable_rls` if the proposal is approved. Anything else pending or failed: stop.

### Step 3 - apply
Production has `lock_timeout=0`, which would make a migration wait on a lock forever and queue other queries behind it. Set a short one for this session, for example `PGOPTIONS='-c lock_timeout=5s'` in the shell (applies when the connection uses the direct connection; pooled/pgbouncer URLs may ignore startup options, so use `DIRECT_URL` semantics). Prisma runs each migration file in its own transaction on PostgreSQL, so a lock timeout makes that migration fail and roll back as a whole. If it times out, wait for a quieter moment, `migrate resolve --rolled-back <name>` if Prisma marks it failed, and retry. Then:

`npx prisma migrate deploy`

### Step 4 - verify (read-only SELECTs)
- The 4 tables exist; `_prisma_migrations` has the new rows, all finished, none rolled back.
- `AgentConversation.channel` exists with default `'app'`, and all 48 rows have `'app'`; index `AgentConversation_userId_channel_idx` exists.
- RLS enabled on the 4 new tables (`pg_class.relrowsecurity`), if the proposal was applied.
- The Supabase security advisor shows no NEW ERROR (the 25 pre-existing ones remain, section 8).
- The existing app still lists conversations (in-app smoke check) before the API deploy continues per HANDOVER section 5.

## 7. Rollback

Only after the API code that uses these objects has been rolled back or is not deployed. SQL (run by a person, with approval):

```sql
DROP TABLE IF EXISTS "WhatsappOutbox";
DROP TABLE IF EXISTS "WhatsappInbound";
DROP TABLE IF EXISTS "WhatsappBridgeNonce";
DROP TABLE IF EXISTS "WhatsappSenderMapping";
ALTER TABLE "AgentConversation" DROP COLUMN "channel";  -- also drops AgentConversation_userId_channel_idx
DELETE FROM "_prisma_migrations" WHERE migration_name IN (
  '20261011120000_whatsapp_sender_mapping',
  '20261011130000_whatsapp_bridge_nonce',
  '20261011140000_whatsapp_queue_and_channel',
  '20261011150000_whatsapp_enable_rls'
);
```

Dropping the tables deletes their data (mappings, queued messages). Drop `WhatsappOutbox` before `WhatsappInbound` if a foreign key links them. The 15 `migrate resolve` rows are bookkeeping only: harmless to leave, and they can be deleted too. The pre-change `pg_dump` is the last-resort restore.

## 8. Pre-existing security finding (out of scope; flagged for Ferose)

The Supabase security advisor reports 25 ERROR "RLS Disabled in Public" (including `AgentConversation`, `AgentLlmProvider`, `AgentPendingAction`, `BackupSettings`) and 37 INFO "RLS enabled, no policy". Default privileges in schema public grant `anon` and `authenticated` full table privileges, and they already hold SELECT/INSERT/UPDATE/DELETE/TRUNCATE on `AgentConversation`. Anyone holding the project's anon key could read or change those tables through the Supabase Data API. The app's own role bypasses RLS (39 RLS-enabled tables without policies already work), so enabling RLS on them should not break the app. Recommendation: a separate, reviewed change that enables RLS on the 25 tables (and ideally revokes the default grants). It is not part of this WhatsApp change.

## 9. Approval wording for Ferose

> I approve, on the production Supabase project `zan-app`: (1) taking a `pg_dump` backup first; (2) recording 15 existing migrations as applied in `_prisma_migrations` (history rows only, no schema change); (3) running `prisma migrate deploy` for the WhatsApp migrations, which ALTERS the existing `AgentConversation` table (adds column `channel` with default `'app'`, and creates index `AgentConversation_userId_channel_idx`), and creates 4 new tables (`WhatsappSenderMapping`, `WhatsappBridgeNonce`, `WhatsappInbound`, `WhatsappOutbox`); (4) enabling row-level security on those 4 new tables; with a 5-second lock timeout, at a quiet time, and with the rollback plan in section 7 ready. The API deploy follows separately.

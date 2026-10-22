# Zan-APP - Handover (compact)

Role-based Project & Service Tracker + Finance/Accounting app for ZanF (`zanf.org`), which makes and
installs RECDs (Retrofit Emission Control Devices) for diesel gensets. Tracks the SITC flow: Supply,
Installation, Testing, Commissioning. Cloned from Platino on 2026-07-19 and NOT kept in sync with it.
Full pre-compaction handover (changelog, per-fix narratives): `git show 649ca2a:docs/HANDOVER.md`.
Agent QA: `docs/agent-test-checklist.md`. History: `git log`.

## 1. Production state (2026-10-16)
- API = `dpl_FL2AzQKMMTE9S8zZsfu67VDyrcuo` (19:46 IST, Oct 16 2026, from branch
  `fix/agent-tuning-split-site-confirm` commit `ef2a92c` on top of the deployment below). Adds: receivables /
  invoice search return each invoice's own site (`agent/invoiceSite.ts`); `create_invoice` lines accept
  `splitTotal` + `splitPct` and the app computes the amounts (`agent/lineSplit.ts`); prompt rules against
  "no tools" give-ups. Rollback target: `dpl_2x3jbxyvZccZSjM8gt3tNTtKKWqg`.
  Deploy gotcha: patch EVERY `*.func` recursively (there are two: `functions/index.func` and
  `functions/api/index.func`) and write `.vc-config.json` WITHOUT a BOM (`Set-Content -Encoding UTF8` adds one
  and `vercel deploy` fails "Unexpected token" before uploading).
- Previous API = `dpl_2x3jbxyvZccZSjM8gt3tNTtKKWqg` (17:24 IST, Oct 16 2026): master code (`182517e`, same as `5c3dbc6`)
  plus 3 agent fixes from branch `deploy/agent-fixes-on-prod` (not yet merged to master): Gemini fallback
  accepts tool calls made by another provider (placeholder thought signature); `create_invoice` reuses
  HSN/SAC from earlier invoices, "Extra ..." lines default to the fabrication code (section 6); prompt no
  longer asks for HSN up front. Rollback target: `dpl_49cApBVUavTvvbZxDwFpo6X3AqQ5` (logo egress, `5c3dbc6`,
  20:47 IST Oct 11); before that `dpl_8ai5M6GjkauRGno4byPe9xh6sb1j` (fix 14).
- admin-web auto-deploys from master (`app.zanf.org`): `dpl_EnkCXpEgppRFudaP1ey8mJ9d14HX` (20:48 IST,
  Oct 11). Rollback: `dpl_47SeBbfRbSMzJhfa3hte2orzQzkS`. API is deployed manually (section 5).
- 2026-10-11 RLS fix: RLS on + anon/authenticated grants revoked on the 25 public Zan tables
  (migration `20261011110000_enable_rls_public_tables`, applied in prod with its history row; ebiz
  tables untouched). Runbook: `docs/SECURITY-RLS.md`. Pre-change JSON backup (64 tables, 1,263 rows,
  `grants-before.json`, emergency-only `rollback-exact.sql`): `D:\Backups\zan-db\json-20261011-1725\` (private ACL).
- 2026-10-11 logo egress fix live (section 2): stored logo shrunk 2.45 MB -> 52 KB PNG (md5 of data URL
  `ed0fa8e6...`); original kept at `D:\Backups\zan-db\logo-original.png`.
- WhatsApp assistant: M1/M2/M3 on local branches `feat/whatsapp-m*` (+ bridge `D:\Apps\zan-wa-bridge`),
  reviewed, NOT merged/deployed/migrated. Next: Neon preview DB trial.
- Agent/session handover: `.claude-task\HERMES-HANDOVER.md` (local only, not committed).
- Repo `github.com/ferosem-cpu/Zanf-RECD-erection`, branch `master`. Local ports: API 4011, web 6011.
- DB: Supabase `zan-app` (`ap-south-1`). Vercel team `ferose-salahudeen-s-projects`; CLI user
  `ferosem-1321`. Projects `admin-web` (git-connected) and `zan-app-api` (`bom1`, `zan-app-api.vercel.app`).
- Primary Super Admin `ferosem@gmail.com` is Google-only (`apps/api/src/lib/authPolicy.ts`).
- Local `.env` has real Zoho SMTP creds: local smoke tests send real mail. Never read/print env files.

## 2. Architecture
- Turborepo/npm workspaces: `apps/api` (Express 5, Prisma 5, JWT 7-day bearer, routes/ services/ lib/
  agent/), `apps/admin-web` (Next 15 App Router, Tailwind), `apps/mobile` (Expo, never runtime-tested,
  leave alone), `packages/shared` (`@recd/shared`: Zod + constants, compiled to CommonJS `dist/`).
- "Data, not code": stages, roles, permissions, statuses, checkpoints are DB rows. Permissions are
  enforced client and server side; role sets in `apps/api/prisma/roleDefinitions.ts`. Prod never
  re-runs the seed: ship new grants as idempotent SQL migrations keyed by permission/role key.
- Super Admin is the only role with `manage_settings`; Owner/Admin and Management get all else.
- Vendors are tenant-isolated (`User.vendorId`/`Site.vendorId`); only erection engineers carry a
  vendorId; members of non-approved vendors are blocked. Customers have no password (e-mail OTP,
  need `User.customerId`); customers are created from the Customers page, not `/users`. Legacy
  `/auth/customer/*` and `/auth/otp/*` routes are live with no UI: do not delete unchecked.
- `apps/api/vercel.json` must not have a legacy `"builds"` array (silently skips `prisma generate`).
  Prisma binaryTargets include `rhel-openssl-3.0.x`. Print/PDF: verify with a real PDF render.
- Always include `Order.lineItems` in order/site queries. PATCH responses are thin echoes: reload
  with GET. Documents: gap-free numbers per FY (`nextDocumentNumber`); GST via `computeDocumentTotals`.
- Modules: Orders/Sites/SITC, Customers/Products/Vendors, Finance (quotations, invoices, POs,
  expenses, work orders, vendor bills), Accounting-Lite (ledgers, credit/debit notes, payments + TDS,
  GST aids), customer portal, notifications, reports, backups (Drive + Vercel cron).
- Crons (`apps/api/vercel.json`): conversation cleanup 03:00 UTC, scheduled backup 19:30 UTC. Both
  fail closed without `CRON_SECRET`.
- Company logo/signature (egress fix): `CompanySettings.logoDataUrl`/`signatoryDataUrl` are omitted from every
  Prisma query (global `omit`, preview feature `omitApi`, `lib/prisma.ts`); only `services/companyAssets.ts` reads them.
  `/settings` returns `logoUrl`/`signatureUrl` (`/settings/logo?v=<md5>`, hash computed in SQL). `GET /settings/logo` and
  `/settings/signature` are public, ETag + immutable cache, 10-min in-memory cache. PUT rejects an image data URL over
  300 KB (400); admin-web downscales to ~600 px PNG first. Never add the columns back to a `select`/response.
- Env vars (api): `DATABASE_URL`, `JWT_SECRET` (API throws at boot if unset), `CRON_SECRET`,
  `AGENT_SECRETS_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_DRIVE_*` (CLIENT_ID/SECRET/REFRESH_TOKEN/FOLDER_ID),
  `SMTP_*`, `EMAIL_FROM_ADDRESS`. admin-web: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

## 3. Build, test, local gotchas
- Before every push: `npm run build --workspace=packages/shared`; in `apps/api` `npx prisma generate`,
  `npx tsc --noEmit`, `npm run build`; in `apps/admin-web` `npx tsc --noEmit`, `npm run build`; root
  `npm test`. One-shot: `.claude-task/check.ps1` (local file, not committed).
- Tests: node:test via tsx, mocks only. Current counts: API 181, admin-web 38. New test files must
  be added to the app's package.json "test" script. Lint is not set up.
- Shared changes need a rebuild; a stale real copy in `apps/api/node_modules/@recd/shared` shadows the
  workspace link.
- Windows: Prisma EPERM on `query_engine-windows.dll.node` (stop the dev API / stray node.exe);
  `next dev` is broken, use `next build && next start` from inside `apps/admin-web`;
  `npm install <pkg>` crashes (hand-edit package.json, run bare `npm install`);
  `NODE_ENV=production` is set globally so `.npmrc include=dev` is needed; never `--prebuilt` admin-web.
- `pdf-parse` must be dynamically imported (static import crashed the API at boot). Express: literal
  routes before `/:id`. DELETE returns 204 empty. Field in state but no `<input>` is a common bug.

## 4. Database migrations
Prod migration history has drifted (DDL applied by hand via Supabase MCP). Never run
`prisma migrate deploy/dev` or `db push` against any database; write migrations only and flag them.
15 prod migrations (`20260813122825` ... `20260829054500`) have no `_prisma_migrations` row, so
`migrate deploy` would try to re-run them; backfill rows (SHA-256 of each `migration.sql`) first.
No migrations pending on master (RLS migration applied 2026-10-11 with its row). Branch
`feat/vendor-payment-detail` adds `20261022120000_vendor_payment_tds_attachments` (NOT applied):
nullable `PaymentMade.tdsAmount` (default 0) + `tdsCertificateRef`, new `PaymentMadeAttachment`
table with RLS on and anon/authenticated revoked (`docs/SECURITY-RLS.md`). It must be applied
(manual path + history row) BEFORE the API that reads these columns is deployed. Prod `DATABASE_URL` is a Sensitive Vercel var; use the Supabase connector.

## 5. Deploying
Backend first: deploy `zan-app-api` and confirm it live BEFORE pushing dependent admin-web changes
(admin-web goes live on master push). A same-push change crashed prod Sites on 2026-08-20.
Never deploy, merge to master or open a PR without Ferose's explicit approval.

**Manual API deploy** (PowerShell, from `apps/api`; write multi-line steps as `.ps1`, run with `-File`):
1. Stop the local API. `npx vercel whoami` must print `ferosem-1321`.
2. `npx vercel pull --yes --environment production`
3. `Remove-Item -Recurse -Force .vercel\output, dist -ErrorAction SilentlyContinue`
4. `npx vercel build --prod` run in the FOREGROUND (5-20 min, mostly `@vercel/nft` tracing). Do not
   background it or poll. Grep the output for errors afterwards.
5. Confirm the new code is in the output:
   `Select-String -Path .vercel\output\functions\api\index.func\apps\api\dist\<file>.js -Pattern "<new string>"`
6. Patch `@recd/shared` (workspace symlink does not survive tracing). For EVERY `*.func` under
   `.vercel/output/functions/`: (a) delete the `"filePathMap"` key from `.vc-config.json` if it
   mentions `@recd/shared` (else deploy fails ENOTDIR); (b) create `node_modules/@recd` and copy
   `packages/shared/dist` + `package.json` into `*.func/node_modules/@recd/shared` and, where it
   exists, `*.func/apps/api/node_modules/@recd/shared`; (c) create the local preflight junction:
   `New-Item -ItemType Junction -Path node_modules\@recd\shared -Target ..\..\packages\shared`
   (skip on Linux, the link exists).
7. `npx vercel deploy --prebuilt --prod` - run it ONCE; on failure stop and report, no retries.
8. Remove the junction: `(Get-Item node_modules\@recd\shared).Delete()` (never leave a real copy).
   If the build rewrote the lockfile: `git checkout -- package-lock.json` (tree must end clean).
9. Verify: READY; alias `zan-app-api.vercel.app` points at the new id; `GET /health` 200;
   `GET /agent/providers` without token 401 (not 404); bad-credentials `POST /auth/login` 401;
   `npx vercel logs <url>` clean. A 401 does not prove a brand-new route exists; rely on step 5.
10. Rollback: `npx vercel rollback <previous dpl id or url>` (or
    `npx vercel alias set <previous url> zan-app-api.vercel.app`); then report.

**Lessons from the 2026-10-16 deploy:**
- Dirty main tree (WhatsApp WIP had a changed `vercel.json` rewrite, `tsconfig.json`, `schema.prisma`)? Do not
  build it. `git worktree add D:\Apps\zanf-deploy -b <branch> <prod sha>`, cherry-pick only the fixes, `npm ci`,
  then run steps 2-9 from that worktree's `apps/api`. Build was 21 min cold, upload 52 s.
- `apps/api/.vercel/project.json` in the main repo links the project `api` (`prj_FsLs...`), NOT `zan-app-api`
  (`prj_yf9RGAw5mnBhJdVi9lDCJncdkrnS`, team `team_psJwhw81rjDAba1sPZSBqxzZ`). Write the right link before `vercel
  pull` and check `projectName` in `.vercel/project.json` afterwards.
- A production deploy came back BLOCKED (docs "team configuration") while HEAD was authored by
  `Claude <noreply@anthropic.com>`; the same tree redeployed fine once the commits were authored by the team
  member (no rebuild needed). Deploy only from commits authored by a Vercel team member. A BLOCKED deploy never
  takes the alias; stop the waiting CLI and do not retry blindly.

**Ignored Build Step:** `zan-app-api` has `commandForIgnoringBuildStep` = `exit 0` and an empty Root
Directory. Git-triggered builds failed "No entrypoint found"; setting Root Directory = `apps/api`
would make git builds succeed and auto-promote WITHOUT the step-6 patch, and clash with the
`apps/api/.vercel` link. Git builds therefore show "Canceled by Ignored Build Step" (expected);
`--prebuilt` deploys are unaffected. Merge flow: API deploy first, then push master.

**admin-web:** push to master, confirm `app.zanf.org` serves the new build (new string in shipped JS).
Fallback: `npx vercel deploy --prod` from the repo root (remote build).

## 6. In-app AI agent (`apps/api/src/agent/`)
- Chat bubble hidden until Super Admin enables roles in Settings > Agent Visibility (Customer toggle
  OFF in prod, deliberate). Needs a provider in Settings > Agent providers (`AgentLlmProvider`, keys
  AES-256-GCM with `AGENT_SECRETS_KEY`).
- Provider order: active rows by `priority` ascending (`providers/factory.ts`), with fallback. Prod rows seen in
  the runtime errors on 2026-10-16: `Free LLM API` priority 0 (model `auto` until 2026-10-16 evening, then set to `codestral-latest`: with `auto` the router (FreeLLM VM) first tried dead Google models (404 "no longer available") and Cohere (15 s abort), so a call took 16-23 s and hit our 25 s per-attempt cap; codestral answers in 1-5 s. The router has only one working route, so it can answer 429 "all models exhausted" when rate-limited), `Open AI `
  priority 1 (`gpt-5.6-luna`, out of credits, HTTP 429), `NVIDIA` priority 2 (timeouts; earlier HTTP 410, see
  section 8), `Gemini` priority 3 (`models/gemini-3.5-flash-lite`). Gemini URLs use native `:generateContent` for PDFs.
  A 410 provider is skipped 60 min, an out-of-quota 429 for 15 min (`providerHealth.ts`; cleared when the row is
  edited). Final error lists the primary's first. Gemini (OpenAI-compat) rejects a history containing tool calls it
  did not make (bare 400) unless each has a thought signature: `toOpenAIMessages` echoes the stored one and uses the
  placeholder `skip_thought_signature_validator` for calls from other providers (test `geminiForeignToolCalls`).
- Time caps in `timeouts.ts` (env-overridable): request 55 s, LLM call 30 s, 25 s per round when a fallback
  exists, max 8 tool turns. API 500 body `{error, errorId}`. Timing: `agent_turn_timing` lines in `npx vercel logs`.
- Tools (`tools/`) mirror their REST route's permissions and refuse customers where the route does.
  Write tools are confirm-gated and draft-only (`AgentPendingAction`); no Accounting writes, no
  edit tools. Test prompt/tool fixes in a NEW thread. Threads over 30 days are deleted by cron.
- `create_invoice` takes `hsnCode` as optional: `agent/hsnLookup.ts` fills a missing code from an active saved
  billing item of the same name, else the most-used code on earlier invoice lines with the same service name (text
  before ` - ` / ` – `; tie goes to the newest invoice). A line starting "Extra"/"Additional" with no match takes the
  code of "Dismantling & Mechanical Fabrication" (business rule from Ferose: extra work is civil/fabrication; 998898
  on 2026-10-16). No match at all: refusal that lists the earlier codes; a code is never invented. The reply note
  names every reused code so it can be checked on the confirm card.
- Reply sanitising: `assistantText.ts` strips special tokens; `stripToolInternals` drops tool names,
  identifiers and "Source:" lines. Never name internal tools/fields; cite app pages.
- Drive: reads limited to descendants of `GOOGLE_DRIVE_FOLDER_ID` = ZanF_DropBox on
  `zanfpowersystems@gmail.com` (shortcuts not followed; refused for customers). `zanapp-backup-*`
  names and JSON are hidden. PDFs parsed in-process (first 20 pages, 60k chars), no OCR; folder tree
  cached 10 min (Drive OAuth refresh token: regenerate with `apps/api/scripts/getDriveRefreshToken.js`;
  OAuth client `zan-app-agent-drive`, Cloud project `MyPersonalAgent`), extracted text 10 min per id+modifiedTime, name->id 5 min.

## 7. Business rules (reuse the shared service, never re-derive)
- Open order = site not yet at Commissioned SITC stage (seq 11; Customer sign-off 12 also closed);
  no site = open. Say "open (not yet Commissioned)" / "closed (Commissioned or later)". Site "update
  status" is the latest `SiteStageEvent`, separate from the SITC stage. Site name = `Site.companyName`.
- Revenue = tax invoices only (proformas excluded), net of issued credit notes. State the period
  (Indian FY, Q1 Apr-Jun ... Q4 Jan-Mar) and basis (excl./incl. GST). Collections only when asked.
- Payments received (`services/paymentSplit.ts`): method `tds` (legacy) = whole amount TDS, else cash =
  `amount`, TDS = `tdsAmount`. Settled = allocations + pro-rata TDS (`services/settlement.ts`, the single
  definition of "paid"); net = total - issued credit notes.
- Receivables = issued + partially_paid invoices; outstanding incl. GST = net - settled; excl. GST =
  outstanding x subtotal/total (subtotal already after line discounts).
- Overdue only with a due date strictly before today, IST calendar days (`services/ageing.ts`,
  `isPastDue`); no due date = "no_due_date", aged by bill/issue date. Ageing buckets also there.
- Payables (`services/payables.ts`) = vendor bills Verified, Approved or Partially paid and not
  rejected; outstanding = bill total (incl. GST) - what its vendor payments settle = cash `amount` +
  TDS withheld `tdsAmount` (`services/vendorPaymentTds.ts`). Bills carry no TDS themselves, so TDS
  lives only on `PaymentMade` and counts once; advances carry no TDS. Supplier ledger: a
  `payment_made` line (cash) + a `tds` line; TDS register: separate `tdsDeducted` section (deducted
  by us, payable to govt), never mixed into the 26AS totals. Rejected/cancelled/deleted/paid excluded.
  Purchase orders are commitments, not payables. A Rejected bill is "Rejected" only (no write-off
  wording). Deleting a rejected bill = soft delete (status `deleted`, number renamed, audit kept,
  refused with payments/debit notes), admin-only (Super Admin, Owner/Admin).
- TDS register and party ledgers use the same split and payables rules; GST returns are filing aids.
- All business dates in IST (`isoDateIST` in agent output). Rupees in lakh/crore grouping
  (`agent/formatInr.ts`).

## 8. Open / minor items (still open)
1. After a page reload, the first "+ New" can hang: the old thread stays on screen and the input says
   "Starting new chat - your message will send...", nothing sends; a second "+ New" works. (Fix 14
   retest, not yet fixed.)
2. A follow-up like "and collections?" repeats the whole revenue block before giving collections.
   (Fix 14 retest, not yet fixed.)
3. NVIDIA fallback returns HTTP 410: check `GET https://integrate.api.nvidia.com/v1/models`, try a
   current tool-calling model in Settings > Agent providers, or the account lacks the "Public API
   Endpoints" entitlement, or replace the provider. Until then the code skips it.
4. 15 prod migrations lack `_prisma_migrations` rows (section 4).
5. Customer role lacks `place_order` in prod, so portal order requests likely 403; grant with an
   idempotent migration if wanted.
6. Decide whether GSTR-3B 4A ITC (`gstExport.ts`) and site vendor costs (`routes/sites.ts`) should
   count Verified bills (they use Approved+).
7. Needs real-user click-through: order value auto-fill, Accounting-Lite A-D, vendor advances, DataTable
   columns/print, Drive folder creation, reports, multi-product order, order edit.
8. Data: `RecdDelivery` mostly empty for Ethen's 29 sites; import from
   `Material_Delivery_Status_version_1.xlsx` awaits approval.
9. Gaps: no advance section on vendor bill page; no `requestedByCustomer` badge; `Product.shape` too
    coarse; no audit log for quotations/POs; a brand-new service name still needs the user to give an HSN (section 6), no Drive upload,
    no mic on Firefox/iOS; Expo/RN and Next 16 PostCSS advisories deferred.
10. After the logo fix, re-check `pg_stat_statements` that queries selecting `logoDataUrl` stop growing.
11. Agent provider chain was failing on 2026-10-16 (OpenAI out of credits, FreeLLM router and NVIDIA timing out):
    top up OpenAI or put a reliable paid provider at priority 0 in Settings > Agent providers. Multi-round tool
    turns (create invoice) need a fast model. Re-test a proforma with an "Extra work" line in a NEW thread.
12. `apps/api/.vercel` links the wrong project (`api`, only holds previews): relink to `zan-app-api` (section 5).
    Delete the BLOCKED deployment `dpl_Hmizg2WR1Jbu6rMdrPhLZnzyzYVY` when convenient (it never took traffic).

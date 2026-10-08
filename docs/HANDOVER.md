# Zan-APP — Handover

> **Compressed 2026-09-27** from ~2,350 lines to what is still needed to operate, deploy and
> extend the app. The full blow-by-blow history (resolved-bug narratives, superseded deploy
> procedures, CLI-version archaeology, Platino Part A detail) is in git: see this file at
> commit **`924329a`** (`git show 924329a:docs/HANDOVER.md`), the last version before
> compression. Older still: `docs/HANDOVER.pre-compact-2026-08-12.md`.
>
> **Start a session by reading "Current open items" and the top of "Changelog".**

---

## 1. What this is

A role-based **Project & Service Tracker plus Finance/Accounting app** for ZanF (e-mail domain
`zanf.org`), a company that makes and installs **RECDs (Retrofit Emission Control Devices)** for
diesel gensets, sold by KVA rating. It tracks the **SITC** flow: Supply → Installation → Testing →
Commissioning.

**Background (Platino):** the repo was cloned 2026-07-19 from the Platino RECD tracker as a
one-time snapshot and is *not* kept in sync with it (repo description still says "Duplicate of
ferosem-cpu/Platino-RECD-"; `README.md` still says Platino). Zan-APP has its own database and
deployments. Durable lessons inherited from Platino are folded into the gotchas below
(fail-loud `JWT_SECRET`, no legacy `"builds"` array in `vercel.json` — it silently skips
`prisma generate` —, shared package must compile to CommonJS, Mumbai DB + `bom1` region).

**Users:** internal staff (Super Admin, Owner/Admin, Management, Sales, Operations, Erection &
Commissioning Engineers, Service Team, Finance), external erection companies (**Vendors**) and
their engineers, and **Customers** (portal, e-mail OTP login).

**Real data in prod:** 30 RECD KVA product variants (from `RECD_Full_GA_Extraction.xlsx`) plus
`RECD-810` (user-confirmed genuine); 29 orders/sites for customer "Ethen Power Solutionns Pvt
Ltd". Other real customers include BPCL, VRL, Bostik, Mahindra Aerostructures, Wipro, Kaynes,
Ojas; InterGlobe Aviation appears as a site end-client (`Site.companyName`).

## 2. Quick facts

| | |
|---|---|
| **Repo** | `github.com/ferosem-cpu/Zanf-RECD-erection`, default branch `master`. Dev machine: Windows, `D:\Projects\Zan-APP`; since 2026-10 also `D:\Apps\Zanf-RECD-erection` on DESKTOP-EKD438U (API deploys of 2026-10-08 ran from there). |
| **Local ports** | API `4011`, admin-web `6011` (Platino uses 4001/6001, so both can run side by side). |
| **Production DB** | Supabase project `zan-app`, ref `idqzupopsuusoihpmoqc`, `ap-south-1` (Mumbai). |
| **Vercel team** | `ferose-salahudeen-s-projects` (`team_psJwhw81rjDAba1sPZSBqxzZ`, Hobby). Vercel CLI logged in as `ferosem-1321`. |
| **Vercel — admin-web** | Project `admin-web`, git-connected to **this repo**. Prod: `app.zanf.org` (also `admin-web-three-blush.vercel.app`). The Vercel GitHub app does build on push (commit statuses on master 09-05/09-09/09-17), and master pushes **do deploy to production** (confirmed 2026-09-27) — still confirm the new build is live on `app.zanf.org`; if not, deploy with `vercel deploy --prod` (remote build) from the repo root. **Never `--prebuilt`** from Windows (symlink EPERM). See §8. |
| **Vercel — API** | Project `zan-app-api` (`prj_yf9RGAw5mnBhJdVi9lDCJncdkrnS`), `zan-app-api.vercel.app`, region `bom1`. **Not git-connected** in practice: its git-triggered builds always fail "No entrypoint found" (harmless noise, the live alias is untouched). Deploy with the manual procedure in §8. |
| **Google Drive** | Account `zanfpowersystems@gmail.com`, folder `ZanF_DropBox` (`1M3V4MdO0NLMHPJMr7naK0EFGLIT8aIRU`). OAuth client `zan-app-agent-drive` (Desktop type) in Cloud project `MyPersonalAgent` (`mypersonalagent-503004`), owned by `ferosem@gmail.com`. Consent screen published 2026-08-18 (no 7-day token expiry; an "unverified app" warning on re-consent is expected — click Advanced). Scopes `drive.readonly` + `drive.file`. Regenerate the refresh token with `apps/api/scripts/getDriveRefreshToken.js` (loopback flow). |
| **E-mail** | Zoho SMTP `smtp.zoho.in`, sender `info@zanf.org`. **The local `.env` has real Zoho creds — local smoke tests send real mail.** |
| **Primary Super Admin** | `ferosem@gmail.com`, **Google-only** (`POST /auth/google`; `POST /auth/login` returns generic invalid-credentials). Allow-list: `apps/api/src/lib/authPolicy.ts`. Local seed: sample staff users (`owner@`, `sales@`, `finance@example.com`, …) use password `changeme123`; the Super Admin is seeded without a password (Google-only). |

## 3. Architecture

- **Turborepo / npm-workspaces monorepo**: `apps/api`, `apps/admin-web`, `apps/mobile`,
  `packages/shared`, `docs/`, `.claude/`, `turbo.json`, `tsconfig.base.json`, root `.npmrc`
  (`include=dev`), `.env.example`.
- **`apps/api`** — Express 5 + Prisma 5 + JWT (TypeScript). Routes in `src/routes/`, business
  services in `src/services/` (`ledger.ts`, `settlement.ts`, `gstExport.ts`, backup,
  notifications), helpers in `src/lib/` (`googleDrive.ts`, `googleAuth.ts`, `email.ts`,
  `emailTemplates.ts`, `csv.ts`, `jwt.ts`, `authPolicy.ts`, `crypto.ts`), agent in `src/agent/`.
  Prisma `binaryTargets: ["native","rhel-openssl-3.0.x"]`. Single auth middleware:
  `src/middleware/auth.ts` (`authenticate`, `requirePermission`, `requireRole`,
  `requireAgentAccess`). JWTs are 7-day bearer tokens (`JWT_EXPIRES_IN`), no refresh endpoint;
  `authenticate` re-loads the user every request (inactive users and non-approved vendors'
  members are refused).
- **`apps/admin-web`** — Next.js **15.5** App Router + Tailwind + React 18. Key components:
  `DataTable.tsx`, `Nav.tsx`, `AuthGuard.tsx`, `AgentChatBubble.tsx`, `NotificationBell.tsx`,
  `reports/ReportChrome.tsx`; libs `apiClient.ts`, `csvExport.ts`, `finance.ts`,
  `orderValue.ts`. Env: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. ~41 static pages.
- **`apps/mobile`** — Expo/React Native. **Never runtime-tested.** All remaining high/critical
  `npm audit` findings are in its dependency tree.
- **`packages/shared`** (`@recd/shared`) — Zod schemas, types, constants, **compiled to
  CommonJS**; consumers read `dist/`. After any edit: `npm run build --workspace=packages/shared`
  and restart the API.
- **"Data, not code"**: stages, roles, permissions, statuses, photo checkpoints, structure types
  are DB rows, not enums.
- **Documents**: `DocumentSequence` + `nextDocumentNumber()` give gap-free numbers per financial
  year (e.g. `CRN/2026-27/0001`). GST math in `computeDocumentTotals` (CGST+SGST intra-state,
  IGST inter-state). HSN/SAC is mandatory on line items (Zod only; no DB `NOT NULL`).
- Other libs: nodemailer 10, `googleapis` (211 MB; only `google.drive()` + `OAuth2` used),
  `pdf-parse` (must stay dynamically imported), `mammoth`, `openai`, `@anthropic-ai/sdk`,
  react-markdown v9 + remark-gfm.
- **Tests**: `npm test` at the root runs every workspace's `node:test` suites via `tsx`
  (`apps/api/test/*`, `apps/admin-web/test/*`). **Lint is not set up** (no ESLint installed;
  `npm run lint` fails).

## 4. Roles, permissions and auth

- **Super Admin** is the only role with `manage_settings`. **Owner/Admin** and **Management**
  get `ALL_PERMISSIONS` minus `manage_settings`. Others: Sales (has `manage_orders`), Operations,
  E&C Engineers, Service Team, Finance, Customer. Every permission is enforced client- and
  server-side.
- Permission keys in use include `manage_orders`, `view_orders` (read-only, Finance), `place_order`
  (Customer), `manage_quotations`, `manage_invoices`, `manage_purchase_orders`,
  `record_payments`, `approve_vendor_invoice`, `view_ledgers`, `manage_credit_notes`,
  `manage_vendors`, `view_site_status`, `change_site_status`, `raise_complaint`,
  `manage_settings`.
- Role → permission sets live in `apps/api/prisma/roleDefinitions.ts` (used by the seed and
  unit-tested). Management / Owner-Admin are computed as `ALL_PERMISSIONS` minus
  `manage_settings`, so a new key is included automatically **in the seed**. Prod never re-runs
  the seed: ship every new grant as an idempotent SQL migration that looks roles/permissions up
  by key (pattern: `20260927120000_management_all_permissions_except_settings`). Historically
  grants went in by hand via the Supabase MCP, which is how prod Management drifted.
- Only `erection_engineer` users may carry `User.vendorId` (`roleAllowsVendor`); any vendorId
  vendor-scopes every site query, so `POST /users` rejects it for other roles and a role change
  away from erection engineer clears it.
- **Vendors** are tenant-isolated (`User.vendorId` / `Site.vendorId`) on every site route.
  Vendor status: `pending | approved | rejected | archived` (`VENDOR_STATUS`). Public
  self-registration → pending → staff approve (creates the contact's erection-engineer login
  with a temp password) or reject. Staff can `POST /vendors` (pre-approved). Archive
  (`POST /vendors/:id/archive`) keeps history, optionally reassigns sites, deactivates member
  logins; no un-archive in the UI. **Since 2026-09-27 members of any non-approved vendor are
  blocked on every login path and existing sessions** (`isVendorAccessBlocked`).
- **Customers have no password.** Login is e-mail OTP (`/auth/email-otp/request` + `/verify`);
  they must have `User.customerId` set. `POST /users` / `PUT /users/:id` refuse
  `roleKey: "customer"` (customers are created from the Customers page). Emails are normalized
  (trim + lowercase). OTP uses a crypto RNG; the `devCode` echo is hidden when
  `NODE_ENV=production`. OTP responses are deliberately generic, so debug via the `OtpCode` and
  `NotificationLog` tables. Legacy `/auth/customer/register` + `/verify` (Order ID + phone) and
  `/auth/otp/*` (phone) are live on the backend with no UI — don't delete without checking.
  Customer OTP verify routes self-heal a stray `mustChangePassword`; `AuthGuard` never sends
  customers to `/change-password`.
- Staff log in with password (`/auth/login`) or Google (`/auth/google`, `GOOGLE_CLIENT_ID`).

## 5. Modules

- **Orders / Sites / SITC**: `/orders`, `/orders/[id]` (Edit order, `PATCH /orders/:id`,
  staff-only), `/sites`, `/sites/[id]`. Several RECDs per site are `Order.lineItems`
  (`OrderLineItem`) — **always include lineItems**. New order form takes multiple product lines
  (extra lines via `POST /orders/:id/line-items`). Order Value auto-fills from customer pricing;
  the edit page has "Populate cost" (sums all products) and "Update pricing" deep links
  (`lib/orderValue.ts`). `SiteStageEvent` = status timeline; `RecdDelivery` = deliveries. Order
  value is stripped from customer-facing site responses.
- **Customers / Products / Vendors CRUD**: `/customers/[id]` (with Ledger link; delete guarded),
  `/products/[id]` (shape enum `cylinder|triangle|rectangle`, free-text dimensions, weightKg,
  silencerType 1|2), vendors as in §4. `Customer.gstin`/`state` settable on create and edit
  (`state` drives the GST place-of-supply default).
- **Finance**: Quotations (delete guarded, convert to order), Invoices (proforma + tax, issue,
  `InvoiceEditLog`, `DELETE` only for cancelled `DRAFT-` ones), Purchase Orders, Expenses, Work
  Orders (`WorkOrderProduct` multi-product), Finance dashboard, Saved Items (`SavedLineItem`,
  default SAC 9987), Customer Pricing (`/finance/customer-pricing?customer=`), vendor
  invoices/bills (`/finance/vendor-invoices`, AI extraction).
- **Accounting-Lite (all 4 phases live since 2026-08-28; plan in `docs/ACCOUNTING_LITE_PLAN.md`)**:
  A — party ledgers `/finance/ledgers`, `GET /ledgers/customer/:id` and `/supplier/:id`, opening
  balances. B — `/finance/credit-notes` (CRN sequence, draft→issued→cancelled; the invoice detail
  page shows issued CNs and has a "Create credit note" button) and `/finance/debit-notes`
  (internal, no sequence). C — `/finance/payments` (`POST /payments`: split allocation,
  advances, TDS), `/reports/tds` (`GET /ledgers/tds?fy=`); `services/settlement.ts` is the
  **single definition of "paid"**. D — `/reports/gst-returns`, `GET /ledgers/gst/gstr1` and
  `/gstr3b` (`?format=csv`) — filing aids, not filing-ready.
- **Vendor payments/advances**: `/finance/vendor-payments`, `POST /bills/payments` (overpayment
  becomes an advance), `POST /bills/:id/apply-advance`, optional order tags (`PaymentOrderTag`).
- **Customer Purchase Orders**: `/customer-pos`, `/customer-pos/new` (upload + AI extract),
  `/customer-pos/[id]`; uses `manage_orders`.
- **Customer Portal** `/customer/portal`: multi-site switcher, Raise Support Ticket, "Request
  New Order" (`place_order`; value null; `Order.requestedByCustomer`; notifies Management in-app
  and e-mails `info@zanf.org` via the `new_order_placed` template).
- **Notifications**: `NotificationLog` (+`readAt`), `GET /notifications`, `POST /:id/read`,
  `/read-all`; bell polls every 30 s. Bespoke e-mail copy only for `otp_code`,
  `site_stage_updated`, `vendor_assigned_site`, `new_order_placed`; the rest render generic
  key/value.
- **Reports**: `/reports/sitc`, `/finance`, `/customer-history`, `/vendor-performance` (built
  client-side), each with Print + CSV.
- **DataTable** on every list page: column show/hide (localStorage `zan-app:columns:<page>`),
  per-column filters, `accessorList` multi-value filters, Print (landscape, letterhead).
- **Print/PDF** (quotation/invoice/PO): single header/footer, bundled Tinos font, editable terms.
  Verify with a real Playwright PDF render, not on-screen.
- **Backups**: in-app backup settings, manual run and schedule with Drive upload
  (`/backup/*`); scheduled run via Vercel cron.

## 6. In-app AI agent (`apps/api/src/agent/`)

- Floating chat bubble (`AgentChatBubble.tsx`): markdown, Copy button, mic (Web Speech API —
  Chrome/Edge only). Hidden until a Super Admin enables roles in **Settings → Agent Visibility**
  (`CompanySettings.agentVisibleRoleKeys`, empty = nobody; enforced server-side by
  `requireAgentAccess`). **The Customer toggle is still OFF in prod.** Won't answer until a
  provider exists in **Settings → Agent providers**.
- Providers: `AgentLlmProvider` rows (name, type `anthropic|openai_compatible`, baseUrl, model,
  priority, isActive), keys AES-256-GCM encrypted with `AGENT_SECRETS_KEY`. Tried in priority
  order with fallback (`llm.ts`, `providers/providerHealth.ts`): a provider returning **HTTP 410**
  is logged and skipped for 60 min per instance (cleared when the row is edited); all failures
  are logged (`[agent:...]` in Vercel runtime logs) and the final error lists the **primary**
  provider's error first. Configured in prod: **Gemini (priority 1)** via the OpenAI-compat
  base URL, **NVIDIA (priority 2) — returns 410**, see open items. Gemini base URLs route PDF
  extraction to native `:generateContent`.
- `CompanySettings.agentCustomInstructions` is appended to `systemPrompt.ts`
  (`buildAgentSystemPrompt(isCustomer)`). Prompt lesson: concrete worked examples beat abstract
  rules; a name may be a customer, a vendor **or** a site end-client, so search all before "no
  records".
- Tools (`tools/registry.ts`, `zanAppReadTools.ts`, `zanAppDetailTool.ts`,
  `zanAppWriteTools.ts`) mirror their REST route's permissions and row scoping. Read: search
  customers/vendors/quotations/invoices/POs/expenses/orders_and_sites/work orders/complaints,
  `search_site_status_updates`, `search_saved_items`, `get_customer_pricing`,
  `get_customer_ledger`, `search_credit_notes`, `get_customer_advances`, `get_document_detail`,
  Drive search/read (reads limited to descendants of the Drive folder; refused for customers).
  Write tools are **confirm-gated** (`AgentPendingAction` → `executeConfirmedAction`) and
  draft-only: `create_expense`, `create_purchase_order`, `create_quotation`, `create_invoice`,
  `create_saved_item`, `create_complaint`, `create_site_status_update`, `create_customer_po`,
  and others. No Accounting write tools, no edit tools. Customers only reach their own
  orders/sites and `create_complaint`.
- Conversations: `AgentConversation`; daily cron deletes threads > 30 days. **Test prompt/tool
  fixes in a new thread** (old history outweighs fixes). The manual tool harness
  (`agentTest.ts`) is mounted only outside production.

## 7. Integrations and environment variables

- **Drive** (see Quick facts): agent document search (PDF/DOCX extraction) and "Create Drive
  folders" on a site.
- **E-mail**: `lib/email.ts` (nodemailer) + `emailTemplates.ts`.
- **Cron** (`apps/api/vercel.json`): `/agent/cron/cleanup-conversations` daily 03:00 UTC and
  `/backup/internal/run-scheduled` daily 19:30 UTC (01:00 IST). Both **fail closed** — 401
  unless `CRON_SECRET` is set and the bearer matches.

| Variable | Where | Notes |
|---|---|---|
| `DATABASE_URL` | api | Sensitive in Vercel (redacted by `vercel env pull`). |
| `JWT_SECRET` | api | API **throws at boot** if unset. `JWT_EXPIRES_IN` optional (7d). |
| `CRON_SECRET` | api | Required for both crons (fail closed). |
| `AGENT_SECRETS_KEY` | api | Decrypts provider API keys. |
| `GOOGLE_CLIENT_ID` | api | Google sign-in verification. |
| `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID` | api | Drive. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM_ADDRESS` | api | Zoho. |
| `NODE_ENV`, `PORT` | api | `NODE_ENV=production` hides OTP `devCode` and the agent test harness. |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | admin-web | |

## 8. Deploying

### Rule: backend first
When a change spans both apps, deploy `zan-app-api` and confirm it live **before** the dependent
admin-web change goes out — or make the frontend tolerate the old API (optional chaining). A
same-push frontend+backend change crashed prod Sites on 2026-08-20. "Works locally" is not
evidence, because the local API picks up changes instantly.

### Database migrations
Prod history has **drifted**: much DDL went in via the Supabase MCP `apply_migration`, some with
different timestamps than the local files, and `_prisma_migrations` has hand-inserted rows. Before
writing a migration, diff `information_schema.columns` against the Prisma schema. To apply to
prod either run `prisma migrate deploy` with the prod `DATABASE_URL`, or apply the SQL via the
Supabase MCP and insert the matching `_prisma_migrations` row (SHA-256 of `migration.sql`).
No migrations pending (2026-09-27: `20260922090000_make_super_admin_google_only` and
`20260927120000_management_all_permissions_except_settings` applied via Supabase `execute_sql`
plus matching `_prisma_migrations` rows). **Do not run `prisma migrate deploy` against prod yet**:
15 local migrations (`20260813122825_add_product_shape_dimensions_weight` …
`20260829054500_add_backup_settings_and_log`) are applied in prod (via Supabase
`apply_migration`, different timestamps) but have **no `_prisma_migrations` row**, so Prisma would
try to re-run them. Backfill those rows first (see §10). The prod `DATABASE_URL` is a Sensitive
Vercel var (`vercel env pull` returns `[SENSITIVE]`), so use the Supabase connector. Locally,
run `npx prisma migrate deploy` after pulling schema changes.

### admin-web
1. Push to `master`, then check `app.zanf.org` actually serves the new build (look for a new
   string in the shipped JS, not just "Ready").
2. If it doesn't: from the **repo root**, `npx vercel deploy --prod` — remote build on Vercel's
   Linux, no `--prebuilt`. The root `.npmrc` (`include=dev`) makes the remote install keep
   devDependencies.

### zan-app-api (manual; run every step from `apps/api`)
1. Stop the local API dev server (Windows Prisma EPERM).
2. `npx vercel pull --yes --environment production`
3. Delete stale output: `Remove-Item -Recurse -Force .vercel\output, dist -ErrorAction SilentlyContinue`
   (a leftover `.vercel\output` can otherwise be deployed silently).
4. `npx vercel build --prod 2>&1 | Tee-Object build.log` — usually 5–20 min (once ~50), almost
   all `@vercel/nft` tracing; rising CPU/memory is normal. Grep the log for errors afterwards.
5. Confirm the new code is in the output, e.g.
   `Select-String -Path .vercel\output\functions\api\index.func\apps\api\dist\routes\<file>.js -Pattern "<new string>"`.
6. **Patch `@recd/shared`** (the workspace symlink doesn't survive tracing — confirmed needed on
   Linux too, 2026-09-27; skip step d on Linux, the workspace symlink already exists):
   a. List `.vercel/output/functions/` and patch **every** `*.func` present (layout varies by CLI
      version: `api/index.func`, sometimes also `index.func`).
   b. In each `*.func/.vc-config.json`, delete the whole `"filePathMap"` key if it mentions
      `@recd/shared` (otherwise deploy fails `ENOTDIR ... node_modules/@recd/shared`).
   c. Create `node_modules/@recd` first, then copy `packages/shared/dist` + `package.json` into
      `*.func/node_modules/@recd/shared`, and into `*.func/apps/api/node_modules/@recd/shared`
      where that directory exists.
   d. Make `apps/api/node_modules/@recd/shared` exist for the local preflight as a **junction**:
      `New-Item -ItemType Junction -Path node_modules\@recd\shared -Target ..\..\packages\shared`.
      Remove it after deploying with `(Get-Item node_modules\@recd\shared).Delete()` — never
      leave a real copy there (it shadows the workspace link and hides future shared changes).
   Write this as a `.ps1` and run with `-File`.
7. `npx vercel deploy --prebuilt --prod`
8. Verify: `GET /health` → 200; `POST /auth/login` with bad creds → 401 (proves DB/bcrypt ran);
   an auth route like `GET /agent/providers` → 401 not 404; `npx vercel logs <url>` clean. A 401
   does **not** prove a brand-new route exists (router-level `authenticate` answers first) —
   test with a valid token + real id, or rely on step 5.

**Ignored Build Step (since 2026-10-08):** project `zan-app-api` has `commandForIgnoringBuildStep`
= `exit 0` and Root Directory left empty. Git-triggered builds failed "No entrypoint found"; setting
Root Directory = `apps/api` instead would make git builds succeed and auto-promote WITHOUT the
`@recd/shared` patch (step 6) and would clash with the `apps/api/.vercel` link. Git builds now show
"Canceled by Ignored Build Step"; `--prebuilt` deploys are unaffected (verified).

Untried simplification: plain `vercel deploy --prod` (remote build) for the API might remove
steps 2–7 entirely, as it did for admin-web. Try it on a low-risk change first.

## 9. Recurring gotchas

- **Field in state and payload but no `<input>` in JSX** — happened 3+ times (PO HSN, quotation
  product, invoice edit). Check this first when "I can't set X".
- Forgetting **`Order.lineItems`** in includes (agent, Sites list, Orders list).
- **Check what the API already returns** before adding backend code — twice the data was there.
- **PATCH responses are thin echoes** — reload with GET, don't merge (09-09 crash).
- **Shared changes need a rebuild**; watch for a stale real copy in
  `apps/api/node_modules/@recd/shared` shadowing the workspace link.
- **`NODE_ENV=production` is set globally on the dev machine**: npm silently omits devDeps
  (fixed by `.npmrc include=dev`; check `npm config get omit`), and OTP `devCode` is hidden
  locally too.
- **`npm install <pkg>` crashes** (arborist, null `location`): hand-edit `package.json`, run bare
  `npm install` (add `--ignore-scripts` on EPERM, then build shared + `npx prisma generate`).
- **`next dev` is broken locally** (globals.css through the RSC CSS loader) — use
  `next build && next start`, with cwd **inside `apps/admin-web`** (Tailwind content glob is
  cwd-relative; otherwise you get unstyled pages with only a warning). Kill whatever listens on
  6011, not the launcher PID.
- **Windows Prisma EPERM** on `query_engine-windows.dll.node`: kill the stray `node.exe`
  (`Get-Process node | ? { $_.Modules.FileName -like '*query_engine*' }`).
- **Windows symlink EPERM** in local `vercel build` for admin-web (Build Output step symlinks
  identical functions; not a `next.config.js` issue). Use remote deploys, enable Developer Mode
  (admin once), or build in WSL2.
- **Native-binding deps (pdf-parse) must be dynamically imported** — a static import crashed the
  whole API at boot.
- Express: literal paths before `/:id`. DELETEs return 204 with an empty body (`apiClient`
  handles it).
- react-markdown v9: destructure `node` out of component props.
- "Redeploy" on an old Vercel dashboard row rebuilds that pinned commit, not the latest.
- Tooling: Desktop Commander strips `$` from inline commands — write `.ps1`/`.js` files and run
  with `-File`. Cloud sessions without machine access can't run the API deploy. The agent can't
  log into admin-web with a password; verify via SQL (Supabase MCP) and API calls. Supabase MCP
  prod calls are intermittently blocked and need an explicit "proceed".
- Work done from the mobile app lands on unmerged `claude/<slug>` branches — check
  `git branch -a` before rebuilding anything.

## 10. Current open items (as of 2026-10-08)

**Branch `fix/ledger-opening-date-and-drive-search` (pushed, NOT merged/deployed)** - see §11
2026-10-08. Deploy API first (admin-web's "Delete rejected invoice" calls a new route). No
migration needed. Still in progress on the branch: GST-basis labels in search_invoices + revenue
"to date"/all-time periods (piece C, uncommitted WIP), follow-up prompt rules (E), IST dates in all
tool output (F), expenses totals (G), chat-bubble thread-switch race (H), and
`docs/agent-test-checklist.md`. Progress note: `.claude-task/fix4b-progress.md` (local only).
After deploy, verify against production: payables KPI now includes Verified bills (Platino),
Selvam Enterprises' partially paid bill in get_payables, receivables incl./excl. GST vs the Finance
dashboard, sites with update status Done, Drive search for "proforma invoice" / "PCR".
- **Drive access (Ferose):** the agent only sees files INSIDE `ZanF_DropBox` (any subfolder depth)
  that `zanfpowersystems@gmail.com` can read. Move (not shortcut) the Zan-F invoice / PCR folders
  into ZanF_DropBox, or share them to that account and add them inside it. Shortcuts are not followed.
- **Supplier ledger vs payables:** payables now count Verified bills; the supplier ledger still
  posts bills only from Approved. Decide whether the ledger should match.
- **GSTR-3B finding (not fixed):** `services/gstExport.ts` subtracts `discountAmount` from
  `subtotal`, but `subtotal` is already after line discounts - outward taxable value is
  under-stated when invoices carry discounts.

**Deploy / decisions for Ferose**
- **15 prod migrations without a `_prisma_migrations` row** (`20260813122825` …
  `20260829054500`, see §8): `prisma migrate deploy` against prod is **not safe** until rows are
  backfilled (checksum = SHA-256 of each `migration.sql`, after confirming each one's objects exist).
- **Customer role lacks `place_order`** in prod (the Permission row didn't exist until the
  2026-09-27 migration, which granted it to Management only), so customer-portal order requests
  (`POST /orders`, `GET /products`) likely 403. Grant it with an idempotent migration if wanted.
- **Intermittent `net::ERR_FAILED` / "Failed to fetch" in the browser** (2026-09-27 role tests):
  the failing requests never reach the API (no errors/5xx/429, firewall 0 blocks) and a headless
  Chrome probe of preflights, 401s and 304s shows valid CORS. Likely client/network side (extension,
  VPN/proxy, connection). Since PR #6 it no longer logs users out. If it recurs, capture the full
  console line + DevTools Network entry.
- **Management smoke test**: have a Management user sign out/in and check Orders, Sites, Customers.
- **NVIDIA fallback returns HTTP 410.** Model id/key live in the `AgentLlmProvider` row, not
  code. With the NVIDIA key, check `GET https://integrate.api.nvidia.com/v1/models`; then in
  Settings → Agent providers try a current tool-calling model such as
  `nvidia/llama-3.3-nemotron-super-49b-v1.5` or `mistralai/mistral-nemotron`. If every model
  410s while `/models` works, the account lacks NVIDIA's "Public API Endpoints" entitlement
  (help@build.nvidia.com) — or replace NVIDIA with another provider. Until fixed, the code skips
  it and reports Gemini's error.
- **admin-web auto-deploy — confirmed 2026-09-27**: master pushes build as **Production** and
  get aliased to `app.zanf.org` (merge `b20febf` → `dpl_D45kYuxyaYCYW9MK2iqPGFj2cQsc`). Caveat:
  that means a frontend change goes live on merge, before a manual API deploy — keep the
  backend-first rule in mind (deploy the API before merging dependent frontend changes).
- **Agent tooling access**: the Vercel MCP connectors available to agents can't see the
  `admin-web`/`zan-app-api` projects (403/empty) — reconnect with both projects authorized if
  agents should inspect Vercel.

**Needs real-user click-through (no code owed)**
- Order value auto-fill, "Populate cost", "Update pricing"/"Add pricing" links (math is
  unit-tested; UI isn't).
- Accounting-Lite A–D (ledgers, CN/DN issue flow, split payments + TDS register, GSTR-1/3B vs a
  real filing), vendor advances + order tags, agent Accounting reads, DataTable Columns/filters
  and Print, "Create Drive folders", delete actions after the `apiClient` fix, Reports (filters,
  Print, CSV), multi-product new order, order edit Save.

**Data waiting on the user**
- `RecdDelivery` is mostly empty for Ethen's 29 sites (only INTERGLOBE/Devanahalli and
  VRL/Peenya have rows, both incomplete). Import from `Material_Delivery_Status_version_1.xlsx`
  awaits approval; confirm whether sheet "BPCL, DEVANAGONTI" = DB "BPCL Hosakote".

**Known gaps / tech debt**
- Bill (vendor invoice) detail page has no advance section (apply advances from
  `/finance/vendor-payments`).
- No admin badge/filter for `requestedByCustomer` orders; customer product picker shows no
  pricing.
- Customer agent visibility toggle off in prod (deliberate). Most notification templates generic.
- `Product.shape` enum too coarse (rich text parked in `ratingSpec`).
- `apps/api/scripts/verify*.ts` throwaway scripts; lint not configured.
- No audit log for quotations/POs (invoices have `InvoiceEditLog`).
- Agent may invent HSN codes (Zod rejects them); no agent Drive upload; no agent edit tools;
  mic absent on Firefox/iOS.
- Next 16-only PostCSS advisory and Expo/RN high/critical advisories deferred (major upgrades).
- API build slowness levers untried: Defender exclusion; `googleapis` → `@googleapis/drive`
  (needs a real Drive OAuth round-trip test).

## 11. Changelog (last ~10 entries; full history at `924329a`)

- **2026-10-08 — Branch `fix/ledger-opening-date-and-drive-search` (on branch, not yet
  merged/deployed).** `fb64153` ledger opening balance no longer dated 01 Jan 1970 (TDS register
  checked: unaffected). `7ebdf42` sites "done" = latest status update (StatusOption `done`/"Done",
  Sites list "Update status"); `search_orders_and_sites` gets `updateStatus`, label/case-tolerant
  stage filter, `byUpdateStatus`; unknown filter values return the valid list. `71740cb`
  `get_payables`, `get_revenue_summary` (Indian FY quarters, invoiced excl./incl. GST net of CNs vs
  collected cash; period + basis stated). `9562f8b` + `5c5d1b4` `get_receivables`: outstanding
  incl. GST (total − issued CNs − settled incl. TDS, `settlement.ts`) and excl. GST (outstanding ×
  subtotal/total), per customer, ageing from shared `services/ageing.ts`, overdue invoice list.
  `18cc0a5` delete REJECTED vendor invoices: soft delete (status `deleted`, number renamed so it can
  be re-entered, audit entry kept; refused with payments/debit notes; `approve_vendor_invoice`); GST
  summary report excludes rejected/cancelled/deleted bills. `27dc264` Drive search covers the whole
  ZanF_DropBox tree (cached folder tree, names or content, phrase or all words, all drives, paging,
  folderPath); root cause was direct-children-only search. `da52fb1` read-only tool calls of one
  step run concurrently (25 s per-tool timeout). `8d9129d` shared `services/payables.ts`
  (Verified + Approved + Partially Paid) used by the Finance dashboard **(fixes Outstanding payables
  missing Verified bills)** and the agent; new `search_vendor_bills`; PO-vs-bills per vendor. Tests:
  API 107, admin-web 24. Root `CLAUDE.md` added.
- **2026-10-08 — Merged + deployed to production.** Merges `e1086c9` (fix/agent-overdue-invoices),
  `051ca09` (fix/agent-document-capabilities, tip `85e09bf`), `5ec3704` (fix/agent-orders-and-totals),
  `ba88248` (fix/agent-tds-and-session-load). API deploys (manual §8, from `D:\Apps\Zanf-RECD-erection`,
  Vercel CLI as ferosem-1321): `dpl_BAjebHYmqKobHoQ8oKbLtPGgNo4F` (051ca09),
  `dpl_1dECiMNuuLEQUXrKjJ3pdCg5Z3Vo` (5ec3704), **`dpl_BbA1zVGtVyQKXNbWBnfGYNHfkBpN` (ba88248, current
  production)**; admin-web auto-deployed on master push (e.g. `dpl_2tsHnYeZ2zFcenSUb2E4apMKhRPp` for
  ba88248). Agent: `overdueOnly` + server-side totals/`complete` flags (`listResult.ts`),
  `search_payments`, open order = site not yet Commissioned, `paymentSplit.ts` (legacy "TDS Deducted"
  rows = all TDS) in TDS register/ledger/dashboard (dashboard received/revenue now cash only),
  lazy-loaded googleapis/mammoth/openai/anthropic, admin-web fetches `/settings` in parallel with
  `/auth/me`. `zan-app-api` Ignored Build Step set (see §8).

**Token-saving practice for Claude sessions:** commit + write a progress note + update HANDOVER
before `/compact` or `/clear`; reference files with `@path` instead of pasting; keep `CLAUDE.md`
under 200 lines; use sub-agents for test runs and checklists; use plan mode for ambiguous designs.

- **2026-10-01 — Capability-aware agent document responses (API deployed).**
  `apps/api/src/agent/systemPrompt.ts` now explains supported document proposals versus
  reads/queries, attachment extraction versus direct PDF/file manipulation, permission
  denials versus missing tools, and confirmation/numbering/approval boundaries. Bulk
  invoice/PI requests (worked example: six site PIs) explicitly retain creation support,
  explain that only one can be prepared at a time, and offer the first item. The same
  guidance covers quotations, supplier POs, customer POs, vendor invoices and other record
  proposals; multiple line items and multi-record queries remain supported. Customer-PO
  and vendor-bill agent query tools are currently absent, despite their app pages existing.
  No bulk creation feature, Finance redesign, schema, permission or confirmation changes.
  `create_invoice`, confirmed-action execution and invoice routes are unchanged.
  Validation: `npm test` **60 passed** (22 admin-web + 38 API), including five new prompt
  contract cases and a mocked `create_invoice` regression exercising proforma/tax proposals,
  permission/conversation checks, required HSN, invalid inputs, default GST/discount, totals,
  and pending-only writes with no real invoice number. Shared build, API TypeScript
  `--noEmit`, and `git diff --check` passed. Initial sandbox runs failed at Windows user
  lookup/Prisma engine download; rerunning outside the sandbox resolved those environment
  errors. API commit `2359092` deployed through Vercel CLI 62.1.0: local production build,
  shared-package patch for both function outputs, staged upload, then promotion to
  `zan-app-api.vercel.app`. Deployment **`dpl_ChCpEPy97fmwazu1FvYjqtCx6YVs`**
  (`zan-app-anjqgu1qd-ferose-salahudeen-s-projects.vercel.app`) verified READY; staged health
  200, agent providers without bearer token 401, deliberately invalid login 401; production
  alias resolved to the new deployment and health returned 200. Error-log scan returned no
  errors. Previous production deployment for rollback: `dpl_4ENejjotNTcTVuG5hgiGatuuU3c8`
  (`zan-app-pl37ulnky-ferose-salahudeen-s-projects.vercel.app`). No frontend deploy or DB
  migration needed. Tests use no production DB or LLM. Prompt tests verify provider instructions,
  not generated replies: smoke-test in a **new agent conversation**
  with the configured provider (six PIs, six-PI query, attached bill/customer PO, PDF editing,
  missing permission). Do not confirm test cards against real records.

- **2026-09-27 — PR #6 merged (`2ec234e`) and deployed: session resilience + guard alignment.**
  Network errors / 5xx no longer log users out (only a 401 does; retry with backoff + banner);
  route guard and sidebar share `admin-web/src/lib/routeAccess.ts` (per-page `/finance/*` and
  `/reports/*` guards; `/products`, `/customer-pos`, `/reports` guarded); complaints overview only
  called with `view_complaints_overview`; `GET /saved-items` readable with `manage_quotations` /
  `manage_invoices`. API `dpl_GFHffg6Siik9tzjyvVNP4pgWaRUT`, admin-web auto-deployed
  `dpl_5F9p3fkCUMbCJ4VFSNTUyRVbf86N`. Intermittent browser "Failed to fetch"/`net::ERR_FAILED`
  not reproducible server-side (no API errors, CORS OK incl. preflights and 304s) — see §10.

- **2026-09-27 — Merged #3/#4/#5, migrations applied, API + admin-web deployed.** Merge commits
  `2a11c2a` (#3), `1ae631b` (#4), `b20febf` (#5). Migrations `20260922090000` +
  `20260927120000` applied via Supabase `execute_sql` with `_prisma_migrations` rows; Management
  now has all 25 permissions except `manage_settings`; primary Super Admin's `passwordHash` is
  null. API `dpl_2Q7VVdJQttj3fLahNPV49Jhy5Yts` (prebuilt from Linux, `@recd/shared` patch still
  needed); admin-web auto-deployed `dpl_D45kYuxyaYCYW9MK2iqPGFj2cQsc` to production.
  `CRON_SECRET` was already set on `zan-app-api`.

- **2026-09-27 — Management couldn't see Orders/Sites/Customers (PR #5).** The code is fully
  permission-driven (no role-name gates), so the cause is prod `RolePermission` rows: Management
  never received the grants seed.ts defines (prod isn't seeded; grants were hand-applied per
  role). New migration `20260927120000_management_all_permissions_except_settings` grants
  Management every permission except `manage_settings` (and removes it if present); role
  definitions moved to `prisma/roleDefinitions.ts` with tests; seed revokes `manage_settings`
  from the all-but-settings roles; staff users can no longer carry a stray `vendorId` (which
  empties Sites). **Deploy: `prisma migrate deploy`.**

- **2026-09-27 — Open-items sweep (PR stacked on #4).** Vendor members blocked on every login
  path and in `authenticate` unless the vendor is approved; agent fallback skips 410 providers,
  logs every failure and never masks the primary error; first automated tests (`npm test`);
  auto-deploy and Windows EPERM investigated (docs only); handover contradictions fixed and this
  file compressed.
- **2026-09-22 — Security hardening (PR #4).** Agent tool harness removed from prod; crons fail
  closed on `CRON_SECRET`; Drive reads limited to the folder tree; crypto RNG for OTP/temp
  passwords; OTP/phone data out of logs; Next 15.5.25, Nodemailer 10.0.10, PostCSS 8.5.28.
- **2026-09-22 — Primary Super Admin Google-only (PR #3).** `authPolicy.ts`, migration
  `20260922090000_make_super_admin_google_only`, seed updated.
- **2026-09-17 — Deployed** `2403451` (order value hidden from customers, `view_orders`) and
  `969de96` (customer GSTIN/State on create), API first.
- **2026-09-09 — Multiple products on a new order**; inline "+ New product" removed.
- **2026-09-09 — Order edit Save crash fixed** (reload via GET instead of merging PATCH echo).
- **2026-09-09 — Order value auto-fill** from customer pricing, "Update pricing" links, then
  "Populate cost" (sums every product) replacing the single "Use" button.
- **2026-09-08/09 — Incident:** order edit (`9c2ef20`) wasn't live; found the global
  `NODE_ENV=production` devDeps bug (fixed with `.npmrc`) and the Windows symlink EPERM; switched
  admin-web to remote `vercel deploy --prod`.
- **2026-09-05 — Order edit** (`updateOrderSchema`, `PATCH /orders/:id`, staff-only).
- **2026-09-05 — Customer portal** multi-site, customer order requests, notification bell;
  agent multi-tool name search, table link rule, `search_site_status_updates`.
- **2026-09-05 — Incident:** prod API outage from the `filePathMap` / `@recd/shared` deploy issue
  (now step 6b of the API procedure) plus a missing prod migration.
- **2026-09-03 — Case-insensitive e-mail lookup** fix for silently swallowed OTP requests
  (`0f96d3f`).

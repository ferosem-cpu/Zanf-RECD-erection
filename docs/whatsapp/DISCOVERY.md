# Zan WhatsApp assistant - M0 discovery (read-only)

Date: 2026-10-10. Revision 3 (rev1 `fa6e4b9`/`f99ef60` and rev2 `4e909da` (+`61618cd` OCI facts) were both CHANGES REQUIRED; finding ids B1, B2, M1-M4, L1 in this file's section 4/6/7 refer to the rev2 re-review, see `REVIEW-M0.md`). Scope: M0 of `docs/whatsapp/PLAN.md`. Docs only: no code, schema or deploy change. "NV" = not verified (production data / live systems not accessible in M0). Everything below marked "proposed" is a contract for M1+ implementation, not current behaviour.

## 0. Owner decisions (Ferose, 2026-10-10)

| # | Decision |
|---|---|
| D1 | Every group except Customers can see site details. Owner/Admin = Super Admin. Settings are blocked over WhatsApp for every group incl. Super Admin. Customers: no reply (default for now) |
| D2 | Finance and engineer restrictions apply APP-WIDE, not WhatsApp only: an explicit, tested role-permission change in M1 with regression checks for the other roles (section 4.3) |
| D3 | Engineers see only their assigned sites |
| D4 | Pilot targets approved: 2 concurrent turns, queue 10, p50 < 15 s, p95 < 45 s, bridge service memory < 100 MB, VM memory < 70%, > 10 GB disk free |
| D5 | Hosting confirmed (10:26 PM IST): the bridge runs on OCI as in PLAN. Zan app users never touch OCI; they only use WhatsApp. The agents (Claude/Grok) may access the OCI servers. Fallback only: if the OCI capacity check fails, propose the second inspected VM or a larger approved instance per PLAN M6. The read-only OCI inspection stays REQUIRED before M3 and M5 (status: **pending**) |

## 1. Verified paths and revisions

| Item | Value |
|---|---|
| Zan repo | `D:\Apps\Zanf-RECD-erection` |
| Branch / base | `feat/whatsapp-m0` from `master` `cf5e049577a12b379cc0ed9028fac27d43796df5` |
| Worktree at start | clean except untracked `docs/whatsapp/` (PLAN.md) |
| WhatsMeow client | `D:\Apps\WhatsMeow\whatsmeow-client\whatsmeow-client` (not a git repo; manual `.bak`/`.exe` backups) |
| Go module | `whatsmeow-client`, `go 1.26.0` |
| whatsmeow dependency | `go.mau.fi/whatsmeow v0.0.0-20260929112325-8b41cfe6d9c4` (pseudo-version, go.mod:22) |
| SQLite driver | `modernc.org/sqlite v1.60.1` (pure Go, no CGO: cross-compiles to Linux) |
| Entry point | `main.go`, CLI subcommands: `login` (QR), `pair <phone>`, `whoami`, `check`, `send <phone> <text>`, `logout` |
| Current behaviour | Short-lived CLI: connect, act, disconnect. Auth and send work. **No receive-and-reply loop**: the message handler only prints sender user part + `GetConversation()` (main.go:76-90). No reconnect logic, no media, no ExtendedText handling (replies/links yield empty text) |
| Store / locking | `sqlstore` on `session.db` in CWD; WAL, `busy_timeout=10000`, `foreign_keys`, `_txlock=immediate`, `SetMaxOpenConns(1)` (database.go:12-18). No retry beyond busy_timeout. Quirks: dead duplicate `if err` (main.go:63-65), double close. Tests exist (`database_test.go`, `main_test.go`), not run |
| LID | None. Inbound sender printed as `Sender.User` only (may be a LID number); outbound JID = digits + `s.whatsapp.net` |
| Platform | Source is portable; shipped artifacts are Windows `.exe` only |

Zan-F Number folder (`D:\Apps\WhatsMeow\Zan-F Number`; names/sizes only, no data file opened):

| Name | Bytes | Last write |
|---|---|---|
| account.json (not opened) | 60 | 2026-10-10 17:10 |
| gowa.env (not opened) | 9 | 2026-10-10 17:47 |
| session.db (session data, not opened) | 1,040,384 | 2026-10-10 17:21 |
| whatsmeow-client.exe | 26,696,704 | 2026-10-09 19:38 |
| Pair Zan-F Number.cmd / QR Login.cmd / Check Connection.cmd | 241 / 155 / 163 | 2026-10-10 17:10 |

Client folder also holds its own `session.db` (393,216 B, 2026-10-09 19:38), 4 exe/backups (~26.7 MB each), 2 `.bak` sources. Zan-F session.db is larger/newer than the client's, suggesting a paired session (inferred from size, NV). The name `gowa.env` hints at a GOWA setup; unverified.

## 2. Assistant entry points, auth model, schema

| Item | Finding | Cite (apps/api) |
|---|---|---|
| Routes | `POST/GET /agent/conversations`, `GET/DELETE /:id`, `POST /:id/messages`, `POST /:id/actions/:actionId/confirm\|reject`; all `authenticate` + `requireAgentAccess` | routes/agentConversations.ts:38-69,586-592 |
| Agent loop | `runAgentTurn({systemPrompt, history, tools, auth, onToolCall?, deadline?})` | agent/llm.ts:26-49 |
| Reuse gap | Turn logic (load/create conversation, prompt, runAgentTurn, persist, sanitize) is inline in the route handler; not an exported service | agentConversations.ts:115-168 |
| Tools passed | ALL tools to every user; filtering happens inside each handler via `auth.permissions` | agentConversations.ts:151; tools/types.ts |
| Auth into agent | `{userId, roleKey, customerId, vendorId, permissions, conversationId}` | tools/types.ts:18-28 |
| Storage | `AgentConversation` (userId, title, `messages` Json), `AgentPendingAction` (toolName, input, preview, status); 30-day retention cron | schema.prisma:1332-1367 |
| Ownership | every route checks `row.userId === req.auth.userId`; no channel field on conversations | agentConversations.ts:56,131,538 |
| Auth models | `User` (id, name, email?, **phone? unique, free text**, isActive, roleId, customerId?, vendorId?), `Role`(key), `Permission`(key), `RolePermission` | schema.prisma:29-77 |
| Context build | `authenticate` loads user+role+permissions per request; rejects inactive and blocked-vendor users | middleware/auth.ts:16-51 |
| Agent allowlist | `CompanySettings.agentVisibleRoleKeys` (empty = nobody; fail closed) | schema.prisma:709; auth.ts:80-90 |
| Super admin | role key `super_admin`; only role with `manage_settings`; no user flag | shared/src/constants.ts:49-60 |
| Customer / vendor | `User.customerId` / `User.vendorId` (external erection vendors, tenant by `Site.vendorId`) | HANDOVER s2 |
| Site assignment | `Site.assignedEngineerId`; used only by REST `assignedToMe` (routes/sites.ts:31); **no agent tool uses it** | schema.prisma:321 |
| Audit | No generic agent/WhatsApp audit table. `NotificationLog` has a `whatsapp` channel stub (`pending_provider_setup`) | schema.prisma:656-663 |
| Confirm gap | confirm route re-checks role allowlist + ownership, not the tool's permission | agentConversations.ts:565,586 |
| Rate limit | none on `/agent/*` (auth routes only) | middleware/rateLimit.ts |

## 3. Provider routing

| Question | Answer |
|---|---|
| Source | DB table `AgentLlmProvider` (name, providerType anthropic\|openai_compatible, apiKeyCiphertext AES-256-GCM, baseUrl?, model, priority, isActive). Env holds only the encryption key name `AGENT_SECRETS_KEY` (factory.ts:8-38) |
| Routing rule | Active providers are tried in ascending `priority`, 0 first (`orderBy priority asc`, active only; factory.ts:32-37; schema.prisma:1318). 0 is only a numeric default: it is first only if no active row has a lower number, ties are unordered, and it is not a FreeLLMAPI code name. Disable = `isActive=false` |
| Fallback | Healthy providers in order; failure -> next; empty reply retried once (sendWithFallback.ts:22-51) |
| Time caps | Request budget 55 s; per LLM call 30 s; attempt cap 25 s when a fallback exists; 8 max tool turns; tool call 25 s; no new LLM call with <4 s left (timeouts.ts:20-59; llm.ts:18-73) |
| Shared limits | None in code: no token/quota counter, no per-user or per-channel budget, no concurrency cap. Cooldown (410 -> 60 min, quota 429 -> 15 min) is **in-memory per serverless instance** (providerHealth.ts:23-35) |
| FreeLLMAPI | Not named in code (only as a DB row). It is an `openai_compatible` row with a custom `baseUrl` (factory.ts:21-27) |
| Priority-0 claim | **VERIFIED (rev3), with one inferred link.** Live rows (below) show the row named "Free LLM API" at priority 0, active, so it is tried first, matching the code rule. The link "this row is the FreeLLMAPI container on VM-A" is inferred from the name and `openai_compatible` type; its base host was not recorded (NV). PLAN.md:34 is now true as to ordering; the PLAN addendum records this. HANDOVER s6's list (Gemini 1, NVIDIA 2) is **stale**; to be corrected on master later, not on this branch |
| Live rows | **Resolved 2026-10-10.** Source: Ferose's screenshots of Settings -> AI providers at 23:39 and 23:41 IST (UI text: tries providers lowest priority first, falls back to the next if a call fails). All four rows active; no rows below Gemini. Base URLs and keys were not recorded. The earlier direct read from the PC (throwaway script selecting name/type/priority/isActive/model/base host only) ended in `PrismaClientInitializationError`; the pulled production env likely has sensitive values blanked. Nothing was improvised |
| Ties | None: priorities 0-3 are distinct, so order is deterministic (the "ties are unordered" caveat does not apply today) |
| Still open (M1 integration) | FreeLLMAPI base host (confirm it equals the VM-A instance), its externally configured quota/concurrency limits, and fallback health. Cooldown state is in-memory per serverless instance (providerHealth.ts:23-35), so health is not observable from rows. Concurrency of WhatsApp turns (2) must be set against those limits |
| Cooldown | 410/429 cooldowns are in-memory per serverless instance (providerHealth.ts:23-38,62-68); WhatsApp turns reuse the same routing and fallback unchanged |

Live provider rows (screenshots, 2026-10-10 23:39/23:41 IST; base host and keys not recorded):

| Priority | Name | Type | Model | Active |
|---|---|---|---|---|
| 0 | Free LLM API | openai_compatible | auto | yes |
| 1 | OpenAI | openai_compatible | gpt-5.6-luna | yes |
| 2 | NVIDIA | openai_compatible | nvidia/nemotron-3-super-120b-a12b | yes |
| 3 | Gemini | openai_compatible | models/gemini-3.5-flash-lite | yes |

## 4. Permission / tool matrix (as enforced today)

28 tools (19 read + Drive x3 + detail; 9 confirm-gated writes). Seeded permissions from `prisma/roleDefinitions.ts:60-150`; production DB rows NV. Admin = Super Admin / Owner-Admin / Management (identical in seed; SA additionally has `manage_settings`, which no tool checks).

| Tool group | Admin | Sales | Ops/PM | Erection | Commissioning | Service | Finance |
|---|---|---|---|---|---|---|---|
| Drive x3 (deny customers only; no permission or document-scope check) | Y | Y | Y | **Y** | **Y** | **Y** | Y |
| customers / suppliers / vendors search | Y | customers | - | - | - | - | customers, suppliers |
| quotations / invoices / POs / expenses | Y | quotations | - | - | - | - | Y |
| search_orders_and_sites (needs manage_orders) | Y | Y | - | - | - | - | - |
| search_site_status_updates | Y | Y | Y | Y | Y | Y | - |
| search_work_orders | Y | - | Y | own | own | own | - |
| search_complaints | Y | - | - | own | own | Y | - |
| ledger / credit notes / advances / payments(TDS) | Y | - | - | - | - | - | Y |
| get_receivables / get_revenue_summary | Y | - | - | - | - | - | Y |
| get_payables / search_vendor_bills | Y | - | **Y** | **Y** | **Y** | - | Y |
| get_document_detail | all types | by type | work_order | work_order, complaint | same | same | quotation, invoice, PO, expense |
| 9 write tools | by perm | quotation, saved item, customer PO | status update, vendor invoice | status update, vendor invoice | same | - | expense, PO, invoice, quotation, vendor invoice |

Settings, provider, credential or permission-admin exposure through any tool: **none today** (settings are REST-only).

### 4.1 Mapping of the plan's groups onto existing roles (per D1)

| Plan group | Existing role(s) | WhatsApp access |
|---|---|---|
| Admin / Management | `super_admin`, `owner_admin`, `management` (Owner/Admin = Super Admin) | Full read policy; settings tools never exposed (D1) |
| Finance | `finance` | Finance read tools + site details; after M1: no work-order detail, no customer contact fields in tool output. In-app finance writes are **kept** (4.3); WhatsApp has no writes for anyone |
| Engineers | `erection_engineer`, `commissioning_engineer`, **`service_team`** (seed key; there is no `service_engineer` role, earlier text was wrong: roleDefinitions.ts:94-120) | Site details for **assigned sites only** (D3); no payables/vendor bills after M1. `service_team` is placed in the engineer-scoped group (stricter default; it holds `VIEW_SITE_STATUS`, `MANAGE_COMPLAINTS`, `ACT_ASSIGNED_WORK_ORDERS`, roleDefinitions.ts:116-119). **Owner to confirm**; if not confirmed it stays in the pilot excluded list (silent) |
| Sales, Ops/PM | `sales`, `ops_pm` | Site details plus the read tools their permissions already grant (V1 default; Ops/PM payables unchanged unless Ferose says otherwise) |
| Customers | `customer` (`customerId` set) | **Silent** (no reply) |
| Unknown | no match / inactive / blocked / unsupported role | Silent drop |

### 4.0 Conflicts found (C1-C13); resolutions in 4.2-4.5

| # | Conflict | Evidence |
|---|---|---|
| C1 | No role-to-tool allowlist exists; one `allTools` array is passed unchanged (registry.ts:8-17; agentConversations.ts:148-153); WhatsApp policy needs a new deny-by-default per-group allowlist on top of permissions | registry.ts; types.ts:5-16 |
| C2 | Engineers and Ops/PM hold `record_vendor_invoice` -> can call `get_payables`, `search_vendor_bills`, `create_vendor_invoice` (engineers seeing finance) | roleDefinitions.ts:91,102,113; zanAppFinanceTools.ts:168,336 |
| C3 | Drive tools deny `customerId` users but have no permission or document-level scope check for any other user: Finance can read non-finance files and engineers can read finance files | driveTool.ts:9-15,37-40,50-52,74-80 |
| C4 | Assigned-site scope not implemented: internal engineers see all sites' timelines; vendor engineers scoped by vendor, not `assignedEngineerId`; results include company-wide counts | zanAppReadTools.ts:1018,1038-1062 |
| C5 | Engineers cannot list sites (search needs `manage_orders`); "assigned-site details" unachievable today | zanAppReadTools.ts:850,1014 |
| C6 | Finance excluded from work orders only by seed; any prod grant of `manage_work_orders` would expose them (NV) | roleDefinitions.ts:121-139 |
| C7 | Finance also receives non-finance data (customer contacts) and 5 write tools | zanAppReadTools.ts:81 |
| C8 | Write tools exist for all groups; confirm endpoint does not re-check the tool permission. WhatsApp v1 must be read-only | agentConversations.ts:565,586 |
| C9 | `get_document_detail` for work_order/complaint is unscoped by id for assignees | zanAppDetailTool.ts:139-168 |
| C10 | Settings exclusion holds only because no tool exists; future tools mirroring REST would give Super Admin settings. Needs explicit deny-list | HANDOVER s6 |
| C11 | Plan names three groups; `sales`, `ops_pm`, `commissioning_engineer`, `owner_admin`, `customer` undefined | roleDefinitions.ts |
| C12 | `User.phone` is unique but un-normalised free text; `isActive`/vendor-block checks live only in `authenticate` | schema.prisma:62; auth.ts:34-38 |
| C13 | PLAN says FreeLLMAPI is priority 0; HANDOVER lists Gemini 1 / NVIDIA 2 | see section 3 |

### 4.2 WhatsApp read-only tool policy (Blocker 1) - deny by default

A tool runs on WhatsApp only if it is listed for the sender's group **and** the user's current permissions allow it **and** the row filter passes. Writes are absent for every group. `Y*` = also row-filtered server-side (4.4).

| Tool family | Admin/Mgmt | Finance | Sales | Ops/PM | Engineers (erection, commissioning, service_team) | Customer |
|---|---|---|---|---|---|---|
| Site / order / site-status search and detail (scoped read, 4.4) | Y | Y | Y | Y | Y* (assigned sites) | silent |
| Work orders / complaints (list, detail) | Y | - (after M1) | - | Y | Y* (assigned sites) | silent |
| Receivables, revenue, invoices, quotations, POs, expenses, ledger, credit notes, advances, payments/TDS | Y | Y | quotations | - | - | silent |
| Payables, vendor bills | Y | Y | - | Y | - (after M1) | silent |
| Customer / supplier / vendor search | Y | suppliers only (after M1) | customers | - | - | silent |
| `get_document_detail` | dispatched by document type; each branch rechecks permission + row scope | finance types only | quotation | work_order | work_order, complaint, assigned only | silent |
| Drive x3 | **excluded from v1** (no per-user/site classification at retrieval or read time; name or prompt filtering is not enough) | - | - | - | - | - |
| 9 write tools, confirm/reject | **absent for all** | - | - | - | - | - |
| Settings, providers, credentials, permission admin | blocked for all incl. Super Admin (D1); no such tool exists today (C10) | - | - | - | - | - |

WhatsApp never creates or confirms a pending action: write tools are not in any WhatsApp policy, and the confirm/reject route rejects `channel=whatsapp`.

Confirm-route fix (M1, concrete). Today `confirmOrReject` checks conversation ownership and pending status only, then calls `executeConfirmedAction(action.toolName, ...)` (agentConversations.ts:537-565). Change: before executing, (1) reload the caller's permissions (as `authenticate` does, middleware/auth.ts:22-45), (2) look up `getToolByName(action.toolName)` and require the same permission predicate that the tool's own write handler applies (e.g. `RECORD_VENDOR_INVOICE` for vendor invoices, zanAppWriteTools.ts:958; `MANAGE_ORDERS` for customer POs, zanAppWriteTools.ts:1116), exported as one `canRunWrite(auth, toolName)` helper used by both the tool handler and the confirm route, (3) reject with 403 and leave the action `pending` on failure, and (4) reject when the conversation's `channel` is `whatsapp`. Tests: `agentConfirmPermission.test.ts` (permission revoked between propose and confirm -> 403, nothing written; each of the 9 write tools has an allowed and a denied role; whatsapp-channel conversation -> rejected).

### 4.3 App-wide M1 role changes (D2) and regression checks

Correction to rev2: rev2 said Finance "loses write tools". That is **withdrawn**. Finance's seeded grants are finance-document work: `MANAGE_QUOTATIONS, MANAGE_INVOICES, RECORD_PAYMENTS, MANAGE_PURCHASE_ORDERS, MANAGE_EXPENSES, VIEW_FINANCE_DASHBOARD, RECORD_VENDOR_INVOICE, APPROVE_VENDOR_INVOICE, VIEW_LEDGERS, MANAGE_CREDIT_NOTES, VIEW_ORDERS` (roleDefinitions.ts:121-138), and the plan requires in-app capabilities and confirmation rules to be preserved (PLAN.md:28; OWNER-HANDOFF.md:28). **Principle: M1 revokes no role grant for Finance or engineers.** The D2 restrictions are implemented by (a) tightening read gates in tool handlers and (b) row/field scoping, so rollback never needs a data change.

**Change list (proposed M1, seed `roleDefinitions.ts` + an idempotent upsert migration, written not applied; prod grants NV and diffed by the owner first):**

| # | Role(s) | Permission / handler change | Files | Effect and what is explicitly kept |
|---|---|---|---|---|
| R1 | Finance | **No grant removed.** Keeps all 9-tool finance writes and the in-app create -> confirm flow for quotation, invoice, PO, expense, vendor invoice | roleDefinitions.ts:121-138 (unchanged) | Kept. Denial test only (below) |
| R2 | Finance | `get_document_detail` work_order / complaint branches require `MANAGE_WORK_ORDERS` / `MANAGE_COMPLAINTS` / `ACT_ASSIGNED_*` and the scope predicate (4.4); Finance holds none of these in the seed, so seeded behaviour is unchanged. A **drifted prod grant** of `MANAGE_WORK_ORDERS` to finance is reported by the grant diff; revoking it is an owner-approved data step, with its inverse SQL recorded in the diff report | zanAppDetailTool.ts:139-168 | Closes C6 |
| R3 | Finance | Customer-contact fields (phone, email, address contacts) are omitted from the **agent tool** output for roles without `MANAGE_ORDERS`; GST/billing identity, name and outstanding stay. REST `/customers` is unchanged because quotation/invoice forms need it (customers.ts:32) | zanAppReadTools.ts:81 | Closes C7. **Owner to confirm** the contact-field omission |
| R4 | erection, commissioning (hold `RECORD_VENDOR_INVOICE`) | Read gate of `get_payables` and `search_vendor_bills` no longer accepts `RECORD_VENDOR_INVOICE` alone: it becomes `VIEW_FINANCE_DASHBOARD` or `APPROVE_VENDOR_INVOICE` or new `VIEW_PAYABLES`. `VIEW_PAYABLES` is granted to `ops_pm` (keeps Ops/PM payables as today) and to the admin trio via ALL | zanAppFinanceTools.ts:168,336; new permission row | Engineers lose the agent payables/bills read only. **Kept:** `RECORD_VENDOR_INVOICE` grant and `create_vendor_invoice` (zanAppWriteTools.ts:958), and REST capture routes (bills.ts:33,140,210). The REST payables report already needs `VIEW_FINANCE_DASHBOARD` (financeDashboard.ts:111), so engineers never had it there: the tool is being aligned to REST |
| R5 | erection, commissioning | REST `GET /bills` and `GET /bills/:id` (bills.ts:116,254, gated by CAPTURE = record or approve) return, for callers holding `RECORD_VENDOR_INVOICE` but none of `APPROVE_VENDOR_INVOICE`, `VIEW_FINANCE_DASHBOARD`, `VIEW_LEDGERS`, only bills they recorded (recorder field to be confirmed against the schema in M1). Ops/PM unchanged | bills.ts:116,254 | Engineers still see and edit their own bills. **Owner to confirm**: this narrows the in-app Bills page for engineers |
| R6 | all non-customer | Site read scoping: new shared predicate `siteScope(auth)` and gate change in `search_orders_and_sites` (4.4). Internal engineers/service_team narrowed to assigned sites in the tool **and** REST `GET /sites`, `GET /sites/:id` (sites.ts:28,57) | zanAppReadTools.ts:843-851; sites.ts:28-66 | **Owner to confirm** impact: engineers lose the all-sites list in admin-web/mobile (D3 applied app-wide, per D2) |
| R7 | all non-customer | Drive: new permission `USE_DRIVE_ASSISTANT` required by the 3 Drive tools. Granted to super_admin, owner_admin, management, sales, ops_pm. **Not** granted to finance, erection, commissioning, service_team (Drive has no per-user/document classification, driveTool.ts:9-15,37-80, so a role that must not see company-wide files cannot be given a generic Drive permission). Customers still denied | driveTool.ts:9-15,37-80; new permission row | Finance/engineers lose in-app Drive search (D2 app-wide). **Owner to confirm** this specific delta. WhatsApp: Drive excluded for everyone regardless |

**Sequencing:** (1) migration step A (additive, idempotent upsert of `VIEW_PAYABLES`, `USE_DRIVE_ASSISTANT` Permission rows and their role grants; grants are a superset of what the new gates need, so no behaviour changes), applied by the owner after the prod grant diff; (2) deploy API with the handler/REST changes (R2-R7), API first then admin-web per HANDOVER s5; (3) only afterwards enable the WhatsApp channel (M3+). No step revokes a grant.

**Rollback:** redeploy the previous API build. Because step A only adds rows and no grant was removed, the previous code still works against the new data; the extra permission rows are harmless and may stay. The one data-changing item is the optional R2 drift revoke, which has recorded inverse SQL.

**Named tests (fakes only; each listed in `apps/api/package.json` "test"):**
- `agentRoleMatrix.test.ts`: for super_admin, owner_admin, management, sales, ops_pm, finance, erection, commissioning, service_team, customer and a vendor-engineer user, every tool's allow/deny before vs after; only the deltas R2-R7 may differ.
- `agentFinanceWrites.test.ts`: finance in-app propose -> confirm still succeeds for quotation, invoice, PO, expense, vendor invoice; same for engineers' `create_vendor_invoice`.
- `restPermissionsUnchanged.test.ts`: direct REST access per role for `/customers`, `/bills`, `/orders`, `/sites`, `/purchase-orders`, `/quotations`; only R5 and R6 deltas differ; customer/vendor tenant scoping unchanged.
- `whatsappPolicy.test.ts`: WhatsApp denial for every write tool, settings, Drive and out-of-group tools, for each role, including Super Admin.
- `roleDrift.test.ts`: seeded roles, and an upgrade over a drifted grant set (extra/missing grants), both end in the intended state; `VIEW_PAYABLES` / `USE_DRIVE_ASSISTANT` present after step A.
- `routeInventory.test.ts`: fails if a route under `routes/` that reads site-, work-order-, complaint- or bill-keyed data for non-customer roles is not registered as scoped or explicitly exempt, so REST coverage is enumerated rather than assumed.

### 4.4 Row and site filters (server-side, in the retrieval path, not the model)

| Rule | Spec |
|---|---|
| Internal engineer | Site visible iff `Site.assignedEngineerId = userId` (schema.prisma:321-322; REST precedent sites.ts:29-31). Applies to detail, counts, timelines, follow-up IDs and related fields; no company-wide totals returned |
| Vendor engineer (`vendorId` set) | Stricter: site visible iff `Site.vendorId = user.vendorId` **and** `assignedEngineerId = userId`. Vendor scope alone is insufficient; unassigned sites are invisible (D3) |
| Other groups | Existing permission and customer/vendor tenant checks (zanAppReadTools.ts:1008-1062) |
| Detail by ID | `get_document_detail` work-order and complaint branches use `findUnique({where:{id}})` after a broad permission check (zanAppDetailTool.ts:139-168). Fix: scoped predicate in the query, or authorise the returned row; a miss and a denial are indistinguishable to the caller |
| Search | Engineers cannot list sites today, and neither can Finance or Ops/PM: `search_orders_and_sites` requires `MANAGE_ORDERS` for every non-customer (zanAppReadTools.ts:843-851); Finance holds only `VIEW_ORDERS` and no `VIEW_SITE_STATUS` (roleDefinitions.ts:121-138), Ops/PM and engineers hold `VIEW_SITE_STATUS` (roleDefinitions.ts:87,98,109,119). See "Scoped site read" below |

**Scoped site read (closes B2).** One shared `services/siteScope.ts` exports `siteScope(auth)` returning a Prisma `Site` predicate (and the equivalent relation filter for `Order`), used by the agent tools **and** REST so the two cannot drift:

| Caller | `siteScope` |
|---|---|
| customer | existing `order.customerId` scope (sites.ts:32), unchanged |
| vendor engineer (`vendorId` set) | `vendorId = user.vendorId AND assignedEngineerId = userId` |
| erection, commissioning, service_team (internal) | `assignedEngineerId = userId` |
| super_admin, owner_admin, management, sales, ops_pm, finance | no row restriction (D1: site details for all non-Customer groups) |

Gate: `search_orders_and_sites` and the site/order branches of `get_document_detail` accept `hasAny(MANAGE_ORDERS, VIEW_ORDERS, VIEW_SITE_STATUS)` (every non-customer role holds at least one; no new permission is needed for site reads), then **always** apply `siteScope`. REST `GET /sites`, `GET /sites/:id` (sites.ts:28,57) and the order-by-site paths apply the same predicate (R6). Finance gets site/order details through `VIEW_ORDERS`, not by being granted `VIEW_SITE_STATUS`, so REST `/sites` stays closed to Finance.

Coverage required (each a named test in `agentSiteScope.test.ts`, for every role in the table plus a vendor engineer and an unassigned site): list results; detail by id (miss and denial indistinguishable); whole-set counts (`scope` at zanAppReadTools.ts:841-848 includes `siteScope`, so counts never reveal other sites); text snippets and timeline/stage-event rows (search term matching an unassigned site's customer name returns nothing and does not change counts); follow-up IDs. Drive is not a retrieval path for WhatsApp (excluded) and is denied to finance/engineers in-app (R7), so document snippets cannot bypass site scope.

### 4.5 Enforcement at execution (Blocker 2)

| Point | Current | Required |
|---|---|---|
| Tool schemas sent to model | all of `allTools` (agentConversations.ts:148-153) | only tools allowed for (channel, group); app channel unchanged |
| Tool resolution at execution | `runAgentTurn` passes global `getToolByName` into `executeToolCalls` (llm.ts:99-107; registry.ts:16-17); executed at toolExecution.ts:76 via `p.getTool(call.name)` | `runAgentTurn` takes a policy-aware resolver built from (channel, group, user). It returns undefined for any tool not allowed, so a disallowed or hallucinated call is rejected whatever the model requests. `isWriteTool` stays as a second guard |
| Re-check | `authenticate` per request only (auth.ts:22-45) | Before **each** tool call: re-load user, role, permissions, active flag, vendor block, identity status and `accessEpoch`; fail closed and abort the turn silently on change |
| Channel | no channel concept | `channel` is a server-set field in the auth context, never from message text |

Test for 4.5: `whatsappResolver.test.ts` (disallowed and hallucinated tool names return undefined and produce a rejected result; schema list equals the policy list; app channel list unchanged).

Paths verified to exist: `apps/api/src/agent/llm.ts`, `agent/tools/registry.ts`, `agent/toolExecution.ts` (the latter lives at `agent/`, not `agent/tools/`).

## 5. Supported vs absent queries

| Area | Status | Tool | Tests | Gap |
|---|---|---|---|---|
| Receivables / overdue | exists | get_receivables, search_invoices | agentReceivables, agentOverdueInvoices | - |
| Payables / bills | exists | get_payables, search_vendor_bills | agentPayablesRevenue, payables | - |
| Revenue | exists | get_revenue_summary | agentPayablesRevenue | - |
| Collections | exists (only on request) | get_revenue_summary, search_payments | agentPaymentsTds | no standalone tool |
| TDS | partial | search_payments (TDS split) | agentPaymentsTds | no register tool |
| Expenses | exists | search_expenses | agentExpenses | - |
| Invoices / quotations / POs | exists | search_*, get_document_detail | helpers only | search_invoices handler untested |
| Ledger / advances / credit notes | exists | get_customer_ledger, advances, credit notes | service only | handlers untested; no GST-return tool |
| Work orders | partial | search_work_orders, detail | **none** | detail unscoped |
| Site status / stage | exists | search_orders_and_sites, search_site_status_updates | agentSiteStatus | needs manage_orders |
| Assigned-site details | **absent** | none uses `assignedEngineerId` | none | new tool/scope needed |
| Complaints | exists | search_complaints | REST scope only | no agent test |

Checklist (docs/agent-test-checklist.md): 73 rows, none for work orders, complaints or engineer roles. All results are "not verified against production".

## 6. Identity-linking design (proposal)

| Aspect | Design |
|---|---|
| Mapping table | **Separate verified table** `WhatsappIdentity` (not `User.phone`): id, userId (FK), e164 (normalised, unique), jid (nullable, unique), lid (nullable, unique), status (`pending`/`active`/`disabled`/`revoked`), createdBy, verifiedBy, verifiedAt, aiPaused, accessEpoch. Why: `User.phone` is unique but free text (schema.prisma:58-75) and is also used for non-auth purposes; normalising it in place would change existing data and still give no verification state, LID binding or revocation. Role/permissions always come from `User.role` at request time (no second role system) |
| Normalisation | Digits only, E.164; India 10-digit -> `91`; ambiguous input rejected. Authorisation never uses message text or `User.phone` |
| Sender identity source | Bridge sends WhatsMeow event metadata only (Sender/Chat JID, LID, any phone JID from the LID store); never parsed from chat text. Today's client logs only `Sender.User` (main.go:76-90), so the bridge needs a new event handler (M3) |
| LID <-> phone reconciliation | Bridge resolves LID to phone JID through WhatsMeow's LID mapping store and sends `{senderJid, senderLid, resolvedPhone}`. Server matches `active` identity by e164, jid or lid. Match only on a single active row. LID-only with no resolvable phone and no stored verified lid -> fail closed, silent. A lid is stored on an identity only by a Super Admin-verified match (never auto-bound from a first message) |
| Collisions | 0 or >1 matches, e164 and lid pointing at different users, inactive user, blocked vendor, non-active identity, lookup error -> silent drop (no reply, read receipt, typing or reaction). Unique constraints make collisions an error, not a choice |
| Reassigned / recycled numbers | Identity carries `verifiedAt`; Super Admin re-verifies on staff exit or number change and periodically (suggest 90 days, owner to confirm). Any observed change of the LID/JID behind an e164, or a user role/active change, sets status `disabled` and bumps `accessEpoch` until re-verified. Pilot users re-verified manually |
| Management | Super Admin only, authenticated settings UI + REST (`manage_settings`); no WhatsApp-side management tools even for Super Admin (D1); no auto-enrolment |
| Revocation | Re-check identity + permissions + `accessEpoch` at ingest, before each tool call (4.5), at outbox lease and at the pre-send claim (section 7); on change discard queued work and outbox rows for that identity |
| Trust model (closes M2) | The bridge is a **trusted identity-asserting component**. The HMAC proves the request came from a holder of the bridge key, not that the JID/LID was really sent by WhatsApp: a stolen or abused key can submit the mapped JID of any active user and be treated as that user. No independent sender attestation exists in WhatsApp Web protocol terms that Zan can verify, so this is an **accepted residual risk, to be signed off by Ferose before activation (M5)**. Containment: (1) read-only, deny-by-default policy means an impersonated user yields at most that user's read data, never writes, settings or Drive (4.2); (2) key custody: one key, readable only by the bridge service user on VM-A (file mode 0600, never in the repo, logs or review packets), two-key rotation overlap, immediate revoke, rotation on any VM access by a person outside the owner's agents; (3) audit: every ingest stores key id, claimed JID/LID, resolved identity, decision and timestamps in `WhatsappInbound`; (4) limits: per-identity rate limit and daily cap, pilot restricted to the listed numbers, `aiPaused` kill switch, alert when one key id resolves more than N distinct identities in an hour |
| Tests (M2) | `whatsappBridgeTrust.test.ts`: forged sender for an **unmapped** JID -> silent drop; forged JID of a **mapped** user under a valid key -> processed only under that user's policy (no write tool, no settings, no Drive) and the audit row records key id and claimed sender; revoked/rotated-out key -> 401 and no row; replayed nonce and out-of-window timestamp -> rejected; rate limit and daily cap trip; distinct-identity alert fires |
| Conversation history | `AgentConversation` gains `channel` (`app`/`whatsapp`) and every stored message and tool result is labelled with its channel (messages is a JSON blob, schema.prisma:1326-1337, replayed whole at agentConversations.ts:130-159). Shared context is retained but each item is re-authorised against the user's **current** role and policy for the replaying channel; items from tools no longer allowed (or from before an `accessEpoch` bump) are dropped from the context |

## 7. Bridge <-> API contract and worker (Medium: bridge/worker)

```
Phone -> WhatsApp -> [OCI: whatsmeow bridge, systemd, own session.db]
  -- HTTPS POST /wa/ingest (signed) --> [Vercel API] store inbound row (unique message id) -> 202
  [worker] claims job (lease) -> resolve identity -> policy-limited agent turn -> outbox row
  <-- HTTPS GET /wa/outbox (lease, no text) -- POST /wa/outbox/:id/claim (re-authorise, text) -- bridge sends -> POST /wa/ack
```

| Point | Design |
|---|---|
| Inbound port | None on OCI. All traffic outbound HTTPS to Zan. No unrestricted Zan bearer token on the VM |
| Bridge credential | Dedicated bridge-only secret, scoped to ingest / outbox / ack. No access to Zan data routes, cannot name a user or role, cannot read other users' outbox rows beyond leased ones. Stored hashed server-side; rotation supports two valid keys during overlap; revocable immediately |
| Signing + replay | HMAC-SHA256 over method, path, timestamp, nonce, body (including immutable protocol sender fields and message id). Reject timestamp outside +/-5 min or a reused nonce (nonce kept 10 min) |
| Idempotency | `WhatsappInbound.waMessageId` UNIQUE; a duplicate ingest returns 202 without a second job. Outbox row carries its own unique key; ack is idempotent |
| Durable queue | `WhatsappInbound` (status `received`/`leased`/`done`/`dropped`/`failed`, leaseUntil, attempts, checkpoint) and `WhatsappOutbox` (status `pending`/`leased`/`sending`/`sent`/`uncertain`/`discarded`/`expired`, leaseUntil, sendBy, expiresAt, accessEpoch). Persist before returning 202 |
| Leases | Job lease 90 s, outbox lease 30 s, `sendBy` 15 s; an expired lease returns the row to the queue (bounded attempts, then `failed`). Per-sender serial order; queue cap 10, 2 concurrent turns (D4) |
| Reply expiry | Outbox rows expire (10 min). Delivery semantics are **at-most-once after claim**: see the pre-send claim below. Exactly-once is not available |
| Pre-send claim (closes M3) | Leasing an outbox row (`GET /wa/outbox`, lease 30 s) returns only `{outboxId, recipient}`, **no text**. Immediately before sending, the bridge calls `POST /wa/outbox/:id/claim`. The server re-authorises right then (identity `active`, user active/not blocked, role/permissions unchanged, `accessEpoch` equal to the row's) and only on success returns the text, sets `sending` and a `sendBy` of now+15 s. On failure it returns 410, marks the row `discarded`, and the bridge sends nothing. Bridge acks with `POST /wa/ack` after WhatsApp accepts. A row left `sending` past `sendBy` becomes `uncertain` (never auto-resent, silent). Residual window: revocation after the claim response and before WhatsApp accepts (at most 15 s) cannot be recalled; content was already authorised at claim time. Tests: `whatsappOutbox.test.ts` (disable identity between lease and claim -> 410, no text released; between claim and ack -> delivered once, documented; crash after claim -> `uncertain`, no resend; expired lease and expired row; duplicate claim/ack idempotent) |
| Vercel duration (closes the B3 blocker) | Verified read-only on 2026-10-10 ~23:40 IST via Vercel CLI/API: team plan **Hobby**; project `zan-app-api` has Fluid compute **enabled**, no project-level default max duration, `apps/api/vercel.json` has no `functions.maxDuration`, regions `["bom1"]` in vercel.json (project default regions iad1, overridden). Per Vercel docs (functions / configuring-functions / duration), with Fluid compute Hobby default is 300 s and maximum is 300 s. **Effective limit: 300 s per invocation.** The agent turn budget is 55 s (`AGENT_REQUEST_BUDGET_MS`, timeouts.ts:26; run inline today, agentConversations.ts:115-164), well inside it |
| Cron on Hobby | Per Vercel docs, Hobby cron jobs run at most once per day; current crons are daily (cleanup 03:00 UTC, backup). A minute-level cron worker is **not available** on this plan, so the design below does not use one (and a plan upgrade is not assumed) |
| Worker contract (closes M4) | **Trigger: bridge-driven, no cron dependency.** (1) `POST /wa/ingest` verifies, inserts the `received` row (unique `waMessageId`), returns 202, then continues in the same invocation via Vercel `waitUntil` (`@vercel/functions`, dependency and Fluid behaviour to be proven by an M2 spike on a preview deployment) to claim and run that job's turn inside the 300 s limit. (2) **Backstop:** the bridge polls `GET /wa/outbox` (every 5 s while jobs/replies are pending, 30 s idle). Each poll first reaps expired leases (`leased` with `leaseUntil < now` -> back to `received`, `attempts + 1`), then claims at most one runnable job via `waitUntil`, then returns leased outbox rows. A crashed or timed-out invocation is therefore retried by the next poll, with no cron. (3) The daily Vercel cron only sweeps terminal rows (cleanup), never drives work |
| Lease / checkpoint / resume | Claim is one atomic conditional update (`updateMany` where `id` and (`status=received` or (`status=leased` and `leaseUntil<now`)) and sender has no earlier non-terminal row and fewer than 2 rows `leased`; claim succeeds iff count = 1). Job lease 90 s (turn budget 55 s + slack). After each tool step the invocation writes `checkpoint` (history so far, step count, tool results) and extends the lease. A re-lease resumes from the checkpoint with a fresh 55 s budget. Bounds: max 3 attempts and total job age 3 min, whichever first -> `failed` |
| Failure reply | On `failed`, a verified `active` identity gets **one** neutral reply ("Sorry, I couldn't complete that. Please try again."), sent through the normal outbox/claim path; any other case is silent. Owner may veto in M2 |
| Tests (M1/M3 prerequisite) | `whatsappWorker.test.ts` with fake clock and fake agent: a 55 s turn completes inside the lease; a turn that exceeds budget times out and is retried from checkpoint; crash (invocation dies, lease lapses) is recovered by the next poll; duplicate ingest creates one job; concurrency cap 2 and per-sender order hold under contention; attempts/age bounds -> `failed` + single neutral reply; no code path requires a cron; two concurrent claimers never both win |

## 8. Capacity assumptions

| Item | Observed | Source |
|---|---|---|
| VM-A (freellmapi-vm), verified 2026-10-10 read-only over SSH | x86_64, Ubuntu 24.04.4 LTS, 2 vCPU, RAM 952 MB total / 337 used / 615 available (about 35% used), swap 2 GB with 220 MB used, root disk 45 GB with 38 GB free (15% used), load 0.14/0.03/0.01, up 11 days, NTP synchronized | Live inspection |
| VM-A running services | caddy, docker (containerd), snapd, oracle-cloud-agent, unattended-upgrades, ssh, systemd basics. One container: FreeLLMAPI (ghcr.io/tashfeenahmed/freellmapi:latest), Up 4 days, healthy | Live |
| VM-A top RSS | node 102 MB (FreeLLMAPI), dockerd 41 MB, journald 37 MB, fwupd 29 MB, caddy 27 MB, containerd 21 MB, snapd 19 MB | Live |
| VM-A listening ports | 22, 80, 443 (caddy), 3001 (FreeLLMAPI), 111 (rpcbind), 2019 (caddy admin, localhost), DNS stubs on localhost | Live |
| VM-A FreeLLMAPI health (local, no key) | `/` 200 in 3 ms, `/health` 200 in 3 ms, `/v1/models` 401 in 2 ms (up; auth required) | Live |
| VM-A TLS | Caddy manages certificates (auto-renews; no /etc/letsencrypt). Expiry **not verified** (see read-only check below) | Not verified |
| VM-B (Oracle Linux) | **Not inspected** (key refused for one IP; timeout on port 22 for another). Needs correct IP, login user, key and a port-22 rule; only needed if VM-A fails the M6 check | Not verified |
| Bridge footprint | Go binary 26.7 MB (client exe); pure-Go SQLite; tens of MB RSS idle expected | exe size observed; RSS NV |
| Agent LLM load | LLM runs at providers, not on the VM; bridge does I/O only | design |

Headroom vs approved targets (VM-A): memory with a bridge under 100 MB would be about (337+100)/952 = 46%, under the 70% target; disk 38 GB free is above 10 GB. Verdict: **OK, with caution**. RAM is only 952 MB (the plan's 1 GB), and swap is in use: 220 MB of 2 GB at inspection (10 Oct ~22:39 IST). The cheap services (fwupd, snapd, ModemManager, udisks2) could be trimmed later if needed (not done; no changes made). Recommended bridge host: **VM-A (freellmapi-vm)**, outbound-only, no new inbound port.

**M6 swap/memory monitoring plan.** During the pilot load test and a 24 h soak, sample `free -m`, `vmstat 1` (si/so) and the bridge process RSS every minute to a log. Pass thresholds: no sustained swap-in (`si` > 0) under load; VM memory < 70%; bridge RSS < 100 MB. If any is breached, propose the second VM or a larger approved instance (owner approval first).

**TLS expiry (unchecked).** Read-only check later, without reading Caddy config, from any machine: `echo | openssl s_client -connect <public-domain>:443 -servername <public-domain> 2>/dev/null | openssl x509 -noout -enddate -subject`. The domain comes from the owner or from the provider base-URL host in Settings -> AI providers, not from server config. Caddy auto-renews.

**Second VM (Oracle Linux).** Not inspected; needs correct IP, user, key and a port-22 rule. Only required if VM-A fails the M6 check.

Hosting: OCI confirmed (D5). Fallback note only: if the capacity check fails, propose the second inspected VM or a larger approved instance per PLAN M6.

Pilot targets (**approved by Ferose, D4**; measured in M6, not guarantees): 2 concurrent turns, per-user serial order, queue cap 10, p50 < 15 s, p95 < 45 s, bridge service memory < 100 MB, VM memory < 70% sustained, state + logs < 1 GB with rotation, > 10 GB disk free. Concurrency is still capped against measured provider limits, not these targets alone.

## 9. Open blockers

Decided and removed: group mapping (D1), Finance/engineer scope (D2), assigned-site rule (D3), pilot targets (D4), hosting (D5).

| # | Open item | Needed |
|---|---|---|
(Ids renamed O1-O9 in rev3 so they do not collide with the re-review's finding ids B1/B2.)

| # | Open item | Status / needed |
|---|---|---|
| O1 | Live AI provider rows | **RESOLVED rev3** (section 3). Residual, before M1 integration: FreeLLMAPI base host, external quota/concurrency limits, fallback health |
| O2 | OCI capacity check | **VM-A done (section 8), headroom OK with caution; M6 monitoring plan recorded.** Required before M3/M5 is satisfied for VM-A |
| O3 | Vercel function limit | **RESOLVED rev3** (section 7): Hobby + Fluid, 300 s; no minute-level cron; bridge-driven worker |
| O4 | Pilot users and verified numbers | Open: list from Ferose |
| O5 | Pairing approach (fresh pair of Zan-F on OCI vs session migration); owner present at M5 | Open: approval at M5 |
| O6 | TLS expiry check | Open: read-only `openssl s_client` check (section 8); needs the public domain from the owner or provider base-URL host |
| O7 | Second VM (Oracle Linux) | Open, **conditional** on VM-A failing the M6 check: correct IP, user, key, port-22 rule |
| O8 | HANDOVER provider list is stale (says Gemini 1, NVIDIA 2) | Fix on master later, not on this branch |
| O9 | Owner confirmations for M1 deltas | Open: `service_team` in engineer-scoped group; R3 contact-field omission; R5 engineer Bills page; R6 engineers lose all-sites list; R7 Finance/engineers lose in-app Drive; production role-grant diff; accepted residual risk of the trusted bridge (section 6) before M5 |

## 10. Gate re-score for rev3 (proposed; the reviewer decides)

| Gate | Proposed score | Basis |
|---|---|---|
| 1 Reuse existing access controls | CONDITIONAL | Roles/permissions stay the only source; no Finance/engineer grant revoked; explicit change list R1-R7, sequencing, rollback and named tests (4.3, 4.4). Not implemented; prod grants NV |
| 2 Safe sender identity, fail-closed, silent | CONDITIONAL | Verified identity table and LID reconciliation (6); bridge named as trusted identity-asserting component with accepted residual risk and tests; pre-send claim closes the lease-to-send gap except a documented <=15 s window (7) |
| 3 Preserve FreeLLMAPI routing | CONDITIONAL (was FAIL) | Live rows verified: "Free LLM API" is priority 0, active, tried first, then OpenAI 1, NVIDIA 2, Gemini 3, no ties (3). Base host, external limits and fallback health still to record before M1 integration |
| 4 Implementable request/reply path | CONDITIONAL | Limit confirmed (300 s, Hobby + Fluid); bridge-driven worker with atomic lease/checkpoint/resume/bounds and named tests (7). `waitUntil` behaviour to be proven by an M2 spike |

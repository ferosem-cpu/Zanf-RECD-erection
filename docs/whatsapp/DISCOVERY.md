# Zan WhatsApp assistant - M0 discovery (read-only)

Date: 2026-10-10; revised 2026-10-11 (rev4, on top of rev3c `abb0b73`; rev3 `ef380ca` was CHANGES REQUIRED, see `REVIEW-M0.md`). Revision 4 (rev1 `fa6e4b9`/`f99ef60` and rev2 `4e909da` (+`61618cd` OCI facts) were both CHANGES REQUIRED; finding ids B1, B2, M1-M4, L1 in this file's section 4/6/7 refer to the rev2 re-review, see `REVIEW-M0.md`). Scope: M0 of `docs/whatsapp/PLAN.md`. Docs only: no code, schema or deploy change. "NV" = not verified (production data / live systems not accessible in M0). Everything below marked "proposed" is a contract for M1+ implementation, not current behaviour.

## 0. Owner decisions (Ferose, 2026-10-10)

| # | Decision |
|---|---|
| D1 | Every group except Customers can see site details. Owner/Admin = Super Admin. Settings are blocked over WhatsApp for every group incl. Super Admin. Customers: no reply (default for now) |
| D2 | Finance and engineer restrictions apply APP-WIDE, not WhatsApp only: an explicit, tested role-permission change in M1 with regression checks for the other roles (section 4.3) |
| D3 | Engineers see only their assigned sites |
| D4 | Pilot targets approved: 2 concurrent turns, queue 10, p50 < 15 s, p95 < 45 s, bridge service memory < 100 MB, VM memory < 70%, > 10 GB disk free |
| D6 | **Service team gets WhatsApp access** (confirmed 10 Oct 2026, 23:43 IST; supersedes the 23:42 answer): the `service_team` role (the "service engineer" of the owner's wording; there is no `service_engineer` key) has the same read-only access as engineers: assigned sites only, no finance |
| D7 | **Engineers can no longer record vendor invoices in the app** (confirmed 10 Oct 2026, 23:43 IST): app-wide M1 role change removing `RECORD_VENDOR_INVOICE` from `erection_engineer` and `commissioning_engineer` (roleDefinitions.ts:102,113); `service_team` does not hold it today. Regression tests for the other roles (4.3 R8). This also removes the engineers' path to payables / vendor-bill tools. **Rev4: the clause "Ops/PM (:91) and Finance (:131) keep it" is superseded by D10** (Ops/PM loses it; only Finance and the admin trio keep it; flagged F3 for Ferose) |
| D8 | **Confirmed by Ferose 11 Oct 00:01 IST** (app-wide M1 items): (1) Finance stops seeing customer contact details: YES (R3). (2) ~~Engineers' Bills page narrowed to their own sites: YES (R5)~~ **SUPERSEDED by D9 (00:05 IST): engineers get no Bills at all, nothing is narrowed to "own sites".** (3) Engineers lose the all-sites list: YES (R6). (4) Finance and engineers do **not** lose in-app Drive (R7 withdrawn). Role-scoped Drive search (Finance: finance documents; engineers: engineering documents and photos) is a **later phase, not M1**; existing in-app Drive access is unchanged in M1; WhatsApp v1 still excludes Drive |
| D5 | Hosting confirmed (10:26 PM IST): the bridge runs on OCI as in PLAN. Zan app users never touch OCI; they only use WhatsApp. The agents (Claude/Grok) may access the OCI servers. Fallback only: if the OCI capacity check fails, propose the second VM (Oracle Linux, **uninspected**, conditional) or a larger approved instance per PLAN M6. Read-only OCI inspection: **VM-A inspected** (section 8; headroom OK with caution), TLS expiry still open, VM-B not inspected. Headroom is re-checked at M5 and measured at M6 |
| D9 | **Ferose 11 Oct 00:05 IST (replaces his 00:01 answer 2):** engineers (`erection_engineer`, `commissioning_engineer`, `service_team`) can access **only site details, only for sites assigned to them**. **No finance at all:** no Bills page, payables, receivables, invoices, vendor bills, expenses, payments, ledger or revenue. The read-only bills permission suggested by Codex is **not** added. Implemented as removal of Bills and finance access app-wide (4.3: R5 superseded, R6, R8, R9, R10) |
| D10 | **Ferose 11 Oct 00:07 IST (broadest; supersedes narrower finance wording and rev3's "Ops/PM and Finance keep vendor invoice recording"):** finance details are ONLY for Management, Finance, Owner/Admin and Super Admin. EVERY other role loses finance access app-wide, REST and assistant: Sales, Ops/PM, erection_engineer, commissioning_engineer, service_team, and Customers. Role x key table, routes, tools, tests, rollback: 4.3.1-4.3.11. Items for Ferose to confirm (Ops/PM, Sales, customer portal): 4.3.8 |

**D11 (Ferose, 11 Oct 2026, ~06:02 IST) - answers F1-F7 and re-prioritises:** "The most important thing I want is integration of WhatsApp. The permissions and other things can be looked at later." F1 quotations ARE finance. F2 Sales KEEPS creating invoices from quotations. F3 Ops/PM loses vendor invoice recording and Bills. F4 order value hidden from engineers, service_team and Ops/PM. F5/F7 purchase orders and suppliers ARE finance. F6 customers cannot see their invoices anywhere. **Open interaction (flagged, not resolved):** F1 and F2 conflict - Sales keeps quotation->invoice creation (quotations.ts:316-318) although quotations now count as finance; later item, M1b. **Re-scope:** all app-wide permission changes (D8-D11, R1-R10, P1-P12, quotation invoice field, `financeAccessMatrix.test.ts`) move to deferred milestone **M1b** (4.3). New **M1** is WhatsApp-only (4.2.1) and changes no app-wide permission.

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
| 9 write tools (as seeded today) | by perm | quotation, saved item, customer PO | status update, vendor invoice | status update, vendor invoice (removal is proposed only: D10/R8, 4.3) | same | - | expense, PO, invoice, quotation, vendor invoice |

Settings, provider, credential or permission-admin exposure through any tool: **none today** (settings are REST-only).

### 4.1 Mapping of the plan's groups onto existing roles (per D1)

| Plan group | Existing role(s) | WhatsApp access |
|---|---|---|
| Admin / Management | `super_admin`, `owner_admin`, `management` (Owner/Admin = Super Admin) | Full read policy; settings tools never exposed (D1) |
| Finance | `finance` | Finance read tools + site details; after M1: no work-order detail, **no customer contact fields in any REST or tool output (R3, 4.3.6)**. In-app finance writes are **kept** (4.3); WhatsApp has no writes for anyone |
| Engineers | `erection_engineer`, `commissioning_engineer`, **`service_team`** (seed key; there is no `service_engineer` role: roleDefinitions.ts:94-120) | **Site details for assigned sites only** (D9, D3) and nothing else financial: after M1 no Bills, payables, receivables, invoices, vendor bills, expenses, payments, ledger or revenue, in REST or the assistant (D9/D10; `RECORD_VENDOR_INVOICE` removed from erection and commissioning, R8; `/sites/:id/costs` and order value closed, R9/R10). `service_team` is in this group **by owner decision D6**; it holds `VIEW_SITE_STATUS`, `MANAGE_COMPLAINTS`, `ACT_ASSIGNED_WORK_ORDERS` (roleDefinitions.ts:116-119) and no finance permission. Same read-only WhatsApp policy and assigned-site rule (4.4) as engineers |
| Sales, Ops/PM | `sales`, `ops_pm` | Site details plus the read tools their permissions grant **after D10**: no finance (Ops/PM loses `RECORD_VENDOR_INVOICE`, so no payables or vendor bills; Sales keeps quotations pending F1/F2, 4.3.8) |
| Customers | `customer` (`customerId` set) | **Silent** (no reply) |
| Unknown | no match / inactive / blocked / unsupported role | Silent drop |

### 4.0 Conflicts found (C1-C13); resolutions in 4.2-4.5

| # | Conflict | Evidence |
|---|---|---|
| C1 | No role-to-tool allowlist exists; one `allTools` array is passed unchanged (registry.ts:8-17; agentConversations.ts:148-153); WhatsApp policy needs a new deny-by-default per-group allowlist on top of permissions | registry.ts; types.ts:5-16 |
| C2 | Engineers and Ops/PM hold `record_vendor_invoice` -> can call `get_payables`, `search_vendor_bills`, `create_vendor_invoice` (engineers and Ops/PM seeing finance). Resolved by D10: the key is removed from all three roles (R8) | roleDefinitions.ts:91,102,113; zanAppFinanceTools.ts:168,336 |
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

| Tool family | Admin/Mgmt | Finance | Sales | Ops/PM | Engineers (erection, commissioning, service_team per D6) | Customer |
|---|---|---|---|---|---|---|
| Site / order / site-status search and detail (scoped read, 4.4) | Y | Y | Y | Y | Y* (assigned sites) | silent |
| Work orders / complaints (list, detail) | Y | - (after M1) | - | Y | Y* (assigned sites) | silent |
| Receivables, revenue, invoices, POs, expenses, ledger, credit notes, advances, payments/TDS | Y | Y | - (D10) | - | - | silent |
| Quotations (not finance: F1) | Y | Y | Y | - | - | silent |
| Payables, vendor bills | Y | Y | - | - (D10; was Y) | - (D9/D10) | silent |
| Customer / supplier / vendor search | Y | suppliers only (after M1) | customers (contacts included) | - | - | silent |
| `get_document_detail` | dispatched by document type; each branch rechecks permission + row scope | finance types only | quotation | work_order | work_order, complaint, assigned only | silent |
| Drive x3 | **excluded from v1**; role-scoped Drive search is **deferred to a later phase, not M1** (D8-4). In-app Drive unchanged in M1. No per-user/site classification at retrieval or read time exists; name or prompt filtering is not enough | - | - | - | - | - |
| 9 write tools, confirm/reject | **absent for all** | - | - | - | - | - |
| Settings, providers, credentials, permission admin | blocked for all incl. Super Admin (D1); no such tool exists today (C10) | - | - | - | - | - |

WhatsApp never creates or confirms a pending action: write tools are not in any WhatsApp policy, and the confirm/reject route rejects `channel=whatsapp`.

Confirm-route fix (M1, concrete). Today `confirmOrReject` checks conversation ownership and pending status only, then calls `executeConfirmedAction(action.toolName, ...)` (agentConversations.ts:537-565). Change: before executing, (1) reload the caller's permissions (as `authenticate` does, middleware/auth.ts:22-45), (2) look up `getToolByName(action.toolName)` and require the same permission predicate that the tool's own write handler applies (e.g. `RECORD_VENDOR_INVOICE` for vendor invoices, zanAppWriteTools.ts:958; `MANAGE_ORDERS` for customer POs, zanAppWriteTools.ts:1116), exported as one `canRunWrite(auth, toolName)` helper used by both the tool handler and the confirm route, (3) reject with 403 and leave the action `pending` on failure, and (4) reject when the conversation's `channel` is `whatsapp`. Tests: `agentConfirmPermission.test.ts` (permission revoked between propose and confirm -> 403, nothing written; each of the 9 write tools has an allowed and a denied role; whatsapp-channel conversation -> rejected).

### 4.2.1 M1 (WhatsApp-only, rev5): safe on its own, no app-wide permission change

Nothing in the app (REST, in-app assistant, seed, migrations, UI) changes in M1. All restriction lives in a WhatsApp policy layer:

- **Deny by default, read-only, per-group allowlist** (tool names x group) held in code and keyed by the sender's resolved role. A policy-aware resolver replaces the global `getToolByName` on the WhatsApp path (4.5) and checks the allowlist at execution time; only allowed tool schemas are sent to the model. The user's current permissions and the row filter (4.4) must also pass.
- **Finance tools** (receivables, revenue, invoices, payables, vendor bills, POs, expenses, ledger, credit notes, advances, payments/TDS, suppliers, **quotations**) only for `super_admin`, `owner_admin`, `management`, `finance`.
- **Engineers** (`erection_engineer`, `commissioning_engineer`, `service_team`): assigned-site tools only - site status/detail, work orders, complaints, `get_document_detail` for work_order/complaint. Site scope is applied server-side in the WhatsApp path (`siteScope`, 4.4), never by the model. Order value is stripped from site/order output on WhatsApp.
- **Sales:** read-only, non-finance: site/order/site-status search and detail (order value stripped), customer search. **No quotations tool** (this also closes the quotation-embedded invoice-metadata leak on WhatsApp), no `get_document_detail` quotation branch.
- **Ops/PM:** read-only, non-finance: site/order/site-status search and detail (order value stripped), work orders, complaints, `get_document_detail` work_order. No payables, vendor bills or quotations.
- **For everyone:** no Drive, no writes, no confirm/reject, no settings/providers/credentials. **Customers, unknown, unmapped, inactive or disabled senders: silence.**
- **Deliverables:** (1) verified sender mapping table (phone/LID -> user -> role -> group, section 6); (2) super-admin controls (enable/disable per user, pilot allowlist); (3) the policy layer (allowlist, resolver, schema filtering, order-value stripping, site scope); (4) tests on fakes: `whatsappPolicy.test.ts` (every tool x every group allowed/denied, unmapped tool denied), `whatsappSchemaFilter.test.ts` (only allowed schemas reach the model), `whatsappSiteScope.test.ts` (engineer sees only assigned sites), `whatsappSilence.test.ts` (customer/unknown/disabled -> no reply), `whatsappNoWrites.test.ts`; each listed in `apps/api/package.json` "test".
- App-wide effects such as the in-app assistant exposing finance to Sales or the quotation invoice field in REST are **not** fixed here; they are M1b.

### 4.3 M1b - app-wide permission changes (DEFERRED, off the WhatsApp critical path; D2, D8-D11) and regression checks\n\n**Deferred by D11.** Analysis kept intact below for the later M1b milestone. Anything in this section saying "M1" now means M1b; nothing here blocks WhatsApp M1-M6. Rev5 additions to M1b: (a) `GET /quotations/:id` linked-`invoices` field must be excluded for non-finance roles at the response boundary or gated by a finance key, with Sales/Finance route tests (Codex rev4 MEDIUM); (b) `financeAccessMatrix.test.ts` must assert per route: finance endpoints 403 for the losing roles, authorised site/customer reads retained, financial fields absent (Codex rev4 MEDIUM); (c) P4 uses the shared role-aware contact filter (`manage_orders` holders keep contacts) and P12 names the print test `printContacts.test.ts` pinning Finance and admin cases (Codex rev4 LOW); (d) F1/F2 interaction (4.3.8).

Correction history: rev2 said Finance "loses write tools"; withdrawn in rev3. Rev3/rev3c let Ops/PM keep vendor-invoice recording (D7) and narrowed engineers' Bills to own sites (D8-2). **Both are superseded in rev4 by D10 (00:07 IST) and D9 (00:05 IST).** Current principle:

- **Finance details (everything in 4.3.1) belong ONLY to `super_admin`, `owner_admin`, `management` and `finance`.** Every other role loses finance access app-wide, in REST **and** in the assistant: `sales`, `ops_pm`, `erection_engineer`, `commissioning_engineer`, `service_team`, `customer` (D10).
- Engineers (`erection_engineer`, `commissioning_engineer`, `service_team`) additionally see **site details only, only for sites assigned to them** (D9, D3, R6).
- The four finance-allowed roles keep every grant and every write flow (R1). No new permission is added (rev3's `VIEW_PAYABLES` is withdrawn: after D10 no non-finance role needs a payables read, so the existing gate is simply narrowed, R4). Codex's suggested read-only bills permission is **not** added (D9).
- Mechanism (permissions are DB rows, "data not code"): idempotent migration deleting the finance keys from the six losing roles + `revoke:` entries in the seed (roleDefinitions.ts:17-20 supports this) + handler fixes only where a route/tool leaks finance data through a **non-finance** key (R9, R10, R3). Tool handlers already mirror their REST route's key, so revoking the key closes both.

#### 4.3.1 What "finance" includes (the key set)

Nine keys by the app's own definitions (constants.ts:162-175, labels roleDefinitions.ts:49-57), plus one read key:

| Key | Covers (app's own label) |
|---|---|
| `manage_invoices` | invoices incl. proforma and tax invoices; also gates payment lists and customer-pricing reads |
| `record_payments` | payments received and made, advances, allocations (collections) |
| `manage_purchase_orders` | suppliers, purchase orders (cost documents; not payables per the money rule, but finance-keyed, so included) |
| `manage_expenses` | expense book |
| `view_finance_dashboard` | finance dashboard, receivables, payables, GST summary, monthly revenue reports |
| `record_vendor_invoice` | vendor invoice (bill) capture; read gate of Bills list/detail |
| `approve_vendor_invoice` | verify/approve/reject/cancel vendor invoices; vendor payments list |
| `view_ledgers` | party ledgers, TDS register, GST returns exports |
| `manage_credit_notes` | credit notes and debit notes |
| `view_orders` | read-only order value (held only by Finance in the seed, roleDefinitions.ts:137) |

**Not included, pending Ferose (F1):** `manage_quotations`. Quotations are pre-sales documents and are not in D10's list; they stay with Sales unless Ferose says otherwise.

#### 4.3.2 Role x removed keys (seed lines in roleDefinitions.ts)

| Role (seed lines) | Finance keys seeded today | Removed by D10 in M1 | Allowed roles: unchanged |
|---|---|---|---|
| `sales` (:78-82) | none (`manage_quotations` :81, see F1/F2) | none by default; defensive revoke of the 10 keys against prod drift | |
| `ops_pm` (:83-93) | `record_vendor_invoice` (:91) | `record_vendor_invoice` | |
| `erection_engineer` (:94-104) | `record_vendor_invoice` (:102) | `record_vendor_invoice` | |
| `commissioning_engineer` (:105-115) | `record_vendor_invoice` (:113) | `record_vendor_invoice` | |
| `service_team` (:116-120) | none | none by default; defensive revoke | |
| `customer` (:140-149) | none (but holds `view_site_status` :144, a leak path, R9) | none; defensive revoke | |
| `super_admin` (:61-65), `owner_admin` (:66-71), `management` (:72-77) | all (ALL / ALL_EXCEPT_SETTINGS, :25-29) | **unchanged** | yes |
| `finance` (:121-139) | all ten | **unchanged** | yes |

The migration deletes all ten keys of 4.3.1 from the six losing roles (idempotent `DELETE ... WHERE role.key IN (...) AND permission.key IN (...)`), so drifted production grants are also cleaned. Prod grants are NV: M1 first diffs production role grants and saves the pre-change grant set; the inverse SQL is generated from that saved set (Rollback).

#### 4.3.3 REST routes each key gates (apps/api/src/routes, `requirePermission` is any-of: middleware/auth.ts:53-60)

| Key | Routes (file:line) |
|---|---|
| `manage_invoices` | invoices.ts:65,111,162,207,345,375,403,505; payments.ts:80; quotations.ts:316-318 (create-invoice, see F2); customers.ts:15-20,32,168; customerPricing.ts:9; savedItems.ts:12-16 (read) |
| `record_payments` | invoices.ts:422,505,521,606; payments.ts:21,80,104-106; bills.ts:237,452,506,604; customers.ts:168; purchase-orders.ts:85 |
| `manage_purchase_orders` | purchase-orders.ts:32,37,47,61,103,156,232,251,267,330; sites.ts:528 (`/costs`) |
| `manage_expenses` | expenses.ts:11,30,53,81 |
| `view_finance_dashboard` | financeDashboard.ts:24,79,111,136,176; sites.ts:528 |
| `record_vendor_invoice` | bills.ts:116,140,210,254,262 (CAPTURE, bills.ts:33); purchase-orders.ts:103; admin-web nav routeAccess.ts:33 |
| `approve_vendor_invoice` | bills.ts:237,254,262,346,360,374,432 (APPROVE, bills.ts:34); purchase-orders.ts:85 |
| `view_ledgers` | ledgers.ts:14 (all `/ledgers/*`: customer, supplier, tds, gst); bills.ts:237; customers.ts:19,168; purchase-orders.ts:32,37,85 |
| `manage_credit_notes` | credit-notes.ts:47,69,130,147,219,253,283; debit notes :302,318,347,357,381 |
| `view_orders` | orders.ts:13,23 |
| not key-gated (leaks, R9/R10) | sites.ts:28-52,57-88 (Site list/detail include `order.value`, nulled only for customers, :49-52,:88); sites.ts:524-560 (`/costs`: bill allocations, expenses, POs, totals, gated by `view_site_status` which every non-finance role and the customer role hold, :528; no customer or assignment check seen in :530-560, to verify in M1); orders.ts:13-28 (order value; needs `manage_orders`/`view_orders`); customers.ts:30-52 (customer detail embeds orders with value) |

Other routes unaffected: bills.ts:395 delete uses `requireRole(super_admin, owner_admin)`.

#### 4.3.4 Assistant tools each key gates (apps/api/src/agent/tools)

| Key(s) | Tools (definition : permission check) |
|---|---|
| `view_finance_dashboard`, `approve_vendor_invoice`, `record_vendor_invoice` | `get_payables` (zanAppFinanceTools.ts:144,168), `search_vendor_bills` (:312,336): the check accepts `record_vendor_invoice` alone, which is how engineers and Ops/PM reach them (C2) |
| `view_finance_dashboard`, `manage_invoices` | `get_receivables` (:509,526) |
| `view_finance_dashboard` | `get_revenue_summary` (:703,726) |
| `manage_invoices` | `search_invoices` (zanAppReadTools.ts:330,358); `create_invoice` (zanAppWriteTools.ts:508,553); `get_document_detail` invoice (zanAppDetailTool.ts:55) |
| `manage_purchase_orders`, `view_ledgers` | `search_purchase_orders` (readTools:430,445); `search_suppliers` (:148,161); `create_purchase_order` (writeTools:121,188); detail PO (detailTool:102) |
| `manage_expenses` | `search_expenses` (readTools:489,506); `create_expense` (writeTools:29,51); detail expense (detailTool:112) |
| `view_ledgers` | `get_customer_ledger` (readTools:1298,1316) |
| `manage_credit_notes` | `search_credit_notes` (readTools:1330,1345) |
| `record_payments`, `manage_invoices`, `view_ledgers` | `get_customer_advances` (readTools:1385,1397); `search_payments` (:1497,1521) |
| `record_vendor_invoice` | `create_vendor_invoice` (writeTools:914,958) |
| quotation/invoice/PO keys | `search_saved_items` (readTools:1184,1196), `get_customer_pricing` (:1217,1230), `create_saved_item` (writeTools:752,770): stay available to Sales through `manage_quotations` (F1); they lose the `manage_invoices` / `manage_purchase_orders` alternatives automatically |

Every handler already checks the same key as its REST route, so the migration closes REST and tools together; the only handler edits are R3, R4, R9, R10.

#### 4.3.5 Change list (proposed M1; seed + idempotent migration written, not applied; prod grants NV and diffed first)

| # | Role(s) | Change | Files | Status |
|---|---|---|---|---|
| R1 | the four finance-allowed roles | **No grant removed.** Finance keeps all finance writes and the create -> confirm flow (quotation, invoice, PO, expense, vendor invoice) | roleDefinitions.ts:61-77,121-139 (unchanged) | Kept |
| R2 | Finance | `get_document_detail` work_order / complaint branches require `MANAGE_WORK_ORDERS` / `MANAGE_COMPLAINTS` / `ACT_ASSIGNED_*` plus the scope predicate (4.4); Finance holds none in the seed. A drifted prod grant is reported by the grant diff; revoking it is owner-approved with inverse SQL | zanAppDetailTool.ts:139-168 | Closes C6 |
| R3 | Finance (and every role without `manage_orders`) | **Customer contact details are removed everywhere a customer is returned**, app-wide, REST and assistant. Contacts (`contacts[]`: name, phone, email of the customer's login users, schema `Customer.contacts`) are returned only to holders of `manage_orders` (Sales and the admin trio). **Kept for Finance:** name, `gstin`, `state`, `billingAddress`, `address`, `openingBalance` (the billing identity needed to raise and read finance documents). Path inventory and per-path tests in 4.3.6. Confirmed by Ferose 11 Oct 00:01 IST (D8-1); a "customer outstanding" field is **not** returned by `search_customers` today (zanAppReadTools.ts:92-98), so rev3's "outstanding stays" is withdrawn | see 4.3.6 | Confirmed |
| R4 | all | `get_payables` / `search_vendor_bills` read gate narrowed to `VIEW_FINANCE_DASHBOARD` or `APPROVE_VENDOR_INVOICE` (drop `RECORD_VENDOR_INVOICE` alone). With D10 the only non-finance holders lose the key anyway; this is defence in depth against drift. `VIEW_PAYABLES` (rev3) **withdrawn** | zanAppFinanceTools.ts:168,336 | Replaces rev3 R4 |
| R5 | erection, commissioning | **SUPERSEDED by D9/D10 (rev4).** The rev3c "Bills narrowed to own sites" is dropped: engineers get **no Bills at all** (no list, detail, capture, edit). Their access to `GET /bills`, `GET /bills/:id` (bills.ts:116,254) ends because `RECORD_VENDOR_INVOICE` is removed (R8). No recorder-field filter and no read-only bills permission is added | bills.ts:33,116,254 | Superseded |
| R6 | erection, commissioning, service_team (+ all site readers) | Site read scoping: shared `siteScope(auth)` (4.4); engineers see **assigned sites only**, in tool and REST `GET /sites`, `GET /sites/:id` and every other site-keyed read they can reach (D9, D3). Engineers lose the all-sites list (D8-3, confirmed) | zanAppReadTools.ts:843-851; sites.ts:28-66 | Confirmed |
| R7 | Finance, engineers | **Withdrawn (D8-4).** Drive tools and in-app Drive unchanged in M1. Role-scoped Drive search is **deferred to a later phase, not M1**. WhatsApp v1 excludes Drive | - | Deferred |
| R8 | ops_pm, erection, commissioning (not `service_team`) | **Subsumed by D10.** Remove `RECORD_VENDOR_INVOICE` from `ops_pm` (roleDefinitions.ts:91), `erection_engineer` (:102), `commissioning_engineer` (:113). Rev3's "Ops/PM and Finance keep vendor invoice recording" is **superseded**: only Finance and the admin trio record vendor invoices. Seed `revoke:` + idempotent migration (R-all below) | roleDefinitions.ts:91,102,113; bills.ts:33,116,140,210,254,262; purchase-orders.ts:103; zanAppWriteTools.ts:958; zanAppFinanceTools.ts:168,336 | Ops/PM impact: F3 |
| R-all | sales, ops_pm, erection, commissioning, service_team, customer | Idempotent migration deleting the ten finance keys (4.3.1) from these six roles; seed `revoke:` lists for the five staff roles | roleDefinitions.ts (new `revoke` entries), migration (new, not applied) | New (D10) |
| R9 | customer, service_team, ops_pm, engineers, sales | `GET /sites/:id/costs` is gated by `view_site_status` (sites.ts:528), which these roles hold, and returns bill allocations, expenses, POs and totals. Change the gate to `MANAGE_PURCHASE_ORDERS` or `VIEW_FINANCE_DASHBOARD` (finance keys) and drop `VIEW_SITE_STATUS`; hide `SiteCostsSection.tsx` in admin-web for roles without them. Verify in M1 whether customers could reach it today (no customer check seen) | sites.ts:524-560; admin-web components/SiteCostsSection.tsx | New (D10); possible existing leak |
| R10 | engineers, service_team, ops_pm, customer | `order.value` (contract value) is nulled in `GET /sites` and `GET /sites/:id` for every caller **without `MANAGE_ORDERS` or `VIEW_ORDERS`** (today only customers, sites.ts:49-52,88); same in agent site/order output | sites.ts:49-52,88; zanAppReadTools.ts (orders/sites output) | New (D10); F4 |

Items needing Ferose's confirmation (flagged, not decided): see 4.3.8.

#### 4.3.6 Customer contact paths (R3): every in-app path that returns customer contacts

Billing fields Finance keeps (never stripped): `id`, `name`, `gstin`, `state`, `billingAddress`, `address`, `openingBalance`, `openingBalanceDate`. A shared helper `stripCustomerContacts(auth, customer)` (`contacts` removed unless `MANAGE_ORDERS`) is used by every path below; server-side notifications that read contacts internally (invoices.ts:359-363,486; quotations.ts:251-255) are **not** responses and are unchanged.

| # | Path | Returns contacts today | Finance reaches it via | Fix | Test |
|---|---|---|---|---|---|
| P1 | `GET /customers` customers.ts:12-27 (contacts :21) | name, phone, email | `manage_invoices`, `manage_quotations`, `view_ledgers` (:15-20) | strip unless `manage_orders` | `customerContacts.rest.test.ts`: finance gets customers without `contacts`, with name/gstin/state/billing fields; sales/admin still get contacts |
| P2 | `GET /customers/:id` customers.ts:30-52 (contacts :42; also embeds orders/site) | name, phone, email | `manage_invoices`, `manage_quotations` (:32) | strip contacts; embedded `orders[].value` per R10 | same file: detail |
| P3 | search/export: no separate customers search or export route exists (verified: customers.ts has list, detail, create, update, delete, advances) | - | - | none; test asserts no new route returns contacts (routeInventory) | `routeInventory.test.ts` |
| P4 | `GET /invoices/:id` invoices.ts:31-34 (`contacts take 1`) | name, phone, email | `manage_invoices` | drop the `contacts` select from the response include | `customerContacts.rest.test.ts`: invoice detail |
| P5 | `GET /quotations/:id` quotations.ts:129-132 (`contacts take 1`); list `customer: true` :81 (scalars only) | name, phone, email | `manage_quotations` (Finance seeded) | strip unless `manage_orders` | same file |
| P6 | `GET /orders/:id` orders.ts:28 (customer.contacts :28); list `customer: true` :17 | name, phone, email | `view_orders` (Finance) | strip unless `manage_orders` | same file |
| P7 | credit notes (credit-notes.ts:40,56), ledgers (ledgers.ts:63), payments (payments.ts:87), financeDashboard (:86), customer POs (customer-purchase-orders.ts:59,78), gstExport (services/gstExport.ts:74,102) | no contacts (customer select name/gstin/state/address only) | - | none; regression test pins these shapes | `customerContacts.rest.test.ts` shape pins |
| P8 | agent `search_customers` readTools:72-100 (contacts :94-97) | name, phone, email | `manage_invoices`, `manage_quotations` (:81) | strip unless `manage_orders` | `customerContacts.agent.test.ts` |
| P9 | agent `get_document_detail` customer branch detailTool:24-35 | full customer | needs `manage_orders` (:25) | no change (Finance already denied) | same file: finance denied |
| P10 | agent `get_document_detail` quotation/invoice branches detailTool:45-60 (customer select name/gstin/state/address) | no contacts | - | pin | same file |
| P11 | agent order branch detailTool:123-136 (`customer: true`, scalars) | none | needs `manage_orders` | pin | same file |
| P12 | PDFs / print pages: admin-web invoices/[id]/print and quotations/[id]/print render P4/P5 responses; no server-side PDF generator in apps/api | via P4/P5 | - | follow from P4/P5; UI test that print pages render without contacts | `apps/admin-web/test` (print render with contact-less payload) |

The admin-web customers page (`/customers`, routeAccess.ts:13 allows `manage_invoices`/`manage_quotations`) keeps working for Finance without the contacts column.

#### 4.3.7 UI nav (secondary; the backend is authoritative)

admin-web builds nav from permissions: `ROUTE_PERMISSIONS` (lib/routeAccess.ts:13-45) filtered by `hasPermission` in Nav.tsx:428,465,505. Once the keys are revoked: `/finance/*`, `/invoices`, `/purchase-orders`, `/expenses`, `/reports/finance|tds|gst-returns`, `/finance/vendor-invoices` links disappear for the six roles; `LANDING_PRIORITY` (routeAccess.ts:49) already falls through by permission. Add: hide `SiteCostsSection.tsx` and order value on the site page for roles without finance/order keys. No UI-only enforcement is relied upon. `apps/mobile` is untouched (never runtime-tested); its finance calls, if any, are denied by the same REST gates.

#### 4.3.8 Items Ferose had to confirm - ANSWERED by D11 (kept for M1b; F1/F2 interaction still open)\n\nD11: F1 yes (quotations are finance); F2 Sales keeps quotation->invoice; F3 Ops/PM loses vendor invoices and Bills; F4 order value hidden from engineers, service_team, Ops/PM; F5/F7 POs and suppliers are finance; F6 customers see no invoices anywhere. **Flag:** F1+F2 interact - Sales keeps creating invoices from quotations although quotations are finance; unresolved, M1b. The "default" wording in the rows below is superseded by D11.

| # | Question | Workflows / screens affected |
|---|---|---|
| F1 | Is `manage_quotations` finance? Default here: **no**, Sales keeps quotations | If yes: Sales loses Quotations pages (`/quotations`, quotations.ts:85-318), customer pricing and saved-items reads, `search_quotations`, `create_quotation`, and `/customers` read via that key (still has it through `manage_orders`) |
| F2 | Sales converts a quotation to an invoice today: `POST /quotations/:id/create-invoice` accepts `manage_quotations` **or** `manage_invoices` (quotations.ts:316-318), so Sales (quotations only) can raise a proforma/tax invoice. D10 implies Sales must not. Default here: gate becomes `manage_invoices` only | Sales loses "create invoice from quotation" (button on `/quotations/[id]`); Finance does it |
| F3 | **Ops/PM currently records vendor invoices / uses Bills** (`record_vendor_invoice` roleDefinitions.ts:91): Bills list/detail/capture/extract/edit (bills.ts:116,140,210,254,262), `/finance/vendor-invoices` pages (routeAccess.ts:33), assistant `get_payables`, `search_vendor_bills`, `create_vendor_invoice`, and purchase-orders.ts:103 | Ops/PM loses all of these (D10 overrides rev3's "Ops/PM keeps vendor invoices"). Confirm Ops/PM no longer files site vendor bills |
| F4 | Order value (contract value) hidden from engineers, service, Ops/PM (R10). Sales keeps it (`manage_orders`) | Site list/detail value column, order pages for those roles; Ops/PM may use value to plan: confirm |
| F5 | Sales and customer balances / invoice status: Sales has no `manage_invoices`/`view_ledgers` today, so it already cannot see invoices, receivables or ledgers (invoices.ts:65, ledgers.ts:14, tools above). The only Sales-visible money is order value (`manage_orders`, orders.ts:13-28), quotations (F1) and `GET /customers/:id` embedded orders | Confirm Sales keeps order value on orders and customer detail |
| F6 | **Customer portal:** D10 as stated removes finance from Customers. REST gates show no finance route admits `customer` (they hold only `view_site_status`, `raise_complaint`, `resolve_pending_action`, `place_order`, roleDefinitions.ts:143-148); order value is already nulled for customers (sites.ts:49-52,88). **No customer invoice/balance path was found in REST or the assistant**, except the possible `/sites/:id/costs` leak (R9). Whether the admin-web or mobile customer screens show invoices/balances was not found in the route map (UI not exercised, not verified against production) | Confirm no customer-facing invoice/balance screen is expected; R9 closes the leak |
| F7 | Purchase orders and suppliers (`manage_purchase_orders`) are treated as finance (4.3.1). Ops/PM and Sales hold neither in the seed | No role change in the seed; only drift cleanup |

#### 4.3.9 Sequencing

(1) Prod grant diff by the owner; save the pre-change grant set. (2) Deploy API with handler/REST changes R2-R4, R6, R9, R10, quotation gate F2 (code only; no behaviour change for the four finance roles). (3) Apply the R-all migration (the only revoking step, owner-approved after the diff). (4) admin-web deploy (API first, HANDOVER s5). (5) Only then enable the WhatsApp channel (M3+). Steps (2)-(4) are never run by this branch.

#### 4.3.10 Rollback

Redeploy the previous API build and admin-web build. The R-all migration is data-changing: its inverse is generated from the saved pre-change grant set, and for the seeded state is, per role, `INSERT INTO "RolePermission"(roleId, permissionId) SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.key = '<role>' AND p.key = '<key>' ON CONFLICT DO NOTHING` for: `ops_pm`, `erection_engineer`, `commissioning_engineer` x `record_vendor_invoice`; any drifted grants restored from the saved diff only. No schema change in this work, so no schema rollback.

#### 4.3.11 Named tests (fakes only; each listed in `apps/api/package.json` "test")

- `financeAccessMatrix.test.ts` (D10): for each REST route in 4.3.3 and each role, expected status: `sales`, `ops_pm`, `erection_engineer`, `commissioning_engineer`, `service_team`, `customer` -> 403 (per route); `super_admin`, `owner_admin`, `management`, `finance` -> unchanged vs today (regression snapshot).
- `financeToolMatrix.test.ts` (D10): every tool in 4.3.4, same role split: the six roles get `forbidden`, the four allowed roles unchanged; `get_payables`/`search_vendor_bills` reject a user holding only `record_vendor_invoice` (R4).
- `agentRoleMatrix.test.ts`: allow/deny before vs after for all 10 roles plus a vendor-engineer user; only the deltas R2-R4, R6, R8-R10, F2 may differ (Drive unchanged: R7 withdrawn).
- `agentFinanceWrites.test.ts`: finance propose -> confirm still succeeds for quotation, invoice, PO, expense, vendor invoice; Ops/PM, erection, commissioning `create_vendor_invoice` denied; `service_team` stays denied.
- `vendorInvoiceRoles.test.ts` (R8): `RECORD_VENDOR_INVOICE` absent from the ops_pm, erection and commissioning seeds, present for finance and the admin trio; `/bills` routes deny the three losing roles and allow finance/admin; engineers get 403 on `GET /bills` and `GET /bills/:id` (D9).
- `engineerSiteOnly.test.ts` (D9): engineers get 200 only for their assigned site on `GET /sites/:id`, 404/403 for unassigned, the list returns assigned only; every route in 4.3.3 returns 403.
- `siteCostsAccess.test.ts` (R9) and `siteOrderValue.test.ts` (R10): `/sites/:id/costs` 403 for non-finance incl. customer; `order.value` null for roles without `manage_orders`/`view_orders`.
- `customerContacts.rest.test.ts`, `customerContacts.agent.test.ts` (R3, paths P1-P12): per path, Finance response has no `contacts` and keeps `name`, `gstin`, `state`, `billingAddress`, `address`; Sales/admin still receive contacts.
- `roleDrift.test.ts`: seeded roles and an upgrade over a drifted grant set both end in the intended state (six roles hold none of the ten keys; four allowed roles unchanged); the migration is idempotent (run twice).
- `restPermissionsUnchanged.test.ts`: allowed roles' direct REST access for `/customers`, `/bills`, `/orders`, `/sites`, `/purchase-orders`, `/quotations` is unchanged apart from the documented deltas; customer/vendor tenant scoping unchanged.
- `whatsappPolicy.test.ts`: WhatsApp denial for every write tool, settings, Drive and out-of-group tools, for each role incl. Super Admin.
- `routeInventory.test.ts`: fails if a route under `routes/` reading finance-, site-, work-order-, complaint- or bill-keyed data is not registered as scoped, finance-gated or explicitly exempt.

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
| erection, commissioning, service_team (internal; service_team included by D6) | `assignedEngineerId = userId` |
| super_admin, owner_admin, management, sales, ops_pm, finance | no row restriction (D1: site details for all non-Customer groups) |

Gate: `search_orders_and_sites` and the site/order branches of `get_document_detail` accept `hasAny(MANAGE_ORDERS, VIEW_ORDERS, VIEW_SITE_STATUS)` (every non-customer role holds at least one; no new permission is needed for site reads), then **always** apply `siteScope`. REST `GET /sites`, `GET /sites/:id` (sites.ts:28,57) and the order-by-site paths apply the same predicate (R6). Finance gets site/order details through `VIEW_ORDERS`, not by being granted `VIEW_SITE_STATUS`, so REST `/sites` stays closed to Finance.

Coverage required (each a named test in `agentSiteScope.test.ts`, for every role in the table plus a vendor engineer and an unassigned site): list results; detail by id (miss and denial indistinguishable); whole-set counts (`scope` at zanAppReadTools.ts:841-848 includes `siteScope`, so counts never reveal other sites); text snippets and timeline/stage-event rows (search term matching an unassigned site's customer name returns nothing and does not change counts); follow-up IDs. Drive is not a retrieval path for WhatsApp (excluded) so document snippets cannot bypass site scope over WhatsApp (in-app Drive is unchanged in M1, D8-4).

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
| Durable queue | `WhatsappInbound` (status `received`/`leased`/`done`/`dropped`/`failed`, leaseUntil, leaseToken, senderKey, receivedAt, attempts, checkpoint; partial unique index on senderKey where status = `leased`) plus the 2-row `WhatsappWorkerSlot` table (jobId, leaseUntil, leaseToken) used by the atomic claim below and `WhatsappOutbox` (status `pending`/`leased`/`sending`/`sent`/`uncertain`/`discarded`/`expired`, leaseUntil, sendBy, expiresAt, accessEpoch). Persist before returning 202 |
| Leases | Job lease 90 s, outbox lease 30 s, `sendBy` 15 s; an expired lease returns the row to the queue (bounded attempts, then `failed`). Per-sender serial order; queue cap 10, 2 concurrent turns (D4) |
| Reply expiry | Outbox rows expire (10 min). Delivery semantics are **at-most-once after claim**: see the pre-send claim below. Exactly-once is not available |
| Pre-send claim (closes M3) | Leasing an outbox row (`GET /wa/outbox`, lease 30 s) returns only `{outboxId, recipient}`, **no text**. Immediately before sending, the bridge calls `POST /wa/outbox/:id/claim`. The server re-authorises right then (identity `active`, user active/not blocked, role/permissions unchanged, `accessEpoch` equal to the row's) and only on success returns the text, sets `sending` and a `sendBy` of now+15 s. On failure it returns 410, marks the row `discarded`, and the bridge sends nothing. Bridge acks with `POST /wa/ack` after WhatsApp accepts. A row left `sending` past `sendBy` becomes `uncertain` (never auto-resent, silent). Residual window: revocation after the claim response and before WhatsApp accepts (at most 15 s) cannot be recalled; content was already authorised at claim time. Tests: `whatsappOutbox.test.ts` (disable identity between lease and claim -> 410, no text released; between claim and ack -> delivered once, documented; crash after claim -> `uncertain`, no resend; expired lease and expired row; duplicate claim/ack idempotent) |
| Vercel duration (closes the B3 blocker) | Verified read-only on 2026-10-10 ~23:40 IST via Vercel CLI/API: team plan **Hobby**; project `zan-app-api` has Fluid compute **enabled**, no project-level default max duration, `apps/api/vercel.json` has no `functions.maxDuration`, regions `["bom1"]` in vercel.json (project default regions iad1, overridden). Per Vercel docs (functions / configuring-functions / duration), with Fluid compute Hobby default is 300 s and maximum is 300 s. **Effective limit: 300 s per invocation.** The agent turn budget is 55 s (`AGENT_REQUEST_BUDGET_MS`, timeouts.ts:26; run inline today, agentConversations.ts:115-164), well inside it |
| Cron on Hobby | Per Vercel docs, Hobby cron jobs run at most once per day; current crons are daily (cleanup 03:00 UTC, backup). A minute-level cron worker is **not available** on this plan, so the design below does not use one (and a plan upgrade is not assumed) |
| Worker contract (closes M4) | **Trigger: bridge-driven, no cron dependency.** (1) `POST /wa/ingest` verifies, inserts the `received` row (unique `waMessageId`), returns 202, then continues in the same invocation via Vercel `waitUntil` (`@vercel/functions`, dependency and Fluid behaviour to be proven by an M2 spike on a preview deployment) to claim and run that job's turn inside the 300 s limit. (2) **Backstop:** the bridge polls `GET /wa/outbox` (every 5 s while jobs/replies are pending, 30 s idle). Each poll first reaps expired leases (`leased` with `leaseUntil < now` -> back to `received`, `attempts + 1`), then claims at most one runnable job via `waitUntil`, then returns leased outbox rows. A crashed or timed-out invocation is therefore retried by the next poll, with no cron. (3) The daily Vercel cron only sweeps terminal rows (cleanup), never drives work |
| Atomic claim (rev4; closes the cross-row race) | One SQL statement, no read-then-write. Capacity is **structural**: a `WhatsappWorkerSlot` table seeded with exactly 2 rows (`id`, `jobId` null, `leaseUntil`, `leaseToken`), so the global cap of 2 cannot be exceeded whatever the interleaving. Per-sender order is enforced by eligibility plus a DB constraint: a partial unique index `UNIQUE (senderKey) WHERE status = 'leased'` (at most one in-flight job per sender) and an eligibility predicate that only the **earliest non-terminal** row of a sender can be claimed. Statement (single `$queryRaw`, data-modifying CTEs): `WITH slot AS (SELECT id FROM "WhatsappWorkerSlot" WHERE "jobId" IS NULL OR "leaseUntil" < now() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED), job AS (SELECT j.id FROM "WhatsappInbound" j WHERE (j.status = 'received' OR (j.status = 'leased' AND j."leaseUntil" < now())) AND NOT EXISTS (SELECT 1 FROM "WhatsappInbound" e WHERE e."senderKey" = j."senderKey" AND e.status IN ('received','leased') AND (e."receivedAt", e.id) < (j."receivedAt", j.id) ) ORDER BY j."receivedAt", j.id LIMIT 1 FOR UPDATE SKIP LOCKED), upd AS (UPDATE "WhatsappInbound" SET status = 'leased', "leaseUntil" = now() + interval '90 seconds', "leaseToken" = $token, attempts = attempts + 1 WHERE id = (SELECT id FROM job) AND EXISTS (SELECT 1 FROM slot) RETURNING *), s AS (UPDATE "WhatsappWorkerSlot" SET "jobId" = (SELECT id FROM upd), "leaseUntil" = now() + interval '90 seconds', "leaseToken" = $token WHERE id = (SELECT id FROM slot) AND EXISTS (SELECT 1 FROM upd)) SELECT * FROM upd`. A claimer that finds no free slot or no eligible job gets zero rows and does nothing. Two claimers for different jobs cannot take the same slot (`FOR UPDATE SKIP LOCKED` on the slot row) and cannot both claim the same job; a later message of a sender is never eligible while an earlier one is `received` or `leased` (including after its lease expired: the expired row is itself the earliest and is re-claimed first). |
| Lease expiry / reclaim / fencing | A `leased` row or slot with `leaseUntil < now()` is reclaimable by the statement above (attempt + 1; > 3 attempts or job age > 3 min -> the reaper marks it `failed` before claim). Every later write by a worker (checkpoint, lease extension, completion, outbox insert) is **fenced**: `UPDATE ... WHERE id = $id AND "leaseToken" = $token AND status = 'leased'` and the row count must be 1; a zombie worker whose lease was reclaimed gets 0 rows and abandons the turn without sending. Completion clears `jobId` on the slot in the same transaction. Extension after each tool step moves both the job and the slot `leaseUntil` forward |
| Checkpoint / resume | Job lease 90 s (turn budget 55 s + slack). After each tool step the invocation writes `checkpoint` (history so far, step count, tool results), fenced as above, and extends the lease. A re-lease resumes from the checkpoint with a fresh 55 s budget. Bounds: max 3 attempts and total job age 3 min, whichever first -> `failed` |
| Failure reply | On `failed`, a verified `active` identity gets **one** neutral reply ("Sorry, I couldn't complete that. Please try again."), sent through the normal outbox/claim path; any other case is silent. Owner may veto in M2 |
| Tests (M1/M3 prerequisite) | `whatsappWorker.test.ts` with fake clock, fake agent and an in-memory fake store that executes the claim as one atomic step (the repo rule is fakes only, no real DB): a 55 s turn completes inside the lease; a turn exceeding budget times out and is retried from checkpoint; crash recovered by the next poll; duplicate ingest creates one job; attempts/age bounds -> `failed` + single neutral reply; no code path requires a cron. **Race tests** (`whatsappClaimRace.test.ts`, deterministic interleavings through the fake store): (1) two workers, two different senders, one free slot -> exactly one wins; (2) cap reached (2 leased) -> third claimer gets no row; (3) two workers racing for the same job -> one wins; (4) same sender with message A `received` and B `received` -> only A is claimable, B never while A is non-terminal, even when different workers claim concurrently; (5) A's lease expires while B waits -> A is reclaimed first, B not; (6) fenced write by a worker whose lease was reclaimed -> 0 rows, no outbox row, no send; (7) slot lease expiry frees capacity. The SQL statement itself cannot be executed by these fakes; it is verified once in the M2 spike against a disposable Postgres that is neither production nor a developer DB (needs Ferose's approval as an exception to the no-real-DB rule), and until then the claim semantics are "designed, not proven" |

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

Hosting: OCI confirmed (D5). Fallback note only: if the capacity check fails, propose the second VM (Oracle Linux, uninspected) or a larger approved instance per PLAN M6.

Pilot targets (**approved by Ferose, D4**; measured in M6, not guarantees): 2 concurrent turns, per-user serial order, queue cap 10, p50 < 15 s, p95 < 45 s, bridge service memory < 100 MB, VM memory < 70% sustained, state + logs < 1 GB with rotation, > 10 GB disk free. Concurrency is still capped against measured provider limits, not these targets alone.

## 9. Open blockers

Decided and removed: group mapping (D1), Finance/engineer scope (D2), assigned-site rule (D3), pilot targets (D4), hosting (D5).

| # | Open item | Needed |
|---|---|---|
(Ids renamed O1-O9 in rev3 so they do not collide with the re-review's finding ids B1/B2.)

| # | Open item | Status / needed |
|---|---|---|
| O1 | Live AI provider rows | **RESOLVED rev3** (section 3). Residual, before M1 integration: FreeLLMAPI base host, external quota/concurrency limits, fallback health |
| O2 | OCI capacity check | **VM-A inspected (section 8), headroom OK with caution; M6 monitoring plan recorded.** Required-before-M3/M5 inspection is satisfied for VM-A. Recheck headroom at M5, measure at M6 |
| O3 | Vercel function limit | **RESOLVED rev3** (section 7): Hobby + Fluid, 300 s; no minute-level cron; bridge-driven worker |
| O4 | Pilot users and verified numbers | Open: list from Ferose |
| O5 | Pairing approach (fresh pair of Zan-F on OCI vs session migration); owner present at M5 | Open: approval at M5 |
| O6 | TLS expiry check | Open: read-only `openssl s_client` check (section 8); needs the public domain from the owner or provider base-URL host |
| O7 | Second VM (Oracle Linux) | Open, **conditional** and **uninspected**: only if VM-A fails the M5/M6 check; needs correct IP, user, key, port-22 rule (key refused / port-22 timeout so far) |
| O8 | HANDOVER provider list is stale (says Gemini 1, NVIDIA 2) | Fix on master later, not on this branch |
| O9 | Owner confirmations for M1b deltas (F1-F7 now answered by D11; M1b deferred) | Decided: D6, D7 (23:43 IST); D8 items 1, 3, 4 (00:01 IST, item 2 superseded); **D9 (00:05) and D10 (00:07)**. Open for Ferose: **F1-F7 in 4.3.8** (quotations as finance, Sales create-invoice, Ops/PM vendor bills, order value, Sales money views, customer portal, POs as finance). Open: production role-grant diff; accepted residual risk of the trusted bridge (section 6) before M5 |
| O10 | Real-DB verification of the atomic claim SQL (section 7) | Open: M2 spike against a disposable Postgres (not production); needs Ferose approval as an exception to the fakes-only rule |

## 10. Gate re-score for rev4 (proposed; the reviewer decides)

| Gate | Proposed score | Basis |
|---|---|---|
| 1 Reuse existing access controls | CONDITIONAL | Roles/permissions stay the only source; the four finance roles lose nothing; six roles lose all finance keys (D10, role x key table 4.3.2), engineers also limited to assigned sites (D9); R1-R10, sequencing, rollback and named tests (4.3, 4.4). Not implemented; prod grants NV; F1-F7 open |
| 2 Safe sender identity, fail-closed, silent | CONDITIONAL | Verified identity table and LID reconciliation (6); bridge named as trusted identity-asserting component with accepted residual risk and tests; pre-send claim closes the lease-to-send gap except a documented <=15 s window (7) |
| 3 Preserve FreeLLMAPI routing | CONDITIONAL (was FAIL) | Live rows verified: "Free LLM API" is priority 0, active, tried first, then OpenAI 1, NVIDIA 2, Gemini 3, no ties (3). Base host, external limits and fallback health still to record before M1 integration |
| 4 Implementable request/reply path | CONDITIONAL | Limit confirmed (300 s, Hobby + Fluid); bridge-driven worker with a single-statement atomic claim (slot table + per-sender ordering + fenced writes) and race tests on a fake store (7); SQL proven only in an M2 disposable-DB spike; `waitUntil` to be proven in M2 |


## 11. Fast path (rev5; D11)

1. **M1 - mapping + allowlist:** verified sender mapping table, super-admin enable/disable, WhatsApp policy layer (4.2.1), fake-based tests. No app-wide change.
2. **M3 - bridge receive/reply on OCI:** WhatsMeow service on VM-A, HMAC to the API, queue/claim/reply per section 7; echo-level text first, then wire to M2.
3. **M2 - shared assistant wiring:** call the same assistant service through the policy resolver; reuse provider selection; `waitUntil`/claim spikes (O10) here.
4. **M4 - test:** full flow on fakes plus a staging-number dry run; silence, scope and no-write cases.
5. **M5 - install:** OCI install, pairing with the owner present, trusted-bridge risk sign-off, VM-A headroom recheck.
6. **M6 - pilot:** a few verified users, measure targets (2 concurrent, p50 < 15 s, p95 < 45 s), then activate.
7. **M1b (later, off this path):** app-wide permissions, finance contacts, quotation/invoice field, matrix test.

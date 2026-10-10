# Zan WhatsApp assistant - M0 discovery (read-only)

Date: 2026-10-10. Revision 2 (after Codex review: CHANGES REQUIRED on `fa6e4b9`/`f99ef60`). Scope: M0 of `docs/whatsapp/PLAN.md`. Docs only: no code, schema or deploy change. One approved read-only provider-row read was attempted (section 3). "NV" = not verified (production data / live systems not accessible in M0).

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
| FreeLLMAPI | **Not named anywhere in code or docs except PLAN.md:34.** Likely an `openai_compatible` row with a custom `baseUrl` (factory.ts:21-27); unverified |
| Priority-0 claim | **NOT CONFIRMED.** HANDOVER s6 lists Gemini 1, NVIDIA 2 (410), OpenAI fallback, no priority 0. PLAN.md:34 ("FreeLLMAPI remains the existing priority-0 provider") is superseded by this section and the PLAN addendum; it is not edited in place |
| Live rows (Blocker 3) | **Read attempted 2026-10-10, failed safely:** throwaway read-only script (`.claude-task/read-providers.ts`, selects name/type/priority/isActive/model/baseUrl host only, never the key) ended in `PrismaClientInitializationError` (no usable DB env or DB unreachable from this machine). Nothing printed or improvised. DB identity: unknown. **Open:** Zan-F Bot (or Ferose) reads Settings -> AI providers (Super Admin `GET /agent/providers`, no key; agentProviders.ts:15-45) and records priority, name, type, active, model, base host here; then confirm whether FreeLLMAPI is the lowest active priority, ties, fallback health, and its externally configured quota/concurrency limits, before M1 integration |
| Row table | priority / name / type / active / model / base host: _pending (see above)_ |
| Cooldown | 410/429 cooldowns are in-memory per serverless instance (providerHealth.ts:23-38,62-68); WhatsApp turns reuse the same routing and fallback unchanged |

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
| Finance | `finance` | Finance read tools + site details; after M1: no work-order detail, no customer contacts, no write tools |
| Engineers | `erection_engineer`, `service_engineer`, `commissioning_engineer` | Site details for **assigned sites only** (D3); no payables/vendor bills after M1 |
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

| Tool family | Admin/Mgmt | Finance | Sales | Ops/PM | Engineers (3 roles) | Customer |
|---|---|---|---|---|---|---|
| Site / order / site-status search and detail | Y | Y | Y | Y | Y* (assigned sites) | silent |
| Work orders / complaints (list, detail) | Y | - (after M1) | - | Y | Y* (assigned sites) | silent |
| Receivables, revenue, invoices, quotations, POs, expenses, ledger, credit notes, advances, payments/TDS | Y | Y | quotations | - | - | silent |
| Payables, vendor bills | Y | Y | - | Y | - (after M1) | silent |
| Customer / supplier / vendor search | Y | suppliers only (after M1) | customers | - | - | silent |
| `get_document_detail` | dispatched by document type; each branch rechecks permission + row scope | finance types only | quotation | work_order | work_order, complaint, assigned only | silent |
| Drive x3 | **excluded from v1** (no per-user/site classification at retrieval or read time; name or prompt filtering is not enough) | - | - | - | - | - |
| 9 write tools, confirm/reject | **absent for all** | - | - | - | - | - |
| Settings, providers, credentials, permission admin | blocked for all incl. Super Admin (D1); no such tool exists today (C10) | - | - | - | - | - |

WhatsApp never creates or confirms a pending action: write tools are not in any WhatsApp policy, and the confirm/reject route rejects `channel=whatsapp`. Separate M1 fix: the confirm route re-checks role allowlist and ownership but not the originating tool's permission (agentConversations.ts:537-565).

### 4.3 App-wide M1 role changes (D2) and regression checks

One explicit, reviewed M1 change (seed `roleDefinitions.ts` + migration written, not applied; prod grants NV and must be diffed first):

| Change | Effect |
|---|---|
| Engineers (erection, commissioning, service) lose payables / vendor-bill read | `get_payables`, `search_vendor_bills` no longer accept `RECORD_VENDOR_INVOICE` alone (roleDefinitions.ts:83-113; zanAppFinanceTools.ts:164-169,333-337). Decide whether vendor-invoice **recording** stays (separate permission) so engineers can still record bills |
| Finance loses work-order detail, customer contacts and write tools | Removes any `manage_work_orders` path for finance (C6, C7) |
| Drive tools get a permission check | New required permission for Drive; customers still denied (driveTool.ts:9-15,37-80) |
| Engineers scoped to assigned sites in tools **and** REST detail paths | See 4.4 |

Regression checks (tests with fakes, plus the HANDOVER role matrix): for super_admin, owner_admin, management, sales, ops_pm, finance, each engineer role, service, customer and vendor user: (a) every tool's allow/deny result before vs after, listing only intended deltas; (b) in-app agent still works for each role; (c) REST endpoints unchanged except intended ones; (d) seeded roles and an upgrade over a drifted prod grant set both end in the intended state; (e) customer/vendor tenant scoping unchanged.

### 4.4 Row and site filters (server-side, in the retrieval path, not the model)

| Rule | Spec |
|---|---|
| Internal engineer | Site visible iff `Site.assignedEngineerId = userId` (schema.prisma:321-322; REST precedent sites.ts:29-31). Applies to detail, counts, timelines, follow-up IDs and related fields; no company-wide totals returned |
| Vendor engineer (`vendorId` set) | Stricter: site visible iff `Site.vendorId = user.vendorId` **and** `assignedEngineerId = userId`. Vendor scope alone is insufficient; unassigned sites are invisible (D3) |
| Other groups | Existing permission and customer/vendor tenant checks (zanAppReadTools.ts:1008-1062) |
| Detail by ID | `get_document_detail` work-order and complaint branches use `findUnique({where:{id}})` after a broad permission check (zanAppDetailTool.ts:139-168). Fix: scoped predicate in the query, or authorise the returned row; a miss and a denial are indistinguishable to the caller |
| Search | Engineers cannot list sites today (needs `manage_orders`, zanAppReadTools.ts:843-850): add a scoped assigned-sites search (C4, C5) |

### 4.5 Enforcement at execution (Blocker 2)

| Point | Current | Required |
|---|---|---|
| Tool schemas sent to model | all of `allTools` (agentConversations.ts:148-153) | only tools allowed for (channel, group); app channel unchanged |
| Tool resolution at execution | `runAgentTurn` passes global `getToolByName` into `executeToolCalls` (llm.ts:99-107; registry.ts:16-17); executed at toolExecution.ts:76 via `p.getTool(call.name)` | `runAgentTurn` takes a policy-aware resolver built from (channel, group, user). It returns undefined for any tool not allowed, so a disallowed or hallucinated call is rejected whatever the model requests. `isWriteTool` stays as a second guard |
| Re-check | `authenticate` per request only (auth.ts:22-45) | Before **each** tool call: re-load user, role, permissions, active flag, vendor block, identity status and `accessEpoch`; fail closed and abort the turn silently on change |
| Channel | no channel concept | `channel` is a server-set field in the auth context, never from message text |

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
| Revocation | Re-check identity + permissions + `accessEpoch` at ingest, before each tool call (4.5) and before releasing a reply; on change discard queued work and outbox rows for that identity |
| Conversation history | `AgentConversation` gains `channel` (`app`/`whatsapp`) and every stored message and tool result is labelled with its channel (messages is a JSON blob, schema.prisma:1326-1337, replayed whole at agentConversations.ts:130-159). Shared context is retained but each item is re-authorised against the user's **current** role and policy for the replaying channel; items from tools no longer allowed (or from before an `accessEpoch` bump) are dropped from the context |

## 7. Bridge <-> API contract and worker (Medium: bridge/worker)

```
Phone -> WhatsApp -> [OCI: whatsmeow bridge, systemd, own session.db]
  -- HTTPS POST /wa/ingest (signed) --> [Vercel API] store inbound row (unique message id) -> 202
  [worker] claims job (lease) -> resolve identity -> policy-limited agent turn -> outbox row
  <-- HTTPS GET /wa/outbox (lease) -- bridge sends -> POST /wa/ack
```

| Point | Design |
|---|---|
| Inbound port | None on OCI. All traffic outbound HTTPS to Zan. No unrestricted Zan bearer token on the VM |
| Bridge credential | Dedicated bridge-only secret, scoped to ingest / outbox / ack. No access to Zan data routes, cannot name a user or role, cannot read other users' outbox rows beyond leased ones. Stored hashed server-side; rotation supports two valid keys during overlap; revocable immediately |
| Signing + replay | HMAC-SHA256 over method, path, timestamp, nonce, body (including immutable protocol sender fields and message id). Reject timestamp outside +/-5 min or a reused nonce (nonce kept 10 min) |
| Idempotency | `WhatsappInbound.waMessageId` UNIQUE; a duplicate ingest returns 202 without a second job. Outbox row carries its own unique key; ack is idempotent |
| Durable queue | `WhatsappInbound` (status `received`/`leased`/`done`/`dropped`/`failed`, leaseUntil, attempts, checkpoint) and `WhatsappOutbox` (status `pending`/`leased`/`sent`/`expired`, leaseUntil, expiresAt). Persist before returning 202 |
| Leases | Worker and bridge each take a lease with expiry (e.g. 60 s / 30 s); an expired lease returns the row to the queue (bounded attempts, then `failed`, silent). Per-sender serial order; queue cap 10, 2 concurrent turns (D4) |
| Reply expiry | Outbox rows expire (e.g. 10 min) and are re-authorised (identity, permissions, `accessEpoch`) at lease time and before send. Crash after WhatsApp accepts but before ack can duplicate once: exactly-once is not available; delivery tracking limits it |
| Vercel duration | `apps/api/vercel.json` sets no `maxDuration`, region `bom1`, crons only for cleanup (03:00 UTC daily) and backup. Turn budget is 55 s (timeouts.ts:23-30), run inline today (agentConversations.ts:115-164). **The Vercel plan's function limit must be confirmed (B3) before choosing the worker mechanism** |
| Worker mechanism (proposal) | Ingest enqueues and triggers a worker invocation (chained invocation of a worker route authenticated by an internal secret); a frequent cron (or the bridge's own outbox poll hitting a "kick" route) is the backstop for orphaned jobs. Each invocation runs one turn within the confirmed limit |
| Chunked turns / timeout | Turn state checkpointed after each tool step (history so far + step count in `checkpoint`). If an invocation nears its limit it saves the checkpoint and the lease lapses; the next invocation resumes. Hard-fail after N attempts or total age (e.g. 3 min): silent drop, or one neutral failure reply only if the identity is verified (owner to decide in M2) |

## 8. Capacity assumptions

| Item | Observed | Source |
|---|---|---|
| VM-A (freellmapi-vm), verified 2026-10-10 read-only over SSH | x86_64, Ubuntu 24.04.4 LTS, 2 vCPU, RAM 952 MB total / 337 used / 615 available (about 35% used), swap 2 GB with 220 MB used, root disk 45 GB with 38 GB free (15% used), load 0.14/0.03/0.01, up 11 days, NTP synchronized | Live inspection |
| VM-A running services | caddy, docker (containerd), snapd, oracle-cloud-agent, unattended-upgrades, ssh, systemd basics. One container: FreeLLMAPI (ghcr.io/tashfeenahmed/freellmapi:latest), Up 4 days, healthy | Live |
| VM-A top RSS | node 102 MB (FreeLLMAPI), dockerd 41 MB, journald 37 MB, fwupd 29 MB, caddy 27 MB, containerd 21 MB, snapd 19 MB | Live |
| VM-A listening ports | 22, 80, 443 (caddy), 3001 (FreeLLMAPI), 111 (rpcbind), 2019 (caddy admin, localhost), DNS stubs on localhost | Live |
| VM-A FreeLLMAPI health (local, no key) | `/` 200 in 3 ms, `/health` 200 in 3 ms, `/v1/models` 401 in 2 ms (up; auth required) | Live |
| VM-A TLS | Caddy manages certificates (no /etc/letsencrypt). Domain not known without reading the Caddyfile (not allowed), so expiry **not verified** | Not verified |
| VM-B (Oracle Linux) | **Not inspected**. No tried IP/user answered as Oracle Linux (see B2) | Not verified |
| Bridge footprint | Go binary 26.7 MB (client exe); pure-Go SQLite; tens of MB RSS idle expected | exe size observed; RSS NV |
| Agent LLM load | LLM runs at providers, not on the VM; bridge does I/O only | design |

Headroom vs approved targets (VM-A): memory with a bridge under 100 MB would be about (337+100)/952 = 46%, under the 70% target; disk 38 GB free is above 10 GB. Verdict: **OK, with caution**. RAM is only 952 MB (the plan's 1 GB), swap is already in use, and the cheap services (fwupd, snapd, ModemManager, udisks2) could be trimmed later if needed (not done; no changes made). Recommended bridge host: **VM-A (freellmapi-vm)**, outbound-only, no new inbound port. Sustained memory still has to be measured in M6.
| Bridge footprint | Go binary 26.7 MB (client exe); pure-Go SQLite; tens of MB RSS idle expected | exe size observed; RSS NV |
| Agent LLM load | LLM runs at providers, not on the VM; bridge does I/O only | design |

Hosting: OCI confirmed (D5). Fallback note only: if the capacity check fails, propose the second inspected VM or a larger approved instance per PLAN M6.

Pilot targets (**approved by Ferose, D4**; measured in M6, not guarantees): 2 concurrent turns, per-user serial order, queue cap 10, p50 < 15 s, p95 < 45 s, bridge service memory < 100 MB, VM memory < 70% sustained, state + logs < 1 GB with rotation, > 10 GB disk free. Concurrency is still capped against measured provider limits, not these targets alone.

## 9. Open blockers

Decided and removed: group mapping (D1), Finance/engineer scope (D2), assigned-site rule (D3), pilot targets (D4), hosting (D5).

| # | Open item | Needed |
|---|---|---|
| B1 | Live AI provider rows (Blocker 3). Read attempt failed (section 3) | Zan-F Bot or Ferose copies Settings -> AI providers (name, type, priority, active, model, base host; no keys) |
| B2 | OCI capacity check. **VM-A done 2026-10-10 (section 8): headroom OK with caution.** Remaining: VM-B (Oracle Linux) not inspected (one tried IP refused the key for users ubuntu and opc; another timed out on port 22 during banner exchange, both attempts), and VM-A TLS expiry not verified (domain unknown). Not blocking if VM-A hosts the bridge | For VM-B only: correct IP, login user, key, and a port-22 ingress rule from this PC's public IP |
| B3 | Vercel plan function duration limit | Confirm plan (B8 in the contract above) |
| B4 | Pilot users and verified numbers | List from Ferose |
| B5 | Pairing approach (fresh pair of Zan-F on OCI vs session migration); owner present at M5 | Approval at M5 |

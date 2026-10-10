# Zan WhatsApp assistant - M0 discovery (read-only)

Date: 2026-10-10. Scope: M0 of `docs/whatsapp/PLAN.md`. Nothing was changed, run, deployed or queried. "NV" = not verified (production data / live systems not accessible in M0).

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
| Priority 0 | Default; **first tried** (`orderBy priority asc`, active only). Not disabled; disable = `isActive=false` (factory.ts:33-38; schema.prisma:1318) |
| Fallback | Healthy providers in order; failure -> next; empty reply retried once (sendWithFallback.ts:22-51) |
| Time caps | Request budget 55 s; per LLM call 30 s; attempt cap 25 s when a fallback exists; 8 max tool turns; tool call 25 s; no new LLM call with <4 s left (timeouts.ts:20-59; llm.ts:18-73) |
| Shared limits | None in code: no token/quota counter, no per-user or per-channel budget, no concurrency cap. Cooldown (410 -> 60 min, quota 429 -> 15 min) is **in-memory per serverless instance** (providerHealth.ts:23-35) |
| FreeLLMAPI | **Not named anywhere in code or docs except PLAN.md:34.** Presumably an `openai_compatible` row with custom `baseUrl` (inference, NV) |
| Priority-0 claim | **NOT CONFIRMED.** HANDOVER s6 lists Gemini 1, NVIDIA 2 (410), OpenAI fallback, no priority 0. Conflicts with PLAN. Live rows are DB-only: no existing safe script lists them (`scripts/verifyProviderTable.ts` prints a count but connects to a DB; not run). Safe path: Super Admin `GET /agent/providers` (returns no key, `hasApiKey` only; agentProviders.ts:39-47) -> **blocker B2** |

## 4. Permission / tool matrix (as enforced today)

28 tools (19 read + Drive x3 + detail; 9 confirm-gated writes). Seeded permissions from `prisma/roleDefinitions.ts:60-150`; production DB rows NV. Admin = Super Admin / Owner-Admin / Management (identical in seed; SA additionally has `manage_settings`, which no tool checks).

| Tool group | Admin | Sales | Ops/PM | Erection | Commissioning | Service | Finance |
|---|---|---|---|---|---|---|---|
| Drive x3 (no permission check) | Y | Y | Y | **Y** | **Y** | **Y** | Y |
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

### Mapping of the plan's table onto existing groups

| Plan group | Existing role(s) | Fit |
|---|---|---|
| Finance | `finance` | Partial: needs finance-only allowlist (no customers contacts, quotes/PO creation, Drive) |
| Management | `management` (and `owner_admin`, `super_admin`) | Good, subject to a WhatsApp deny-list for settings |
| Erection/service engineer | `erection_engineer`, `service_engineer` (`commissioning_engineer` arguably) | Poor: no assigned-site tool, engineers see finance via payables |
| Unknown | no match / inactive / blocked | fail closed, silent |
| Not mentioned | `sales`, `ops_pm`, `customer`, others | Need owner decision; default = silent (unauthorized) |

### Conflicts between existing rules and the plan's table (report before any app-wide permission change)

| # | Conflict | Evidence |
|---|---|---|
| C1 | No role-to-tool allowlist exists; WhatsApp policy needs a new deny-by-default per-group allowlist on top of permissions | registry.ts; types.ts:5-16 |
| C2 | Engineers and Ops/PM hold `record_vendor_invoice` -> can call `get_payables`, `search_vendor_bills`, `create_vendor_invoice` (engineers seeing finance) | roleDefinitions.ts:91,102,113; zanAppFinanceTools.ts:168,336 |
| C3 | Drive tools have no permission check: Finance can read non-finance files and engineers can read finance files | driveTool.ts:37-75 |
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

| Aspect | Proposal |
|---|---|
| Mapping table | New `WhatsappIdentity`: id, userId (FK User), e164 (normalised, unique), lid (nullable, unique), status (`pending`/`active`/`disabled`/`revoked`), createdBy, verifiedBy, verifiedAt, aiPaused. No new role system: role/permissions always come from `User.role` at request time |
| Normalisation | Digits only, E.164 with country code; India 10-digit -> `91` prefix; reject ambiguous. Do not reuse `User.phone` for authorization (free text) |
| LID | Bridge resolves sender JID via whatsmeow LID store (phone-number <-> LID mapping) and sends both `senderJid` and resolved phone. Server matches e164 or stored lid; LID-only with no resolvable phone -> unknown -> silent. Mapping LID is stored only after owner-verified match |
| Ambiguity | 0 or >1 matches, inactive user, blocked vendor, disabled identity, lookup error -> silent drop (no reply/read receipt/typing) |
| Management | Super-admin-only REST + settings UI: add/remove number, pick user, enable/disable, pause AI. Backend `requirePermission('manage_settings')`; no auto-enrolment of unknown senders |
| Conversation | Dedicated `AgentConversation` per user with new `channel` column (`app`/`whatsapp`) and per-message channel labels; visible in app, continuable there |
| Revocation | Server re-checks identity + permissions at ingest, before each tool call and before send; on demotion/disable bump an `accessEpoch`, discard queued work and drop WhatsApp-sourced context when role/group changed |
| Tool gating | Per-group read-only allowlist (deny-by-default), settings/providers/credentials/permission tools never listed; closes C1-C3, C7-C10 |

## 7. Proposed topology and request/reply path

```
Phone -> WhatsApp -> [OCI VM: whatsmeow bridge, systemd, own session.db]
   -- outbound HTTPS POST /wa/inbound (bridge credential, HMAC over body+timestamp+messageId) -->
[Vercel Zan API] resolves sender -> authz -> shared agent service -> providers (priority order)
   <-- outbound HTTPS poll/long-poll GET /wa/outbox (same credential) -- bridge sends reply, then POST /wa/ack
```

| Point | Design |
|---|---|
| Bridge credential | Identifies the bridge only; endpoints accept only `{messageId, senderJid, resolvedPhone, text, ts}` and return only replies for already-authorized senders. Grants no read of Zan data; cannot name a user or role |
| Inbound port | None on OCI. All traffic outbound HTTPS from OCI (poll interval to be measured) |
| Why async | Agent turn budget is 55 s (timeouts.ts:26), `vercel.json` sets no `maxDuration` (plan limit NV, region `bom1`). Ingest returns 202 immediately; processing runs as a separate invocation/queue row; bridge polls for result. Needs a processing-status table (messageId unique for dedupe) |
| Persistent WhatsApp socket | Stays on OCI, never in Vercel |
| Duplicate risk | Crash after WhatsApp accepts but before ack can resend once; document, do not claim exactly-once |

## 8. Capacity assumptions

| Item | Observed | Source |
|---|---|---|
| OCI VM (freellmapi-vm) | Hyderabad, Ubuntu 24.04 Minimal, E2.1.Micro, 1 GB, 47 GB boot, ~35-36% memory over 1 h | PLAN.md only. **Not re-verified: OCI console not reachable (B1)** |
| Bridge footprint | Go binary 26.7 MB (client exe); pure-Go SQLite; expected tens of MB RSS idle | exe size observed; RSS NV |
| Agent LLM load | LLM runs at providers, not on the VM; bridge does I/O only | design |

Proposed pilot targets (to be measured in M6, not guarantees): concurrency 2 simultaneous WhatsApp turns; per-user serial order; queue depth cap 10; p50 reply < 15 s, p95 < 45 s (inside the 55 s budget); bridge RSS ceiling 100 MB; total VM memory < 70% sustained; persistent state + logs < 1 GB with log rotation; disk free > 10 GB.

## 9. Open blockers and what Ferose must provide

| # | Blocker | Needed |
|---|---|---|
| B1 | **OCI console inspection not done**: Claude in Chrome extension "not connected" (two attempts). VM shape/OCPU/memory/boot/IPs/VCN/ingress rules/metrics for freellmapi-vm and the second Oracle Linux VM are NV | Start/reconnect the Chrome extension signed in to the same Claude account, keep OCI console logged in; re-run OCI step |
| B2 | FreeLLMAPI priority 0 unconfirmed; provider rows are DB-only | Super Admin view of Settings > AI providers (names, priorities, active flags only), or permission to call `GET /agent/providers` |
| B3 | In-VM facts (services, free disk, ports, TLS, FreeLLMAPI health) need SSH or an endpoint; none documented in repo | SSH method/user/host (via your secure channel), or a public health URL |
| B4 | Group mapping decisions: where do Sales, Ops/PM, Commissioning, Owner-Admin sit; is Finance's customer-contact/Drive access acceptable; are Ops/PM/engineers' payables access to be removed for WhatsApp via allowlist (recommended) or app-wide | Decision on C1-C11 |
| B5 | Assigned-site rule for engineers (internal `assignedEngineerId` vs vendor scope) | Decision |
| B6 | Pilot users and numbers; owner-verified identity workflow | List |
| B7 | Fresh pairing of Zan-F on OCI vs session migration; owner present at M5 | Approval at M5 |
| B8 | Vercel plan function duration limit | Confirm plan |

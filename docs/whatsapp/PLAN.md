# Zan WhatsApp assistant: implementation and review handoff

Prepared 10 October 2026. This document is a plan, not evidence of implementation or deployment.

## Objective and team

Connect the Zan-F WhatsApp number, 919500245599, to Zan's existing AI assistant. Run the WhatsMeow connection on OCI so it works with the owner's laptop offline. Both channels must share the same assistant logic, provider routing, current access permissions and permitted conversation context. WhatsApp replies should usually be 1–3 short sentences.

- **Grok: coordinator.** Give Claude one milestone at a time, collect artifacts, invoke Codex review, and maintain the completion record. Do not mark a milestone complete from a builder's assertion alone.
- **Claude Code CLI: builder.** Inspect, implement, test, prepare releases, install on OCI, fix review findings, and write the operating guide.
- **Codex CLI / ChatGPT: reviewer.** Independently inspect each submitted revision and relevant test evidence. Remain read-only; return PASS or CHANGES REQUIRED with focused findings. Claude owns fixes.
- **Owner: access and acceptance.** Supply access through existing secure channels, complete any phone pairing, select pilot users and confirm the final production activation when the result is reviewable. Do not request already-granted approvals again.

Do not assume these CLIs share context or that this chat automatically receives their results. Grok must pass this plan, the current repository path, exact revision, milestone artifacts and relevant previous decisions to both CLIs.

## Non-negotiable behaviour

| Sender/group | Allowed WhatsApp behaviour |
| --- | --- |
| Finance | Retrieve finance information allowed by Zan; no work-order information |
| Management | Retrieve all business information permitted by Zan, subject to the WhatsApp settings exclusion |
| Erection/service engineer | Retrieve permitted site details and statuses, retaining any assigned-site restrictions |
| Unknown, disabled, revoked or unauthorized number | No automated reply, reaction, read receipt or typing indication; owner handles the conversation manually |
| Every group, including super admin | No settings information, provider configuration, credentials, permission administration or settings changes through WhatsApp |

Only super admin can manage number mappings and group assignments, using authenticated Zan settings. Map verified sender identities to existing Zan users and groups; do not create a second independent role system. If existing group rules conflict with the table, report the discrepancy before changing app-wide permissions.

Version 1 is text-based information retrieval only. Do not enable document creation, financial mutations, status changes, media processing, group-chat bots, bulk messaging or proactive notifications. Preserve the in-app assistant's existing capabilities and confirmation rules.

## Architecture and boundaries

1. Zan app chat and the OCI WhatsMeow bridge call the same server-side assistant service.
2. The service resolves the real user, checks current permissions, loads only permitted context, executes permitted retrieval tools and uses Zan's existing provider selection.
3. The verified priority-0 provider is the "Free LLM API" row (`openai_compatible`, tried first per live Settings, 10 Oct 2026 23:39/23:41 IST; then OpenAI 1, NVIDIA 2, Gemini 3). That this row is the FreeLLMAPI container on VM-A is inferred from the name, pending base-host verification (addendum 2026-10-11 item 1). Retain configured fallback order and shared provider limits.
4. WhatsMeow runs as a persistent Linux service. Do not reuse the Windows executable as a Linux binary or run the persistent connection inside a duration-limited Vercel request.
5. Use Zan's existing database where suitable for identity mappings, bounded conversation context, processing status and audit records. A phone's chat history is not a substitute for shared assistant context.
6. Store WhatsApp encryption/session state separately on persistent OCI storage. One active process owns each WhatsApp session. Never run the same copied session concurrently on the laptop and OCI.

The bridge is a transport component, not an administrator. It must not carry a credential that grants unrestricted Zan data access. Authenticate bridge requests server-side and bind every operation to the resolved sender's account, tenant, permissions and record scope. Never accept a claimed user or role from message text.

Use authenticated outbound requests from OCI to Zan and an authenticated outbound reply retrieval mechanism where practical. If an inbound OCI API is necessary, document the exact route, authentication, TLS and network exposure for review before activation. Do not expose a raw unauthenticated bridge port.

## Starting evidence to revalidate

- Local source is expected under `D:\Apps\WhatsMeow\whatsmeow-client\whatsmeow-client`; Zan-F account files are expected under `D:\Apps\WhatsMeow\Zan-F Number`. Preserve both until migration is accepted.
- Previous console inspection found `freellmapi-vm` in OCI Hyderabad: Ubuntu 24.04 Minimal, E2.1.Micro, 1 GB memory and a 47 GB boot volume. A one-hour sample showed roughly 35–36% memory and low CPU usage. Actual free disk, processes and peak capacity remain unverified.
- A second running Oracle Linux VM exists; its workload is unknown. Do not repurpose it without inspection.
- Previously observed successful WhatsMeow authentication and sending do not establish that a receive-and-reply service already exists.
- Historical Zan notes identify gaps between app pages and available assistant retrieval tools. Reinspect the current checkout; do not promise finance/site queries until their retrieval paths exist and are tested.

## Milestones

### M0 — Inspect and freeze the implementation contract

Claude locates the real Zan repository, reads applicable instructions, checks branch/worktree state and identifies assistant entry points, permission checks, database schema, provider routing and currently supported retrieval tools. Perform a read-only OCI server inspection through existing access: architecture, services, memory, disk, load, ports, TLS and FreeLLMAPI health. Do not print secrets or overwrite uncommitted work.

Deliver `DISCOVERY.md`: verified paths/revisions; permission and tool matrix; supported/absent queries; identity-linking design; proposed deployment topology; capacity assumptions; open blockers. Agree on pilot concurrency and measurable latency/resource targets rather than inventing a guaranteed user capacity.

**Codex gate:** confirm the design reuses current access controls, can identify every sender safely, preserves FreeLLMAPI routing, and has an implementable authenticated request/reply path.

### M1 — Build authorization and super-admin controls

Add the minimal number-to-user/account/group mapping to the existing data model. Normalize phone numbers consistently and handle WhatsApp sender identifiers, including alternate identifiers, using verified library mappings. Unknown or ambiguous identity must fail closed. Do not infer authorization from contact names or message content.

Add super-admin-only Zan controls to add/remove numbers, assign existing groups, enable/disable bot access and pause AI for a conversation. Validate ownership/identity through an explicit owner-approved workflow; do not automatically message unknown senders to enroll them. Prevent number collisions and cross-tenant assignments. All controls require backend authorization, even if UI buttons are hidden.

Build a common authorization layer: check before submitting content to an LLM, before each data/tool operation, and before returning or sending a response. Permission lookup failure means no data access and no WhatsApp reply. Group changes and removals invalidate pending work and stale access caches.

**Codex gate:** review authorization paths and tests for forged identities, cross-user/tenant access, direct API calls, revocation during processing, site scope and settings exclusion.

### M2 — Connect the shared assistant and retrieval tools

Reuse/refactor the existing assistant pipeline so both channels share instructions, permitted knowledge, retrieval rules and provider fallbacks. Apply WhatsApp-specific brevity and a read-only tool allowlist. Settings data must be excluded from tools, retrieved documents and shared summaries; remove sensitive settings from responses if a permitted source embeds them.

For each required finance/work-order/site query, map it to an existing authorized retrieval tool or implement the missing read-only tool. Apply row/record-level restrictions in the actual retrieval path, including counts, totals, search snippets and links. Do not fetch everything and ask the model to conceal forbidden records.

Link WhatsApp to a dedicated, visible conversation within the same user's Zan account, with a defined way to continue it in the app. Do not merge every chat indiscriminately. Save bounded history/summaries with source-channel labels; invalidate or re-filter context after permission changes. A user demoted from management to finance must not recover old restricted information from assistant memory.

**Codex gate:** verify real query results, correct account/context linkage, short replies, priority-0 routing/fallback and preservation of existing in-app behaviour. Prompt-string tests alone are insufficient.

### M3 — Build the persistent WhatsMeow bridge

Pin dependencies and create a Linux release for the verified OCI architecture. Extend the client into a persistent receive/process/reply service with graceful shutdown, reconnect backoff and safe database handling. Retain the earlier SQLite locking fixes where applicable; test real concurrent activity rather than assuming a pragma resolves every case.

Process direct text messages only. Ignore self-sent messages, group traffic, status/broadcast traffic and unsupported media. Gate access before forwarding message content to Zan. Unauthorized messages remain available for the owner in WhatsApp, with no bot-generated interaction. Ignore the owner's manual outgoing replies and honor conversation pause before any automated send.

Add durable message IDs, a bounded queue, per-conversation ordering, bounded concurrency, timeouts and retry rules. Suppress duplicate events and distinguish provider acceptance from confirmed WhatsApp delivery. Document the remaining duplicate risk if a crash occurs after WhatsApp accepts a reply but before local status is saved; do not claim exactly-once delivery without evidence.

Keep credentials and message bodies out of routine logs. Separate liveness, WhatsApp connection status, assistant availability and provider health.

**Codex gate:** inspect transport authentication, sender mapping, silent denial, echo prevention, ordering, retry behaviour, database locking and recovery tests.

### M4 — Test the complete flow before production

Use test accounts and known fixture records in an isolated environment. Exercise app-to-backend-to-data-to-provider-to-WhatsApp flow, and the reverse context continuation in the app. Test configured provider fallback and timeouts without repeatedly consuming live quota.

Required acceptance cases:

1. Finance receives correct permitted finance details; work-order requests reveal no restricted data.
2. Management receives permitted business data; settings requests reveal none.
3. Site engineer receives assigned-site details/status; unrelated sites and finance remain inaccessible.
4. Unknown/removed numbers receive zero automated sends, reactions, read receipts or typing events; their content is not sent to an LLM.
5. A direct forged request cannot impersonate an authorized sender or bypass group restrictions.
6. Removing access or changing a group mid-request prevents a stale response; old conversation memory does not leak previous privileges.
7. Shared context works only within the intended user/conversation; simultaneous users remain isolated.
8. Duplicate incoming events do not cause ordinary duplicate responses; failures recover according to the documented retry policy.
9. Owner manual messages do not trigger the bot; pause suppresses queued and new replies.
10. Existing Zan assistant queries and other existing functions pass relevant regression checks.

**Codex gate:** review actual integration evidence and relevant tests at the submitted revision. Fix gaps before releasing.

### M5 — Prepare and install on OCI

Prepare a versioned release and rollback instructions. Back up relevant existing configuration and persistent state without placing secrets in Git or the handoff. Recheck server headroom and FreeLLMAPI baseline; prefer building the executable off the small production VM.

Install under a dedicated unprivileged service account, with separate application, configuration and persistent-state directories. Use restrictive file permissions, a systemd service with restart/backoff and appropriate resource limits, bounded logs and disk monitoring. Reuse existing TLS/network infrastructure where suitable. Preserve FreeLLMAPI routes, provider settings and service operation.

Deploy reviewed Zan API/UI changes through its existing workflow. Use backward-compatible migrations and keep WhatsApp automation disabled initially. Do not merge unrelated branches or expose new routes without the applicable deployment authorization. Prepare the exact production revision, network changes and rollback for the owner if final activation approval is still needed.

Pair Zan-F on OCI with the owner's participation; prefer a fresh OCI pairing while retaining a recoverable local setup. If migrating session state instead, stop all writers and use a consistent database backup, including correct WAL handling. Never erase local account data to force a migration. Keep the bridge disabled for general users while verifying authentication.

**Codex gate:** verify installed binary version/hash, service user, persistent paths, file permissions, authenticated connectivity, boot startup, rollback and continued FreeLLMAPI health. An install command finishing is not proof of a working service.

### M6 — Pilot, capacity check and activation

Activate only owner-approved pilot mappings first. Test one authorized user per group and an unauthorized sender. Run agreed simultaneous inference traffic from both app and WhatsApp; record latency, queue time, failures, CPU/memory, disk and FreeLLMAPI/provider limits. Verify authorization again at send time.

Test a service restart, a brief network interruption and operation with the owner's laptop powered off. Schedule a VM reboot test only when its effect on FreeLLMAPI is acceptable. Confirm session survives restart, queued requests recover sensibly and unrelated users receive no replies.

Choose measured concurrency/rate limits. If the 1 GB VM lacks headroom, report findings and propose using the inspected second VM or a larger approved instance; do not silently upgrade or introduce paid services.

**Codex gate:** review pilot results and production readiness. Grok records final activation approval when required, and Claude enables the reviewed release for the selected authorized numbers.

### M7 — Operating handoff and final review

Deliver a plain-language runbook: add/remove users; change groups; pause/resume a chat; identify connection/provider failures; restart safely; re-pair; back up/restore; roll back; update dependencies; and stop automation without losing session state. Super admin can see connection and operational status in Zan; settings remain inaccessible through WhatsApp.

Record deployed app revision, bridge version, OCI instance, non-secret configuration, evidence, supported query matrix, known limitations and recovery steps. Run a bounded 24–48 hour pilot observation; provide a quiet error-focused monitor only if separately requested. Do not leave an agent sleeping indefinitely or claim the observation is complete before the interval ends.

**Final Codex gate:** PASS only when all acceptance cases, laptop-off operation, permissions, deployment evidence and handoff are complete. Otherwise list precise remaining work and keep status incomplete.

## Review protocol for Grok

For every milestone, Claude submits a small review packet: exact repository/branch/commit, changed files, concise behaviour description, executed checks and results, redacted integration evidence, and unresolved items. Freeze that revision while Codex reviews it. Codex returns findings with file/line evidence, impact and required correction; distinguish blockers from optional improvements. Claude fixes blockers, submits a new revision, and reruns affected checks. Grok advances only after PASS. Do not run two builders editing the same checkout.

For OCI-only milestones, include redacted service/config diffs and live verification results, not only source changes. Never include access tokens, session databases, phone pairing codes or full user messages in review packets.

## Completion definition

The integration is complete when approved numbers can retrieve their permitted Zan information through WhatsApp; every group is blocked from settings; unknown/revoked numbers receive no automated interaction; shared context respects current access; short replies use existing provider routing; OCI operates with the laptop offline; FreeLLMAPI remains healthy; and Codex has reviewed the actual released artifacts and acceptance evidence.

## Platform references and operational limits

- [WhatsMeow project and supported messaging capabilities](https://github.com/tulir/whatsmeow). This is a WhatsApp Web library; do not describe it as Meta's official Business API or guarantee permanent connectivity.
- [Vercel Function limits](https://vercel.com/docs/functions/limitations). Keep persistent WhatsMeow ownership on OCI; verify current limits for the Zan request processing design.
- [OCI Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm). E2 micro provides 1 GB RAM and fractional baseline CPU; Always Free idle instances may be reclaimed. Include recoverable backups and an honest availability limitation rather than promising uninterrupted hosting.

## ADDENDUM 2026-10-10 (M0 rev2) - notes only; the plan text above is unchanged

Source: `docs/whatsapp/DISCOVERY.md` rev2 and Ferose's decisions of 10 Oct 2026.

1. **Provider routing (corrects line 34).** Active providers are tried in ascending `priority`, 0 first (`agent/providers/factory.ts:32-37`). FreeLLMAPI is not named in code; it is an `openai_compatible` row with a custom `baseUrl`. **Rev3 update: line 34 is now verified as to ordering.** Live rows (Ferose's screenshots, 10 Oct 2026 23:39/23:41 IST) show "Free LLM API" at priority 0 (active, model `auto`), then OpenAI 1, NVIDIA 2, Gemini 3, all active, no ties (DISCOVERY 3). The link between that row and the VM-A FreeLLMAPI container is inferred from the name (base host not recorded), and its external limits and fallback health remain to be recorded before M1 integration. Fallback order and cooldowns are unchanged. The original line 34 is left untouched (this file is edited by addendum only on this branch).
2. **Access.** Every group except Customers can see site details; Owner/Admin = Super Admin; settings blocked over WhatsApp for every group incl. Super Admin; Customers get no reply for now.
3. **Roles are app-wide.** Finance and engineer restrictions are an explicit, tested role-permission change in M1 (not WhatsApp-only), with regression checks for the other roles (DISCOVERY 4.3).
4. **Engineers** see only their assigned sites (DISCOVERY 4.4).
5. **Tool policy.** WhatsApp is read-only, deny-by-default per group, enforced at execution by a policy-aware resolver as well as in the schemas sent to the model; Drive excluded from v1; WhatsApp never creates or confirms actions (DISCOVERY 4.2, 4.5).
6. **Pilot targets approved:** 2 concurrent turns, queue 10, p50 < 15 s, p95 < 45 s, bridge service memory < 100 MB, VM memory < 70%, > 10 GB disk free.
7. **Hosting confirmed:** the bridge runs on OCI. Fallback only if the capacity check fails: second VM (uninspected, conditional) or larger approved instance per M6. Read-only OCI inspection: VM-A inspected (headroom OK with caution; recheck at M5, measure at M6); TLS expiry open; VM-B not inspected (rev4 wording).
8. **Bridge/worker contract, identity binding (separate verified table, LID reconciliation) and channel-labelled history** are specified in DISCOVERY 6-7. Rev3 settles the Vercel limit: Hobby plan with Fluid compute, 300 s per invocation, and Hobby cron runs at most daily, so the worker is bridge-driven (poll + `waitUntil`), not cron-driven (DISCOVERY 7). Replies use a pre-send claim step (at-most-once after claim).
9. **Role changes (rev3, supersedes item 3's wording).** No Finance grant is revoked (but see item 12 for engineers); D2 is delivered by tighter tool read gates, a shared `siteScope` predicate (tools and REST), a Drive permission and the confirm-route permission check, with sequencing, rollback and named tests (DISCOVERY 4.3-4.4). `service_team` is in the engineer-scoped group (confirmed, item 12).
10. **Bridge trust.** The bridge is a trusted identity-asserting component; residual risk is accepted only with owner sign-off before M5 (DISCOVERY 6).
11. **M6** adds memory/swap sampling and thresholds on VM-A (DISCOVERY 8). HANDOVER's provider list is stale; fix on master later.
12. **Owner decisions, rev3 addendum (Ferose, 10 Oct 2026, 23:43 IST; replaces his 23:42 answer).** (a) The Service team (`service_team` role) gets WhatsApp access: the same read-only, assigned-sites-only, no-finance access as engineers (DISCOVERY D6, 4.1, 4.2, 4.4). (b) Engineers can no longer record vendor invoices in the app: an app-wide M1 role change removes `RECORD_VENDOR_INVOICE` from the erection and commissioning engineer roles (roleDefinitions.ts:102,113), with regression tests for the other roles; this also removes the engineers' path to payables / vendor-bill tools (DISCOVERY D7, 4.3 R8).

## ADDENDUM 2026-10-11 (M0 rev4) - notes only; the plan text above is unchanged

Source: `docs/whatsapp/DISCOVERY.md` rev4, `REVIEW-M0.md`, and Ferose's decisions D8-D10 of 11 Oct 2026 (00:01, 00:05, 00:07 IST). Where this addendum conflicts with earlier addendum items 3, 9 or 12, this addendum wins.

1. **Line 34, canonical wording (Codex rev3 LOW).** Replace the categorical "FreeLLMAPI remains the existing priority-0 provider" by: the verified priority-0 provider row is named "Free LLM API" (active, `openai_compatible`, model `auto`; then OpenAI 1, NVIDIA 2, Gemini 3); that this row is the FreeLLMAPI container on VM-A is **inferred from the name and pending base-host verification** (DISCOVERY 3). Line 34 itself is not edited here because this file changes by addendum only on this branch; this item is the canonical statement.
2. **Finance is restricted to four roles (D10, supersedes items 3, 9 and 12(b)).** Finance details are only for Management, Finance, Owner/Admin and Super Admin. Sales, Ops/PM, erection_engineer, commissioning_engineer, service_team and Customers lose finance access app-wide, in REST and in the assistant, through an explicit tested M1 role-permission change (DISCOVERY 4.3.1-4.3.11). Ops/PM no longer records vendor invoices (this supersedes the earlier "Ops/PM and Finance keep it").
3. **Engineers (D9).** Erection, commissioning and service_team see site details only, only for assigned sites; no Bills page and no other finance. The "Bills narrowed to own sites" idea (D8 item 2) is dropped; no read-only bills permission is added.
4. **Customer contacts (D8-1).** Finance, and every role without `manage_orders`, lose customer contact details in every REST and assistant path that returns them; billing identity fields stay (DISCOVERY 4.3.6).
5. **Drive.** Role-scoped Drive search is deferred to a later phase, not M1. In-app Drive is unchanged in M1. WhatsApp v1 excludes Drive.
6. **Worker claim (Codex rev3 MEDIUM).** The cross-row claim is one atomic statement over a 2-row slot table with per-sender ordering and fenced writes; race tests run on a fake store and the SQL is proven only in an M2 disposable-DB spike (DISCOVERY 7).
7. **Owner confirmations pending (DISCOVERY 4.3.8, F1-F7):** quotations as finance, Sales create-invoice from quotation, Ops/PM vendor-bill workflow, order-value visibility, Sales money views, customer-portal invoice/balance expectations, purchase orders as finance.

## ADDENDUM 2026-10-11 (M0 rev5) - notes only; supersedes earlier addenda where they conflict

1. **Line 34** was edited in place (rev5, Codex rev4 LOW); addendum item 1 above remains the reference for the inferred VM-A link.
2. **Re-scope (Ferose D11, 11 Oct ~06:02 IST: WhatsApp first, permissions later).** App-wide permission changes (earlier addenda items 3, 9, 12(b) and rev4 items 2-4: finance restricted to four roles, contact removal, order-value redaction, quotation invoice field, financeAccessMatrix test) move to deferred milestone **M1b**. **M1 is WhatsApp-only**: deny-by-default read-only allowlist per group enforced at execution time and in the schemas sent to the model; finance tools (including quotations) only for Management, Finance, Owner/Admin, Super Admin; engineers and service_team assigned-site tools only; Sales and Ops/PM non-finance read-only; no Drive, writes or settings for anyone; unknown/unmapped/disabled senders silent (DISCOVERY 4.2.1).
3. **Fast path:** M1 -> M3 -> M2 -> M4 -> M5 -> M6 (DISCOVERY 11).

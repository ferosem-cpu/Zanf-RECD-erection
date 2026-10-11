# Review packet: WhatsApp assistant M0, revision 4 (for ChatGPT Coder / Codex re-review)

| Item | Value |
|---|---|
| Repo / branch | `D:\Apps\Zanf-RECD-erection`, `feat/whatsapp-m0` (from master `cf5e049`), not pushed |
| Changed files (rev4) | `docs/whatsapp/DISCOVERY.md` (revised), `docs/whatsapp/PLAN.md` (dated addendum only), this file. Docs only: no code, schema, env, migration or deploy change |

## Review history
| Rev | Commit | Outcome |
|---|---|---|
| 1 | `fa6e4b9` (PLAN + DISCOVERY), `f99ef60` (packet) | Codex: **CHANGES REQUIRED** (F1-F9 below) |
| 2 | `4e909da` (+ `61618cd` read-only OCI facts) | Codex: **CHANGES REQUIRED** (B1, B2, M1-M4, L1) |
| 3 | `58ec86b` (rev3), `ef380ca` (rev3b, D6/D7); Codex reviewed `ef380ca` | Codex: **CHANGES REQUIRED** (three MEDIUM, three LOW; table below) |
| 3c | `abb0b73` | Owner decisions D8 recorded (docs only); item 2 now superseded |
| 4 | `32aaf64` | Codex: **CHANGES REQUIRED** (2 MEDIUM, 2 LOW; table below) |
| 5 | this commit (sha in the git log; no self-reference) | Docs only; for re-review of gate 1 |

## Rev4 -> rev5 (docs only; D11 re-scope)
| Id | Finding / decision | Fix (rev5) | Ref | Status |
|---|---|---|---|---|
| D11 | Owner: WhatsApp first, permissions later; F1-F7 answered (F1 quotations finance, F2 Sales keeps quotation->invoice, F3 Ops/PM loses Bills, F4 order value hidden, F5/F7 POs/suppliers finance, F6 no customer invoices) | Recorded; F1/F2 interaction flagged, unresolved | DISCOVERY D11, 4.3.8 | Recorded; interaction open (M1b) |
| D11-2 | Re-scope | All app-wide permission work moved to deferred M1b (kept, not deleted); new WhatsApp-only M1: deny-by-default allowlist, finance tools for four roles only, engineers assigned-site only, no Drive/writes/settings, unknown senders silent | DISCOVERY 4.2.1, 4.3, 11 | Design done |
| R4-1 | MEDIUM: `GET /quotations/:id` returns linked invoices to Sales | WhatsApp: quotations tool excluded from all non-finance groups. REST field fix + Sales/Finance tests moved to M1b | DISCOVERY 4.2.1, 4.3 (a) | WhatsApp closed; app-wide deferred |
| R4-2 | MEDIUM: `financeAccessMatrix.test.ts` expects 403 on routes Sales may read | Per-route status + field assertions specified; test moved to M1b | DISCOVERY 4.3 (b) | Deferred (M1b) |
| R4-3 | LOW: P4 contact filter vs `manage_orders`; P12 test unnamed | P4 uses shared role-aware filter; print test named `printContacts.test.ts` | DISCOVERY 4.3 (c) | Deferred (M1b) |
| R4-4 | LOW: `PLAN.md:34` categorical priority-0 claim | Edited in place to the verified statement (Free LLM API row priority 0, tried first, 10 Oct 23:39/23:41 IST; VM-A link inferred); addendum keeps the reference | PLAN.md:34 | Fixed |
| R4-5 | Gates 2-4 conditions (bridge risk acceptance before M5; provider host/limits before integration; SQL/`waitUntil` spikes in M2) | Unchanged; placed on the fast path (M5, M2) | DISCOVERY 11, O6-O10 | Open as scheduled |

## Rev3 -> rev4 findings
| Id | Severity | Finding | Fix (rev4) | DISCOVERY ref | Status |
|---|---|---|---|---|---|
| R3-1 | MEDIUM | R8 removed engineers' `RECORD_VENDOR_INVOICE` (their only Bills gate) while R5 still had them viewing/editing own bills | Resolved by owner decision D9: engineers get **no Bills and no finance at all**; R5 superseded, no read-only bills permission added, no recorder filter. D10 widens R8 to Ops/PM and subsumes it. Routes, tools, role x key table, tests, rollback listed with file:line | 0 (D8, D9, D10), 4.3.1-4.3.11 (R5, R8, R-all) | Design done; implementation M1 |
| R3-2 | MEDIUM | R3 "app-wide" contact removal only filtered agent output and left REST `/customers` | Contacts omitted for every role without `manage_orders` in 12 enumerated paths (REST list/detail, invoice/quotation/order embeds, agent `search_customers`, print pages), billing fields kept (name, gstin, state, billingAddress, address, openingBalance), one test per path; no separate customer search/export route exists | 4.3.5 R3, 4.3.6 (P1-P12) | Design done; implementation M1 |
| R3-3 | MEDIUM | Worker claim: single-row conditional update cannot enforce the global cap of 2 or sender order across different rows | Single atomic statement: 2-row slot table (structural cap), earliest-non-terminal eligibility per sender, partial unique index on in-flight sender, `FOR UPDATE SKIP LOCKED`, lease expiry/reclaim, fenced writes; seven race tests on a fake store; SQL itself only provable in an M2 disposable-DB spike (needs owner approval as an exception to fakes-only) | 7 (Atomic claim, Lease expiry / reclaim / fencing, Tests) | Design done; SQL proof open (O10) |
| R3-4 | LOW | VM-A inspection called pending in D5 and PLAN; second VM called "inspected" | D5 row, DISCOVERY 8 and PLAN addendum now: VM-A inspected, TLS expiry open, VM-B conditional and uninspected | 0 (D5), 8, 9 (O2, O7) | Closed |
| R3-5 | LOW | `PLAN.md:34` still states FreeLLMAPI as the priority-0 provider while the addendum calls the link inferred | PLAN allows addendum edits only on this branch, so the canonical corrected sentence is PLAN addendum 2026-10-11 item 1 (verified row name/order; VM-A link pending base-host verification). **Deviation: line 34 itself is not edited; reviewer may require an in-line edit** | PLAN addendum item 1; 3 | Closed by addendum; reviewer may still ask |
| R3-6 | LOW | "As enforced today" matrix already showed the erection engineer's vendor-invoice write removed | Matrix restored (erection: "status update, vendor invoice"); removal appears only in the proposed policy (4.3) | 4 (matrix), 4.3.5 R8 | Closed |
| D10-1 | owner | Finance only for Management, Finance, Owner/Admin, Super Admin; all other roles incl. Customers lose it, REST and assistant | Role x removed keys table with roleDefinitions.ts lines (ops_pm :91, erection :102, commissioning :113; sales/service_team/customer none in the seed, drift cleanup only); 10 keys with every gated REST route and assistant tool mapped; migration + seed `revoke:`; leak closures R9 (`/sites/:id/costs`) and R10 (order value) | 4.3.1-4.3.5 | Design done; F1-F7 open |
| D9-1 | owner | Engineers: assigned-site details only, no finance | R6 (`siteScope`) plus D10 removal; test `engineerSiteOnly.test.ts` | 4.3.5 R6, 4.4 | Design done |
| D8-4 | owner | Role-scoped Drive search deferred | Marked "deferred, later phase, not M1" in D8, R7, 4.2; in-app Drive unchanged; WhatsApp v1 excludes Drive | 0, 4.2, 4.3.5 R7 | Recorded |

## Rev2 -> rev3 findings (history)
B1 Finance writes: no Finance grant revoked, finance writes kept (rev4: still true for the four allowed roles). B2 scoped site read: `siteScope(auth)` for tools and REST, Drive excluded. M1 `service_team` added (D6). M2 trusted bridge with accepted residual risk before M5. M3 pre-send claim (at-most-once after claim). M4 bridge-driven worker (Hobby, 300 s, daily cron only). L1 priority-0 claim verified by screenshots (row name/order only).

## Rev1 findings (history)
F1 unsafe retrieval scope -> 4.2-4.4; F2 policy bypass via global `getToolByName` -> 4.5; F3 provider/OCI facts -> sections 3 and 8; F4 bridge/worker contract -> section 7; F5 sender identity/history -> section 6; F6 confirm route -> 4.2; F7 Drive wording and F8 pilot labels -> fixed in rev2; F9 verified binding, scoped credential -> 6, 7.

## Owner decisions
D1-D4 (10 Oct): site details for all groups but Customers; Owner/Admin = Super Admin; settings blocked; app-wide restrictions; engineers assigned sites; pilot targets. D5 OCI hosting. D6 (23:43 IST) `service_team` read-only, assigned sites, no finance. D7 (23:43 IST) engineers cannot record vendor invoices (**its "Ops/PM and Finance keep it" clause is superseded by D10**).

**D8 (Ferose, 11 Oct 00:01 IST):** (1) Finance stops seeing customer contact details: YES (R3, app-wide). (2) ~~Engineers' Bills page narrowed to their own sites~~ **SUPERSEDED by D9.** (3) Engineers lose the all-sites list: YES (R6). (4) Finance and engineers keep in-app Drive; role-scoped Drive search is **deferred** to a later phase, not M1; WhatsApp v1 excludes Drive.

**D9 (00:05 IST, replaces D8 item 2):** engineers (erection, commissioning, service_team) access only site details, only for assigned sites; no finance of any kind (Bills, payables, receivables, invoices, vendor bills, expenses, payments, ledger, revenue). No read-only bills permission is added.

**D10 (00:07 IST, broadest):** finance details only for Management, Finance, Owner/Admin and Super Admin. Sales, Ops/PM, erection, commissioning, service_team and Customers lose finance app-wide in REST and the assistant. "Finance" here includes invoices (proforma/tax), bills and vendor-invoice recording, payables, receivables, payments and advances, revenue and collections, ledger, TDS/GST exports, credit/debit notes, expenses, purchase orders and suppliers, and order value (DISCOVERY 4.3.1). Quotations are not included pending F1.

## Checks run (rev4)
- Read: Codex rev3 `REVIEW_REPORT.md`, DISCOVERY, REVIEW-M0, PLAN addendum, owner decisions.
- Scoped source reads for citations only: `roleDefinitions.ts:1-150`, `constants.ts:162-191`, `middleware/auth.ts:53-65`, route gate greps in `routes/` (bills, invoices, payments, customers, credit-notes, expenses, ledgers, purchase-orders, quotations, customer-purchase-orders, customerPricing, savedItems, orders, sites, financeDashboard, products, vendors, dashboard), agent tool gates (`zanAppFinanceTools.ts`, `zanAppReadTools.ts`, `zanAppDetailTool.ts`, `zanAppWriteTools.ts`), `admin-web/src/lib/routeAccess.ts`.
- No code change, migration, DB access, deploy, OCI/SSH, secrets, build or test run in this revision. Production grants and UI behaviour not verified against production.

## Open items
1. **F1-F7 for Ferose (DISCOVERY 4.3.8):** F1 quotations as finance (default no); F2 Sales "create invoice from quotation" (quotations.ts:316-318, any-of gate) removed by default; F3 Ops/PM vendor-bill workflow lost (roleDefinitions.ts:91; Bills pages, 3 tools, purchase-orders.ts:103); F4 order value hidden from engineers/service/Ops/PM; F5 Sales money views (order value, embedded customer orders); F6 customer portal: no customer invoice/balance path found in REST or the assistant, possible existing `/sites/:id/costs` leak (sites.ts:528, no customer check seen), UI not exercised; F7 purchase orders/suppliers treated as finance.
2. Production role-grant diff before the migration (prod migration history has drifted); save the pre-change grant set for the inverse SQL.
3. M2 disposable-DB spike for the atomic claim SQL (O10) and `waitUntil` spike; needs approval as an exception to fakes-only.
4. Pilot users and verified numbers; pairing approach (owner present at M5); TLS expiry check; VM-B only if VM-A fails headroom; FreeLLMAPI base host, limits and fallback health before M1 integration; HANDOVER provider list fix on master; trusted-bridge residual-risk acceptance before M5.

## Gate questions for re-review (rev5)
1. Gate 1: does the M1 design (DISCOVERY 4.2.1) reuse current access controls, identify senders safely and enforce a WhatsApp-only allowlist (deny by default, execution-time resolver, schema filtering, site scope, silence for unknown senders) without any app-wide permission change?
2. Rev5 items: is the D11 re-scope (M1 WhatsApp-only; M1b deferred with analysis kept) coherent, is the F1/F2 interaction correctly flagged rather than resolved, and is PLAN.md:34 now acceptable?

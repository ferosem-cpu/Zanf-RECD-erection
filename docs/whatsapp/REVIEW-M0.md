# Review packet: WhatsApp assistant M0, revision 3 (for ChatGPT Coder / Codex re-review)

| Item | Value |
|---|---|
| Repo / branch | `D:\Apps\Zanf-RECD-erection`, `feat/whatsapp-m0` (from master `cf5e049`), not pushed |
| Changed files (rev3) | `docs/whatsapp/DISCOVERY.md` (revised), `docs/whatsapp/PLAN.md` (addendum only), this file. Docs only: no code, schema, env, migration or deploy change |

## Review history
| Rev | Commit | Outcome |
|---|---|---|
| 1 | `fa6e4b9` (PLAN + DISCOVERY), `f99ef60` (packet) | Codex: **CHANGES REQUIRED** (F1-F9 below) |
| 2 | `4e909da` (+ `61618cd` read-only OCI facts) | Codex re-review of `4e909da`: **CHANGES REQUIRED** (B1, B2, M1-M4, L1) |
| 3 | this commit (sha in the git log; no self-reference) | For re-review |

## Rev2 -> rev3 findings
| Id | Severity | Finding | Fix (rev3) | DISCOVERY ref | Status |
|---|---|---|---|---|---|
| B1 | BLOCKER | App-wide role change could remove legitimate Finance work | Withdrew "Finance loses write tools". No Finance grant revoked (engineers lose only `RECORD_VENDOR_INVOICE`, D7/R8); change list R1-R8 separates read-gate tightening from kept finance writes (roleDefinitions.ts:121-138); sequencing (additive migration -> API deploy -> channel), rollback (redeploy previous API), named tests (role matrix, finance writes, REST unchanged, WhatsApp denial, role drift, route inventory) | 4.3 | Design done; implementation M1 |
| B2 | BLOCKER | Scoped site read and all-groups access not closed; generic Drive permission cannot enforce scope | Shared `siteScope(auth)` for tools and REST; gate `hasAny(MANAGE_ORDERS, VIEW_ORDERS, VIEW_SITE_STATUS)` covers Finance and Ops/PM (zanAppReadTools.ts:843-851); list/detail/counts/snippets tests; Drive excluded from WhatsApp; in-app Drive unchanged in M1 (R7 withdrawn, D8-4; role-scoped Drive is a later phase) | 4.3 R6-R7, 4.4 | Design done; implementation M1 |
| M1 | MEDIUM | `service_team` omitted | Added to engineer-scoped group in mapping and policy; wrong `service_engineer` key corrected; **owner confirmed (D6, 23:43 IST)** | 4.1, 4.2, 4.4, O9 | Design done; owner confirmed |
| M2 | MEDIUM | Signed bridge data can select a mapped user | Bridge named a trusted identity-asserting component; key custody, audit, limits; residual risk to be accepted by owner before M5; forged-sender tests | 6 (Trust model, Tests) | Design done; owner acceptance open |
| M3 | MEDIUM | Reply authorisation ends before the actual send | Lease returns no text; pre-send `claim` re-authorises and releases text; 30 s lease, 15 s `sendBy`; at-most-once after claim; residual <=15 s window documented; tests | 7 (Pre-send claim) | Design done |
| M4 | MEDIUM | Worker trigger/recovery was a choice | Vercel limit verified (300 s); Hobby cron is daily so bridge-driven worker (`waitUntil` + poll reaping expired leases); atomic lease, checkpoint, resume, bounds, failure reply; tests | 7 | Design done; `waitUntil` spike in M2 |
| L1 | LOW | PLAN.md:34 false priority-0 assertion | Live rows now verify the ordering, so the sentence is true; the PLAN addendum states this and the original line is untouched because the instruction for this revision restricts PLAN edits to the addendum | PLAN addendum 1; 3 | Closed by verification; reviewer may still ask for an in-line edit |

Report's "Conditions for a new M0 review": B1/B2/M1-M4 resolved as above; live provider metadata recorded (base host, external limits and fallback health still open before M1 integration); Vercel duration confirmed before selecting the worker; OCI VM-A inspection complete (DISCOVERY 8); gates re-scored in DISCOVERY 10.

## Rev1 findings (history)
F1 unsafe retrieval scope -> 4.2-4.4; F2 policy bypass via global `getToolByName` -> 4.5; F3 provider/OCI facts -> section 3 (now resolved) and 8; F4 bridge/worker contract -> section 7; F5 sender identity/history -> section 6; F6 confirm route -> 4.2 (concrete fix in rev3); F7 Drive wording and F8 pilot labels -> fixed in rev2; F9 verified binding, scoped credential -> 6, 7.

## Owner decisions (10 Oct 2026)
D1 all groups except Customers see site details; Owner/Admin = Super Admin; settings blocked for all over WhatsApp; Customers silent. D2 Finance/engineer restrictions app-wide via tested M1 change. D3 engineers see assigned sites only. D4 pilot targets approved. D5 OCI hosting confirmed; OCI inspection required before M3/M5. D6 (23:43 IST) Service team (`service_team`) gets the same read-only, assigned-sites, no-finance WhatsApp access as engineers. D7 (23:43 IST) engineers can no longer record vendor invoices in the app (M1 role change R8: `RECORD_VENDOR_INVOICE` removed from erection and commissioning, regression tests; also removes their payables/vendor-bill tool path). Both replace the 23:42 answer. Details: DISCOVERY 0.

**Decisions confirmed by Ferose 11 Oct 00:01 IST (D8, app-wide M1 items):** (1) Finance stops seeing customer contact details: YES (R3). (2) Engineers' Bills page narrowed to their own sites: YES (R5). (3) Engineers lose the all-sites list: YES (R6). (4) Finance and engineers keep in-app Drive: NO revocation (R7 withdrawn); role-scoped Drive (Finance: finance documents; engineers: engineering documents and photos) is a later phase, not M1; WhatsApp v1 still excludes Drive.

## Checks run (rev3)
- Evidence: Ferose's screenshots of Settings -> AI providers (23:39, 23:41 IST); Vercel CLI/API read-only checks (23:40 IST); Vercel docs for Fluid duration and Hobby cron.
- Scoped source reads for citations: `roleDefinitions.ts:56-150`, `zanAppReadTools.ts:838-854`, `agentConversations.ts:534-570`, `sites.ts:26-66`, `bills.ts` route list, `financeDashboard.ts:111`, `timeouts.ts:26`.
- The earlier direct DB read from the PC failed (`PrismaClientInitializationError`; the pulled production env likely has sensitive values blanked). No code, migrations, DB access, deploys, OCI/SSH, WhatsApp access, tests or builds in this revision.

## Open items
1. Pilot users and verified numbers. 2. Pairing approach (owner present at M5). 3. TLS expiry check (read-only `openssl s_client`, domain from owner/provider base host). 4. Second VM: conditional on VM-A failing the M6 check. 5. HANDOVER provider list fix on master (not on this branch). 6. FreeLLMAPI base host, external limits, fallback health before M1 integration. 7. Remaining owner confirmation in DISCOVERY O9: acceptance of the trusted-bridge residual risk (the `service_team` confirmation is no longer open: D6). 8. M1: diff production role grants before the role-permission change (prod migration history has drifted).

## Gate questions for re-review
1. Do 4.3 (R1-R8, sequencing, rollback, tests) and 4.4 (`siteScope`, gate, coverage tests) close B1 and B2, including Finance and Ops/PM site access and Drive treatment?
2. Is `service_team` handled acceptably (engineer-scoped group, owner-confirmed D6) and is the R8 vendor-invoice removal (D7) with `vendorInvoiceRoles.test.ts` adequate?
3. Is the trusted-bridge model plus tests an acceptable closure of M2 given the residual risk needs owner sign-off before M5?
4. Does the lease -> claim -> ack flow close M3, and is the <=15 s post-claim window acceptable?
5. Is the bridge-driven worker (Hobby, 300 s, daily cron only) a complete contract for M4, with the `waitUntil` spike deferred to M2?
6. Are gates 1-4 as re-scored in DISCOVERY 10 supportable, in particular gate 3 now that "Free LLM API" is verified at priority 0?

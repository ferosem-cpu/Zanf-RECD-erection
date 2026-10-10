# Review packet: WhatsApp assistant M0, revision 2 (for ChatGPT Coder / Codex re-review)

| Item | Value |
|---|---|
| Repo / branch | `D:\Apps\Zanf-RECD-erection`, `feat/whatsapp-m0` (from master `cf5e049`), not pushed |
| Changed files | `docs/whatsapp/DISCOVERY.md` (revised), `docs/whatsapp/PLAN.md` (addendum appended, original text untouched), this file. Docs only: no code, schema, env or deploy change |

## Review history
| Rev | Commit | Outcome |
|---|---|---|
| 1 | `fa6e4b9` (PLAN + DISCOVERY), `f99ef60` (packet) | Codex: **CHANGES REQUIRED** |
| 2 | this commit (sha in the git log; no self-reference) | For re-review |

## Findings and how addressed
| Id | Severity | Finding | Addressed in | Status |
|---|---|---|---|---|
| F1 | BLOCKER | Unsafe retrieval scope for WhatsApp (engineer payables, Drive, no assigned-site filter, ID-detail bypass) | DISCOVERY 4.2 (per-group read-only policy), 4.3 (app-wide M1 changes + regression checks), 4.4 (server-side site filters, vendor-engineer rule) | Design done; implementation M1 |
| F2 | BLOCKER | Policy bypass via global `getToolByName` if only schemas are filtered | DISCOVERY 4.5 (policy-aware resolver at execution; llm.ts:99-107, registry.ts:16-17, toolExecution.ts:76; per-call re-check) | Design done |
| F3 | BLOCKER | Provider and OCI facts unverified; PLAN priority-0 claim | DISCOVERY 3 (routing rule, FreeLLMAPI unverified, read attempt failed safely), 9 B1/B2; PLAN addendum item 1 | **Open**: provider rows; OCI inspection pending (before M3/M5) |
| F4 | MEDIUM | Bridge/worker contract incomplete | DISCOVERY 7 (signing, replay window, idempotency, queue/outbox, leases, scoped credential, Vercel duration, chunked turns) | Design done; Vercel plan limit open (B3) |
| F5 | MEDIUM | Sender identity and history revocation | DISCOVERY 6 (separate verified table, LID reconciliation, fail closed, recycled numbers, channel labels, re-check per tool call and before send, accessEpoch) | Design done |
| F6 | MEDIUM (report s3) | Confirm route lacks tool permission re-check; WhatsApp must never confirm | DISCOVERY 4.2 (WhatsApp never creates/confirms; confirm route rejects channel=whatsapp), M1 fix noted | Design done |
| F7 | LOW | Drive wording (old line 103) | DISCOVERY 4 matrix row and C3: denies customers, no permission or document-scope check otherwise | Fixed |
| F8 | LOW | Pilot targets must be labelled (old line 173) | DISCOVERY 8: now approved by owner (D4) | Fixed |
| F9 | Gate 2/4 | Verified binding flow; credential cannot choose arbitrary users | DISCOVERY 6, 7 | Design done |

## Owner decisions (10 Oct 2026)
D1 all groups except Customers see site details; Owner/Admin = Super Admin; settings blocked for all over WhatsApp; Customers silent. D2 Finance/engineer restrictions app-wide via tested M1 change. D3 engineers see assigned sites only. D4 pilot targets approved. D5 OCI hosting confirmed; OCI inspection still required before M3/M5. Details: DISCOVERY 0.

## Checks run
- Re-read REVIEW_REPORT.md; verified citations: `llm.ts:99-107`, `registry.ts:8-17`, `toolExecution.ts:76` (file is `agent/toolExecution.ts`), `AgentLlmProvider` schema, `vercel.json` (no `maxDuration`).
- One approved read-only provider read attempted via throwaway script `.claude-task/read-providers.ts` (no key columns, host only). It failed with `PrismaClientInitializationError`; nothing printed, nothing improvised, no writes. Rows remain open.
- No code, migrations, DB writes, deploys, OCI/WhatsApp access, tests or builds (docs-only).

## Open items
1. Live provider rows (read Settings -> AI providers) and whether FreeLLMAPI is the lowest active priority. 2. OCI read-only inspection: VM-A (freellmapi-vm) done 2026-10-10, headroom OK with caution, bridge host recommended (DISCOVERY 8); VM-B not inspected (key refused / port 22 timeout) and VM-A TLS expiry not verified. 3. Vercel plan duration limit. 4. Pilot users and verified numbers. 5. Pairing approach. Also for M1: diff production role grants before the role-permission change (prod migration history has drifted).

## Gate questions for re-review
1. Does 4.2 plus 4.4 close F1 (policy table, server-side row filters, Drive excluded, vendor-engineer rule)?
2. Does 4.5 close F2 (execution-time rejection independent of model output, per-call re-check)?
3. Is the provider handling in section 3 acceptable for M0, with live rows open until before M1 integration?
4. Is the section 7 contract implementable once the Vercel limit is confirmed?
5. Are the identity and history rules in section 6 an executable contract?
6. Can M0 pass as repo-side discovery with OCI inspection explicitly gated before M3/M5?

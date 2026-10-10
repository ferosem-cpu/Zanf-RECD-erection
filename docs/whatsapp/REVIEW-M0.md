# Review packet: WhatsApp assistant M0 (for ChatGPT Coder / Codex)

| Item | Value |
|---|---|
| Repo | `D:\Apps\Zanf-RECD-erection` |
| Branch | `feat/whatsapp-m0` (from master `cf5e049`), not pushed |
| Commit to review | `fa6e4b9` (PLAN.md + DISCOVERY.md); this packet is in the following commit |
| Changed files | `docs/whatsapp/PLAN.md` (added), `docs/whatsapp/DISCOVERY.md` (added), `docs/whatsapp/REVIEW-M0.md` (added). No code, schema, env or deploy changes |

## Summary
Read-only discovery. Findings: the agent has no role-to-tool allowlist (permissions are checked inside each tool handler); WhatsApp needs a new deny-by-default per-group read-only allowlist. WhatsMeow client is a short-lived Windows CLI with auth and send only, no receive/reply loop, no LID handling. Priority 0 means first tried, but FreeLLMAPI is not in code or HANDOVER, so the PLAN claim is unconfirmed. 13 conflicts are flagged in DISCOVERY section 4 (e.g. engineers can call payables tools via `record_vendor_invoice`; Drive tools have no permission check; assigned-site scope is unimplemented; unscoped work-order/complaint detail by id).

## Checks run
- Read PLAN, CLAUDE.md; read-only code survey of `apps/api` (routes, agent, tools, providers, schema, roleDefinitions, tests list) via sub-agent with file:line citations.
- Read-only listing and source read of both WhatsMeow folders; no session/credential/data file opened, nothing run or built.
- `git status`/`rev-parse` only. No DB access, no scripts, no tests run (docs-only).
- OCI console: attempted via Claude in Chrome; extension not connected (2 attempts). **Not inspected.**

## Blockers
B1 OCI console/VM facts unverified (browser extension offline); B2 live provider rows / FreeLLMAPI priority 0; B3 SSH or health URL for in-VM facts; B4 group mapping and permission decisions; B5 assigned-site rule; B6 pilot users; B7 pairing approach; B8 Vercel plan duration limit. Details in DISCOVERY section 9.

## Codex gate questions (M0)
1. Does the proposed design reuse current access controls (per-request permission loading, `isActive`, vendor-block) rather than a second role system?
2. Can every sender be identified safely, including LID-only senders, with fail-closed silent denial?
3. Is FreeLLMAPI priority-0 routing preserved? Note it is unconfirmed (B2); is that acceptable to proceed to M1?
4. Is the outbound-only bridge request/reply path (async ingest, outbox poll, ack, messageId dedupe) implementable within the 55 s turn budget and Vercel limits?
5. Are the 13 flagged conflicts complete, and is the per-group allowlist (rather than app-wide permission changes) the right resolution?
6. Is M0 acceptable with the OCI inspection outstanding, or must it be completed first?

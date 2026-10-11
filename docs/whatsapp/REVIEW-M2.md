# WhatsApp M2 review packet

Branch `feat/whatsapp-m2` (from e141444). Local only, nothing pushed, merged or deployed. No migration applied.

## Commits
| SHA | What |
|---|---|
| 5d064ff | Part A: bridge request authentication (HMAC key store, durable nonce table), contract in DISCOVERY s7 |
| e5974bc | Part B: /wa ingest, outbox poll, claim, ack on the shared assistant pipeline |
| bbbb84e | Part C: vendor detail fixed WhatsApp field list, clean 409 on mapping unique violations |

## Files
- A: `services/whatsappBridgeAuth.ts`, `services/whatsappBridgeNonceStore.ts`, migration `20261011130000_whatsapp_bridge_nonce`, `test/whatsappBridgeAuth.test.ts`, DISCOVERY s7.
- B: `services/whatsappBridge.ts` (service), `whatsappBridgeStore.ts` (Prisma store), `whatsappBridgeProd.ts` (wiring), `routes/whatsappBridge.ts`, `lib/backgroundTask.ts`, `index.ts` (mount `/wa` before `express.json`), `routes/agentConversations.ts` (channel isolation), `schema.prisma` + migration `20261011131000_whatsapp_bridge_queue`, `test/whatsappBridge.test.ts`.
- C: `agent/whatsapp/policy.ts` (`VENDOR_SPEC`), `agent/tools/zanAppDetailTool.ts`, `services/whatsappMapping.ts` (`isUniqueViolation`, `guardUnique`), `test/whatsappMappingConflict.test.ts`.

## Behaviour
- Auth: HMAC-SHA256 over `METHOD\nPATH?QUERY\nTIMESTAMP\nNONCE\nBODYSHA256`; body hash recomputed; skew max 300 s; nonce kept 900 s in the DB, recorded only after a valid signature; constant-time compare; keys from `WHATSAPP_BRIDGE_KEYS`, rotatable by key id. Every auth failure is a uniform 401; a nonce-store failure is 503.
- Ingest: exactly `202 {decision}`. Same shape for unknown, denied and duplicate senders. Idempotent by message id (a duplicate gets the original decision, no second job).
- Processing: runs after the response via the Vercel request-context `waitUntil` (detached elsewhere). Job lease 90 s with token fencing, max 3 attempts, max job age 3 min, restart from the poll backstop after 20 s. After the last attempt one neutral failure reply is queued.
- Turn: shared `runAgentTurn`, M1 policy, WhatsApp brevity addendum, one conversation per sender (`channel=whatsapp`), `finalCheck: turn.recheck` passed. A mapping revoked mid-turn produces no outbox row and no saved conversation.
- Outbox: poll and claim re-authorise (mapping enabled, unpaused, user active, group unchanged, phone/LID equal to the row snapshot). Recipient comes from the mapping, never from the inbound message. Claim returns `{text, sendBy}` with sendBy = now + 15 s. Lease 30 s, TTL 10 min. Claim is at-most-once: once claimed, a lapsed lease is never re-sent (becomes `uncertain`/`expired`).
- In-app isolation: app conversation list, get, delete, messages and confirm/reject only see `channel = "app"`.
- C: WhatsApp vendor detail uses a fixed field list in both the select and the projection (no Drive columns, e-mail, approver/archiver ids). Adding or enabling a mapping turns Prisma P2002 / Postgres 23505 into a 409.

## Ownership choice
**(i)**: the outbox lease is bound to the bridge key id, and only that key may claim or ack. The wire has no lease-token field (claim body is `{}`, the URL carries only the id), so (ii) would need a bridge change.

## Final contract
See DISCOVERY.md s7, "Final wire contract (rev6)". Summary:
| Call | Request | Response |
|---|---|---|
| POST /wa/ingest | signed; strict JSON message | 202 `{decision: accept\|ignore}`; 400 invalid; 401; 503 |
| GET /wa/outbox?limit | signed | 200 `{items}` |
| POST /wa/outbox/:id/claim | signed, body `{}` | 200 `{text, sendBy}`; 404; 409 not claimable; 410 gone |
| POST /wa/ack | signed; `{outboxId, status, at, ...}` | 200 `{ok:true}`; 404; 400 |

## Tests (`.claude-task/check.ps1`)
- API 246 pass / 0 fail (baseline 223; +6 auth, +14 bridge, +3 C).
- admin-web 35 pass / 0 fail (unchanged).
- Bridge tests cover: the four 401 cases, duplicate id, revoked mid-turn, re-auth at poll and claim, at-most-once after claim, signed fetch against a real listener.
- All use fakes. Nothing ran against a real DB, LLM or WhatsApp.

## Deferred
- Worker slot table / partial unique index and the global concurrency cap of 2 (the bridge's own cap is relied on). Per-sender ordering is best-effort.
- Per-identity rate limits, daily cap, distinct-identity alert (DISCOVERY s6).
- `accessEpoch` (M1 has none; group + enabled + paused + recipient are checked instead).
- `providerHealth` is omitted from the poll response.

## Risks
- The 3 migrations (nonce, queue, channel column) are written but NOT applied; prod migration history has drifted. Not verified against production or any database.
- The Prisma stores and their SQL (conditional `updateMany`) are untested; `waitUntil` behaviour needs a preview-deployment spike and a disposable Postgres.
- `WHATSAPP_BRIDGE_KEYS` must be set in the Vercel env; the bridge must be aligned to the s7 contract.
- The bridge key is a trusted identity-asserting component; key custody matters.
- Free-text money is not redacted (M1 accepted risk).

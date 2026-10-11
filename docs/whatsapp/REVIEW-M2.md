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

## Preview-deploy checks (not verifiable locally; do these on a protected preview before activation)
1. `waitUntil` lifetime: ingest answers 202 and the turn runs after the response via the private Vercel request-context `waitUntil` (`lib/backgroundTask.ts`). Confirm on the deployed function (300 s `maxDuration` config) that a turn of realistic length (LLM + tools, up to ~90 s lease) completes after the response and is not frozen; check the log for the job reaching `done` and an outbox row. If the request-context lookup is absent the work is detached and may be cut.
2. Poll-restart backstop: kill/slow a turn (or stop it mid-way) and confirm a later `GET /wa/outbox` restarts a `received` accept job older than the restart delay, and that a `processing` job with an expired lease is reclaimed, up to `MAX_ATTEMPTS`, then fails with the neutral reply.
3. Public path: `req.originalUrl` must be the public `/wa/outbox?limit=N` (not the rewritten `/api/index`) through the `vercel.json` rewrite `/(.*) -> /api/index`. Send a correctly signed `GET /wa/outbox?limit=5` to the preview; expect 200. A 401 for a correctly signed request means the rewrite changed the URL. A unit test (`whatsappBridgeAuth.test.ts`) proves verification uses `req.originalUrl` incl. query and that other path/query fails, but not the Vercel rewrite itself.

## Fix round 1 (Codex review: CHANGES REQUIRED)
| Commit | What |
|---|---|
| (see `git log`, message starts "M2 fix 1: migration") | **MIGRATION (own commit, "M2 fix 1: migration")**: `20261011140000_whatsapp_queue_and_channel` creates `WhatsappInbound`, `WhatsappOutbox`, adds `AgentConversation.channel` + `(userId, channel)` index. SQL from offline `prisma migrate diff` (old schema e141444 -> current schema), minus the nonce table already migrated. Not applied anywhere; coordinator to run `migrate deploy` on a throwaway Postgres. |
| M2 fix 2 | Atomic claim: `claimJob` runs in one transaction under `pg_advisory_xact_lock`; checks earlier jobs and live leases for the sender plus a count of live `processing` leases (cap `MAX_CONCURRENT_TURNS` = 2). Expired leases stop counting, so a crashed worker's slot is reclaimable; no slot table, no extra migration. Stores are now factories (`createPrismaBridgeStore`, `createPrismaNonceStore`) with the old singletons kept. |
| M2 fix 3 | `Idempotency-Key` required on ingest (must equal `messageId`), claim and ack: 1-128 visible ASCII, else 400 after auth. DISCOVERY s7 updated. |
| M2 fix 4 | Preview-deploy checks section above + originalUrl signing test. |

Tests: API 256 total / 251 pass / 0 fail / 5 skipped (the opt-in Postgres file); admin-web 35 pass. New: 3 claim tests (same-sender block, cap of 2, expired lease reclaim), 1 idempotency-key test, 1 originalUrl signing test, 5 skipped pg tests.

Opt-in Postgres test (`apps/api/test/whatsappBridgeStore.pg.test.ts`, skipped unless `WA_PG_TEST_URL` is set; NOT run by us): point it at a throwaway, already-migrated database and run from `apps/api`:
`WA_PG_TEST_URL=postgresql://... node --import tsx --test test/whatsappBridgeStore.pg.test.ts`
(PowerShell: `$env:WA_PG_TEST_URL='...'; node --import tsx --test test/whatsappBridgeStore.pg.test.ts`). It covers insert + message-id dedup, per-sender claim ordering and lease reclaim, the cap of 2 under `Promise.all` claims, outbox lease/claim/ack transitions and nonce insert/replay, and deletes its own rows. The cap test assumes no other WhatsApp jobs are running in that DB.

Deferred: free-text money redaction and real-Postgres site-scope checks (M1); rate limits/daily cap (DISCOVERY s6); preview-deploy verification above; bridge alignment to the rev6 contract and key provisioning.

Risks: migrations still unapplied and prod history drifted; the advisory-lock SQL is only covered by the opt-in test, never run; a blocked claim (cap or ordering) leaves the job `received` and relies on the poll-restart backstop to retry it, so latency under load can reach the restart delay; `hashtext` lock key is global to the database.

### Throwaway-Postgres verification (coordinator, 2026-10-11 ~11:35 IST)

- Where: a disposable PostgreSQL 17.11 instance on the coordinator's own Linux box (not the PC, not production, not Supabase), database `wa_throwaway`, created fresh. Source = `git archive` of feat/whatsapp-m2 at 695f87b (no .env present), `npm ci`, shared build, `prisma generate`.
- `npx prisma migrate deploy` (Prisma 5.22.0) with DATABASE_URL and DIRECT_URL both pointing at the throwaway DB: all 35 migrations applied from scratch, exit 0; `_prisma_migrations` 35/35 finished, none rolled back.
- Drift check `prisma migrate diff --from-url <throwaway> --to-schema-datamodel prisma/schema.prisma --script`: no WhatsApp differences (WhatsappInbound, WhatsappOutbox, AgentConversation.channel, sender mapping and nonce tables all match schema.prisma). The only diff is a PRE-EXISTING, unrelated one: `PaymentReceived_invoiceId_fkey` is re-created with ON DELETE SET NULL ON UPDATE CASCADE (schema vs migrations disagree on that FK; not introduced by M2; worth reconciling when production migration history is fixed).
- Opt-in test `WA_PG_TEST_URL=... node --import tsx --test test/whatsappBridgeStore.pg.test.ts`: 5/5 pass (insertInbound dedup, per-sender ordering + lease expiry, cap of 2 under 5 concurrent claimers, outbox lease/claim/ack transitions, nonce replay), repeated 6 times with no failures; afterwards WhatsappInbound/WhatsappOutbox/AgentConversation row counts were 0 (cleanup works).
- Note: claimJob uses pg_advisory_xact_lock (transaction-scoped), which is compatible with the transaction-mode pgbouncer pooler used by DATABASE_URL; it serialises all WhatsApp claims globally, acceptable at pilot volume.
- Still not verified: production/Supabase migration history (drifted, unapplied), Vercel preview checks (waitUntil, req.originalUrl).

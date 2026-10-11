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

### Fix round 2

- Claim and ack now require EXACT Idempotency-Key values: `claim:<outboxId>` and `ack:<outboxId>:<status>` (status = ack body status). Missing, malformed or mismatched is 400 after auth (`apps/api/src/routes/whatsappBridge.ts`). DISCOVERY s7 updated.
- Bridge `internal/zan/client.go` already sends exactly these values (covered by `zan_test.go`); no bridge change.
- Tests: new test for match / wrong id / wrong status / missing on claim and ack. API 257 total / 252 pass / 0 fail / 5 skipped (opt-in Postgres); admin-web 35 pass. `.claude-task/check.ps1` all steps OK.
- Commit: see `git log` ("M2 fix round 2: exact claim/ack Idempotency-Key").

## Preview-deploy plan (draft)

Goal: run the three preview checks (originalUrl through the rewrite, `waitUntil` completing a turn, claim cap/ordering under load) without touching production. Nothing here has been done.

### Rules
- The preview uses a SEPARATE database, never the live one. No production data is copied; only the schema is loaded.
- Vercel env today (project `zan-app-api`) is Production-only, so a Preview deployment gets no values. Preview needs its own, scoped to Preview only: `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET` (new random value), `AGENT_SECRETS_KEY` (test value), `WHATSAPP_BRIDGE_KEYS` (a test key, e.g. `previewkey:<32+ random chars>`). Google/SMTP/CRON values stay unset.
- The agent needs an LLM provider row in the preview DB: either a provider with a cheap test API key (encrypted with the preview `AGENT_SECRETS_KEY`) or a fake/stub provider endpoint. Use a cheap model and a spend cap.
- Deployment Protection: preview URLs return Vercel's login/401 page unless the request carries the protection-bypass header (`x-vercel-protection-bypass: <secret>`, from Project Settings > Deployment Protection > Protection Bypass for Automation) or a logged-in Vercel session. Keep that distinct from our own 401 `{"error":"Unauthorized"}`: the HTML page means protection, the JSON means our signature check.

### Database options
| Option | Cost | Steps | Notes |
|---|---|---|---|
| Supabase branch | Not available on the Free plan. Pro $25/mo + $0.01344/h per branch | Upgrade, create branch, copy its URLs | Branch would carry schema from migrations only if configured; also needs a plan change. Not recommended. |
| New free Supabase project | $0 | Pause one of the 2 active projects (`zan-app`, `platino-recd-mumbai`) to free a slot, create project, copy pooled + direct URLs | Pausing a live project is a real risk. Not recommended. |
| Neon Free | $0, no card, 1 GB per project, 100 CU-h/month, scale-to-zero after 5 min | Create project + database, copy pooled and direct strings | Reachable from Vercel; first request after idle has a cold start (retry once). **Recommended.** |
| Local/box Postgres | $0 | Already used for store tests | Fine for `whatsappBridgeStore.pg.test.ts`; unreachable from a Vercel function, so useless for the preview checks. |

Recommendation: Neon Free. It is the only free option reachable from Vercel that does not require pausing a live project or changing the Supabase plan, and a throwaway project can simply be deleted afterwards.

### Load the schema (empty DB, no prod data)
From `apps/api` on the PC or box, with the Neon strings in that shell only (never committed or printed):
1. `DATABASE_URL=<neon pooled> DIRECT_URL=<neon direct> npx prisma migrate deploy` (PowerShell: set `$env:DATABASE_URL`, `$env:DIRECT_URL`). All 35 migrations apply to the empty DB, creating the WhatsApp tables and `AgentConversation.channel`. Confirm the URL is the Neon one before running; never run this against Supabase prod.
2. Minimal seed (SQL or a throwaway script, not committed): the roles/permissions rows the app needs (`npx prisma db seed` against the preview DB only, if the seed script is safe for an empty DB), one active admin `User`, one LLM provider row, and one `WhatsappSenderMapping` for the test sender (`userId` = that admin, `phoneE164` e.g. `+910000000001`, `enabled` true, `aiPaused` false, `verifiedById`/`verifiedAt` set).
3. In Vercel set the Preview-scoped env values above, push or deploy the branch as a preview (needs Ferose's approval), note the preview URL and the bypass secret.

### Signed test requests with no WhatsApp
`apps/api/scripts/waSignedRequest.ts` builds the canonical string with the same helpers as the server (`signBridgeRequest`, `sha256Hex`), reads the key from env, sends one request and prints status + body. It never prints the secret. Env: `WA_BASE_URL`, `WA_KEY_ID`, `WA_KEY_SECRET`, optional `VERCEL_BYPASS_SECRET`.

```
npx tsx scripts/waSignedRequest.ts GET "/wa/outbox?limit=5"
npx tsx scripts/waSignedRequest.ts POST /wa/ingest '{"messageId":"m1","senderJid":"910000000001@s.whatsapp.net","chatJid":"910000000001@s.whatsapp.net","timestamp":1790000000,"text":"hello"}' --idem m1
```
(`timestamp` is the message time in Unix seconds; use the current time.) Claim and ack: `POST /wa/outbox/<id>/claim '{}' --idem claim:<id>` and `POST /wa/ack '{"outboxId":"<id>","status":"sent","at":<unix>}' --idem ack:<id>:sent`.

### Check 1 - originalUrl through the rewrite
1. Signed `GET /wa/outbox?limit=5` -> expect `200 {"items":[...]}`. A JSON 401 means the rewrite changed `req.originalUrl`.
2. Same request but signed over the internal path: `... GET "/wa/outbox?limit=5" --sign-path /api/index` -> expect `401`. (Also try `--sign-path "/wa/outbox"` without the query -> `401`.)

### Check 2 - waitUntil completes a full turn
1. Signed `POST /wa/ingest` from the mapped test sender (command above). Expect `202 {"decision":"accept"}` immediately; a second identical call returns the same decision with no second job.
2. Poll `GET /wa/outbox?limit=5` (signed, fresh nonce each time) every 5 s for up to ~90 s (the lease) until an item appears. Budget: the turn is capped at 55 s, so an item should appear well within 90 s.
3. Claim it (`200 {text, sendBy}`), then ack `sent` (`200 {ok:true}`); a second claim returns 409.
4. Check Vercel function logs for the ingest invocation: the turn finished after the 202 response, the job reached `done`, no "function frozen/timed out". If no item appears but a later poll produces one, `waitUntil` did not keep the turn alive and the poll backstop did the work: record that as a finding.

### Check 3 - lock/ordering behaviour under load
1. Add 3 more mapped test senders (or use 3 distinct mappings), then fire 4 ingests at once from 4 different senders (`&` in a shell or `Promise.all`). Watch the DB (`SELECT status, count(*) FROM "WhatsappInbound" GROUP BY 1`) every second: at most 2 rows `processing` at any moment; the others stay `received`.
2. Fire 2 ingests from the SAME sender at once: the second must not start until the first is `done`; replies appear in message order.
3. Blocked jobs are not errors: they stay `received` and are picked up by the next outbox poll (within the 20 s restart delay). Confirm all 6 jobs end `done`/produce outbox rows, and the logs show no errors other than expected claim misses (409 on a double claim, claim returning no job).
4. After the run, delete the preview project/DB and the Preview env values.

## Fix round 3 (Codex review: CHANGES REQUIRED)
- High: the false claim that Prisma wraps each PostgreSQL migration in a transaction is removed. Each of the 3 unapplied WhatsApp migrations now has its own `BEGIN;` / `SET LOCAL lock_timeout = '5s';` / `COMMIT;`. The "mark rolled back and retry" step is replaced by a mandatory read-only catalog inspection first (`docs/whatsapp/MIGRATION-RECONCILE.md` section 6).
- RLS + `REVOKE ALL ... FROM anon, authenticated` are folded into each creation migration (4 tables, no unprotected window); the separate `20261011150000_whatsapp_enable_rls` is removed (never applied). Note: the REVOKE needs the `anon`/`authenticated` roles, which exist on Supabase but NOT on a plain Neon preview database; create them there first (`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;`) or the preview migration fails.
- The reconcile doc accounts for the renamed `20261011110000_enable_rls_public_tables` (fix/enable-rls): apply it first, merge master, `migrate status` must not list it; the 15-object precheck is re-run immediately before reconciling.
- `.gitattributes` added (identical to fix/enable-rls): LF for `*.sql`, applied migration folders byte-exact.
- `waSignedRequest.ts` now refuses production: only `http://localhost` / `127.0.0.1` and `https://*.vercel.app` except `zan-app-api.vercel.app`; checked before signing or sending (`test/waSignedRequestHost.test.ts`). Limitation: a prod deployment-specific `*.vercel.app` URL cannot be told apart from a preview URL by name; use only preview URLs.

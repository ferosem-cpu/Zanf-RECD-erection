# Zan-APP - Handover (compact)

Role-based Project & Service Tracker + Finance/Accounting app for ZanF (`zanf.org`), which makes and
installs RECDs (Retrofit Emission Control Devices) for diesel gensets. Tracks the SITC flow: Supply,
Installation, Testing, Commissioning. Cloned from Platino on 2026-07-19 and NOT kept in sync with it.
Full pre-compaction handover (changelog, per-fix narratives): `git show 649ca2a:docs/HANDOVER.md`.
Agent QA: `docs/agent-test-checklist.md`. History: `git log`.

## 1. Production state (2026-10-22)
- API = `dpl_G84WARJE6RR1amJ6J1jwxYAHvU2D` (22 Oct 2026, from master after merging `feat/vendor-payment-detail`
  and `fix/agent-tuning-split-site-confirm`). Adds vendor payment detail drawer, optional TDS (amount +
  certificate ref) and attachments on vendor payments (section 7 TDS rule). Rollback target:
  `dpl_FL2AzQKMMTE9S8zZsfu67VDyrcuo` (needs no DB rollback: the migration is additive). admin-web = master push.
  Pre-migration backup: `D:\Backups\zan-db\json-20261022-1430` (finance tables + `_prisma_migrations`).
- API = `dpl_FL2AzQKMMTE9S8zZsfu67VDyrcuo` (19:46 IST, Oct 16 2026, from branch
  `fix/agent-tuning-split-site-confirm` commit `ef2a92c` on top of the deployment below). Adds: receivables /
  invoice search return each invoice's own site (`agent/invoiceSite.ts`); `create_invoice` lines accept
  `splitTotal` + `splitPct` and the app computes the amounts (`agent/lineSplit.ts`); prompt rules against
  "no tools" give-ups. Rollback target: `dpl_2x3jbxyvZccZSjM8gt3tNTtKKWqg`.
  Deploy gotcha: patch EVERY `*.func` recursively (there are two: `functions/index.func` and
  `functions/api/index.func`) and write `.vc-config.json` WITHOUT a BOM (`Set-Content -Encoding UTF8` adds one
  and `vercel deploy` fails "Unexpected token" before uploading).
- Previous API = `dpl_2x3jbxyvZccZSjM8gt3tNTtKKWqg` (17:24 IST, Oct 16 2026): master code (`182517e`, same as `5c3dbc6`)
  plus 3 agent fixes from branch `deploy/agent-fixes-on-prod` (not yet merged to master): Gemini fallback
  accepts tool calls made by another provider (placeholder thought signature); `create_invoice` reuses
  HSN/SAC from earlier invoices, "Extra ..." lines default to the fabrication code (section 6); prompt no
  longer asks for HSN up front. Rollback target: `dpl_49cApBVUavTvvbZxDwFpo6X3AqQ5` (logo egress, `5c3dbc6`,
  20:47 IST Oct 11); before that `dpl_8ai5M6GjkauRGno4byPe9xh6sb1j` (fix 14).
- admin-web auto-deploys from master (`app.zanf.org`): `dpl_EnkCXpEgppRFudaP1ey8mJ9d14HX` (20:48 IST,
  Oct 11). Rollback: `dpl_47SeBbfRbSMzJhfa3hte2orzQzkS`. API is deployed manually (section 5).
- 2026-10-11 RLS fix: RLS on + anon/authenticated grants revoked on the 25 public Zan tables
  (migration `20261011110000_enable_rls_public_tables`, applied in prod with its history row; ebiz
  tables untouched). Runbook: `docs/SECURITY-RLS.md`. Pre-change JSON backup (64 tables, 1,263 rows,
  `grants-before.json`, emergency-only `rollback-exact.sql`): `D:\Backups\zan-db\json-20261011-1725\` (private ACL).
- 2026-10-11 logo egress fix live (section 2): stored logo shrunk 2.45 MB -> 52 KB PNG (md5 of data URL
  `ed0fa8e6...`); original kept at `D:\Backups\zan-db\logo-original.png`.
- WhatsApp assistant: M1/M2/M3 on local branches `feat/whatsapp-m*` (+ bridge `D:\Apps\zan-wa-bridge`),
  reviewed, NOT merged/deployed/migrated. Next: Neon preview DB trial.
- Agent/session handover: `.claude-task\HERMES-HANDOVER.md` (local only, not committed).
- Repo `github.com/ferosem-cpu/Zanf-RECD-erection`, branch `master`. Local ports: API 4011, web 6011.
- DB: Supabase `zan-app` (`ap-south-1`). Vercel team `ferose-salahudeen-s-projects`; CLI user
  `ferosem-1321`. Projects `admin-web` (git-connected) and `zan-app-api` (`bom1`, `zan-app-api.vercel.app`).
- Primary Super Admin `ferosem@gmail.com` is Google-only (`apps/api/src/lib/authPolicy.ts`).
- Local `.env` has real Zoho SMTP creds: local smoke tests send real mail. Never read/print env files.

## 1a. WhatsApp M2 test status (branch `feat/whatsapp-m2`, 2026-10-24) - deployed to prod 24 Oct

- **24 Oct ~22:50 IST - current:** M6 mapping `wamap_m6_pilot2` (second pilot number) LIVE; reply test PASS (1 reply, no double). Answer was wrong ("4 work orders assigned to you today", real 0): search_work_orders gave managers all WOs, no date filter. Fix branch `fix/agent-my-scope` @ `3686698` (pushed; not deployed/merged): `assignedToMe` on search_work_orders + search_complaints, IST `scheduledFrom/scheduledTo` on WOs, `scope: assigned_to_you|all` in results, prompt rule; test/agentMyScope.test.ts (6); tsc clean, 327/333 (6 pg skipped), build OK; awaiting ChatGPT Coder. UI branch `feat/whatsapp-mappings-ui` @ `3230801` = PASS to merge (no deploy). Carried: mapping audit row; shared ROLE_GROUP; atomic add+enable; bridge Reachable 2xx-only; secfile open+fstat.

- **DEPLOYED to prod 24 Oct 2026 18:31 IST:** `0bd2927` (prebuilt) -> zan-app-api `dpl_J2JubBX4Scxb1wBmdRSGS6r3H3dU`; Fluid on, `WA_FUNCTION_MAX_DURATION_MS=300000`, api/index.func maxDuration 300; no migrate deploy; smoke OK. Rollback target: `dpl_GsgEcqiaH1mktzs91Ge6Be89dcVD` (zan-app-1rc18sg1t). Prod `WHATSAPP_BRIDGE_KEYS` unset until M5.
- **Condition 4 DONE 24 Oct 2026 (Ferose OK 18:43 IST):** Neon test DB: deleted 13 outbox (incl. leased), 14 inbound, 39 nonces, 1 WA channel conversation, 1 sender mapping (`watest_map_*`), 2 test LLM providers (`watest_llm_freellm`, `watest_llm_freellm_auto`); 11 `patest-*` inbound + 1 outbox (pg-test leftovers) left. Live Supabase had 0 test rows (4 real providers untouched). Removed 20 `feat/whatsapp-m2` previews of Vercel project `api` (incl. `dpl_8qDxVgvTsDMiGrY3qQUFnnnQ2pCS`) and Preview env `WHATSAPP_BRIDGE_KEYS`, `AGENT_SECRETS_KEY`; 20 older (12 Oct) branch previews and the Neon project left.
- **patest/old-preview cleanup DONE 24 Oct 2026 (Ferose OK 18:53 IST):** Neon: deleted 11 `patest-*` inbound + 1 outbox (now 0/0). Vercel `api`: deleted 56 old (12 Oct) `feat/whatsapp-m2` PREVIEW deployments; 1 old branch Production-target (errored) deploy of `api` and today's fresh branch preview kept. zan-app-api untouched; app.zanf.org + /health 200.
- **AI keys 24 Oct 2026:** new Gemini key given to Gemini Coder (CLI verified). Free LLM API key unchanged (primary `gemini-3-flash-preview`, backup `auto`). OpenAI + NVIDIA keys not rotated.
- Open (AI keys): paste new Gemini key into Zan app AI settings, then revoke the old one; disable OpenAI + NVIDIA keys if unused.
- **M5 (WhatsApp bridge on OCI) PLANNED 24 Oct, ChatGPT Coder PASS; nothing installed.** Target VM-A (freellmapi-vm, Always Free). Bridge `D:\Apps\zan-wa-bridge` @ `5b9c93a`.
  Steps: 1 trusted-bridge risk sign-off; 2 build binaries + record hashes; 3 read-only VM-A recheck; 4 install (not started); 5 prod `WHATSAPP_BRIDGE_KEYS` with Ferose OK, all mappings off; 6 QR pairing with Ferose; 7 start service + health, MemoryMax, router check; 8 log everything.
  ChatGPT Coder conditions: private repo push first, deploy only hash-matched binary; session store owned by zan-wa, 0600, no bodies/full numbers in logs; DB nonce store (WhatsappBridgeNonce, confirmed); optional Vercel Firewall rule VM-A IP only on /wa/* (needs Ferose OK); systemd MemoryMax; spare number safer than the main number (ban risk).
  Free API bot: keep a direct Gemini provider in the app as fallback independent of VM-A; at step 7 check router still answers in ~3 s.
- **M5 Ferose answers 24 Oct 19:39 IST:** SSH to VM-A with freellmapi_key: yes. Pair number: the main number, the MAIN number (Ferose's choice; accepts ban risk). "I accept the trusted-bridge risk" (step 1 DONE).
- **M5 steps 2-4 DONE 24 Oct (~19:50 IST):** bridge pushed to PRIVATE https://github.com/ferosem-cpu/zan-wa-bridge @ `5b9c93a`. Built linux/amd64: `zan-wa-bridge` sha256 `80289896fbaf33027dfb47f199b49860d7f6a71effa65b21b45a0fef6de2a7c2`, `zan-wa-pair` `e3727c8aaa6edfccbb01eb77c40c18ae656817503eb5a9b91407da0d3d09e4fd` (hashes match on VM-A).
  VM-A recheck: Ubuntu 24.04.4 x86_64, 952 MB RAM (~600 MB avail), 38 GB disk free, systemd 255, caddy+docker active, FreeLLMAPI healthy before and after. Installed per deploy/README: user zan-wa, /var/lib/zan-wa-bridge 0700, bridge.env (base URL zan-app-api.vercel.app, key id `zanf-oci-1`), bridge.key generated on VM (root 0600, never printed), unit with LoadCredential + MemoryMax=150M installed, NOT enabled/started. zan-wa-pair NOT run.
  Gap (no code change): bridge has no local allowlist; every 1:1 text is POSTed to Zan, which returns ignore for unmapped senders (row kept with text NULL, no reply); bridge clears its local text after (store/state.go:158). On the main number this sends all personal 1:1 texts to Zan; needs a decision before step 7.
- **Allowlist DONE 24 Oct (~20:45 IST):** bridge `4763cd7` (private repo): default-deny sender allowlist from `ZAN_BRIDGE_ALLOWLIST_FILE` (root 0600 via LoadCredential; refused if group/other readable; numbers never in repo); E.164 exact match on the real phone (LID resolved via alt id/mapping store, unresolved dropped, display name never used); dropped at Classify before body read, ingest, logging or disk. Go tests all pass (56 PASS, 1 Windows-only skip; perm test passes on Linux). New linux/amd64 SHA-256: zan-wa-bridge `aa5eb97fc9b5264646be81be90382d4c0d04acc7af503f138bf9f230a2c7a0fd`, zan-wa-pair `c20bbfca6e067d426c62179e190bffb6639ce60afe03f5d2f1f4262c01a458d1` (pair rebuilt, not reinstalled). VM-A: bridge binary installed + hash verified, unit updated with allowlist credential (systemd-analyze clean), EMPTY allowlist root 0600 created; service still disabled + inactive. Zan `feat/whatsapp-m2` `4930f5a`: ignored (unmapped/disabled/paused) senders now store NO inbound row; duplicate of an accepted msg still returns accept; test added; typecheck clean, 321/327 pass (6 pg skipped). Not deployed. Next: Ferose adds staff numbers (+E.164, one per line) to the allowlist file before pairing.
- **zan-wa-pair updated 24 Oct (~20:20 IST):** VM-A `/usr/local/bin/zan-wa-pair` replaced with the `4763cd7` build, SHA-256 `c20bbfca6e067d426c62179e190bffb6639ce60afe03f5d2f1f4262c01a458d1` (PC build, upload and installed copy all match; root:root 0755; temp copy removed). Not run; service still disabled + inactive; no zan-wa processes.
- **Prod step 24 Oct (~21:15 IST), Ferose OK:** VM-A `/etc/zan-wa-bridge/allowlist` now holds the 2 pilot staff numbers (root:root 0600, 2 valid E.164 lines; numbers kept out of repo/handovers). `WHATSAPP_BRIDGE_KEYS` added to zan-app-api Production as Secret (`{"zanf-oci-1":...}`, piped from VM-A key, never printed/written; first attempt had a stray CR so it was removed and re-added clean). Prod redeployed from `feat/whatsapp-m2` (incl. `4930f5a`) via §5 flow: new `dpl_3HnBCCgDovDmKtqtnDQjqrVsXUDB` (READY, aliased), env set before deploy so it is live. Rollback target `dpl_J2JubBX4Scxb1wBmdRSGS6r3H3dU`. Smoke: /health 200, app.zanf.org 200, /agent/providers 401, bad login 401, unsigned /wa/ingest + /wa/outbox 401. Service still disabled + inactive; not paired; no Zan number mappings enabled (M6 needs its own OK).
- **Pairing notes (Ferose):** main number has 1 linked device so far (WhatsMeow), so there is room for the bridge. WhatsMeow and WhatsApp Handler do not auto-reply. At step 7 test first from pilot staff number 2, then number 1.
- **Pairing DONE 24 Oct 21:31 IST (Ferose present):** bridge linked to the main number as a separate linked device (WhatsMeow untouched); `zan-wa-pair check` = authenticated connection verified; pair process stopped, QR files deleted.
- **Step 7 BLOCKED 24 Oct ~21:35 IST:** service enabled+started but crash-looped (4 restarts in 65 s, exit 1): bridge's strict 0600 check rejects the key and allowlist that systemd LoadCredential exposes read-only with group read. Service stopped + DISABLED again; FreeLLMAPI unaffected (200 in 0.6 s); no traffic, no WhatsApp reply. Checks 2-4 not run. No mappings on.
- **Step 7 fix + rerun 24 Oct ~21:47 IST (Ferose OK):** ChatGPT Coder PASS on bridge `7cb622d`; fast-forwarded into `main` (same commit, so same hash). Installed to `/opt/zan-wa-bridge/zan-wa-bridge` (the unit's ExecStart), sha256 `0266a1aa0d01ca74a1760dbaea25426e5fd11bcbee338a319734efd5c303c24a` verified on VM-A; pair not reinstalled. Service ENABLED + ACTIVE, 0 restarts, ~65 MB (MemoryMax 150M); `/healthz` ok; `/status` whatsapp connected, zan reachable (signed /wa/outbox polls succeeding; fresh `zanf-oci-1` nonces on prod), queue 0; FreeLLMAPI 200 in under 0.6 s. Prod: 0 sender mappings (all OFF), 0 inbound, 0 outbox rows.
- **M5 DONE 24 Oct ~22:00 IST (ChatGPT Coder step 7 PASS).** Phone tests: allowlisted pilot -> `ingest_ignored` 1 (no reply), unlisted -> `dropped_not_allowlisted` 1 (no body/number); prod WhatsappInbound + WhatsappOutbox 0; NRestarts 0; RSS ~31 MB. Service stays enabled + active.
- **M6 update 24 Oct ~22:30 IST (Ferose OK t124u):** test mapping for the second pilot number -> Zan user "Grok Bot" (management, now active, stale customerId cleared with Ferose's OK). All API checks replicated read-only and PASS (active, no customer/vendor, role has WhatsApp access, normalised E.164, no existing mapping for phone or user). Guarded INSERT (id `wamap_m6_pilot2`, enabled) + rollback SQL sent for ChatGPT Coder review; NOT executed yet. Route writes no audit row.
- **Mapping admin screen:** branch `feat/whatsapp-mappings-ui` @ `3230801` (off feat/whatsapp-m2, pushed, not deployed): Settings > "WhatsApp numbers" (super_admin + manage_settings) using existing /whatsapp/mappings API: list, add (+ switch on now), enable/disable, pause/resume AI, remove. admin-web tsc clean, 42/42 tests (4 new), next build OK. Awaiting ChatGPT Coder review.
- **Carried item 1 (FreeLLMAPI latency, bridge running, ~21:58 IST):** 5 calls all 200: 0.30, 0.09, 0.09, 0.09, 0.09 s (earlier max 1.3 s).
- **Carried item 2 ("zan reachable" = signed 200):** reachable flag alone is NOT proof (client.go sets lastOK on any HTTP response, even non-2xx). Proof instead: Zan stores a `WhatsappBridgeNonce` row only after the HMAC verifies (whatsappBridgeAuth.ts:97-98); prod had 32 fresh `zanf-oci-1` nonces 16:17-16:28 UTC, bridge journal has no warn/error/non-2xx since start, and ingest returned 2xx `ignore`. Vercel runtime logs: MCP 403, CLI returned 0 records (not available on this plan).
- Follow-ups: secfile open+fstat; Lstat on non-creds path; optionally make `Reachable` count only 2xx.
- **Follow-ups (ChatGPT Coder, non-blocking):** (1) secfile check-then-ReadFile race -> open + fstat on the same fd; (2) non-creds path uses Stat (follows symlinks) -> Lstat.
- Branch merged with master (24 Oct): 38 migrations. **No prod deploy / `prisma migrate deploy`** until the
  15 Aug `_prisma_migrations` rows on prod are reconciled.
- Conditions: 1 lock-contention PASS; 2 real Go signer (M4) PASS incl. claim/ack; 3 DONE on prod (3 WA history
  rows only, now 23; schema backup `D:\Backups\zan-db\20261024-1545`); 5 DONE on Neon (primary
  `gemini-3-flash-preview`, backup row `watest_llm_freellm_auto` model `auto`, priority 1 - no fallback-model column).
  (Was open, now DONE - see top) 4 = clean up `watest*` keys/rows (incl. `watest_llm_freellm_auto`, `watest-*` inbound/outbox) and test previews.
- Pre-M6 fixes DONE: `(createdAt, id)` claim tiebreak; chain next queued turn after `completeJob` (max 3);
  order/invoice/site questions must use lookup tools this turn; 413 falls through to the next provider.
- Chain guard (runs under `waitUntil`, no `maxDuration` set): chains only if elapsed + 55 s turn budget + 5 s
  fits `WA_FUNCTION_MAX_DURATION_MS` (default 60 s).
- maxDuration: Ferose OK'd 300 s. `apps/api/vercel.json` sets `api/index.js` maxDuration 300 (needs Fluid Compute on zan-app-api). At prod deploy also set env WA_FUNCTION_MAX_DURATION_MS=300000; until both are live, immediate chaining stays off.
- migrate diff (prisma@5) vs 1545 DDL backup, restored to scratch PG17: only DROP TABLE company_settings / employees after FK fix.
- company_settings and employees are on live OUTSIDE Prisma: LEAVE THEM ALONE. Never generate or apply a migration that drops them.
- PaymentReceived.invoice FK aligned to live: schema now `onDelete: Restrict` (no migration needed; live already RESTRICT).
- Test setup: Neon test DB "whatsapp bridge" (ap-southeast-1); preview `dpl_8qDxVgvTsDMiGrY3qQUFnnnQ2pCS` with
  per-deployment `-e` overrides only (no project env changes); test LLM FreeLLMAPI router. Packaging:
  `npm run vercel:patch` between `vercel build` and `vercel deploy --prebuilt`. Test secrets only on the box.
- `whatsappBridgeStore.pg.test.ts` needs `WA_PG_TEST_URL` and TCP 5432 (box blocks 5432; run from the PC).
- **August migration history reconcile: APPLIED on live 24 Oct 2026 5:15 PM IST (Ferose OK).** Pre-check: live had 23 rows, none of the 15, all 18 August tables present, 15 checksums matched git. After: count 38. Next: `migrate diff` against live/restored DDL must be empty before any prod deploy (needs PC).
  Finding: the 15 Aug migrations with no live `_prisma_migrations` row are all fully applied on live (250 objects checked
  read-only: columns, unique indexes, constraints/FKs, `BackupMethod` enum, seeded permissions, Bill default, RLS). Fix is
  history rows only: 23 -> 38 (= all 38 migrations on master + this branch). SQL: [`docs/sql/2026-10-24-august-history-reconcile.sql`](sql/2026-10-24-august-history-reconcile.sql).
  Count guard added in 2216ae1: a `DO $$ ... RAISE EXCEPTION` before `COMMIT` rolls the transaction back unless the count is 38. ChatGPT Coder PASS on 37d96ea (condition 1) and 2216ae1. Applied (see above).

  | Migration | SHA-256 (LF, as git stores) |
  |---|---|
  | `20260813122825_add_product_shape_dimensions_weight` | `85af69e0dae7582cf8aafe8f1e5ed4205879379657c1bd6dafcf9cfd505e7e60` |
  | `20260817000000_add_vendor_archive` | `94d6fe1fad2600ebde6cd2c07b75c6a09ac91f437ce27395be0a7f2ff0a92db9` |
  | `20260817120000_add_order_line_items` | `696f3194401ea455d082b94392a3eb46266840690bdc2507d7f98d1885ec04ed` |
  | `20260822155035_add_agent_custom_instructions_and_saved_line_items` | `3a6e387ad23b2c5ceb0a16a9d08eb0f00d409a2d0becc849d7491f4ccf636d63` |
  | `20260823065413_add_customer_product_and_saved_item_pricing` | `ab38d6cdfbb47cb47b387d0fbdc1abcec1cf232e0e2fa477ba542e627a924efb` |
  | `20260823134430_add_product_silencer_type` | `aa6aef2a9651069c200c762155e3e1a24154f2d1a1f2bb860ef2debc5b3656ba` |
  | `20260824062957_add_work_order_products` | `fca21511919867779465da18e37d07439a8d25d3a84d903fc72ac3a894c75b60` |
  | `20260827034238_add_vendor_invoice_workflow` | `973818a01c00cb1b29ca89ff9bea6847716a106cdd92e4ea0d8432ae97c4b3a5` |
  | `20260827094832_add_supplier_pan` | `f5999c5d4e256aea4361b23f8e1a573ae748095d59c5fc1c27b9ec36323ae49f` |
  | `20260827144444_add_customer_purchase_orders` | `9e8b352d5e85096902440d8ffda1458eb33b6e140c81d8b214420b945a0de4fb` |
  | `20260828111339_add_ledger_opening_balances` | `f517f85eec539d49f82b2a26fcac48362c46d40d76116dde4bba938ef4364d14` |
  | `20260828120209_add_credit_debit_notes` | `7a948b59796bff5442ad8b444cca157af7c00ee02fb5c2b60421be86af0ea7c4` |
  | `20260828160000_add_payment_allocations` | `7356bdbf9323894508ca617ffec65bc80a181c4aa8c3fa81c16cf9e3ff4a95ce` |
  | `20260828170000_add_payment_order_tag` | `f3228934b90494fcb9df4817298bf7e918096f2b7780a27dc69a4a410d64a1f1` |
  | `20260829054500_add_backup_settings_and_log` | `44ac8c2b138fe2c88527bae09b6cf31e9b6e769c8ad867b5808ebcdff427e590` |

  Bad checksums on 6 existing live rows (left alone; `migrate deploy` ignores checksums; optional fix needs its own OK from Ferose):
  `init`, `add_auth_and_settings`, `add_vendors` = hash of CRLF copy; `add_header_footer_contact_fields` = empty;
  `add_invoice_edit_log`, `add_notification_read_and_customer_order_fields` = correct hash truncated to 63 chars.
  Step order: (1) Ferose OK -> (2) re-run read-only checks -> (3) guarded insert in one transaction, count must be 38 else
  ROLLBACK -> (4) merge master after pre-M6 fixes (done 24 Oct, `141f8cb`) -> (5) `prisma migrate status` / `prisma migrate diff` against the LIVE
  schema (scratch DB restored from the `D:\Backups\zan-db\20261024-1545` DDL backup, or read-only against live; NOT the
  drifted Neon test copy) - diff must be empty -> (6) only then prod `prisma migrate deploy`, with Ferose's OK.

## 2. Architecture
- Turborepo/npm workspaces: `apps/api` (Express 5, Prisma 5, JWT 7-day bearer, routes/ services/ lib/
  agent/), `apps/admin-web` (Next 15 App Router, Tailwind), `apps/mobile` (Expo, never runtime-tested,
  leave alone), `packages/shared` (`@recd/shared`: Zod + constants, compiled to CommonJS `dist/`).
- "Data, not code": stages, roles, permissions, statuses, checkpoints are DB rows. Permissions are
  enforced client and server side; role sets in `apps/api/prisma/roleDefinitions.ts`. Prod never
  re-runs the seed: ship new grants as idempotent SQL migrations keyed by permission/role key.
- Super Admin is the only role with `manage_settings`; Owner/Admin and Management get all else.
- Vendors are tenant-isolated (`User.vendorId`/`Site.vendorId`); only erection engineers carry a
  vendorId; members of non-approved vendors are blocked. Customers have no password (e-mail OTP,
  need `User.customerId`); customers are created from the Customers page, not `/users`. Legacy
  `/auth/customer/*` and `/auth/otp/*` routes are live with no UI: do not delete unchecked.
- `apps/api/vercel.json` must not have a legacy `"builds"` array (silently skips `prisma generate`).
  Prisma binaryTargets include `rhel-openssl-3.0.x`. Print/PDF: verify with a real PDF render.
- Always include `Order.lineItems` in order/site queries. PATCH responses are thin echoes: reload
  with GET. Documents: gap-free numbers per FY (`nextDocumentNumber`); GST via `computeDocumentTotals`.
  Invoices: separate `DocumentSequence` counters `tax_invoice` (INV/) and `proforma` (PI/) per FY; the
  legacy shared `invoice` row is no longer used (left untouched). "Convert to tax invoice" creates a
  DRAFT tax invoice with `sourceProformaId` (unique: a proforma converts once). The number is taken at
  issue, in one transaction with the status change (no burnt numbers), with a validated `issueDate`
  (IST, current FY, not in the future, not before the proforma).
- Modules: Orders/Sites/SITC, Customers/Products/Vendors, Finance (quotations, invoices, POs,
  expenses, work orders, vendor bills), Accounting-Lite (ledgers, credit/debit notes, payments + TDS,
  GST aids), customer portal, notifications, reports, backups (Drive + Vercel cron).
- Crons (`apps/api/vercel.json`): conversation cleanup 03:00 UTC, scheduled backup 19:30 UTC. Both
  fail closed without `CRON_SECRET`.
- Company logo/signature (egress fix): `CompanySettings.logoDataUrl`/`signatoryDataUrl` are omitted from every
  Prisma query (global `omit`, preview feature `omitApi`, `lib/prisma.ts`); only `services/companyAssets.ts` reads them.
  `/settings` returns `logoUrl`/`signatureUrl` (`/settings/logo?v=<md5>`, hash computed in SQL). `GET /settings/logo` and
  `/settings/signature` are public, ETag + immutable cache, 10-min in-memory cache. PUT rejects an image data URL over
  300 KB (400); admin-web downscales to ~600 px PNG first. Never add the columns back to a `select`/response.
- Env vars (api): `DATABASE_URL`, `JWT_SECRET` (API throws at boot if unset), `CRON_SECRET`,
  `AGENT_SECRETS_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_DRIVE_*` (CLIENT_ID/SECRET/REFRESH_TOKEN/FOLDER_ID),
  `SMTP_*`, `EMAIL_FROM_ADDRESS`. admin-web: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

## 3. Build, test, local gotchas
- Before every push: `npm run build --workspace=packages/shared`; in `apps/api` `npx prisma generate`,
  `npx tsc --noEmit`, `npm run build`; in `apps/admin-web` `npx tsc --noEmit`, `npm run build`; root
  `npm test`. One-shot: `.claude-task/check.ps1` (local file, not committed).
- Tests: node:test via tsx, mocks only. Current counts: API 222, admin-web 38. New test files must
  be added to the app's package.json "test" script. Lint is not set up.
- Shared changes need a rebuild; a stale real copy in `apps/api/node_modules/@recd/shared` shadows the
  workspace link.
- Windows: Prisma EPERM on `query_engine-windows.dll.node` (stop the dev API / stray node.exe);
  `next dev` is broken, use `next build && next start` from inside `apps/admin-web`;
  `npm install <pkg>` crashes (hand-edit package.json, run bare `npm install`);
  `NODE_ENV=production` is set globally so `.npmrc include=dev` is needed; never `--prebuilt` admin-web.
- `pdf-parse` must be dynamically imported (static import crashed the API at boot). Express: literal
  routes before `/:id`. DELETE returns 204 empty. Field in state but no `<input>` is a common bug.

## 4. Database migrations
Prod migration history has drifted (DDL applied by hand via Supabase MCP). Never run
`prisma migrate deploy/dev` or `db push` against any database; write migrations only and flag them.
15 prod migrations (`20260813122825` ... `20260829054500`) have no `_prisma_migrations` row, so
`migrate deploy` would try to re-run them; backfill rows (SHA-256 of each `migration.sql`) first.
No migrations pending on master. `20261023120000_invoice_separate_sequences` (`Invoice.sourceProformaId`
+ seeds `tax_invoice`/`proforma` counters for 2026-27) was applied in prod BY HAND with its
`_prisma_migrations` row; never `prisma migrate deploy` on prod (the 3 WhatsApp migrations are unapplied there). `20261011110000_enable_rls_public_tables` (2026-10-11) and
`20261022120000_vendor_payment_tds_attachments` (2026-10-22: `PaymentMade.tdsAmount`/`tdsCertificateRef`,
`PaymentMadeAttachment` with RLS on, anon/authenticated revoked) are applied with history rows. The 3 WhatsApp (`20261011120000`-`140000`, branch `feat/whatsapp-m2`) are NOT on prod; they sort BEFORE
`20261022120000`, so the reconcile must insert them out of order (manual apply + rows, never `migrate deploy`). Prod `DATABASE_URL` is a Sensitive Vercel var; use the Supabase connector.

## 5. Deploying
Backend first: deploy `zan-app-api` and confirm it live BEFORE pushing dependent admin-web changes
(admin-web goes live on master push). A same-push change crashed prod Sites on 2026-08-20.
Never deploy, merge to master or open a PR without Ferose's explicit approval.

**Manual API deploy** (PowerShell, from `apps/api`; write multi-line steps as `.ps1`, run with `-File`):
1. Stop the local API. `npx vercel whoami` must print `ferosem-1321`.
2. `npx vercel pull --yes --environment production`
3. `Remove-Item -Recurse -Force .vercel\output, dist -ErrorAction SilentlyContinue`
4. `npx vercel build --prod` run in the FOREGROUND (5-20 min, mostly `@vercel/nft` tracing). Do not
   background it or poll. Grep the output for errors afterwards.
5. Confirm the new code is in the output:
   `Select-String -Path .vercel\output\functions\api\index.func\apps\api\dist\<file>.js -Pattern "<new string>"`
6. Patch `@recd/shared` (workspace symlink does not survive tracing). For EVERY `*.func` under
   `.vercel/output/functions/`: (a) delete the `"filePathMap"` key from `.vc-config.json` if it
   mentions `@recd/shared` (else deploy fails ENOTDIR); (b) create `node_modules/@recd` and copy
   `packages/shared/dist` + `package.json` into `*.func/node_modules/@recd/shared` and, where it
   exists, `*.func/apps/api/node_modules/@recd/shared` (this can be run with `npm run vercel:patch` from apps/api);
   (c) create the local preflight junction:
   `New-Item -ItemType Junction -Path node_modules\@recd\shared -Target ..\..\packages\shared`
   (skip on Linux, the link exists).
7. `npx vercel deploy --prebuilt --prod` - run it ONCE; on failure stop and report, no retries.
8. Remove the junction: `(Get-Item node_modules\@recd\shared).Delete()` (never leave a real copy).
   If the build rewrote the lockfile: `git checkout -- package-lock.json` (tree must end clean).
9. Verify: READY; alias `zan-app-api.vercel.app` points at the new id; `GET /health` 200;
   `GET /agent/providers` without token 401 (not 404); bad-credentials `POST /auth/login` 401;
   `npx vercel logs <url>` clean. A 401 does not prove a brand-new route exists; rely on step 5.
10. Rollback: `npx vercel rollback <previous dpl id or url>` (or
    `npx vercel alias set <previous url> zan-app-api.vercel.app`); then report.

**Lessons from the 2026-10-16 deploy:**
- Dirty main tree (WhatsApp WIP had a changed `vercel.json` rewrite, `tsconfig.json`, `schema.prisma`)? Do not
  build it. `git worktree add D:\Apps\zanf-deploy -b <branch> <prod sha>`, cherry-pick only the fixes, `npm ci`,
  then run steps 2-9 from that worktree's `apps/api`. Build was 21 min cold, upload 52 s.
- `apps/api/.vercel/project.json` in the main repo links the project `api` (`prj_FsLs...`), NOT `zan-app-api`
  (`prj_yf9RGAw5mnBhJdVi9lDCJncdkrnS`, team `team_psJwhw81rjDAba1sPZSBqxzZ`). Write the right link before `vercel
  pull` and check `projectName` in `.vercel/project.json` afterwards.
- A production deploy came back BLOCKED (docs "team configuration") while HEAD was authored by
  `Claude <noreply@anthropic.com>`; the same tree redeployed fine once the commits were authored by the team
  member (no rebuild needed). Deploy only from commits authored by a Vercel team member. A BLOCKED deploy never
  takes the alias; stop the waiting CLI and do not retry blindly.

**Ignored Build Step:** `zan-app-api` has `commandForIgnoringBuildStep` = `exit 0` and an empty Root
Directory. Git-triggered builds failed "No entrypoint found"; setting Root Directory = `apps/api`
would make git builds succeed and auto-promote WITHOUT the step-6 patch, and clash with the
`apps/api/.vercel` link. Git builds therefore show "Canceled by Ignored Build Step" (expected);
`--prebuilt` deploys are unaffected. Merge flow: API deploy first, then push master.

**admin-web:** push to master, confirm `app.zanf.org` serves the new build (new string in shipped JS).
Fallback: `npx vercel deploy --prod` from the repo root (remote build).

## 6. In-app AI agent (`apps/api/src/agent/`)
- Chat bubble hidden until Super Admin enables roles in Settings > Agent Visibility (Customer toggle
  OFF in prod, deliberate). Needs a provider in Settings > Agent providers (`AgentLlmProvider`, keys
  AES-256-GCM with `AGENT_SECRETS_KEY`).
- Provider order: active rows by `priority` ascending (`providers/factory.ts`), with fallback. Prod rows seen in
  the runtime errors on 2026-10-16: `Free LLM API` priority 0 (model `auto` until 2026-10-16 evening, then set to `codestral-latest`: with `auto` the router (FreeLLM VM) first tried dead Google models (404 "no longer available") and Cohere (15 s abort), so a call took 16-23 s and hit our 25 s per-attempt cap; codestral answers in 1-5 s. The router has only one working route, so it can answer 429 "all models exhausted" when rate-limited), `Open AI `
  priority 1 (`gpt-5.6-luna`, out of credits, HTTP 429), `NVIDIA` priority 2 (timeouts; earlier HTTP 410, see
  section 8), `Gemini` priority 3 (`models/gemini-3.5-flash-lite`). Gemini URLs use native `:generateContent` for PDFs.
  A 410 provider is skipped 60 min, an out-of-quota 429 for 15 min (`providerHealth.ts`; cleared when the row is
  edited). Final error lists the primary's first. Gemini (OpenAI-compat) rejects a history containing tool calls it
  did not make (bare 400) unless each has a thought signature: `toOpenAIMessages` echoes the stored one and uses the
  placeholder `skip_thought_signature_validator` for calls from other providers (test `geminiForeignToolCalls`).
- Time caps in `timeouts.ts` (env-overridable): request 55 s, LLM call 30 s, 25 s per round when a fallback
  exists, max 8 tool turns. API 500 body `{error, errorId}`. Timing: `agent_turn_timing` lines in `npx vercel logs`.
- Tools (`tools/`) mirror their REST route's permissions and refuse customers where the route does.
  Write tools are confirm-gated and draft-only (`AgentPendingAction`); no Accounting writes, no
  edit tools. Test prompt/tool fixes in a NEW thread. Threads over 30 days are deleted by cron.
- `create_invoice` takes `hsnCode` as optional: `agent/hsnLookup.ts` fills a missing code from an active saved
  billing item of the same name, else the most-used code on earlier invoice lines with the same service name (text
  before ` - ` / ` – `; tie goes to the newest invoice). A line starting "Extra"/"Additional" with no match takes the
  code of "Dismantling & Mechanical Fabrication" (business rule from Ferose: extra work is civil/fabrication; 998898
  on 2026-10-16). No match at all: refusal that lists the earlier codes; a code is never invented. The reply note
  names every reused code so it can be checked on the confirm card.
- Reply sanitising: `assistantText.ts` strips special tokens; `stripToolInternals` drops tool names,
  identifiers and "Source:" lines. Never name internal tools/fields; cite app pages.
- Drive: reads limited to descendants of `GOOGLE_DRIVE_FOLDER_ID` = ZanF_DropBox on
  `zanfpowersystems@gmail.com` (shortcuts not followed; refused for customers). `zanapp-backup-*`
  names and JSON are hidden. PDFs parsed in-process (first 20 pages, 60k chars), no OCR; folder tree
  cached 10 min (Drive OAuth refresh token: regenerate with `apps/api/scripts/getDriveRefreshToken.js`;
  OAuth client `zan-app-agent-drive`, Cloud project `MyPersonalAgent`), extracted text 10 min per id+modifiedTime, name->id 5 min.

## 7. Business rules (reuse the shared service, never re-derive)
- Open order = site not yet at Commissioned SITC stage (seq 11; Customer sign-off 12 also closed);
  no site = open. Say "open (not yet Commissioned)" / "closed (Commissioned or later)". Site "update
  status" is the latest `SiteStageEvent`, separate from the SITC stage. Site name = `Site.companyName`.
- Revenue = tax invoices only (proformas excluded), net of issued credit notes. State the period
  (Indian FY, Q1 Apr-Jun ... Q4 Jan-Mar) and basis (excl./incl. GST). Collections only when asked.
- Payments received (`services/paymentSplit.ts`): method `tds` (legacy) = whole amount TDS, else cash =
  `amount`, TDS = `tdsAmount`. Settled = allocations + pro-rata TDS (`services/settlement.ts`, the single
  definition of "paid"); net = total - issued credit notes.
- Receivables = issued + partially_paid invoices; outstanding incl. GST = net - settled; excl. GST =
  outstanding x subtotal/total (subtotal already after line discounts).
- Overdue only with a due date strictly before today, IST calendar days (`services/ageing.ts`,
  `isPastDue`); no due date = "no_due_date", aged by bill/issue date. Ageing buckets also there.
- Payables (`services/payables.ts`) = vendor bills Verified, Approved or Partially paid and not
  rejected; outstanding = bill total (incl. GST) - what its vendor payments settle = cash `amount` +
  TDS withheld `tdsAmount` (`services/vendorPaymentTds.ts`). Bills carry no TDS themselves, so TDS
  lives only on `PaymentMade` and counts once; advances carry no TDS. Supplier ledger: a
  `payment_made` line (cash) + a `tds` line; TDS register: separate `tdsDeducted` section (deducted
  by us, payable to govt), never mixed into the 26AS totals. Rejected/cancelled/deleted/paid excluded.
  Purchase orders are commitments, not payables. A Rejected bill is "Rejected" only (no write-off
  wording). Deleting a rejected bill = soft delete (status `deleted`, number renamed, audit kept,
  refused with payments/debit notes), admin-only (Super Admin, Owner/Admin).
- TDS register and party ledgers use the same split and payables rules; GST returns are filing aids.
- All business dates in IST (`isoDateIST` in agent output). Rupees in lakh/crore grouping
  (`agent/formatInr.ts`).

## 8. Open / minor items (still open)
1. After a page reload, the first "+ New" can hang: the old thread stays on screen and the input says
   "Starting new chat - your message will send...", nothing sends; a second "+ New" works. (Fix 14
   retest, not yet fixed.)
2. A follow-up like "and collections?" repeats the whole revenue block before giving collections.
   (Fix 14 retest, not yet fixed.)
3. NVIDIA fallback returns HTTP 410: check `GET https://integrate.api.nvidia.com/v1/models`, try a
   current tool-calling model in Settings > Agent providers, or the account lacks the "Public API
   Endpoints" entitlement, or replace the provider. Until then the code skips it.
4. 15 prod migrations lack `_prisma_migrations` rows (section 4).
5. Customer role lacks `place_order` in prod, so portal order requests likely 403; grant with an
   idempotent migration if wanted.
6. Decide whether GSTR-3B 4A ITC (`gstExport.ts`) and site vendor costs (`routes/sites.ts`) should
   count Verified bills (they use Approved+).
7. Needs real-user click-through: order value auto-fill, Accounting-Lite A-D, vendor advances, DataTable
   columns/print, Drive folder creation, reports, multi-product order, order edit.
8. Data: `RecdDelivery` mostly empty for Ethen's 29 sites; import from
   `Material_Delivery_Status_version_1.xlsx` awaits approval.
9. Gaps: no advance section on vendor bill page; no `requestedByCustomer` badge; `Product.shape` too
    coarse; no audit log for quotations/POs; a brand-new service name still needs the user to give an HSN (section 6), no Drive upload,
    no mic on Firefox/iOS; Expo/RN and Next 16 PostCSS advisories deferred.
10. After the logo fix, re-check `pg_stat_statements` that queries selecting `logoDataUrl` stop growing.
11. Agent provider chain was failing on 2026-10-16 (OpenAI out of credits, FreeLLM router and NVIDIA timing out):
    top up OpenAI or put a reliable paid provider at priority 0 in Settings > Agent providers. Multi-round tool
    turns (create invoice) need a fast model. Re-test a proforma with an "Extra work" line in a NEW thread.
12. `apps/api/.vercel` links the wrong project (`api`, only holds previews): relink to `zan-app-api` (section 5).
    Delete the BLOCKED deployment `dpl_Hmizg2WR1Jbu6rMdrPhLZnzyzYVY` when convenient (it never took traffic).

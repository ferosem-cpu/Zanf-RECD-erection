# WhatsApp M1 review packet

Branch `feat/whatsapp-m1` (from 29dd51d). Local only: no push, merge, deploy or DB access. Commits: `ff5721e` (items 1-2), `20e12f6` (items 3-5), plus this packet.

## Behaviour
- **Mapping table** `WhatsappSenderMapping` (phone E.164 unique, lid unique nullable, enabled/aiPaused default false, audit and verified fields). Migration `20261011120000_whatsapp_sender_mapping` is hand-written, additive (one table, 3 indexes, 1 FK), **not applied**. `prisma validate`/`generate` run offline with dummy URLs.
- **Normaliser** (`services/whatsappPhone.ts`): India 10-digit/0-prefixed/91-prefixed -> `+91`; explicit `+CC` or `00CC` accepted (8-15 digits); anything ambiguous or invalid is rejected. LID: digits, optional `@lid`.
- **REST** `/whatsapp/mappings` (list, add, enable, disable, pause, unpause, delete). Gate: `authenticate` + role `super_admin` + `MANAGE_SETTINGS`. Owner/Admin and Management are excluded from mapping admin (D1 covers WhatsApp data access only). Add validates user exists, is active, has a WhatsApp-eligible role (customers rejected), no phone/LID collision, audit fields from `req.auth`. Enable requires verified, active user and no other enabled mapping for that user.
- **Policy** (`agent/whatsapp/policy.ts`): `resolveSender` -> user + group or no access (unknown, disabled, paused, ambiguous, missing/inactive user, blocked vendor, customer/unknown role, lookup error). Groups from the CURRENT role: admin (super_admin, owner_admin, management), finance, sales, ops (`operations_pm`), engineer (erection, commissioning, service_team). Allowlists exactly per DISCOVERY 4.2.1; Drive, saved items, pricing, products and all writes are in no group.
- **Execution** (`resolver.ts`, wired for production in `turn.ts`; no route calls it yet): only allowed schemas go to the model; `getTool` returns undefined for anything else; every call reloads mapping, user and permissions and re-checks the policy; revocation fails closed and sets `shouldAbort` (runAgentTurn returns an empty reply = silence).
- **Detail tool**: doc type checked per group before the handler; output checked for finance-document markers; engineers' work-order/complaint results re-authorised against the site (miss and denial look identical).
- **Money stripping** for non-finance groups at every nesting level (`sanitizeNonFinance`): exact keys `total, subtotal, grandtotal, paid, due, rate, unitrate, cost(s), balance, outstanding, tds, discount, gst/cgst/sgst/igst/gstrate`, relation keys (`allocations, paymentAllocations, billAllocations, expenses, purchaseOrders, payments, invoices, quotations, bills, creditNotes, ...`); any key containing `value, amount, price, balance, outstanding, revenue, payable, receivable, tax, cost, expense, allocation, purchaseorder`. Counts (`totalCount`, `totals.count`, units) survive. Order detail also reduces `customer` to its name.
- **Site filter (DISCOVERY:348) WhatsApp-only**: when `auth.waGroup` is set, `search_orders_and_sites` and the order detail branch accept `MANAGE_ORDERS|VIEW_ORDERS|VIEW_SITE_STATUS`; engineers get `assignedEngineerId = userId` (vendor engineers also `vendorId`) on lists, totals, whole-set counts, latest-update map, status timelines, work orders and complaints. In-app calls never set `waGroup`, so they are unchanged.

## Changed files
New: `prisma/migrations/20261011120000_whatsapp_sender_mapping`, `services/whatsapp{Phone,Mapping,MappingStore}.ts`, `routes/whatsappMappings.ts`, `agent/whatsapp/{policy,resolver,siteScope,turn}.ts`, tests `whatsapp{Phone,MappingRoutes,Policy,Resolver,SiteScope}.test.ts`, `test/_testEnv.ts`.
Edited (additive, optional params): `schema.prisma` (new model + User back-relation), `index.ts` (mount), `agent/llm.ts` (optional `getTool`, `isWriteTool`, `shouldAbort`), `agent/tools/types.ts` (optional `waGroup`), `zanAppReadTools.ts` and `zanAppDetailTool.ts` (WhatsApp-only branches), `package.json` test script. No existing test was modified.

## Results
`.claude-task/check.ps1`: shared build, prisma generate, api tsc + build, admin-web tsc + build, root tests all pass. API tests: 212 pass / 0 fail. Admin-web tests: 35 pass / 0 fail.

## Design choices
- Mapping admin = `super_admin` role AND `MANAGE_SETTINGS` (stricter than either alone).
- "One enabled mapping per user" enforced in the service, not a partial unique index (Prisma cannot express it and a hand-written one would drift from schema.prisma). Concurrent enables could race: open item.
- Mapping creation by a Super Admin counts as verification (`verifiedById/At`); enabling needs it.
- Engineers' work orders/complaints are scoped by site assignment AND the existing assignee rule (most restrictive).
- Ops/PM gets order detail and the relaxed site gate on WhatsApp only; Finance gets no work orders, customers or order detail.

## Deferred / not done
- Admin-web settings panel: **deferred** (backend complete; panel not started).
- Migration not applied anywhere; production state NV.
- No bridge route or endpoint (M2/M3); `turn.ts` is unused by any route. Per-identity rate limits, audit rows and the bridge trust model are M2/M3.
- M1b app-wide permission work untouched.

## Open items
- Prompt for WhatsApp (system prompt text, no-money wording) is M2.
- `search_customers` still returns contacts to Sales/Admin (as DISCOVERY 4.2.1 allows); Finance gets no customer tool.
- Sanitiser is key-name based: new money fields with unusual names would need adding to the lists in `policy.ts`.
- Real-DB behaviour of the scoped queries is untested (fakes only), as per project rules.

## Codex M1 review -> fixes

| Finding | Fix | Files | Tests | Status |
|---|---|---|---|---|
| BLOCKER: allowed order / work-order detail exposes Site Drive folder IDs/URLs | Fixed per-type field allowlist (order incl. finance variant, work_order, complaint) applied on the WhatsApp path only; unlisted fields (incl. nested) dropped; any key containing "drive" dropped for every doc type | `agent/whatsapp/policy.ts` (`projectDetail`), `agent/whatsapp/resolver.ts` | `whatsappResolver.test.ts`: order (Sales, Ops), work_order (engineer, Ops), complaint (engineer), admin/vendor | Fixed |
| BLOCKER: no access re-check before a reply (no-tool reply, timeout/error paths, group change) | `finalCheck` hook on `runAgentTurn` runs after every reply path; `turn.recheck()` reloads mapping, user and group, fails closed on any change or lookup error (reply becomes empty = silent). A group change mid-turn now revokes instead of returning DENIED only. Turn errors still propagate (nothing sent) | `agent/llm.ts`, `agent/whatsapp/finalCheck.ts`, `agent/whatsapp/resolver.ts` | `whatsappSilence.test.ts` (no-tool, timeout/error, downgrade, lookup failure), `whatsappResolver.test.ts` (recheck, group change) | Fixed; the future bridge route must pass `finalCheck: turn.recheck` (no route calls it yet) |
| MEDIUM: key-based redaction misses keys | Added lineTotal, mrp, margin, advance, retention, gstPercentage, interestRate to the strip list. Free-text money is NOT redacted (projection is the boundary; strings stay) | `agent/whatsapp/policy.ts` | `whatsappResolver.test.ts` | Keys fixed; free text accepted risk |
| MEDIUM: one enabled mapping per user can race | Partial unique index `WhatsappSenderMapping_one_enabled_user_idx` added to the M1 migration (edited in place; never applied anywhere); schema comment updated | migration.sql, `schema.prisma` | none (no DB access) | Written, not applied, not verified against a DB |
| MEDIUM: scope tests only fake Prisma args | Not addressed | | | Open: disposable-Postgres test before M4/M5 |
| LOW: absent named test files, super-admin without MANAGE_SETTINGS, concurrent enable, LID binding | `whatsappSilence.test.ts` added; rest not addressed | | | Partly open |

Test counts after fixes: API 223/223, admin-web 35/35.

# Zan-APP - rules for Claude sessions

Full context: `docs/HANDOVER.md` (start with §10 open items and §11 changelog).

## Layout
- `apps/api` - Express 5 + Prisma 5 API (routes/, services/, agent/ = in-app AI agent and its tools).
- `apps/admin-web` - Next.js 15 admin UI (app/ pages, lib/ helpers, components/).
- `apps/mobile` - Expo app, never runtime-tested; leave alone unless asked.
- `packages/shared` - `@recd/shared` Zod schemas + constants, compiled to CommonJS (`dist/`).
- `.claude-task/` - local task/progress files. Never commit it.

## Build / test (all must pass before every push)
- `npm run build --workspace=packages/shared` (after any shared change)
- `apps/api`: `npx prisma generate`, `npx tsc --noEmit`, `npm run build`
- `apps/admin-web`: `npx tsc --noEmit`, `npm run build`
- root: `npm test` (node:test via tsx; new test files must be listed in the app's package.json "test" script)
- Tests use mocks/fakes only - never a real DB, LLM or Google API.

## Deploy
Never deploy, merge to master or open a PR unless Ferose explicitly approves it. The manual
`zan-app-api` deploy flow is in `docs/HANDOVER.md` §8 (API first, then admin-web, which
auto-deploys on master push).

## Hard rules (unless Ferose explicitly approves)
- No merge to master, no deploy, no PR, no force-push, no rebase, no `--amend`.
- No `prisma migrate deploy/dev` or `db push` against any database; write migrations only, flagged.
  Prod migration history has drifted (HANDOVER §8).
- Do not read `.env` files, `apps/api/.vercel/.env.production.local`, tokens or credentials; no
  production DB access. Say "not verified against production" when data can't be checked.
- Commit with `git -c user.name=Claude -c user.email=noreply@anthropic.com commit -F <msgfile>`;
  write the message file without a BOM (Write tool or bash, not PowerShell `>`).

## Money rules (one definition each - reuse, don't re-derive)
- Payments received: `services/paymentSplit.ts`. Method `tds` ("TDS Deducted", legacy) = the whole
  amount is TDS, never cash; otherwise cash = `amount`, TDS = `tdsAmount`.
- Invoice settled = allocations + pro-rata TDS: `services/settlement.ts`. Net = total − issued
  credit notes.
- Receivables = issued + partially_paid invoices; outstanding incl. GST = net − settled; excl. GST
  = outstanding × subtotal/total (subtotal is already after line discounts).
- Payables = vendor invoices (Bill) in verified, approved or partially_paid status, outstanding =
  total − vendor payments: `services/payables.ts`. Rejected/cancelled/deleted/paid excluded.
  Purchase orders are commitments, NOT payables.
- Ageing buckets: `services/ageing.ts` (shared with the Finance reports).
- Revenue answers state the period (Indian FY: Q1 Apr-Jun ... Q4 Jan-Mar) and the basis
  (invoiced excl./incl. GST net of credit notes vs collected cash).

## Domain rules
- An order is open until its site reaches the Commissioned SITC stage (seq 11; Customer sign-off
  12 is also closed); no site yet = open.
- Site "update status" (Done, Pending, ...) = status of the latest SiteStageEvent, separate from
  the SITC stage.
- Stages, statuses, roles, permissions are DB rows ("data, not code"); agent tools mirror their
  REST route's permissions and refuse customers where the route does.
- Business dates are shown in IST (Asia/Kolkata); in agent output use `isoDateIST`.
- Agent Drive access is limited to descendants of `GOOGLE_DRIVE_FOLDER_ID` (ZanF_DropBox).

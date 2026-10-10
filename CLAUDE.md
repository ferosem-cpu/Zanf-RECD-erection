# Zan-APP - rules for Claude sessions

Context, deploy steps, business rules and open items: `docs/HANDOVER.md` (read it first).
Agent QA question set: `docs/agent-test-checklist.md`.

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

## Hard rules (unless Ferose explicitly approves)
- No merge to master, no deploy, no PR, no force-push, no rebase, no `--amend`.
- Deploy flow (API first, then admin-web) is in HANDOVER section 5; follow it exactly.
- No `prisma migrate deploy/dev` or `db push` against any database; write migrations only, flagged.
  Prod migration history has drifted (HANDOVER section 4).
- Do not read `.env` files, `apps/api/.vercel/.env.production.local`, tokens or credentials; no
  production DB access. Say "not verified against production" when data can't be checked.
- Commit with `git -c user.name=Claude -c user.email=noreply@anthropic.com commit -F <msgfile>`;
  write the message file without a BOM (Write tool or bash, not PowerShell `>`).

## Rules that must not be re-derived (details in HANDOVER section 7)
- Money: reuse `services/paymentSplit.ts`, `settlement.ts`, `payables.ts`, `ageing.ts`; revenue =
  tax invoices only, state period (Indian FY) and basis; purchase orders are not payables.
- Open order = site not yet Commissioned (seq 11; sign-off 12 also closed); no site = open.
- Stages, statuses, roles, permissions are DB rows ("data, not code"); agent tools mirror their
  REST route's permissions and refuse customers where the route does.
- Business dates in IST (`isoDateIST` in agent output). Agent Drive access is limited to
  descendants of `GOOGLE_DRIVE_FOLDER_ID` (ZanF_DropBox).

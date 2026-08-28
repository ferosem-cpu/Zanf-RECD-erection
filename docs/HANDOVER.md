# Platino RECD Tracker / Zan-APP — Handover

> **Fork notice:** This repo started as a clone of the **Platino RECD tracker**
> project. Everything from **"Part B: Zan-APP"** onward is this project's own
> work, for a different company, with its own database and deployments.
> **Part A** below is condensed background on the inherited codebase only —
> not this project's roadmap.

---

# Part A — Platino RECD tracker (inherited codebase, background only)

A role-based Project & Service Tracker for an RECD (Retrofit Emission Control
Device) manufacturing/installation business, tracking the **SITC** flow
(Supply → Installation → Testing → Commissioning). Turborepo/npm-workspaces
monorepo: `apps/api` (Express 5 + Prisma + JWT), `apps/admin-web` (Next.js 14
App Router + Tailwind), `apps/mobile` (Expo, never runtime-tested),
`packages/shared` (Zod schemas/types/constants, compiled to CommonJS — must be
rebuilt with `npm run build --workspace=packages/shared` after any source
edit, since consumers read `dist/`, not `src/`).

**Core design principle — "data, not code":** stages, roles, permissions,
statuses, photo checkpoints, structure types are all rows in tables, not
hardcoded enums — the same pattern Zan-APP inherited and kept for its own
finance module below.

**Roles:** Super Admin (only role with `manage_settings`) > Management (all
except Settings) > Sales / Operations / Erection & Commissioning Engineers /
Service Team / Finance / Customer — each permission-gated both client- and
server-side. External erection companies are modeled as **Vendors**
(`User.vendorId` / `Site.vendorId`), with strict tenant isolation between
vendors enforced on every site route.

**Known durable facts from this history, still relevant as prior art:**
- A full security audit (bare JWT-secret fallback, IDOR on complaint creation,
  no login rate-limiting, weak temp-password RNG) was fixed and shipped —
  `jwt.ts` now **throws at boot if `JWT_SECRET` is unset** (fail-loud, no
  insecure fallback). Any new Express app cloned from this code should keep
  that pattern.
- Windows-specific Prisma gotcha: `prisma generate` can fail with `EPERM`
  renaming `query_engine-windows.dll.node` if any running `node.exe` still has
  the DLL loaded — find and kill it via
  `Get-Process node | ? { $_.Modules.FileName -like '*query_engine*' }`, not
  just the obvious dev-server PID (it's sometimes a stray/orphaned process).
- Vercel deploy pitfalls that recur across both projects: don't reintroduce a
  legacy `"builds"` array in `vercel.json` (silently skips `prisma
  generate`); `packages/shared` must compile to CommonJS; "Redeploy" on an old
  dashboard row rebuilds that pinned commit, not latest — push and let Git
  auto-deploy, then explicitly Promote to Production.
- The original Supabase DB was migrated Tokyo → Mumbai (`ap-south-1`) for
  latency, and the Vercel API project's `regions` was pinned to `bom1` to
  match — the same latency lesson applies to Zan-APP's own Mumbai setup below.

Full blow-by-blow history (original §1–§19) has been trimmed from this file —
it's inherited background, not Zan-APP's own record. If deep detail is ever
needed, it's in git history / the pre-2026-08-12 version of this file.

---

# Part B — Zan-APP (this project's own work)

Separate company, separate codebase-derived-from-Platino, separate database
and deployments going forward. Cloned 2026-07-19 from
`github.com/ferosem-cpu/Zanf-RECD-erection` (a one-time snapshot, not kept in
sync with Platino's own repo).

**Current state:** working tree clean; latest work is a new Customer Purchase
Order feature plus native Gemini PDF extraction (see top of Changelog,
2026-08-28). Start a new session by reading "Current open items" and the top
of "Changelog" below.

## Quick facts

| | |
|---|---|
| **Local ports** | API `4011`, admin-web `6011` (deliberately different from Platino's `4001`/`6001` so both repos can run side by side — see gotcha below). Use `preview_start(name: "zan-api")` / `preview_start(name: "zan-admin-web")`. |
| **Production DB** | Supabase project `zan-app`, ref `idqzupopsuusoihpmoqc`, region `ap-south-1` (Mumbai). |
| **Vercel — admin-web** | `admin-web` project, **git-connected** — push to `master` auto-deploys. URL: `admin-web-three-blush.vercel.app`. |
| **Vercel — api** | `zan-app-api` project (`prj_yf9RGAw5mnBhJdVi9lDCJncdkrnS`, team `ferose-salahudeen-s-projects`), **NOT git-connected** — needs the manual deploy dance below every time. URL: `zan-app-api.vercel.app`. |
| **Google Drive (agent doc search + folder creation)** | Dedicated account `zanfpowersystems@gmail.com`, folder `ZanF_DropBox` (id `1M3V4MdO0NLMHPJMr7naK0EFGLIT8aIRU`). OAuth client `zan-app-agent-drive` (Desktop type) lives in Cloud project `MyPersonalAgent` (`mypersonalagent-503004`), owned by `ferosem@gmail.com` — **not** `zanfpowersystems@gmail.com`, which only owns the Drive folder itself. Consent screen was **published to production 2026-08-18**, which removed the old 7-day Testing-mode refresh-token expiry (confirmed: a token minted after publishing has no `refresh_token_expires_in` in Google's response at all, vs. exactly 604760s/7d before). Still shows an "unverified app" warning on re-consent since Drive scopes need Google review to fully verify — harmless, just click through Advanced. **Token scope is `drive.readonly` + `drive.file`** (as of 2026-08-18, later) — readonly alone can search/read pre-existing shared documents but can't create anything, which silently broke "Create Drive folders" even after the expiry was fixed; `drive.file` adds create/manage access scoped to files the app itself creates. Regenerate via `apps/api/scripts/getDriveRefreshToken.js` if this ever needs redoing (kept in the repo, not a one-off). |
| **Working dir on user's machine** | `D:\Projects\Zan-APP` (reached via the Desktop Commander MCP — see tooling note below, not this harness's own `device_bash`). |

## Standing architecture (inherited from Platino, unchanged)

Same "data, not code" principle, same role/permission model, same monorepo
layout. Zan-APP's own addition is a **finance module** (Quotations, Invoices,
Purchase Orders, Expenses, Work Orders — none of this existed in the original
Platino clone, built entirely in this project) and, more recently, an
**in-app AI agent**.

## The `zan-app-api` manual deploy dance (needed for every backend-touching change)

`zan-app-api` is deliberately not git-connected, so every backend change
needs this sequence from `apps/api`:

0. **Every step below must run from `apps/api` specifically** - not the repo
   root, not any other folder. Confirmed 2026-08-17: running `vercel build`
   from the root fails loudly ("No Project Settings found locally"), but
   running `vercel deploy --prebuilt` from the wrong folder can *silently*
   pick up a stale leftover `.vercel/output` from an earlier build instead
   of erroring - no warning, it just deploys the wrong code. If a shell
   session wanders (e.g. after `cd..`, or after opening Notepad, whose Save
   dialog uses its own last-remembered folder, not the shell's cwd), `cd
   apps\api` explicitly before every `vercel` command rather than assuming
   you're still there.
1. Stop any local `zan-api` dev server first (Windows Prisma `EPERM` gotcha).
2. `npx vercel pull --yes --environment production`
3. **Delete any leftover build output before rebuilding** -
   `Remove-Item -Recurse -Force .vercel\output, dist -ErrorAction SilentlyContinue`
   (from `apps/api`). Skipping this is exactly how the stale-deploy bug in
   step 0 happens - a failed or wrong-directory build attempt can leave an
   old `.vercel\output` sitting there for the *next* `deploy --prebuilt` to
   pick up without complaint.
4. `npx vercel build --prod` — **takes 15–20 minutes** (confirmed 2026-08-28:
   ~14 min), almost entirely spent in Vercel's `@vercel/nft` file-tracing
   step, not in `tsc` (which alone takes ~15s). Root cause of the slowness,
   diagnosed 2026-08-24: `@vercel/nft` traces a 500MB+ local `node_modules` —
   `.prisma` client+engines 314MB (already minimally scoped via
   `binaryTargets: ["native", "rhel-openssl-3.0.x"]`, nothing more to trim)
   and `googleapis` 211MB, of which the app only ever uses `google.drive()` +
   `google.auth.OAuth2` (`apps/api/src/lib/googleDrive.ts`, its only import
   site). Two real levers identified, neither applied yet: (1) a Windows
   Defender exclusion for the repo folder during builds — zero code risk;
   (2) swap `googleapis` for the smaller scoped `@googleapis/drive` package —
   real payoff but needs care, since `googleDrive.ts`'s own comment says it
   deliberately uses `googleapis`' bundled `google.auth.OAuth2` over the
   standalone `google-auth-library` package because of a past internal
   version-check mismatch bug — a swap needs a real Drive OAuth round-trip
   tested before trusting it in production, not just a clean build.
   CPU/memory climb steadily the whole time — that's normal, not hung;
   confirm via `Get-Process`/`Get-CimInstance` polling if unsure. Worth
   piping to a log (`... 2>&1 | Tee-Object -FilePath build.log`) so you can
   `Select-String -Path build.log -Pattern "error" -SimpleMatch` afterward
   instead of assuming a long build that finished must have succeeded.
   Note (2026-08-28): the build log showed `packages/shared`'s own
   TypeScript build (`npm run build --workspace=packages/shared`) running
   fresh as part of `vercel build --prod` itself, so schema/constants
   changes there were already reflected with no separate manual copy step
   into `.vercel/output/...packages/shared` needed that run — don't assume
   this always holds; verify by grepping the output for a distinctive new
   string, same as step 5 below.
5. **If this deploy adds/changes a route, verify it's actually in *this*
   build's output before deploying** - don't rely on step 8's "401 not 404"
   check alone for a *new* route (see why below):
   `Select-String -Path ".vercel\output\functions\api\index.func\apps\api\dist\routes\<file>.js" -Pattern "<distinctive string from the new code>"`.
6. **Patch `@recd/shared`** into the spots the npm-workspaces symlink doesn't
   survive Vercel's Windows-symlink-unaware function tracer — this step is
   required after every fresh build, since each build's own install step
   wipes it (confirmed 2026-08-28: the local `apps/api/node_modules/@recd/shared`
   copy was found completely empty/missing before that session's deploy even
   started, not just stale — this is expected, not a new bug). **As of Vercel
   CLI 59.1.4 (2026-08-20) this is only 3 spots, not the 5 an earlier CLI
   version needed** - `.vercel/output/functions/` now contains only
   `api/index.func/` (everything is rewritten to `/api/index` per
   `vercel.json`); the old bare `functions/index.func/` target from prior
   write-ups no longer exists in the output at all, and trying to patch into
   it is a silent no-op (its parent directory doesn't exist - skip it, don't
   create it). The 3 real spots, confirmed 2026-08-20:
   - `apps/api/node_modules/@recd/shared`
   - `.vercel/output/functions/api/index.func/node_modules/@recd/shared`
   - `.vercel/output/functions/api/index.func/apps/api/node_modules/@recd/shared`
   **Update, Vercel CLI 59.5.0 (2026-08-24):** the bare `functions/index.func/`
   target is back (sibling to `functions/api/index.func/`) - don't assume it's
   permanently gone just because one CLI version dropped it. It's unused by
   this app (`vercel.json`'s rewrite still sends all traffic to `/api/index`,
   confirmed via `functions/api/index.func`'s own logs actually receiving
   requests), so it doesn't need patching, but it's a sign this layout keeps
   moving - always verify against the current build's actual tree. Also new
   this CLI version: `functions/api/index.func/packages/shared/dist` now
   exists as a real, current, un-symlinked copy (confirmed by grepping it for
   a distinctive string) - this looked like it might make the whole patch
   dance obsolete, but it isn't: deploying with the patch skipped fails at
   two different points depending on what's missing -
   `vercel deploy --prebuilt` itself refuses with `File does not exist:
   "node_modules\@recd\shared"` if only the *local* `apps/api/node_modules/@recd/shared`
   copy is missing (a pre-upload validation check against the local
   workspace tree, unrelated to what's actually in `.vercel/output`; hit
   again and confirmed exactly as documented on 2026-08-28), and if
   that's patched but the two `.vercel/output/...node_modules/@recd/shared`
   spots aren't, the deploy succeeds but every route 500s at runtime with
   `Cannot find module '@recd/shared'` (confirmed via `npx vercel logs
   <deployment-url>` - the bundled `packages/shared/dist` files exist on
   disk but nothing makes Node's `require("@recd/shared")` resolve to them
   without the `node_modules/@recd/shared` entry). **All 3 original spots
   are still required, unchanged** - this CLI version just fails in a new,
   more confusing way if you skip them, instead of silently deploying stale
   code like older versions did. **Reconfirmed 2026-08-28**: that build's
   output had BOTH `functions/index.func/` and `functions/api/index.func/`
   simultaneously (not just one or the other, contradicting some earlier
   per-CLI-version assumptions above) — patched into both plus the local
   `apps/api/node_modules/@recd/shared` copy (3 spots total, consistent with
   the documented count) and the deploy succeeded and ran clean at runtime.
   **Lesson, now reconfirmed twice: always check what actually exists in the
   current build's `.vercel/output/functions/` tree rather than assuming a
   fixed spot list holds across CLI versions** — this doc's spot list has
   now changed at least twice.
   **The `@recd` scope folder itself doesn't exist yet in a fresh build** -
   a patch script that only checks/overwrites the final `shared` folder
   (assuming its parent `@recd` dir is already there) silently no-ops on
   all three, since `Test-Path` on the *parent* of `@recd/shared` (i.e.
   `@recd` itself) correctly reports missing, but a script that instead
   checks the *grandparent* (`node_modules`, which does exist) will think
   the target is patchable and then fail to actually create anything - the
   `@recd` intermediate directory must be `New-Item -ItemType Directory`'d
   before copying into it.
   Write this as a `.ps1` file via an editor and run it with `-File` rather
   than pasting inline (multi-line pastes into a live PowerShell prompt have
   corrupted before) - and if using `notepad <name>.ps1` to create it,
   confirm with `Test-Path <name>.ps1` that it actually saved where you
   expect (Notepad's Save dialog remembers its own last folder, not the
   shell's cwd - confirmed 2026-08-17, cost a stray `cd` back to the repo
   root that then broke the next step).
7. `npx vercel deploy --prebuilt --prod` from `apps/api`.
8. Verify: `GET /health` → 200, and a route that requires auth (e.g.
   `GET /agent/providers` or `DELETE /quotations/<fake-id>`) → 401, not 404 —
   404 means the deploy didn't actually pick up the change. **This check
   alone does NOT prove a brand-new route exists**, only that the deployed
   function responds at all: router-level `.use(authenticate)` middleware
   (e.g. in `vendors.ts`) runs for *every* request under that path prefix
   regardless of whether any specific route ultimately matches, so an
   unauthenticated request to a nonexistent new route can still return a
   convincing `401` instead of `404`. To actually confirm a new route is
   live, either test it with a **valid token and a real record id** (a
   genuine 404 from inside the route's own `if (!thing) return
   res.status(404)` always has a JSON `{error: "..."}` body; a route that
   was never registered falls through to Express's bare fallback 404, which
   doesn't) or trust step 5's build-output check instead.

`admin-web` needs none of this — it's git-connected, so `git push` to
`master` is enough.

**Established deploy ordering rule (backend-first):** when a feature spans
both apps, deploy `zan-app-api` and confirm it live (`/health` → 200) *before*
pushing the dependent `admin-web` commit — never push both assuming they
deploy in lockstep. See "Known gotchas" for the production outage this rule
exists because of.

## Tooling note for future sessions

Local builds/deploys on the user's machine are done via the **Desktop
Commander MCP** (`mcp__remote-devices__Desktop_Commander__*`), which gives a
real shell on the user's Windows machine — not this harness's own sandboxed
`device_bash`, which reports "workspace unavailable" for this project.
One transport quirk hits repeatedly: any command string containing a literal
`$` (PowerShell variables, `$_` in pipelines) gets silently stripped before
reaching PowerShell. **Workaround: write the script as a `.ps1`/`.js` file via
`write_file` first, then execute it with `-File`** — inline `-Command "..."`
strings lose `$`, script files don't.

**A cloud/web session (Claude Code on the web, no Desktop Commander attached)
cannot run the `zan-app-api` deploy dance at all - confirmed 2026-08-16, not
just "inconvenient."** Two independent, unrelated blockers, both hit in the
same session:
- No Desktop Commander MCP tool is attached in a cloud session, and no other
  reachable local/remote session existed to hand it off to (`list_agents`
  came back empty) - there's no way to reach the user's own machine at all.
- Even *with* a valid Vercel token supplied directly by the user, the
  `vercel` CLI's own API calls fail: this sandbox's network egress proxy
  outright blocks `api.vercel.com` at the gateway (`curl
  "$HTTPS_PROXY/__agentproxy/status"` showed repeated `gateway answered 403
  to CONNECT ... host: api.vercel.com:443`). Same story for `*.vercel.app`
  deployment URLs and even the production `app.zanf.org` domain via
  `WebFetch` (`EGRESS_BLOCKED`). This is a network *policy* restriction on
  the environment, not an auth problem - no token fixes it. The connected
  Vercel MCP tool (`mcp__Vercel__*`) is a separate path that does reach
  Vercel's API, but it's authenticated as a *different* account/team that
  doesn't have this project (`get_project` on both `zan-app-api`'s known
  project ID and the `zan-app` slug 404'd under it).
- **Bottom line: a cloud session can prepare and push the code fix to
  `master`, but the actual `zan-app-api` deploy needs a session with real
  Desktop Commander access to the user's machine (or the environment's
  network policy opened up to `api.vercel.com`).** Say so plainly rather
  than attempting the deploy dance from a cloud session - it will not work.

## Known gotchas (still live)

- **Never push one commit that touches both `admin-web` and `apps/api` when
  the frontend change depends on a new/changed API field.** `admin-web`
  auto-deploys instantly on push; `zan-app-api` doesn't deploy until someone
  runs the manual dance, which can be minutes to hours later. **Caused a real
  production outage 2026-08-20**: a commit added `order.product`-dependent
  Sites columns with no optional chaining (assumed always present) in the
  same push as the backend `include` that supplies the field — `admin-web`
  went live immediately, `s.order.product` was `undefined` until the API
  deploy caught up, and the Sites page threw a full client-side exception for
  every real user in the gap. Local dev looked fine throughout (local API
  dev server picks up changes on save) — **local looking fine is not evidence
  production is fine** when the two apps are out of deploy-sync. Fix: deploy
  backend first and confirm live before pushing the dependent frontend
  change, or make the frontend degrade gracefully (optional chaining +
  fallback) for fields the *current* production API might not have yet.
- **`next dev` is broken in this environment** (not production-affecting):
  `globals.css`'s `@import`/`@tailwind` lines fail through Next's RSC CSS
  loader path — reproduces even on a clean `node_modules`/`.next`/`.turbo`.
  `next build && next start` works (what Vercel uses anyway) — use that for
  local testing until root-caused.
- **`next build` for `admin-web` must run with cwd actually inside
  `apps/admin-web`** — invoking the CLI with a directory argument from
  elsewhere builds successfully but Tailwind's `content` glob resolves
  relative to `process.cwd()`, not the config file's location, so it matches
  nothing and emits nearly-empty CSS. Only symptom is a quiet `warn - The
  content option ... is missing or empty` line, not a build failure —
  confirmed 2026-08-20 (page loaded, zero styling, easy to miss). Fix: run
  the build via `Start-Process -WorkingDirectory apps\admin-web` or an actual
  `cd`, never a path argument from elsewhere.
- **`next start`'s real server is a child process, not the PID
  `Start-Process`/`npm run start` returns.** Killing that PID leaves the
  server still bound to port 6011 — next start attempt fails `EADDRINUSE`,
  and the browser keeps serving the stale build. Confirmed 2026-08-20. Fix:
  kill whatever `Get-NetTCPConnection -LocalPort 6011 -State Listen` reports,
  not the launcher's own PID.
- Editing `packages/shared` source has **zero effect** until rebuilt
  (`npm run build --workspace=packages/shared`) and the API dev server is
  restarted — bit twice (2026-08-11, and historically).
- Installs run through the remote/automation shell have repeatedly corrupted
  `node_modules` (turbo/tailwind/next/prettier/typescript binaries going
  missing, even under `npm ci`) — recurred 2026-08-13 (`typescript` missing
  even though `turbo`/`next` were present; re-running `npm install` through
  Desktop Commander fixed it that time). If it recurs and doesn't self-fix,
  have the user run `npm install` directly in their own terminal instead.
- The local dev Postgres DB needs `npx prisma migrate deploy` run by hand
  after pulling schema changes someone else made — a stale local DB throws
  opaque `PrismaClientKnownRequestError: column ... does not exist` on
  whichever route first touches the missing column (hit via `/dashboard` →
  `Site.companyName` on 2026-08-13).
- **Windows Prisma `EPERM` gotcha (see Part A) recurs on every fresh
  `prisma generate`/`migrate dev` if the previous dev server wasn't fully
  killed** — confirmed again 2026-08-13, same fix (kill the `node.exe` still
  holding `query_engine-windows.dll.node`, then retry).
- **Production's Supabase migration history has drifted from the local
  Prisma `migrations/` folder.** `add_site_contacts_documents_delivery` is
  applied on production under a *different* version timestamp
  (`20260813085200`) than the local migration file's own name
  (`20260813085114`), and several early production migrations
  (`zanf_card_system_schema`, `fix_updated_at_search_path`, etc.) have no
  corresponding local `.sql` file — production schema changes have been
  applied directly via the Supabase MCP's `apply_migration`, not `prisma
  migrate deploy`. **Don't assume `prisma migrate status` against production
  would report cleanly** — always diff actual columns
  (`information_schema.columns`) against the Prisma schema before writing a
  new migration.
- No DB-level `NOT NULL` constraint on any `hsnCode` column — enforcement is
  Zod/API-layer only (deliberate; a DB constraint would need a data-backfill
  pass first, since some historical rows may still be null).
- **The agent operating this repo cannot log into `admin-web` itself** —
  entering a password into any field is refused outright, even with
  credentials supplied by the user. Production changes get verified by
  replicating the app's own Prisma queries as raw SQL via the Supabase MCP,
  and by hitting the deployed API directly for auth-gated routes (expect
  401, not 404) — never by loading the real UI as a logged-in user. Local
  dev DB doesn't have this restriction: seeded Super Admin
  (`ferosem@gmail.com` / `changeme123`) is fine for local browser
  verification.
- Supabase MCP calls against the production project (`apply_migration`,
  `execute_sql`) get intermittently blocked by the harness's auto-mode
  safety classifier and need the user to explicitly say "proceed" before a
  retry succeeds — inconsistent about which calls trip it (a large
  multi-statement data-import query went through untouched right after a
  single-statement schema migration got blocked, and this recurred again
  2026-08-24), so don't assume a query is safe just because a similar one
  just went through.
- **This dev machine has `NODE_ENV=production` set globally** (the Windows
  user's own environment, not a project `.env` — confirmed via
  `$env:NODE_ENV`), which is also why `next dev` warns about a "non-standard
  NODE_ENV value". Side effect: any route doing `NODE_ENV === "production" ?
  undefined : devValue` (the OTP endpoints' `devCode` echo) behaves like real
  production even locally — don't mistake a missing `devCode` for the
  request having failed; check `NotificationLog`/server logs instead.
- **`npm install <package-name>` (explicit package argument) reliably
  crashes with `TypeError: Cannot read properties of null (reading
  'location')`** (npm 11.13.0, arborist tree-diff bug tied to how it diffs
  the `@recd/shared` workspace symlink after it's been patched for a Vercel
  deploy). **Workaround: hand-edit the `dependencies`/`devDependencies` entry
  into the target workspace's `package.json`, then run bare `npm install`**
  (no package argument) — confirmed via the nodemailer install on
  2026-08-14. If a bare `npm install` then fails on the `prisma generate`
  postinstall's `EPERM` lock, re-run with `--ignore-scripts` and manually run
  `npm run build --workspace=packages/shared` + `npx prisma generate` (from
  `apps/api`).
- **Work done from the mobile app lands as a pushed-but-unmerged branch
  named `claude/<slug>`, not directly on `master`.** Found 2026-08-15 when a
  feature the user said they'd built "yesterday on my phone" wasn't on
  `master` — `git fetch origin && git branch -a` surfaced
  `origin/claude/customer-agent-scoping-voice` sitting un-merged. **Always
  check for these before assuming a feature doesn't exist or rebuilding it
  from scratch.**

## Current open items (as of 2026-08-28)

- **Accounting-Lite Phase A (party ledgers) and Phase B (Credit/Debit
  notes) shipped but not click-tested live** — see Changelog. Owed: real
  Finance-user walkthrough of `/finance/ledgers`, `/finance/credit-notes`,
  and `/finance/debit-notes` (draft a CN against a real issued tax invoice,
  issue it, confirm the invoice's balance/status update and the ledger
  shows the credit movement). Phases C (payment allocation/advances/TDS)
  and D (GST exports) from `docs/ACCOUNTING_LITE_PLAN.md` are not started
  yet. The in-app AI assistant still has no tool to read ledgers or credit
  notes — deliberately deferred by the user to after all four phases.
- **Every `DataTable` page has a Print button** (2026-08-20) — prints only
  the currently-filtered rows/visible columns with a full letterhead. Not yet
  click-tested live by the user (standing "agent can't log into admin-web"
  restriction) — owed: print preview on at least one page with an active
  filter, confirm letterhead/logo renders.
- **`DataTable` (column show/hide + per-column filter) covers all list
  pages** (2026-08-20) — Sites/Customers/Products, plus Vendors, Orders,
  Invoices, Quotations, Purchase Orders, Expenses, Users, Work Orders,
  Complaints. Not yet click-tested live — owed: real click-through of the
  Columns menu and per-column filters on a few newly-converted pages.
- **Drive folder creation fixed and deployed (2026-08-18) but not yet
  click-tested live** — round 1 fixed the expired-token/7-day expiry (fully
  gone now); round 2 found and fixed the real remaining cause, wrong OAuth
  scope (`drive.readonly` only, widened to include `drive.file`), verified
  end-to-end by creating/deleting a real test folder via the Drive API
  directly. Owed: click "Create Drive folders" on a real site as a logged-in
  user and confirm success (standing restriction blocks this from any
  session, not just cloud ones).
- **`RecdDelivery` (delivery-status-per-site table) is almost entirely
  unpopulated for Ethen's 29 sites** — found verifying a user-uploaded
  `Material_Delivery_Status_version_1.xlsx` against production. Only 2 of
  ~24 delivery-status line items in the sheet have any `RecdDelivery` row at
  all (INTERGLOBE AVIATION/Devanahalli, VRL/Peenya), and even those two have
  gaps (VRL/Peenya's `productId` is null; neither captured an actual/expected
  date despite the sheet giving one). Every other site (Bostik, all BPCL's,
  the other 7 VRL sites, Mahindra, Wipro, Kaynes) has real Order/Site data
  but zero delivery-status record. User was offered an import of the missing
  rows — not yet done, waiting on the user.
- **One address name doesn't match between the sheet and the DB,
  unconfirmed**: sheet's "BPCL, DEVANAGONTI, Bangalore" has no literal match
  in production — closest candidate is BPCL's "Hosakote, Bangalore" site
  (same 2-product shape — RECD-250 + RECD-750 — the sheet's group implies).
  Waiting on user confirmation these are the same place before importing.
- **`apiClient.ts` fix for the false-failure-on-delete bug (2026-08-16) is
  pushed but not yet click-tested live** — frontend-only, ships via normal
  `admin-web` auto-deploy. Owed: confirm a delete action resolves cleanly in
  the browser instead of throwing.
- **New Reports section (2026-08-16) has never been click-tested as a
  logged-in user** — only `tsc`/`next build`/curl-200 verified, per the
  standing "agent can't log into admin-web" restriction. Owed: a real run
  through each of the 4 reports' filters, Print, and Export CSV buttons.
- **Customer-facing agent chat (own orders/sites + raise-complaint) is
  code-complete, deployed, and verified live as a real customer** (2026-08-15)
  but the **Settings → Agent Visibility toggle for Customer is still off in
  production** — deliberately left for the user to flip on when ready.
- 9 of the 12 notification `templateKey`s (`complaint_raised`,
  `invoice_issued`, `payment_received`, `work_order_assigned`, etc.) send
  real emails but with generic auto-rendered key/value copy, not bespoke
  templates — only `otp_code`, `site_stage_updated`, and
  `vendor_assigned_site` got real copy. See `emailTemplates.ts`.
- Customer login's "Order ID + phone" flow was removed from the login page
  UI (2026-08-14, "for now") but `/auth/customer/register` and
  `/auth/customer/verify` are untouched on the backend — dead code from the
  UI's perspective, not actually dead. Revive by re-adding the toggle in
  `login/page.tsx` if it comes back; don't delete the backend routes without
  checking nothing else depends on them.
- Product catalog carries real GA-drawing-derived data
  (`shape`/`dimensions`/`weightKg`, imported 2026-08-13) for 30 KVA
  variants, but `shape` is only a 3-value enum (`cylinder`/`triangle`/
  `rectangle`); the richer free-text shape descriptions from the source
  spreadsheet (e.g. "Horizontal cylindrical shell (RAD 2.0)") got stuffed
  into `ratingSpec` for lack of a better field — flagged as a judgment call,
  not yet revisited.
- `apps/api/scripts/verify*.ts` — a growing pile of throwaway verification
  scripts from live-testing the agent's write tools. Never consolidated into
  real automated tests; still there, still growing.
- HSN-code self-inference risk on document line items is blocked by
  validation (mandatory `hsnCode` on the shared Zod schema), but the *agent*
  will still confidently invent a code if the user doesn't supply one and
  gets a rejection rather than a silent bad value — acceptable but worth
  knowing.
- No edit-history/audit-log for quotations or POs (invoices have
  `InvoiceEditLog`) — acceptable today since quotation/PO editing is
  draft-only, but worth knowing the asymmetry exists.
- The in-app agent's chat bubble stays invisible to everyone until a Super
  Admin opts specific roles in via **Settings → Agent Visibility**
  (`CompanySettings.agentVisibleRoleKeys` defaults to empty), and won't
  respond until at least one LLM provider/API key is added under
  **Settings → Agent providers**. Both are pure configuration, not code.
- File-upload-to-Drive from the agent chat (would need the Drive OAuth scope
  widened from `drive.readonly` to `drive.file`) — scoped, never started.
- Editing/updating existing records via the agent (as opposed to creating new
  ones) — never scoped or started.
- The mic button (Web Speech API) only renders where the browser implements
  `SpeechRecognition`/`webkitSpeechRecognition` — solid on Chrome/Edge,
  absent on Firefox and inconsistent on Safari/iOS. If customer traffic skews
  iPhone-heavy, this silently degrades to keyboard-only for a lot of users;
  worth revisiting with a server-side transcription fallback (e.g. Whisper
  via the already-configured LLM provider plumbing) if that turns out to
  matter.

---

## Changelog (condensed)

### Feature: Accounting-Lite Phase B — Credit/Debit notes (2026-08-28)
Second phase of `docs/ACCOUNTING_LITE_PLAN.md`, built immediately after
Phase A per the user's explicit "move on to B" instruction (in-app-agent
tool access for ledgers/credit-notes deliberately deferred to after all
phases). **Schema**: new `CreditNote`/`CreditNoteLineItem` models (own
gap-free `CRN/2026-27/0001` sequence via `DocumentSequence`, independent
counter from invoices/quotations/POs) and a `DebitNote` model (internal
only — free-text `noteNumber`, no statutory sequence, no issue/draft
lifecycle); `Invoice.creditNotes` back-relation added
(`add_credit_debit_notes` migration, diffed clean against both local and
production schemas — no drift). **New permission** `manage_credit_notes`,
seeded for Finance/Management/Owner-Admin/Super Admin (production grant via
direct SQL through Supabase MCP, same reasoning as Phase A's
`view_ledgers` — additive-only, didn't re-run the full seed against prod).
**Shared**: `CREDIT_NOTE_STATUS` (draft/issued/cancelled), `CREDIT_NOTE_REASON`
(return/rate_difference/deficiency/post_sale_discount/other),
`FINANCE_DOC_TYPE.CREDIT_NOTE` + `CRN` prefix in `documentNumber.ts`'s
maps, `creditNoteCreateSchema`/`creditNoteUpdateSchema`/`creditNoteCancelSchema`
(reusing the existing `lineItemSchema`), `debitNoteCreateSchema`/
`debitNoteUpdateSchema`. **Backend**: `apps/api/src/routes/credit-notes.ts`
— `credit-notes` sub-resource (list/create-draft/get/update-draft/delete-draft/
issue/cancel, gated on `manage_credit_notes`) plus a `debit-notes`
sub-resource (plain CRUD, no issue step); a credit note's total is validated
against its invoice's total at both draft-save time (early feedback,
counting all non-cancelled CNs) and issue time (authoritative check,
counting only other ISSUED CNs). **Settlement math extended, not
replaced**: `invoices.ts`'s existing `deriveInvoiceStatus(total, paid)`
helper is now always called with a NET total — `netInvoiceTotal(total,
issuedCreditNoteTotal)`, both now exported — so an invoice's status
(issued/partially_paid/paid) and outstanding balance account for issued
CNs everywhere status is derived (GET list/detail, PUT edit, payment
create/edit/delete) without changing what's stored on `Invoice.total`
itself; `financeDashboard.ts`'s `/summary` and `/reports/receivables` net
out issued CN totals the same way. **`ledger.ts` extended** at the exact
spot Phase A's code comment flagged: issued credit notes are now a
`credit_note` movement type in `buildCustomerLedger`, reducing the running
balance like a payment. **Frontend**: `/finance/credit-notes` (list +
create-draft modal, issue/cancel/delete actions, deep-linkable via
`?invoice=<id>`) and `/finance/debit-notes` (lighter list + create form,
per the plan's reduced priority for this piece); `invoices/[id]` gained an
issued-CN list, a "Credit notes issued" KPI, and a "Create credit note"
button (tax invoices only, issued/partially_paid/paid); `Nav.tsx` gained
Credit Notes and Debit Notes links. **Verification**: `tsc --noEmit` clean
on both apps, `next build` clean (all new routes compiled), full manual
`zan-app-api` deploy dance run (build took ~50 min this run, well over the
usual ~14-20 min — CPU/memory kept climbing the whole time so it was
verified alive via `Get-Process` polling rather than assumed hung; no root
cause investigated, noted here in case it recurs), new route's code
confirmed present in the build output before deploying, `@recd/shared`
patched into the same 3 spots as Phase A, `/health` → 200 and
`/credit-notes`, `/debit-notes`, `/ledgers/customer/:id` → 401 (not 404)
confirmed live in production. **Not yet done**: real click-through by a
Finance user (see Current open items) and the in-app-agent tool wiring
(explicitly deferred to the end of all phases).

### Feature: Accounting-Lite Phase A — party ledger statements (2026-08-28)
First phase of `docs/ACCOUNTING_LITE_PLAN.md` (read-only, zero behavior
change to anything existing, shipped alone per the plan's phase order).
**Schema**: `Customer.openingBalance`/`openingBalanceDate` and
`Supplier.openingBalance`/`openingBalanceDate` added
(`add_ledger_opening_balances` migration) — anchors a party's running
balance without needing historical invoice/payment data entry; both default
to 0 so this is fully additive. **New permission** `view_ledgers`
(`PERMISSION_KEY_FINANCE`), seeded for Finance/Management/Owner-Admin/Super
Admin (added directly to production `Permission`/`RolePermission` via
Supabase MCP, since `seed.ts`'s upsert pattern is additive but re-running
the whole seed against prod risks touching demo data — didn't do that).
**New backend**: `apps/api/src/services/ledger.ts` (`buildCustomerLedger`/
`buildSupplierLedger` — pure query composition, no new tables; merges
opening balance + issued invoices/payments-received (customer side) or
approved bills/payments-made (supplier side) into a date-ordered,
running-balance statement computed over full history then sliced to
`[from, to]`) and `apps/api/src/routes/ledgers.ts` → `GET
/ledgers/customer/:id` / `GET /ledgers/supplier/:id`, both `?from=&to=`.
`GET /customers` and `GET /purchase-orders/suppliers` now also accept
`view_ledgers` (previously gated to `manage_orders`/`manage_purchase_orders`
etc.) so a Finance-only ledger user can populate the party picker.
**New frontend**: `/finance/ledgers` (party-type toggle, party picker, date
range, statement table with running balance, Print + Export CSV via the
existing `ReportChrome`) — reads `?customer=<id>`/`?supplier=<id>` to
deep-link from a party's own page; wired into `Nav.tsx`'s Finance section.
Customer detail page (`/customers/[id]`) got a "Ledger" quick-link.
**Explicitly deferred to later phases** (per the plan): Credit/Debit notes
(Phase B) aren't in the ledger yet — `ledger.ts` has a natural extension
point (add a `credit_note` movement type) once `CreditNote` exists.
`PaymentReceived` doesn't yet carry `customerId`/`tdsAmount` (Phase C) — the
customer ledger currently joins payments through `invoice.customerId`,
which is correct today (every payment still requires an invoice) but will
need to switch to the direct FK once advances/TDS land.
Verified: `tsc --noEmit` clean both apps, `next build` clean (`/finance/ledgers`
built as a static route), production migration + permission grants applied
via Supabase MCP and spot-checked. **Not yet click-tested live** (standing
"agent can't log into admin-web" restriction) — owed: open `/finance/ledgers`
as a real Finance user, pick a customer with real invoices/payments, confirm
the running balance and Print/CSV export actually work.

### Feature: Customer Purchase Orders, plus native Gemini PDF extraction (2026-08-28)
**Customer Purchase Orders** — mirror-image of the existing outbound
`PurchaseOrder`-to-suppliers concept: new `CustomerPurchaseOrder` model (+
`CustomerPurchaseOrderLineItem` + `CustomerPurchaseOrderAuditLog`) recording
POs that CUSTOMERS send TO the company, with optional links to `Order` and
`Invoice` — recording one is always optional and never blocks
creating/invoicing an order (explicit product decision, confirmed via user
Q&A). New backend: `apps/api/src/routes/customer-purchase-orders.ts`
(list/create/extract/detail/patch/cancel, gated on the existing
`manage_orders` permission, no new permission added),
`apps/api/src/agent/customerPoExtraction.ts` (AI extraction mirroring
`billExtraction.ts` — same provider-loop-with-fallback, same fuzzy
customer-name matcher pattern, `findCustomerCandidates`), new Zod
schemas/constants in `packages/shared` (`CUSTOMER_PO_STATUS`,
`CUSTOMER_PO_AUDIT_ACTION`, `customerPurchaseOrder*Schema`), a
`create_customer_po` chat-agent write tool (9th write tool now) following
the same `AgentPendingAction`-then-`executeConfirmedAction`-confirm pattern
as every other agent write tool, and `computeCustomerPoTotals` (reuses
`computeDocumentTotals`, treats the doc as intra-state since there's no
placeOfSupply-driven IGST split on this simpler model, folds CGST+SGST+IGST
into one flat `taxAmount` field). New frontend: `/customer-pos` (list,
mirrors `/finance/vendor-invoices`), `/customer-pos/new` (upload +
AI-extract + manual entry, simpler than the vendor-invoice new-page — no
allocations, just optional single Order/Invoice link), `/customer-pos/[id]`
(detail with link/unlink-to-order/invoice actions, audit trail, cancel). Nav
entry gated on `manage_orders`.

Built on a different feature from the same session, done first: **native
Gemini PDF extraction**. The existing OpenAI-compatible-shim adapter
(`apps/api/src/agent/providers/openaiCompatibleAdapter.ts`) unconditionally
rejected non-image mimeTypes (including PDF) for every provider — which is
why "Extract with AI" was failing on PDF attachments for a Gemini-configured
provider even though Gemini's own native API supports PDFs directly. Added
`isGeminiBaseUrl()` + `extractDocumentViaNativeGemini()`: detects when the
configured provider's baseUrl points at `generativelanguage.googleapis.com`
and routes PDF/non-image extraction to Gemini's native `:generateContent`
REST endpoint (`inline_data` with base64 + `x-goog-api-key` header) instead
of the OpenAI-compat shim, which only supports images. Every other
provider's behavior is unchanged. This unblocked testing the Customer PO
feature with a real PDF (`po361.pdf`, a real customer PO from "Ojas").

Migration `20260827144444_add_customer_purchase_orders` applied to
production Supabase directly via `apply_migration` (project
`idqzupopsuusoihpmoqc`), same established pattern as prior sessions. Both
commits followed the backend-first deploy order (see "Established deploy
ordering rule" above): `zan-app-api` deploy dance run and confirmed live
before pushing each dependent `admin-web` commit. `tsc --noEmit` and
`next build` (all pages, including the 3 new customer-pos routes) both clean
before each push. See the deploy-dance section above for this session's
`@recd/shared` patch-spot findings (both `functions/index.func/` and
`functions/api/index.func/` present; 3 spots patched; build ~14 min) and the
`packages/shared` fresh-rebuild note.

### Work Orders: product selection for multi-RECD sites (2026-08-24)
New `WorkOrderProduct` join table; `createWorkOrderSchema` gains optional
`productIds` — a site's order can have more than one RECD unit (base product
+ line items, same shape `sites/page.tsx`'s `allProducts` helper already
handles), so a work order may need to target a subset rather than the whole
site. New Work Order form auto-selects the product when a site has exactly
one, shows checkboxes when it has several. Deployed backend-first (own
commit, held frontend until API confirmed live), then the UI commit.

### Site name/address surfaced on New Work Order form and Work Orders list (2026-08-24)
`Site.companyName`/`address` were already returned by `GET /sites` and
`GET /work-orders` (full Prisma rows, no `select` narrowing) but never
rendered. Added site name to the New Work Order site `<select>` (was
customer + address only) and a new Site column to the Work Orders
list/mobile cards. Frontend-only. Recurring pattern worth remembering: check
what the API already returns before assuming a display gap needs a backend
change — twice now (Silencer Type's precursor and this) the data was
already there.

### "HSN" relabeled to "SAC/HSN" across finance UI; Saved Items default SAC code (2026-08-24)
Relabeled across every quotation/invoice/PO line-item table, form, and the
Saved Items catalog — the print pages already said "SAC/HSN", the on-screen
forms just hadn't caught up. New Saved Items now default to **SAC 9987**
(maintenance/repair/installation services), since Saved Items are
structurally always service/installation lines, never goods — `Product`
still has no HSN/SAC field of its own (deliberately out of scope; HSN
belongs to the sale/goods side, SAC to installation/service, not a single
default value across the whole product catalog).

### Agent custom instructions, Saved Items catalog, per-customer negotiated pricing, Product.silencerType (2026-08-24)
Three features shipped the same day:
- **In-app agent custom instructions**: new
  `CompanySettings.agentCustomInstructions` free-text field, appended to the
  system prompt; base prompt also changed to ask what items are needed
  before drafting a quotation/invoice/PO instead of drafting immediately.
- **Saved Items catalog**: new `SavedLineItem` model + Settings page +
  `search_saved_items`/`create_saved_item` agent tools; confirm cards for
  finance-document write tools now show line items as checkboxes so items
  can be excluded before approving (`AgentChatBubble.tsx`'s
  `isLineItemArray`).
- **Per-customer negotiated pricing**: new `CustomerProductPrice`/
  `CustomerSavedItemPrice` models + Finance > Customer Pricing page +
  `get_customer_pricing` agent tool; auto-fills but stays editable in the
  quotation/invoice "New..." modals — added a product picker to the invoice
  modal in the process, since it never had one.
- Also added `Product.silencerType` (int, 1 or 2), shown as a column on
  Customer Pricing.

### Cancelled proforma invoice + its quotation couldn't be deleted (2026-08-24)
Bug: a cancelled proforma invoice and its quotation couldn't be deleted.
Root cause: invoices could never be hard-deleted at all (only cancelled),
and quotation-delete refused whenever any invoice — even a cancelled one —
existed for it. Fix: added `DELETE /invoices/:id`, gated to
`status === CANCELLED && invoiceNumber.startsWith("DRAFT-")` (i.e. never
issued a real sequential GST number via `POST /:id/issue`, so deleting it
can't create a numbering gap) — an invoice that *was* issued stays
permanently undeletable, as before. No change needed to quotation-delete:
its existing `invoices.length > 0` guard already allows deletion once the
invoice itself is gone.

### Deploy-dance investigation and CLI update (2026-08-24)
Diagnosed but did not fix the ~15-20 min `zan-app-api` build time — see the
root-cause writeup (nft tracing, `googleapis` size, two untried fixes) now
folded into the deploy-dance section above. Production DB migrations applied
directly via Supabase MCP (`idqzupopsuusoihpmoqc`), same established
pattern; tripped the classifier-blocks-then-succeeds-on-retry behavior (see
Known Gotchas) twice this session, not a new problem. The `@recd/shared`
deploy-patch dance moved to Vercel CLI 59.5.0 and changed failure mode again
— full detail folded into the deploy-dance section above.

### Same multi-RECD bug on the Orders list too, fixed identically (2026-08-20)
User confirmed the Sites fix (below) worked, then reported the same symptom
on Orders. Same root cause: `GET /orders` only ever included `product` (the
order's single top-level product), never `lineItems` — the detail route
already did, the list route never had. Fixed the same way: widened the list
query's include to `lineItems: { include: { product: true } }`, added an
`allProducts(o)` helper to `orders/page.tsx`, switched the Product column to
the `accessorList` capability `DataTable` gained for the Sites fix (no
further `DataTable.tsx` changes needed — the multi-value filtering machinery
already existed generically). Flagged as a pattern to check proactively:
`Order.lineItems` is easy to forget because `Order.productId`/`product`
looks like the whole story until a row has more than one RECD — not
established whether Quotations/Invoices/POs (separate line-item models) have
the same gap. Backend deployed and confirmed live before the frontend was
pushed (established ordering rule). `tsc --noEmit` clean on both apps.

### Sites list's Product column missed multi-RECD sites; DataTable gains multi-value filtering (2026-08-20)
User reported filtering Sites by Product didn't surface sites with multiple
RECDs. Same root cause as the agent-chat undercounting bug (2026-08-17,
below): the Sites list only ever read `order.product`, never
`order.lineItems` (the "add another RECD unit → same order" path) — so a
site whose only match for a filtered product was on a line item was
invisible to the Product column's display and filter. Fixed both ends:
backend `GET /sites` include widened to also fetch
`lineItems: { include: { product: true } }` (mirroring the detail route and
agent tools); frontend added an `allProducts(s)` helper and a new
`accessorList` column type. **`DataTable.tsx` gained a real new capability**:
`accessorList?: (row: T) => (value)[]` on `DataTableColumn` — when set, the
filter dropdown's options are the union of every row's values (not one
combined string per row) and a row matches if *any* of its values equals the
selected filter; cell/print text falls back to joining with ", " absent a
custom `render`. Generic capability now, reusable for any future multi-value
column. Backend deployed and verified live *before* the frontend push,
deliberately following the lesson from the Sites-crash incident below. `tsc
--noEmit` clean; not yet click-tested against a real multi-RECD site (local
dev DB had none to check against visually).

### DataTable print: full letterhead + landscape layout (2026-08-20)
User tried the new print feature and reported three problems: table wider
than the page (columns clipped), the browser's own print header showing
above everything, and the header being too compact vs. the invoice/PO
letterhead style. Three fixes in `DataTable.tsx`/`globals.css`: (1) full
letterhead copied from the invoice print page's markup (logo/legal
name/address + footer with `documentFooterNote`; `DataTable` now fetches
`/settings` itself rather than `useCompany`); (2) landscape via a named
`@page datatable-landscape` in `globals.css` assigned via the CSS `page`
property (only affects table-page prints; invoice/quotation/PO prints stay
portrait), plus a `.print-table.compact` modifier for the higher column
count; (3) the browser's own print header/footer (date/URL/page
number) **cannot be suppressed from CSS at all** — only the print dialog's
own toggle controls it; applied the same `document.title`-swap trick the
invoice print page uses so at least the printed title text is meaningful,
documented that the date/URL/page-number lines are unaffected. Frontend-only,
no deploy needed. Not yet re-confirmed with a fresh print preview.

### Print button (with company letterhead) on every DataTable page (2026-08-20)
User asked to print a filtered list "like a letterhead". Reused the Reports
section's existing `ReportChrome.tsx`/`useCompany()`/`ReportPrintHeader`
infrastructure rather than building new print plumbing — wired directly into
`DataTable`. Added a Print button (`window.print()`), a `title` prop per
page, and a `printSubtitle` computed from active per-column filters (e.g.
"Filtered by Customer: Acme Corp · Stage: Dispatched — 4 of 37 rows"). The
printed table includes only columns with an `accessor` (Actions columns are
automatically excluded) and renders each cell via the column's `accessor`
(plain text), deliberately ignoring custom `render` output (links/buttons/
badges) since those don't mean anything on paper — reused the existing
`.print-table`/`.print-doc` CSS so the printed list matches the
invoice/quotation/PO look. Added `print:hidden` across on-screen
table/mobile cards/headers/banners/KPI tiles/filter dropdowns on all 12
pages (sidebar/topbar were already `print:hidden`). Confirmed `/settings`
only requires `authenticate` (not `manage_settings`), so the letterhead logo
renders for every role. `tsc --noEmit` + full `next build` (33 routes)
clean. Not yet click-tested live.

### DataTable rolled out to all remaining list pages; self-run zan-app-api deploy fixes a real production Sites crash (2026-08-20)
Converted **Vendors, Orders, Invoices, Quotations, Purchase Orders, Expenses,
Users, Work Orders, Complaints** to `DataTable` (matching Sites/Customers/
Products from earlier), each hand-rolled `<table>` becoming a column config;
multi-line cells got a custom `render`; delete/edit buttons became an
`alwaysVisible`, non-filterable actions column; mobile card lists stayed
hand-written JSX but now driven by the filtered-rows render-prop.

**Before finishing, the user reported a real production client-side
exception on Sites.** The prior session's Sites columns
(Vendor/Product/Update-status) read `s.order.product.name` and
`s.stageEvents[0]` with no null-guard, correct once the backend deploys —
but that push landed the frontend change and the `sites.ts` backend
`include` change in one commit, and `admin-web` (auto-deploys instantly)
went live before `zan-app-api` (needs the manual dance) caught up, so
`order.product` was `undefined` for every real user until the backend
deployed. Local dev looked fine the whole time (local API dev server picks
up changes immediately), which delayed diagnosis. This is the incident
behind the "Known gotchas" entry on push-ordering above.

**This was also the first session able to run the manual deploy dance
itself** — prior assumption (baked into this file for weeks) was that only a
session with Desktop Commander access to the user's own machine could reach
`api.vercel.com`; confirmed reachable, `vercel pull` authenticated cleanly
against `ferose-salahudeen-s-projects/zan-app-api` with no token wrangling
(project already linked from a prior `.vercel/project.json`). Ran the full
dance end to end (~15 min build); the patch step needed updating for Vercel
CLI 59.1.4's new 3-spot layout (a first patch-script attempt silently
no-opped because it checked `node_modules`, which existed, rather than the
missing `@recd` scope folder one level deeper — fixed by explicitly
`New-Item`-ing `@recd` first). Verified live: `/health` → 200,
`/agent/providers` → 401. Also hardened the Sites page with null-checks
(renders "-" instead of crashing) as defense-in-depth.

### Reusable DataTable (column show/hide + per-column filter) on Sites, Customers, Products; four new Sites columns (2026-08-20)
Built `apps/admin-web/src/components/DataTable.tsx`: takes a column config
(`key`, `label`, `accessor`, optional `render`, `defaultVisible`,
`alwaysVisible`, `filterType: "select" | "text"`) plus `rows`, renders the
desktop table and hands the filtered row array back via a render-prop so
each page's existing mobile card list stays in sync with active filters.
**Column visibility**: "Columns" checklist (one column pinned
`alwaysVisible`), persisted per page in `localStorage` under
`zan-app:columns:<page>`, with "Reset to default". **Per-column filter**: a
second header row — `<select>` of distinct values for categorical columns
(exact match), or a substring-match text box for columns marked
`filterType: "text"` (mostly-unique fields like Order #/names/addresses).
Wired into Sites/Customers/Products only initially.

While rebuilding Sites, added four columns that didn't exist before:
**Address** (already fetched, never rendered), **Product**, **Vendor**, and
**Update status** — the latter clarified via a screenshot to mean the
*latest status update's status* (`SiteStageEvent.statusOption.label`), not
the SITC phase (`currentStage.phase`) — two genuinely different fields, easy
to conflate by name. Backend `GET /sites` include widened to
`order: { include: { product: true } }` plus
`stageEvents: { orderBy: { createdAt: "desc" }, take: 1, include: { statusOption: true } }`
(alongside existing `vendor: true`) — one query each, no N+1.
**Backend change — not live until the deploy dance runs**; the new/changed
columns render blank against production until then even though `admin-web`
deploys automatically.

First session with genuine local shell access to the user's machine (every
prior session was cloud/web, blocked from this) — verification went
further: `tsc --noEmit` clean on both apps, full `next build` clean, both
apps started locally against the user's own dev Postgres for real
click-testing before shipping. That surfaced the Tailwind-cwd and
`next start`-child-process gotchas (see Known Gotchas). No DB schema
changes this session — only an `include` widened.

### "Create Drive folders" still failing after the token-expiry fix — wrong scope, not auth (2026-08-18)
User confirmed the expiry fix (below) didn't fix the button. Checked the
token directly: valid, 200 OK, no expiry issue. Real problem: its scope was
`drive.readonly` only — `drive.files.create()` needs write access, which
`drive.readonly` categorically cannot grant. Likely broken since the
feature's first use, not a regression from the expiry fix — two different
problems that happened to overlap in time. The prior open item ("upload
needs `drive.file`") had already named the fix for a different feature
without anyone realizing folder creation needed the same widening. Updated
`getDriveRefreshToken.js` to request both `drive.readonly` (broad read, for
pre-existing shared documents) and `drive.file` (create/manage, scoped to
files the app creates) together, re-ran the loopback flow, and verified
end-to-end before shipping — actually calling `POST /drive/v3/files` to
create a real test folder and `DELETE` to remove it, not just decoding the
token's scope string. Redeployed (env-only change, reused existing prebuilt
output). Not yet re-confirmed by the user clicking the button live, but the
exact underlying Drive API call was just proven to work.

### Drive folder creation silently failing (expired OAuth token) + permanent fix (2026-08-18)
User reported "Create Drive folders" did nothing. Root cause:
`GOOGLE_DRIVE_REFRESH_TOKEN` had expired — confirmed by POSTing it to
`https://oauth2.googleapis.com/token`, which returned
`invalid_grant: Token has been expired or revoked` (the standing 7-day
Testing-mode expiry, see Quick facts). Two non-obvious facts: (1) the OAuth
client isn't in the Zan-APP Cloud project at all — it's `zan-app-agent-drive`
(Desktop-type) in a separate `MyPersonalAgent` project owned by
`ferosem@gmail.com`, not `zanfpowersystems@gmail.com` (which only owns the
Drive account being accessed); (2) it's a "Desktop" OAuth type, so there's no
redirect-URI field to add the usual OAuth Playground trick to — Desktop
clients use the **loopback flow** instead (any `http://localhost:<port>`
redirect works unregistered). Wrote `apps/api/scripts/getDriveRefreshToken.js`
(kept in the repo) — starts a local HTTP listener, prints a consent URL,
exchanges the code for a fresh refresh token when signed in as
`zanfpowersystems@gmail.com`.

Generated a new token, verified it live (direct POST to Google's token
endpoint) before shipping, updated it in both `apps/api/.env` and the
`zan-app-api` Vercel production env var, ran the full deploy dance
(`/health` → 200, auth-gated route → 401). **Then fixed the recurring
cause**: the OAuth consent screen was stuck in Testing publishing status,
which is why refresh tokens only lasted 7 days at all. Published to
production (Cloud Console → Audience → Publish App, as `ferosem@gmail.com`,
project `MyPersonalAgent`); a second freshly-minted token no longer carries
a `refresh_token_expires_in` field at all (the first explicitly showed
`604760` seconds = 7 days). Still shows Google's "unverified app" warning on
re-consent (Drive scopes need review to fully verify, not pursued) — just a
click-through now, not a hard wall. Not yet click-tested as a logged-in user.

### Agent chat undercounted RECDs after the multi-RECD-per-site feature shipped (2026-08-17)
User reported the chat agent answering "1 RECD unit" for BPCL's Desur site
when there should have been more, after `OrderLineItem` rows were added to
consolidate duplicate sites into one order (`d7b7381`, same day). Confirmed
against production: `ORD-2026-6001` correctly has its top-level product
(RECD-200 qty 1) plus two `OrderLineItem` rows (RECD-250, RECD-400) — 3
RECDs total, data was right, the agent just never looked at it. Root cause:
`d7b7381` added `OrderLineItem` as a way to put multiple RECDs on a site but
never touched the two agent tools that answer "how many RECDs at X" —
`search_orders_and_sites` and `get_document_detail`'s `docType: "order"`
case only queried the order's single top-level `product`/`quantity`, no
`lineItems` in their Prisma `include` at all. Fixed both tools to
`include: { lineItems: { include: { product: true } } }`, returned as
`additionalLineItems`, and tightened the tool description to explicitly
tell the model to sum base quantity + every line item's quantity. `tsc
--noEmit` clean. **Backend-only, needed the deploy dance** — not deployed
this (cloud) session, same standing blockers as every prior cloud session.

### Verified a user-uploaded delivery-status spreadsheet against production; found the delivery-tracking table is mostly empty (2026-08-17)
User uploaded `Material_Delivery_Status_version_1.xlsx` and asked whether it
had been imported correctly, specifically flagging "Bostik 2 recd". Read
with pandas (neither pandas nor markitdown were preinstalled despite the
xlsx skill's notes). Cross-checked every row against production via the
Supabase MCP: sheet uses blank-cell row grouping (a named row followed by
unlabeled rows for additional products at the same site) — confirmed via the
first group (BPCL/Zadshahapur) before trusting the pattern further. **Bostik
was correct as-is, not a bug** — DB has exactly one Bostik order matching
the sheet's one row exactly; the row that might read as a second Bostik item
actually belongs to Mahindra Aerostructures/Narsapur (which genuinely has
two separate RECD-380 orders) — reported the distinction rather than
assuming. The real finding, now in Current open items: `RecdDelivery` (built
"to match the source delivery-tracking sheet") is almost entirely
unpopulated — see that section for detail. Sheet has zero contact-detail
columns at all, so nothing about contacts could have come from it (checked
separately that Ethen Power Solutions' own contact *is* on file). Read-only
investigation, no code/data changes.

### Vendor archive: deactivate without losing history, with optional site reassignment (2026-08-17)
User hit the "no `DELETE /vendors/:id`" gap directly while testing. On
hearing the tradeoff of a real delete — a shared placeholder "History
Vendor" would merge every removed vendor's track record into one bucket,
losing the "was this specific vendor good or bad" signal the user's actual
reason (catching malpractice after the fact) depends on — chose **archiving
instead of deleting**: the vendor row and everything tied to it stays fully
intact, it just drops out of active use.
1. New `VENDOR_STATUS.ARCHIVED`; `Vendor` gets `archivedById`/`archivedAt`
   (mirrors `approvedById`/`approvedAt`) via a migration applied directly to
   production via the Supabase MCP.
2. `POST /vendors/:id/archive`, optional body `{ reassignSitesToVendorId }`.
   In one transaction: optionally bulk-moves the vendor's `Site.vendorId`
   rows to a different, currently-approved target vendor, deactivates every
   member login (`isActive: false`), then flips the vendor to `archived`.
3. Every "active" vendor dropdown already filters on `status === "approved"`
   (site-vendor assignment, erection-engineer-add, OTP eligibility in
   `auth.ts`), so archived vendors fall out for free.
4. **Found a real pre-existing gap**: the plain `POST /login` (password)
   route only ever checks `user.isActive`, never `vendor.status` — unlike
   OTP, which does check `status === "approved"`. A *rejected* vendor's
   engineer has apparently always been able to keep logging in with a
   password. Archiving closes this for archived vendors (via
   `isActive: false`, which both login paths respect) but the same gap still
   exists for `rejected` vendors, untouched here — flagged, not fixed
   (changes existing behavior for whoever's relying on it).
5. **Deliberately no one-click "un-archive" in the UI**: calling the
   existing `/approve` route on an archived vendor would flip status back,
   but `createVendorContactLogin` only creates a login for an email that
   doesn't already exist — it won't reactivate the `isActive: false` row.
   Exposing "Reinstate" would produce a vendor that looks active but whose
   engineer still can't log in. Reactivating a mistakenly-archived vendor
   today means manually flipping status via API/DB and separately
   reactivating the `User` row(s).
6. Frontend: **Archive** button (approved vendors only) with a confirmation
   modal showing site count, a reassign-to dropdown, and a result banner;
   gray badge for archived state.
Verified: `tsc --noEmit`, production `tsc` build clean, full `next build`
(34 routes), migration applied and confirmed live via direct column query.
Deployed and confirmed working 2026-08-17 — the user ran the deploy dance
themselves and successfully archived a real vendor through the live UI.
Took two attempts due to the stale-build-output and Notepad-save-location
gotchas already documented in the deploy-dance section above (not new code
bugs — pure operator/tooling friction).

### Every delete action in admin-web falsely reported failure (2026-08-16)
User deleted a stale test order and got
`Failed to execute 'json' on 'Response': Unexpected end of JSON input`.
Checked production directly: the order was actually gone — the delete had
succeeded, the error was a lie. Root cause: `DELETE /orders/:id` (and 7
other delete routes — expenses, customers, products, quotations, agent
providers, agent conversations, site contacts) correctly respond `204 No
Content` with an empty body, but `apiClient.ts`'s shared `api()` helper
unconditionally called `res.json()` on any `res.ok` response, which throws
on an empty body — so **every delete button in the app** reported failure on
success. Fixed by reading the response as text first and only
`JSON.parse`-ing if non-empty; no caller reads a DELETE call's resolved
value. Frontend-only, ships via normal auto-deploy, no `zan-app-api` deploy
needed. Not yet verified live (standing restriction).

### create_purchase_order code-reuse fix, and re-confirming the cloud-session deploy blockers (2026-08-16)
Extracted `createPurchaseOrderRecord(tx, input, createdById, poNumber, companyState)`
in `purchase-orders.ts` (exported like `createQuotationRecord`), pointed
both the real `POST /purchase-orders` route and the agent's
`executeConfirmedAction` dispatch at it — removing duplicated inline
line-item construction. Also fixed a small real asymmetry: the duplicated
agent-side version generated the PO number and created the row in two
separate `prisma.$transaction` calls, while `create_quotation`'s confirm
handler already wrapped both in one transaction — now purchase orders do
too (closes a very unlikely gap where a number could be allocated without a
matching PO being created). Behavior-neutral otherwise. `tsc --noEmit` and
production `tsc` both clean. Independently re-verified this cloud session
still cannot run the deploy dance (`api.vercel.com` network-blocked,
`list_agents` found no hand-off session) — stacked two undeployed
`zan-app-api` fixes on `master` at this point (this one + the customer-role
Users-guard below).

### Customer email-OTP silently never sending: root cause + guard against recurrence (2026-08-16)
User reported requesting an email OTP for `zanfpowersystems@gmail.com` and
never receiving it, no error either. Root cause: that email existed as a
`User` row (role `customer`) with `customerId` = null. The email-OTP
eligibility check requires `customerId` set for a customer-role account;
when null, the request falls through to the deliberately-generic "if that
email is registered..." response *without* creating an `OtpCode` row or
sending anything (by design, to avoid leaking which emails are registered) —
silent dead end for a broken account. How it happened: the generic "Add
user" form on the Users page lets staff pick any role including "Customer",
but `POST /users` never touches `User.customerId` — only real customer
contacts created via the Customers page get it set. Picking "Customer" from
Users has always silently produced a login that can never work. Fixed two
ways (UI guard alone doesn't stop a direct API call): `POST /users`/
`PUT /users/:id` now reject `roleKey: "customer"` outright; "Customer" also
filtered out of the Users-page role dropdown (Add and Edit). Verified no
other table referenced the broken row before deleting it directly via the
Supabase MCP (one-off prod cleanup, not part of the diff). `tsc --noEmit`
and full builds clean. Cloud/web session — only the `admin-web` half
(dropdown removal, `31d2955`) is live; the `zan-app-api` half needs the
deploy dance, not runnable from this session.

### Copy button on assistant chat responses (2026-08-16)
Added a "Copy" control under every assistant message in
`AgentChatBubble.tsx` (async Clipboard API, `execCommand` fallback for
non-secure contexts, brief "Copied" confirmation) — copies the response's
raw markdown text. Admin-web only.

### Reports section: SITC status, finance, customer history, vendor performance (2026-08-16)
Four report types under a new **Reports** nav item (`/reports`, promoted
from the disabled "Coming Soon" placeholder): (1) **Sites/SITC status**
(`/reports/sitc`) — every order+site with current stage, filterable by
order-date range/customer/vendor/phase; (2) **Finance summary**
(`/reports/finance`) — receivables/payables aging, GST summary, revenue vs.
expenses; (3) **Customer/order history** (`/reports/customer-history`) —
every order/site/invoice/complaint for a picked customer; (4) **Vendor
performance** (`/reports/vendor-performance`) — every site assigned to a
picked vendor, a stage-breakdown KPI row, complaints on their sites.
**Deliberately zero new backend routes** — composed client-side from
existing endpoints (`/sites`, `/customers`, `/customers/:id`,
`/invoices?customerId=`, `/complaints` filtered client-side since the route
only scopes by the caller's own `customerId`, `/vendors`, and the existing
`/finance/summary` + `/finance/reports/*` endpoints) — shipped via plain
`git push`, no deploy dance. Each report has a **Print** button
(`window.print()`, same pattern as invoice/PO print pages — deliberately not
server-side Playwright/puppeteer, which would risk the native-binding
startup crash the pdf-parse fix below was built to avoid) and an **Export
CSV** button (`lib/csvExport.ts`, dependency-free Blob download, no new npm
package). Shared `components/reports/ReportChrome.tsx` provides the
print-only letterhead and toolbar for all four pages. Verified via `tsc
--noEmit`, full `next build` (33 routes), `next start` + curl 200 on all
four — not exercised as a logged-in user (standing restriction). Also: this
was a fresh clone with no `node_modules` — first bare `npm install`
succeeded cleanly in ~60s including the `packages/shared` postinstall build,
no arborist/EPERM issues that time.

### Merged the mobile-built customer-agent branch, live-tested it as a real customer, found and fixed two bugs (2026-08-15)
User said they'd already built customer chat access "yesterday, via my
mobile app" — found `origin/claude/customer-agent-scoping-voice`, a single
commit based on the previous session's last commit (see 2026-08-14 entry for
what it contained). Reviewed the diff (security pattern correct throughout —
`customerId` always read from `auth.customerId`, never from tool input),
merged (clean fast-forward), then actually logged in as a real seeded
customer and used it. Live testing found two bugs tsc/build alone couldn't
catch:
1. **Chat bubble never mounted for customers at all** — `AuthGuard.tsx` only
   rendered `<AgentChatBubble />` in the staff sidebar branch, not the
   customer-portal branch. Fixed by rendering it in both.
2. **`create_complaint`'s documented siteId-lookup fallback was unusable** —
   its own description said to look up siteId via `search_orders_and_sites`,
   but that tool never returns `site.id`; the fallback, `get_document_detail`,
   required `MANAGE_ORDERS` unconditionally for `docType: "order"`, which no
   customer has, with no customer-scoped branch. A customer literally could
   not resolve a siteId through either documented path. Fixed by adding the
   same `auth.customerId`-scoped pattern already in `search_orders_and_sites`:
   customers get `VIEW_SITE_STATUS`-gated access to their own order
   (object-level check against the fetched row's `customerId`), staff keeps
   unscoped `MANAGE_ORDERS` access.
Verified end-to-end as the real customer: chat bubble renders with
customer-specific copy, `search_orders_and_sites` returns only their own 4
orders (a real other customer's name returns nothing), Drive tools refuse
them, `create_complaint` works fully and creates a correctly-scoped
`Complaint` row (verified via DB, not just the UI). Also directly attempted
to force a complaint onto another real customer's siteId via a crafted API
payload (bypassing the chat UI) — correctly rejected, zero rows created,
confirmed via DB. Deployed both apps and verified `/health` live. **The
Settings → Agent Visibility toggle for Customer is still off in
production** — deliberately left for the user to enable when ready.


### Customer-facing agent tools, Drive-tool lockdown, and a mic button (2026-08-14)
Prompted by the user asking what would happen if Customer agent visibility
were turned on. Found the agent's tool-permission model was staff-only by
construction: the 3 Drive tools had no permission check at all, while every
zanApp tool gated on a `manage_*` permission Customer never has — a customer
would've gotten the whole shared Drive folder exposed but zero ability to
see their own order/site status despite holding `VIEW_SITE_STATUS`/
`RAISE_COMPLAINT`. Fixed as four pieces, all still behind the existing
Agent Visibility toggle (opt-in per role, defaults to nobody):
1. **Drive tools now refuse any customer outright** (checked via
   `auth.customerId` being set — the signal only ever populated for the
   Customer role). No per-customer Drive partitioning exists, so "no access"
   rather than false scoping.
2. **`search_orders_and_sites` branches on `auth.customerId`**: a customer
   gets `VIEW_SITE_STATUS`-gated results forced to
   `where: { customerId: auth.customerId, ... }` — can search within their
   own orders/sites, a query for another company's name returns nothing.
   Staff behavior unchanged.
3. **New `create_complaint` write tool**, confirm-gated like the others.
   Extracted the REST route's ownership check and creation+notify logic into
   two exported functions (`assertOwnSite`, `createComplaintRecord`) shared
   by the route, the tool's propose-time validation, and confirm-time
   dispatch — one implementation, not three. `customerId` always from
   `auth.customerId`, re-verified against the site's owning order at both
   propose and confirm time.
4. **Role-aware system prompt** (`buildAgentSystemPrompt(isCustomer)`) — a
   customer's turn describes only their two tools and forbids implying
   unreachable data doesn't exist; staff prompt unchanged.
5. **Mic button** on the chat input (Web Speech API, client-side only,
   transcribes into the existing input state) — feature-detected, simply
   doesn't render where unsupported (Firefox, most Safari/iOS). Empty-state
   copy is now role-aware.
Verified via `tsc --noEmit`, production `tsc`, full `next build` (23
routes) — not yet exercised against a live logged-in customer session (toggle
still off then, as now).

### In-app agent location-search bug, and the chat bubble rendering raw markdown (2026-08-14)
1. **Agent falsely claimed a location "doesn't exist"** — asked about
   Belgaum, replied it "does not exist" despite several real Belgaum sites.
   Root cause: `search_orders_and_sites` only ever matched `orderNumber` and
   `customer.name`, never `site.address`/`site.companyName`, and didn't
   return address either. Fixed the query's `OR` and its results. Also
   tightened the system prompt: a zero-result search must be reported as "no
   matching records", not escalated to "X doesn't exist" (a search can't
   prove absence), and the agent can't claim to have "searched every module"
   unless it actually called a tool for each one.
2. **Retested in the same thread → still wrong** — not a regression:
   conversation history persists per thread and the model reused its own
   prior (pre-fix) tool result instead of re-invoking the tool. Confirmed the
   fix was correct by querying production directly. **Lesson: verify an
   agent-behavior fix in a new conversation thread — old history can
   outweigh a corrected tool.**
3. **Chat bubble showed raw markdown as literal text** — `AgentChatBubble.tsx`
   rendered `m.content` in a plain `whitespace-pre-wrap` div with no parsing.
   Added `react-markdown` + `remark-gfm` with compact styling. Hit the
   react-markdown v9 "node" prop gotcha: custom components receive the mdast
   AST node as a prop, and naively spreading `{...props}` onto the real DOM
   element leaks a literal `node="[object Object]"` attribute — **always
   destructure `node` out first** in any custom react-markdown component.

### Real email delivery, two new notifications, customer login simplified (2026-08-14)
The email+OTP flow was already fully built, but `EmailProvider.send()` was a
stub that only `console.log`'d — **no email had ever actually been sent by
this app**, despite the README claiming otherwise.
1. **Real SMTP wired up** — `lib/email.ts` (`nodemailer`), sending as
   `info@zanf.org` via Zoho Mail (`smtp.zoho.in`). `emailTemplates.ts`
   renders bespoke copy for `otp_code`; everything else falls through to a
   generic key/value rendering. Hit the `npm install <pkg>` arborist bug
   installing `nodemailer` — worked around per the gotcha above.
2. Verified end-to-end against the real Zoho account: confirmed
   `NotificationLog` rows with `status: "sent"`, and a full
   `/auth/email-otp/request` → `/verify` round trip through the real route.
   Set the same SMTP credentials as production env vars via
   `vercel env add ... production` and ran the deploy dance.
3. **Two new/completed notifications**: customer-on-stage-change
   (`site_stage_updated` already existed, just needed real send + better
   copy) and vendor-on-assignment (`vendor_assigned_site`, new —
   `POST /sites/:id/assign-vendor` never notified anyone before; now emails
   every member of a *newly* assigned vendor, not on a no-op re-save or
   clear-to-unassigned).
4. **Login page simplified** — "Track Order" tab renamed "Customer"; Order
   ID + phone flow removed from the UI (Email + OTP only, "for now") —
   backend routes left untouched (see Current open items).

### Customers/Products/Vendors CRUD, real data import, first end-to-end deploy of both apps (2026-08-13)
1. **Customers**: `PUT`/`DELETE /customers/:id` (delete guarded against
   existing orders/quotations/invoices/complaints), `/customers/[id]` detail
   page listing every order+site.
2. **Products**: new page from scratch — full CRUD + `/products/[id]`
   detail. Added `shape` (`cylinder`/`triangle`/`rectangle` enum),
   `dimensions` (free text, deliberately not split into
   length/width/height/diameter since the right fields differ per shape),
   `weightKg`.
3. **Stale-modal bug**: the `?edit=<id>` deep-link re-opened the modal right
   after saving, since saving reloads the list while the query param is
   still in the URL, re-triggering the watching `useEffect`. Fixed in both
   `customers/page.tsx` and `products/page.tsx` with a ref tracking which id
   was already auto-opened.
4. **Pre-existing build-blocking bug found only when actually deploying**:
   `orders.ts`'s `new Date(data.orderDate)` failed `tsc` since `orderDate` is
   optional/nullable (to support bulk-imported operational orders without
   commercial figures yet) — invisible to `--noEmit` since nothing in this
   session's changes touched the line, but caught immediately by
   `vercel build --prod`'s own `tsc` step. Fixed by mirroring the existing
   `promisedDeliveryDate ? new Date(...) : undefined` pattern.
5. **First full production deploy of this session's branch** — merged
   `feature/site-import-drive-documents` to `master`, pushed, applied the
   `Product.shape`/`dimensions`/`weightKg` migration to production via the
   Supabase MCP, ran the full deploy dance (needed fix #4 above). Verified
   via `/health` → 200 and `/products`/`/customers/:id` → 401.
6. **Real product catalog import** — 30 RECD KVA variants imported from
   `RECD_Full_GA_Extraction.xlsx` directly into production via the Supabase
   MCP. `RECD-250` (had a real order attached) was **updated in place**
   rather than deleted despite the user's "delete the existing products,
   they were test" instruction — the delete-guard would have refused it
   anyway. The other test row (`recd`/`triangle`, 0 references) was deleted
   as genuine junk.
7. **Real site data import** — 29 orders+sites imported for "Ethen Power
   Solutionns Private Limited" from a local `Site and location Ethen.xlsx`,
   matched to the product catalog by KVA. One row's KVA (810) didn't exist
   in the master GA extraction and had dimensions identical to a nearby 910
   KVA row — flagged to the user as a likely typo; user confirmed it was
   genuine, so `RECD-810` was created as a new product rather than skipped
   or coerced.
8. **`Site.companyName` was stored/returned by the API but never rendered**
   except a buried edit field — surfaced by the Ethen import. Added to Sites
   list, Site detail (now the page header), Orders list, Order detail, and
   Customer detail's per-order site cards.
9. **Staff can now add a vendor directly** — previously only public
   self-registration → pending → staff approve/reject existed, no path for
   staff to add an already-known-and-trusted vendor. Added `POST /vendors`
   (reusing the existing `manage_vendors` permission, confirmed via direct
   query before coding since the ask sounded like a permissions gap but
   wasn't) that creates the vendor pre-approved with an immediate contact
   login, reusing the `/approve` route's login-creation logic.

### Finance module — built from scratch (2026-07 → 2026-08)
Zan-APP's Prisma schema originally had no accounting/invoicing tables at
all. Built out over several sessions: Quotations, Invoices (proforma + tax
invoice, issue/payment/edit-with-audit-log flows, TDS as a payment method,
multi-row payment recording), Purchase Orders, Expenses, and a Finance
dashboard — all sharing GST-aware `computeDocumentTotals` (CGST+SGST
intra-state, IGST inter-state) and a shared `nextDocumentNumber()` sequence
generator (`DocumentSequence` table) so document numbers stay strictly
gap-free per financial year. Product-catalog-backed line items require
description/HSN/qty/price/tax; free-text ("no product") lines are allowed
but can't later convert into an Order.

Recurring bug pattern, hit **three separate times** (PO HSN field,
quotation Product picker, invoice edit line-items): a field existed
correctly in component state and the API payload, but the actual
`<input>`/`<select>` was never rendered in JSX — data silently never made it
in from the UI even though the backend fully supported it. Worth
specifically checking for "field in state but not in JSX" whenever a report
says "I can't set X" on any document form.

Production data hygiene: real invoices entered and sample/seed data removed
(2026-07); a later full pass (2026-07-29) wiped all remaining test/sample
orders, sites, vendors, complaints, work orders, and 4 leftover test-user
logins from production, leaving only 4 real invoices and 2 real staff logins
(Super Admin + Finance) — last deliberate clean-slate reset before real
usage began.

### Print/PDF layout (2026-07-21 → 2026-07-25)
Quotation/Invoice/PO print pages went through several redesign iterations
(header/footer contact fields, terms-as-editable-bullets, a running
header/footer tried then reverted for overlapping content, background-
graphics and font fixes). Final state: single non-repeating header/footer,
bundled Tinos font, editable per-document terms and footer note. **Lesson
that stuck**: verify print output via a real Playwright PDF render, not
on-screen checks alone — that's what caught the background-graphics bug.

### In-app AI agent — built and deployed (2026-08-09 → 2026-08-12)
Floating chat-bubble assistant, backend in `apps/api/src/agent/`, built in
stages:
1. **Google Drive document search** — `googleDrive.ts`/`docExtract.ts`/
   `driveSearch.ts`, searches `ZanF_DropBox`, extracts PDF/DOCX text (PDF
   extraction is a lazy dynamic import — see the pdf-parse crash below).
2. **Multi-provider LLM support** — `AgentLlmProvider` table (AES-256-GCM
   encrypted API keys via `AGENT_SECRETS_KEY`), any Anthropic or
   OpenAI-compatible provider (OpenAI/Gemini/Groq/DeepSeek/OpenRouter/
   Together/NVIDIA/custom), automatic fallback across providers in priority
   order on failure, a live model-picker in Settings.
3. **Chat bubble + persistence** — `AgentConversation` table (JSON message
   blob per thread), Super-Admin-only visibility toggle
   (`agentVisibleRoleKeys`), a daily Vercel Cron (`CRON_SECRET`-protected)
   deleting conversations older than 30 days.
4. **9 read tools + 1 detail tool** (customers/vendors/quotations/invoices/
   POs/expenses/orders-sites/work-orders/complaints, each mirroring its REST
   route's exact permission and row-level scoping) plus **4 confirm-gated
   write tools** (`create_expense`, `create_purchase_order`,
   `create_quotation`, `create_invoice`) on a reusable `AgentPendingAction`
   infrastructure — the agent proposes with a human-readable preview, only an
   explicit confirm click actually writes, using the exact same create logic
   as the real REST routes.
5. **HSN/SAC made mandatory everywhere** (2026-08-11) after the write tools
   were observed inventing plausible-but-fake HSN codes — fixed at the
   shared Zod schema level (`lineItemSchema.hsnCode` now required), closing
   the gap for the agent and every create/edit form at once, plus fixed the
   root cause: the PO create form had the same "field in state, missing from
   JSX" bug.
6. **First production deploy** (2026-08-12) — three missing Prisma
   migrations applied directly to `zan-app` Supabase, `CRON_SECRET` set on
   `zan-app-api`, deploy dance run for the first time for this code. A stale
   type bug (`hsnCode?: string` vs. the now-mandatory `hsnCode: string`) was
   caught and fixed in the process.
7. **First deploy crashed on boot** — found via `vercel logs`, not a user
   report. `docExtract.ts` had a static top-level `import { PDFParse } from
   "pdf-parse"`; `pdf-parse` tries to load an optional native
   `@napi-rs/canvas` package, unavailable on Vercel's Linux runtime, and its
   fallback throws `ReferenceError: DOMMatrix is not defined` **at
   require-time** — on the startup import chain, so that one throw crashed
   the entire API including `/health`. Fixed by making the `pdf-parse`
   import a **dynamic `await import()`** scoped inside the PDF-extraction
   branch, wrapped in try/catch, confining any future failure to "PDF
   extraction unavailable" instead of an app-wide outage. **General lesson:
   any dependency with optional native bindings should be dynamically
   imported, not statically, if it sits near a serverless app's startup
   chain.**
Fully live in production as of 2026-08-12, gated behind the two Settings
configuration steps (agent visibility + at least one LLM provider).

### Quotation → Order conversion was completely broken (2026-08-12)
Clicking "Convert to order" on an accepted quotation always failed with
`400 Quotation needs at least one line with a product`. Same "field in
state, missing from JSX" pattern as the PO/HSN bug: neither the New nor Edit
quotation modal ever rendered a Product `<select>`, so no quotation could
ever have a `productId` set, and every Edit save silently stripped
`productId` off existing lines too. Fixed by adding the missing dropdown to
both modals (frontend-only). Shipped via normal `admin-web` auto-deploy.

### Quotations couldn't be deleted (2026-08-12)
No delete capability existed anywhere for quotations. Added
`DELETE /quotations/:id` (refuses if already converted to an order or has
an invoice/proforma created from it, so real financial records can never be
orphaned) plus a Delete button on both the list and detail page. Backend
route — needed the full deploy dance; verified live
(`DELETE /quotations/<fake-id>` → 401, confirming the route exists).

---

*History prior to 2026-08-12 was condensed into the changelog above from a
much longer section-by-section log (originally §1–§66). If a specific
historical decision's full rationale is needed and isn't captured here, it's
recoverable from git history on this file.*

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

> **Session boundary (2026-08-20, later):** working tree clean, `master`
> pushed to `origin`, and - a first for this file - **the `zan-app-api`
> backend was deployed by the session itself**, not handed off to the user.
> **This was the first session with real local filesystem/shell access to
> the user's own machine** (not the "cloud session" pattern every prior
> entry below warns about), and it turned out `api.vercel.com` is actually
> reachable and the CLI already authenticated against the right project -
> so the full manual deploy dance was run start to finish in-session for
> the first time ever recorded here.
>
> Built a reusable **`DataTable`** component
> (`apps/admin-web/src/components/DataTable.tsx`) - per-column show/hide
> (persisted per page via `localStorage`) and a per-column filter row
> (dropdown of distinct values for categorical columns, free-text search for
> columns marked `filterType: "text"`) - and rolled it out to **every list
> page**: Sites, Customers, Products first, then Vendors, Orders, Invoices,
> Quotations, Purchase Orders, Expenses, Users, Work Orders, and Complaints
> in the same session. Sites also gained four columns that didn't exist in
> the table before: **Address**, **Product**, **Vendor**, and **Update
> status** (the label from the site's most recent "Post a status update"
> entry - `SiteStageEvent.statusOption.label` - deliberately different from
> **Stage**, which is `currentStage.label`).
>
> **Mid-session, the user reported a real production crash** on Sites -
> caused by `admin-web`'s auto-deploy (instant on push) going live with
> code that assumed `order.product`/`stageEvents` always exist, while
> `zan-app-api` (needs the manual dance) was still on the old query shape.
> Root-caused, then fixed two ways: deployed `zan-app-api` (confirmed live -
> `/health` → 200, `/agent/providers` → 401), and hardened the Sites page
> with null-checks so a future deploy-order gap degrades instead of
> crashing. See "Known gotchas" for the durable lesson (don't push a
> `admin-web`+`api` change together assuming they deploy in lockstep - they
> don't) and the changelog for the full story. **Not yet re-confirmed by the
> user that Sites is clean in production post-deploy** - owed, see Current
> open items.
>
> **No DB schema or migration changes this session** - only Prisma
> `include` widened on an existing query - so there was nothing DB-side that
> could conflict between local test data and production, despite the local
> vs. prod confusion above (that was a code/deploy-timing issue, not a data
> one).
>
> Four build/process/deploy gotchas worth knowing for next time, all new
> this session (see "Known gotchas" and the deploy-dance write-up above for
> full detail): (1) `next build` for `admin-web` must run with cwd actually
> inside `apps/admin-web` or Tailwind silently emits near-empty CSS: (2)
> `next start`'s real server is a child process, not the PID
> `Start-Process` returns - kill by port, not launcher PID; (3) the
> `@recd/shared` patch step's spot list changed with a newer Vercel CLI (3
> spots now, not 5 - see the deploy dance section); (4) pushing `admin-web`
> and `apps/api` changes together assumes they deploy together, which is
> false and caused the production crash above.
>
> Start a new session by reading this file top to bottom before touching
> anything - "Current open items" and the top of "Changelog" are the
> fastest way back up to speed.

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
4. `npx vercel build --prod` — **takes 15–20 minutes**, almost entirely spent
   in Vercel's `@vercel/nft` file-tracing step, not in `tsc` (which alone
   takes ~15s). CPU/memory climb steadily the whole time — that's normal, not
   hung; confirm via `Get-Process`/`Get-CimInstance` polling if unsure. Worth
   piping to a log (`... 2>&1 | Tee-Object -FilePath build.log`) so you can
   `Select-String -Path build.log -Pattern "error" -SimpleMatch` afterward
   instead of assuming a long build that finished must have succeeded.
5. **If this deploy adds/changes a route, verify it's actually in *this*
   build's output before deploying** - don't rely on step 8's "401 not 404"
   check alone for a *new* route (see why below):
   `Select-String -Path ".vercel\output\functions\api\index.func\apps\api\dist\routes\<file>.js" -Pattern "<distinctive string from the new code>"`.
6. **Patch `@recd/shared`** into the spots the npm-workspaces symlink doesn't
   survive Vercel's Windows-symlink-unaware function tracer — this step is
   required after every fresh build, since each build's own install step
   wipes it. **As of Vercel CLI 59.1.4 (2026-08-20) this is only 3 spots, not
   the 5 an earlier CLI version needed** - `.vercel/output/functions/`
   now contains only `api/index.func/` (everything is rewritten to
   `/api/index` per `vercel.json`); the old bare `functions/index.func/`
   target from prior write-ups no longer exists in the output at all, and
   trying to patch into it is a silent no-op (its parent directory doesn't
   exist - skip it, don't create it). The 3 real spots, confirmed
   2026-08-20:
   - `apps/api/node_modules/@recd/shared`
   - `.vercel/output/functions/api/index.func/node_modules/@recd/shared`
   - `.vercel/output/functions/api/index.func/apps/api/node_modules/@recd/shared`
   **The `@recd` scope folder itself doesn't exist yet in a fresh build** -
   a patch script that only checks/overwrites the final `shared` folder
   (assuming its parent `@recd` dir is already there) silently no-ops on
   all three, since `Test-Path` on the *parent* of `@recd/shared` (i.e.
   `@recd` itself) correctly reports missing, but a script that instead
   checks the *grandparent* (`node_modules`, which does exist) will think
   the target is patchable and then fail to actually create anything - the
   `@recd` intermediate directory must be `New-Item -ItemType Directory`'d
   before copying into it. Always re-verify the exact spot list by checking
   what actually exists in *this* build's `.vercel/output/functions/`
   tree rather than trusting a prior session's list blindly - Vercel CLI
   upgrades have already changed this layout once.
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

- **Pushing a single commit that touches both `admin-web` and `apps/api` is dangerous if the
  frontend change depends on a new/changed API field.** `admin-web` auto-deploys the instant
  `git push` lands; `zan-app-api` does not deploy until someone runs the full manual dance,
  which can be minutes to hours later. **Confirmed as a real production outage 2026-08-20**:
  a commit added `order.product`/`vendor`/`stageEvents`-dependent columns to the Sites page
  *and* the `sites.ts` `include` that supplies them, in the same push - `admin-web` went live
  immediately with code calling `s.order.product.name` (no optional chaining, since the field
  was assumed always present), while production's API still returned the old shape without
  `product` on `order` at all, so `s.order.product` was `undefined` and the Sites page threw a
  full client-side exception for every real user, for as long as the API deploy was pending.
  Local dev looked completely fine throughout (same commit, but the local API dev server picks
  up backend changes on save) — **local looking fine is not evidence production is fine**
  whenever the two apps are out of deploy-sync like this. Lesson: either (a) deploy the backend
  *first* and confirm it live before pushing the dependent frontend change, or (b) if that
  ordering isn't practical, make the frontend degrade gracefully (optional chaining +
  fallback text) for fields the *current* production API might not have yet, not just the
  fields the code assumes will always exist.

- **`next dev` is broken in this environment** (not production-affecting):
  `globals.css`'s `@import`/`@tailwind` lines fail through Next's
  React-Server-Components CSS loader path specifically — reproduces even on a
  totally clean `node_modules`/`.next`/`.turbo`. `next build && next start`
  works correctly and is what Vercel uses anyway, so production is unaffected.
  Use `next build && next start` for local admin-web testing until this is
  root-caused.
- **`next build` for `admin-web` must actually run with its cwd inside
  `apps/admin-web`** — invoking the CLI with a directory argument
  (`next build "D:\...\apps\admin-web"`) from somewhere else builds
  successfully but silently produces an almost-unstyled page: Tailwind's
  `content: ["./src/**/*..."]` glob in `tailwind.config.js` resolves
  relative to `process.cwd()`, not the config file's own location, so from
  the wrong cwd it matches nothing and Tailwind emits nearly empty CSS. The
  only symptom is a quiet `warn - The content option ... is missing or
  empty` line in the build output, not a failure — easy to miss. Confirmed
  2026-08-20: the page loaded and functioned, just with zero styling (huge
  unsized images, unstyled nav). Fix: run `npm run build`/`next build` via
  `Start-Process -WorkingDirectory apps\admin-web` (or an actual `cd`), not
  a path argument to the CLI from elsewhere.
- **`next start`'s real server is a child process, not the PID
  `Start-Process`/`npm run start` itself returns.** Killing that recorded
  PID leaves the actual server still bound to port 6011 — the next start
  attempt then fails with `EADDRINUSE`, and worse, until you notice, the
  browser keeps serving whatever stale build the orphaned process still has
  loaded. Confirmed 2026-08-20. Fix: before restarting, kill whatever
  `Get-NetTCPConnection -LocalPort 6011 -State Listen` actually reports
  (`| ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`), not the
  launcher's own PID.
- Editing `packages/shared` source has **zero effect** until it's rebuilt
  (`npm run build --workspace=packages/shared`) and the API dev server is
  restarted — bit twice by this (once historically, once during the HSN-
  mandatory fix in 2026-08-11).
- Installs run through the remote/automation shell have repeatedly corrupted
  `node_modules` (turbo/tailwind/next/prettier binaries going missing, even
  under `npm ci`) — if it recurs, have the user run `npm install` directly in
  their own terminal rather than through automation. Recurred 2026-08-13
  (`typescript` missing entirely even though `turbo`/`next` were present) —
  running `npm install` through Desktop Commander fixed it that time, so this
  isn't an absolute rule, just something to watch for.
- The local dev Postgres DB needs `npx prisma migrate deploy` run by hand
  after pulling schema changes someone else made — it doesn't happen
  automatically, and a stale local DB throws opaque `PrismaClientKnownRequestError:
  column ... does not exist` on whichever route first touches the missing
  column (hit via `/dashboard` → `Site.companyName` on 2026-08-13).
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
  corresponding local `.sql` file at all — production schema changes have
  been applied directly via the Supabase MCP's `apply_migration`, not
  `prisma migrate deploy`. **Don't assume `prisma migrate status` against
  production would report cleanly** — always diff actual columns
  (`information_schema.columns`) against the Prisma schema before writing a
  new migration, rather than trusting the migrations table.
- No DB-level `NOT NULL` constraint on any `hsnCode` column — enforcement is
  Zod/API-layer only (deliberate; a DB constraint would need a data-backfill
  pass first, since some historical rows may still be null).
- **The agent operating this repo cannot log into `admin-web` itself** —
  entering a password into any field is refused outright, even with
  credentials supplied by the user. Production changes get verified by
  replicating the app's own Prisma queries as raw SQL via the Supabase MCP
  (join the same tables the route joins, confirm no dangling FK/null-in-
  required-field), and by hitting the deployed API directly for auth-gated
  routes (expect 401, not 404, to confirm a route deployed) — never by
  loading the real UI as a logged-in user. Local dev DB doesn't have this
  restriction: the seeded Super Admin (`ferosem@gmail.com` /
  `changeme123`) is fine to use for local browser verification.
- Supabase MCP calls against the production project (`apply_migration`,
  `execute_sql`) get intermittently blocked by the harness's auto-mode
  safety classifier and require the user to explicitly say "proceed" before
  a retry succeeds — inconsistent about *which* calls trip it (a large
  multi-statement data-import query went through untouched right after a
  single-statement schema migration got blocked), so don't assume a query
  is safe just because a similar one just went through.
- **This dev machine has `NODE_ENV=production` set globally** (in the
  Windows user's own environment, not any project `.env` — confirmed via
  `$env:NODE_ENV` in a fresh PowerShell), which is also why `next dev` warns
  about a "non-standard NODE_ENV value". Side effect worth knowing: any
  route that does `NODE_ENV === "production" ? undefined : devValue` (the
  OTP endpoints' `devCode` echo) behaves exactly like real production even
  when running locally — don't mistake a missing `devCode` in a local
  response for the request having failed; check `NotificationLog` or server
  logs instead.
- **`npm install <package-name>` (with an explicit package argument) reliably
  crashes with `TypeError: Cannot read properties of null (reading
  'location')` in this workspace** (npm 11.13.0, arborist tree-diff bug -
  appears tied to how it diffs the `@recd/shared` workspace symlink after
  it's been manually patched for a Vercel deploy, per the dance above).
  **Workaround: hand-edit the `dependencies`/`devDependencies` entry into
  the target workspace's `package.json` yourself, then run bare `npm
  install` (no package argument)** — that command path doesn't hit the bug.
  Confirmed via the nodemailer install on 2026-08-14. If a bare `npm
  install` still fails on the `prisma generate` postinstall's `EPERM` lock,
  re-run with `--ignore-scripts` and then manually run `npm run build
  --workspace=packages/shared` + `npx prisma generate` (from `apps/api`) to
  finish the two postinstall steps it skipped.
- **Work done from the mobile app lands as a pushed-but-unmerged branch
  named `claude/<slug>`, not directly on `master`.** Found 2026-08-15 when
  the user said "I did this yesterday on my phone" for a feature that
  wasn't on `master` at all — `git fetch origin && git branch -a` surfaced
  `origin/claude/customer-agent-scoping-voice` sitting there un-merged.
  **Always check for these before assuming a feature doesn't exist or
  starting to rebuild it from scratch.**

## Current open items (as of 2026-08-20)

- ~~`zan-app-api` deploy pending: Sites list's Vendor/Product/Update-status columns~~
  **Deployed 2026-08-20** - this was the session that also self-ran the deploy dance for the
  first time (see changelog). The gap between this deploying and `admin-web`'s already-live
  frontend caused a real production crash on Sites (`order.product` was `undefined` for the
  window it was undeployed) - fixed by the deploy itself, plus the Sites page was hardened with
  null-checks as defense-in-depth. **Confirmed fixed by the user in production** the same
  session.
- **Every `DataTable` page now has a Print button** (2026-08-20, later - see changelog) - prints
  only the currently-filtered rows and currently-visible columns, with a letterhead (company
  logo/name from `/settings`, page title, active-filter summary, generated timestamp) reusing
  the same `ReportPrintHeader`/`print-table` styling the Reports section already used. Built
  into `DataTable` itself, so all 12 pages got it in one change - not yet click-tested live by
  the user (standing restriction), owed: print preview on at least one page with an active
  filter to confirm the letterhead/logo renders correctly.
- **`DataTable` (column show/hide + per-column filter) now covers all list pages** (2026-08-20,
  see changelog) - Sites/Customers/Products from earlier this session, plus Vendors, Orders,
  Invoices, Quotations, Purchase Orders, Expenses, Users, Work Orders, and Complaints in the
  same session. Not yet click-tested live in production by the user (standing "agent can't log
  into admin-web" restriction applies as always) - owed: a real click-through of the Columns
  menu and per-column filters on a few of the newly-converted pages.
- **Drive folder creation fixed and deployed (2026-08-18, two rounds) but not yet click-tested
  live** - round 1 fixed the expired token + published the consent screen (7-day expiry gone for
  good); the user then reported the button still didn't work, which turned out to be a second,
  unrelated problem - the token's scope was `drive.readonly` only, which can't create anything.
  Round 2 widened the scope to `drive.readonly` + `drive.file` and verified end-to-end by actually
  creating and deleting a real test folder via the Drive API directly (not just checking the scope
  string). See changelog for both rounds. Owed: click "Create Drive folders" on a real site as a
  logged-in user and confirm it succeeds (standing "agent can't log into admin-web" restriction
  blocks this from any session, not just cloud ones).
- ~~`zan-app-api` deploy pending: agent tools' `OrderLineItem` fix~~ **Deployed 2026-08-18** - the
  chat agent now sums an order's base quantity plus every `OrderLineItem` when answering "how many
  RECDs at X". Confirmed live via `/health` -> 200 and an auth-gated route -> 401.
- **`RecdDelivery` (the delivery-status-per-site table) is almost entirely unpopulated for
  Ethen's 29 sites** — found while verifying a user-uploaded `Material_Delivery_Status_
  version_1.xlsx` against production (see changelog). Only 2 of ~24 delivery-status line
  items in that sheet have any `RecdDelivery` row at all (INTERGLOBE AVIATION/Devanahalli,
  VRL/Peenya), and even those two have gaps - VRL/Peenya's `productId` is null, and neither
  captured an actual/expected date despite the source sheet giving one. Every other site
  (Bostik, all of BPCL's, the other 7 VRL sites, Mahindra, Wipro, Kaynes) has real Order/Site
  data but zero delivery-status record. User was offered an import of the missing rows,
  matching sheet rows to sites the same way the verification did - not yet done, waiting on
  the user.
- **One address name doesn't match between the sheet and the DB, unconfirmed**: the sheet's
  "BPCL, DEVANAGONTI, Bangalore" has no literal match in production - the closest candidate is
  BPCL's "Hosakote, Bangalore" site (which does have the same 2-product shape - RECD-250 +
  RECD-750 - the sheet's Devanagonti group implies). Asked the user to confirm whether these
  are the same place before assuming so and importing against it.
- ~~`zan-app-api` deploy pending for vendor archive~~ **Deployed and confirmed working
  2026-08-17** — the user ran the deploy dance themselves and successfully archived a real
  vendor through the live UI. Took two attempts because of two gotchas worth knowing for next
  time (not code bugs, pure operator/tooling friction):
  1. **The first deploy attempt silently redeployed stale output.** `vercel build --prod` was
     accidentally run from the repo root (`D:\Projects\Zan-APP`) instead of `apps\api` -
     failed immediately with "No Project Settings found locally" there, but a *prior* leftover
     `apps\api\.vercel\output` from an earlier build still existed, so the subsequent `vercel
     deploy --prebuilt --prod` (run correctly from `apps\api`) silently deployed *that* stale
     build instead of erroring - it had no way to know the output was out of date. Symptom:
     `POST /vendors/<realId>/archive` with a valid token returned a plain 404 (no `.error`
     JSON body - Express's own fallback, not a route handler), while unauthenticated requests
     to the same path still returned a convincing-looking `401 "Missing bearer token"` -
     **because `vendorsRouter.use(authenticate)` runs for every `/vendors/*` request
     regardless of whether any route ultimately matches**, so a 401 there proves nothing about
     whether a specific route exists. **Lesson: always delete `.vercel\output` (and `dist`)
     immediately before a fresh `vercel build --prod`, and verify the route landed in the
     compiled output** (`Select-String -Path ".vercel\output\functions\api\index.func\apps\api\dist\routes\<file>.js" -Pattern "<new route path>"`)
     **before deploying** - don't trust "401 not 404" alone as proof a specific new route is live.
  2. **`notepad patch.ps1` doesn't save where you think.** Launched from `apps\api`, Notepad's
     Save dialog still used its own last-remembered folder (the repo root), not the shell's
     cwd - `patch.ps1` ended up saved one level up. Harmless in this case only because the
     script's own paths are all absolute, so running it from the wrong folder still patched
     the right files - but the resulting `cd..`/`cd..` navigation left the shell sitting in
     the repo root, where the next `vercel deploy --prebuilt` command failed since it looks
     for `.vercel\output` relative to the *current* directory. **Lesson: after `notepad
     patch.ps1`, confirm the file actually landed where expected (`Test-Path patch.ps1`)
     before running it, and always `cd` back to `apps\api` explicitly right before
     `vercel deploy` rather than assuming the shell is still there.**
- ~~`zan-app-api` has TWO deploys pending...~~ **Deployed 2026-08-16** — the user ran the
  manual deploy dance themselves. Both the customer-role Users-page guard (`31d2955`) and the
  `create_purchase_order` code-reuse fix are live in production. Confirmed indirectly via a
  direct DB query (one `customer`-role `User` row, correctly linked); a live `POST /users`
  `roleKey: "customer"` → 400 check is still owed since no session so far has had both
  production credentials and unblocked network access to `zan-app-api.vercel.app` at the same
  time.
- **`apiClient.ts` fix for the false-failure-on-delete bug (2026-08-16, see changelog) is
  pushed but not yet click-tested live** — frontend-only, ships via the normal `admin-web`
  auto-deploy, no manual dance needed. Owed: confirm a delete action (e.g. deleting a test
  order) resolves cleanly in the browser instead of throwing, now that the fix is live.
- **New Reports section (2026-08-16, see changelog) has never been click-tested as a logged-in
  user** — only `tsc`/`next build`/curl-200 verified, per the standing "agent can't log into
  admin-web" restriction below. Owed: a real run through each of the 4 reports' filters, Print,
  and Export CSV buttons.
- **Customer-facing agent chat (own orders/sites + raise-complaint) is code-
  complete, deployed, and verified live as a real customer** (2026-08-15 -
  see changelog) but **the Settings → Agent Visibility toggle for Customer
  is still off in production** — deliberately left for the user to flip on
  when ready, same as it's been since the feature was first built.
- 9 of the 12 notification `templateKey`s (`complaint_raised`,
  `invoice_issued`, `payment_received`, `work_order_assigned`, etc.) now
  send real emails but with generic auto-rendered key/value copy, not
  bespoke templates — only `otp_code`, `site_stage_updated`, and
  `vendor_assigned_site` (the three anyone's actually asked to have read
  well) got real copy. See `emailTemplates.ts`.
- Customer login's "Order ID + phone" flow was removed from the login page
  UI (2026-08-14, "for now" per the user) but `/auth/customer/register` and
  `/auth/customer/verify` are untouched on the backend - dead code from the
  UI's perspective, not actually dead. Revive by re-adding the toggle in
  `login/page.tsx` if it comes back; don't delete the backend routes without
  checking nothing else depends on them first.
- ~~No `DELETE /vendors/:id`...~~ **Addressed 2026-08-17 via archive, not
  delete** — see changelog. A vendor can now be pulled out of active use while
  keeping every site/complaint/work-order it was ever tied to intact. Still
  no hard delete, and there's deliberately no one-click "un-archive" in the
  UI yet (see changelog for why) — pending `zan-app-api` deploy.
- Product catalog now carries real GA-drawing-derived data
  (`shape`/`dimensions`/`weightKg`, imported 2026-08-13 — see changelog) for
  30 KVA variants, but `shape` is only a 3-value enum
  (`cylinder`/`triangle`/`rectangle`); the richer free-text shape
  descriptions from the source spreadsheet (e.g. "Horizontal cylindrical
  shell (RAD 2.0)") got stuffed into `ratingSpec` for lack of a better
  field — flagged to the user as a judgment call, not yet revisited.

- `apps/api/scripts/verify*.ts` — a growing pile of throwaway verification
  scripts from live-testing the agent's write tools. Never consolidated into
  real automated tests; still there, still growing.
- HSN-code self-inference risk on document line items is now blocked by
  validation (§ "HSN/SAC made mandatory" below), but the *agent* will still
  confidently invent a code if the user doesn't supply one and gets a
  rejection rather than a silent bad value — acceptable but worth knowing.
- ~~Minor code-reuse inconsistency: `create_purchase_order`'s confirm handler
  duplicates line-item construction inline...~~ **Fixed 2026-08-16** — see
  changelog.
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
- ~~Customer role now has real, safely-scoped agent tools... still owed: an
  actual logged-in-as-customer click-through~~ **Done 2026-08-15** — see the
  "Current open items" entry above and the changelog for what a real
  logged-in-customer test session found and fixed.
- The mic button (Web Speech API) only renders where the browser implements
  `SpeechRecognition`/`webkitSpeechRecognition` — solid on Chrome/Edge,
  absent on Firefox and inconsistent on Safari/iOS. If customer traffic skews
  iPhone-heavy, this silently degrades to keyboard-only for a lot of users;
  worth revisiting with a server-side transcription fallback (e.g. Whisper via
  the already-configured LLM provider plumbing) if that turns out to matter.

---

## Changelog (condensed)

### Print button (with company letterhead) on every DataTable page (2026-08-20, later still)
User confirmed the production Sites crash fix, then asked for a way to print a filtered list
(e.g. "just this customer's sites") with the company logo as a letterhead, "like a letterhead".
Realized the Reports section already had exactly this - `apps/admin-web/src/components/
reports/ReportChrome.tsx`'s `useCompany()` (fetches `/settings` for `logoDataUrl`/`legalName`)
and `ReportPrintHeader` (the letterhead itself: logo + company name left, report title + active
filters + generated timestamp right, `hidden print:block` so it only appears when printing) -
so rather than building new print infrastructure, wired those directly into `DataTable` itself.

- Added a **Print** button to `DataTable`'s toolbar (`window.print()`), a `title` prop (each
  page passes its own name - "Sites", "Customers", etc. - as the letterhead title), and a
  `printSubtitle` computed from the active per-column filters (e.g. "Filtered by Customer:
  Acme Corp · Stage: Dispatched — 4 of 37 rows") as the letterhead's subtitle - so what got
  printed and why is self-documenting on the page itself, not just implied.
- The printed table only includes columns that have an `accessor` (i.e. real data columns -
  Actions columns are `filterable: false` with no `accessor`, so they're automatically excluded
  from print without needing a separate flag) and renders each cell as **plain text via the
  column's `accessor`, not its `render`** - deliberately ignoring custom `render` output (links,
  buttons, colored badges) since those don't mean anything on paper; the raw value reads cleanly
  instead. Reused the existing `.print-table`/`.print-doc` CSS classes (navy header, serif body)
  already styling the invoice/quotation/PO print pages, so the printed list matches those
  documents' look rather than introducing a third print style.
- The on-screen table, mobile cards, and each page's own header/banners/KPI tiles/inline
  filter dropdowns all got `print:hidden` added (about a dozen small edits, one page at a time)
  so the printed page shows *only* the letterhead + data table - nothing from the live UI chrome
  leaks onto paper. The sidebar/topbar were already `print:hidden` from the existing Reports
  work, so nothing needed changing there.
- `/settings` only requires `authenticate` (not `manage_settings`), confirmed by reading the
  route before assuming `useCompany()` would work for every role - it does, so the letterhead
  logo renders correctly regardless of who's printing, not just Super Admins.

One component change (`DataTable.tsx`) plus a `title` prop and a `print:hidden` pass across all
12 pages using it. `tsc --noEmit` and a full `next build` (33 routes) both clean. Not yet
click-tested live by the user (standing restriction) - owed: confirm the letterhead/logo
actually renders in a real browser print preview on at least one page with an active filter.

### DataTable rolled out to all remaining list pages; self-run `zan-app-api` deploy fixes a real production Sites crash (2026-08-20, later)
Picked up from "Current open items" - user asked for the same `DataTable` (column show/hide +
per-column filter) treatment on **Vendors, Orders, Invoices, Quotations, Purchase Orders,
Expenses, Users, Work Orders, and Complaints**, matching the shape already shipped on Sites/
Customers/Products. Converted all nine: each page's hand-rolled `<table>` became a `DataTable`
column config (multi-line cells like Vendors' name+address or contact name+email/phone became
a single column with a custom `render`; delete/edit/manage action buttons became an
`alwaysVisible`, `filterable: false` actions column), while every page's existing mobile card
list was left as hand-written JSX, now driven by the filtered-rows render-prop instead of the
raw state array so mobile stays in sync with active filters. `tsc --noEmit` and a full `next
build` (all 33 routes) both clean throughout.

**Before finishing, the user reported "Application error: a client-side exception" on Sites in
production** - this genuinely was a bug, and a useful one to understand. The Sites page columns
added in the prior session's push (Vendor/Product/Update-status) read `s.order.product.name`
and `s.stageEvents[0]` with no null-guard, correctly assuming the API always returns those
fields - which it does *once the backend is deployed*. But that push landed both the frontend
change and the `sites.ts` backend `include` change in one commit, and `admin-web` (git-connected,
auto-deploys instantly) went live immediately while `zan-app-api` (not git-connected, needs the
manual dance) was still sitting on the old query shape - so for every real user, `order.product`
was `undefined` on the live site until the backend deploy caught up. Local dev looked completely
fine the whole time, which delayed diagnosis - the local API dev server had the new code from the
start, so this class of bug is invisible locally by construction. See the new "Known gotchas" entry
above for the lesson (deploy backend first, or degrade gracefully for fields that might not exist
in *production* yet even if they always exist in code).

**This was also the first session able to run the manual deploy dance itself** - a prior
assumption (baked into this file for weeks) was that only a session with Desktop Commander
access to the user's own machine could reach `api.vercel.com`; this session had real local
shell access and confirmed `api.vercel.com` was reachable and `vercel pull` authenticated
cleanly against `ferose-salahudeen-s-projects/zan-app-api` with no token wrangling needed (the
project was already linked from a prior session's `.vercel/project.json`). Ran the actual dance
end to end: stopped the local API dev server, cleared stale `.vercel/output`/`dist`, `vercel
build --prod` (~15 min, confirmed via a background watcher rather than blocking), verified
`stageEvents`/`order.product` present in the compiled output before deploying, patched
`@recd/shared`, and `vercel deploy --prebuilt --prod`. **The patch step needed updating**:
Vercel CLI 59.1.4's output layout only has 3 real `@recd/shared` spots now, not the 5 documented
from an earlier CLI version - the old `functions/index.func/` target doesn't exist in this
layout at all (everything rewrites through `functions/api/index.func/` per `vercel.json`), and a
first patch-script attempt silently no-opped on all three real spots because it checked
`node_modules` (which already existed) rather than the missing `@recd` scope folder one level
deeper - fixed by explicitly `New-Item`-ing the `@recd` directory before copying into it. Updated
the deploy-dance write-up above with the corrected spot list and the general warning to
re-verify against the actual build output tree rather than trusting a prior write-up blindly,
since this has now changed once already. Verified live: `GET /health` → 200,
`GET /agent/providers` → 401. This should have fixed the Sites crash immediately, since
production's API now returns the same shape the already-deployed frontend expects - not yet
re-confirmed by the user in the live UI as of this writing.

Also hardened the Sites page itself as defense-in-depth per the lesson above: `order.product`
is now read with a null-check (renders "-" instead of crashing) both in the table column and the
mobile card, so a future deploy-order mismatch degrades instead of taking the whole page down.

### Reusable `DataTable` (column show/hide + per-column filter) on Sites, Customers, Products; four new Sites columns (2026-08-20)
User asked for two things on the Sites/Customers/Products list pages: the ability to
show/hide columns, and a search/filter per column. Built a shared
`apps/admin-web/src/components/DataTable.tsx` rather than one-off code per page - takes a
column config (`key`, `label`, `accessor` for filtering, optional custom `render`,
`defaultVisible`, `alwaysVisible`, `filterType: "select" | "text"`) plus `rows`, and renders
the desktop `<table>` itself while handing the same filtered row array back to the caller via
a render-prop child, so each page's existing hand-built mobile card list stays in sync with
whatever filters are active instead of needing its own separate filtering logic.

- **Column visibility**: a "Columns" button opens a checklist (one column per page pinned
  `alwaysVisible` so the table can't be emptied out); choice persists per page in
  `localStorage` under `zan-app:columns:<page>`, with a "Reset to default" link.
- **Per-column filter**: a second header row, one control per visible column. Defaults to a
  `<select>` populated with that column's distinct values across all rows (exact-match
  filtering) - genuinely useful for categorical columns like Stage/Engineer/Customer/Shape.
  Columns marked `filterType: "text"` (mostly-unique free-text fields - Order #, names,
  addresses, model numbers) get a substring-match text box instead, since a dropdown of every
  order number wouldn't help anyone.
- Wired into **Sites**, **Customers**, **Products** only - the other list pages keep their
  original tables for now (see Current open items).

While rebuilding Sites, the user asked for more columns than existed in the table at all:
**Address** (field already fetched, just never rendered), **Product**, **Vendor**, and
**Update status**. The first request for "Installation status" turned out, after the user
clarified with a screenshot of the site detail page's "Post a status update" form, to mean
the *latest status update's status* (e.g. "Pending"), not the SITC phase (Supply/
Installation/Testing/Commissioning) - those are two genuinely different fields
(`SiteStageEvent.statusOption.label` vs. `currentStage.phase`), easy to conflate from the
name alone. Implemented the one actually wanted: `apps/api/src/routes/sites.ts`'s `GET
/sites` list query widened to `include: { order: { include: { product: true } },
stageEvents: { orderBy: { createdAt: "desc" }, take: 1, include: { statusOption: true } }
}` (alongside the existing `vendor: true`), giving each row its base product and the label
of its own most recent status update with one query each, no N+1. **Backend change - not
live in production until the `zan-app-api` manual deploy dance runs** (see Current open
items); `admin-web`'s three new/changed columns will render blank against production until
then even though the frontend itself deploys automatically.

This session had genuine local shell access to the user's own machine (a first - every prior
session in this file was a cloud/web session blocked from exactly this), so verification
went further than usual: `tsc --noEmit` clean on both `apps/admin-web` and `apps/api`, a full
`next build` clean, and then both `apps/api` (port 4011) and `apps/admin-web` (port 6011)
were actually started locally against the user's own dev Postgres so they could click-test
the real UI themselves before anything shipped - not just build-clean-and-hope. That process
surfaced two real build/runtime gotchas (Tailwind silently emitting near-empty CSS when
`next build` runs from the wrong cwd; `next start`'s child process outliving the PID
`Start-Process` returns, causing `EADDRINUSE` on restart) - both root-caused, fixed, and
written up in "Known gotchas" above so they don't cost time again. **No DB schema or
migration changes this session** - only an `include` widened on an existing query - so there
was nothing DB-side that could conflict between the user's local test data and production.

### "Create Drive folders" still failing after the token-expiry fix - wrong scope, not auth (2026-08-18, later)
User confirmed the expiry fix (below) didn't actually fix the button - still no folder created.
Checked the token directly (POST to Google's token endpoint): valid, 200 OK, no expiry issue this
time. The real problem: its scope was `drive.readonly` only. `drive.files.create()` (what "Create
Drive folders" calls) needs write access, which `drive.readonly` categorically cannot grant -
this was likely broken from the very first time the feature was used, not a regression from
today's fix; the earlier "authentication error" chat message and this session's silent failure
were two different symptoms of two different problems that happened to overlap in time.

The handover's own prior open item ("File-upload-to-Drive... would need the scope widened from
drive.readonly to drive.file") had already named the fix for a different feature (uploads) without
anyone realizing folder creation needed the same widening. Updated
`getDriveRefreshToken.js` to request both `drive.readonly` (broad read, for pre-existing shared
documents the app didn't create) and `drive.file` (create/manage access, scoped to files the app
itself creates) together in one consent grant, re-ran the loopback flow, and this time verified
end-to-end before shipping - not just decoding the token's scope string, but actually calling
`POST /drive/v3/files` to create a real test folder and `DELETE` to remove it, using the new
access token directly. Updated the env var in both places and redeployed (env-only change, reused
the existing prebuilt build output). **Confirmed this was the last gap** - not yet re-confirmed by
the user clicking the button live, but the exact same underlying Drive API call the button
triggers was just proven to work.

### Drive folder creation silently failing (expired OAuth token) + permanent fix (2026-08-18)
User reported clicking "Create Drive folders" on a site did nothing and there was no way to
upload files. Root cause: `GOOGLE_DRIVE_REFRESH_TOKEN` had expired - confirmed directly by POSTing
it to `https://oauth2.googleapis.com/token`, which returned `invalid_grant: Token has been expired
or revoked`. This is the standing 7-day Testing-mode expiry noted in Quick facts. Two things worth
knowing that weren't obvious going in:
1. **The OAuth client isn't in the Zan-APP Cloud project at all.** It's `zan-app-agent-drive`
   (Desktop-type client) in a separate project called `MyPersonalAgent`, owned by `ferosem@gmail.com`
   - not `zanfpowersystems@gmail.com`, which is only the Drive *account* being accessed, not the
   Cloud Console owner. Easy to go looking in the wrong project/account.
2. **This client is a "Desktop" OAuth type, not "Web application"** - it has no redirect-URI field
   to edit in Cloud Console, so the usual "add the OAuth Playground's redirect URI" trick doesn't
   apply. Desktop clients use the **loopback flow** instead: any `http://localhost:<port>` redirect
   works without pre-registration. Wrote `apps/api/scripts/getDriveRefreshToken.js` (kept in the
   repo, not deleted) - a small script that starts a local HTTP listener, prints a consent URL, and
   exchanges the resulting code for a fresh refresh token once you sign in as
   `zanfpowersystems@gmail.com` and approve.

Generated a new token this way, verified it live before shipping (direct POST to Google's token
endpoint, not just "no errors"), updated it in both `apps/api/.env` (local) and the `zan-app-api`
Vercel production env var, and ran the full manual deploy dance. Confirmed via `/health` -> 200 and
an auth-gated route -> 401.

**Then fixed the actual recurring cause**, not just this one instance: the OAuth consent screen
was stuck in **Testing** publishing status, which is *why* refresh tokens only lasted 7 days
regardless of how they were generated. Published the app to production (Cloud Console -> Audience ->
Publish App, as `ferosem@gmail.com`, project `MyPersonalAgent`) and re-verified: a *second* freshly
minted token, generated identically to the first, no longer carries a `refresh_token_expires_in`
field in Google's response at all (the first one explicitly showed `604760` seconds = 7 days). That
second token is what's actually live in production now. The app still shows Google's "unverified
app" warning on any future re-consent (Drive scopes need a review to fully verify, which wasn't
pursued), but that's just a click-through now, not a hard 7-day wall.

Not yet click-tested as a logged-in user (standing restriction) - owed: confirm "Create Drive
folders" actually succeeds in the live UI. See Current open items.

### Agent chat undercounted RECDs at a site after the multi-RECD-per-site feature shipped (2026-08-17, latest)
User reported the chat agent answering "1 RECD unit" for BPCL's Desur site when there should have
been more, after consolidating duplicate sites into one order carrying extra `OrderLineItem` rows
(the "add another RECD unit → same order" path from the immediately-preceding commit, `d7b7381`,
same day). Confirmed directly against production: `ORD-2026-6001` (Zadshahapur, Desur, BPCL) has
its top-level product (RECD-200 qty 1) **plus two `OrderLineItem` rows** (RECD-250, RECD-400) - 3
RECDs total, correctly stored, exactly what the user expected. The data was right; the agent just
never looked at it.

Root cause: `d7b7381` added the `OrderLineItem` table as one of two ways to put multiple RECDs on
a site, but never touched the two agent tools that answer "how many RECDs at X" - both
`search_orders_and_sites` and `get_document_detail`'s `docType: "order"` case
(`zanAppReadTools.ts` / `zanAppDetailTool.ts`) only ever queried the order's single top-level
`product`/`quantity` fields, with no `lineItems` in their Prisma `include` at all. Any RECD added
via a line item was silently invisible to the agent, even though it shows correctly in the real
admin-web site-detail page.

Fixed both tools to `include: { lineItems: { include: { product: true } } }` and return them
(`additionalLineItems` in `search_orders_and_sites`'s result shape); updated the tool's own
description to explicitly tell the model to add the base quantity plus every line item's quantity
together when answering a "how many" question, rather than relying on the model to infer that from
an unfamiliar field. `tsc --noEmit` clean. **Backend-only change, needs the full `zan-app-api`
manual deploy dance before it takes effect** - not yet deployed, this cloud session has the same
standing blockers (no Desktop Commander, `api.vercel.com` network-blocked) as every prior cloud
session. Until deployed, the chat agent will keep undercounting any site whose extra RECDs were
added as line items rather than as a separate order.

### Verified a user-uploaded delivery-status spreadsheet against production; found the delivery-tracking table is mostly empty (2026-08-17, later)
User uploaded `Material_Delivery_Status_version_1.xlsx` (Product/Qty/Customer Name/Location/
area/Delivery Status/expected-or-actual date, one row per RECD unit) and asked whether it had
been "updated correctly" and imported with contact details, specifically flagging "Bostik 2
recd" to check. Read it with `pandas` (neither `pandas` nor `markitdown` were actually
preinstalled in this session despite the xlsx skill's own notes - had to `pip install` first).

Cross-checked every row against production via the Supabase MCP:
- **Sheet has blank-cell row grouping** (a named customer/location row followed by unlabeled
  rows for additional products at the same site) - confirmed this convention by matching the
  first group (BPCL/Zadshahapur: RECD-200/250/400 across 3 rows) against 3 real DB orders at
  that exact address before trusting the pattern for the rest of the sheet.
- **Bostik: correct as-is, not a bug.** DB has exactly one Bostik order (RECD-500 qty 1,
  Bommasandra), matching the sheet's one explicit Bostik row exactly (product, qty,
  "Delivered", 2026-08-12 all agree). The row directly below it that might read as a second
  Bostik item (RECD-380, blank customer) actually belongs to Mahindra Aerostructures/Narsapur
  in the DB (which genuinely has two separate RECD-380 orders) - reported this distinction
  back to the user rather than assuming which group a blank row belongs to.
- **The real finding: `RecdDelivery` (see schema - literally built "to match the source
  delivery-tracking sheet") is almost empty.** Of ~24 delivery-status line items in the sheet,
  only 2 have any row in it at all (INTERGLOBE AVIATION/Devanahalli, VRL/Peenya) - every other
  site's Order/Site data exists correctly, but its Delivered/In-Transit status and dates were
  never brought into the system. Even the 2 that exist have gaps: VRL/Peenya's `productId` is
  null (should be RECD-750), and neither captured an actual/expected date despite the sheet
  giving one.
- **One unconfirmed address mismatch**: sheet's "BPCL, DEVANAGONTI, Bangalore" doesn't
  literally match anything in production; closest candidate is BPCL's "Hosakote, Bangalore"
  site (same 2-product shape the Devanagonti group implies - RECD-250 + RECD-750). Flagged to
  the user rather than assumed.
- **Contact details**: the sheet itself has zero contact-detail columns (no name/email/phone
  fields anywhere), so nothing about contacts could have come from it - clarified this rather
  than reporting a false pass/fail. Checked separately: Ethen Power Solutions' own contact
  *is* on file (Vivian Johnson D'souza, real email/phone), just unrelated to this file.

Read-only investigation, no code or data changes - see "Current open items" for the two things
this surfaced that are still open (the missing `RecdDelivery` rows, and the Devanagonti/
Hosakote address question), both waiting on the user.

### Vendor archive: deactivate without losing history, with optional site reassignment (2026-08-17)
User hit the "No `DELETE /vendors/:id`" open item directly while testing (tried to remove a
test vendor, couldn't). Asked for a real delete, but on hearing the tradeoff - a shared
placeholder "History Vendor" would merge every removed vendor's track record into one bucket,
losing exactly the "was this specific vendor good or bad" signal the user's actual reason
(catching malpractice after the fact) depends on - chose **archiving instead of deleting**:
the vendor row and everything it was ever tied to stays fully intact and correctly attributed,
it just drops out of active use.

1. **New `VENDOR_STATUS.ARCHIVED`** alongside pending/approved/rejected. `Vendor` gets
   `archivedById`/`archivedAt` (mirrors the existing `approvedById`/`approvedAt` pair) via a
   migration - applied directly to production via the Supabase MCP, matching how prior
   sessions have handled schema drift on this project (see the standing gotcha on production's
   migration history vs local files).
2. **`POST /vendors/:id/archive`** (`vendors.ts`), optional body `{ reassignSitesToVendorId }`.
   Guards: target (if given) must be a different, currently-approved vendor. In one
   transaction: optionally bulk-moves the vendor's `Site.vendorId` rows to the target so
   in-progress erection work doesn't stall, deactivates (`isActive: false`) every one of the
   vendor's member logins, then flips the vendor to `archived`.
3. **Every "active" vendor selection already excludes non-approved vendors by construction**
   (`status === "approved"` filters in the site-vendor-assignment dropdown, the
   erection-engineer-add dropdown, and email-OTP eligibility in `auth.ts`) - archived vendors
   fall out of all of these for free, no new filtering needed anywhere.
4. **Found a real pre-existing gap while designing the login-lockout side effect**: the plain
   `POST /login` (password) route only ever checks `user.isActive`, never `vendor.status` -
   unlike OTP, which does check `vendor.status === "approved"`. So a *rejected* vendor's
   engineer has apparently always been able to keep logging in with their password. Archiving
   closes this for archived vendors specifically by deactivating their logins outright
   (`isActive: false`), which both login paths already respect - but the same gap still exists
   for `rejected` vendors today, untouched by this change. Flagged here rather than fixed,
   since fixing `reject` wasn't asked for and changes existing behavior for whoever's
   currently relying on it (if anyone).
5. **Deliberately no one-click "un-archive" in the UI.** Calling the existing `/approve` route
   on an archived vendor *would* flip it back to `approved` (its guard only blocks re-approving
   an *already*-approved vendor), but `createVendorContactLogin` only creates a login for an
   email that doesn't already exist - it won't reactivate the `isActive: false` row this
   archive flow just created. Exposing "Reinstate" as a button would silently produce a
   vendor that looks active but whose engineer still can't log in. Left unbuilt rather than
   shipping that trap; reactivating a mistakenly-archived vendor today means manually flipping
   its status via the API/DB and separately reactivating its member `User` row(s).
6. Frontend: `vendors/page.tsx` gets an **Archive** button (approved vendors only) opening a
   confirmation modal - shows the vendor's current site count, warns if any exist, offers a
   dropdown of other approved vendors to reassign them to (or leave as-is), and a result banner
   afterward showing how many sites moved and where. Gray badge added for the archived state.

Verified: `tsc --noEmit` and each app's own production `tsc -p tsconfig.json` clean, full
`next build` clean (34 routes), migration applied and confirmed live via a direct column query
against production. **Not yet exercised as a logged-in user** (standing restriction) and
**`zan-app-api` deploy still pending** (see Current open items) - the route itself isn't live
yet, only prepared and migrated.

### Every delete action in admin-web falsely reported failure (2026-08-16, later still)
**Report:** user deleted a stale test order (`ORD-2026-4991` - manually created outside the
real Ethen Power Solutions import batch, identified by comparing its `createdAt`/site/value
shape against the other 29 real imported rows) and got `Failed to execute 'json' on
'Response': Unexpected end of JSON input`. Checked production directly: **the order was
actually gone** - the delete had succeeded, the error was a lie.

Root cause: `DELETE /orders/:id` (and 7 other delete routes across the API - expenses,
customers, products, quotations, agent providers, agent conversations, site contacts) all
correctly respond `204 No Content` with an empty body. `apiClient.ts`'s shared `api()` helper
unconditionally called `res.json()` on any `res.ok` response, which throws on an empty body
even though the request itself succeeded - so **every delete button in the app** has been
reporting failure on success, not just this one. Fixed by reading the response as text first
and only `JSON.parse`-ing it if non-empty; no caller reads a DELETE call's resolved value, so
returning `undefined` for the empty case doesn't change any behavior. Frontend-only, `tsc
--noEmit` and full `next build` clean, ships via the normal `admin-web` git-push auto-deploy -
no `zan-app-api` deploy needed.

**Not yet verified live** (same "agent can't log into admin-web" restriction) - worth a real
click-through of a delete button post-deploy to confirm the success case now resolves cleanly
instead of throwing.

### create_purchase_order code-reuse fix, and re-confirming the cloud-session deploy blockers (2026-08-16, later)
Picked up from the "Current open items" backlog (no new user report this time) - the one
flagged as `create_purchase_order`'s confirm handler duplicating line-item construction inline
instead of reusing a shared helper, the way `create_quotation` already did via
`createQuotationRecord`.

Extracted `createPurchaseOrderRecord(tx, input, createdById, poNumber, companyState)` in
`routes/purchase-orders.ts`, exported the same way `createQuotationRecord` is, and pointed both
the real `POST /purchase-orders` route and the agent's `executeConfirmedAction` dispatch
(`agentConversations.ts`) at it. Beyond deduplication, this fixes a small real asymmetry: the
duplicated agent-side version generated the PO number and created the row in two separate
`prisma.$transaction` calls, while `create_quotation`'s confirm handler already wrapped both
steps in one transaction together - now purchase orders do too, closing a (very unlikely, since
`nextDocumentNumber` and the create were adjacent statements with nothing to fail in between) gap
where a number could theoretically be allocated without a matching PO ever being created.
Behavior-neutral otherwise - same fields, same tax calc, same DRAFT status. `tsc --noEmit` and
the API's production `tsc -p tsconfig.json` both clean.

Also re-verified, independently and from scratch rather than trusting the prior session's
note, that this session (cloud/web, same as the last one) genuinely cannot run the
`zan-app-api` manual deploy dance: `curl "$HTTPS_PROXY/__agentproxy/status"` followed by a
direct connection attempt to `api.vercel.com` both confirm the network-policy block is still in
place, and `list_agents` found no Desktop Commander or sibling session to hand the deploy off to.
**This now stacks two undeployed `zan-app-api` fixes on `master`** (this one + the customer-role
Users-guard from the prior session) - see "Current open items" for both and the one verification
step to run after deploying.

### Customer email-OTP silently never sending: root cause + guard against recurrence (2026-08-16)
User reported requesting an email OTP for `zanfpowersystems@gmail.com` and never receiving it -
no error either. Root cause: that email existed as a `User` row (`name: "Zan-F Test"`, role
`customer`, created 2026-08-15) with `customerId` = **null**. The email-OTP eligibility check
(`findEmailOtpEligibleUser` in `auth.ts`) requires `customerId` to be set for a customer-role
account; when it's null the request falls through to the deliberately-generic "if that email is
registered, an OTP has been sent" response *without* ever creating an `OtpCode` row or calling
`sendNotification` - by design, to avoid leaking which emails are registered, but the side effect
is a silent dead end for exactly this kind of broken account.

How it happened: the Users page's generic "Add user" form lets staff pick *any* role from
`/meta/roles`, including "Customer" - but `POST /users` (`users.ts`) never touches
`User.customerId`, only real customer contacts created via the Customers page
(`POST /customers` or a contact added to an existing customer) get that field set. Picking
"Customer" from the Users page has always silently produced a login that can never work.

Fixed two ways, both needed since the UI guard alone doesn't stop a direct API call:
1. `apps/api/src/routes/users.ts` - `POST /users` and `PUT /users/:id` now reject
   `roleKey: "customer"` outright, pointing at the Customers page instead.
2. `apps/admin-web/src/app/users/page.tsx` - "Customer" filtered out of the role dropdown
   (both Add and Edit) at the point roles are fetched, so it can't be picked from the UI at all.

Verified no other table referenced the broken row (`OtpCode`, `NotificationLog`,
`AgentConversation`, `PendingAction`, `Complaint`, `WorkOrder`, `Site`, `Vendor` all zero rows
against it) before deleting it directly via the Supabase MCP - not part of the code diff, a
one-off prod data cleanup. `tsc --noEmit` and full builds clean for both apps.

**This was a cloud/web session, so only the `admin-web` half (commit `31d2955`, dropdown
removal) is actually live** - the `zan-app-api` half needs the manual deploy dance, which this
session had no way to run (see the "Tooling note" section above, expanded this session with why).
See "Current open items" above for the exact verification step once it's deployed.

### Copy button on assistant chat responses (2026-08-16)
Small follow-up in the same session as the Reports section below. Added a "Copy" control
under every assistant message in `AgentChatBubble.tsx` (async Clipboard API, `execCommand`
fallback for non-secure contexts, brief "Copied" confirmation) — copies the response's raw
markdown text. Admin-web only; `tsc --noEmit` + full `next build` both clean.

### Reports section: SITC status, finance, customer history, vendor performance (2026-08-16)
User asked for a way to generate and print reports. Four report types under a new **Reports**
nav item (`/reports`, promoted from the disabled "Coming Soon" `phase2Links` placeholder in
`Nav.tsx` to a real permission-gated link — the icon was already sitting there unused):

1. **Sites / SITC status** (`/reports/sitc`) — every order+site with its current stage,
   filterable by order-date range, customer, vendor, phase.
2. **Finance summary** (`/reports/finance`) — receivables/payables aging, GST summary (with its
   own date-range filter), revenue vs. expenses.
3. **Customer / order history** (`/reports/customer-history`) — pick a customer, see every
   order, site, invoice and complaint on record for them.
4. **Vendor performance** (`/reports/vendor-performance`) — pick a vendor, see every site
   assigned to them, a stage-breakdown KPI row, and complaints raised on their sites.

**Deliberately shipped with zero new backend routes.** Every report composes data client-side
from endpoints that already existed: `GET /sites`, `/customers`, `/customers/:id`,
`/invoices?customerId=`, `/complaints` (filtered client-side — the route itself only scopes by
the *caller's* `auth.customerId`, not an arbitrary query param, so a customer-history report
filters the full staff-visible list down to the one selected customer instead), `/vendors`, and
the finance module's existing `/finance/summary` + `/finance/reports/*` aggregation endpoints
(already fully built — this report is mostly composition, not new aggregation logic). This means
the whole feature shipped via plain `git push` (admin-web is git-connected) — no
`zan-app-api` manual deploy dance.

Each report has a **Print** button (`window.print()`, same browser-print pattern as the existing
quotation/invoice/PO print pages — doubles as "download PDF" via the browser's own print dialog,
deliberately not server-side Playwright/puppeteer rendering, which would sit on Vercel's
serverless runtime and risk the exact class of native-binding startup crash the `pdf-parse`
dynamic-import fix (see the in-app agent section below) was built to avoid) and an **Export CSV**
button (new `lib/csvExport.ts` — a small dependency-free Blob-download helper, no new npm
package, so none of the `npm install <pkg>` arborist-bug workaround was needed). A shared
`components/reports/ReportChrome.tsx` provides a print-only letterhead header (company
name/logo, report title, active filters, generated timestamp — hidden on screen via `hidden
print:flex`, since the on-screen page already has its own heading and filter controls which are
themselves `print:hidden`) and the Print/Export toolbar, reused by all four report pages.

Verified via `tsc --noEmit`, a full `next build` (all 33 routes compiled, the 5 new ones among
them, no errors), and `next start` + `curl` against all four new routes (200 OK) — **not
exercised as a logged-in user** (see the standing "agent cannot log into admin-web" gotcha
below); a real click-through of each report's filters/print/CSV-export is still owed.

Also worth knowing for next time: this was a **fresh clone with no `node_modules`** — first
`npm install` of the session (bare, no package argument) succeeded cleanly in ~60s including the
`packages/shared` postinstall build, no `EPERM`/arborist issues this time.

### Merged the mobile-built customer-agent branch, live-tested it as a real customer, found and fixed two bugs (2026-08-15)
User asked "how about chat access to customers" and, on hearing the tradeoffs, said they'd
already built this "yesterday, via my mobile app" and to go check GitHub/Vercel rather than
rebuild it. `git fetch && git branch -a` surfaced `origin/claude/customer-agent-scoping-voice` -
a single commit, based directly on the previous session's last commit, implementing exactly
this (see 2026-08-14's own changelog entry below for what it contained). Reviewed the diff in
full before merging given it's customer-facing data scoping - the security pattern was correct
throughout (customerId always read from `auth.customerId`, which only ever comes from the
verified session, never from tool input or anything the model could construct) - then merged
it (clean fast-forward) and actually did what its own commit message admitted wasn't done yet:
**logged in as a real seeded customer and used it.**

That live test found two real bugs the tsc/build-only verification couldn't catch:

1. **The chat bubble was never mounted for customers at all.** `AuthGuard.tsx` only renders
   `<AgentChatBubble />` in the staff sidebar layout branch; the customer-portal branch
   returned `children` with no bubble. A customer would never see the chat icon regardless of
   the Settings visibility toggle. Fixed by rendering it alongside `children` in the customer
   branch too.
2. **`create_complaint`'s documented siteId-lookup fallback was unusable.** Its own tool
   description says "look up the siteId with search_orders_and_sites first" - but that tool
   never returns `site.id` in its results (only address/companyName/stage/engineer/vendor), so
   the system prompt also pointed customers at `get_document_detail` as a fallback - which
   required `MANAGE_ORDERS` unconditionally for `docType: "order"`, a permission no customer
   has, with no customer-scoped branch at all. A customer literally could not resolve a siteId
   through either documented path. Fixed by adding the same `auth.customerId`-scoped pattern
   already used in `search_orders_and_sites`: customers get `VIEW_SITE_STATUS`-gated access to
   their OWN order (object-level check against the fetched row's `customerId`, done after the
   fetch since the row's own customerId is what's being checked against), staff keeps unscoped
   `MANAGE_ORDERS` access.

After both fixes, verified the complete flow end-to-end as the real customer: chat bubble
renders with customer-specific empty-state copy, `search_orders_and_sites` returns only their
own 4 orders (querying a real other customer's name by *name* returns nothing), Drive tools
refuse them outright, and `create_complaint` works fully - resolved a real siteId via
`get_document_detail`, produced a confirm card, confirming it created an actual `Complaint` row
correctly scoped to that customer and site (verified directly against the DB, not just the UI
saying "confirmed"). Also directly attempted to force a complaint onto **another real
customer's** siteId by calling the API directly with a crafted payload (bypassing the chat UI
entirely, in case a user tried to manipulate the agent into cross-customer access) - correctly
rejected with "You can only raise complaints for your own sites", zero rows created, confirmed
via direct DB query.

Deployed both apps (`admin-web` auto-deploy + the full `zan-app-api` manual dance) and verified
`/health` live. **The Settings → Agent Visibility toggle for Customer is still off in
production** - deliberately left for the user to enable when ready, exactly as the original
branch intended; only the code readiness changed today, not the go-live decision.

### Customer-facing agent tools, Drive-tool lockdown, and a mic button (2026-08-14)
Follow-up to the same-day location-search/markdown fixes below, prompted by the user asking
what would actually happen if the Super Admin turned on agent chat visibility for the Customer
role. Investigation found the agent's tool-permission model was staff-only by construction: the
3 Drive tools (`search_documents`/`list_documents`/`get_document_content`) had **no permission
check at all** (didn't even receive `auth` in their handler signature), while every zanApp
read/write tool gated on a `manage_*` permission the Customer role never has - so a customer
would've gotten the entire shared company Drive folder exposed, but zero ability to see even
their own order/site status, despite already holding `VIEW_SITE_STATUS` and `RAISE_COMPLAINT`.
Fixed as four pieces, all still gated behind the existing Settings → Agent Visibility toggle
(unchanged, still opt-in per role, still defaults to nobody):

1. **Drive tools now refuse any customer outright** (`driveTool.ts`) - checked via
   `auth.customerId` being set, the same signal `middleware/auth.ts` only ever populates for the
   Customer role. No per-customer partitioning exists for the shared Drive folder, so "no access"
   rather than a false sense of scoping.
2. **`search_orders_and_sites` now branches on `auth.customerId`** (`zanAppReadTools.ts`): a
   customer gets `VIEW_SITE_STATUS`-gated results forced to `where: { customerId: auth.customerId,
   ...their search }` - they can search within their own orders/sites (SITC stage, dispatch
   dates, assigned engineer, vendor) but a query for another company's name just returns nothing.
   Staff behavior (`MANAGE_ORDERS`, unscoped) is unchanged.
3. **New `create_complaint` write tool**, confirm-gated like the other four. Extracted the REST
   `POST /complaints` route's ownership check and creation+notify logic into two exported
   functions in `routes/complaints.ts` (`assertOwnSite`, `createComplaintRecord`) so the route,
   the tool's propose-time validation, and the confirm-time dispatch in
   `agentConversations.ts`'s `executeConfirmedAction` all share one implementation rather than
   three. `customerId` is always taken from `auth.customerId` (never from model/tool input) and
   re-verified against the site's owning order at both propose and confirm time - a customer can
   never attach a ticket to another customer's site by any input the model could construct.
4. **System prompt is now role-aware** (`buildAgentSystemPrompt(isCustomer: boolean)`) - a
   customer's turn gets a prompt describing only their two available tools and explicitly
   forbidding any implication that unreachable data (other customers, financials, documents)
   doesn't exist; staff keeps the original prompt. Both call sites (`agentConversations.ts`,
   `agentTest.ts`) updated.
5. **Mic button added to the chat input** (`AgentChatBubble.tsx`), Web Speech API
   (`SpeechRecognition`/`webkitSpeechRecognition`), client-side only, transcribes into the same
   `input` state typing already uses - no backend change, no new dependency. Feature-detected on
   mount and simply doesn't render where unsupported (Firefox, most Safari/iOS) rather than
   showing a dead button. Chat's empty-state copy is now role-aware too (customer wording
   mentions site status/complaints, not document search).

Verified via `tsc --noEmit` (both `apps/api` and `apps/admin-web`), each app's own production
`tsc -p tsconfig.json` build step, and a full `next build` (all 23 routes compiled, no type/lint
errors) - **not yet exercised against a live logged-in customer session**, since the agent
visibility toggle for Customer is still off in both local seed data and production (see Current
open items). Before relying on this, a real click-through as a seeded customer user is still
owed.

### In-app agent location-search bug, and the chat bubble rendering raw markdown (2026-08-14)
Two bugs reported back-to-back by the user actually using the shipped
features from earlier the same day.

1. **Agent falsely claimed a location "doesn't exist"** — asked "how many
   RECD are available in Belgaum", it replied that Belgaum "does not exist
   in the system", despite several Belgaum sites existing (imported
   2026-08-13 for Ethen Power Solutionns). Root cause:
   `search_orders_and_sites` (the only tool that could plausibly answer a
   location question) only ever matched `orderNumber` and `customer.name` -
   never `site.address` or `site.companyName`, and didn't even return
   address in its results. Fixed by extending the query's `OR` to match
   both site fields and returning them. Also tightened the system prompt:
   a zero-result search must be reported as "no matching records", not
   escalated to "X doesn't exist" (a search can't prove absence), and the
   agent can't claim to have "searched every module" unless it actually
   called a tool for each one that turn.
2. **Retested in the same chat thread → still showed the same wrong
   answer.** Not a regression - conversation history persists per thread
   (`AgentConversation.messages` JSON blob), and the model was reusing its
   own prior (pre-fix) tool-call/result from earlier in that same thread
   instead of re-invoking the tool. Confirmed the actual fix was correct by
   querying production directly (4 real Belgaum orders/sites exist) and
   verifying locally with an equivalent query. **Lesson: when verifying an
   agent-behavior fix, use a new conversation thread ("+ New") - the old
   thread's history can outweigh a corrected tool for the model.**
3. **Chat bubble showed raw markdown as literal text** - the agent already
   replies with real markdown (tables, bold, lists per its system prompt),
   but `AgentChatBubble.tsx` rendered `m.content` in a
   `whitespace-pre-wrap` div with no parsing, so users saw literal
   `| ORD-2026-9041 | **Platino RECD** | 1 |` pipe/asterisk text. Added
   `react-markdown` + `remark-gfm` with compact custom component styling
   sized for the ~300px chat panel (not full-page prose). Hit the
   react-markdown v9 "node" prop gotcha along the way: custom components
   receive the mdast AST node as a prop, and naively spreading `{...props}`
   onto the real DOM element leaks a literal `node="[object Object]"`
   attribute - **always destructure `node` out first** in any custom
   react-markdown component. Verified against a live local LLM response:
   real `<table>`/`<thead>`/`<tbody>`, no leaked attribute.

### Real email delivery, two new notifications, customer login simplified (2026-08-14)
Continuation of 2026-08-13's session. The email+OTP sign-in flow for
customers/vendors was already fully built (routes, eligibility logic, full
UI) - discovered while testing it that `EmailProvider.send()` was a stub
that only `console.log`'d, so **no email had ever actually been sent by
this app**, for OTP or any other notification, despite the README claiming
otherwise.

1. **Real SMTP wired up** — `lib/email.ts` (`nodemailer`), sending as
   `info@zanf.org` via Zoho Mail (`smtp.zoho.in`). `emailTemplates.ts`
   renders bespoke copy for `otp_code`; everything else falls through to a
   generic key/value rendering so nothing silently fails to send. Hit the
   `npm install <pkg>` arborist bug installing `nodemailer` (see gotcha
   above) - worked around by hand-editing `package.json` + bare `npm
   install`.
2. **Verified end-to-end against the real Zoho account** - not just "no
   errors in the log": confirmed `NotificationLog` rows with
   `channel: "email"` and `status: "sent"`, and for the OTP flow, completed
   a full `/auth/email-otp/request` → `/auth/email-otp/verify` round trip
   through the real route and got back a valid session token. Then set the
   same SMTP credentials as production env vars on `zan-app-api` via `vercel
   env add ... production` (piped stdin, non-interactive) and ran the full
   manual deploy dance.
3. **Two new/completed notifications**, both requested directly:
   customer-on-stage-change (`site_stage_updated` already existed and
   already targeted the right recipient - it just needed real send, plus
   better copy than the generic fallback) and vendor-on-assignment
   (`vendor_assigned_site`, new - `POST /sites/:id/assign-vendor` never
   notified anyone before this; now emails every member of a *newly*
   assigned vendor, not on a no-op re-save or a clear-to-unassigned).
4. **Login page simplified** - "Track Order" tab renamed to "Customer";
   the Order ID + phone flow was removed from the UI (Email + OTP only,
   "for now" per the user) - backend routes left untouched, see open items.

### Customers/Products/Vendors CRUD, real data import, first end-to-end deploy of both apps (2026-08-13)
Customers and Products had create-only UIs (or no UI at all, for Products)
before this session; both are now full CRUD with detail pages, and this was
also the first session where the entire deploy pipeline (git push to
`master` + the `zan-app-api` manual dance + direct production DB writes) ran
repeatedly and successfully in one sitting.

1. **Customers**: `PUT`/`DELETE /customers/:id` (delete guarded against
   existing orders/quotations/invoices/complaints), a `/customers/[id]`
   detail page listing every order+site for that customer with links into
   each site's progress page.
2. **Products**: new page from scratch — list/create/edit/delete, plus a
   `/products/[id]` detail page. Added `shape` (`cylinder`/`triangle`/
   `rectangle` enum), `dimensions` (free text — deliberately not split into
   length/width/height/diameter columns, since the right structured fields
   differ per shape), and `weightKg` to the `Product` model for future
   structure/scaffold sizing.
3. **Stale-modal bug**: the `?edit=<id>` deep-link from a detail page's Edit
   button re-opened the modal right after saving, because saving reloads the
   list while the query param is still in the URL, re-triggering the
   `useEffect` that watches for it. Fixed in both `customers/page.tsx` and
   `products/page.tsx` with a ref tracking which id has already been
   auto-opened, so the effect only fires once per id, not on every list
   refresh.
4. **Pre-existing build-blocking bug found only when actually deploying**:
   `orders.ts`'s `new Date(data.orderDate)` failed `tsc` because
   `orderDate` is optional on `createOrderSchema` (nullable on the model, to
   support bulk-imported operational orders without commercial figures
   yet) — `--noEmit` typechecks had been passing because nothing in this
   session's own changes touched that line, but `vercel build --prod`'s own
   `tsc -p tsconfig.json` step caught it immediately. Mirrored the existing
   `promisedDeliveryDate ? new Date(...) : undefined` pattern to fix.
5. **First full production deploy of this session's branch** — merged
   `feature/site-import-drive-documents` to `master` (this branch also
   carried the earlier multi-site-import/Drive-folders work, so that shipped
   in the same deploy), pushed (`admin-web` auto-deployed), applied the one
   missing migration to production (`Product.shape`/`dimensions`/
   `weightKg`) via the Supabase MCP, then ran the full `zan-app-api` manual
   deploy dance — required fix #4 above along the way. Verified via
   `GET /health` → 200 and `GET /products` / `GET /customers/:id` → 401 (not
   404) in production.
6. **Real product catalog import** — 30 RECD KVA variants imported from
   `RECD_Full_GA_Extraction.xlsx` (GA-drawing-derived weight/dimensions/
   shape) directly into the production DB via the Supabase MCP (no app-code
   change). One of the two prior "Products" rows (`RECD-250`) had a real
   order attached, so it was **updated in place** rather than deleted, even
   though the user's instruction was "delete the existing products, they
   were test" — the delete-guard logic already built for the API would have
   refused it anyway. The other (`recd`/`triangle`, 0 references) was
   deleted as genuine junk.
7. **Real site data import for one customer** — 29 orders+sites imported for
   "Ethen Power Solutionns Private Limited" from a local
   `Site and location Ethen.xlsx`, matched to the product catalog by KVA.
   One row's KVA (810) didn't exist anywhere in the master GA extraction and
   had dimensions identical to a nearby 910 KVA row — flagged to the user as
   a likely typo before proceeding; user confirmed it was genuine, so
   `RECD-810` was created as a new product rather than skipped or coerced to
   910.
8. **`Site.companyName` ("Site name") was stored and returned by the API but
   never rendered anywhere** in the UI except a buried edit field on the
   site detail page — only surfaced once the Ethen import made it obviously
   missing. Added it to: Sites list (new column), Site detail (now the page
   header, order number demoted to a subtitle), Orders list (new column),
   Order detail's "Installation site" + "other sites" cards, and the
   Customer detail page's per-order site cards.
9. **Staff can now add a vendor directly** — previously the only path into
   the system was public self-registration (`POST /vendor/register`,
   landing in `pending`) followed by staff approve/reject; there was no way
   for staff to add a vendor they already know and trust. Added
   `POST /vendors` (same `manage_vendors` permission already granted to
   Super Admin/Owner/Management in production — confirmed via direct query
   before writing any code, since the ask sounded like a permissions gap but
   wasn't) that creates the vendor pre-approved with an immediate contact
   login, reusing the same login-creation logic factored out of the
   `/approve` route.

### Finance module — built from scratch (2026-07 → 2026-08)
Zan-APP's Prisma schema originally had **no accounting/invoicing tables at
all** (confirmed by full route + model audit on clone day). Built out over
several sessions: Quotations, Invoices (proforma + tax invoice, with
issue/payment/edit-with-audit-log flows, TDS as a payment method, multi-row
payment recording), Purchase Orders, Expenses, and a Finance dashboard — all
with the same GST-aware `computeDocumentTotals` (CGST+SGST for intra-state,
IGST for inter-state) and a shared `nextDocumentNumber()` sequence generator
(`DocumentSequence` table) so document numbers stay strictly gap-free per
financial year. Product-catalog-backed line items with mandatory
description/HSN/qty/price/tax fields; free-text ("no product") lines are
allowed but can't later convert into an Order (see below).

Recurring bug pattern across this module, hit **three separate times**
(purchase-order HSN field, quotation Product picker, invoice edit
line-items): a field would exist correctly in component state and be sent in
the API payload, but the actual `<input>`/`<select>` was never rendered in
JSX — so the data silently never made it in from the UI, even though the
backend fully supported it. Worth specifically checking for "field in state
but not in JSX" when a report says "I can't set X" for any document form.

Production data hygiene: real invoices were entered and sample/seed data
removed (2026-07); a later full pass (2026-07-29) wiped all remaining
test/sample orders, sites, vendors, complaints, work orders, and 4 leftover
test-user logins from production, leaving only the 4 real invoices and 2 real
staff logins (Super Admin + Finance) — this was the last time production was
deliberately reset to a clean slate before real usage began.

### Print/PDF layout (2026-07-21 → 2026-07-25)
Quotation/Invoice/PO print pages went through several redesign iterations
(header/footer contact fields, terms-as-editable-bullets, a running
header/footer that was tried and then reverted because it overlapped
content, background-graphics and font fixes). Final state: single
non-repeating header/footer, bundled Tinos font, editable per-document terms
and footer note. **Lesson that stuck:** verify print output via a real
Playwright PDF render, not on-screen checks alone — that's what actually
caught the background-graphics bug during this work.

### In-app AI agent — built and deployed (2026-08-09 → 2026-08-12)
A floating chat-bubble assistant, backend in `apps/api/src/agent/`, built in
stages across one extended work stretch:

1. **Google Drive document search** — `googleDrive.ts` / `docExtract.ts` /
   `driveSearch.ts`, searches the `ZanF_DropBox` folder, extracts PDF/DOCX
   text (PDF extraction is a **lazy dynamic import** — see the pdf-parse
   crash entry below for why).
2. **Multi-provider LLM support** — `AgentLlmProvider` DB table (AES-256-GCM
   encrypted API keys via `AGENT_SECRETS_KEY`), any Anthropic or
   OpenAI-compatible provider (OpenAI/Gemini/Groq/DeepSeek/OpenRouter/
   Together/NVIDIA/custom), automatic fallback across providers in priority
   order on any individual request failure, a live model-picker in Settings
   that probes each provider's real models endpoint.
3. **Chat bubble + persistence** — `AgentConversation` table (JSON message
   blob per thread), Super-Admin-only visibility toggle
   (`CompanySettings.agentVisibleRoleKeys`), a daily Vercel Cron
   (`CRON_SECRET`-protected) that deletes conversations older than 30 days.
4. **9 read tools + 1 detail tool** (search across customers, vendors,
   quotations, invoices, POs, expenses, orders/sites, work orders,
   complaints — each mirroring its equivalent REST route's exact permission
   and row-level scoping) plus **4 confirm-gated write tools**
   (`create_expense`, `create_purchase_order`, `create_quotation`,
   `create_invoice`) built on a reusable `AgentPendingAction` infrastructure:
   the agent proposes a document with a human-readable preview, and only a
   user's explicit confirm click in the chat UI actually writes it — using
   the *exact same* create logic as the real REST routes (numbering,
   totals, validation), not a duplicate implementation.
5. **HSN/SAC made mandatory everywhere** (2026-08-11) after the write tools
   were observed repeatedly inventing plausible-but-fake HSN codes when the
   user didn't supply one — fixed at the shared Zod schema level
   (`lineItemSchema.hsnCode` now required), which automatically closed the
   gap for the agent, the quotation/invoice/PO create forms, and their edit
   forms all at once, plus fixed the actual root cause: the PO create form
   had the same "field in state, missing from JSX" bug described above.
6. **First production deploy** (2026-08-12) — the agent had been fully built
   in local dev for days but never actually shipped. Two independent gaps
   had to be closed together, with explicit user go-ahead since it touches
   prod DB + redeploys the live API: three missing Prisma migrations applied
   directly to the `zan-app` Supabase project, `CRON_SECRET` set on
   `zan-app-api`, and the manual deploy dance run for the first time since
   the agent code existed. A stale type bug (`hsnCode?: string` vs the now-
   mandatory `hsnCode: string`) was caught and fixed in the process.
7. **First deploy crashed on boot** — found via `npx vercel logs`, not a user
   report. `docExtract.ts` had a static top-level `import { PDFParse } from
   "pdf-parse"`; `pdf-parse` tries to load an optional native
   `@napi-rs/canvas` package, and on Vercel's Linux runtime (where that
   binary isn't available) its fallback path throws `ReferenceError:
   DOMMatrix is not defined` **at require-time** — since this sits on the
   startup import chain, that one throw crashed the *entire* API, not just
   PDF search, taking down even `/health`. Fixed by making the `pdf-parse`
   import a **dynamic `await import()`** scoped inside the PDF-extraction
   branch only, wrapped in a try/catch — confines any future failure of that
   package to "PDF extraction unavailable" instead of an app-wide outage.
   Rebuilt and redeployed; `/health` and `/agent/providers` both verified
   healthy afterward. **General lesson: any dependency with optional native
   bindings should be dynamically imported, not statically, if it sits
   anywhere near a serverless app's startup chain.**

Agent module status as of 2026-08-12: fully live in production. Still gated
behind the two Settings-page configuration steps noted in "Current open
items" above (agent visibility + at least one LLM provider).

### Quotation → Order conversion was completely broken (2026-08-12)
**Report:** clicking "Convert to order" on an accepted quotation always
failed with `400 Quotation needs at least one line with a product`. Root
cause was the same "field in state, missing from JSX" pattern as the PO/HSN
bug: neither the New nor Edit quotation modal ever rendered a Product
`<select>`, so no quotation could ever have a `productId` set, and every Edit
save was silently stripping `productId` off existing lines too. Fixed by
adding the missing dropdown to both modals (frontend-only, no API/schema
change) and shipped via the normal git-push auto-deploy for `admin-web`.

### Quotations couldn't be deleted (2026-08-12)
**Report:** no way to remove test/mistake quotations. There was genuinely no
delete capability anywhere — not in the API, not in either quotation screen.
Added `DELETE /quotations/:id` (guarded: refuses if the quotation has already
been converted to an order, or has an invoice/proforma created from it, to
guarantee real financial records can never be orphaned) plus a Delete button
on both the quotations list (table + mobile cards) and the quotation detail
page. Required the full `zan-app-api` manual deploy dance since it's a
backend route change; shipped and verified live (`DELETE
/quotations/<fake-id>` correctly returns 401 in production, confirming the
route exists rather than 404).

---

*History prior to 2026-08-12 was condensed into the changelog above from a
much longer section-by-section log (originally §1–§66). If a specific
historical decision's full rationale is needed and isn't captured here, it's
recoverable from git history on this file.*

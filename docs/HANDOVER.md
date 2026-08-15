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

> **Session boundary (2026-08-15):** working tree clean, `master` at
> `81c85e9`, fully pushed to `origin`. Both `admin-web` and `zan-app-api`
> are deployed and verified live at that commit — nothing in progress,
> nothing uncommitted, no pending deploy. The one open decision waiting on
> the user (not a code gap): flip on **Settings → Agent Visibility → 
> Customer** in production whenever they want the customer-facing chat
> assistant (built + verified 2026-08-15, see changelog) to actually go
> live for real customers. Start a new session by reading this file top to
> bottom before touching anything - "Current open items" and the top of
> "Changelog" are the fastest way back up to speed.

## Quick facts

| | |
|---|---|
| **Local ports** | API `4011`, admin-web `6011` (deliberately different from Platino's `4001`/`6001` so both repos can run side by side — see gotcha below). Use `preview_start(name: "zan-api")` / `preview_start(name: "zan-admin-web")`. |
| **Production DB** | Supabase project `zan-app`, ref `idqzupopsuusoihpmoqc`, region `ap-south-1` (Mumbai). |
| **Vercel — admin-web** | `admin-web` project, **git-connected** — push to `master` auto-deploys. URL: `admin-web-three-blush.vercel.app`. |
| **Vercel — api** | `zan-app-api` project (`prj_yf9RGAw5mnBhJdVi9lDCJncdkrnS`, team `ferose-salahudeen-s-projects`), **NOT git-connected** — needs the manual deploy dance below every time. URL: `zan-app-api.vercel.app`. |
| **Google Drive (agent doc search)** | Dedicated account `zanfpowersystems@gmail.com`, folder `ZanF_DropBox` (id `1M3V4MdO0NLMHPJMr7naK0EFGLIT8aIRU`). OAuth consent screen is in **Testing** status → refresh tokens expire every **7 days**; re-consent or complete Google verification for a permanent token. |
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

1. Stop any local `zan-api` dev server first (Windows Prisma `EPERM` gotcha).
2. `npx vercel pull --yes --environment production`
3. `npx vercel build --prod` — **takes 15–20 minutes**, almost entirely spent
   in Vercel's `@vercel/nft` file-tracing step, not in `tsc` (which alone
   takes ~15s). CPU/memory climb steadily the whole time — that's normal, not
   hung; confirm via `Get-Process`/`Get-CimInstance` polling if unsure.
4. **Patch `@recd/shared`** into all 5 spots the npm-workspaces symlink
   doesn't survive Vercel's Windows-symlink-unaware function tracer — this
   step is required after every fresh build, since each build's own install
   step wipes it:
   - `apps/api/node_modules/@recd/shared`
   - `.vercel/output/functions/api/index.func/node_modules/@recd/shared`
   - `.vercel/output/functions/api/index.func/apps/api/node_modules/@recd/shared`
   - `.vercel/output/functions/index.func/node_modules/@recd/shared`
   - `.vercel/output/functions/index.func/apps/api/node_modules/@recd/shared`
5. `npx vercel deploy --prebuilt --prod` from `apps/api`.
6. Verify: `GET /health` → 200, and a route that requires auth (e.g.
   `GET /agent/providers` or `DELETE /quotations/<fake-id>`) → 401, not 404 —
   404 means the deploy didn't actually pick up the change.

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

## Known gotchas (still live)

- **`next dev` is broken in this environment** (not production-affecting):
  `globals.css`'s `@import`/`@tailwind` lines fail through Next's
  React-Server-Components CSS loader path specifically — reproduces even on a
  totally clean `node_modules`/`.next`/`.turbo`. `next build && next start`
  works correctly and is what Vercel uses anyway, so production is unaffected.
  Use `next build && next start` for local admin-web testing until this is
  root-caused.
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

## Current open items (as of 2026-08-15)

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
- No `DELETE /vendors/:id` — a vendor added by mistake (self-registered or
  staff-added) can only be **rejected** (status flip), not removed outright.
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
- Minor code-reuse inconsistency: `create_purchase_order`'s confirm handler
  duplicates line-item construction inline, while `create_quotation` reuses
  the real route's exported helper directly. Cosmetic.
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

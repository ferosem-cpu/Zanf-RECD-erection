# Platino RECD Tracker — Handover

> **⚠️ Fork notice (2026-07-19):** this file's history below (§1–§19) documents
> the **original Platino RECD tracker project**, inherited as-is from the
> codebase this app was cloned from. Everything in this repo from §20 onward
> is about **Zan-APP, a separate project for a different company** — not
> Platino. Do not treat §1–§19 as this project's own roadmap or current state;
> it is background on the code this app started from. See §20 for where the
> two projects diverge.

## 1. What it is
A role‑based **Project & Service Tracker** for Platino, an RECD (Retrofit Emission Control Device) manufacturing + installation business. It tracks an order from sale through on‑site installation and commissioning (the **SITC** process: Supply → Installation → Testing → Commissioning), handles customer complaints, and gives each role a tailored view. Built to ship **Phase 1** now while keeping the full long‑term vision **future‑ready**.

## 2. Stack & layout
Turborepo monorepo, **npm workspaces**, TypeScript end‑to‑end. Working dir: `D:\Projects\Claude code`.

| Package | What | Key tech |
|---|---|---|
| `apps/api` | Backend REST API | Express **5**, Prisma, JWT auth |
| `apps/admin-web` | Staff + customer web console | Next.js **14** (App Router), Tailwind |
| `apps/mobile` | Field/customer mobile app | Expo / React Native (**not runtime‑tested**) |
| `packages/shared` | Cross‑app contracts | Zod schemas, constants, DTO types |

**Database:** Supabase Postgres (region `ap-south-1`, Mumbai — see §16 for migration history), reached via **poolers** (direct connection needs IPv6) — transaction pooler `:6543?pgbouncer=true` for queries, session pooler `:5432` for migrations. Migration applied + seeded. Creds live only in gitignored `apps/api/.env`.

## 3. Core architecture principle — "data, not code"
Anything that might grow a new value later — **stages, roles, permissions, statuses, photo checkpoints, structure types** — is a **row in a table**, never a hardcoded enum. Adding a new stage/role/status later is a DB insert, not a code change. The only real enum is the structural `SitcPhase`. This is the literal mechanism behind "keep everything future‑ready."

Same pattern for **notifications** (one `NotificationService.send()` with real In‑App/Email providers + stubbed SMS/WhatsApp/Telegram behind the same interface) and the **structure‑diagram generator** (Phase‑2 stub behind an interface).

## 4. Roles & access model (central to the app)
**Super Admin ≠ Management** — this was a deliberate split for commercialization:
- **Super Admin** — the *only* role with `manage_settings`. Owns the white‑label/branding (logo, theme) for when the app is sold to other manufacturers. Full access otherwise.
- **Management** (Owner/Proprietor/CEO/CTO) — everything **except** Settings.
- **Sales** — orders. **Operations/PM** — site status + pending actions. **Erection/Commissioning Engineers** — update site status + act on complaints *assigned to them*. **Service Team** — triage/assign/resolve complaints. **Finance** — placeholder (no modules yet). **Customer** — own order/site only, raise complaints, resolve their own approvals.
- **`manage_vendors`** (Super Admin + Management) gates vendor approval and site→vendor assignment. **Erection engineers now belong to an external vendor** (`User.vendorId`) and see only their own vendor's sites — see §11.

The web UI gates every menu item **and** route by permission; the API enforces it independently.

## 5. What this work delivered (the hardening pass)
The build had the permission system + read‑only screens but **no action UIs**, so several roles couldn't do their job. This pass fixed that and closed an audit's worth of gaps. Committed as **`3974b32`** on `master`.

- **Complaints:** engineers act on **assigned tickets only** (new `act_assigned_complaints` permission; API 403s otherwise); Service Team assigns via a "Manage" modal.
- **Site updates:** status‑update form, checkpoint photo upload, exhaust‑hookup confirm — on the site detail page, gated by `change_site_status`.
- **Orders:** "New order" form with inline new‑customer creation (creates the customer + a contact whose **phone is their Order‑ID login credential**); `GET /orders` now permission‑gated.
- **Customer OTP** delivered over the **email channel** (dev mode echoes the code for testing; production never returns it).
- **Identity fix** (the "everyone shows as Zarina" bug): real `AuthProvider` + `GET /auth/me`; Finance (no perms) gets a clean **"No modules enabled yet"** screen instead of a blank page.
- **Security/robustness:** `authenticate` rejects deactivated users and reloads permissions per request; users are **deactivate/activate** (not hard‑deleted) with a last‑super‑admin guard; notifications are best‑effort; client handles 401; customer portal can resolve the exhaust‑hookup approval.

## 6. Verified working (live browser + API)
Erection engineer posted a status update → site advanced and the **customer portal reflected it**; customer logged in via Order ID + **email OTP** and raised a complaint; Service Team assigned it; engineer saw **only** that ticket, updated it (200), was **blocked (403)** from others; Super Admin saw Settings, Management didn't; Finance got the no‑modules screen. Both apps `tsc --noEmit` clean.

## 7. How to run + test
Servers are **live now** (`http://localhost:6001`). To run yourself from `D:\Projects\Claude code`:
```powershell
npx turbo run dev --filter=@recd/api --filter=@recd/admin-web
```
Staff logins: `superadmin@ / owner@ / sales@ / ops@ / erection@ / commissioning@ / service@ / finance@platino.example`, all password **`changeme123`**. Customer (Track My Order): `ORD-2026-0001` + `+919900011122` (OTP shows on‑screen + in the API terminal).

## 8. Before production / known gaps
- **Rotate secrets:** all seed passwords are `changeme123`, the Supabase DB password has been exposed in chat, and `JWT_SECRET` is a placeholder.
- **Email is a console stub** — `EMAIL_PROVIDER_API_KEY` empty; OTP/notifications log to the server console. Wire a real provider (Resend/SES/SendGrid) — no caller changes needed.
- **SMS/WhatsApp/Telegram** are deferred stubs.
- **Photo upload** stores base64 data‑URLs (works; no S3 yet).
- **Mobile app** not runtime‑tested — first run is `npx expo start` on a device.
- **Structure‑diagram generator** is schema‑only (Phase 2).
- Minor: `mustChangePassword` isn't server‑enforced on mutating routes (client‑guarded); `owner_admin` is an orphan role; New‑Order modal / photo upload / full exhaust‑mismatch loop are built + typecheck‑clean but not each click‑tested.

## 9. Vercel deployment
Two separate Vercel projects: **admin-web** (root directory `apps/admin-web`, Next.js) and **api** (root directory `apps/api`, Node). Both need "Include files outside the Root Directory in the Build Step" enabled since this is an npm-workspaces monorepo.

- **admin-web → api connection:** the browser calls `NEXT_PUBLIC_API_URL` (see `apps/admin-web/src/lib/apiClient.ts`), which is baked in at **build time**. Must be set as an env var on the admin-web Vercel project pointing at the deployed api project's URL — changing it requires a redeploy, not just a save.
- **api build pipeline:** `apps/api/vercel.json` uses `buildCommand: "npm run build"` (runs `prisma generate && tsc`) plus a plain‑JS `apps/api/api/index.js` that `require()`s the precompiled `dist/index.js`. **Do not** reintroduce a legacy `"builds"` array in that vercel.json — it silently makes Vercel ignore the dashboard Build/Install Command entirely, so `prisma generate` never runs, the deployed function has no real Prisma client, and every DB call crashes (`FUNCTION_INVOCATION_FAILED`) while the build log fills with `TS7006`/`TS2694` implicit-`any` errors (Prisma-derived types collapsing without a generated client).
- **`packages/shared` must compile to CommonJS** (`packages/shared/tsconfig.json` overrides `module`/`moduleResolution`) — it's `require()`'d from `apps/api`'s CommonJS output, and plain Node (unlike bundler-based tooling) can't resolve ESM's extensionless relative imports.
- **Redeploy ≠ deploy latest.** Clicking "Redeploy" on an old deployment row in the dashboard rebuilds *that deployment's pinned commit*, not the branch's latest. Always check the log header's `Commit:` line, or just push and let Git auto-deploy create a fresh deployment. Whichever deployment should be live needs **Promote to Production** explicitly.
- Env vars (`DATABASE_URL`, `JWT_SECRET`, etc.) are set separately per Vercel project — api and admin-web don't share them.

## 10. Key files
- Contracts: `packages/shared/src/{constants,schemas,types}.ts`
- Schema/seed: `apps/api/prisma/{schema.prisma,seed.ts}`
- API routes: `apps/api/src/routes/*` (auth, sites, complaints, orders, customers, pendingActions, dashboard, users, settings, lookups); auth in `src/middleware/auth.ts`
- Web: `apps/admin-web/src/components/{AuthContext,AuthGuard,Nav}.tsx`; pages under `src/app/*`
- Responsive helpers (shared CSS): `apps/admin-web/src/app/globals.css` — `.data-card`, `.data-card-row`, `.table-desktop`, `.cards-mobile`, `.table-scroll`, `.modal-panel` (mobile sizing)
- Memory (persists across sessions): `…/memory/project_recd_tracker_app.md`
- Vendor routes: `apps/api/src/routes/vendors.ts`; vendor pages: `apps/admin-web/src/app/vendors/page.tsx`, `apps/admin-web/src/app/vendor/register/page.tsx`

---

## 11. Vendor management (added 2026-06-30, migration `20260630065402_add_vendors`)
External erection companies ("vendors") are **not** part of Platino — erection is subcontracted.

- **Self-registration** (public, no login): `/vendor/register` → `POST /vendors/register` creates a `pending` vendor. Linked from the login page.
- **Management review/approval**: `/vendors` page (`manage_vendors`) lists all vendors with status + engineer/site counts. Approving (after due diligence) **auto-provisions the vendor's primary contact as an erection-engineer login** — the temp password is shown once. Reject/Reconsider available.
- **Adding more vendor engineers**: Users page → add user with role *Erection Engineer* now requires choosing an **approved vendor** (API enforces it; 400 otherwise).
- **Assigning work**: the site detail "Vendor assignment" control (`manage_vendors`) sets `Site.vendorId` — that's what scopes the site into a vendor's view.
- **Isolation (multi-tenant)**: a vendor's engineers only see/act on sites with their `vendorId`. Enforced on `GET /sites`, `GET /sites/:id`, and every site mutation (another vendor's site → **403**). Vendors never see other vendors (the `/vendors` list requires `manage_vendors`, which vendor users don't have).
- **Data model**: `Vendor` (status, contact, approvedBy/At) + `User.vendorId` + `Site.vendorId`. The seed transfers the sample erection engineer (`erection@platino.example`) and sample site under the approved vendor *Coimbatore Erectors LLP*; *Salem Fabrication Works* is seeded `pending` for the demo.

## 12. Operational notes (gotchas hit during the build)
- **After editing `packages/shared`, rebuild it**: `npm run build --workspace=packages/shared`. Its `main` is `dist/index.js`, so the API/web/seed read the **compiled** output — source edits don't apply until rebuilt (root `postinstall` and `turbo` do this automatically; a direct edit does not). Symptom if you forget: a newly-added constant reads as `undefined` at runtime.
- **Windows Prisma `EPERM` on generate**: if `prisma generate` can't rename `query_engine-windows.dll.node`, a running node process has the DLL loaded. Stop this project's dev servers first; find the exact holder with `Get-Process node | ? { $_.Modules.FileName -like '*Claude code*query_engine*' }`.
- Ports: API pinned to **4001** via `apps/api/.env` (`PORT=4001`); web is `next dev -p 6001`.

## 13. Updated verification (2026-06-30)
Vendor flow verified end-to-end (API + UI): public registration (201) → management approval (creates login + temp password) → vendor isolation (Coimbatore engineer sees only their site; a second vendor sees 0 sites and gets **403** opening the first vendor's site) → erection-engineer-without-vendor rejected (**400**). The `/vendor/register` page renders logged-out; the `/vendors` console renders with status + approve/reject. Both apps `tsc --noEmit` clean.

## 14. Mobile-responsive UI
The admin-web was a desktop-only layout — a fixed 240 px sidebar plus wide tables that overflowed horizontally on phones, modals that exceeded the viewport, and several grids (`grid-cols-3/4/2` without breakpoint prefixes) that crushed content below ~640 px. This pass made every admin-web screen mobile-responsive from 320 px → 1024+ without touching API contracts, business logic, auth, permissions, theming, env vars, `vercel.json` or `next.config.js`. Three commits on `master`: `16a2dd9`, `ce24f23`, `4a33312`.

**Shell (`apps/admin-web/src/components/`)**
- `Nav.tsx` is now an off-canvas drawer below `lg` (1024 px), with a backdrop, route-change auto-close, and a built-in close button. From `lg` upwards it renders exactly as before (`lg:relative lg:translate-x-0`).
- `AuthGuard.tsx` injects a sticky **mobile top bar** with a hamburger (`data-testid="mobile-menu-button"`) shown only below `lg`. Main content padding scales `p-4 sm:p-6 lg:p-8` so phones get the full viewport width.

**Responsive primitives (`globals.css`)** — used by every list screen:
- `.table-desktop` hides itself below `md` and is wrapped in `.table-scroll` (horizontal touch-scrolling) when shown.
- `.cards-mobile` shows below `md` and contains a stack of `.data-card` items.
- `.data-card` / `.data-card-row` give a consistent label/value card layout (label is uppercase, muted, fixed; value is right-aligned, word-break enabled).
- `.modal-panel` now `max-height: calc(100dvh - 2rem)`, `overflow-y: auto`, and uses smaller padding on mobile so tall forms (New Order, Manage Complaint, Edit User) scroll inside the panel instead of off the viewport.
- `.upload-zone` padding shrinks on mobile so the Logo upload doesn't dominate the screen.

**Per-screen changes (no business logic touched)**
- **Dashboard:** `grid-cols-4` → `grid-cols-2 sm:grid-cols-4`; complaints `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`. Title scales `text-xl sm:text-2xl`. `data-testid="dashboard-page"`.
- **Orders:** Header stacks on mobile (`flex-col sm:flex-row`). Same data rendered as `.cards-mobile` below `md` and the original table inside `.table-desktop` from `md` up. New-order modal grids fixed: `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`, contact pair `grid-cols-2` → `grid-cols-1 sm:grid-cols-2`. testIDs: `orders-page`, `orders-new-button`, `orders-mobile-cards`, `order-card-<orderNumber>`.
- **Sites:** Same desktop-table / mobile-card pair. Mobile card is a `<Link>` so tapping the card navigates to detail. "Stuck Nd" badge is preserved in both layouts.
- **Site detail:** Photos `grid-cols-4` → `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`. Title scales.
- **Complaints:** Overview tiles `grid-cols-3 sm:grid-cols-5` → `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`. Table → cards on mobile; the "Manage / Update" action becomes a full-width button inside each card. testIDs: `complaints-page`, `complaints-mobile-cards`, `complaint-card-<ticket>`, `complaint-action-<ticket>`.
- **Users:** Add-user form is now a real responsive grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-5`) instead of `flex flex-wrap`; submit goes full-width on mobile. Table → cards; the icon-only Edit / Reset / Deactivate / Activate actions become labelled buttons inside each card.
- **Settings:** Branding row stacks on mobile; theme grid `grid-cols-2 sm:grid-cols-2 md:grid-cols-3`; Live Preview goes from side-by-side to stacked below `sm`; section padding `p-4 sm:p-6`.
- **Customer portal:** Top navbar paddings shrunk, title truncates, "Sign Out" label hides on the smallest viewport while the icon stays. Main grid uses smaller gap below `lg`. `data-testid="customer-portal-page"`, `portal-signout-button`.

**Things that were intentionally NOT changed**
- Desktop UI at `lg+` is byte-for-byte identical to before — all changes are additive via `sm:` / `md:` / `lg:` Tailwind prefixes.
- `apps/api/**`, `apps/mobile/**`, `packages/shared/**`.
- Tailwind config, PostCSS config, Next config, Vercel config, env vars.
- All routes, permissions, API surfaces, testIDs that already existed.

**Verification**
- `npm run build --workspace=apps/admin-web` → 13 routes, 0 type errors, 0 warnings.
- ESLint clean across all changed files.
- Manual visual sweep at 375 × 812 (phone), 768 × 1024 (tablet) and 1280 × 800 (desktop) for: login, dashboard, orders (+ new modal), sites, site detail, complaints (+ manage modal), users (+ edit/reset/deactivate flows), settings (theme + live preview), customer portal. Hamburger drawer open/close confirmed.

**Local preview tip**
For visually testing the responsive UI without standing up Postgres locally, set `NEXT_PUBLIC_DEMO_MODE=1` in `apps/admin-web/.env.local` and add a small `src/lib/_demoMock.ts` that short-circuits `api()` in `apiClient.ts` with sample data. This file is intentionally **not** in the repo — it's a dev-only convenience and should never be committed.

## 15. Premium industrial design system (2026-06-30)
Visual-only redesign requested as "modern, clean, premium industrial — inspired by Siemens/Schneider/ABB/Honeywell/Caterpillar." Implemented entirely through the **existing white-label theme engine** rather than per-page color overrides, so it stays compatible with §1's "data, not code" principle and the Settings page's customer-facing theme picker. Commits: `92af248`, `ab68625`, `180dba3` on `master`.

**Palette (now the default theme)**
Primary/CTA orange `#F58220`, sidebar/heading blue `#0F4C81`, success/accent emerald `#22C55E`, page background `#F5F7FA`, white cards with soft shadows. Semantic status colors: success green, warning amber, error red.

**How it's wired (`apps/admin-web/src/lib/themes.ts`)**
The `slate` preset (key unchanged, `name` renamed to "Platino Industrial") now holds this palette and is the fallback when no theme is saved — so Super Admins who later pick a different preset or upload a custom palette via Settings are unaffected; this only changes what *out-of-the-box* looks like. `ThemeInitializer.tsx` applies it to `:root` CSS variables on first paint, same mechanism as before.

**New shared primitives (`globals.css`)**
- `.kpi-tile` / `.kpi-tile-icon` / `.kpi-tile-value` / `.kpi-tile-label` — rounded white stat cards with an icon chip, used on Dashboard and Complaints overview.
- `.status-pill` + `.status-pill-{success,warning,error}` — the one badge system every page now uses for ticket/site status (replaces several one-off `bg-red-50 text-red-700 border...` literals).
- `.progress-track` / `.progress-fill-{success,warning,error}` — thin rounded progress bars (available for use; not yet wired to a real percentage field anywhere, since none of the current data models expose one).
- `.field` — light-grey filled form input/select/textarea (replaces plain `border-gray-300` boxes), orange focus ring.
- `.bottom-nav` / `.bottom-nav-item` — floating rounded mobile tab bar (`apps/admin-web/src/components/BottomNav.tsx`), shown below `lg` only. Tabs: Dashboard, Sites, Complaints (each gated by the same permission as the sidebar link, hidden if the user lacks it), plus a Profile button that opens the existing `Nav` drawer via `AuthGuard`'s `mobileNavOpen` state — no new route was added for "Profile".

**Dashboard charts**
Added `chart.js` + `react-chartjs-2` (`apps/admin-web/package.json`). The dashboard now renders a bar chart (sites by SITC phase) and a donut chart (complaints by status), both fed by the existing `GET /dashboard` endpoint — **no API or schema changes**. Complaint slice colors are derived from status (`resolved`/`closed` → green, `escalated` → red, everything else → amber) directly in `dashboard/page.tsx`, not from the backend.

**Per-page status**
- Fully restyled with the new primitives: Dashboard, Sites, Complaints, Orders (form), customer portal (ticket form + status badges).
- Headings recolored to `var(--text-heading)`: Orders, Complaints, Vendors, Users, Settings, Site detail.
- Untouched but already correct: Login, sidebar/nav, all `.btn-primary`/`.card`/modal usages — these picked up the new palette automatically because they were already theme-variable-driven before this pass.

**Things intentionally not done**
- No charts added beyond Dashboard (no real per-site progress percentage exists yet to chart on Sites/Orders).
- Vendor approve/reject buttons keep hardcoded `bg-green-600` (semantic, not a theme color — left as-is).
- No business logic, auth, API contracts, or database changes anywhere in this pass.

**Verification**
`tsc --noEmit` and `npm run build` (admin-web) both clean after every commit in this series; no automated UI testing (Playwright/etc.) exists in this repo, so the visual result has only been checked by the user on the deployed Vercel preview.

## 16. QA & security audit (2026-07-02)
A full black-/grey-box test pass: the whole stack was stood up locally (Postgres 16 + migrate + seed, API on `:4000`, admin-web on `:6001`), every one of the 9 seeded roles was logged in through a **real headless-Chromium browser** (Playwright driving the actual UI, 34 screenshots) **and** exercised directly against the API. **No application code was changed in this pass — this section documents findings only.** Fixes are proposed but not yet applied.

**Role access — verified enforced server-side.** Every API route is guarded by `authenticate` + `requirePermission`, and the live status-code matrix matched the intended permission model exactly (e.g. Sales → 200 on `/orders` `/sites`, 403 everywhere else; Finance with no permissions → 403 on everything; `PUT /settings` → 200 only for Super Admin, 403 even for Management). Tenant isolation holds: a customer sees only their own order/sites/complaints, and a vendor's engineer sees only sites with their `vendorId` (cross-access → 403, re-confirmed by creating a second customer + order). Auth-bypass attempts (no token / garbage token / `alg:none`) are all rejected 401.

**Findings (ranked). None fixed yet.**
1. **HIGH — JWT secret has a hardcoded fallback.** `apps/api/src/lib/jwt.ts:3`: `const SECRET = process.env.JWT_SECRET || "dev-secret-change-me"`. If the API is deployed without `JWT_SECRET`, it signs/verifies with a public string — a token forged as `{roleKey:"super_admin"}` was accepted by the app's own verify logic (proven locally). No boot-time check fails when the var is missing. **Fix:** throw on startup if `JWT_SECRET` is unset; delete the fallback. (This overlaps the §8 note that `JWT_SECRET` is "a placeholder" — the risk is specifically the silent default, and it is directly relevant to the Vercel deploy: set `JWT_SECRET` on the api project.)
2. **MEDIUM-HIGH — IDOR / broken object-level auth on complaint creation.** `apps/api/src/routes/complaints.ts:88` writes `siteId` straight from the request body without verifying the site belongs to the caller. A customer POSTed a complaint against another customer's `siteId` → **201 Created**, and that complaint then surfaces in the attacker's own complaint list, leaking the victim's company name + order number. **Fix:** before create, load the site and require `site.order.customerId === req.auth.customerId`.
3. **MEDIUM — no rate limiting / lockout on `/auth/login` and `/auth/customer/verify`.** 12 wrong passwords then the correct one still succeeds (no throttle); 15 wrong OTP codes all just return 401 (6-digit code, 10-min window, unlimited attempts → brute-forceable). **Fix:** add `express-rate-limit` and an OTP attempt cap.
4. **LOW-MEDIUM — misc:** temp passwords use `Math.random()` not a CSPRNG (`users.ts:41,185`); `POST /users` doesn't set `mustChangePassword` (reset does — inconsistent, temp passwords persist); CORS is fully open (`index.ts` `app.use(cors())`); JWT stored in `localStorage` (XSS-exposable); `POST /auth/customer/register` returns distinguishable errors for unknown order vs unknown contact (order enumeration).

**Functional bug — permission-less user gets a blank screen.** After a *successful* login, Finance (or any role with no accessible module) is left on `/login` where `AuthGuard` renders `null` instead of the existing "No modules enabled yet" screen (that screen only appears if you manually navigate to a guarded route). `apps/admin-web/src/components/AuthGuard.tsx` — the `isLoginPage → return null` branch short-circuits before the `!firstLanding(...)` NoAccessScreen branch. **Fix:** render `NoAccessScreen` for an authenticated staff user with no landing even while on the auth pages.

**How to reproduce the test locally:** `.env` (root) or `apps/api/.env` needs `DATABASE_URL` + `DIRECT_URL` (Postgres) and `JWT_SECRET`; then `npm run build --workspace=packages/shared`, `prisma migrate deploy`, seed (`tsx apps/api/prisma/seed.ts`), start the API and `next dev -p 6001`. Staff logins are the §7 accounts (all `changeme123`); customer via `ORD-2026-0001` + `+919900011122` (dev OTP echoed on screen). Screenshots for all roles were captured but are not committed (dev artifacts).

## 17. Security fixes applied + deployment (2026-07-02)
The §16 findings were fixed and verified locally, then committed on branch
`claude/karate-app-security-audit-yieiko` (commit `59b10a1`).

**What changed (code)**
- `apps/api/src/lib/jwt.ts` — removed the `"dev-secret-change-me"` fallback; the module now **throws at startup if `JWT_SECRET` is unset** (fail-loud). ⚠️ *Deployment implication:* every environment scope (Production **and** Preview) must have `JWT_SECRET` set, or the api function crashes on cold start.
- `apps/api/src/routes/complaints.ts` — `POST /complaints` now loads the target site and rejects (403) unless `site.order.customerId === req.auth.customerId`. Verified: cross-customer → 403, own site → 201.
- `apps/api/src/middleware/rateLimit.ts` (new) + `apps/api/src/routes/auth.ts` — fixed-window limiter (10 / 15 min / IP) on login, OTP request and OTP verify. Verified: 401s then 429. *In-memory, so per-instance on serverless — see the file header for the shared-store upgrade path.*
- `apps/api/src/routes/users.ts` — temp passwords via `crypto.randomBytes` (not `Math.random`); `mustChangePassword: true` set on user creation.
- `apps/admin-web/src/components/AuthGuard.tsx` — an authenticated user with no accessible module (e.g. Finance) now sees the "No modules enabled yet" screen instead of a blank page. Verified in-browser.

Both apps `tsc --noEmit` clean; `apps/api` `npm run build` and `apps/admin-web` `npm run build` both succeed.

**Deployment topology (confirmed live 2026-07-02)**
- Two Vercel projects under team `ferose-salahudeen-s-projects`: **platino-recd-api** (`prj_grBAwYFoVIjJAtJg3uo3FqsPALrh`, framework express) and **platino-recd-admin-web** (`prj_Ozx4HCxv3FNyIog1asayGUQ1I7wA`, nextjs). Both are Git-connected: **push to `master` → production**, push to any other branch → preview.
- Supabase project `vpvrdjqmyymyrkmynfxy` (ap-northeast-1, Tokyo) was the database at time of audit. **Since migrated to `qpysyuysgcsrpvlxdglk` (ap-south-1, Mumbai) — see §18.**
- Production is healthy: `https://platino-recd-api.vercel.app/health` → `{"ok":true}`, `https://platino-recd-admin-web.vercel.app/login` renders.
- Production API is connected to the Mumbai Supabase project — verified 2026-07-05 (login returns HTTP 200).

**Env vars — not wired from this session.** There is no Vercel MCP tool to create/read/update environment variables, and no `VERCEL_TOKEN` was available, so env vars could not be set programmatically here. They are already configured from prior deploys (the preview proves at least `DATABASE_URL` + `JWT_SECRET` exist in Preview). To change them, use the Vercel dashboard (Project → Settings → Environment Variables) or provide a Vercel API token. Required per project: **api** → `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, and `NODE_ENV=production` (so the customer OTP is never echoed in the response); **admin-web** → `NEXT_PUBLIC_API_URL` = `https://platino-recd-api.vercel.app` (baked at build → redeploy after any change).

**To take the fixes to production:** merge `claude/karate-app-security-audit-yieiko` → `master` (production auto-deploys). Before doing so, confirm `JWT_SECRET` is set in the **Production** env scope of the api project — otherwise the new fail-loud check will crash the production function.

## 18. Database migration — Tokyo → Mumbai (2026-07-04/05)

**What changed:** The Supabase project was migrated from the original Tokyo region (`ap-northeast-1`) to a dedicated Mumbai project (`ap-south-1`) to reduce latency for the primary userbase in India.

| | Old (Tokyo) | New (Mumbai) |
|---|---|---|
| Supabase project | `vpvrdjqmyymyrkmynfxy` | `qpysyuysgcsrpvlxdglk` |
| Project name | ferosem-cpu's Project | platino-recd-mumbai |
| Region | ap-northeast-1 | ap-south-1 |
| Status | ACTIVE_HEALTHY (still running) | ACTIVE_HEALTHY (production) |

**How the migration was done:** The full schema was recreated from source and applied as a single Supabase migration (`20260705022134_initial_schema_recreate_from_source`). All three original Prisma migrations are reflected in `_prisma_migrations` on the new project. RLS (Row Level Security) is enabled on every public table — this was carried over from the old project's `enable_rls_all_public_tables` migration.

**Schema is identical** to the Prisma schema in `apps/api/prisma/schema.prisma` — no columns were added or removed during the migration. Seed + live data was loaded into the new project:

| Table | Rows |
|---|---|
| Role | 10 |
| Permission | 12 |
| RolePermission | 50 |
| User | 15 |
| Vendor | 5 |
| Complaint | 4 |
| NotificationLog | 36 |
| Customer / Order / Site | 1 each |

**Vercel env vars — DONE (2026-07-05):** `DATABASE_URL` and `DIRECT_URL` on the **platino-recd-api** Vercel project have been updated to point at the Mumbai poolers:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://postgres.qpysyuysgcsrpvlxdglk:…@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true` |
| `DIRECT_URL` | `postgresql://postgres.qpysyuysgcsrpvlxdglk:…@aws-1-ap-south-1.pooler.supabase.com:5432/postgres` |

A fresh production deploy was triggered immediately after and is **Ready**. Login at `https://platino-recd-api.vercel.app/auth/login` returns HTTP 200 — DB connection confirmed live against Mumbai. Note: Mumbai uses `aws-1-ap-south-1.pooler.supabase.com` (not `aws-0`) — this is correct for the `ap-south-1` region.

**Local `.env`:** `apps/api/.env` has also been updated to the Mumbai pooler URLs — local `prisma migrate` / `prisma generate` work against the correct DB.

## 19. Fix — data rendering still slow after the Mumbai migration (2026-07-05, commit `5b5f254`)

**Root cause:** moving the database to Mumbai bought no latency win, because the Vercel **api** function was never moved with it — it was still pinned to `iad1` (Washington D.C., US East), the Vercel default. Confirmed via `get_deployment`: `"regions": ["iad1"]` on the pre-fix deployment. Every request was still paying the same cross-continent round trip (browser in India → `iad1` → Mumbai DB → back) that existed before the migration, just to a different DB city than Tokyo. Pages that fire several sequential API calls on load (dashboard, sites list) compounded this.

**Fix applied:**
- `apps/api/vercel.json` — added `"regions": ["bom1"]` (Vercel's Mumbai region), pinning api compute next to the Mumbai Supabase project. Confirmed Hobby-tier projects can set a single region this way (no plan upgrade needed) — Vercel docs: "Hobby plans support one region; Pro and Enterprise support multiple regions."
- `apps/api/src/routes/sites.ts` — `GET /sites/:id` was doing two sequential DB round-trips per request (a visibility-check `findUnique`, then a second full-detail `findUnique`). Collapsed into one query, with the same customer/vendor permission checks applied to its result. Removed the now-dead `assertSiteVisible` helper.

**Verified:**
- `tsc --noEmit` and `npm run build --workspace=apps/api` clean.
- Locally against the live Mumbai DB (via `preview_start`, api on `:4001` / admin-web on `:6001`): logged in as Management, opened Sites → site detail — full nested order/customer/stage/vendor/photos/timeline data rendered with no console or server errors, confirming the collapsed query preserves the original 404/403 semantics.
- Pushed to `master` (commit `5b5f254`) → Vercel auto-deployed `dpl_7Yfdxx1og8LUVFwSvBfJiCeHSNYm`, confirmed **READY** with `"regions": ["bom1"]`. Production `/health` and `/auth/login` both return 200 on the new deployment.

**Not done:** `apps/admin-web` was left on its default Vercel region — it's client-rendered (the browser calls `NEXT_PUBLIC_API_URL` directly per §9), so admin-web's own region doesn't sit on the DB latency path and wasn't part of this fix.

---

# Zan-APP — this project's own handover

Everything below is about **Zan-APP**, a separate product for a different
company. It is unrelated to Platino RECD's ongoing work (§1–§19 above) beyond
sharing this starting codebase — separate requirements, separate data,
separate deployments going forward.

## 20. Project cloned locally; confirmed no accounting module exists (2026-07-19)

**Source:** `git clone https://github.com/ferosem-cpu/Zanf-RECD-erection.git D:\Projects\Zan-APP`. That GitHub repo (public, default branch `master`) is a one-time snapshot pushed 2026-07-11 — a duplicate of the Platino RECD codebase at that point in time, not kept in sync with Platino's repo since. Plain clone, no changes made: `master` checked out, working tree clean, HEAD at `4dfc088` ("docs(handover): add section 19 — fix for post-Mumbai slowness" — the last Platino-history commit, §19 above).

**Accounting/finance module: does not exist in this codebase.** Checked the full route list (`apps/api/src/routes/`: `auth`, `complaints`, `customers`, `dashboard`, `lookups`, `orders`, `pendingActions`, `settings`, `sites`, `users`, `vendors`) and every Prisma model (`Role`, `Permission`, `RolePermission`, `User`, `OtpCode`, `Customer`, `Vendor`, `Product`, `Order`, `Site`, `StageDefinition`, `StatusOption`, `SiteStageEvent`, `PhotoCheckpoint`, `SitePhoto`, `StructureType`, `StructureTemplateExample`, `PendingAction`, `Complaint`, `NotificationLog`, `CompanySettings`) — nothing accounting/ledger/invoice/payment/expense-related. If the new company needs accounting (invoicing, payments, ledgers, expenses), it will need to be designed and built from scratch, specifically for Zan-APP.

**Inherited as of the clone (2026-07-11 snapshot):** order/site/complaint tracking, role-based permissions (9 seeded roles), customer portal, vendor management, OTP-based customer auth, JWT staff auth, in-app/email notifications (WhatsApp/Telegram stubbed). **Not inherited** — added to Platino RECD *after* this snapshot, so absent here: RECD serial number rename, Company Details, complaint ticket overhaul, AMC Order module, AMC expiry reminders.

**Not yet done for Zan-APP:**
- No new-company branding, name, or identity applied anywhere yet — README, `package.json` names, and env var examples still say "Platino."
- No separate database, Vercel project, or any deployment target exists for this app yet — it currently has no live environment of its own and must not be pointed at Platino's Supabase/Vercel projects.
- No requirements gathered yet for what should differ from the inherited feature set for the new company (accounting module or otherwise).

## 21. Finance module built (2026-07-19)

The full commercial-document + light-accounting module from `docs/FINANCE_MODULE_PLAN.md` is now implemented end-to-end. This replaces the "no accounting module exists" finding in §20.

**What was built**
- **Schema (`apps/api/prisma/schema.prisma`):** new models `DocumentSequence`, `Supplier`, `Quotation`/`QuotationLineItem`, `Invoice`/`InvoiceLineItem`, `PaymentReceived`, `PurchaseOrder`/`PurchaseOrderLineItem`, `Bill`, `PaymentMade`, `ExpenseCategory`, `Expense`. Modified `Customer` (gstin/state/billingAddress), `Order` (customerPoNumber/Date + finance back-relations), `CompanySettings` (legalName/address/state/gstin/pan/bank*/terms/defaultTaxRatePct), `Product`/`Site`/`Vendor`/`User` (back-relations). One migration: `add_finance_module`.
- **Shared (`packages/shared`):** finance permission keys merged into `PERMISSION_KEY` (`manage_quotations`, `manage_invoices`, `record_payments`, `manage_purchase_orders`, `manage_expenses`, `view_finance_dashboard`); status/type consts (`QUOTATION_STATUS`, `INVOICE_DOC_TYPE`, `INVOICE_STATUS`, `PO_STATUS`, `BILL_STATUS`, `PAYMENT_METHOD`, `FINANCE_DOC_TYPE`, `EXPENSE_CATEGORY_KEY`); Zod schemas + DTO types.
- **Services:** `documentNumber.ts` (atomic per-fiscal-year sequential numbers, Indian FY Apr–Mar, no gaps from deleted drafts — `QTN/2026-27/0001` etc.), `taxCalc.ts` (server-recomputed totals; intra-state CGST+SGST halves / inter-state IGST).
- **API routes:** `quotations`, `invoices`, `purchase-orders`, `expenses`, `financeDashboard`, `portal` (customer invoices), plus `/meta` expense-categories + payment-methods and `PUT /settings` company fields. Every route guarded by `authenticate` + `requirePermission`; finance status derives from payments (paid/partially_paid, 400 on overpay); "overdue" computed at read time.
- **Seed:** finance permissions + grant to Finance/Management/Owner/Super-Admin/Sales; 6 expense categories; demo supplier + one issued tax invoice.
- **Admin-web:** Nav "Finance" group; pages `/finance` (KPI tiles + revenue/expense bar chart + receivables aging), `/quotations` (+`/[id]` + `/[id]/print`), `/invoices` (+`/[id]` + `/[id]/print`), `/purchase-orders` (+`/[id]` + `/[id]/print`), `/expenses`; Settings "Company & Tax details" section; customer portal "My Invoices" card. Print views use `@media print` + `window.print()`.
- **`lib/finance.ts`:** status-label/pill maps, `formatINR`, `formatDate`, and `numberToIndianWords` (lakh/crore grouping) for the "total in words" line.

**Verified locally (API smoke test + `tsc`/Next build):**
- Full flow: create supplier → quotation (draft→sent→accepted) → convert to order → create proforma/tax invoice → issue → part-payment (partially_paid) → rest (paid) → overpay rejected (400) → PO → bill → payment made → expense → all three reports sane.
- Tax split correct: intra-state customer → CGST/SGST; inter-state → IGST.
- Permission matrix: Sales reaches `/quotations` but 403s on `/invoices`; erection 403s on all finance; customer only sees own issued invoices via `/portal/invoices`.
- Both `apps/api` and `apps/admin-web` build clean; every new route 403s without its permission.

**Local database (dev only):** implemented against a **local PostgreSQL 16** instance (`recd_tracker` DB, `postgres`/`postgres` on `:5432`) — created because no Zan-APP Supabase/Vercel project exists yet (see §20). `apps/api/.env` points at it. Before any deploy, repoint `DATABASE_URL`/`DIRECT_URL` at a Zan-APP-owned Postgres and `prisma migrate deploy` + seed. The seeded Finance role now lands on the Finance Dashboard instead of "No modules enabled yet".

**Deferred (Phase 2, not built):** double-entry ledger, credit notes/debit notes, e-invoicing (IRN/e-way), payment allocation across invoices, bank reconciliation, per-site job costing.

---

## 22. Finance module — live UI verification + one real bug found and fixed (2026-07-19)

Picked back up from §21. On re-checking, **all of `FINANCE_MODULE_PLAN.md` §10 steps 1–9 were actually already code-complete** (schema, services, routes, shared package, all 5 new admin-web sections including `/[id]/print` views, and the customer-portal "My Invoices" card) — this session's job was to *verify it lived up to the plan's Definition of Done through the real UI*, not to keep building.

**Bug found:** logging in as the seeded Finance user (`finance@platino.example`) hit exactly the failure mode the plan's Definition of Done calls out — **"No modules enabled yet"** instead of the Finance Dashboard. Root-caused with a debug pass (DB permission grants → JWT payload → live `/auth/me` response → `AuthGuard`'s `firstLanding` logic): the database, seed, permissions, and `AuthGuard.tsx`/`Nav.tsx` route-gating were all correct. The actual break was that `apps/admin-web` had **no `.env.local`**, so `NEXT_PUBLIC_API_URL` fell back to its hardcoded default (`http://localhost:4000`, a different project's port) instead of the API's real port `4001`. Every `/auth/me`/data call silently failed client-side ("Failed to fetch"), which the UI has no way to distinguish from "this role really has zero permissions."

**Fix:** added `apps/admin-web/.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:4001` (gitignored, dev-only — matches the documented port convention in §1 of the plan). This was previously working by accident because whatever process had originally started the dev server carried that variable in its shell environment; a fresh server start (which is what any new dev/session does) lost it.

**Verified after the fix, all via live browser + direct API calls (not just build/tsc):**
- Finance login → real Finance Dashboard (KPI tiles, revenue/expense chart, receivables aging table with live numbers) instead of the no-access screen.
- `/quotations`, `/invoices`, `/purchase-orders`, `/expenses` all render seeded/smoke-test data correctly.
- An issued tax invoice's `/print` view renders correctly: sequential number, CGST/SGST split, HSN codes, and `numberToIndianWords` total line.
- Permission matrix via direct API calls with role tokens: Sales → `/quotations` 200, `/invoices` 403; Erection → `/quotations` 403, `/finance/summary` 403 — matches plan exactly.
- Mobile check (375px, the plan's step-9 requirement): `/finance`, `/quotations`, `/invoices`, `/purchase-orders`, `/expenses` all have zero horizontal overflow.
- **Not re-verified live this session:** the customer-portal "My Invoices" card. The seeded demo customer (`customer@sundaram.example`) doesn't have a usable password in this environment (customer auth here is a separate, pre-existing order-number/OTP-style flow, not email+password) — couldn't get a customer session in the browser to click through. The code (`apps/api/src/routes/portal.ts`, `customer/portal/page.tsx`) reads correctly and the `/portal/invoices` route logic is scoped by `customerId` exactly like the existing complaints portal fix, but this is a code-review confirmation, not a click-through one.

**Also cleaned up:** stray `.smoke_token.txt` (leftover JWT from the earlier API smoke test) and ad-hoc debug scripts (`apps/api/check-finance-perms.js`, `check-user.js`, `get-token.js`) used only to diagnose this bug — none of these were meant to be committed.

**Net result:** the module now genuinely meets `FINANCE_MODULE_PLAN.md`'s Definition of Done (§10) end-to-end through the UI, not just through builds/smoke tests. The one real gap was an environment-config file, not missing feature work.

---

## 23. Work Orders module added (2026-07-19)

New feature, separate from finance: **internal task dispatch to field crews**, distinct from `Site.currentStage` (overall SITC progress tracking) and from `PurchaseOrder` (procurement from external suppliers). A work order authorizes/instructs an erection, commissioning, or service engineer to do a specific job at a site (install, repair, AMC service visit, inspection) and tracks it from assignment through completion sign-off. Not a money document, no GST/sequential-numbering requirement.

**Schema:** new `WorkOrder` model (`apps/api/prisma/schema.prisma`) — `workOrderNumber` (random `WO-YYYY-NNNNN`, same convention as `Complaint.ticketNumber`), `siteId`, `taskType`, `title`, `instructions`, `status` (`draft`/`assigned`/`in_progress`/`completed`/`cancelled`), `assignedToId`, `scheduledDate`/`startedAt`/`completedAt`, `completionNotes`/`completionPhotoUrl` (base64 data-URL, same convention as `SitePhoto`), `createdById`. Back-relations added to `Site` and `User`. Migration `20260719172908_add_work_orders`.

**Permissions:** two new keys, following the complaints "manage vs act-on-your-own" split exactly —
- `manage_work_orders`: create, assign, edit, cancel. Granted to Operations/PM, Management, Owner/Admin, Super Admin.
- `act_assigned_work_orders`: update status + record completion on work orders assigned to you, nothing else. Granted to Erection Engineer, Commissioning Engineer, Service Team.

**Shared (`packages/shared`):** `WORK_ORDER_STATUS`, `WORK_ORDER_TASK_TYPE` (`installation`/`repair`/`amc_service`/`inspection`/`other` — a plain constant, not a DB lookup, matching `PAYMENT_METHOD`'s pattern since it's a small fixed set); `createWorkOrderSchema`, `updateWorkOrderSchema` Zod schemas.

**API (`apps/api/src/routes/workOrders.ts`, mounted at `/work-orders`):** `GET /` (managers see all, field engineers see only their own — same scoping pattern as `complaints.ts`), `GET /assignees`, `POST /`, `GET /:id`, `PATCH /:id`. The PATCH handler enforces field-level authorization server-side: a non-manager can only change `status`/`completionNotes`/`completionPhotoUrl` on a work order assigned to them — attempting to reassign, retitle, or reschedule returns 403 even if they own the work order. Verified directly: `curl` as the erection engineer trying to null out `assignedToId` on their own WO → `403 "You can only update status and completion details"`. Also added `GET /meta/work-order-task-types` lookup.

**Admin-web:** new "Operations" nav group (between Main and Finance) with a single "Work Orders" link, gated by either permission. `/work-orders` page follows the `complaints/page.tsx` template exactly — desktop table + mobile card stack, a manager-only "New work order" create modal (site picker sourced from `GET /sites`, task-type/assignee dropdowns from the new lookups), and a shared "Manage"/"Update" modal whose fields adapt to the caller's permission (assignee dropdown only shown to managers; completion-notes + photo-upload fields only appear once status is set to `completed`).

**Seed:** both permission rows, role grants above, and one demo work order (`WO-2026-00001`, assigned to the erection engineer, status `assigned`) on the existing demo site.

**Verified live, not just build-clean:**
- Ops PM creates a work order via the UI (site picker → AMC task type → assignee) → appears immediately in the list with the right status pill.
- Erection engineer sees only their own assigned WO (nav copy adapts to "Tasks assigned to you"), moves it to `completed` with notes — status updates correctly, no assignee dropdown shown to them.
- `curl` permission matrix: Sales 403s on `GET /work-orders`; erection engineer 403s attempting to reassign their own WO.
- 375px mobile check on `/work-orders`: zero horizontal overflow.
- `next build` includes `/work-orders` in the clean production build; both `apps/api` and `apps/admin-web` `tsc --noEmit` clean.

**Deferred / not built:** no site-detail integration yet (work orders aren't shown inline on the `/sites/[id]` page — they're only visible from the dedicated `/work-orders` list, filtered by site if you know which one). No dashboard tile/count. No notification-template wiring beyond the generic `send()` calls (`work_order_assigned`, `work_order_completed` — these log via the existing in-app/email stub providers same as every other notification, no new provider work needed). The user flagged that the work-order **workflow itself may still change** based on how they actually want to use it day-to-day — this is a first pass, not a finished spec.

---

## 24. Invoices was missing its "New invoice" button + a pre-existing customer-picker bug (2026-07-19)

User reported "the page is not loading" for `/work-orders` right after §23 — root cause was mine: I'd run `npm run build` (production) in `apps/admin-web` for a final verification pass and then `rm -rf .next`, which deleted the build cache out from under the *live* `next dev` process, corrupting its route table (every route 404'd, not just work-orders). Killed the stale dev process and restarted clean; confirmed all routes 200 again. **Lesson for future sessions in this repo: never run `npm run build` (or delete `.next`) in the same app directory as a running `next dev` — always stop the dev server first, or use a separate checkout/port.**

Second, separate report: no "New invoice" creation button on `/invoices`. True gap — `invoices/page.tsx` only ever had a read-only list; `quotations/page.tsx` and `purchase-orders/page.tsx` both have inline create modals but invoices never got one, despite the API (`POST /invoices`) fully supporting standalone creation (docType, customer, line items - it was only ever reachable via "Create invoice" from an existing quotation). Added a "+ New invoice" button and modal to `invoices/page.tsx`, following the exact `quotations/page.tsx` pattern: doc-type picker (proforma/tax invoice), customer + place-of-supply, issue/due dates, a line-item editor, submitting to `POST /invoices`.

While wiring the customer dropdown, hit a **second, pre-existing bug**: `GET /customers` was gated on `manage_orders` only, which the Finance role doesn't have — so the customer picker would have rendered empty for any Finance user. This was already silently broken on the Quotations page too; there's even a code comment there ("Customers require manage_orders; finance may not have it, so fall back to a customer list endpoint if available") flagging it as a known gap that was never actually fixed, just caught by a `.catch(() => {})`. Fixed at the source: `apps/api/src/routes/customers.ts` `GET /` now accepts `manage_orders` OR `manage_quotations` OR `manage_invoices` (read-only; `POST /` to create a customer stays `manage_orders`-only, that's still a sales action). This fixes the customer picker on **both** Invoices and Quotations for Finance users.

**Verified live as the Finance user:** clicked "+ New invoice", customer dropdown populated (previously empty), created a proforma invoice (₹25,000 + 18% GST = ₹29,500) — appeared correctly in the list as a new draft with the right balance. Re-checked Quotations' customer dropdown too, same fix applies there. `tsc --noEmit` clean on both apps, `next build` clean including the now-larger `/invoices` bundle (5.02 kB vs the previous 3.65 kB).

---

## 25. Root cause of the recurring "internal server error" / "page not loading" flakiness — port collision with the Platino repo (2026-07-20)

**This is the real explanation for several bugs "fixed" in §22 and §24 that kept coming back.** All of this session's local dev work has been happening inside a Claude Code session whose primary working directory is `D:\Projects\Claude code` — which is not neutral scratch space, it **is the original Platino RECD tracker repo** (see the fork notice at the top of this file). That repo has its own `apps/api` (port 4001, pointed at a real Supabase Postgres) and `apps/admin-web` (port 6001) - **the exact same port numbers** this project's `.claude/launch.json` used for Zan-APP, because Zan-APP was forked from Platino and inherited its `launch.json` port choices verbatim.

`.claude/launch.json`'s `"api"` / `"admin-web"` entries have no explicit working directory (no `--prefix`), so they run relative to whatever directory the harness treats as default - which is `D:\Projects\Claude code`, i.e. **Platino's** own `apps/api`/`apps/admin-web`, not Zan-APP's. Every time a previous manually-started Zan-APP dev server was still alive, `preview_start` would "reuse" that port and everything looked fine. But whenever nothing was listening on 4001/6001 and `preview_start` had to launch fresh, it silently started **Platino's** servers instead:
- Platino's `admin-web` has none of Zan-APP's finance/work-order pages → every one of those routes genuinely 404s. This was misdiagnosed in §22/§23 as a harness route-scanning quirk; it was never that - it was hitting the wrong app entirely.
- Platino's `api` points at a remote Supabase project whose password has since been rotated/is invalid (see Platino's own §21 handover history for that incident) → every login there fails with `PrismaClientInitializationError: Authentication failed against database server`, surfaced to the browser as a generic "Internal server error".

**Permanent fix:** gave Zan-APP its own ports so this collision is structurally impossible going forward, instead of relying on remembering to `cd` into the right directory:
- `apps/api/.env`: `PORT` changed `4001` → **`4011`**, `ADMIN_WEB_URL` → `http://localhost:6011`.
- `apps/admin-web/.env.local`: `NEXT_PUBLIC_API_URL` → `http://localhost:4011`.
- `apps/admin-web/package.json`: `dev` script → `next dev -p 6011`.
- `D:\Projects\Claude code\.claude\launch.json` (shared launch config file, not Zan-APP's own): added two new **explicitly-pathed** entries, `zan-api` (`--prefix D:\Projects\Zan-APP\apps\api`, port 4011) and `zan-admin-web` (`--prefix D:\Projects\Zan-APP\apps\admin-web`, port 6011). The old `"api"`/`"admin-web"` entries were left untouched - those are legitimately Platino's own launch configs for when someone is working in that repo.

**Going forward, always use `preview_start(name: "zan-api")` / `preview_start(name: "zan-admin-web")` for this project - never the bare `"api"`/`"admin-web"` names, those belong to Platino.** Local dev URLs are now **http://localhost:4011** (API) and **http://localhost:6011** (web) - every other reference to `:4001`/`:6001` in this handover file (§1 house rules, §20-24) predates this fix and is now stale for local dev; the port numbers there describe history, not current reality.

**Verified:** killed the stray Platino processes that had been accidentally answering on 4001/6001, started `zan-api`/`zan-admin-web` fresh via `preview_start`, confirmed `GET /health` and a real login both succeed on :4011, and did a full click-through login as the Finance user on :6011 landing on the real Finance Dashboard with live data - through the actual harness preview flow this time, not a manually-launched workaround process.

---

## 26. "Document not found" reopening a freshly-created quotation/invoice/PO (2026-07-20)

**Symptom:** create a quotation/invoice/PO, click it in the list right after → "Quotation/Invoice/PO not found", even though the record exists and a hard page reload of the same URL works fine.

**Root cause:** `quotations/[id]/page.tsx`, `invoices/[id]/page.tsx`, and `purchase-orders/[id]/page.tsx` (plus their `/print` siblings) all read the id by hand-parsing `window.location.pathname.split("/").pop()` instead of using Next's `useParams()` hook - a pattern that `sites/[id]/page.tsx` already gets right elsewhere in this codebase. During a **client-side** `<Link>` navigation (as opposed to a hard reload), this component briefly renders while `window.location.pathname` still reflects the *previous* route. Confirmed via network trace: clicking into a quotation fired `GET /quotations/quotations` (404 "Quotation not found" - "quotations" being the last path segment of the *list* page's own URL) immediately followed by the correct `GET /quotations/<real-id>` (200). The stale request's `.catch()` set `error` state; the correct request's `.then()` set the data state right after - but the render logic was `if (error) return <p>{error}</p>;` checked *before* the data check, so the leftover error from the bogus request won permanently, masking the fact that the real data had actually loaded fine.

**Fix:** swapped `window.location.pathname` parsing for `useParams<{ id: string }>()` in all six files (3 detail pages + 3 print pages, across quotations/invoices/purchase-orders) - this reads the route param directly from Next's router state, which is never stale mid-transition. Also added `setError(null)` at the top of each detail page's `load()` so a leftover error from a previous failed load can't outlive a subsequent successful one even in edge cases `useParams` doesn't cover.

**Verified live:** created a fresh quotation via the API, clicked into it from the list via a real `<Link>` click (not a reload) - opens correctly first try. Same for an existing invoice and PO. Checked the network trace after the fix: only the correct id is ever requested, no more phantom `/quotations/quotations`-style calls. Print views (reached via `router.push`, same underlying bug) also confirmed working. `next build` clean, all routes present.

## 27. Company-wide PO terms + authorised signatory (name + picture) on all three print documents (2026-07-20)

**Ask:** give Super Admin a way to set Terms & Conditions and an authorised-signatory picture once in Settings, and have every document print preview (Quotation, Invoice, Purchase Order) pick it up automatically.

**Gap found:** `CompanySettings` already had `invoiceTerms`/`quotationTerms` (rendered on those two print pages) but no company-wide PO terms field - the PO print page only ever showed the per-document `PurchaseOrder.terms`, with no fallback. There was also no signatory field anywhere; all three print pages hardcoded the static text "Authorised signatory" with an empty line above it for a physical wet signature.

**Schema (migration `20260720155617_add_signatory_and_po_terms`):** added to `CompanySettings` - `purchaseOrderTerms String?`, `signatoryName String?`, `signatoryDataUrl String?` (base64 data URL, same storage pattern as the existing company `logoDataUrl`, no S3/file storage involved).

**Settings page (`apps/admin-web/src/app/settings/page.tsx`):** added a "Purchase order terms" textarea next to the existing Invoice/Quotation terms fields, plus a new "Authorised signatory" block (drag-and-drop or click-to-upload picture, same upload-zone component/pattern as the company logo uploader, JPG/PNG up to 2MB) and a signatory name text input. Both save through the existing `PUT /settings` (manage_settings-gated) call alongside the rest of company/tax details.

**Print pages** (`invoices/[id]/print`, `quotations/[id]/print`, `purchase-orders/[id]/print`): replaced the static "Authorised signatory" line with the uploaded signature image (when set) rendered above the text, and appended the signatory name (`Authorised signatory — {name}`) when set. PO print page also now falls back to `company.purchaseOrderTerms` when the per-document `po.terms` is empty, bringing it in line with how Invoice/Quotation terms already work.

**Verified live:** logged in as Super Admin (`superadmin@platino.example`), filled in Purchase order terms + signatory name via Settings, confirmed both persisted in `CompanySettings` via a direct DB read. Set a test signature image directly in the DB (file-upload can't be scripted through the automation harness) and confirmed the PO print page (`PO/2026-27/0001`) rendered the signature image, "Authorised signatory — R. Kumar, Director", and the company-wide PO terms text correctly. `tsc --noEmit` clean on both `apps/api` and `apps/admin-web`.

**Note:** the test signatory name/terms/image entered during verification were left in the local dev DB (`CompanySettings` singleton) as a working example - replace with the real signatory before this goes near production.

## 28. First real Vercel deployment - new Supabase project + two Vercel projects, matching localhost (2026-07-20/21)

**Ask:** get Zan-APP live on Vercel, working exactly like the local dev setup (`localhost:6011`/`localhost:4011`).

**Starting point was messier than expected.** Zan-APP had never been deployed from this working directory - its only database was local Postgres (`localhost:5432`). Separately, pushing this session's commit to GitHub silently triggered Vercel's GitHub App to auto-create two projects for this repo (`zanf-recd-erection-api`, `admin-web`) - neither had a successful deployment. `admin-web` turned out to be a real, correctly-configured project from *earlier* work (10 days old, proper monorepo build settings) that only looked "new" because its most recent build (today's push) updated its timestamp - **`zanf-recd-erection-api` was mistakenly deleted** before this was noticed, on the wrong assumption it was disposable auto-import junk. It had to be rebuilt from scratch as `zan-app-api` (new project, same role). Lesson for next time: check a Vercel project's `Created At`, not just "Updated", before deleting anything that's git-connected.

**New production database:** Supabase project `zan-app` (ref `idqzupopsuusoihpmoqc`, `ap-south-1`/Mumbai, same pooler pattern as Platino's `platino-recd-mumbai`) - separate from every other project's DB. All 6 Prisma migrations applied and the seed script run against it directly (`DATABASE_URL=... npx prisma migrate deploy` / `npx tsx prisma/seed.ts`), so it starts with the same seeded roles/users/demo data as local dev.

**Vercel project layout** (team `ferose-salahudeen-s-projects`):
- `zan-app-api` - Express API, Root Directory `apps/api`, **not** git-connected (deployed via local `vercel build` + `vercel deploy --prebuilt` instead - see gotchas below). Live at `https://zan-app-api.vercel.app`.
- `admin-web` - Next.js admin console, Root Directory `.` (repo root, workspace-aware build command `npm run build --workspace=apps/admin-web`), git-connected. Live at `https://admin-web-three-blush.vercel.app`.

**Production env vars set on `zan-app-api`:** `DATABASE_URL`/`DIRECT_URL` (zan-app Supabase pooler, transaction/session mode exactly like Platino's pattern), a freshly generated `JWT_SECRET` (not the placeholder from `.env`), `JWT_EXPIRES_IN=7d`, `EMAIL_FROM_ADDRESS`. On `admin-web`: `NEXT_PUBLIC_API_URL=https://zan-app-api.vercel.app`.

**Two real bugs hit and fixed getting the API live, both worth knowing for any future redeploy:**
1. **Monorepo workspace resolution breaks Vercel CLI deploys from a subdirectory.** Running `vercel --prod` from inside `apps/api` only uploads that folder - `packages/shared` (an `npm workspaces` dependency, `@recd/shared: "*"`) isn't included, so remote `npm install` 404s trying to fetch it from the public registry. The `--repo`-flag monorepo linker (`vercel link --repo`) is alpha and its interactive multi-project picker doesn't work over non-TTY/piped input, so it couldn't be used to reconfigure this cleanly. Fix: build **locally** instead (`vercel pull --yes --environment production` then `vercel build --prod`, run from `apps/api`) - locally, npm workspaces already resolves `@recd/shared` correctly via a symlink at `node_modules/@recd/shared`, so the local build succeeds. Then deploy the prebuilt output (`vercel deploy --prebuilt --prod`), which uploads build artifacts instead of re-running install remotely.
2. **Windows symlinks don't survive Vercel's function-file tracing.** Even with a local build, `vercel deploy --prebuilt` failed twice with `File does not exist: node_modules\@recd\shared` - once against the `.vercel/output` function bundles, once against `apps/api`'s own `node_modules` (the CLI does a local existence check there too, but npm workspaces never puts a copy there - only at the repo root). Since `@recd/shared` is a Windows reparse-point symlink, Vercel's tracer silently drops it rather than following it into the upload. Fix (repeatable after any rebuild, since `npm install` recreates the symlink every time): copy the *real* `packages/shared` contents (not a symlink) into `apps/api/node_modules/@recd/shared` **and** into `.vercel/output/functions/{api,index}.func/node_modules/@recd/shared` before running `vercel deploy --prebuilt`.
3. **Prisma Client only ships the query engine for the OS it was generated on.** Building locally on Windows meant the deployed Client had a Windows engine binary; Vercel's Linux runtime failed every DB-touching route with `PrismaClientInitializationError: could not locate the Query Engine for runtime "rhel-openssl-3.0.x"` (routes that don't touch the DB, like `/health`, worked fine, which is what made this look like a partial success at first). Fixed permanently in source: `apps/api/prisma/schema.prisma`'s `generator client` block now sets `binaryTargets = ["native", "rhel-openssl-3.0.x"]`, so `prisma generate` downloads and ships both engines regardless of build machine. Committed (`c8e0edb`).

**After both fixes, verified live end-to-end in a real browser:** logged into `https://admin-web-three-blush.vercel.app` as `superadmin@platino.example` (same seed password, `changeme123`), dashboard rendered real counts from the new Supabase DB (1 site in Supply - matches the seed), Settings page showed the section-27 Purchase order terms + Authorised signatory fields correctly. `curl` confirmed `/health` and `/auth/login` both return correctly from `https://zan-app-api.vercel.app`.

**Not git-connected, by design (for now):** `zan-app-api` deploys only via manual `vercel build` + `vercel deploy --prebuilt` from a local machine, *not* automatically on every `git push` - connecting it to git would hit gotcha #1 again (remote builds from a subdirectory don't get full monorepo context) without a proper Root-Directory-aware git integration, which needs to be set up through the Vercel dashboard (no CLI/API path found for this in the current environment). `admin-web` *is* git-connected and will auto-redeploy on push - so the two apps' deployment stories are asymmetric for now. To ship an API change: repeat the local-build-then-prebuilt-deploy dance above; to ship an admin-web change: just push to `master`.

**Cleanup left for later:** `zan-app-api`'s local build artifacts (`apps/api/.vercel/`, `apps/api/node_modules/@recd/shared` real copy) are gitignored and machine-local - a fresh clone needs the same `vercel pull` + build + patch sequence, not just `git pull`. The deleted `zanf-recd-erection-api` project's history/deployment logs are gone for good (Vercel has no project-level undelete).

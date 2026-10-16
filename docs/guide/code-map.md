# Code map: where is everything

This page is the map of the BuPulse code. It lists every top-level folder and what is in it, every folder of `lib/`
(where the real work happens) in one line each, the habits the code follows everywhere (so you know where to look
before you look), how one click travels through the code, and the simple rule that turns a web address (URL) into the
file that draws it, with worked examples. The owner can use the first table and the URL rule to point a developer at
the right file; developers can use the rest as a starting point.

**On this page**
- [Top-level folders](#top-level-folders)
- [app/: pages and API routes](#app-pages-and-api-routes)
- [app/api/: one line per folder](#appapi-one-line-per-folder)
- [lib/: every folder](#lib-every-folder)
- [lib/: the files at the top](#lib-the-files-at-the-top)
- [components/](#components)
- [Conventions](#conventions)
- [How a request flows](#how-a-request-flows)
- [How to find the code for a page](#how-to-find-the-code-for-a-page)

## Top-level folders

| Folder or file | What it is |
|---|---|
| `app/` | Every page and API route (Next.js 16 App Router). One folder per part of the URL. |
| `components/` | The pieces pages are built from (buttons, forms, cards), grouped by area. |
| `lib/` | The logic: database reads and writes, AI calls, payments, publishing, rules. Pages call into it. |
| `prisma/` | `schema.prisma` (every database table) and `migrations/` (about 100 SQL files, applied in name order). |
| `supabase/` | `templates/`: the three Supabase Auth email designs (confirm sign-up, reset password, email change). No local Supabase setup. |
| `scripts/` | Command-line tools (table below). |
| `tests/` | Unit tests (Vitest), one folder per area, plus `journeys/` (whole client paths such as sign-up to trial), `stubs/`, `ai-eval/` (AI quality checks). |
| `e2e/` | Browser tests (Playwright): `smoke`, `signup`, `pricing`, `pages`, `home`, `app`, `studio`. |
| `Demo/` | The narrated demo videos for sales and social media: `studio/` (Remotion source), `capture/` (screen captures), `STORYBOARD.md`. The MP4 folders are not in git. Not part of the app. |
| `netlify/` | `functions/cron-*.mts`: the scheduled jobs on Netlify, and `cron-runner-background.mts` that runs them; `lib/cron.ts`. |
| `public/` | Files served as they are: `widget.js` and `widget-chat.js` (website chat), `t.js` (page-view tracker), `sw.js` (push alerts), `manifest.webmanifest`, `brand/`, `fonts/`. |
| `docs/` | Design notes per area (`BILLING.md`, `WIDGET.md`, …), `handovers/`, `design/`, and this guide in `docs/guide/`. |
| `proxy.ts` | Runs before every page (Next.js 16's name for middleware): refreshes the sign-in session, sends signed-out visitors from private pages to `/login`, keeps a sales agent's `?ref=` code. |
| `worker.ts` | The Cloudflare Worker entry: wraps the OpenNext worker and adds the `scheduled` handler for the cron triggers. |
| `worker-crons.ts` | The Cloudflare cron schedules and the route each one calls (`CRON_ROUTES`, `routeForCron`). |
| `wrangler.jsonc`, `open-next.config.ts`, `cloudflare-env.d.ts` | Cloudflare settings (Hyperdrive, cron triggers, CPU limit), OpenNext settings, generated binding types. |
| `netlify.toml` | Netlify build command, Node 24, the pinned Next.js runtime plugin, functions folder. |
| `next.config.ts` | Next.js settings: security headers, version baked in at build, packages kept external for the Worker size. |
| `prisma7.config.ts` | Prisma CLI settings (schema, migrations folder, `DIRECT_URL`). Pass `--config prisma7.config.ts`. |
| `vitest.config.ts`, `playwright.config.ts`, `eslint.config.mjs`, `tsconfig.json` | Test, lint and TypeScript settings. |
| `.env.example` | Every environment variable, empty, grouped and commented. Copy to `.env`. |
| `.github/workflows/` | Deploys, CI, fallback cron callers, the video robot (see [Put it online](install/02-put-it-online.md#the-github-workflows)). |
| `AGENTS.md`, `CLAUDE.md` | Notes for AI coding assistants (this Next.js version differs from older ones; read `node_modules/next/dist/docs/`). |

### scripts/

| Script | What it does |
|---|---|
| `check-env.mjs` | Checks environment variables before a deploy (names and problems only) |
| `cf-build.mjs` | The Cloudflare Workers build (Prisma's query compiler as a `.wasm` module) |
| `netlify-rollback.mjs` | Restores the previous Netlify production deploy |
| `paddle-setup.mjs`, `paddle-sync.mjs` | Create Paddle products, prices and the webhook from the command line (`npm run paddle:setup`) |
| `release-zip.mjs`, `release-core.mjs`, `verify-release.mjs`, `release-public-key.mjs` | Signed update zips (see [Install an update zip](install/03-install-an-update-zip.md)) |
| `video-robot/` | The video robot GitHub Action's program (`robot.mjs`, `build-page.mjs`, `page-entry.ts`, `log.mjs`, `self-test.mjs`) |
| `music/seed-lib.mjs` | Logic for loading the music library (the runner is in the git-ignored `scripts/local/`) |
| `docs/capture-guide.mjs` | Takes the screenshots and clips for this guide (read-only, test database) |
| `local/` | Git-ignored: test-only helpers on the owner's Mac (test accounts, test staff, sounds, music runner). Not in a fresh clone. |

## app/: pages and API routes

Folders in **parentheses** are *route groups*: they organise files but are **not** part of the URL.

| Folder | URL | What |
|---|---|---|
| `app/(marketing)/` | `/`, `/pricing`, `/about`, `/blog`, `/contact`, `/industries`, `/done-for-you`, `/privacy`, `/terms`, `/refund-policy`, `/data-deletion` | The public website, with its own `layout.tsx` (header, footer) |
| `app/signup`, `app/login`, `app/forgot-password`, `app/reset-password`, `app/auth/{confirm,callback,signout}` | same | Creating an account and signing in |
| `app/welcome`, `app/onboarding`, `app/book-demo`, `app/custom-plan` | same | First steps of a new company |
| `app/account/{deletion,waiting}`, `app/suspended`, `app/invite/[token]`, `app/posted` | same | Account states, team invitations, "I posted it" from reminder emails |
| `app/dashboard/` | `/dashboard/...` | The client's app: `analytics`, `autopilot`, `billing`, `brand`, `calendar`, `connections` (Channels), `connectors`, `content`, `demo`, `designs`, `domains`, `gallery`, `knowledge`, `leads`, `projects`, `settings` (and `settings/team`), `stores`, `upgrade`, `usage`, `visuals`, `widget` |
| `app/admin/(auth)/` | `/admin/login`, `/admin/verify`, `/admin/setup-2fa` | Admin sign-in: emailed code, authenticator |
| `app/admin/(console)/` | `/admin`, `/admin/inbox`, `/admin/search` | The admin console. Its `layout.tsx` is the sidebar; `page.tsx` is the Overview. |
| `app/screen/[token]` | `/screen/<secret>` | The sales room TV |
| `app/widget/[key]` | `/widget/<key>` | The website chat's page inside the iframe (a route handler) |
| `app/api/` | `/api/...` | API routes (next table) |
| `app/layout.tsx`, `globals.css`, `opengraph-image.tsx`, `robots.ts`, `sitemap.ts` | | The root layout, styles, share image, robots and sitemap |

The admin console's route groups (the sidebar folders; the map is `components/admin/nav.ts`):

| Group | Pages (URL after `/admin/`) |
|---|---|
| `(sales)` | `sales`, `sales/team`, `sales/leaderboard` |
| `(clients)` | `companies`, `companies/[id]` (Client 360), `users`, `users/[id]`, `client-health`, `usage`, `demos`, `requests`, `connections` |
| `(money)` | `revenue`, `costs`, `payments` (Mobile Money queue, card events), `invoices`, `invoices/[id]`, `invoices/settings`, `offers`, `offers/[id]`, `offers/new`, `plans`, `plans/[key]`, `plans/new`, `addon-prices` |
| `(content)` | `content`, `funnels`, `designs`, `music`, `industries`, `industries/[id]`, `industries/new`, `announcements` |
| `(ai)` | `ai` (AI calls and spend, budget), `approvals`, `jarvis` |
| `(system)` | `health`, `services`, `errors`, `activity`, `audit`, `flags`, `settings`, `settings/regions`, `settings/updates` |
| `(organisation)` | `organisation` (Staff), `organisation/roles`, `organisation/screen` (Sales screen) |
| (none) | `inbox`, `search` (Cmd+K) |

## app/api/: one line per folder

| Folder | Purpose |
|---|---|
| `admin/` | `v1/` the admin REST API for Jarvis (bearer keys, `v1/[...path]`); `google-calendar/{connect,callback}` the owner's calendar OAuth |
| `billing/` | `webhooks/paddle` (Paddle's signed events), `webhooks/[provider]` (future automatic Mobile Money providers; 404 today) |
| `canva/` | "Edit in Canva": `connect`, `callback`, `open`, `return` |
| `collect/` | First-party page-view collector called by `public/t.js` |
| `cron/` | The scheduled jobs, one folder each (bearer `CRON_SECRET`): `publish`, `metrics`, `leads-digest`, `autopilot`, `store-sync`, `analytics-rollup`, `plan-price-changes`, `momo-renewals`, `trial-reminders`, `media-cleanup`, `content-summary`, `purge-accounts`, `social-refresh` |
| `demo/` | `ics/[token]`: the demo booking's calendar file |
| `designs/` | `preview`: template thumbnails with the business's brand |
| `generate/` | Caption, hashtags, video script and ad headlines for a product or campaign |
| `geo/` | `country`: "Use my location" on `/pricing` |
| `invoices/` | `[id]/pdf`: an invoice as PDF |
| `leads/` | `export`: the leads inbox as CSV |
| `mcp/` | The admin MCP server for Jarvis (`docs/JARVIS.md`) |
| `meta/` | Meta's `data-deletion` and `deauthorize` callbacks |
| `places/` | `autocomplete`, `details`: Google Places address search |
| `platform/` | `check`: the 10-minute header check after a deploy (`PLATFORM_CHECK=1` only) |
| `robot/` | `videos/{peek,claim,complete,fail,report}`: the video robot |
| `social/` | `[network]/connect` and `[network]/callback`: social network OAuth |
| `status/` | Health check for uptime monitors (`{"status":"ok"}` and the version) |
| `stores/` | Shopify (`connect`, `callback`, `webhooks`) and WooCommerce (`callback`) |
| `ui/` | Public site-wide UI choices (the loading animation) |
| `v1/` | The clients' public REST API (their own API keys): `posts`, `products`, `leads`, `projects`, `content`, `campaigns` |
| `widget/` | The website chat: `chat`, `lead`, `config` |

## lib/: every folder

| Folder | One line |
|---|---|
| `lib/admin/` | The admin console's server side: sign-in gates (`auth.ts`), audit (`audit.ts`), kill switch (`switch.ts`), service catalog and saved keys, health and cron status, Updates, Jarvis tools (`tools.ts`, `service.ts`, `mcp.ts`), settings, demos, plans and regions services |
| `lib/ai/` | AI providers over plain `fetch` (Gemini, Claude, images, text-to-speech), the cost ledger (`ledger.ts`), budgets (`budget.ts`), prices (`pricing.ts`) |
| `lib/analytics/` | The first-party tracker, events, the daily roll-up, and the numbers behind Analytics |
| `lib/api/` | The clients' public REST API: key checks (`auth.ts`), scopes (`keys.ts`), paging, JSON shapes |
| `lib/auth/` | Who is signed in (`require-user.ts`: `requireActiveUser`), safe return paths, form schemas, which site address to use in links (`site-url.ts`, `request-site.ts`) |
| `lib/autopilot/` | Autopilot: plans next week, writes the posts, picks visuals, learns from results |
| `lib/billing/` | Payments: Paddle (`paddle*.ts`), Mobile Money (`momo*.ts`), applying webhooks (`apply.ts`), pay-method choice, renewals and periods, price changes |
| `lib/brand/` | Brand profile schemas, colours from logos, languages, voices |
| `lib/business-info/` | Opening hours, locations and contacts, and their text for the AI |
| `lib/canva/` | Canva Connect: OAuth with PKCE, tokens, open a design, bring the edit back |
| `lib/cloudflare/` | The client's own Cloudflare account: domains list and the one-click chat install (Zaraz) |
| `lib/connectors/` | The catalog of import apps on `/dashboard/connectors`; one file per app in `entries/` |
| `lib/content/` | The public website's text and blog posts (kept in code for now) |
| `lib/content-board/` | The Content board: drafts, review, auto-approval rules, scheduling, the daily summary |
| `lib/content-flow/` | "Create today's content": one run makes a post per network for a product, campaign or General |
| `lib/demo/` | Demo bookings, free slots, `.ics` files, calendar links, trial reminders and expiry |
| `lib/designs/` | Designs: templates, the design library, layout, rendering, AI photo scenes |
| `lib/generated/` | Generated Prisma client (`prisma generate`; git-ignored, never edit) |
| `lib/geo/` | "Use my location": the built-in offline country map or Google |
| `lib/google-calendar/` | The owner's Google Calendar: OAuth, free/busy, demo events |
| `lib/industries/` | Industry rows (Admin → Industries) for forms and the AI |
| `lib/invoices/` | Invoices: create, send, PDF, storage, emails |
| `lib/knowledge/` | Knowledge base: profile, products, campaigns, customers, competitors, FAQs and policies, reviews, the brand interview |
| `lib/leads/` | Leads from the chat: save, email, digest, webhook, push and WhatsApp alerts (`notify.ts`) |
| `lib/media/` | The Gallery: uploads, albums, imports from Drive/Dropbox/Canva, video checks, storage sweep |
| `lib/money/` | The admin money report: revenue, MRR, costs, profit, currency display |
| `lib/music/` | The music library (public `music` bucket) |
| `lib/offers/` | Custom plan offers and added features, by Mobile Money or card |
| `lib/places/` | Google Places address search (shared checks of `/api/places/*`) |
| `lib/platform/` | The host layer: Netlify vs Cloudflare vs Node (database, background work, cache, headers, time budgets) |
| `lib/publishing/` | Scheduling and publishing posts (`engine.ts`), Instagram JPEG conversion (`jpeg.ts`), metrics, emails (`email.ts`: `sendEmail`) |
| `lib/push/` | Phone and browser lead alerts (Web Push with VAPID) |
| `lib/sales/` | Sales agents: referral codes, client assignment, the leaderboard |
| `lib/screen/` | The sales room TV: data, links, sounds |
| `lib/social/` | Social networks: OAuth, connections, one provider per network in `providers/` |
| `lib/staff/` | Admin staff: roles and permissions (`permissions.ts`), heartbeat |
| `lib/stores/` | Shopify and WooCommerce: connect, import and re-sync products, webhooks |
| `lib/studio/` | Content packs ("Write content" for a product or campaign), angles, headlines, per-network variants |
| `lib/supabase/` | Supabase clients: browser (`client.ts`), server with the user's session (`server.ts`), server with the secret key (`admin.ts`) |
| `lib/team/` | The client's team: seats, invitations, roles (`roles.ts`), ownership transfer |
| `lib/time/` | Kigali days and months (`kigali.ts`) for money and the admin |
| `lib/ui/` | The page-loading animation setting |
| `lib/updates/` | Signed update zips (`releases.ts`) |
| `lib/visuals/` | Pictures, carousels and videos for posts: art direction, scripts, timeline, the video robot, clean-up |
| `lib/voice/` | Voiceovers (ElevenLabs): make, mix, voices |
| `lib/webhooks/` | Outgoing webhooks to the client's own systems: events, delivery, retries |
| `lib/widget/` | The website chat: config, AI reply, prompt, origin rules, limits, Turnstile, install guides |

## lib/: the files at the top

| File | What |
|---|---|
| `db.ts` | The Prisma client (`prisma`) for the current host |
| `crypto.ts` | `encrypt` / `decrypt` (AES-256-GCM with `ENCRYPTION_KEY`) for stored tokens and keys |
| `errors.ts` | `logError` (writes `ErrorLog`, never throws) and `redact` |
| `features.ts` | The feature registry: `FEATURES`, `FEATURE_KEYS`, `featureForRoute`, prerequisites |
| `plans.ts` | Plan types and limits (`PlanLimits`, `UsageMetric`, `TRIAL_PLAN_KEY`, `TRIAL_DAYS`) |
| `plan-catalog.ts` | Plans from the `PlanDefinition` table (`getPlans`, `getPlan`, `getTrialPlan`), cached |
| `entitlements.ts` | What a company may use now: `companyEntitlements`, `hasFeature`, `requireFeature`, `accountBlock` |
| `usage.ts` | Metered use: `consumeUsage` before an AI call, `refundUsage` if it fails |
| `region.ts`, `region-prices.ts`, `region-format.ts`, `region-check.ts` | Which region and currency a visitor or company is in, and its prices |
| `feature-setup.ts` | Which features can be sold now (the services they need are set up) |
| `rate-limit.ts`, `request-limits.ts` | Rate limits for signed-in actions and for public entry points |
| `storage.ts` | Storage paths (always start with the owner's user id) |
| `account.ts`, `account-deletion.ts` | Sign-up details, deleting and purging an account |
| `version.ts` | The running version and commit |
| others | `cn.ts` (class names), `color-contrast.ts`, `contact.ts` (contact form), `geo-availability.ts`, `geo-cookie.ts`, `home-checklist.ts`, `industry-context.ts`, `phone.ts` |

## components/

One folder per area, matching `app/` and `lib/`: `admin/` (console pieces, `nav.ts` = the admin sidebar),
`app/` (dashboard shell, `nav.ts` = the client sidebar, `context.ts` = `getAppContext`, `demo-lock.tsx`,
`no-access.tsx` with `pageGate` and `featureGate`), `auth/`, `billing/`, `brand/`, `brand-profile/`, `connections/`,
`connectors/`, `content-board/`, `content-flow/`, `designs/`, `domains/`, `invoices/`, `knowledge/`, `leads/`,
`marketing/`, `media/`, `offers/`, `onboarding/`, `publishing/`, `screen/`, `settings/`, `stores/`, `studio/`, `team/`,
`visuals/`, `widget/`, and the shared `ui/` (buttons, inputs, dialogs), `theme/`, `motion/`, `analytics/`,
`autopilot/`, `business-info/`, `demo/`, `page-loader.tsx`.

## Conventions

| Habit | Where | What it means for you |
|---|---|---|
| Server actions live in `actions.ts` next to `page.tsx` | e.g. `app/dashboard/settings/team/actions.ts` | Start with `"use server"`. Each one checks the user again (`requireActiveUser(permission, "throw")` from `lib/auth/require-user.ts`), validates input (zod), calls `lib/`, then `revalidatePath`. Some pages split them (`post-actions.ts`, `day-actions.ts`, `check-action.ts`, `canva-actions.ts`). |
| `import "server-only"` | first line of about 200 files in `lib/` | That file can never be bundled into the browser. Tests replace it with `tests/stubs/server-only.ts`. |
| The kill switch | `lib/admin/switch.ts`: `isServiceEnabled`, `assertServiceEnabled`, `disabledServices`, `UNAVAILABLE_MESSAGE` | Every outside service can be switched off in Admin → Services. Check before calling one; clients see "This feature is temporarily unavailable. Please try again later." |
| Every AI call goes through the ledger | `lib/ai/ledger.ts`: `withLedger(context, meta, call, describe)` | It checks the kill switch, the platform budget (`assertWithinBudget`) and the company allowance (`assertCompanyWithinBudget`, `lib/ai/budget.ts`) before calling, and records the cost in `AiCall`. Never call a provider directly. |
| Secrets at rest are encrypted | `lib/crypto.ts`: `encrypt`, `decrypt`, `needsReencryption` | OAuth tokens, saved service keys, Paddle keys, the calendar token. Key: `ENCRYPTION_KEY` (rotation via `ENCRYPTION_KEY_ID`). |
| Unexpected errors go to `ErrorLog` | `lib/errors.ts`: `logError(error, { source, level, userId, businessId })` | Shown in Admin → Errors. Never throws; secrets are redacted. Give each call a clear `source` such as `team.action`. |
| Every admin change is audited | `lib/admin/audit.ts`: `writeAudit(db, ctx, action, target, before, after)` | Pass the transaction client so the change and its audit row are one unit. The `AuditLog` table is append-only. Shown in Admin → Audit log. |
| Admin permissions on every page and action | `requirePermission` (`lib/admin/auth.ts`), `adminAction(permission)` (`lib/admin/console.ts`) | Deny by default; without the permission the answer is a 404. |
| One feature registry | `lib/features.ts` (`FEATURES`, `FeatureDef`, `featureForRoute`) | Each feature's key, what it needs, its prerequisites. Plans pick features from it. |
| Plans are data | `lib/plans.ts` (types), `lib/plan-catalog.ts` (reads the `PlanDefinition` table) | Plans, limits and features are edited in Admin → Plans, not in code. |
| Entitlements decide | `lib/entitlements.ts`: `companyEntitlements`, `requireFeature`, `featureBlocked`, `accountBlock` | Pages use `featureGate` / `pageGate` (`components/app/no-access.tsx`); actions and routes use `requireFeature`. |
| Region and currency | `lib/region.ts`: `displayRegion` (visitor), `companyRegion` (company), `countryFromHeaders` | Prices come from `PlanRegionPrice` per region (`lib/region-prices.ts`). |
| Host differences in one place | `lib/platform/` | Never read Netlify or Cloudflare headers or bindings elsewhere. |
| Times | `lib/time/kigali.ts` | Money and admin days are Kigali days; crons are UTC. |
| Every cron run recorded | `recordCron(job, run)` in `lib/admin/cron-run.ts` | Admin → Health shows the last run of each job (`CronRun`). |

## How a request flows

A client presses **Invite someone** on the Team page:

1. **`proxy.ts`** (`proxy`) runs first: refreshes the Supabase session cookie; a signed-out visitor on `/dashboard`,
   `/welcome`, `/onboarding`, `/book-demo`, `/custom-plan` or `/account` is sent to `/login?next=…`.
2. **Layout:** `app/dashboard/layout.tsx` calls `getAppContext()` (`components/app/context.ts`): the company, role,
   plan, usage. While the company waits for its demo it shows only `DemoLock`.
3. **Page:** `app/dashboard/settings/team/page.tsx` (a server component) checks access and reads data through `lib/`.
4. **Server action:** the form calls `inviteAction` in `app/dashboard/settings/team/actions.ts`, which re-checks the
   role (`requireActiveUser("team", "throw")`), rate-limits (`rateLimit`), and calls the library.
5. **lib:** `createInvite` in `lib/team/service.ts` applies the rules (seats via `seatLimit`, roles), writes through
   `prisma` (`lib/db.ts`) and sends the email (`sendEmail`, `lib/publishing/email.ts`).
6. **Database:** Prisma writes the `Invite` row in Supabase Postgres.
7. Back in the action: `revalidatePath("/dashboard/settings/team")` redraws the page. A known problem becomes a plain
   message; anything else is written by `logError` (source `team.action`) and the client sees a safe message.

An API route (`app/api/**/route.ts`) is the same without steps 2 and 3: it checks its own key or token (for example
the `CRON_SECRET` bearer for `/api/cron/*`). An admin action adds `adminAction(permission)` and `writeAudit`.

## How to find the code for a page

**The rule:** take the URL path, find the folder with the same names under `app/`, and open `page.tsx` in it.

- Folders in **parentheses**, such as `(marketing)`, `(console)` or `(money)`, are skipped in the URL. If you can't find
  a folder, look inside the parenthesised folders at that level.
- A folder in **square brackets**, such as `[id]`, `[token]`, `[network]` or `[key]`, matches any value in that place.
  `[...path]` matches the rest of the path.
- `page.tsx` draws a page; `route.ts` answers an API call (or serves a file); `layout.tsx` wraps every page below it;
  `actions.ts` next to it holds what the page's buttons do.
- Shortcut: `find app -path "*<last part of the URL>*" -name "page.tsx"`.

**Worked examples**

| URL | File | Why |
|---|---|---|
| `/pricing` | `app/(marketing)/pricing/page.tsx` | `(marketing)` is a group, not in the URL |
| `/dashboard/settings/team` | `app/dashboard/settings/team/page.tsx` (buttons: `actions.ts` beside it) | Plain folders, one per URL part |
| `/admin/payments` | `app/admin/(console)/(money)/payments/page.tsx` | Two groups: `(console)` and the sidebar folder `(money)` |
| `/admin/companies/cm9x2k...` | `app/admin/(console)/(clients)/companies/[id]/page.tsx` | `[id]` takes the company id |
| `/admin/settings/updates` | `app/admin/(console)/(system)/settings/updates/page.tsx` | Group `(system)`, then plain folders |
| `/admin/login` | `app/admin/(auth)/login/page.tsx` | The sign-in pages have their own group `(auth)` and layout |
| `/api/social/instagram/callback` | `app/api/social/[network]/callback/route.ts` | `[network]` = `instagram`; an API route is `route.ts` |
| `/widget/AbC123` | `app/widget/[key]/route.ts` | No `page.tsx`: a route handler sends the chat page's HTML |
| `/api/admin/v1/users` | `app/api/admin/v1/[...path]/route.ts` | `[...path]` takes `users` and anything after it |

To find a function by name: `grep -rn "functionName" app lib components`. To find which page uses a library
function: `grep -rln "functionName" app`.

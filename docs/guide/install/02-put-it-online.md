# Put BuPulse online

This page explains how BuPulse gets from the code on GitHub to the live site at bupulse.com. The code can run on two
hosts: **Netlify** (free plan, what the site uses now) and **Cloudflare Workers** (Paid plan, $5 a month, fully
supported). GitHub Actions builds the site, updates the database first, then publishes it. You set the keys once on the
host and on GitHub. Scheduled jobs (publishing posts, reminders, clean-ups) run by themselves once the site is live. The
last section is the **deploy day checklist**: go through it every time a big update goes live.

**On this page**
- [The two hosts in one minute](#the-two-hosts-in-one-minute)
- [How a deploy works](#how-a-deploy-works)
- [What DEPLOY_TARGET does](#what-deploy_target-does)
- [The GitHub workflows](#the-github-workflows)
- [Keys to set: host, GitHub and Supabase](#keys-to-set-host-github-and-supabase)
- [Database migrations before every deploy](#database-migrations-before-every-deploy)
- [The domain (bupulse.com)](#the-domain-bupulsecom)
- [Scheduled jobs (cron)](#scheduled-jobs-cron)
- [The video robot](#the-video-robot)
- [Checks after a deploy](#checks-after-a-deploy)
- [Deploy day checklist](#deploy-day-checklist)
- [For developers](#for-developers)

## The two hosts in one minute

| | Netlify (free) | Cloudflare Workers (Paid, $5/month) |
|---|---|---|
| Status | **Live host now.** `deploy.yml` says "Push-to-deploy is off: the site is hosted on Netlify" | Supported; deploy by hand (Run workflow) or switch back |
| Setup guide | `docs/DEPLOY_NETLIFY.md` | `docs/DEPLOY.md` |
| Runtime keys live in | Netlify → Project configuration → Environment variables | Cloudflare secrets (`npx wrangler secret put NAME`) |
| Database connection | `DATABASE_URL` (transaction pooler, port 6543) | Hyperdrive binding in `wrangler.jsonc` (no `DATABASE_URL`) |
| Scheduled jobs | Netlify Scheduled Functions in `netlify/functions/` | Cron Triggers in `wrangler.jsonc` + `worker-crons.ts` |
| Posts go out | within 5 minutes of their time | within 1 minute |
| Request time limit | 60 seconds | 30 s CPU by default, 2 minutes set in `wrangler.jsonc` |
| Main cost risk | 300 credits a month, hard limit: **each production deploy costs 15**. Used up = every site on the account paused until next month. | Code bundle must stay under 10 MiB gzipped |
| Rollback | Restores the previous Netlify deploy (free, seconds) | `wrangler rollback` to the previous Worker version (about a minute) |

The database (Supabase) and the code are the same for both. Everything that differs between the hosts lives in
`lib/platform/`.

## How a deploy works

1. Someone pushes to the `main` branch on GitHub (or presses **Install** in Admin → Settings → Updates, or **Run
   workflow** on GitHub).
2. GitHub Actions starts the deploy workflow of the host. It runs in the GitHub environment **`production`**: if you
   added yourself as a required reviewer there, it waits for you to approve it. That is the moment to take a backup.
3. The workflow checks the keys (`scripts/check-env.mjs`: names and problems only, never a value). A missing required
   key stops the deploy.
4. It installs the packages, generates the database code and **updates the database** (`prisma migrate deploy`). A
   failed migration stops everything: the live site stays as it was.
5. It builds the site and publishes it. The new version is live.

**Pushing to `main` deploys.** On Netlify every production deploy costs 15 of the 300 free credits a month, so collect
changes and push only on deploy day.

## What DEPLOY_TARGET does

`DEPLOY_TARGET` is set in two places, for two different jobs:

| Where | Value | Effect |
|---|---|---|
| GitHub → Settings → Secrets and variables → Actions → **Variables** (repository variable) | `netlify` | A push to `main` runs `deploy-netlify.yml`. The GitHub fallback jobs that Netlify already runs (`publish-posts.yml`, `leads-digest.yml`, `autopilot.yml`) skip their scheduled runs, so nothing is paid twice. |
| same | unset or `cloudflare` | The push-to-deploy job of `deploy.yml` would run, but its `push` trigger is switched off today, so a push deploys nothing. The fallback jobs run on their schedules. |
| The app's own environment (Netlify or Cloudflare) | `netlify` or `cloudflare` | Which workflow Admin → Settings → Updates starts. Empty = the host the app is running on (`deployHost` in `lib/admin/deploy-host.ts`). |

To move to Cloudflare: delete the repository variable (or set `cloudflare`), turn the `push` trigger of `deploy.yml`
back on, put the domain on the Worker (`docs/DEPLOY.md` section 5), and push.

## The GitHub workflows

All in `.github/workflows/`. Third-party actions are pinned to full commit ids (`tests/workflows-pinned.test.ts`).

| Workflow | Starts | What it does |
|---|---|---|
| `deploy-netlify.yml` | Push to `main` when `DEPLOY_TARGET` = `netlify`; Run workflow; Admin → Updates | `deploy`: check-env, `npm ci`, `prisma generate`, **`prisma migrate deploy`**, `netlify build --offline`, `netlify deploy --no-build --prod`. `rollback`: `scripts/netlify-rollback.mjs`. `deploy-zip`: a signed zip from Admin → Updates (see [Install an update zip](03-install-an-update-zip.md)). |
| `deploy.yml` | Run workflow; Admin → Updates (push trigger off) | Cloudflare: check-env (`--build`, `--cloudflare`), `npm ci`, `prisma generate`, **`prisma migrate deploy`**, `node scripts/cf-build.mjs --keep`, `opennextjs-cloudflare deploy`. Also `rollback` (`wrangler rollback`), `deploy-zip`, `restore` (a kept Worker version). |
| `ci.yml` | Every pull request and push to `main` | Lint, type check, unit tests, AI quality check (allowed to fail), build, browser tests. Uses placeholders only. |
| `publish-posts.yml` | Every 5 min and hourly at :23 (skipped on Netlify) | Fallback caller of `/api/cron/publish` and `/api/cron/metrics` |
| `leads-digest.yml` | Hourly at :41 (skipped on Netlify) | Fallback caller of `/api/cron/leads-digest` |
| `autopilot.yml` | Every 3 h on Fri and Sat at :17 (skipped on Netlify) | Fallback caller of `/api/cron/autopilot`, with cursors |
| `purge-accounts.yml` | Daily 03:17 UTC | `/api/cron/purge-accounts`: erases accounts 30 days after deletion was asked |
| `social-refresh.yml` | Daily 04:43 UTC | `/api/cron/social-refresh`: renews social logins that expire within 7 days |
| `video-robot.yml` | Every 15 min | Makes pending content videos (see [The video robot](#the-video-robot)) |

Deploys run one at a time (`concurrency: deploy-production`, shared by both deploy workflows).

## Keys to set: host, GitHub and Supabase

The full list of variables, with what each does and its default, is `.env.example`; which go where on Netlify is
`docs/DEPLOY_NETLIFY.md` section 2, on Cloudflare `docs/DEPLOY.md` section 2. In short:

### On the host (runtime)

Required (the deploy stops without them): `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL` (Netlify only), `SUPABASE_SECRET_KEY`, `ENCRYPTION_KEY`,
`API_KEY_PEPPER`, `CRON_SECRET`, `ADMIN_EMAILS`, `AI_TEXT_PROVIDER` and its key, `RESEND_API_KEY`.

Recommended (a feature is off without it; the check warns): `RESEND_FROM`, `AI_MONTHLY_BUDGET_USD`,
`AI_COMPANY_MONTHLY_USD`, `WIDGET_AI_SHARE`, `MEDIA_PLATFORM_MAX_BYTES`, `MEDIA_COMPANY_VIDEO_MAX_BYTES`,
`ELEVENLABS_API_KEY`, `VIDEO_ROBOT_SECRET`, `NEXT_PUBLIC_WHATSAPP_NUMBER`, `TURNSTILE_SITE_KEY`,
`TURNSTILE_SECRET_KEY`, `GOOGLE_CALENDAR_CLIENT_ID`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
`GITHUB_REPO`, `GITHUB_TOKEN`.

Never in production: `ANALYTICS_DEV_COUNTRY`, `REGION_OVERRIDE` (the check refuses them). Empty in production:
`AUTH_EXTRA_ORIGINS`, `PUBLIC_LINK_URL` (the check warns). `PLATFORM_CHECK` only for the 10-minute header check.

On Netlify, a changed variable reaches the site only after a new deploy. Keys entered in **Admin → Services** do not
need a deploy (they apply within 30 seconds), so most outside-service keys are easier to manage there. Supabase's keys
must stay on the host.

`ENCRYPTION_KEY` and `API_KEY_PEPPER` must be the same on every host that uses the same database.

### On GitHub (Settings → Environments → `production`)

Put these on the **environment**, not as repository secrets, and limit the environment's deployment branches to
`main` (`docs/UPDATES.md`, "What the owner sets up").

| Kind | Name | For |
|---|---|---|
| Secret | `DIRECT_URL` | Migrations (session connection, port 5432) |
| Secret | `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID` | Netlify deploys |
| Secret | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Cloudflare deploys |
| Secret | `SUPABASE_SECRET_KEY` | Zip installs (downloads the zip, stores the backup) |
| Variable | `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_WHATSAPP_NUMBER` | Baked into the browser code at build time. They must be here: the build runs on GitHub, not on the host. |
| Variable | `RELEASE_PUBLIC_KEY` | Optional; the release key if not in `scripts/release-public-key.mjs` |

Repository-level (Settings → Secrets and variables → Actions): secrets `CRON_SECRET` (same value as on the host),
`VIDEO_ROBOT_SECRET` (same as on the host), `GEMINI_API_KEY` (CI's AI check, optional); variables `DEPLOY_TARGET`,
`NEXT_PUBLIC_SITE_URL` (the fallback jobs call this address), `ROBOT_APP_URL`.

### In Supabase (production project)

- **Authentication → URL Configuration**: Site URL `https://bupulse.com`, redirect `https://bupulse.com/**`.
- **SMTP** through Resend, user name `resend` in lower case (`docs/EMAIL_SETUP.md`), and the three email templates
  from `supabase/templates/`. The Magic Link template must contain `{{ .Token }}` (admin sign-in code).
- **Multi-Factor**: TOTP on. **Hooks → MFA Verification Attempt** → `public.hook_mfa_verification_attempt`.
- **Google sign-in** (Sign In / Providers → Google) with its Google Cloud OAuth client.
- Storage buckets are made by the migrations; check them in Storage (list in `docs/RELEASE_2.0.md`, step 6).

## Database migrations before every deploy

1. **Take a backup** before any deploy that changes the database (Supabase's free plan has no downloadable backups):

   ```bash
   pg_dump "$DIRECT_URL" --format=custom --no-owner --file "bupulse-$(date +%Y%m%d-%H%M).dump"
   ```

   Keep the file on your Mac and a copy in Google Drive. Never commit it or upload it to GitHub: the repository is public.
2. The deploy workflow runs `npx prisma migrate deploy --config prisma7.config.ts` with `DIRECT_URL` **before**
   building. You do not run it by hand, except to update a database without deploying.
3. Migrations only go forward. A rollback changes the code, never the database. Most migrations only add tables and
   columns, so older code keeps working. If one renames or drops something, read `docs/UPDATES.md` ("Rollback") first.

Restore (only after a failed deploy damaged data):
`pg_restore --clean --if-exists --no-owner --dbname "$DIRECT_URL" bupulse-YYYYMMDD-HHMM.dump`.

## The domain (bupulse.com)

The domain's DNS stays at Cloudflare in both cases.

**Netlify** (`docs/DEPLOY_NETLIFY.md` section 5):

1. Netlify → Domain management → Add a domain: `bupulse.com` and `www.bupulse.com`.
2. In Cloudflare DNS: `bupulse.com` → `A` record to Netlify's address (or `CNAME` to `<site>.netlify.app`), `www` →
   `CNAME` to `<site>.netlify.app`. **Proxy status: DNS only (grey cloud)**, so Netlify sees the visitor's real country
   and address (prices on `/pricing`, rate limits).
3. Netlify → HTTPS → Verify DNS configuration → Provision certificate.
4. `NEXT_PUBLIC_SITE_URL` = `https://bupulse.com` on Netlify **and** as a GitHub variable, then deploy again.

**Cloudflare** (`docs/DEPLOY.md` section 5): add `routes` with `custom_domain: true` for `bupulse.com` and
`www.bupulse.com` to `wrangler.jsonc` and deploy. The records are created **proxied (orange cloud)**; keep them so. Delete
old grey-cloud records for Netlify first.

Email records for Resend (SPF, DKIM, DMARC) stay as they are in both cases.

## Scheduled jobs (cron)

Every job is a route under `/api/cron/`, called with `Authorization: Bearer $CRON_SECRET`. On Cloudflare the schedules
are in `worker-crons.ts` and `wrangler.jsonc` (`triggers.crons`); `worker.ts` (`scheduled`) calls the route. On Netlify
each is a scheduled function `netlify/functions/cron-*.mts` that hands the job to `cron-runner-background` (15 minutes
allowed). Times are UTC (Kigali is UTC+2).

| Schedule (UTC) | Cron | Route | What it does |
|---|---|---|---|
| Every minute (Netlify: every 5 minutes) | `PUBLISH_CRON` `* * * * *` | `/api/cron/publish` | Publishes posts that are due; retries failed ones (1, 5, 15, 60 minutes, 5 tries) |
| Hourly at :07 | `CONTENT_SUMMARY_CRON` | `/api/cron/content-summary` (cursor) | The daily email of posts auto-approval scheduled, sent from 08:00 local time |
| Hourly at :23 | `METRICS_CRON` | `/api/cron/metrics` | Reads views and likes of recent posts (each post at most once every 20 hours) |
| Hourly at :37 | `LEADS_DIGEST_CRON` | `/api/cron/leads-digest` | The leads summary where it is 08:00, and webhook retries |
| Hourly at :53 | `TRIAL_CRON` | `/api/cron/trial-reminders` | Trial-end reminders (a day before, last day), ends trials (read-only), retries Google Calendar changes |
| Daily 02:17 | `ANALYTICS_ROLLUP_CRON` | `/api/cron/analytics-rollup` (cursor) | Daily numbers for analytics and the admin console |
| Daily 03:19 | `MEDIA_CLEANUP_CRON` | `/api/cron/media-cleanup` | Deletes content videos 30 days after their posts went out, unrecorded files, and release zips and backups older than 30 days |
| Daily 03:47 | `STORE_SYNC_CRON` | `/api/cron/store-sync` (cursor) | Re-syncs products imported from Shopify and WooCommerce |
| Daily 04:29 | `PLAN_PRICE_CRON` | `/api/cron/plan-price-changes` (cursor) | Price-change notices, moves clients to the new price before renewal |
| Daily 05:41 | `MOMO_RENEWALS_CRON` | `/api/cron/momo-renewals` (cursor) | Mobile Money reminders 5 and 1 days before the end, 3-day grace then read-only, unpaid offer reminders, closes unpaid payments after 48 h, EUR rate refresh |
| Every 3 h on Fri and Sat at :11 | `AUTOPILOT_CRON` | `/api/cron/autopilot` (cursor) | Autopilot plans next week |
| Daily 03:17 (GitHub) | | `/api/cron/purge-accounts` | Erases accounts past their 30-day grace period, with their files |
| Daily 04:43 (GitHub) | | `/api/cron/social-refresh` | Renews social logins before they expire |
| Every 15 min (GitHub) | | `/api/robot/videos/*` | The video robot |

"Cursor" jobs answer a few businesses per call and are called again until they say `nextCursor: null` (at most 40
calls a run). Every run is recorded (`CronRun`) and shown in **Admin → Health**, which flags a job that is late.

Run a job by hand:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://bupulse.com/api/cron/publish
```

## The video robot

Content videos are normally drawn in the owner's browser. The robot makes them automatically: the GitHub Action
`video-robot.yml` runs every 15 minutes, opens headless Chrome on GitHub's computer, draws each waiting video with the
app's own renderer, uploads it and confirms it. It costs nothing while the repository is public. It never renders on
Netlify or Cloudflare. Full details: `docs/VIDEO_ROBOT.md`.

Set it up:

1. Make a secret: `openssl rand -hex 32`.
2. Host environment: `VIDEO_ROBOT_SECRET` = that value, then redeploy (Netlify needs a deploy to see it).
3. GitHub repository: secret `VIDEO_ROBOT_SECRET` (same value), variable `ROBOT_APP_URL` = `https://bupulse.com`.
4. Test: GitHub → Actions → "Video robot" → Run workflow. The log shows counts only. Admin → Services → "Video robot"
   shows the last run.

Until both are set, the workflow skips quietly. To stop it, delete the secret on the host or disable the workflow.
GitHub turns off scheduled workflows after 60 days with no commits: re-enable it in Actions.

## Checks after a deploy

1. `https://bupulse.com/api/status` answers `{"status":"ok"}` (it also shows the version).
2. Sign in and open `/dashboard`.
3. Admin → Settings → Updates shows the host, the version and the latest deploy runs.
4. Admin → Health: the scheduled jobs have run (publish within 5 minutes on Netlify, 1 minute on Cloudflare).
5. Schedule an Instagram post with a PNG design a few minutes ahead: it goes out, converted to JPEG.
6. Header check (once, 10 minutes): set `PLATFORM_CHECK=1`, deploy, run the `curl` commands in
   `docs/DEPLOY_NETLIFY.md` section 7 (or `docs/DEPLOY.md` section 6), then remove the variable.
7. A free uptime monitor (for example UptimeRobot) on `/api/status` every 5 minutes. It also keeps the free Supabase
   project awake (it pauses after 7 days without traffic).

## Deploy day checklist

Do these in order on the day a big update goes live. Tick each one.

**Before you push**

- [ ] Every change is tested on the test site; `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` pass.
- [ ] Cloudflare only: the Workers build is under the **10 MiB gzipped** limit (`npm run build:cloudflare`, then
      `npx wrangler deploy --dry-run --outdir /tmp/cf`).
- [ ] Backup of the production database taken (`pg_dump`, above).
- [ ] `node --env-file=.env.production scripts/check-env.mjs --runtime` passes on the production values.
- [ ] **`AUTH_EXTRA_ORIGINS` and `PUBLIC_LINK_URL` are EMPTY in production.** They are for the test tunnel; set, they let
      sign-in accept the tunnel's address and make sales TV, referral and staff-invitation links point at it.
- [ ] **Production has its own VAPID keys** (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` =
      `mailto:office@bupulse.com`), made once with the command in `.env.example`, never the local pair. Changing them
      later makes every phone switch alerts on again, so set them once.
- [ ] Every `NEXT_PUBLIC_*` value is also a GitHub `production` variable.

**Deploy**

- [ ] **Pushing `main` deploys** (`deploy-netlify.yml`, 15 Netlify credits each time), so push **only on deploy day**,
      with the owner's go-ahead. Approve the run on GitHub if reviewers are set.
- [ ] **All new migrations applied on the production database**: the run's "prisma migrate deploy" step is green. If
      you updated the database by hand, `npx prisma migrate deploy --config prisma7.config.ts` with the production
      `DIRECT_URL` says "No pending migrations".
- [ ] The checks after a deploy (above) pass.

**Right after, in the admin console**

- [ ] **Admin → Settings → Card payments (Paddle) → Set up prices**: run it again. New or changed prices (for example
      the Rwanda Business price) clear the old card prices; until this runs, card shows "coming soon" for those plans
      (Mobile Money still works). It also creates or updates the Paddle notification destination
      (`https://bupulse.com/api/billing/webhooks/paddle`).
- [ ] **Admin → Settings → Payments: Mobile Money**: the MoMo Pay merchant code, the MTN number and **the Airtel Money
      number** are set (Airtel instructions show to clients only when the Airtel number is filled in).
- [ ] **Admin → Settings → Google Calendar → Connect Google Calendar**, then **Test**. Without it, bookings use the
      reusable meeting link and an `.ics` file only.
- [ ] **Admin → Settings → Demo calls**: the **real demo meeting link** (your Google Meet room) is set, and
      **Availability** shows your real demo hours.
- [ ] Admin → Settings → Trial (trial days) and Admin currency (default RWF).
- [ ] Admin → Plans, Regions and prices, Industries look right; Admin → Music has its tracks.

**Outside BuPulse (once, may take weeks)**

- [ ] **Google OAuth consent screen switched to External** and published "In production" (Google Cloud → Google Auth
      Platform → Audience) for the client used by YouTube, Google Drive and Google sign-in. In "Testing" only listed
      test users can connect and refresh tokens expire after 7 days (`docs/PLATFORM_APPS.md` section 4). The Google
      Calendar client used by the admin is a separate one, set to Internal (`docs/GOOGLE_CALENDAR.md`).
- [ ] **Meta Business Verification** approved, then App Review and Live mode, **before clients can connect
      Instagram/Facebook** for automatic posting. Until then, only people with a role on the Meta app can connect, and
      clients use reminders plus copy-and-post (`docs/META_APP_REVIEW.md`). BuPulse is not registered as a business
      yet, which Meta requires.
- [ ] Resend's DNS records for bupulse.com are verified (SPF, DKIM, DMARC pass in Gmail's "Show original").

**Marketing material**

- [ ] **Kinyarwanda subtitles in the demo videos checked by a native speaker.** They were written by AI
      (`Demo/STORYBOARD.md`, `Demo/studio/src/script.ts`). The same goes for the Kinyarwanda texts in the app
      (`lib/widget/strings.ts`, `lib/brand/languages.ts`).

**First real test**

- [ ] Sign up a test company from a phone in Rwanda: RWF prices, book a demo, start the trial in Admin → Demos, pay a
      small amount by MoMo, confirm it in Admin → Payments, and see the company become active.

## For developers

- **Host layer:** `lib/platform/` (`detect.ts` host detection, `database.ts` Hyperdrive vs `DATABASE_URL`,
  `background.ts` `waitUntil`/`keepAlive`, `cache.ts`, `headers.ts` country and IP, `limits.ts` time budgets such as
  `NETLIFY_PUBLISH_EVERY_MINUTES` and `timeBudget`). `PLATFORM=netlify|cloudflare|node` forces a host.
- **Deploy target for Updates:** `deployHost()` and `DEPLOY_HOSTS` in `lib/admin/deploy-host.ts`.
- **Cron wiring:** `worker-crons.ts` (`CRON_ROUTES`, `routeForCron`, one constant per schedule), `worker.ts`
  (`scheduled`, `runCron`, `runCursorCron`), `netlify/functions/cron-*.mts`, `netlify/lib/cron.ts`. The health page's
  list is `CRON_JOBS` in `lib/admin/cron.ts`; each route wraps its work in `recordCron` (`lib/admin/cron-run.ts`).
  Change schedules in all places together: `tests/worker-crons.test.ts` and `tests/netlify-crons.test.ts` compare them.
- **Cloudflare build:** always `node scripts/cf-build.mjs` (Prisma's query compiler as a `.wasm` module imported by
  `worker.ts`, the generated client's data externalised). `worker.ts` may only export its handler and the Durable
  Object classes. Bundle size notes: `docs/DEPLOY.md`, "Known notes".
- **Netlify build:** `netlify.toml` (`npx prisma generate --config prisma7.config.ts && npm run build`, Node 24, the
  pinned `@netlify/plugin-nextjs`); rollback `scripts/netlify-rollback.mjs`.
- **Env check:** `scripts/check-env.mjs` (`checkEnv`, `netlifyEnv`, `cloudflareEnv`, `wranglerInfo`).
- **Video robot:** `scripts/video-robot/robot.mjs`, `app/api/robot/videos/{peek,claim,complete,fail,report}/route.ts`,
  `lib/visuals/robot.ts` (`claimRobotVideos`, `completeRobotVideo`, `failRobotVideo`, `robotStatus`),
  `lib/visuals/robot-auth.ts`.
- **Links in production:** `lib/auth/site-url.ts` (`siteUrl`, `publicSiteUrl`) and `lib/auth/request-site.ts`
  (`requestSiteUrl`, `linkSiteUrl`); with `AUTH_EXTRA_ORIGINS` and `PUBLIC_LINK_URL` empty every link is
  `NEXT_PUBLIC_SITE_URL` (`tests/auth/request-site.test.ts`).
- **Note:** `docs/DEPLOY.md` still describes Cloudflare as the push-to-deploy host; `.github/workflows/deploy.yml` now
  has only a `workflow_dispatch` trigger.

# Deploying BuPulse

BuPulse 2.0 runs on **Cloudflare Workers, Paid plan** ($5 a month), through OpenNext. The database is Supabase Postgres, reached through Cloudflare Hyperdrive. These steps are done once by the owner; after that GitHub deploys every push to `main`.

Netlify's free plan stays a supported fallback: see `docs/DEPLOY_NETLIFY.md`. The repository variable `DEPLOY_TARGET` (unset or `cloudflare` = this page, `netlify` = that one) chooses which workflow a push to `main` runs; everything that differs between the two hosts lives in `lib/platform/`.

Why the Paid plan: the Worker is about 9.2 MiB gzipped (the free plan allows 3 MiB, Paid 10 MiB), it needs more than 10 ms of CPU per request (Paid: 30 s by default, 2 minutes set in `wrangler.jsonc`), and the publisher runs every minute.

## 1. One-time Cloudflare setup (owner)

1. **Workers Paid**: Cloudflare dashboard, Workers & Pages, Plans, Workers Paid ($5 a month, billed to the account's card).
2. Log in from your Mac: `npx wrangler login`
3. Create the Hyperdrive config. Use the Supabase **session pooler** connection string (Supabase: Connect, then Session pooler, port 5432), the same style as `DIRECT_URL`:

   ```
   npx wrangler hyperdrive create bupulse-db --connection-string="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
   ```

4. Copy the `id` it prints into `wrangler.jsonc`, replacing `TODO_HYPERDRIVE_CONFIG_ID`, and commit it (an id, not a secret). The deploy stops while the placeholder is there.
5. Run `npm run cf-typegen` after any change to `wrangler.jsonc`.

## 2. Runtime secrets (stored in Cloudflare, never in git)

Set each one with `npx wrangler secret put NAME` (it asks for the value; the first one creates the Worker). Which variables exist, which are required and their defaults is the same list as for Netlify: `docs/DEPLOY_NETLIFY.md` section 2, and `.env.example` (every variable, grouped and commented). Differences on Cloudflare:

- **No `DATABASE_URL`**: the app uses the Hyperdrive binding (`lib/platform/database.ts`). `DIRECT_URL` is a GitHub secret only (migrations).
- **No `PLATFORM`**: the host is detected. `GEO_PROVIDER` stays `builtin`; the visitor's country comes from `cf-ipcountry` and the IP from `cf-connecting-ip`.
- `ENCRYPTION_KEY` and `API_KEY_PEPPER` must be the same values everywhere the database is used (Netlify included), or stored tokens and API keys stop working.
- `MEDIA_COMPANY_VIDEO_MAX_BYTES`: empty means 100 MB per company (the launch value).

Required: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ENCRYPTION_KEY`, `API_KEY_PEPPER`, `CRON_SECRET`, `ADMIN_EMAILS`, `AI_TEXT_PROVIDER` and its key (`GEMINI_API_KEY` or `ANTHROPIC_API_KEY`), `RESEND_API_KEY`. Recommended: the second table of `docs/DEPLOY_NETLIFY.md` section 2 (AI budgets, storage caps, ElevenLabs, video robot, WhatsApp, Turnstile, Google Calendar, Updates screen).

The `NEXT_PUBLIC_*` values are also needed at build time (see the GitHub variables below), because Next.js bakes them into the browser code.

**Checked on every deploy** (`scripts/check-env.mjs`, run by `deploy.yml` before `npm ci`): the build values in the workflow, then the Worker's secret names read from Cloudflare's API with the deploy token (values cannot be read), and the Hyperdrive id in `wrangler.jsonc`. It prints names and problems only and stops the deploy on a missing required one. Yourself: `CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/check-env.mjs --cloudflare`, and with a filled-in file `node --env-file=.env.production scripts/check-env.mjs --runtime` (formats too).

## 3. GitHub settings (Settings, Environments, `production`)

Put these on the `production` **environment**, not as repository secrets: only jobs that run in that environment (the deploy workflow, from `main`) can read them. Limit the environment's deployment branches to `main`. Details: `docs/UPDATES.md` (What the owner sets up).

Secrets:

- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with the "Edit Cloudflare Workers" template (it also lets the check read the secret names)
- `CLOUDFLARE_ACCOUNT_ID`: shown on the Cloudflare dashboard sidebar
- `DIRECT_URL`: Supabase direct/session connection string (port 5432), used to run migrations
- `CRON_SECRET`, `VIDEO_ROBOT_SECRET`: the same values as in Cloudflare (GitHub fallback jobs, the video robot)

Variables (not secret, they end up in the browser anyway):

- `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_WHATSAPP_NUMBER`, `ROBOT_APP_URL`
- `DEPLOY_TARGET`: leave unset (or `cloudflare`).

## 4. Deploying

- **Before the plan builder migration (`20261009095000_plan_builder`) reaches production, take a database backup.** It converts `Subscription.plan` from an enum to text and drops `PlanLimitOverride` and the `Plan` enum; see `docs/PLANS.md`.
- Automatic: every push to `main` runs `.github/workflows/deploy.yml`: the variable checks, database migrations (`prisma migrate deploy`), the Workers build (`node scripts/cf-build.mjs`), then `opennextjs-cloudflare deploy`. If a check or a migration fails, nothing is deployed. The job runs in the GitHub environment `production`; add required reviewers there to approve each deploy by hand.
- From the admin console: Settings, Updates installs a chosen release or rolls the Worker back through the same workflow (`docs/UPDATES.md`).
- CI (`.github/workflows/ci.yml`) runs lint, type check, tests, build and the browser smoke test on every pull request.
- Manual, from your machine (needs `wrangler login` and a `.env` with the build-time values): `npm run deploy`
- Try the Workers build locally: `npm run preview` (or only build: `npm run build:cloudflare`).

## 5. Domain and DNS (bupulse.com stays on Cloudflare DNS)

In `wrangler.jsonc` add, then deploy:

```jsonc
"routes": [{ "pattern": "bupulse.com", "custom_domain": true }, { "pattern": "www.bupulse.com", "custom_domain": true }]
```

A custom domain creates its DNS record itself, **proxied (orange cloud)**. Keep it proxied: the Worker only runs behind Cloudflare's proxy, and the app reads the visitor's country (`cf-ipcountry`, prices on `/pricing`, analytics) and IP (`cf-connecting-ip`, rate limits, admin key allow-lists) from Cloudflare's headers. If the domain had DNS-only (grey cloud) records for Netlify, delete those `A`/`CNAME` records for `bupulse.com` and `www` first. Email records (Resend, `docs/EMAIL_SETUP.md`) stay as they are. Cloudflare issues the certificate; SSL/TLS mode "Full (strict)".

For staging, create a second worker (copy `wrangler.jsonc` to an environment named `staging` with its own name, Hyperdrive config and `staging.bupulse.com` route) and deploy it with `--env staging`. Each environment has its own secrets (`wrangler secret put NAME --env staging`) and should point at the staging Supabase project.

## 6. Checks after the first deploy

1. `https://bupulse.com/api/status` answers `{"status":"ok"}`. Sign in, open `/dashboard`.
2. Header check: `wrangler secret put PLATFORM_CHECK` (value `1`), then `curl -s https://bupulse.com/api/platform/check` shows `"platform":"cloudflare"`, your country and your IP; the same with `-H "cf-ipcountry: US" -H "cf-connecting-ip: 1.2.3.4"` must not change the answer (Cloudflare overwrites them). Then `wrangler secret delete PLATFORM_CHECK`.
3. Cloudflare dashboard, the Worker, Logs: `[cron] /api/cron/publish` every minute, the hourly jobs at :07, :23, :37 and :53.
4. Schedule an Instagram post with a PNG design a few minutes ahead: it goes out within a minute of its time, converted to JPEG.
5. Admin, Settings, Updates shows Cloudflare, the version and the runs of `deploy.yml`.

## Known notes

- **Bundle size** (`npx wrangler deploy --dry-run --outdir /tmp/cf` after `npm run build:cloudflare` prints it): 9.2 MiB gzipped (37.7 MiB before compression) on 13 October 2026, against the Workers Paid limit of 10 MiB gzipped (64 MiB raw). Before the 2.0 trimming it was 11.0 MiB gzipped, over the limit. What was cut: the `@anthropic-ai/sdk` and `@google/genai` packages (Claude and Gemini are called over plain `fetch`, `lib/ai/gemini-rest.ts`; the Google SDK pulled in google-auth-library, ws and more, copied into several route layers), Prisma's query compiler as base64 in the JavaScript (now a `.wasm` module, `scripts/cf-build.mjs`), and the country border data (`@rapideditor/country-coder`) in the pricing page (`lib/geo/availability.ts`). Static files (`public/`, `_next/static`, about 5 MB) are Workers Assets and do not count. Keep heavy libraries out of server code shared by many routes; re-measure before adding one.
- **Workers build**: always `node scripts/cf-build.mjs` (the npm `deploy`, `preview` and `build:cloudflare` scripts and `deploy.yml` use it), not `opennextjs-cloudflare build` alone: workerd cannot compile WebAssembly from bytes, so Prisma's query compiler must be a `.wasm` module imported by `worker.ts`, like the image codecs. The script patches the generated client for the build and generates the usual one again afterwards, also when stopped with Ctrl+C. If it was killed hard (or the machine stopped) and `next dev`, tests or `npm run build` then fail on Prisma's query compiler ("was not loaded (worker.ts)"), run `npx prisma generate` to restore the client.
- `worker.ts` may only export its handler and the Durable Object classes (workerd refuses other named exports); the cron schedules live in `worker-crons.ts`.
- `pg-cloudflare` is pinned to 1.3.0 in `package.json` (`overrides`) because 1.4.1 is published without the files the bundler needs. Remove the pin once a fixed version ships.
- `proxy.ts` runs as Node.js middleware, which OpenNext marks experimental on Cloudflare. Check sign-in and the `/dashboard` redirect after the first deploy.
- Background work after a response (`waitUntil`: analytics events, lead emails, webhooks) gets about 30 s on Cloudflare; the code keeps each such task under that. Long jobs run as cron calls instead (up to 15 minutes each).
- Memory is 128 MB per isolate: uploads (photos, Gallery videos up to 50 MB) go straight to Supabase Storage with signed URLs and never through the Worker; videos are checked with ranged reads (`lib/media/service.ts`).
- Videos are made by the video robot on GitHub Actions or in the owner's browser (`docs/VIDEO_ROBOT.md`), never in the Worker.

## Scheduled jobs (Cron Triggers)

All in `worker-crons.ts` and `wrangler.jsonc` (11 triggers; Workers Paid allows 250 per account). Times are UTC. The Netlify fallback runs the same jobs at the same times, except the publisher (every 5 minutes there).

| Schedule | Route | What |
| --- | --- | --- |
| every minute | `/api/cron/publish` | publish due posts |
| hourly at :07 | `/api/cron/content-summary` (cursor) | the daily email of posts auto-approval scheduled, from 08:00 local |
| hourly at :23 | `/api/cron/metrics` | post views and likes |
| hourly at :37 | `/api/cron/leads-digest` | leads summary where it is 08:00 |
| hourly at :53 | `/api/cron/trial-reminders` | trial-end reminders and expiry |
| daily 02:17 | `/api/cron/analytics-rollup` (cursor) | analytics roll-up |
| daily 03:19 | `/api/cron/media-cleanup` | content video files 30 days after their posts, unrecorded files |
| daily 03:47 | `/api/cron/store-sync` (cursor) | re-sync imported store products |
| daily 04:29 | `/api/cron/plan-price-changes` (cursor) | plan price change notices and moves |
| daily 05:41 | `/api/cron/momo-renewals` (cursor) | Mobile Money renewal reminders, grace period, unpaid offer reminders |
| every 3 h, Fri and Sat | `/api/cron/autopilot` (cursor) | Autopilot plans next week |

"Cursor" jobs call their route again until it answers `nextCursor: null` (at most 40 calls a run). GitHub Actions runs `purge-accounts` and `social-refresh` daily, and fallback calls of the publisher.

## Account deletion (30-day grace period)

Deleting an account locks it for 30 days; the owner can sign in and cancel. A daily GitHub Actions job (`.github/workflows/purge-accounts.yml`) calls `POST /api/cron/purge-accounts`, which erases accounts past the date, including their files in Storage. It needs two more secrets:

- `SUPABASE_SECRET_KEY`: Supabase, Project Settings, API keys, the secret key. Set it in Cloudflare (`wrangler secret put SUPABASE_SECRET_KEY`). Server only. Without it accounts are still erased but their Storage files are left behind.
- `CRON_SECRET`: any long random string (for example `openssl rand -base64 32`). Set the same value in Cloudflare and as a GitHub Actions secret.

You can run the job by hand from the Actions tab (Run workflow). `/api/cron` is not behind the sign-in redirect in `proxy.ts`; the route checks the bearer token itself.

## Publishing scheduled posts

Posts scheduled in the calendar are published by `lib/publishing/engine.ts`. Three things call it, and any of them may run at the same time as another because posts are claimed atomically (a post is never published twice):

| What | How often | Calls |
| --- | --- | --- |
| Cloudflare Cron Trigger (main) | every minute | `POST /api/cron/publish` |
| Cloudflare Cron Trigger | hourly at :23 | `POST /api/cron/metrics` (reads views and likes of posts from the last 30 days; each post at most once every 20 hours, so a run only does what is left) |
| GitHub Actions `.github/workflows/publish-posts.yml` (fallback) | about every 5 minutes for publish, hourly for metrics (GitHub is best effort) | `POST /api/cron/publish`, `POST /api/cron/metrics` |

How the Cloudflare trigger is wired: `wrangler.jsonc` points `main` at `worker.ts`, a small worker that re-exports the one OpenNext generates (`.open-next/worker.js`) and adds a `scheduled` handler. The handler calls the app's own routes through the `WORKER_SELF_REFERENCE` binding with `Authorization: Bearer $CRON_SECRET`. The crons are listed under `triggers.crons`; their schedules and routes are in `worker-crons.ts` (change both together; `tests/worker-crons.test.ts` and `tests/netlify-crons.test.ts` check them against `wrangler.jsonc` and the Netlify functions). Cron Triggers deploy with the Worker (`npm run deploy`), nothing else to switch on.

What it needs, all set once:

- `CRON_SECRET` in Cloudflare (`wrangler secret put CRON_SECRET`) and as a GitHub Actions secret, the same value as for the account purge.
- `SUPABASE_SECRET_KEY` in Cloudflare. The publisher has no signed-in user, so it signs photo links with this key (1 hour for networks, 7 days for reminder emails). Without it, posts with photos fail to send.
- `RESEND_API_KEY` in Cloudflare (docs/EMAIL_SETUP.md). Reminder emails for accounts set to "remind me" (and TikTok or YouTube script posts) and failure notices go out through Resend from `register@bupulse.com`. Optional `RESEND_FROM` overrides the sender. Without the key reminders are not sent, so the post is retried and then marked failed.
- `NEXT_PUBLIC_SITE_URL`, used for the "I posted it" and "Reconnect" links in emails. The "I posted it" link is signed with a key derived (HKDF) from `ENCRYPTION_KEY`, so there is no extra secret, and works for 30 days.

Check it by hand: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://bupulse.com/api/cron/publish` answers with how many posts were claimed, published, sent as reminders, set to retry or failed. Failed posts wait 1, 5, 15 and 60 minutes between tries (5 tries in all), then show as Failed in the calendar and the owner gets an email.

Time budget: a run stops claiming new posts after about 45 seconds, but posts already in flight finish, and an Instagram publish can wait up to about a minute for Meta to process the images. So one run can take up to about 2 minutes. Cloudflare Cron Triggers allow that on the Workers Paid plan, and the GitHub fallback waits up to 280 seconds for the answer.

Instagram only accepts JPEG. When a post for Instagram has PNG or WebP images (all Designs are PNG), the publisher converts each once to a JPEG (transparency flattened on white, quality 88) with the `@jsquash` WebAssembly codecs and stores it next to the original as `<path>.jpg` in the same bucket. Later posts reuse that copy. The copy is deleted with the original (deleting a design or a Gallery photo) and by the account purge, which removes the whole user folder. `worker.ts` imports the three `.wasm` files so wrangler bundles them (about 570 KB, roughly 250 KB gzipped).

Safety rules of the publisher: a post is never sent twice when we cannot be sure. A post stuck in "publishing" for over 10 minutes (a run crashed), and a post whose final call to the network timed out or failed with a server error, become "Post it yourself" (NEEDS_ACTION) with "We could not confirm this post went out" and the owner gets an email to check the network and press "Mark as posted" or retry. Only failures that clearly happened before anything was created (auth, validation, image upload, rate limit) are retried by themselves. A post stops after 5 attempts. Posts of accounts that are scheduled for deletion are not published.

CPU limit: `wrangler.jsonc` sets `limits.cpu_ms` to 120000 (2 minutes of CPU, Workers Paid), because converting a large photo to JPEG for Instagram needs more than the 30 second default. Photos over 4096 pixels on a side are refused with a friendly message (the upload screen shrinks photos to 2048 px). Instagram images are also padded with white to 4:5 or 1.91:1 when their shape is outside that range, and kept under 8 MB.

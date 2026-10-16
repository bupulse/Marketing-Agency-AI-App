# Deploying BuPulse on Netlify (free plan)

**Fallback host.** BuPulse 2.0 launches on Cloudflare Workers Paid (`docs/DEPLOY.md`, owner decision of 13 October 2026); this page is kept so the site can move to Netlify's free plan if needed. BuPulse can run on Netlify's free plan instead of Cloudflare Workers. The code supports both; one GitHub variable (`DEPLOY_TARGET`) decides where a push to `main` goes. The Cloudflare setup (`docs/DEPLOY.md`, `wrangler.jsonc`, `worker.ts`) is untouched and can be switched back on at any time.

What runs where on Netlify:

| Part | On Netlify |
| --- | --- |
| Pages, API routes, server actions | One Netlify Function made by Netlify's Next.js runtime (`@netlify/plugin-nextjs`, pinned in `netlify.toml` and `package.json`) |
| `proxy.ts` (session refresh, dashboard redirect) | A Netlify Edge Function (made by the same runtime) |
| Static files (`public/`, `_next/static`) | Netlify's CDN |
| Scheduled jobs (the Cloudflare Cron Triggers) | Netlify Scheduled Functions `netlify/functions/cron-*.mts`, same schedules (UTC), except the publisher: every 5 minutes instead of every minute |
| Database | Supabase through `DATABASE_URL` (no Hyperdrive) |
| Visitor country / IP | Netlify's `x-nf-geo` and `x-nf-client-connection-ip` headers only (no `x-country`, `x-forwarded-for` or `cf-*`). No `x-nf-geo` means the catch-all region; no `x-nf-client-connection-ip` means one shared "unknown" rate-limit bucket. |
| Deploys, rollback | GitHub Actions `.github/workflows/deploy-netlify.yml` (migrations first), started by a push or by Admin, Settings, Updates |

## Free plan limits that matter (read this first)

Netlify's free plan gives **300 credits a month, as a hard limit: when they are used up, every site on the account is paused** ("Site not available") until the next month. Credits are spent on:

| What | Cost | BuPulse |
| --- | --- | --- |
| Production deploy | 15 credits each (failed deploys and rollbacks are free) | Every push to `main` and every "Install update" is one. 10 deploys = 150 credits. |
| Compute (functions) | 10 credits per GB-hour; free functions always have 1 GB, so 1 hour of function time = 10 credits | Every page view, API call and cron run |
| Web requests | 2 credits per 10,000 | Pages, assets, API, cron calls |
| Bandwidth | 20 credits per GB | Pages, scripts, images served by Netlify |

**The publisher runs every 5 minutes on Netlify** (owner decision; every minute on Cloudflare). Each run is three function invocations (the scheduled function, the background runner, the `/api/cron/publish` route), about 8,640 runs a month: roughly 12 to 50 credits at 0.5 to 2 s a run, instead of 60 to 240 every minute. Each run claims every post due up to that moment, so a post scheduled between two runs goes out at the next one, at most 5 minutes late; the composer and the calendar say "Posts go out within 5 minutes of the scheduled time." on Netlify. (`NETLIFY_PUBLISH_EVERY_MINUTES` in `lib/platform/limits.ts` and the schedule in `netlify/functions/cron-publish.mts` change together; `tests/netlify-crons.test.ts` checks it.) A run publishes up to 20 posts in its 15 s budget; anything beyond waits for the next run. Add the hourly jobs (about 10 to 30 credits, the hourly content summary included: about 720 runs a month), the video
robot's calls from GitHub (every 15 minutes about 2,900 short claim calls a month, plus an upload and a confirm per
video: roughly 5 to 15 credits; the videos are rendered on GitHub's runner, never on Netlify) and the GitHub fallback
workflows. A realistic month at launch: 10 deploys (150) + publisher (12 to 50) + hourly jobs (10 to 30) + robot (5 to
15) + visitors, about 200 to 260 of the 300 credits: deploy in batches.

What else to do:

1. After the first week, check Netlify: Usage & billing, Credit usage breakdown, Compute. Multiply by four.
2. The GitHub fallback workflows that duplicate a Netlify scheduled function (`publish-posts.yml` for publishing and metrics, `leads-digest.yml`, `autopilot.yml`) skip their scheduled runs by themselves when the repository variable `DEPLOY_TARGET` is `netlify`, so no job is paid for twice; "Run workflow" by hand still works. `purge-accounts.yml` and `social-refresh.yml` keep running (Netlify has no scheduled function for them).
3. Deploy in batches: merge several changes, then deploy once.

**When free is not enough:** Netlify Personal ($9 a month, 1,000 credits, and you can buy 500 more for $5 instead of being paused), or Pro (from 3,000 credits, also allows choosing the functions region and more memory). Cloudflare Workers Paid ($5 a month) is the other way out and is still fully supported (`docs/DEPLOY.md`).

Other limits, on every plan:

- **60 seconds per request** (not configurable). BuPulse shortens its own budgets on Netlify (`lib/platform/limits.ts`): the publisher claims posts for 15 s instead of 45 s, waits at most 25 s for Instagram to process images (then retries later, nothing was published), metrics run for 30 s, Autopilot plans 1 business per call instead of 2, store sync takes 2 stores per call instead of 5, Canva's return waits 15 s before saying "still saving". Work handed to `waitUntil` also counts towards the 60 s. If Netlify ever gives no `waitUntil` in production, the request waits for that work before answering (at most 10 s, `keepAlive` in `lib/platform/background.ts`) and logs a warning, rather than losing it when the function freezes.
- **Scheduled functions stop after 30 s**, so they only hand the job to the background function `cron-runner-background` (up to 15 minutes), which calls the route once or with cursors (as `worker.ts`), each call within 60 s, and starts no new call after 13 minutes.
- **6 MB per request or response** (about 4.5 MB for a binary upload). Photo and video uploads go straight to Supabase Storage with signed URLs, so they are not affected.
- **Supabase free storage is 1 GB for everything** (photos, Gallery videos up to 50 MB each, rendered videos,
  voiceovers, music, designs). The app stops new uploads at `MEDIA_PLATFORM_MAX_BYTES` (900 MB) and each company's
  Gallery videos at `MEDIA_COMPANY_VIDEO_MAX_BYTES` (100 MB); with videos, a few companies can fill it. Watch Admin,
  Health and Storage, and plan Supabase Pro before many clients upload videos.
- **Functions run in US East (Ohio).** Changing the region is a Pro feature. Supabase in `us-east-1` or `us-east-2` keeps database round trips short; visitors in Rwanda see about 250 ms of network distance to Ohio on each uncached request.
- **1 GB of memory per function** on the free plan. Enough for the JPEG conversion of a 4096 px photo.
- The shared cache for rendered designs and fonts (Netlify Cache API) is per region and emptied on every deploy.
- Scheduled functions only run on the published production deploy (not on deploy previews).

## 1. Create the Netlify account and site (once)

1. Sign up at netlify.com with GitHub (free plan, no card).
2. Add new project, Import an existing project, GitHub, authorise Netlify for the BuPulse repository, pick it. Netlify detects Next.js. Leave the build settings as they are (`netlify.toml` sets them) and create the site.
3. **Stop Netlify's own builds:** Project configuration, Build & deploy, Continuous deployment, Build settings, Configure, **Stop builds**. Deploys come from GitHub Actions only, so migrations always run first and a push does not cost two deploys. (Netlify may already have made a first deploy; that is fine.)
4. Note the **Site ID**: Project configuration, General, Project details, "Project ID".
5. Create a **personal access token**: User settings (your avatar), Applications, Personal access tokens, New access token, "BuPulse deploys", choose an expiry and put a reminder in the calendar.

## 2. Environment variables (Netlify)

Project configuration, Environment variables, Add a variable. Scope "All scopes" (builds and functions) unless noted;
mark secret ones "Contains secret values". Changing a variable needs a new deploy to reach the functions. `.env.example`
lists every variable, empty, grouped and commented; this is where each one goes in production.

**Checked on every deploy** (`scripts/check-env.mjs`, run by `deploy-netlify.yml` before `npm ci`): the build values
in the workflow, then the runtime variables' names read from Netlify's API with the deploy token (secret values cannot
be read, so only their presence). It prints names and problems only, never a value, and stops the deploy on a missing
required variable or a development switch. Locally, with a filled-in file:
`node --env-file=.env.production scripts/check-env.mjs --runtime` (formats too: https site address, 32-byte
`ENCRYPTION_KEY`, secrets of at least 32 characters, numbers, the WhatsApp number).

Required (the deploy stops without them):

| Name | Where | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Netlify **and** GitHub variable | `https://bupulse.com` (or the `*.netlify.app` URL until the domain moves) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Netlify **and** GitHub variables | Supabase, Project Settings, API |
| `DATABASE_URL` | Netlify | **Transaction pooler** string (port **6543**). Each function instance holds its own small pool (3 connections; `DATABASE_POOL_MAX` changes it). |
| `DIRECT_URL` | GitHub secret only | Session connection (port 5432), for the migrations |
| `SUPABASE_SECRET_KEY` | Netlify | `sb_secret_...`: server Storage work (Gallery videos, voiceovers, music, purges) |
| `ENCRYPTION_KEY`, `API_KEY_PEPPER` | Netlify | 32 random bytes each. **The same values as on Cloudflare** if you move, or stored tokens and API keys stop working |
| `CRON_SECRET` | Netlify and GitHub secret | Long random string, the same in both |
| `ADMIN_EMAILS` | Netlify | `admin@bupulse.com` |
| `AI_TEXT_PROVIDER` and its key (`GEMINI_API_KEY` or `ANTHROPIC_API_KEY`) | Netlify | `gemini` or `claude`. Gemini also makes the AI designs and photos |
| `RESEND_API_KEY` | Netlify | Resend (sign-in links, reminders, invoices) |

Recommended (the feature switches off without it; the check warns):

| Name | Default when empty | What it does |
| --- | --- | --- |
| `AI_MONTHLY_BUDGET_USD` | built-in (Admin, AI calls and spend can override) | Cap on BuPulse's whole AI spend a month; 30 at launch |
| `AI_COMPANY_MONTHLY_USD` | 3 | Each company's monthly AI allowance in USD |
| `WIDGET_AI_SHARE` | 0.5 | Share of that allowance the website chat may use |
| `MEDIA_PLATFORM_MAX_BYTES` | 900 MB | Shared storage guard (Supabase free: 1 GB in all) |
| `MEDIA_COMPANY_VIDEO_MAX_BYTES` | 100 MB | Each company's Gallery videos (`docs/MEDIA.md`) |
| `ELEVENLABS_API_KEY` | off | Voiceovers and Generate a track (`docs/VOICE_AND_MUSIC.md`), server-only |
| `VIDEO_ROBOT_SECRET` | robot off | The video robot (`docs/VIDEO_ROBOT.md`); the same value as the GitHub secret |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | button hidden | Chat on WhatsApp (international format). Also a GitHub variable (build value) |
| `RESEND_FROM` | built-in sender | e.g. `BuPulse <hello@bupulse.com>` |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | rate limits only | Sign-up and chat bot protection |
| `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` | link and .ics only | Demo bookings in Google Calendar |
| `GITHUB_REPO`, `GITHUB_TOKEN` | "Not connected" | Admin, Settings, Updates (`docs/UPDATES.md`). Scope: Functions |

Set as needed: `PLATFORM` (`netlify`; also a build value, the workflow sets it), `GEO_PROVIDER` (`builtin`),
`GOOGLE_MAPS_API_KEY`, the social apps (`FACEBOOK_*`, `INSTAGRAM_*`, `META_APP_SECRET`, `LINKEDIN_*`, `TIKTOK_*`,
`GOOGLE_YOUTUBE_*`), Paddle (`BILLING_PROVIDER`, `PADDLE_*`), Canva (`CANVA_*`), imports (`GOOGLE_PICKER_*`,
`GOOGLE_CLIENT_ID`, `DROPBOX_APP_KEY`, `SHOPIFY_*`), the model names (`GEMINI_*_MODEL`, `CLAUDE_*`,
`CHEAP_TEXT_MODEL`, `WIDGET_MODEL`, `ELEVENLABS_MODEL`), `BILLING_SIGNING_SECRET`, `ENCRYPTION_KEY_ID`,
`DB_SIZE_LIMIT_MB`, `MCP_ALLOWED_ORIGINS`, `DATABASE_POOL_MAX`, `AWS_LAMBDA_JS_RUNTIME` (optional, `nodejs24.x` pins the
functions' Node; Netlify UI only).

Never in production: `ANALYTICS_DEV_COUNTRY`, `REGION_OVERRIDE` (the check refuses them). `PLATFORM_CHECK=1` only for
the 10-minute check in section 7 (the check warns while it is set).

GitHub only (section 3): `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`, `DIRECT_URL`, `CRON_SECRET`, `VIDEO_ROBOT_SECRET`
(secrets); `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`NEXT_PUBLIC_WHATSAPP_NUMBER`, `ROBOT_APP_URL`, `DEPLOY_TARGET` (variables). Not needed on Netlify: `HYPERDRIVE`
(Cloudflare only).

## 3. GitHub (once)

Settings of the repository:

- **Environments, `production`**, environment secrets: `NETLIFY_AUTH_TOKEN` (the token from step 1.5), `NETLIFY_SITE_ID` (step 1.4), `DIRECT_URL` (already there for Cloudflare). Environment variables: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (already there) and `NEXT_PUBLIC_WHATSAPP_NUMBER` (new in 2.0: without it the production build has no WhatsApp button, whatever Netlify says). Keep "Required reviewers" and "Deployment branches: main" as in `docs/UPDATES.md`.
- **Video robot (optional, `docs/VIDEO_ROBOT.md`)**: repository secret `VIDEO_ROBOT_SECRET` (same value as in Netlify) and repository variable `ROBOT_APP_URL` (the site, e.g. `https://bupulse.com`). Without them `video-robot.yml` skips quietly. Videos are never rendered in a Netlify function (60 s): the robot renders them on GitHub's runner and only calls short API routes.
- **Secrets and variables, Actions, Variables (repository variable)**: `DEPLOY_TARGET` = `netlify`. From now on a push to `main` runs `deploy-netlify.yml` and skips `deploy.yml`. Delete the variable (or set `cloudflare`) to go back.

## 4. Deploying

- Automatic: a push to `main` runs `.github/workflows/deploy-netlify.yml`: checks the ref, `npm ci`, `prisma generate`, **`prisma migrate deploy` with `DIRECT_URL`** (a failed migration stops everything), then two steps (Netlify CLI 27.12.0): `netlify build --offline --context production` builds with `netlify.toml` on GitHub's runner **without the Netlify token** (the build runs npm packages and the Next.js runtime plugin, third-party code), and `netlify deploy --no-build --prod` uploads that result (`.next`, the functions and edge functions under `.netlify/`) as the production deploy with `NETLIFY_AUTH_TOKEN`. `--offline` means the build reads nothing from Netlify: **build-time values (the `NEXT_PUBLIC_*` ones, `BUILD_SHA`) must be GitHub variables in the workflow, not Netlify UI variables**; runtime secrets stay in Netlify. `BUILD_SHA` is the commit, as on Cloudflare. Every third-party action in the workflows is pinned to a full commit SHA (the version in a comment; update both together) and checkouts keep no GitHub token (`persist-credentials: false`).
- From the admin console: Settings, Updates, Install (the same workflow; the console picks `deploy-netlify.yml` because it runs on Netlify; `DEPLOY_TARGET=cloudflare` in the Netlify environment would make it start `deploy.yml` instead).
- **Rollback:** Settings, Updates, Roll back (or Run workflow with `action: rollback`) runs `scripts/netlify-rollback.mjs`, which asks Netlify's API to publish the production deploy before the live one again (`POST /api/v1/sites/{site}/deploys/{deploy}/restore`). It is live within seconds and costs no credits. Each rollback goes one deploy further back; to return to a newer one, install it again or use Netlify: Deploys, pick the deploy, Publish deploy. **Database migrations are never rolled back** (`docs/UPDATES.md`).
- By hand from your machine (needs `npx netlify login` once and a `.env` with the build values): `npx prisma migrate deploy --config prisma7.config.ts`, then `npx netlify-cli@27.12.0 build --offline --context production` and `npx netlify-cli@27.12.0 deploy --no-build --prod --site <SITE_ID>`.
- Try the Netlify build locally without deploying: `npx netlify-cli@27.12.0 build --offline`.

## 5. Domain and DNS (Cloudflare stays the DNS provider)

The domain's DNS can stay at Cloudflare. In Netlify: Domain management, Add a domain, `bupulse.com` (and `www.bupulse.com`). Netlify shows the records; in Cloudflare DNS:

- `bupulse.com`: `A` record to Netlify's load balancer address shown by Netlify (or a `CNAME` to `<site>.netlify.app`, which Cloudflare flattens at the apex).
- `www`: `CNAME` to `<site>.netlify.app`.
- **Proxy status: DNS only (grey cloud)** for both. Recommended, for three reasons:
  1. Netlify then sees the visitor directly, so `x-nf-geo` (country, used for prices on `/pricing` and analytics) and `x-nf-client-connection-ip` (rate limits, admin key allow-lists) are the visitor's. Behind Cloudflare's proxy (orange cloud) Netlify would see Cloudflare's servers instead: every visitor would share a handful of IP addresses (and their rate limits), and the country would be that of the Cloudflare data centre.
  2. On Netlify the app **ignores Cloudflare's `cf-ipcountry` and `cf-connecting-ip`**: anyone can send those headers straight to the `*.netlify.app` address, so trusting them would let a visitor pick their country or dodge rate limits. With the orange cloud they would be ignored anyway.
  3. Netlify issues the HTTPS certificate (Let's Encrypt) itself; a proxy in front gets in the way of the certificate check and of Netlify's CDN caching.
- Then in Netlify: HTTPS, Verify DNS configuration, Provision certificate. Set `NEXT_PUBLIC_SITE_URL` to `https://bupulse.com` and deploy again.
- Email records (Resend, `docs/EMAIL_SETUP.md`) and anything else in Cloudflare DNS stay as they are.

If BuPulse moves back to Cloudflare Workers, the Worker route takes the domain again and the proxy (orange cloud) comes back by itself.

## 6. Scheduled jobs

`netlify/functions/cron-*.mts` are deployed with the site and start by themselves on the published deploy. The video
robot is not one of them: it runs on GitHub Actions every 15 minutes (`video-robot.yml`) and calls `/api/robot/*`. Same jobs and schedules as the Worker (UTC):

| Function | Schedule | Route |
| --- | --- | --- |
| `cron-publish` | every 5 minutes (every minute on Cloudflare) | `/api/cron/publish` |
| `cron-metrics` | hourly at :23 | `/api/cron/metrics` |
| `cron-autopilot` | every 3 hours on Fri and Sat at :11 | `/api/cron/autopilot` (cursor calls) |
| `cron-leads-digest` | hourly at :37 | `/api/cron/leads-digest` |
| `cron-store-sync` | daily 03:47 | `/api/cron/store-sync` (cursor calls) |
| `cron-analytics-rollup` | daily 02:17 | `/api/cron/analytics-rollup` (cursor calls) |
| `cron-plan-price-changes` | daily 04:29 | `/api/cron/plan-price-changes` (cursor calls) |
| `cron-momo-renewals` | daily 05:41 | `/api/cron/momo-renewals` (cursor calls) |
| `cron-trial-reminders` | hourly at :53 | `/api/cron/trial-reminders` |
| `cron-media-cleanup` | daily 03:19 | `/api/cron/media-cleanup` |
| `cron-content-summary` | hourly :07 | `/api/cron/content-summary` (cursor calls) |

How a run works: the scheduled function (30 s limit) posts `{ path }` with `Authorization: Bearer $CRON_SECRET` to `/.netlify/functions/cron-runner-background`; Netlify answers 202 and runs that background function (15 minutes), which checks the secret and that the path is one of the jobs above, then calls the route on the site's own URL with the same bearer token. `purge-accounts` and `social-refresh` keep running from GitHub Actions as before.

Check them in Netlify: Logs & metrics, Functions, `cron-publish` (each run logs) and `cron-runner-background` (`[cron] /api/cron/publish: {...}` lines). "Run now" on a scheduled function starts it by hand. By hand from anywhere: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://bupulse.com/api/cron/publish`.

## 7. Checks after the first deploy

1. Open the site, sign in, open `/dashboard` (the edge function refreshes the session).
2. `/pricing` from Rwanda shows RWF prices (country from `x-nf-geo`). From elsewhere, the catch-all region.
3. Admin, Settings, Updates shows "Netlify site", the version and the runs of `deploy-netlify.yml`.
4. Schedule a post for Instagram with a PNG design a few minutes ahead (it goes out within 5 minutes of that time): it is converted to JPEG (WebAssembly codecs read from the function bundle) and published.
5. Netlify, Logs, Functions: `cron-runner-background` lines every 5 minutes (and hourly ones).
6. After a week: Usage & billing, credits used (see the limits above).
7. Netlify, Logs, Functions, `___netlify-server-handler`: no `[platform] production resolved to plain Node` error (that would mean the host was not detected; set `PLATFORM=netlify`).

### Header check (country, IP, spoofing)

Set `PLATFORM_CHECK=1` in Netlify's environment variables and deploy (or do this right after the first deploy, before the domain moves). `GET /api/platform/check` then answers what the app reads for your own request. Remove the variable afterwards (the route answers 404 without it).

```
SITE=https://bupulse.com   # or https://<site>.netlify.app

# 1. Netlify's geo header reaches the app: your real country and your public IP (compare with https://ifconfig.me).
curl -s $SITE/api/platform/check
# {"platform":"netlify","country":"RW","ip":"<your IP>"}

# 2. Spoofed headers are ignored or overwritten: the answer must be the same as in 1.
curl -s $SITE/api/platform/check \
  -H "x-nf-geo: $(printf '{"country":{"code":"US"}}' | base64)" \
  -H "x-country: US" -H "cf-ipcountry: US" \
  -H "x-nf-client-connection-ip: 203.0.113.9" -H "x-forwarded-for: 203.0.113.9" -H "cf-connecting-ip: 203.0.113.9"

# 3. The same through the netlify.app address (bypassing the custom domain) gives the same result.
curl -s https://<site>.netlify.app/api/platform/check -H "x-nf-geo: $(printf '{"country":{"code":"US"}}' | base64)"
```

If 2 shows `US` or `203.0.113.9`, Netlify passed a visitor's header through: stop and report it (pricing by region and rate limits would be spoofable). If 1 shows `"country":null`, Netlify's geo header does not reach the app: visitors get the catch-all region until it is fixed (`/pricing` shows it too: RWF from Rwanda, the catch-all prices from elsewhere).

## Switching back to Cloudflare

Delete the GitHub variable `DEPLOY_TARGET` (or set it to `cloudflare`), put the domain back on the Worker (`docs/DEPLOY.md`, Domains) and push. Nothing in the code has to change: on Cloudflare the platform layer (`lib/platform/`) uses Hyperdrive, `ctx.waitUntil`, `caches.default`, `cf-ipcountry` and `cf-connecting-ip` exactly as before.

## Where the code is

- `lib/platform/`: the platform layer (host detection, `waitUntil`, shared cache, database connection, visitor country and IP, time budgets). `PLATFORM=netlify|cloudflare|node` forces a host; otherwise it is detected.
- `netlify.toml`: build command, Node 24, the pinned Next.js runtime, functions directory, cache headers of `public/` scripts.
- `netlify/functions/`, `netlify/lib/cron.ts`: the scheduled jobs and their runner.
- `.github/workflows/deploy-netlify.yml`, `scripts/netlify-rollback.mjs`: deploy and rollback.
- `lib/admin/deploy-host.ts`: which workflow the Updates screen starts.

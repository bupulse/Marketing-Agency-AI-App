# Deploying BuPulse

BuPulse runs on Cloudflare Workers (through OpenNext). The database is Supabase Postgres, reached through Cloudflare Hyperdrive. These steps are done once by the owner; after that GitHub deploys every push to `main`.

## 1. One-time Cloudflare setup

1. Log in: `npx wrangler login`
2. Create the Hyperdrive config. Use the Supabase **session pooler** connection string (Supabase: Connect, then Session pooler, port 5432), the same style as `DIRECT_URL`:

   ```
   npx wrangler hyperdrive create bupulse-db --connection-string="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
   ```

3. Copy the `id` it prints into `wrangler.jsonc`, replacing `TODO_HYPERDRIVE_CONFIG_ID`.
4. Run `npm run cf-typegen` after any change to `wrangler.jsonc`.

## 2. Runtime secrets (stored in Cloudflare, never in git)

Set each one with `npx wrangler secret put NAME` (it asks for the value):

| Name | What it is |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable (anon) key |
| `NEXT_PUBLIC_SITE_URL` | Public site URL, e.g. `https://bupulse.com` |
| `ENCRYPTION_KEY` | 32 random bytes, base64: `openssl rand -base64 32` |
| `AI_TEXT_PROVIDER` | `gemini` or `claude` |
| `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL` | Gemini settings |
| `GOOGLE_MAPS_API_KEY` | Optional. Address search on the Brand page and onboarding (Places API (New) only, see `docs/BUSINESS_INFO.md`). Without it the address boxes are plain text. |
| `ANTHROPIC_API_KEY`, `CLAUDE_TEXT_MODEL`, `CLAUDE_EFFORT` | Claude settings |

`DATABASE_URL` is not needed on Cloudflare: the app uses the Hyperdrive binding there.
The `NEXT_PUBLIC_*` values are also needed at build time (see the GitHub variables below), because Next.js bakes them into the browser code.

## 3. GitHub settings (Settings, Secrets and variables, Actions)

Secrets:

- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with the "Edit Cloudflare Workers" template
- `CLOUDFLARE_ACCOUNT_ID`: shown on the Cloudflare dashboard sidebar
- `DIRECT_URL`: Supabase direct/session connection string (port 5432), used to run migrations

Variables (not secret, they end up in the browser anyway):

- `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## 4. Deploying

- **Before the plan builder migration (`20261009095000_plan_builder`) reaches production, take a database backup.** It converts `Subscription.plan` from an enum to text and drops `PlanLimitOverride` and the `Plan` enum; see `docs/PLANS.md`.
- Automatic: every push to `main` runs `.github/workflows/deploy.yml`, which applies database migrations (`prisma migrate deploy`) and then deploys. If a migration fails, nothing is deployed. The job runs in the GitHub environment `production`; add required reviewers there to approve each deploy by hand.
- From the admin console: Settings, Updates installs a chosen release or rolls the Worker back through the same workflow (`docs/UPDATES.md`).
- CI (`.github/workflows/ci.yml`) runs lint, type check, tests, build and the browser smoke test on every pull request.
- Manual, from your machine (needs `wrangler login` and a `.env` with the build-time values): `npm run deploy`
- Try the Workers build locally: `npm run preview`

## 5. Domains (later)

When ready, in `wrangler.jsonc` add:

```jsonc
"routes": [{ "pattern": "bupulse.com", "custom_domain": true }]
```

The domain's DNS must be on Cloudflare. For staging, create a second worker (copy `wrangler.jsonc` to an environment named `staging` with its own name, Hyperdrive config and `staging.bupulse.com` route) and deploy it with `--env staging`. Each environment has its own secrets (`wrangler secret put NAME --env staging`) and should point at the staging Supabase project.

## Known notes

- Bundle size: the Worker is about 4.7 MiB gzipped. The free Workers plan allows 3 MiB, so production needs the Workers Paid plan (10 MiB limit).
- `pg-cloudflare` is pinned to 1.3.0 in `package.json` (`overrides`) because 1.4.1 is published without the files the bundler needs. Remove the pin once a fixed version ships.
- `proxy.ts` runs as Node.js middleware, which OpenNext marks experimental on Cloudflare. Check sign-in and the `/dashboard` redirect on staging.

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

How the Cloudflare trigger is wired: `wrangler.jsonc` points `main` at `worker.ts`, a small worker that re-exports the one OpenNext generates (`.open-next/worker.js`) and adds a `scheduled` handler. The handler calls the app's own routes through the `WORKER_SELF_REFERENCE` binding with `Authorization: Bearer $CRON_SECRET`. The crons are listed under `triggers.crons`; if you change the metrics schedule, change `METRICS_CRON` in `worker.ts` too. Cron Triggers deploy with the Worker (`npm run deploy`), nothing else to switch on.

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

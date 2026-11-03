# Deploying BuPulse on Google Cloud Run (free tier)

**Why.** Owner decision, 3 November 2026: Netlify's free credits ran out, and the Cloudflare Worker is over Workers' 10 MB bundle limit. Cloud Run runs the same Next.js app as a container, with request-based billing, inside Google's monthly free tier. The Netlify (`docs/DEPLOY_NETLIFY.md`) and Cloudflare (`docs/DEPLOY.md`) setups are untouched; `npm run build` still builds for Netlify.

What runs where on Cloud Run:

| Part | On Cloud Run |
| --- | --- |
| Pages, API routes, server actions, `proxy.ts` | One container: Next.js standalone server (`Dockerfile`, `next.config.ts` with `BUILD_TARGET=cloudrun`), Node 24, linux/amd64 |
| Static files (`public/`, `_next/static`) | Served by the same container; keep Cloudflare's proxy in front so they come from Cloudflare's cache (section 6) |
| Image builds | Cloud Build from source (`cloudbuild.yaml`), images in Artifact Registry |
| Scheduled jobs | ONE Cloud Scheduler job calls `POST /api/cron/tick` every minute; the tick runs the jobs due that minute from `worker-crons.ts` (the same schedules as Cloudflare, UTC), publisher every minute (section 5) |
| Database | Supabase through `DATABASE_URL` (the 6543 transaction pooler), no Hyperdrive |
| Visitor country / IP | Behind Cloudflare's proxy: `cf-ipcountry` / `cf-connecting-ip`, trusted only when the connecting address is one of Cloudflare's published ranges. Direct to Cloud Run: the last `x-forwarded-for` hop (the one Google's front end adds), and **no country** (the catch-all region). `lib/platform/headers.ts` |
| Host detection | `K_SERVICE` (Cloud Run sets it) or `PLATFORM=cloudrun`; Admin, Settings, Updates shows "Cloud Run service" |
| Deploys, rollback | By hand with `gcloud` (section 4). `.github/workflows/deploy-cloudrun.yml` is not written yet, so Updates' Install and Roll back buttons answer that GitHub cannot find it |

## Free tier (read this first)

Cloud Run (request-based billing, us-central1) is free up to, each month: **2 million requests, 180,000 vCPU-seconds, 360,000 GiB-seconds**, and **1 GiB of outbound data from North America**. Cloud Scheduler: **3 jobs** free per billing account. Cloud Build: **2,500 build-minutes** a month on the default machine. Artifact Registry: **0.5 GB** storage. Over these, Google charges, so set the budget alert in step 1.6 first. Google changes these numbers now and then: check https://cloud.google.com/free before relying on them.

With request-based billing an instance is only charged while it handles requests, and its CPU is throttled the moment a response is sent. So:

- The tick (1,440 calls a day) is the biggest steady cost: at about 2 s each that is roughly 86,000 vCPU-seconds and 86,000 GiB-seconds a month at 1 vCPU / 1 GiB, under half the free tier. Long jobs (Autopilot on Fridays and Saturdays, the analytics roll-up) add to it; watch "Billable container instance time" in the Cloud Run metrics after the first week.
- Work left running after a response gets almost no CPU. `keepAlive` (`lib/platform/background.ts`) therefore waits for its work before answering on Cloud Run (up to 10 s), as on Netlify. The few places that use a bare `waitUntil` (staff heartbeat write, the AI ledger's late write, the support push to agents) still run after the response and may be slowed until the next request reaches that instance. Do not switch to instance-based billing ("CPU always allocated") to fix this: with a tick every minute the instance would never go idle and leave the free tier.
- Egress: 1 GiB a month is about 10,000 HTML pages. Static files must come from Cloudflare's cache (section 6), and big uploads from the app (videos posted to TikTok or YouTube) count as egress too. Over 1 GiB, Google charges per GiB (about $0.12, check the current price list).

## 1. One-time setup

Install the Google Cloud CLI on the Mac (`brew install --cask google-cloud-sdk`), then:

```bash
gcloud auth login
# 1.1 Project (the ID must be unique worldwide) and billing (free tier needs a billing account; nothing is charged within it)
gcloud projects create bupulse-prod --name="BuPulse"
gcloud config set project bupulse-prod
gcloud billing accounts list
gcloud billing projects link bupulse-prod --billing-account=XXXXXX-XXXXXX-XXXXXX
gcloud config set run/region us-central1

# 1.2 APIs
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com

# 1.3 Image repository, keeping only the newest 2 images (the free 0.5 GB holds about two)
gcloud artifacts repositories create bupulse --repository-format=docker --location=us-central1
cat > /tmp/ar-policy.json <<'EOF'
[{"name":"keep-2","action":{"type":"Keep"},"mostRecentVersions":{"keepCount":2}},
 {"name":"delete-rest","action":{"type":"Delete"},"condition":{"tagState":"any"}}]
EOF
gcloud artifacts repositories set-cleanup-policies bupulse --location=us-central1 --policy=/tmp/ar-policy.json --no-dry-run

# 1.4 The service's own identity (no roles needed: it only serves the app)
gcloud iam service-accounts create bupulse-run --display-name="BuPulse Cloud Run"

# 1.5 Cloud Build pushes to Artifact Registry with the project's default build service account. If the first build
#     fails with a permission error on Artifact Registry, give that account (named in the error) the writer role:
#     gcloud projects add-iam-policy-binding bupulse-prod --member=serviceAccount:<account> --role=roles/artifactregistry.writer

# 1.6 Budget alert at $1 (Billing, Budgets & alerts in the console does the same)
gcloud billing budgets create --billing-account=XXXXXX-XXXXXX-XXXXXX --display-name="BuPulse $1" \
  --budget-amount=1USD --threshold-rule=percent=0.5 --threshold-rule=percent=1.0
```

## 2. Environment variables

Cloud Run environment variables are free (Secret Manager is not needed; it charges per secret version). Take Netlify's production values, without printing them:

```bash
cd ~/BuPulse   # the repository
npx netlify-cli env:list --json --context production | node scripts/cloudrun-env.mjs ~/bupulse-cloudrun.env.yaml
```

`scripts/cloudrun-env.mjs` writes `NAME: "value"` lines (mode 600, and only outside the repository), prints names only, drops what only Netlify uses or Cloud Run sets itself (`NETLIFY_*`, `URL`, `PORT`, `PLATFORM`, `DEPLOY_TARGET`, `AUTOPILOT_NETLIFY_AI_PICTURES`, `BUILD_SHA`, and `DIRECT_URL`, which only the migrations need), adds `PLATFORM=cloudrun`, and runs the same checks as `scripts/check-env.mjs`. `DATABASE_URL` stays the 6543 pooler. If it lists values Netlify did not reveal, add those lines by hand. Check that `NEXT_PUBLIC_SITE_URL` is `https://bupulse.com`. Delete the file after the deploy (`rm ~/bupulse-cloudrun.env.yaml`); later changes are made with `gcloud run services update bupulse --update-env-vars NAME=value`.

`DATABASE_POOL_MAX` (1 to 20) sets the connections per instance; pg's default of 10 times 3 instances fits Supabase's pooler.

## 3. Database migrations

Cloud Run does not run migrations. Before deploying code with new migrations, run them from the Mac with the direct connection (as the GitHub deploy workflows do):

```bash
DIRECT_URL='<Supabase direct or session connection>' npx prisma migrate deploy --config prisma7.config.ts
```

## 4. Deploy

From a clean checkout of the commit to deploy:

```bash
SHA=$(git rev-parse HEAD)
# 4.1 Build the image on Cloud Build (uploads the folder minus .gcloudignore: no .env file, no node_modules)
gcloud builds submit --config cloudbuild.yaml --region us-central1 \
  --substitutions=_SITE_URL=https://bupulse.com,_SUPABASE_URL=https://<project>.supabase.co,_SUPABASE_KEY=<publishable key>,_WHATSAPP=<number or empty>,_BUILD_SHA=$SHA

# 4.2 Deploy it (the first time with the env file; later deploys keep the variables, so drop --env-vars-file)
gcloud run deploy bupulse \
  --image us-central1-docker.pkg.dev/bupulse-prod/bupulse/app:$SHA \
  --region us-central1 --service-account bupulse-run@bupulse-prod.iam.gserviceaccount.com \
  --allow-unauthenticated --port 8080 \
  --cpu 1 --memory 1Gi --concurrency 40 --min-instances 0 --max-instances 3 \
  --timeout 3600 --cpu-throttling --execution-environment gen2 \
  --env-vars-file ~/bupulse-cloudrun.env.yaml
```

- `--cpu-throttling` is request-based billing (the free-tier mode); `--min-instances 0` means no idle charges, and a cold start of a few seconds after a quiet spell (the tick every minute mostly keeps one instance warm, at no cost while idle).
- `--timeout 3600` applies to the whole service (Cloud Run has no per-route timeout); the tick needs it, and normal pages answer in seconds anyway.
- The `_SUPABASE_KEY` and the other substitutions are public values (they are in the browser's JavaScript). Never pass a secret as a substitution or build argument.
- Rollback: `gcloud run revisions list --service bupulse`, then `gcloud run services update-traffic bupulse --to-revisions=<previous revision>=100`. The next deploy needs `gcloud run services update-traffic bupulse --to-latest` to send traffic to new revisions again.

The service answers at `https://bupulse-<hash>-uc.a.run.app` (printed by the deploy). Check it before moving the domain (section 7).

## 5. Scheduled jobs (one Cloud Scheduler job)

```bash
RUN_URL=$(gcloud run services describe bupulse --region us-central1 --format='value(status.url)')
read -rs CRON_SECRET   # paste the CRON_SECRET value (not echoed)
gcloud scheduler jobs create http bupulse-tick --location us-central1 \
  --schedule="* * * * *" --time-zone="Etc/UTC" \
  --uri="$RUN_URL/api/cron/tick" --http-method=POST \
  --headers="Authorization=Bearer $CRON_SECRET" \
  --attempt-deadline=30m --max-retry-attempts=0
unset CRON_SECRET
```

How the tick works (`app/api/cron/tick/route.ts`, `lib/cron/tick.ts`, `lib/cron/schedule.ts`):

- It takes the minute from Cloud Scheduler's `X-CloudScheduler-ScheduleTime` (so a call that arrives a few seconds late still runs that minute's jobs), else the current minute, and runs every route in `worker-crons.ts` whose schedule matches (UTC), the publisher first.
- Each route is called on the container's own port (`http://127.0.0.1:$PORT`, so the calls are not extra requests and leave no egress) with the same `Authorization: Bearer $CRON_SECRET`; cursor routes are called again while they answer `nextCursor` (at most 40 calls, 10 minutes per job). Calls are awaited one after another inside the tick's request, because nothing gets CPU after the response.
- A failing job never stops the next one. No new call starts after 20 minutes, so a tick ends inside the 30-minute attempt deadline. The answer is always 200 with a JSON summary (`jobs: [{ path, ok, calls, ms, status, error? }]`, `skipped`), so Cloud Scheduler never retries a tick and re-runs jobs that succeeded. Failures are in the summary, the Cloud Run logs (`[cron] ...`) and Admin's cron runs.
- A tick that overlaps the next one (a long job) is fine: the routes are written to run twice at once, as on Cloudflare.
- The URI is the run.app address, so the tick does not go through Cloudflare (its bot rules never block Google).

Run one tick by hand: `gcloud scheduler jobs run bupulse-tick --location us-central1`, then read the logs: `gcloud run services logs read bupulse --region us-central1 --limit 50`.

Pause the other hosts' schedules when Cloud Run takes over, so the jobs do not run twice: Netlify's scheduled functions stop with the Netlify site; on GitHub, `publish-posts.yml` (the fallback publisher) is harmless (posts are claimed atomically).

## 6. Domain (bupulse.com) and Cloudflare

Keep Cloudflare as the DNS provider and its proxy (orange cloud) in front. It is what gives the visitor's country (`cf-ipcountry`, needed for Rwanda's prices; without it every visitor gets the catch-all region), and it serves the static files from its cache instead of Cloud Run's 1 GiB of egress.

1. Verify the domain once: `gcloud domains verify bupulse.com` (adds a TXT record in Cloudflare's DNS through Google Search Console).
2. Map it: `gcloud beta run domain-mappings create --service bupulse --domain bupulse.com --region us-central1` (also `www.bupulse.com` if used). The command prints the DNS records (A and AAAA for the apex, CNAME `ghs.googlehosted.com` for `www`).
3. In Cloudflare DNS replace the old records with those, **DNS only (grey cloud)** at first, and wait until `gcloud beta run domain-mappings describe --domain bupulse.com --region us-central1` shows the certificate ready (15 minutes to a few hours).
4. Then switch the records to **Proxied (orange cloud)**, with SSL/TLS mode **Full (strict)** (Google's certificate is valid). Certificate renewals keep working through the proxy (Google checks `/.well-known/acme-challenge/` on the domain); if a renewal ever fails, grey-cloud the records for an hour.
5. Cloudflare caches `/_next/static/*` (immutable, hashed names) and `public/` files by their extension by default. Add a Cache Rule (free plan) for **URI Path starts with `/_next/image`**: Eligible for cache, Edge TTL "use cache-control header if present", so optimised images are also served from the cache. Pages (HTML) are not cached: they are personal and marked `private`.

The app trusts `cf-*` headers only when the request's connecting address (the last `x-forwarded-for` hop, which Google's front end adds and a caller cannot change) is one of Cloudflare's published ranges (`lib/platform/cidr.ts`, from cloudflare.com/ips, checked 3 November 2026; update the list if Cloudflare adds ranges). Requests sent straight to the run.app address are served too, but get no country and their own address is used for rate limits.

## 7. Checks after the first deploy

Set `PLATFORM_CHECK=1` for ten minutes (`gcloud run services update bupulse --update-env-vars PLATFORM_CHECK=1`), then:

```bash
# 1. Through Cloudflare: your real country and public IP (compare with https://ifconfig.me).
curl -s https://bupulse.com/api/platform/check
# {"platform":"cloudrun","country":"RW","ip":"<your IP>"}
# 2. Forged headers change nothing: the same answer as in 1.
curl -s https://bupulse.com/api/platform/check -H 'cf-ipcountry: US' -H 'cf-connecting-ip: 1.2.3.4' -H 'x-forwarded-for: 1.2.3.4'
# 3. Straight to Cloud Run: your IP, no country, whatever is forged.
curl -s "$RUN_URL/api/platform/check" -H 'cf-ipcountry: US' -H 'cf-connecting-ip: 1.2.3.4' -H 'x-forwarded-for: 1.2.3.4'
# {"platform":"cloudrun","country":null,"ip":"<your IP>"}
```

Then remove it: `gcloud run services update bupulse --remove-env-vars PLATFORM_CHECK`. Also check: a sign-in, a page with images, Admin, Settings, Updates (shows "Cloud Run service" and the build's commit), and after a few minutes Admin's cron runs (publish every minute).

## What does not work (yet) on Cloud Run

- **Updates' Install and Roll back** need `.github/workflows/deploy-cloudrun.yml` (deploy with migrations, rollback by traffic), not written yet; deploy and roll back with section 4. The deploy-host entry (`lib/admin/deploy-host.ts`) already names that workflow and the `GCP_PROJECT_ID`, `GCP_SERVICE_ACCOUNT_KEY` and `DIRECT_URL` secrets it will use.
- **No shared cache** (`lib/platform/cache.ts`): Node has no Cache API, so rendered designs and fonts are cached per instance only (on its disk, emptied when the instance stops). Same as plain Node.
- **Next.js cache per instance**: with up to 3 instances each has its own ISR/data cache. The app renders its pages dynamically, so this only matters for `revalidateTag` calls, which reach one instance.
- **Background work after a response** is throttled (see Free tier).
- **Country without Cloudflare's proxy**: none; Cloud Run itself sends no geo header.

## Where the code is

| File | What |
| --- | --- |
| `Dockerfile`, `.dockerignore`, `.gcloudignore`, `cloudbuild.yaml` | The image and what goes into it |
| `next.config.ts` | `output: "standalone"` when `BUILD_TARGET=cloudrun` |
| `app/api/cron/tick/route.ts`, `lib/cron/tick.ts`, `lib/cron/schedule.ts` | The every-minute tick and the cron matching |
| `worker-crons.ts` | The schedules (shared with Cloudflare and checked against Netlify's) |
| `lib/platform/detect.ts`, `headers.ts`, `cidr.ts`, `background.ts`, `database.ts` | Host detection and the Cloud Run rules |
| `lib/admin/deploy-host.ts` | What Admin, Settings, Updates says about the host |
| `scripts/cloudrun-env.mjs` | Netlify variables to a Cloud Run env file |
| `tests/cron/tick.test.ts`, `tests/platform/cloudrun.test.ts`, `tests/cloudrun-env.test.ts` | Their tests |

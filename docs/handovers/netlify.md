# Handover: Netlify (free plan) hosting, Cloudflare kept switchable

Built 12 October 2026 on branch `v2-netlify` (worktree `~/BuPulse-v2-netlify`, from `v2`). Not pushed, not merged, nothing deployed, no Netlify site or account created, no database touched. Owner steps: `docs/DEPLOY_NETLIFY.md`.

## What changed

| Area | Change |
| --- | --- |
| Platform layer `lib/platform/` | `detect.ts` (`currentPlatform()`: `PLATFORM` env, then the build-time `BUPULSE_BUILD_PLATFORM` from `next.config.ts`, then the `Netlify` global, the `Cloudflare-Workers` user agent or OpenNext's context symbol, else `node`). `headers.ts` (`visitorCountry`: Cloudflare `cf-ipcountry`; Netlify `x-nf-geo` base64 JSON `country.code` only, missing = catch-all region; `clientIp` / `trustedClientIp`: `cf-connecting-ip` or `x-nf-client-connection-ip`, each host only trusting its own headers and never falling back to `x-forwarded-for` (null = shared "unknown" rate-limit bucket); only `node` keeps the `x-forwarded-for` fallback). In production, plain Node with `NETLIFY` or `LAMBDA_TASK_ROOT` set counts as Netlify, and production resolving to plain Node logs an error once. `background.ts` (`waitUntil`: Cloudflare `ctx.waitUntil`; Netlify through `Symbol.for("@next/request-context")`, which Netlify's Next runtime installs, then `Netlify.context.waitUntil`; else a detached promise, except on Netlify in production: `keepAlive` warns and the request awaits the work, at most 10 s. `runInBackground`, `trackEvent` and `queueWebhookEvent` now return that promise and every caller awaits it; it resolves at once when the host took the work). `cache.ts` (`caches.default` vs `caches.open("bupulse")`). `database.ts` (Hyperdrive per request on Cloudflare only; pool max 3 on Netlify, `DATABASE_POOL_MAX`). `limits.ts` (`timeBudget`, `hasShortRequestLimit`). |
| Callers moved onto it | `lib/db.ts`, `lib/leads/background.ts`, `lib/analytics/events.ts`, `app/api/canva/return/route.ts` (wait 15 s on Netlify), `lib/designs/edge-cache.ts`, `lib/region.ts`, `lib/analytics/collect.ts`, `lib/request-limits.ts`, `lib/admin/api-auth.ts` (allow-list uses the trusted header only), `lib/admin/console.ts`, `lib/widget/request.ts`, `app/api/geo/country`, `app/api/demo/ics/[token]`, `app/api/admin/google-calendar/callback`. No direct `getCloudflareContext`, `caches.default`, `cf-ipcountry` or `cf-connecting-ip` left outside `lib/platform/`. |
| Netlify 60 s limit | Publisher claims for 15 s (45 s elsewhere), Instagram container wait 25 s (3 min elsewhere; a timeout is a safe "temporary" retry), metrics 30 s, Autopilot 1 business per call, store sync 2 stores per call. Cloudflare values unchanged. |
| Wasm codecs | `lib/publishing/jpeg.ts` `resolveWasm` looks in `process.cwd()` then `LAMBDA_TASK_ROOT`; `next.config.ts` `outputFileTracingIncludes` adds `@jsquash/{png,jpeg,webp}/codec/**/*.wasm`. Verified in `.next/server/app/api/cron/publish/route.js.nft.json` and in the Netlify server function bundle (`node_modules/@jsquash/...` present). |
| Netlify config | `netlify.toml` (build: `prisma generate` + `next build`, `NODE_VERSION=24`, `PLATFORM=netlify`, pinned `@netlify/plugin-nextjs@5.16.2` also in devDependencies, functions dir `netlify/functions`, cache headers for `public/widget*.js`; page headers keep coming from `next.config.ts`). `.gitignore` and `eslint.config.mjs`: ignore `.netlify`. |
| Crons | `netlify/functions/cron-*.mts`: 9 scheduled functions, same UTC schedules and routes as `worker.ts` except the publisher, every 5 minutes on Netlify (owner decision, free credits; `NETLIFY_PUBLISH_EVERY_MINUTES`; the composer and calendar show "Posts go out within 5 minutes of the scheduled time." on Netlify via `ComposerContext.timingNote`; the claim already takes every post due up to now); each posts the job to `cron-runner-background.mts` (background, 15 min) which checks `CRON_SECRET` and an allow-list, then calls the route once or with cursors (40 calls, 13 min budget). Shared code `netlify/lib/cron.ts`. |
| Deploys | `.github/workflows/deploy-netlify.yml` (same ref checks, `production` environment and concurrency group as `deploy.yml`; migrations with `DIRECT_URL`, then `netlify-cli@27.12.0 build --offline` (no token) and `deploy --no-build --prod` (with the token, a separate step; v2 pre-launch review); rollback runs `scripts/netlify-rollback.mjs`, Netlify's restore deploy API). `deploy.yml` skips pushes when the repository variable `DEPLOY_TARGET` is `netlify`; `deploy-netlify.yml` only takes pushes when it is. |
| Admin Updates | `lib/admin/deploy-host.ts`: workflow, wording, audit target and secrets per host; chosen by the running platform, `DEPLOY_TARGET` overrides. `GitHubClient` uses the config's workflow file. Page and actions say "Worker" or "Netlify site". Audit target of a Netlify rollback: `netlify:site`. |
| Post-deploy check | `GET /api/platform/check` (404 unless `PLATFORM_CHECK=1`): platform, country and IP the app read for the caller; curl checklist for spoofed `x-nf-geo` / `x-country` / `x-forwarded-for` in `docs/DEPLOY_NETLIFY.md`. |
| Docs | `docs/DEPLOY_NETLIFY.md` (new), short notes in `docs/DEPLOY.md`, `docs/UPDATES.md`, `docs/REGIONS.md`; `.env.example` (`PLATFORM`, `DEPLOY_TARGET`, `DATABASE_POOL_MAX`). |

## Tests

New: `tests/platform/headers.test.ts` (x-nf-geo base64 / base64url / plain JSON / garbage / XX / T1, per-host country and IP, spoofed foreign headers ignored, detection), `tests/platform/runtime.test.ts` (waitUntil per host and fallbacks, cache, database, limits, runInBackground and trackEvent through the layer), `tests/netlify-crons.test.ts` (Netlify schedules and routes equal `worker.ts`, runner auth, allow-list, cursor loop, budget), `tests/netlify-rollback.test.ts`, `tests/publishing/jpeg-netlify.test.ts` (codecs traced, found from a function-shaped root, conversion without the Worker modules). Extended: `tests/admin/updates.test.ts`, `tests/admin/updates-github.test.ts`.

Results: `npx next typegen` ok, `npx tsc --noEmit` ok, `npm run lint` clean, `npx vitest run` 171 files passed (10 skipped, 2093 tests), `npx next build` ok, `npx netlify-cli@27.12.0 build --offline --context production` ok.

## Sizes (local offline Netlify build, macOS)

| Bundle | Size | Limit |
| --- | --- | --- |
| Server function `___netlify-server-handler` | 24.4 MB zipped, 72 MB unzipped (next 20 MB, sharp/@img 18 MB, Prisma 5.5 MB, @jsquash 1.5 MB, `.next` 22 MB) | Lambda: 50 MB zipped, 250 MB unzipped |
| Edge function (proxy.ts) | 2.8 MB eszip | 20 MB compressed |
| Each cron function | 0.34 MB zipped | same |

The sharp binaries were the macOS ones; GitHub's Linux runner bundles the Linux ones, of similar size.

## Free plan risks

- 300 credits a month, hard limit (all sites paused when spent). Production deploy 15 credits; compute 10 credits per GB-hour at a fixed 1 GB. The publisher every 5 minutes (3 invocations a run) is estimated at 12 to 50 credits a month (it would be 60 to 240 every minute). `publish-posts.yml`, `leads-digest.yml` and `autopilot.yml` skip their scheduled runs when `DEPLOY_TARGET=netlify` (manual runs still work; `tests/netlify-fallback-workflow.test.ts`). Also documented: deploy in batches. Paid fallback: Netlify Personal ($9, 1,000 credits, credit packs) or back to Cloudflare Workers Paid ($5).
- 60 s per request on every plan; long AI or image work in one request (Studio image generation, an Autopilot plan with several images) can still hit it. Not measured: needs a real deploy.
- Functions region fixed to US East (Ohio) on free.
- Not verified without a live site: that Netlify's Next runtime passes `x-nf-geo` and `x-nf-client-connection-ip` through to the Next server's request headers (it builds `context.geo` from them, and the code reads them from the request), and the real duration and cost of a cron run.

## Open points

- Owner: create the site, set the variables, `DEPLOY_TARGET=netlify`, DNS grey cloud (`docs/DEPLOY_NETLIFY.md`).
- `.github/workflows/publish-posts.yml` and the other fallbacks still call `https://bupulse.com`; they work for either host.
- `purge-accounts` and `social-refresh` stay on GitHub Actions on both hosts.

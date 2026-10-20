# Video Studio at studio.bupulse.com: the plan

Status: built and tested on the TEST database, not switched on (19 October 2026). Items 1 to 7, 10, 11, 12 (prepared)
and 14 are done; Premium 3D (9) is built and off for clients until the owner switches it on; Seedance (8) comes after
launch. "Going live" below is the owner's checklist.

The contract with the BuPulse side is `docs/VIDEO_STUDIO_SPLIT.md` (in the `videos-library` worktree). In short: a client
arrives from BuPulse with a one-use ticket, gets a studio session tied to their business, spends `videoCredits` through
`lib/usage.ts`, and every finished video is a `VideoJob` row plus a `MediaAsset`, as `lib/video-studio/library.ts` does
today.

## What the studio is today

A standalone Node server (`video-lab/server.ts`), bundled by esbuild (`scripts/video-lab/start.mjs`), for one owner on one Mac.
It keeps its own state in `video-lab/data/` (local wallet, job JSON files, MP4s, uploads, cut-outs, influencer portraits),
reads the TEST database directly with `pg` (`data-source.ts`, read-only), and lets any visitor see every business.
For clients, every one of those has to change: state moves to the shared database and Storage, and every request is
scoped to one business.

Already in `lib/` (shared with the app, so the studio reuses it instead of rewriting it): `lib/video-studio/jobs.ts`
(`designMotionJobs`, credits reserved first, refunds on failure, Claude through the API key only), `library.ts`
(`listStudioJobs`, `jobForDrawing`, `prepareJobVideo`, `saveJobVideo`, `openingLines`), `voice.ts` (`makeJobVoice`,
`VOICE_OVER_CREDITS`), `brief.ts`, `schedule.ts`, `sweep.ts`, `lib/media/service.ts`.

Not yet in `lib/`: `VideoJob` creation for **Seedance** and **Premium 3D** (only Motion exists), presenter and AI image
credits as `videoCredits`, and the studio's cut-out and influencer storage. These are build items (section 6).

## 1. Every route, today and tomorrow

Legend for "becomes":
- **Scoped**: the business comes from the session, never from the request. A request for another business's id is a 404.
- **Credits**: `consumeUsage(userId, "videoCredits", n)` before the work, `refundUsage` on failure (as `jobs.ts` does).
- **VideoJob**: a row through `lib/video-studio/jobs.ts` (new `designPremiumJob` and `submitSeedanceJob` added there by the
  video-engine agent; the library session may not touch these files).
- **MP4**: `prepareUploads` / `finalizeUpload` (Motion: the browser uploads to a signed URL, then `saveJobVideo`;
  Seedance and Premium: the server uploads with the admin Storage client, then `finalizeUpload`).
- **Owner only**: behind `STUDIO_PASSWORD` (the owner door), a 404 for clients.
- **Removed**: not in the client studio.

### Pages and static files

| Route | Reads or writes today | Becomes |
| --- | --- | --- |
| `GET /`, `/create`, `/showcase`, `/videos`, `/pricing`, `/guide`, `/api-docs`, `/app/video/*`, `/app/image/*`, model pages, `notfound` | Static HTML from `.build/pages` | Same files. A session is required (client or owner). `/showcase` and `/videos` show the business's own jobs. `/pricing` shows the plan's credits and links "Buy credits" to `https://bupulse.com/dashboard/billing`. `/api-docs` and `/guide`: guide stays, `/api-docs` is removed for clients (no public API). |
| `GET /viral`, `/api/viral`, `/viral/frames/...` | Research JSONL in git, frames in `video-lab/data/viral` (other people's screenshots) | **Owner only.** The frames must never be served to clients or published, and they are not on the server. Clients get no `/viral` page or nav link. |
| `GET /lab`, `/app.js` | Developer lab page | **Removed** for clients; owner only. |
| `GET /site.css`, `/js/*.js`, `/static/*`, `/fonts/video/*` | Build output, brand fonts | Unchanged, public (no session needed so the sign-in redirect page can style itself). |
| `GET /login`, `POST /login`, `GET /logout` | `STUDIO_PASSWORD` cookie (`gate.ts`) | `/login` stays as the **owner door** at an unlisted path. `/logout` clears the studio session. New `GET /auth/bupulse` (section 2). |
| REDIRECTS (`/templates`, `/explore`, ...) | Redirect table | Unchanged. |

### Money, options and reading data

| Route | Reads or writes today | Becomes |
| --- | --- | --- |
| `GET /api/wallet` | Local `video-lab/data` wallet | **Credits**: `getUsageSummary(userId)` videoCredits left. Read only. |
| `POST /api/wallet/topup` | Adds free test credits | **Removed** for clients (top-ups are MoMo on BuPulse). Owner only for testing, against a test business. |
| `GET /api/pricing` | Constants (`credits.ts`, `CREDIT_PACKS`) | Constants stay; packs replaced by a link to BuPulse billing. |
| `POST /api/quote` | Constants | Unchanged (pure arithmetic), plus "you have N credits". |
| `GET /api/options` | Templates, models, `spentToday()`, `claudeMode()`, `seedanceReady()` | Without `spentUsd`, `capUsd` and `claudeMode` for clients (never show the cost cap or the subscription notice). `seedanceReady` and Blender status stay. |
| `GET /api/businesses` | Lists **every** business in the database | **Removed.** Replaced by `GET /api/session` (the signed-in business name, plan, credits). The business picker disappears from Create. |
| `GET /api/products?business=` | `data-source.listProducts(any id)` | **Scoped**: the session's business only; the query parameter is ignored. |
| `GET /api/photo/<id>`, `?cutout=1` | `photoJpeg(assetId, max, businessId?)` from Storage, cached on disk; `up-` ids from local uploads | **Scoped**: the asset must belong to the session's business (check `MediaAsset.businessId`). Disk cache is keyed by business and asset. Upload ids become `MediaAsset` ids (see `/api/upload`). |
| `GET /api/cutouts` | Folder listing of `video-lab/data/cutouts` | Cut-outs cached in Storage under the business (`studio/cutouts/<businessId>/<assetId>.png`), listed for the session's business only. |
| `GET /api/music`, `/api/music/<id>` | Music library via `data-source` | Same, through `lib/video-studio/library.ts` `studioTracks()` (licence-checked tracks only). Public read for signed-in users. |
| `GET /api/hooks`, `/api/first-comment`, `/api/plan` | Brain functions on a brief built from the DB | **Scoped**: business from the session; call `openingLines` for hooks. Free. |
| `GET /api/template-previews` | Local example videos | Static examples, same for everyone (read only). |
| `POST /api/template-previews` | Spends Claude money making examples | **Owner only** (it is an admin task). |

### Making things (the paid routes)

| Route | Reads or writes today | Becomes |
| --- | --- | --- |
| `POST /api/design` (Motion) | `design()`: local wallet `charge`, local `LabJob` JSON, daily USD cap | **Credits** + **VideoJob** (`engine: "motion"`) via `designMotionJobs(owner, input)`. The USD cap becomes the plan's credits and `withLedger` (already inside `jobs.ts`). API key only. |
| `POST /api/sample` | Free sample design | Owner only (a test tool). |
| `GET /api/jobs` | Local jobs, spend today | **VideoJob** list via `listStudioJobs(businessId)`; no spend figures. |
| `GET/PUT /api/jobs/<id>`, `/spec` | Local job JSON | **VideoJob** (`spec` column), scoped by `businessId`. The id format changes to a cuid. |
| `POST /api/jobs/<id>/reshape` | Free child job from the stored spec | **VideoJob** child (`parentId`), free (no credits), scoped. |
| `POST /api/jobs/<id>/voice` | Local `charge`, ElevenLabs, local mp3 cache | `makeJobVoice(owner, jobId)` (VoiceClip, credits reserved, sweep refunds). |
| `GET /api/voice/<hash>.mp3` | Local mp3 cache | Signed Storage URL of the `VoiceClip` (checked to belong to the business). |
| `POST /api/jobs/<id>/video` (browser MP4) | Writes `data/videos/<id>.mp4` | Two calls: `POST /api/jobs/<id>/video/prepare` (`prepareJobVideo`, gives a signed upload URL) and `POST /api/jobs/<id>/video/save` (`saveJobVideo`: counts the plan's videos, makes the `MediaAsset`, job becomes "ready"). **MP4.** |
| `GET /videos/<id>.mp4` | Local MP4, Range support | 302 to a short-lived signed Storage URL of `VideoJob.videoPath` (Storage serves Range itself). Scoped. |
| `POST /api/seedance/prompt`, `/plan`, `/check`, `GET /examples`, `/characters`, `/characters/<id>/portrait.png`, `GET /status` | Pure functions, the BytePlus connection check, mock examples | Unchanged (free, no business data). `/status` stays but the message hides keys and tells clients only "Seedance is on / in preview". |
| `POST /api/seedance/submit` | `submitSeedance`: local wallet, local job JSON, BytePlus task, preview mode without key | **Credits** + **VideoJob** (`engine: "seedance"`, `providerTaskId`, `storyboard` for previews). Credits reserved first and refunded by the poller on failure or cancel. Preview mode stays free. |
| `GET /api/seedance/jobs`, `/jobs/<id>`, `/preview`, `POST /cancel` | Local files; the server polls BytePlus | **VideoJob**, scoped. A poller (in the studio process, resumed on start like `resumeSeedanceJobs`) moves `submitted, queued, running` to `ready` and **uploads the MP4 to Storage** (**MP4**). |
| `GET /videos/seedance/<id>.mp4`, `-text.mp4` | Local files | Signed Storage URL. |
| `GET/POST /api/seedance/jobs/<id>/overlay`, `/overlay/video` ("Add BuPulse text") | Local overlay JSON and MP4 | Overlay `spec` on a child **VideoJob** (`mode: "overlay"` as `parentId`); the browser's MP4 goes through prepare/save as for Motion. |
| `POST /api/media`, `GET /api/media/<um-id>` (video/audio references) | `video-lab/data/media` (60 MB) | Storage under `studio/refs/<businessId>/`, a `MediaAsset` row (so the plan's media quota counts it), scoped. |
| `POST /api/upload` (reference photo) | Resized into `video-lab/data/uploads` | `prepareUploads` / `finalizeUpload` into the Gallery (client's own photos), id = `MediaAsset` id. |
| `GET /api/blender/status`, `/look` | Blender binary check (the Mac), pure look function | `status`: asks the render worker (section 5). `look`: unchanged. |
| `POST /api/blender/render` | Local queue (one render at a time), local wallet, local MP4 | **Credits** + **VideoJob** (`engine: "premium3d"`, `scene`, `quality`). The job is queued in the database; the machine with Blender claims it (render worker, section 5). **MP4** by the worker. |
| `GET /api/blender/jobs`, `/jobs/<id>` | Local job JSON | **VideoJob**, scoped. |
| `POST /api/blender/jobs/<id>/rerender` | Local child render, local wallet | **Credits** + child **VideoJob**. |
| `GET /videos/blender/<id>.mp4` | Local file | Signed Storage URL. |
| `GET /api/influencers`, portraits and shots | `video-lab/data/influencers`, shared by everyone | **Portraits** (the 10 fixed AI presenters) are shared studio assets in Storage, read by everyone; no per-client copies. **Shots** (presenter holding the client's product) are made with Gemini, charged `PRESENTER_IMAGE_CREDITS` (**Credits**), saved as a `MediaAsset` of that business (**Scoped**). |
| `POST /api/influencers/<id>/portrait` | Gemini image, local wallet | **Owner only** (makes the shared portraits once). |
| `GET /api/images`, `POST /api/image` (Nano Banana page) | Gemini, local wallet, local gallery file | **Credits** (`PRESENTER_IMAGE_CREDITS`), result saved as a `MediaAsset` in the Gallery, listed from `MediaAsset` for that business. No `VideoJob` (it is an image). Records go through `withLedger`. |

### Summary of the cut

- **Removed for clients:** `/api/businesses`, `/api/wallet/topup`, `/lab`, `/api-docs`, `/viral` and its API and frames,
  `POST /api/template-previews`, `POST /api/sample`, `POST /api/influencers/*/portrait`, spend figures, the
  subscription banner, the business picker.
- **Becomes `VideoJob`:** Motion design, reshape, Seedance submit and overlay, Premium 3D render and re-render.
- **Becomes `MediaAsset`:** every MP4, uploads, AI images, presenter shots, reference media.
- **Stays free and open to any signed-in client:** Seedance prompt, plan, check, examples, characters, hooks, first
  comment, plan-a-week, music list, look, quote.

## 2. Sessions

The studio never asks a client for a password.

1. **Arrive.** BuPulse sends `https://studio.bupulse.com/auth/bupulse?ticket=<token>&next=<path>`.
2. **Redeem.** The studio calls `redeemStudioTicket(token)` (assumed from `lib/video-studio/ticket.ts`, which does not
   exist in my worktree yet; it is the library session's file). Assumed result: `{ userId, businessId, companyUserId, role }`
   or `null`. A conditional update, so a second use returns `null`. The ticket is never logged. A `null` redirects to
   `https://bupulse.com/dashboard/video/open?next=<path>` (BuPulse then checks the plan and makes a new ticket).
3. **Cookie.** On success the studio sets `bp_studio_session`: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`
   (12 hours), value `base64url(JSON payload).base64url(HMAC-SHA256(payload, STUDIO_SESSION_SECRET))`. Payload:
   `{ v: 1, userId, businessId, companyUserId, role, iat, exp }`. Compared with `timingSafeEqual`; expiry checked on every
   request. No server-side session table: signing out is "clear the cookie", and a plan or permission change is caught
   because the job routes already check the feature, plan credits and `can(role, "content")` when they act (the same
   checks as `app/api/video/design/route.ts`). Rotating `STUDIO_SESSION_SECRET` signs everyone out.
4. **Redirect.** The browser lands on `next` after the cookie is set (`303`).
5. **`next` validation.** Only a path that starts with a single `/`, has no `//`, no backslash, no `:` before the first `/`,
   no control characters, at most 300 characters, and whose first segment is one of the studio's page routes. Anything else
   becomes `/create`. The same rule is used for `?next=` on `/login` (it exists today as `safeNext` in `gate.ts`; reuse it,
   extended with the route allow-list). Redirects only ever go to the studio's own origin, or to
   `${BUPULSE_URL}/dashboard/video/open` for the no-session case.
6. **No session.** A page request redirects (302) to `${BUPULSE_URL}/dashboard/video/open?next=<path>`. An `/api/` request
   answers `401 { error, signInUrl }`, and the browser script sends the person there (the page does not loop: the sign-in
   link opens in the same tab once).
7. **Owner door.** `STUDIO_PASSWORD` stays, but only for the owner: `/login` sets the existing `bp_studio` cookie, which
   unlocks the owner-only routes (viral, lab, template previews, portraits, topup) and uses a **test business** the owner
   chooses by cookie (the old business picker, owner only). A client session never unlocks an owner route, and the owner
   cookie never unlocks client data other than through that picker. The loopback shortcut in `gate.ts` (local requests need
   no password) is off in production (`STUDIO_ENV=production`).
8. **Headers.** Responses get `x-robots-tag: noindex`, `cache-control: private` on API answers, `referrer-policy: same-origin`.
   `frame-ancestors 'none'`, except the viral library's own embed iframes (which are outbound, not ancestors).
9. **Rate limits.** Ticket redemption and design routes go through the existing `rateLimit` (`lib/rate-limit.ts`), keyed by user.

## 3. Bundling (tested)

`lib/video-studio/*`, `lib/usage.ts`, `lib/db.ts`, `lib/media/service.ts` start with `import "server-only"`, which throws
outside Next. The studio is bundled by esbuild with `packages: "external"`.

**Experiment** (scratchpad only, nothing in the repo): a one-file entry importing `lib/db`, `lib/usage`,
`lib/video-studio/{jobs,library,voice}` and `lib/media/service`, bundled with esbuild, then run with the repo's `.env`
(TEST database): it printed the business count (14 rows) and showed every export is a function.

What it took, and what it needs in `start.mjs`:
1. `alias: { "server-only": "<an empty file>" }`. Works; the guard has nothing to protect in a Node server.
2. `packages: "external"` keeps Prisma (`@prisma/client/runtime/client`, `@prisma/adapter-pg`) and the other npm
   packages out of the bundle. `lib/generated/prisma` is ordinary TypeScript in the repo and is bundled; no extra loader was
   needed. So `node_modules` must exist next to the bundle in production (`npm ci --omit=dev`, plus a `prisma generate`
   at build time).
3. **One real failure, one fix.** `next/headers` (from `lib/supabase/server.ts`) and `next/og`, imported by other `lib`
   files, are CommonJS files without an export map entry, so Node's ESM loader says `Cannot find module .../next/og` and
   suggests `next/og.js`. A tiny esbuild plugin fixes it: resolve `^next/[a-z-]+$` to `next/<name>.js`, external. The
   modules load; calling `cookies()` would throw outside Next, which is fine because the studio never uses cookie-based
   Supabase clients (it uses `createAdminClient` and signed URLs).
4. The bundle pulled in more of the app than needed (1.8 MB, with `react`, `lucide-react`, `@opennextjs/cloudflare`,
   `libphonenumber-js` as external imports). They are `import`s the studio never runs, but they must be installable. If the
   install size matters, the cleaner fix is the library session splitting pure pieces out of `lib/media/service.ts`; not
   needed for the first deploy.
5. Env checks: `lib/db.ts` needs `DATABASE_URL`; `lib/admin/switch.ts` reads Admin → Services switches from the same
   database, so the owner's "Seedance off" switch works for the studio too.
6. The studio's own `pg` pool in `data-source.ts` goes away (Prisma replaces it); `loadSavedKeys` (keys saved in
   Admin → Services) is replaced by the app's `lib/admin/service-keys.ts` loader.

Do not run `next build` for the studio: it stays a plain Node process (`node video-lab/.build/server.mjs`).

## 4. Environment variables in production

Same database and Supabase as bupulse.com.

| Variable | Purpose | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Shared Postgres (Prisma, `VideoJob`, usage) | **The production project**, not the TEST one. `start.mjs` currently refuses anything but the TEST project: that guard becomes `STUDIO_ENV`-aware. |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Storage (gallery-videos bucket, signed URLs) | Secret key stays on the server; never sent to the browser. |
| `ENCRYPTION_KEY`, `ENCRYPTION_KEY_ID` | Decrypts keys saved in Admin → Services (`lib/crypto.ts`) | Must be the same as the app's. |
| `ANTHROPIC_API_KEY` | Claude designs (Motion, Premium 3D scenes) | **Required. The subscription transport (`claude-cli.ts`, `VIDEO_LAB_CLAUDE`) is disabled in production**: `STUDIO_ENV=production` makes `claudeMode()` always `"api"` and the studio refuses to start without the key. |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL` | Voice-over (also Admin → Services switch) | Optional: voice is hidden without it. |
| `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL` | AI images, presenter shots | Optional: hides those buttons. |
| `SEEDANCE_API_KEY`, `SEEDANCE_BASE_URL`, `SEEDANCE_MODEL`, `SEEDANCE_USD_PER_M_TOKENS`, `BYTEPLUS_ACCESS_KEY_ID`, `BYTEPLUS_SECRET_ACCESS_KEY` | Real Seedance video | Without the key the studio stays in free preview mode (the Rwanda launch can open before it arrives). |
| `BLENDER_BIN`, `BLENDER_TIMEOUT_MS` | Premium 3D | Only on the machine that renders. |
| `STUDIO_SESSION_SECRET` | Signs the client cookie | New, 32+ random bytes (hex). |
| `STUDIO_URL` | The studio's own public address (`https://studio.bupulse.com`) | Used for absolute links and the cookie's host check. (Today `STUDIO_PUBLIC_URL`.) |
| `BUPULSE_URL` | `https://bupulse.com`, for the sign-in redirect and the "Buy credits" link | New. |
| `STUDIO_PASSWORD` | The owner door | Kept. |
| `STUDIO_ENV` | `production` turns on: API-key Claude only, no loopback shortcut, production database | New. |
| `VIDEO_LAB_PORT` | Listening port (default 3100) | Bind to `127.0.0.1`; the tunnel or proxy reaches it. |
| `VIDEO_LAB_DAILY_USD` | Platform-wide daily Claude spend stop | Becomes a safety net across all clients, not a test wallet. |
| `VIDEO_LAB_START_CREDITS`, `VIDEO_LAB_MODEL` | Test wallet, model override | Wallet unused in production; model override optional. |
| `SEEDANCE_LAB_DIR` | Where Seedance mock files live | Test only. |
| `VIRAL_ROWS_DIR`, `VIRAL_FRAMES_DIR` | Viral library folders | Owner only; frames stay on the Mac, so unset on a server. |

## 5. Two hosting options (no decision here)

Common to both: the studio is one Node process, `node --env-file=<env file> video-lab/.build/server.mjs`, behind HTTPS at
`studio.bupulse.com`; DNS record at the domain registrar; the same Supabase database and Storage.

### A. This Mac behind the Cloudflare tunnel (free)

Needs:
- A Cloudflare Tunnel to `127.0.0.1:3100`, DNS `studio.bupulse.com` as a proxied CNAME to the tunnel (the existing
  `video.bupulse.com` tunnel is the same setup; Cloudflare's free plan).
- A process manager so it restarts after a crash or reboot (`launchd` plist, `KeepAlive`), and the Mac set not to sleep
  (`caffeinate` or Energy settings), power adapter in, automatic login.
- A production `.env` file kept outside the repo.
- Premium 3D renders run where they are today (Blender on this Mac), with the same one-render-at-a-time queue, now fed
  from `VideoJob` rows.

Risks:
- **Availability:** the Mac off, asleep, rebooting for an update, or the home or office internet down means the studio is
  down for every client. Rwanda power and internet cuts count. No automatic failover.
- Upload and video bandwidth go over this Mac's connection (Seedance MP4s are downloaded then uploaded to Storage).
- Security: a client-facing server on the owner's own computer, next to the owner's other files and browser profiles.
  Mitigation: a dedicated macOS user, and the viral frames and keys kept out of that account's reach.
- One machine: Claude designs, Seedance polling and renders all share its CPU; Blender renders block everything else
  when running (30-minute limit already set).
- Fine for a pilot (a handful of paying clients); not for "every client, every day".

### B. A small VPS (paid)

Needs:
- A Linux VPS with 2 vCPU and 4 GB RAM is enough for everything except Blender (about 5 to 10 US dollars a month at the
  common providers; to be priced when chosen). Node 22, `caddy` or `nginx` for HTTPS (or the same Cloudflare proxy), a `systemd` unit
  with restart, `npm ci --omit=dev`, `prisma generate`, a deploy script (pull, build, restart), log rotation, backups of
  nothing important (all state is in the shared database and Storage), and a firewall that only opens 443 and SSH.
- Postgres connection from the VPS to the Supabase pooler (allowed by default).
- **Premium 3D on a render worker.** A VPS cannot run Blender well (no GPU, slow, and large). The worker is this Mac (or
  another computer) running a small loop: claim one `VideoJob` with `engine = "premium3d"` and `status = "queued"`
  (conditional update, so one machine takes it), render with Blender, upload the MP4 to Storage, finalise, mark "ready".
  It uses the same production `DATABASE_URL`, Supabase key and Blender; it needs no inbound connection (it only calls
  out), so no tunnel is needed for it. When the worker is off, Premium 3D jobs wait in the queue and the studio says "Premium 3D
  is queued, the render computer is offline" (the credits are only kept if the job is still unstarted after a time limit
  where the sweep refunds them).
- Optional later: a rented GPU or CPU render machine instead of the Mac.

Risks:
- Monthly cost, and someone has to do the updates and security patches on the server (or use a managed container host).
- Two places to keep in sync (server and render worker), and a queue that depends on the Mac being on for Premium 3D only.
- Deploys need a procedure (the signed-release flow used for the app does not cover the studio yet).
- Bandwidth: most providers include enough; Seedance downloads are small next to it.

Not decided: hosting. Both options need the same code changes (section 6); only items 12 and 13 differ.

## Build status (19 October 2026)

Items 1 to 4 are built (owner decisions: this Mac first, Premium 3D "coming soon" at launch, AI images and influencers in
the first release).
1. **Bundling:** `scripts/video-lab/start.mjs` (`server-only` alias, `next/<name>.js` plugin, `STUDIO_ENV`).
2. **Sessions:** `video-lab/session.ts`, `tickets.ts` (the real `redeemStudioTicket` and `studioBlock` from
   `lib/video-studio/ticket.ts`; `STUDIO_DEV_TICKETS=1` adds test tickets `dev-<businessId>`, never in production), the gate in
   `server.ts`. A person the studio is closed to (service off in Admin, no permission, no video credits) gets a plain page
   and no session; the same check runs before paid work. No session redirects to `BUPULSE_URL` (default
   `https://bupulse.com`) + `openStudioHref(next)`; the owner's door is `/login`.
3. **Scoping:** `video-lab/scope.ts`; check with `node --env-file=.env scripts/video-lab/qa-scope.mjs` against a studio started
   with `STUDIO_SESSION_SECRET` and `STUDIO_DEV_TICKETS=1` (30 checks). Until item 7, a client's uploads, AI images and
   presenter shots answer 503; Premium 3D answers "coming soon" while the `premium3d` service is off (item 9).
- **Item 8, Seedance as `VideoJob` (built 20 October 2026; real clips wait for the BytePlus key):**
  `lib/video-studio/seedance-jobs.ts` (`submitSeedanceJob`, `pollSeedanceJob`, `pollDueSeedanceJobs`,
  `startSeedancePoller`, `sweepSeedanceJobs`, `cancelSeedanceJob`, `createSeedancePreview`, `saveSeedanceOverlayJob`) and
  its studio side `video-lab/client-seedance.ts`.
  - **Submit:** credits are taken first (`seedanceCredits`). Then a `seedance` row is written ("submitting"), and the
    BytePlus task is created through the cost ledger (`withLedger`: the `seedance` switch and the platform cap), which
    makes the row "submitted" with `providerTaskId`, `nextPollAt` and `expiresAt` (BytePlus ends unfinished tasks after
    an hour and bills nothing).
  - **Polling:** the studio checks due rows every 10 s, only while the key is set. The rows are in the database, so it
    resumes by itself after a restart. Each check claims the job with a lease. When the clip is ready, the poller
    downloads the MP4 (BytePlus's own host only, at most 200 MB), uploads it into the Gallery's "Video Studio" folder and
    finalises it with `saveJobVideo` (engine "seedance"). The job is then "ready" in BuPulse's Videos library, the clip's
    real tokens go to the ledger (`recordAiCall`), and the clip does not use one of the plan's videos.
  - **Refunds:** a refused request, a failed or expired task, a download that keeps failing (5 tries), a cancel before
    the task starts, and the cron sweep (`sweepSeedanceJobs` in `/api/cron/video-jobs`) each give the credits back
    exactly once (`failOnce`, a conditional update). The sweep covers a submit that died before BytePlus answered, and
    a task past its expiry plus 5 minutes.
  - **Previews:** without the key, a submission is a free preview row ("preview", the storyboard, 0 credits), with the
    notice "Real video is coming soon". While the `seedance` switch is off, a client is refused before anything is
    charged.
  - **BuPulse's text:** the overlay is a child Motion job (`mode` "overlay", 0 credits), drawn and saved like any Motion
    MP4.
  - **The owner's door** keeps its local jobs (`video-lab/seedance-jobs.ts`).
  - **Viral recipes:** the prompt follows the recipe (`recipeForPrompt`, `seedanceRecipeText`; the quick plan takes
    its shots and camera), and the clip keeps it in `VideoJob.brief.recipe`.
  - **Schema:** no change (`VideoJob` already had `providerTaskId`, `nextPollAt`, `expiresAt`, `storyboard`).
  - **Tests:** `tests/video-studio/seedance-jobs.test.ts` and `tests/video-lab/client-seedance.test.ts` (BytePlus
    mocked: submit, queued, running, succeeded with the download, failed, no answer, resume, sweep, cancel, previews,
    switch off). Key day: `docs/SEEDANCE_KEY_DAY.md`.
- **Item 9, Premium 3D as `VideoJob` (built 19 October 2026, off for clients):** `lib/video-studio/premium-jobs.ts`
  (`startPremiumJob`, `rerenderPremiumJob`, `renderNextPremiumJob`, `startPremiumRenderLoop`, `recoverPremiumJobs`,
  `failPremiumOnce`) and its studio side `video-lab/client-premium.ts`. Credits reserved first (`PREMIUM_3D_CREDITS` 100
  at 540p, 150 at 720p), a `premium3d` row "designing", the scene designed through `ledgeredClaude` (the subscription on
  the test studio), then "queued"; this Mac's loop claims the oldest queued row (conditional update), renders it through
  the shared `oneRenderAtATime` (one Blender at a time, with the owner's own tests), uploads the MP4 into the Gallery's
  "Video Studio" folder and finalises it with `saveJobVideo` ("ready": BuPulse's Videos library shows it). A re-render is
  a child row (`PREMIUM_RERENDER_CREDITS` 70). Every failure refunds once. After a restart, a design that was running is
  failed and refunded and a render goes back in the queue once. No schema change (VideoJob already has `scene`,
  `quality`, `attempts`, `leaseUntil`). **Client switch:** the `premium3d` service in Admin -> Services, off until the
  owner switches it on; until then clients see "coming soon". Not yet for clients: the voice-over (music only). Tests:
  `tests/video-studio/premium-jobs.test.ts` (no Blender, no Claude).
4. **Credits:** `video-lab/credits.ts` takes a client's credits from the company owner's `videoCredits` (`consumeUsage`) and gives
   them back to the same place (`Payer`, kept on Seedance jobs so a background refund finds it); the owner keeps the local test
   wallet. `/api/wallet` shows the plan's credits left; "Buy credits" and Pricing link to `https://bupulse.com/dashboard/billing`.
   Not yet checked against a live paid account (the test database has only an ended trial): the charge and refund are
   covered by mocked tests, and the balance by the real plan data.
5. **Motion designs as `VideoJob`** (`video-lab/client-jobs.ts`): a client's `/api/design`, jobs, hand edits, re-shapes and
   voice-overs go through `lib/video-studio/jobs.ts` and `voice.ts`; the owner keeps the local jobs. For a client on the
   owner's test studio with no `ANTHROPIC_API_KEY`, the Claude subscription is used (never in production).
6. **Motion MP4 into the Gallery:** the browser sends the poster, then the MP4; the server uploads with the Gallery's signed
   target and `saveJobVideo` makes the job "ready" (video, poster, size, length, ratio, product, caption, hashtags). The
   studio's bundle aliases `lib/supabase/server` to `video-lab/supabase-server-stub.ts` (the admin Storage client), because
   `lib/media/service.ts` otherwise needs a signed-in person's cookies.
7. **Photos** (`video-lab/client-images.ts`): a client's uploads, AI images (Nano Banana) and presenter shots are photos in their
   Gallery ("Studio images" folder, the Gallery's checks and quota); AI images and presenter shots cost 15 credits from the
   plan, refunded when Gemini fails, through the cost ledger ("video-image"). Video and audio references (`um:`) wait for
   Seedance (item 8).
8. **Closed doors, hardening, going live (items 10 to 12):** `video-lab/scope.ts` lists every route and who may use it
   (`tests/video-lab/routes.test.ts` fails for a route without an entry; `node --env-file=.env scripts/video-lab/qa-routes.mjs`
   walks all of them as a visitor, a client and the owner). `STUDIO_ENV=production` means the API key only, no loopback
   shortcut, a startup check of every required variable (`video-lab/startup-check.ts`), security headers, hourly limits
   per company on designs, voice-overs, AI images and uploads, a general message instead of any internal error, and
   `/healthz`. The files to go live are prepared and switched off (next section).
9. **QA as a client (item 14):** `node --env-file=.env scripts/video-lab/qa-client.mjs` (a studio started with
   `STUDIO_SESSION_SECRET` and `STUDIO_DEV_TICKETS=1`; it uses the installed Chrome, which can make the MP4, and one Claude
   design). It checks every client page at 1440 and 390 px, a real design through the page (plan credits down by 35, a
   `VideoJob` row), a second business seeing nothing of it, a real in-browser MP4 saved to the Gallery with the `VideoJob`
   "ready" (video, poster, size, length, ratio, product, caption, hashtags: what BuPulse's library reads), playable by its
   owner only, and the phone drawer; it then removes its test data and gives the credits back (76 of 76 on 19 October).

## 6. Build list, in order

Sizes: S = under half a day, M = about a day, L = two to three days.

1. **Bundling fixes in `start.mjs`** (S). `server-only` alias, the `next/*.js` plugin, `STUDIO_ENV` switch for the TEST database
   guard, a build that includes `node_modules` instructions. Proof: the experiment above, run on the real server entry.
2. **Session module** `video-lab/session.ts` (M): signed cookie (12 h), `requireClient(req)`, `requireOwner(req)`, `next`
   validation, `/auth/bupulse`, the no-session redirect, `/api/session`, `/logout`, owner door kept. Unit tests next to
   `tests/video-lab/gate.test.ts` (tampered cookie, expired cookie, reused ticket, bad `next` values, owner cookie cannot
   open client data and the reverse). Needs `ticket.ts` from the library session (stub it until it lands).
3. **Scope every read** (M): replace `data-source.ts` business and product reads with Prisma filtered by the session's
   business; remove `/api/businesses`; photo, cut-out and upload ids checked against `MediaAsset.businessId`; the Create page
   loses its business picker. Test: a client asking for another business's product or photo gets 404.
4. **Credits through `lib/usage`** (S): replace `video-lab/credits.ts` calls with `consumeUsage` and `refundUsage`
   (`videoCredits`); `/api/wallet` shows the real balance; top-up route removed for clients; "Buy credits" and the Pricing page
   link to BuPulse billing.
5. **Motion designs as `VideoJob`** (M): `/api/design`, jobs list, spec edit, reshape, voice through
   `designMotionJobs`, `listStudioJobs`, `makeJobVoice`; `Create` page reads the new job shape (ids are cuids). The daily USD cap
   becomes the platform safety net.
6. **Motion MP4 into the Gallery** (M): prepare and save endpoints (`prepareJobVideo`, `saveJobVideo`); the browser encoder
   uploads straight to Storage; `/videos/<id>.mp4` redirects to a signed URL. This makes the first end-to-end loop: sign in
   from BuPulse, design, make MP4, see it in BuPulse's library.
7. **Uploads, references, AI images, presenter shots into `MediaAsset` and credits** (M): `/api/upload`, `/api/media`,
   `/api/image`, `/api/influencers/*/shot`; shared portraits in Storage; cut-outs cached under the business.
8. **Seedance as `VideoJob`** (L): `submitSeedanceJob` and the poller in `lib/video-studio/jobs.ts` (video-engine agent's
   file), credits reserved and refunded, previews kept free, MP4 uploaded to Storage and finalised, overlay as a child job,
   resume on restart. Also a sweep for `submitted` jobs that never finish (credits back).
9. **Premium 3D as `VideoJob`** (L): scene design through `ledgeredClaude`, queued job row, the render loop
   (`oneRenderAtATime`) reading rows, MP4 upload and finalise, re-render as a child job, `recoverPremiumJobs` reads the database.
10. **Remove or protect the owner-only routes** (S): viral, lab, previews generation, portraits, sample, topup behind
    `requireOwner`; nav link and footer links hidden for clients; `/api-docs` gone for clients.
11. **Production hardening** (M): `STUDIO_ENV=production` (API key only, no loopback shortcut, no subscription banner), startup
    check that every required variable is set, `x-robots-tag` and cache headers, `rateLimit` on design and ticket routes, no
    error stack or secret in responses, a health route `/healthz` (no auth, no data).
12. **Hosting, option A or B** (A: S, B: M): tunnel or VPS, process manager, DNS `studio.bupulse.com`, HTTPS check, a
    restart and reboot test.
13. **Render worker** (M, only for option B; for option A it is item 9): the claim loop on the Mac, offline notice, refund
    time limit.
14. **QA** (M): a QA crawl at 1440 and 390 px with a signed-in test business (ticket redeemed by a test helper), a second
    business to prove scoping, the credit balance before and after, a video appearing in BuPulse's Videos library, and the
    sign-out and expired-session paths. Extends `scripts/video-lab/qa-viral.mjs`'s approach; `docs/VIDEO_ENGINE.md` section
    "Studio pages and buttons" gets updated.

Rough total: about 3 to 4 weeks of focused work for one person, shorter if items 5 to 7 are split between agents. Items 1 to
6 give the first working loop (Motion videos only); Seedance (8) can wait for the key, and Premium 3D (9) can open later as
"coming soon" without blocking the launch.

## Going live (for the owner)

Everything below is prepared and switched OFF: nothing runs the tunnel or loads the launchd files until you do these
steps, in this order. The production studio is separate from your test studio: it uses its own port (3110), its own
keys file and the real BuPulse database, while the test studio (port 3100, `video.bupulse.com`) keeps working as it does now.

0. **Release BuPulse first (your go).** The live site and the live database need the studio's side before anything
   here can work: merge the `videos-library` and `video-engine` branches into `main`, push and deploy when you say go
   (the usual signed release), and check that production has run `prisma migrate deploy` with these migrations:
   `20261022100000_video_studio`, `20261023100000_video_job_sound`, `20261024100000_studio_tickets` and
   `20261024100500_studio_lockdown`. Without them the live database has no `VideoJob` or `StudioTicket` tables and
   bupulse.com has no "Open Video Studio" route, so every sign-in would fail.
1. **Put the studio's code where it will run.** The files below point at `/Users/macbook1/BuPulse-video`, the folder
   that holds the `video-engine` branch today. Once that branch is merged into the main BuPulse folder, change the folder
   in `tools/launchd/com.bupulse.studio.plist` (and the tunnel plist if you use it) to `/Users/macbook1/BuPulse` and run
   `npm install` there.
2. **Fill in the production keys file.** Copy `tools/launchd/studio.env.example` to `~/.bupulse/studio.env` (make the
   `.bupulse` folder first), fill in every value, then lock it with `chmod 600 ~/.bupulse/studio.env`. It is never in git.
   - `STUDIO_SESSION_SECRET`: make one with `openssl rand -hex 32`.
   - `STUDIO_PASSWORD`: your own password for the owner's door (`https://studio.bupulse.com/login`).
   - `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ENCRYPTION_KEY`: the same values the live BuPulse
     app uses (the production database, not the TEST one: the studio refuses the TEST one in production).
   - `ANTHROPIC_API_KEY`: required (the Claude subscription is never used online).
   - `ELEVENLABS_API_KEY`, `GEMINI_API_KEY`, `SEEDANCE_API_KEY`: optional; empty means voice-overs, AI images and
     presenter shots, or real Seedance video stay off. The studio opens fine without the Seedance key (free previews).
3. **Copy the presenters.** The ten AI presenters' portraits are files: copy `video-lab/data/influencers` from the test
   studio's folder into the same place in the folder the production studio runs from. (The example videos in the template
   gallery were made from test photos; online they show without pictures until you make new examples with a real business.)
4. **Try it once in a Terminal** (before any launchd file): `tools/bin/studio-run.sh`. It prints a list of anything missing
   and stops, or starts the studio on port 3110. Check `curl http://localhost:3110/healthz` answers `{"ok":true}`, then press
   Ctrl+C.
5. **Start the tunnel.** In a Terminal run `tools/bin/studio-tunnel.sh` and leave the window open. The first time it creates
   the tunnel `bupulse-studio` and the address `studio.bupulse.com` (it needs your Cloudflare login on this Mac, as the
   video tunnel does). Then `https://studio.bupulse.com/healthz` should answer `{"ok":true}` once the studio runs.
6. **Keep the studio running.** Install the launchd job so it starts at login and restarts if it stops:
   `cp tools/launchd/com.bupulse.studio.plist ~/Library/LaunchAgents/` then
   `launchctl load -w ~/Library/LaunchAgents/com.bupulse.studio.plist`. Its log is `~/Library/Logs/bupulse-studio.log`.
   Optional: the same for `com.bupulse.studio-tunnel.plist`, so the tunnel needs no open Terminal window.
7. **Keep the Mac awake and online.** System Settings: never sleep while plugged in, start up after a power cut, and
   log in automatically. If the Mac is off or offline, the studio is off for every client.
8. **Turn the "studio" service on** in BuPulse's Admin, under Services ("Video Studio"), with the address
   `https://studio.bupulse.com`. Until then BuPulse hides the "Open Video Studio" button.
9. **Sign in once from BuPulse** with a test client that has video credits: click "Open Video Studio". You should land on
   the studio's Create page already signed in, see your own products, and be able to make a Motion video. It then appears
   in BuPulse's Videos library.
10. **If something is wrong, switch off in this order:** turn the "studio" service off in Admin (new sign-ins stop at once),
    then `launchctl unload -w ~/Library/LaunchAgents/com.bupulse.studio.plist` and stop the tunnel window. Clients' videos
    stay safe in their Gallery.

What is not in the first release: Seedance real video (waits for the BytePlus key, free previews until then) and Premium 3D
("coming soon"). Both can be switched on later without any change for clients' existing videos.

### Owner checks to run (on TEST, before switching these on for clients)

These change shared TEST data (a service switch, a test business's credits), so they are yours to run; the code is built
and covered by mocked tests.
1. **Premium 3D for clients (item 9):** in Admin -> Services switch **Premium 3D (Blender)** on for TEST. Open the test
   studio as **E2E Starter Test** (it has 100 video credits), pick Premium 3D at **540p** and Generate. Expect: 100 credits
   taken, "Designing", "Waiting", "Rendering" (about 3 to 10 minutes on this Mac), then the clip in the drawer, in the
   Gallery's "Video Studio" folder and in BuPulse's Videos library. Switch it off again afterwards if clients should not
   see it yet.
2. **Veo AI clips for a client:** give a TEST business **230 video credits or more** and 1 monthly video, switch **Google
   Veo AI clips** on in Admin -> Services, then make a viral video with **3 AI clips** (about $0.60 of Veo). Expect: 230
   credits taken (35 + 195), "Making AI clip 1 of 3…", the three clips in the Gallery's "AI clips" folder, and the MP4
   saved as ready in the Videos library with no clip sound in it. Switch Veo off again if it should stay off.

## Questions for the owner

1. Which hosting option to start with (A to open sooner, B when clients depend on it every day)?
2. Does Premium 3D open at launch, or after Seedance and Motion are live?
3. Should clients keep AI images and the AI influencers in the first release, or only video?

## Owner decisions (19 October 2026)

1. **Hosting: this Mac first** (option A), behind a Cloudflare tunnel, with a process manager and the Mac kept awake.
   Move to a server when clients rely on it every day.
2. **Premium 3D opens after Motion is live.** At launch it shows as "coming soon"; build item 9 follows the first loop.
3. **AI images and AI influencers are in the first release** for clients, priced in video credits (presenter image 15),
   so build item 7 is part of the launch.

# Moving the Video Studio into the app

A plan a developer can follow to move the Video Studio from the lab (`video-lab/`, a local Node server on the Mac)
into BuPulse itself. Written 17 October 2026 from `prisma/schema.prisma`, `lib/usage.ts`, `lib/plans.ts`,
`docs/PLANS.md`, `lib/offers/shared.ts`, `lib/publishing/engine.ts`, `lib/visuals/post-media.ts`,
`lib/social/composio/networks.ts`, `lib/social/providers/*`, `lib/admin/service-catalog.ts`, `worker-crons.ts`,
`wrangler.jsonc`, `docs/VIDEO_ROBOT.md` and `video-lab/server.ts`. Nothing here is built yet. The engine code in
`lib/video-engine/` is already shared, and it moves as it is.

## Decisions taken on 17 October

Provisional; the owner may change them.

- **Video credits per plan, each month:**
  - TRIAL 50 (one Motion video with a voice-over: 35 + 15);
  - STARTER and STANDARD 100;
  - BUSINESS 500;
  - PRO (the top plan) 1,500;
  - other plans 0 until Admin → Plans sets them.
- **No roll-over:** unused credits do not roll over (the `UsageRecord` window resets monthly, as for the other
  metrics).
- **Presenter images** come out of video credits (15 each), not the AI image allowance.
- **Prices:** Motion 35 credits and voice-over 15 (`lib/video-engine/credits.ts`).
- **Built so far:**
  - `lib/video-engine/credits.ts` (task 1);
  - the models and migration `20261022100000_video_studio`, applied to the TEST database (task 2);
  - `PLAN_VIDEO_CREDITS` and the `videoCredits` metric in `lib/plans.ts` and `lib/usage.ts`.

## 0. THE CLAUDE KEY

**THE APP MUST CALL CLAUDE WITH `ANTHROPIC_API_KEY` ONLY. IT MUST NEVER USE THE SUBSCRIPTION TRANSPORT
(`video-lab/claude-cli.ts`, `subscriptionTransport`, the `claude -p` CLI). THE SUBSCRIPTION IS FOR THE OWNER'S OWN
TESTS IN THE LAB; RUNNING CLIENTS' VIDEOS ON IT IS NOT ALLOWED.**

- `designVideo` already defaults to the API transport when it is given `apiKey` (`lib/video-engine/designer.ts`).
  The app passes `process.env.ANTHROPIC_API_KEY` and nothing else.
- Nothing under `app/` or `lib/` may import `video-lab/claude-cli.ts`. A test should enforce this, for example by
  grepping the bundle's imports, like the existing route tests.
- When the key is missing, the routes answer 503 "Video design is paused" (the `claude` service switch, below). They
  never fall back to anything else.

## 1. Where things run

The app is a Cloudflare Worker (OpenNext, `wrangler.jsonc`):
- **CPU:** 120 s per invocation. Waiting on the network does not count.
- **Crons:** they may run up to 15 minutes (`worker-crons.ts`, every route listed in `wrangler.jsonc`, kept equal by
  `tests/worker-crons.test.ts`).
- **No sharp:** native modules such as `sharp` do not run there. Image work in the app uses `@jsquash` wasm
  (`lib/publishing/jpeg.ts`).
- **The video robot:** heavy browser work already has a pattern, a GitHub Actions job running headless Chrome that
  claims work over a small, secret API (`docs/VIDEO_ROBOT.md`, `app/api/robot/*`, `lib/visuals/robot.ts`).

| Work | Lab today | App |
| --- | --- | --- |
| Claude design (Motion, Premium 3D scene, Seedance prompt) | lab server, subscription or API | Route handler, API key only (about 30 to 60 s of waiting, little CPU). The job row is written first; a cron sweep retries a design whose request died |
| Motion MP4 (canvas + WebCodecs, `lib/video-engine/encode.ts`) | the owner's browser | **Still the browser.** Later, for Autopilot, the video robot gets a second page entry that runs `encode.ts` |
| Voice-over (ElevenLabs) | lab server, files in `video-lab/data/voice` | Route handler through `lib/ai/tts.ts`, reusing the `VoiceClip` table (same hash rule) and the `voice` feature |
| Seedance submit | lab server | Route handler (one `fetch` to BytePlus) |
| Seedance polling and download | `setTimeout` loop in the lab process | **A new cron** `/api/cron/video-jobs` every minute, plus BytePlus's `callback_url` webhook. The MP4 is streamed from BytePlus to Supabase Storage, never held whole |
| Premium 3D render (Blender) | the Mac, `video-lab/premium-jobs.ts` | **A render worker on the Mac** (or any box with Blender), polling the app the video-robot way: claim, render, upload, complete. Never in the Worker |
| Cut-outs (`lib/video-engine/cutout.ts`, sharp) | lab server | In the browser (port the pixel loop to canvas `ImageData`; it is plain arithmetic), saved next to the photo. Or on the render worker |
| Reference sizing for BytePlus (`video-lab/seedance-references.ts`, sharp) | inline base64 | **Signed Storage URLs**, so BytePlus downloads them: no base64, no 64 MB limit. Out-of-range shapes are padded with `@jsquash`, or refused with the reason |
| Preview cards of characters (sharp PNG) | lab server | Serve `previewCardSvg` as SVG (pure); no rendering needed |
| Credits wallet (`video-lab/data/wallet.json`) | a file | Plan allowance plus add-ons in `UsageRecord` (section 3) |
| Ledger (`ledger.jsonl`) | a file | `withLedger` and `AiCall`, like every AI call |

## 2. Database (draft migration, not in `prisma/migrations`)

Now built as **`prisma/migrations/20261022100000_video_studio/migration.sql`** (the SQL Prisma generates for the
models, plus the checks, RLS and an audited plan update with the credits decided above, instead of 0 for every plan).
The draft as first written: Like `20261015090000_content_visuals`, it only adds tables and columns, nothing
is rewritten, and RLS is on with no policies (the app uses Prisma only).

```sql
-- Video Studio in the app (docs/VIDEO_APP_INTEGRATION.md): one row per video the studio makes, and what each posted
-- video did. New tables and columns only: nothing existing is rewritten.

CREATE TABLE "VideoJob" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" UUID,                         -- who pressed Generate (null for Autopilot)
    "productId" TEXT,
    "campaignId" TEXT,
    "contentId" TEXT,                      -- GeneratedContent it belongs to, when made from a post
    "parentId" TEXT,                       -- the job an edit, extend, re-render or overlay came from
    "engine" TEXT NOT NULL,                -- motion | premium3d | seedance
    "mode" TEXT,                           -- reference | text | image | first-last | edit | extend
    "status" TEXT NOT NULL DEFAULT 'designing',
    "templateId" TEXT,
    "hookId" TEXT,
    "platform" TEXT,                       -- tiktok | instagram | facebook | youtube | null (any)
    "ratio" TEXT NOT NULL DEFAULT '9:16',
    "seconds" INTEGER NOT NULL,
    "quality" TEXT,                        -- 480p..1080p, 540p/720p, or "<tier> <resolution>" for Seedance
    "brief" JSONB NOT NULL,                -- DesignBrief / PromptBrief without image bytes (photos as Storage paths)
    "spec" JSONB,                          -- MotionSpec (Motion), or the overlay spec of a Seedance clip
    "scene" JSONB,                         -- BlenderScene (Premium 3D)
    "prompt" TEXT,                         -- the Seedance prompt as sent
    "references" JSONB NOT NULL DEFAULT '[]', -- what was sent: [{ name, label, path, role }]
    "providerTaskId" TEXT,                 -- BytePlus task id
    "storyboard" JSONB,                    -- a free preview's storyboard (no key yet)
    "caption" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "videoPath" TEXT,                      -- media bucket: video/<businessId>/<id>.mp4
    "posterPath" TEXT,
    "bytes" INTEGER NOT NULL DEFAULT 0,    -- counted toward the media quota
    "durationMs" INTEGER,
    "voiceClipId" TEXT,
    "credits" INTEGER NOT NULL DEFAULT 0,  -- video credits taken (0 for previews)
    "periodStart" TIMESTAMP(3),            -- the UsageRecord window they were taken from, for the refund
    "refundedAt" TIMESTAMP(3),
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0, -- provider cost (sum of its AiCall rows)
    "warnings" JSONB NOT NULL DEFAULT '[]', -- fact warnings (factcheck.ts)
    "score" JSONB,                         -- research score (brain scoreDesign / scoreSeedancePrompt)
    "captionScore" JSONB,                  -- brain scoreCaption
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),             -- design sweep, render worker or poller holding it
    "nextPollAt" TIMESTAMP(3),             -- Seedance: when the cron checks BytePlus next
    "expiresAt" TIMESTAMP(3),              -- Seedance: execution_expires_after (BytePlus ends it, unbilled)
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VideoJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VideoJob_engine_check" CHECK ("engine" IN ('motion', 'premium3d', 'seedance')),
    CONSTRAINT "VideoJob_status_check" CHECK ("status" IN ('designing', 'designed', 'rendering', 'submitted', 'queued', 'running', 'ready', 'failed', 'cancelled', 'preview', 'preview-ready')),
    CONSTRAINT "VideoJob_numbers_check" CHECK ("credits" >= 0 AND "bytes" >= 0 AND "seconds" BETWEEN 4 AND 30 AND "attempts" >= 0)
);

CREATE UNIQUE INDEX "VideoJob_providerTaskId_key" ON "VideoJob"("providerTaskId");
CREATE INDEX "VideoJob_businessId_createdAt_idx" ON "VideoJob"("businessId", "createdAt");
CREATE INDEX "VideoJob_status_nextPollAt_idx" ON "VideoJob"("status", "nextPollAt");
CREATE INDEX "VideoJob_engine_status_leaseUntil_idx" ON "VideoJob"("engine", "status", "leaseUntil");
CREATE INDEX "VideoJob_contentId_idx" ON "VideoJob"("contentId");

ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "GeneratedContent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "VideoJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_voiceClipId_fkey" FOREIGN KEY ("voiceClipId") REFERENCES "VoiceClip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoJob" ENABLE ROW LEVEL SECURITY;

-- What a posted video did, 24 hours and 7 days after it went out (lib/video-engine/brain/types.ts Outcome): the Brain
-- learns from these (docs/research/BRAIN.md, "Learning from our own results").
CREATE TABLE "VideoOutcome" (
    "id" TEXT NOT NULL,
    "videoJobId" TEXT NOT NULL,
    "postId" TEXT,
    "businessId" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "templateId" TEXT,
    "hookId" TEXT,
    "formatId" TEXT,
    "captionFormulaId" TEXT,
    "seconds" INTEGER NOT NULL,
    "language" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "stats24h" JSONB,                      -- OutcomeStats: views, reach, likes, comments, saves, shares
    "stats7d" JSONB,
    "source" TEXT NOT NULL DEFAULT 'bupulse',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VideoOutcome_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VideoOutcome_source_check" CHECK ("source" = 'bupulse')
);
CREATE UNIQUE INDEX "VideoOutcome_postId_key" ON "VideoOutcome"("postId");
CREATE INDEX "VideoOutcome_sector_platform_idx" ON "VideoOutcome"("sector", "platform");
CREATE INDEX "VideoOutcome_businessId_postedAt_idx" ON "VideoOutcome"("businessId", "postedAt");
ALTER TABLE "VideoOutcome" ADD CONSTRAINT "VideoOutcome_videoJobId_fkey" FOREIGN KEY ("videoJobId") REFERENCES "VideoJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoOutcome" ADD CONSTRAINT "VideoOutcome_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoOutcome" ADD CONSTRAINT "VideoOutcome_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoOutcome" ENABLE ROW LEVEL SECURITY;

-- Video credits used this month (lib/usage.ts metric "videoCredits"), next to the existing counters.
ALTER TABLE "UsageRecord" ADD COLUMN "videoCredits" INTEGER NOT NULL DEFAULT 0;

-- A product photo's cut-out (lib/video-engine/cutout.ts): the PNG next to it, the product's box, or why it cannot be cut.
ALTER TABLE "MediaAsset" ADD COLUMN "cutoutPath" TEXT, ADD COLUMN "cutoutBox" JSONB, ADD COLUMN "cutoutRefused" TEXT;

-- Plans: no video credits until the owner sets an allowance (Admin -> Plans).
UPDATE "PlanDefinition" SET "limits" = "limits" || '{"videoCredits": 0}'::jsonb WHERE NOT ("limits" ? 'videoCredits');
```

**Prisma:**
- **New models:** `VideoJob` and `VideoOutcome` with the same fields, with relations added on `Business`, `Product`,
  `Campaign`, `GeneratedContent`, `VoiceClip` and `Post` (back-relation arrays only).
- **New columns:** `UsageRecord.videoCredits Int @default(0)` and the three `MediaAsset` cut-out fields.
- **Status:** these stay as text with CHECK constraints, like `ContentVisual`, not Prisma enums, so adding a status
  later needs no enum migration.

## 3. Credits, plans and add-ons (`lib/usage.ts`, `lib/plans.ts`, `lib/offers/shared.ts`)

The lab sells credits (`video-lab/credits.ts`, 1 credit = 10 RWF). The app sells plans with monthly allowances and
add-ons, so the studio becomes one more metric:

1. **The metric:**
   - Add `"videoCredits"` to `UsageMetric` and `USAGE_METRICS` (`lib/plans.ts`).
   - Add `videoCredits: "videoCredits"` to `FIELD` (`lib/usage.ts`).
   - Plans carry `limits.videoCredits` (Admin → Plans).
   - `consumeUsage(userId, "videoCredits", credits)` before a design or submit, and `refundUsage(..., periodStart,
     credits)` when it fails. These are the same atomic conditional updates as today. The job keeps `credits` and
     `periodStart`, and `refundedAt` makes a refund happen once.
2. **Prices:** move the pricing functions to `lib/video-engine/credits.ts` (pure): `seedanceCredits`,
   `CLAUDE_VIDEO_CREDITS` (35, owner decision 17 October), `PREMIUM_3D_CREDITS` (100 / 150),
   `PREMIUM_RERENDER_CREDITS` (70), `VOICE_OVER_CREDITS` (15, owner decision 17 October), `PRESENTER_IMAGE_CREDITS`
   (15). The lab then imports them from there, so both always agree. The wallet stays lab-only.
3. **The existing `videos` count** (120 a month, 4 a day, slideshow content videos) stays as it is. A studio video
   also counts one `videos` and one day in `VideoDayUsage` when its MP4 is saved (`consumeDailyVideo`). Studio
   videos then share the plan's posting cadence; their cost is metered in credits.
4. **Add-ons:**
   - Add a block to `ADDONS`: `{ key: "block:videoCredits", kind: "block", metric: "videoCredits", blockSize: 1000,
     label: "+1,000 video credits" }`.
   - Add `"videoCredits"` to `OFFER_METRICS`. The price per region is set in Admin → Money → Add-on prices; the lab
     packs priced 1,000 credits at 10,000 RWF.
5. **Features** (`lib/features.ts`), both `coming_soon` until shipped:
   - `videoStudio` (Motion and Premium 3D): requires `video`; services `["claude"]`; metric `videoCredits`.
   - `aiVideo` (Seedance real video): requires `videoStudio`; services `["seedance"]`; metric `videoCredits`.
   - Gate pages with `featureGate`, routes with `featureErrorResponse`, and actions with `assertFeature`, as
     `docs/PLANS.md` describes.
6. **Owner decisions still open:**
   - How many credits each plan includes. For example, Business at 50,000 RWF with 500 credits (5,000 RWF of video)
     would cost about 2,000 to 2,600 RWF in providers at the mixes in `docs/AI_COSTS.md`, "Video".
   - Whether the trial gets a few credits.

## 4. Routes: lab → app

All under `app/api/video/` and session-scoped (the company of the signed-in user), not the lab's open
`businessId`. Every paid route checks the feature, the switch and the allowance before calling a provider, and
writes `AiCall` through `withLedger` with feature names `video-design`, `video-voice`, `video-seedance`,
`video-premium` and `video-image`.

| Lab route (`video-lab/server.ts`) | App route | Runs in | Notes |
| --- | --- | --- | --- |
| `POST /api/design` (Motion; modes edit and extend; versions) | `POST /api/video/design` | Route | Writes `VideoJob` (designing → designed); fact check, `score`, `captionScore`; credits per version |
| `POST /api/sample` | `POST /api/video/sample` | Route | Free hand-made design (`sample.ts`) |
| `GET /api/jobs`, `GET /api/jobs/<id>`, `/spec` | `GET /api/video/jobs`, `GET /api/video/jobs/<id>`, `PUT /api/video/jobs/<id>/spec` | Route | The owner's hand edit of a spec is free; `validateSpec` runs on save |
| `POST /api/jobs/<id>/voice` | `POST /api/video/jobs/<id>/voice` | Route | `lib/ai/tts.ts` and the `VoiceClip` reuse; 15 credits, given back for a reused take |
| `POST /api/jobs/<id>/video` (MP4 upload) | `POST /api/video/jobs/<id>/upload` then `/complete` | Route | Same shape as `prepareVideoUpload` / `finalizeVideo` (`lib/visuals/service.ts`): signed upload URL to the `media` bucket at `video/<businessId>/<jobId>.mp4`, the real length read, the media quota, `videos` and the day counted once |
| `POST /api/blender/render`, `/rerender`, `GET /api/blender/jobs*`, `/status` | `POST /api/video/premium`, `/api/video/premium/<id>/rerender`, `GET /api/video/premium/<id>` | Route + render worker | **Only when a render worker is registered** (its heartbeat in the last 10 minutes); otherwise Premium 3D is shown as unavailable. Worker API: `POST /api/robot/premium/claim`, `/complete`, `/fail` with `PREMIUM_ROBOT_SECRET`, leases on `leaseUntil`, exactly the video-robot rules |
| `POST /api/seedance/prompt`, `/plan`, `/check` | `POST /api/video/seedance/prompt`, `/plan`, `/check` | Route | `plan` and `check` are free and pure |
| `POST /api/seedance/submit` | `POST /api/video/seedance/submit` | Route | Credits, `checkSeedanceRequest` (errors refuse before paying), references as signed Storage URLs, `callback_url` set, `execution_expires_after` 3600 |
| `GET /api/seedance/jobs*`, `/cancel`, `/preview` | `GET /api/video/jobs?engine=seedance`, `POST /api/video/jobs/<id>/cancel`, `GET /api/video/jobs/<id>/preview` | Route | Previews only while the `seedance` key is missing (`seedanceMode`) |
| (polling loop) | `/api/cron/video-jobs` (new cron, every minute) and `POST /api/video/seedance/callback?token=…` | Cron + webhook | Due jobs (`nextPollAt`), at most 20 a run: read the task, stream a finished MP4 into Storage, record usage, refund failed or expired ones, retry stuck designs (lease over) |
| `GET /api/seedance/status` | `GET /api/video/seedance/status` | Route | `checkSeedanceConnection`, cached 5 minutes |
| `GET /api/seedance/examples` | `GET /api/video/seedance/examples` | Route | The example JSON shipped with the app (`video-lab/seedance-mock/examples/` moves to `lib/video-engine/examples/`) |
| `GET /api/seedance/characters` (+ preview portrait) | `GET /api/video/seedance/characters` | Route | `listCharacters`. The picks move from the lab's file to `AdminSetting` `seedance.characters` (Admin → Services → Seedance); the preview cards are served as SVG |
| Overlay step (site agent, next) | `POST /api/video/jobs/<id>/overlay` | Route + browser | Builds `seedanceOverlaySpec`; the browser draws the clip with BuPulse's text and uploads the result as a new job (`parentId` = the clip) |
| `GET /api/photo/<id>?cutout=1`, `GET /api/cutouts` | `POST /api/video/cutouts/<assetId>` (store) and the `MediaAsset` cut-out fields | Browser + route | The browser computes the cut-out (canvas port of `cutout.ts`) and uploads the PNG; the route records it |
| `POST /api/upload`, `POST /api/media`, `GET /api/media/<id>` | the Gallery (`MediaAsset`, `media` and `gallery-videos` buckets) | existing | No new route: references are gallery items |
| `GET /api/influencers`, `/portrait`, `/shot`, `POST /api/image` | `POST /api/video/presenters/...`, AI photos | Route | Gemini through the existing image provider and `aiPhotos`; 15 credits or the image allowance (decision) |
| `GET /api/music*` | the `MusicTrack` library (`lib/music`) | existing | |
| `GET/POST /api/template-previews` | static files in the public bucket, made once by a script | build time | |
| `POST /api/quote`, `GET /api/pricing`, `GET /api/wallet`, `POST /api/wallet/topup` | `POST /api/video/quote`; the usage summary (`getUsageSummary` gains `videoCredits`); Billing → Add features for packs | Route | No test top-ups in the app |
| `GET /api/showcase` | the company's video library page (`/dashboard/videos`) from `VideoJob` | Route | |
| `GET /api/options`, `/businesses`, `/products` | the existing session, business and product queries | existing | |

**Pages:**
- **Create:** `/dashboard/video` (Create), a Next.js port of `video-lab/site/client/create.ts`.
- **Library:** `/dashboard/videos`.
- **Before writing them:** read `node_modules/next/dist/docs/` first (AGENTS.md).

## 5. From a finished MP4 to a scheduled post (`lib/publishing/engine.ts`)

A studio video is a normal post with one video in `mediaPaths`:
1. "Schedule" in the drawer (or Autopilot) creates one `Post` per chosen account (shared `groupId`):
   - **Fields:** `format` and `mediaPaths` from `mediaForPost` with `video: job.videoPath` (a `POST` with the video on
     Instagram and Facebook, a `SCRIPT` reminder with the video on TikTok and YouTube), `text`: the caption for that network,
     `hashtags`: that network's set, `scheduledAt`, `productId` / `campaignId` from the job, `status: SCHEDULED`.
   - **The video's type:** the database trigger sets `mediaKind = "video"`.
   - **Gallery copy:** add a `MediaAsset` row (kind `video`, `video/mp4`, width, height, `durationMs`) so the publisher
     reads the real type and size. The engine already looks assets up by path and falls back to `guessMime(".mp4")`.
2. **Per network** (the rules already in the code):
   - **Instagram:** Reel, MP4 only, alone (`lib/social/providers/instagram.ts`, Composio `media_type: "REELS"`).
     Caption up to 2,200 characters and 30 hashtags; the Brain says 4 to 6.
   - **Facebook:** Page video, alone (`/videos`, Composio `FACEBOOK_CREATE_VIDEO_POST`); the Brain says 0 to 3
     hashtags.
   - **TikTok and YouTube:** BuPulse does not upload video to these through the API yet (`VIDEO_PUBLISH_NETWORKS`
     = Instagram and Facebook). Build each post's media and format with the existing `mediaForPost`
     (`lib/visuals/post-media.ts`): there a video becomes a `SCRIPT` post with the file attached, so at its time the
     publisher's `sendReminder` emails the owner the download link ("Your video", 7 days) and the caption, connected
     account or not. This is what content videos already do.
   - **LinkedIn:** BuPulse posts photos only there (`lib/social/composio/networks.ts`); do not offer it for a studio
     video, or send the same reminder.
   - **Lengths:** `videoFitsNetwork` / `NETWORK_VIDEO_MAX_MS` (Instagram 90 s, Facebook 240 s, Shorts 180 s). Studio
     videos are 30 s at most, so they always fit.
   - **Captions:** one per network, because the caption check differs by platform (length, hashtag count, Shorts'
     100-character title). Use the job's caption for its own platform, and for the others run the caption builder
     again (`seedanceOverlayCaption(brief with platform)`, or the designer's caption with the Brain's formula).
     `scoreCaption` must pass before scheduling.
3. **Outcomes:** when `saveSuccess` marks a studio post published, write a `VideoOutcome` (sector, platform,
   template, hook, format and caption formula from the job; `postedAt`). The metrics cron (`/api/cron/metrics`,
   hourly) fills `stats24h` after 24 hours and `stats7d` after 7 days from the latest `PostMetrics`. The Brain reads
   them for "learning from our own results".
4. **Keeping files:** the media cleanup cron deletes content video files 30 days after their posts went out. Studio
   videos stay while they are in the library and count toward the media quota (`bytes`); deleting a job deletes its
   files.

## 6. Admin → Services and costs (`lib/admin/service-catalog.ts`)

- **`claude`:**
  - Purpose: "Designs Motion and Premium 3D videos and writes Seedance prompts; alternative text model when
    AI_TEXT_PROVIDER=claude".
  - Features: add "Video Studio design".
  - When off: "Video design pauses with a friendly message; finished videos and posts are not affected".
  - The service test already checks `ANTHROPIC_API_KEY`.
- **`seedance`:**
  - Purpose: "Real video (Seedance 2.0) in the Video Studio".
  - Features: "AI video (real video)".
  - Optional env: add `BYTEPLUS_ACCESS_KEY_ID`, `BYTEPLUS_SECRET_ACCESS_KEY` (character listing),
    `SEEDANCE_USD_PER_M_TOKENS`, `SEEDANCE_CALLBACK_SECRET`.
  - When off: "Real video pauses: Generate shows the reason, jobs already at BytePlus finish and are saved".
  - The Test button already lists one task (`lib/admin/service-tests.ts`).
  - The character picks (asset IDs) are edited on this service's card.
- **`elevenlabs`:** add "Video Studio voice-overs" to its features.
- **New `premium-renderer` (not killable, like the video robot):** last heartbeat, last render, renders and failures in
  24 hours; Premium 3D is offered only while it is alive.
- **Costs:**
  - `AiCall` gets provider `byteplus` (map `byteplus` to `seedance` in `AI_PROVIDER_SERVICE`).
  - `lib/ai/pricing.ts` prices Seedance from tokens (`SEEDANCE_USD_PER_M_TOKENS`, $7 per million by default) and keeps
    the per-second estimate for display.
  - Admin → AI groups the `video-*` features.
  - Admin → Costs → Provider bills gains BytePlus.
  - The per-video table in `docs/AI_COSTS.md`, "Video" is the reference for the margins shown there.

## 7. Tasks, in order

Sizes: **S** up to half a day, **M** 1 to 2 days, **L** 3 to 5 days.

| # | Task | Size | Depends on |
| --- | --- | --- | --- |
| 1 | Move the pricing to `lib/video-engine/credits.ts` (pure), lab imports it; examples to `lib/video-engine/examples/` | S | |
| 2 | Migration `…_video_studio` (section 2), Prisma models, `prisma generate`; deploy the migration before the code | M | |
| 3 | `videoCredits` metric (plans, usage, usage summary, Billing → Usage), `block:videoCredits` add-on, features `videoStudio` and `aiVideo` (coming soon) | M | 2 |
| 4 | `withLedger` features and Seedance token pricing; Admin → Services entries (section 6); the test that nothing imports `claude-cli.ts` | S | 2 |
| 5 | Motion: `/api/video/design` (+ edit, extend, versions, sample), jobs routes, fact check and scores saved | L | 3, 4 |
| 6 | The Create page and library in the dashboard (port of `create.ts`: engines, pills, templates, platform, drawer, live preview with `draw.ts`) | L (largest) | 5 |
| 7 | MP4 upload and complete (Storage, usage, `MediaAsset`), voice-over route on `VoiceClip` | M | 5 |
| 8 | Seedance: submit with signed-URL references and `@jsquash` padding, the `video-jobs` cron (also in `worker-crons.ts` and `wrangler.jsonc`), the callback route, streaming download, refunds | L | 3, 4 |
| 9 | The overlay step for Seedance clips (needs the motion engine's `video` layer in `spec.ts`, `draw.ts`, `encode.ts`) | M | 7, 8 |
| 10 | Cut-outs in the browser (canvas port of `cutout.ts`) and their route | M | 6 |
| 11 | Premium 3D: routes, the render worker on the Mac (video-robot pattern), its Admin card | L | 5 |
| 12 | Scheduling from the drawer: posts per network with per-network captions, reminders for TikTok, YouTube and LinkedIn | M | 7 |
| 13 | `VideoOutcome` on publish and in the metrics cron | M | 12 |
| 14 | Characters in Admin (picks in `AdminSetting`), presenters and AI images on credits | S | 8 |
| 15 | Autopilot: Motion MP4s made by the video robot (a second page entry running `encode.ts`) | L | 7 |
| 16 | Tests (routes, cron, refunds, quotas, publishing) and docs: the guide page, `docs/VIDEO_ENGINE.md`, `docs/AI_COSTS.md` | M | all |

**The first useful release:**
- **What it contains:** tasks 1 to 8 and 12. Motion and Seedance with credits, the MP4 in the library, scheduling to
  Instagram and Facebook, and reminders elsewhere.
- **About:** 3 to 4 weeks for one developer.
- **Later:** Premium 3D, cut-outs, outcomes and Autopilot.

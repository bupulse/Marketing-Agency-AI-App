# Teardown: seedance2ai.io and Higgsfield (16 October 2026)

Why: before building BuPulse's AI video engine, learn how two products that already sell AI video work: what they
are built on, how a video is generated, how they price it, and what their marketing tools look like.

How: REA (reverse-engineering tool, v6.4.0) on the public pages only. A headless Google Chrome opened
`https://www.seedance2ai.io/` and `https://higgsfield.ai/` (home, `/pricing`, `/marketing-studio`). REA read the page
text and the JavaScript the sites send to every visitor, and analysed it statically. We did not log in, did not
generate anything, did not call their APIs and did not fetch anything that is not public. Script copies and REA
evidence are in the session scratchpad, not in the repo.

Legend: **Observed** = read in their page or shipped code. **Inferred** = our reading of what the code implies;
not confirmed by running it.

---

## 1. seedance2ai.io

### What it is

- **Observed:** not ByteDance. The footer says it "is an independent AI creation platform ... not affiliated with ...
  the developers of the AI models". It resells about 20 video models (Seedance 1.0 to 2.5, Seedance 2 Mini, Kling 2.6
  to 3, Veo 3, Sora 2, Wan 2.5 to 3, Grok, MiniMax "H3 Max") and image models (Seedream 5, Nano Banana, GPT Image),
  each at `/app/video/<model>`. Pages in 19 languages.
- **Observed:** sells credits. Packs from $3.99 for 200 credits to $2,499 for 180,000 (about $2.00 down to $1.39 per
  100 credits, credits valid 1 year). Subscriptions: annual plans cost about $0.77 to $1.24 per 100 credits. Stripe,
  plus PayPal plans in the config.

### How it is built (observed in the shipped code)

| Part | What they use |
| --- | --- |
| Web app | Next.js and React, hosted on Vercel |
| Login | Clerk |
| Database, cache | `DATABASE_URL` (SQL), Upstash Redis |
| Files | S3-compatible bucket served from `cdn.seedance2ai.io` (Cloudflare R2). Uploads go straight from the browser to storage with short-lived credentials (`/api/s3/sts/generation-batch`, at most 50 MB per file) |
| Payments | Stripe, PayPal |
| Email | Resend |
| Prompt helper | DeepSeek (`DEEPSEEK_API_KEY`), `/api/prompt-enhance`, costs the user 2 credits |
| Abuse control | Cloudflare Turnstile and FingerprintJS on the free tier, plus a free-quota queue (`/api/free-quota/queue`) |
| Analytics | Google Analytics, Microsoft Clarity, Umami, PostHog, LogSnag |

### Where the video actually comes from (observed)

Their server settings (the list of environment variables, accidentally bundled into public JavaScript) name every
upstream provider they can send a job to:

- **BytePlus ModelArk** (ByteDance's official API, international): `BYTEPLUS_ARK_*`, `SEEDANCE_OVERSEAS_API_KEY`.
- **Volcengine Ark** (ByteDance, China): `VOLCENGINE_ARK_*`, `SEEDANCE_API_REGION` = `cn` or `overseas`.
- **Kie.ai** (reseller API): `KIE_API_KEY`, `KIE_WEBHOOK_HMAC_KEY`. This is the **default** for several models
  (`SEEDREAM5_PROVIDER` and `SORA2_PROVIDER` both default to `kie`).
- **fal.ai** (`FAL_API_KEY`; Sora 2 model id `fal-ai/sora-2/text-to-video`), **aivideoapi.ai**, **apimart.ai**,
  **Wangsu** (a CDN company's Seedance endpoint), **maxapi.ai**.
- A text filter strips these provider names out of error messages before users see them ("via kie", "upstream",
  the vendors' domains).

For Seedance 2.0 the current client table maps every quality tier to `byteplus`. When a job goes through Kie instead,
the price is multiplied by 1.2.

### How one video is made (observed)

1. The user picks a mode: text to video, image to video (first and last frame), or reference to video. References
   can be up to 9 images, 3 videos (at most 15.3 s each) and 3 audio clips, 12 in all.
2. Settings: tier Mini, Fast or Pro; 4 to 15 seconds; 480p, 720p or 1080p (Pro adds "1080p-plus" and 4K); aspect
   ratio 16:9, 9:16, 1:1, 4:3, 3:4, 21:9 or "adaptive"; generate audio on or off; fixed lens (no camera move); seed.
3. A **channel**: Standard; **Real** ("when your reference image/video contains real people"), which costs 1.2x and
   uses a separate BytePlus account and asset project (`BYTEPLUS_REAL_ARK_API_KEY`, `BYTEPLUS_REAL_ASSET_*`); or Wild
   ("looser content boundaries").
4. The price is shown before submitting. For the "H3 Max" model the server quotes it (`POST /api/h3-max/quote`); for
   Seedance the browser works it out from a table (below).
5. `POST /api/seedance/submit` with a Clerk bearer token. The answer is a video id and a task id, status
   `processing`. The page then checks `/api/seedance/status/<id>`. The server learns of the result through signed
   provider webhooks (`KIE_WEBHOOK_HMAC_KEY`, `AIVIDEOAPI_WEBHOOK_SECRET`) and gives up after
   `VIDEO_TASK_TIMEOUT_MINUTES` (15 by default).
6. Users see "Rendering takes ~1-5 min (Pro: 5-15 min). You may leave this page and return later." The code's wait
   estimates are 210 s for Mini, 270 s for Fast and 390 s for Pro.
7. A failed video is refunded and labelled "refunded" (or "free-restored" for a free daily try). Up to 6 videos can
   be started at once (1 at 4K).
8. A public API is sold as well (`/api/v1/tasks/{id}` in their docs page).

### Seedance 2.0 credit table (observed in the code)

Credits per second, references without video (the normal case for us). The cost is seconds × rate, rounded to 5.

| Tier | 480p | 720p | 1080p | 1080p-plus | 4K |
| --- | --- | --- | --- | --- | --- |
| Fast ("standard") | 9 | 9 | 19 | not available | not available |
| Pro | 11 | 11 | 24 | 60 | 117 |
| Mini | half of Pro | half of Pro | not available | not available | not available |

With a reference video the per-second rate is lower (Fast 5 / 12, Pro 7 / 15), but the reference's own seconds are
billed too, with a minimum of 5. "Real people" adds 20%; the Kie route adds 20%.

**Worked example:** a 5-second 720p Fast clip = 45 credits = about **$0.35 to $1.28** to their customer, depending on
the pack or subscription. A 10-second 1080p Pro clip = 240 credits = about $1.85 to $4.80.

### Weak spots we noticed

- **Observed:** the server's settings list, with variable names (including the database, Stripe and Clerk ones), is
  inside public JavaScript. One of them has a long default value bundled in. We did not test whether it works, and
  we keep no copy of it in the repo. Lesson for BuPulse: never import server settings into code that reaches the
  browser.
- They depend on resellers for their margin and stability, and hide that from users.

---

## 2. Higgsfield (higgsfield.ai)

### What it is

- **Observed:** a large creative suite (Higgsfield, Inc., San Francisco). It offers video and image models from
  everyone (Seedance 1.5 to 2.5, Kling 2.1 to 3.0 and Omni, Veo 3 and 3.1, Sora 2, Wan 2.2 to 3.0, Grok, MiniMax,
  Topaz) plus its own: Higgsfield Soul (photo model), DoP (camera moves), Cinema Studio 4.0, Genjutsu (motion
  transfer), AI Influencer, Supercomputer (an agent), Canvas, a ChatGPT and Claude **MCP** connector, an API and a
  CLI.
- **Observed:** the **Marketing Studio** headline is "TURN ANY PRODUCT INTO READY TO POST CONTENT". Inputs are a
  **Product Link** or an **Ad Reference**. Its tabs are UGC, Product shot, Motion, Ads, Posters, Marketplace and
  TikTok. This is the closest thing to what BuPulse is building.

### How it is built (observed)

| Part | What they use |
| --- | --- |
| Web app | TanStack Start (React), assets from `assets.higgsfield.ai`, 559 script files on the home page |
| Login | Clerk (`clerk.higgsfield.ai`) |
| API | `fnf-api-gw.higgsfield.ai` (an API gateway), plus `canvas-worker`, `creator-hub-chat`, `3d-scene-builder` services |
| Media | CloudFront, `static`, `cdn`, `static-public-media` subdomains; Cloudflare image resizing |
| Bot protection | Cloudflare challenge and DataDome |
| Analytics | PostHog (proxied through their own domain, `/api/i/...`, with session recording), Google Tag Manager |
| Payments | Stripe: subscriptions, credit packs, team **workspaces** with a **wallet** and **auto top-up** (`/workspaces/wallet/auto-top-up`), and "generation seconds" packs (`/generation-seconds/packs`) |

### How a job is made (observed)

- Every generation is a job: `POST /jobs/v2/<job type>` and then `GET /jobs/<id>`. The same queue serves
  every model and tool. Jobs are counted against concurrent-job limits per plan (1, 2, 3, 4 or 8).
- About 200 job types are listed in the code. The ones that matter for marketing:
  - `marketing_studio_brand_kit_scrape` and `marketing_studio_brand_kit_preview`: read a brand from a URL.
  - `marketing_studio_hook`: write the opening hook.
  - `marketing_storyboard`: plan the scenes.
  - `marketing_studio_video`, `marketing_studio_v2_video`, `marketing_studio_v2_reference2video`: make the ad.
  - `ad_multiplier` / `ad_multiplier_v2`: many variations of one ad.
  - `reels_studio`, `youtube_faceless_video`, `video_explainer`, `viral_hub_video`.
  - `reframe`: change the aspect ratio.
  - `dubbing_lipsync` (video translation) and `voice_change_merge`.
  - Voice and music as jobs: `elevenlabs_v4`, `elevenlabs_v4_turbo`, `qwen_audio_tts`, `inworld_text_to_speech`,
    `sonilo_music`, `mirelo_text_to_audio`.
  - Background removal for images and videos.
- Ready-made ad formats in the catalogue: "UGC Unboxing", "Street interview", "Product drop", "ASMR unbox", "Daily
  vlog", "Before / after", "Try-on haul", "Founder story", "Studio pack". Mini apps: "Reference to Video", "Image
  Edit", "Brand Kit". Its SEO page targets "URL to Video Ad Generator", "AI UGC Generator", "Shopify video ad",
  "AI Talking Head Video".

### Prices (observed on /pricing; the plan figures were read from a mixed list, so check before quoting them)

Credits per clip:

| Model | Cost |
| --- | --- |
| Seedance 2.0 720p | ~22 credits / 5 s |
| Seedance 2.0 1080p | ~60 credits / 5 s |
| Seedance 2.0 4K | ~110 credits / 5 s |
| Seedance 2.0 Fast 720p | ~12 credits / 5 s |
| Kling 3.0 720p | ~7 credits / 5 s |
| Kling 3.0 1080p | ~8 credits / 5 s |
| Wan 3.0 720p | 8.75 credits / 5 s |
| Veo 3.1 Fast 720p | ~16 credits / 4 s |
| Sora 2 720p | ~10 credits / 4 s |
| Kling lip-sync 720p | ~2 credits / 5 s |

Plans:

- **Plans:** Free, then paid plans shown at $9, $23 and $59 a month billed annually. The "Pro" card says 900 credits a
  month for $34 a month billed annually ($43 monthly).
- **Unlimited:** some models are "unlimited" on some plans, on the website only (not through MCP, the API or
  Canvas), and may be slowed at busy times.
- **Commercial use:** paid plans only.

**Worked example:** at about $34 for 900 credits ($0.038 a credit), a 5-second 720p Seedance 2.0 clip is about
**$0.83**, a Seedance 2.0 Fast clip about $0.45 and a Kling 3.0 clip about $0.26.

---

## 3. What BuPulse should take from this

1. **Both are wrappers around the same model APIs.** Their edge is the workflow (marketing templates, brand kit,
   variations), not the model. BuPulse's knowledge base and brand settings already do what Higgsfield's "brand kit
   scrape" does, and better for our clients, because the owner checked the facts.
2. **Use the job pattern.** Submit, get a task id, then a signed webhook plus status polling, with a time limit
   (they use 15 minutes) and an automatic refund on failure. This fits BuPulse well: Netlify functions stop at 60 s,
   so we never wait for a clip inside a request. We can reuse our lease, reservation and robot design
   (`lib/visuals/robot.ts`, `prepareVideoUpload` / `finalizeVideo`).
3. **Keep one provider seam with a fallback.** seedance2ai can switch a model between BytePlus, Kie and fal with a
   setting. Our `VideoProvider` interface (`lib/ai/types.ts`, `lib/visuals/ai-video.ts`) is the place for this:
   BytePlus Seedance first (key already approved), with room for a second provider later (needs the owner's OK).
4. **Charge by seconds and quality, and show the price before generating.** Their rule is seconds × rate per
   resolution and tier. For us: 720p Fast clips of 4 to 5 s, used as 1 or 2 scenes inside our 10 to 30 s videos.
   Our own captions, voice-over, music and brand closing go on top (clips are 4 to 15 s, so a 30 s video is always a
   mix).
5. **Shapes come free from the model.** Seedance takes 9:16, 1:1, 3:4 and 16:9 directly. 4:5 is not a native ratio,
   so we would crop it (Higgsfield has a separate `reframe` job for this).
6. **Real people need care.** seedance2ai sends references that show real people to a separate BytePlus account
   and charges 20% more. This suggests BytePlus treats real faces differently. BuPulse's people photos are
   AI-generated, but a client's staff photo is a real person. **Check BytePlus's rules before we send any client
   photo of a person as a reference.**
7. **Marketing formats to copy as scene templates:** product drop, UGC unboxing, before/after (careful: our people
   rules already ban medical before-and-after), founder story, try-on, street interview. Plus "ad multiplier": one
   brief, several variations for testing.
8. **Cost reality:** retail prices for one 5-second 720p Seedance clip run from about $0.35 to $1.28. BuPulse's
   Business plan (50,000 RWF, about $34.50) already spends about $25.90 at full use without AI video. So AI clips
   need their own small allowance or an add-on; they cannot ride inside the 120 videos a month. Our real cost comes
   from the BytePlus price list for our prepaid pack, to be written into `docs/AI_COSTS.md` when we build.
9. **Things not to copy:** server secrets or settings in browser code, hiding which provider made a video from our
   own admin, and "unlimited" promises we cannot afford.

## Evidence (REA, this session)

| What | Evidence id |
| --- | --- |
| seedance2ai home, bundle analysis (routes, endpoints, 149 scripts) | `ev_612e8170ae4f7a2daf16cfe3b45826a794df64b747a4c4ad49694751de8aba66` |
| seedance2ai home, page text | `ev_0c4c914dd6f55161dd301a8ef7cc45d317bfa78ed64408936acb81481655a548` |
| seedance2ai home, script sources | `ev_e9138a97699e4d6519315abdab23c5cb819008d1fe1df72fafe28f104392ab53` |
| Higgsfield home, page text | `ev_7f295e236c13a089ad027ce77f55d2a52ccfff502a580129ead9136f85df2ea3` |
| Higgsfield home, script sources (559 files) | `ev_b0cfc147f850bbd17c0a42905362821855b8573a2a34fe3a8345e30a1a6d39ea` |
| Higgsfield /pricing, page text | `ev_380f21d684e9f5482bf5241a7716f8caf1ba66f8b365a97e2bf85559c62f7cda` |
| Higgsfield /marketing-studio, page text | `ev_0032f1efd8e6d09296490ee9481442b199d800bad307fc837f66344e7583f3d9` |

**Limits:**

- Static reading of the shipped code; nothing was run against their servers.
- Server-side logic (how they call BytePlus, their real costs and margins) is not visible.
- seedance2ai shipped no source maps.
- Higgsfield's logged-in pages (the actual Marketing Studio editor) were not opened.
- Prices are those shown on 16 October 2026, during "Black Friday" and "30% OFF" promotions.

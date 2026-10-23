# AI clips (Google Veo, now Gemini Omni Flash)

> **23 October 2026:** Google shut the Veo 3.1 previews down on 22 October. AI clips are now made by **Gemini Omni
> Flash** (same Gemini key, about $0.10 a second, twice the old price), so the credits below doubled. The switch keeps
> its name, "Google Veo AI clips".

"AI makes the clips" puts 2 or 3 short **real moving clips** of your product into a Motion video: hands using the
product, the product in a Kigali setting, a slow close-up. Google Veo makes each clip from your product photo, so your
real product is in it. BuPulse then adds its own text, music and voice-over on top (the clip's own sound is muted).

**Page:** the Video Studio, **Create** (`/create`), Motion engine, the **Options** pill: "AI makes the clips (Google
Veo)".

**Price:** 130 credits for each 4 s clip (190 for 6 s, 255 for 8 s), on top of the video's 35 credits. Three 4 s clips
make the whole video 425 credits (4,250 RWF). The Generate button shows the total before you press it. A clip Google
cannot make gives its credits back.

## How to use it

1. Open **Create**, pick the product (the PRODUCT tile) and its photos.
2. Open **Options** and choose **2 clips** or **3 clips** under "AI makes the clips". The price of the clips is on each
   button.
3. Press **Generate**. The message line says "Making AI clip 1 of 3…", then 2 of 3, then 3 of 3: about one minute a
   clip (up to 6 minutes at Google's busy times). The clips are made at the same time.
4. Claude then designs the video with the clips in it, and you make the MP4 as usual.
5. A client's clips are also saved in their BuPulse **Photos**, folder **AI clips**, so they can use them again.

## AI videos made overnight (Autopilot and Daily posts)

When the **Videos** choice (Autopilot's settings card, or Content -> Settings for Daily posts) is **AI videos** (every
video) or **Mix** (one video in four), BuPulse makes the AI clips by itself, with nobody present:

1. The video is planned as usual, and its panel says **"AI clips being made"**.
2. Within about 4 minutes BuPulse takes **380 studio credits** (2 clips of 6 s) and asks Google for the clips: one for
   the opening scene and one for a body scene, each starting from that scene's photo.
3. About 5 to 15 minutes later the clips are in the video, and the video robot (or your browser) makes the MP4 with the
   clips playing in their scenes, under the captions, with the video's own voice-over and music.
4. If Google makes only one clip, the video keeps it and the other clip's 190 credits come back. If none is made, the
   video is a simple slideshow and all 380 credits come back. Either way the panel says why.

A simple video is made at once, with no credits taken, when AI clips are switched off, there are not enough studio
credits, the video has no photo, or BuPulse has made its most AI clips for today (`VEO_CLIPS_PER_DAY`, 10 by
default).

## What the clips will and will not show

- The product as it is in the photo: same shape, colours and details.
- No text, letters, logos or brand names in the clip (BuPulse writes the price and the phone number on top).
- No prices or money words in what Google is asked: Gemini Omni refuses such a request at once (unbilled), so
  BuPulse drops any sentence of the product description that mentions money, and the amount in a product name
  (`withoutMoney` in `lib/video-engine/veo.ts`). The price is always BuPulse's own text on top.
- People only as adults, East African, ordinary people, never a famous person. Mostly hands and the product.
- No speech: the video's own voice-over and music are what you hear.
- Every clip carries Google's invisible SynthID watermark (it marks the clip as made by AI).

## Limits

- 2 or 3 clips a video, 4, 6 or 8 seconds each, 720p, 24 frames a second.
- Google can refuse a clip under its safety rules (for example a photo that shows a real person's face). That clip's
  credits come back and the message says so; try another photo.
- **Google Veo AI clips** (Admin -> Services) is **off until the owner switches it on**, because Veo is paid per second.
  While it is off, the choice is replaced by a short note: videos are then made from your photos and your own clips.

## For developers

| Part | Where |
| --- | --- |
| Clip calls (Gemini Omni through the Interactions API by default, Veo's predictLongRunning for a Veo model): submit, check, the clip inline or downloaded, errors in plain English, prices, prompts, the default shot plan | `lib/video-engine/veo.ts` |
| Credits (`veoClipCredits`, Gemini Omni: 4 s 130, 6 s 190, 8 s 255) | `lib/video-engine/credits.ts` |
| Ledger price (seconds as input tokens), feature `video-veo`, provider `veo` | `lib/ai/pricing.ts`, `lib/video-engine/ledger-features.ts` |
| Service switch "Google Veo AI clips" (`veo`: `GEMINI_API_KEY`, optional `VEO_MODEL`, `VEO_USD_PER_SECOND`) and its free test | `lib/admin/service-catalog.ts`, `lib/admin/service-tests.ts` |
| Runs, credits and refunds, retries, Gallery copies, resume after a restart, clips into the design brief | `video-lab/ai-clips.ts` |
| Routes: `GET /api/ai-clips/status`, `POST /api/ai-clips`, `GET /api/ai-clips`, `GET /api/ai-clips/runs/<vr-id>`, `GET /videos/veo/<vc-id>.mp4` (all "any", scoped to the business) | `video-lab/server.ts`, `video-lab/scope.ts` |
| The Create page's choice and the wait | `video-lab/site/client/ai-clips.ts` |
| Overnight AI clips for content videos: start, check, settle, refunds, fallbacks (in the `/api/cron/video-jobs` sweep) | `lib/visuals/ai-clips.ts`, called from `lib/video-studio/sweep.ts` |
| Which scenes get clips, the plan with clips, the notes | `lib/visuals/clip-scenes.ts` |
| The clips drawn in the slideshow (browser and robot) | `components/visuals/clip-layers.ts`, `components/visuals/video-renderer.ts` |
| The first frame (photo crop), shared with the studio | `lib/video-engine/veo-frame.ts` |
| Tests (fetch mocked: no spend) | `tests/video-engine/veo.test.ts`, `tests/video-lab/ai-clips.test.ts`, `tests/visuals/ai-clips.test.ts`, `tests/visuals/clip-scenes.test.ts`, `tests/visuals/clip-layers.test.ts` |

More: `docs/VIDEO_ENGINE.md` "Veo AI clips", costs in `docs/AI_COSTS.md` "Veo AI clips".

## If something goes wrong

| Symptom | Where to look | Usual fix |
| --- | --- | --- |
| "AI clips are not available right now: they are waiting for their Google key." | `GEMINI_API_KEY` in `.env` or Admin -> Services | Add the Gemini key. |
| "AI clips are paused right now." | Admin -> Services, Google Veo AI clips (off until switched on) | Switch it on. |
| "Google Veo needs billing turned on…" | Google AI Studio, Billing, for the key's project | Turn billing on (Veo has no free tier) or top up the prepaid credit. |
| "Google Veo is at its limit right now…" | Google's per-minute or per-day quota | Wait a few minutes; fewer clips at once. |
| A content video says "Google was too busy to make the AI clips" | Google refused the clips at its limit (the interaction's `errors[0].code` is `RESOURCE_EXHAUSTED`, read as `quota` in `lib/video-engine/veo.ts`); nothing was billed | The credits are already back; lower `VEO_CLIPS_PER_DAY` or keep fewer clips in flight (about 3). |
| "Google declined this clip under its safety rules." | The photo (a real person's face?) or the shot | Use a product-only photo; the credits are already back. |
| A content video stays on "AI clips being made" | `ContentVisual.clipState`, `clipJobs`, `clipUntil`; Admin -> Health, `video-jobs` | The sweep gives up after 20 minutes and falls back with the credits back; check the `video-jobs` cron runs. |
| A clip stays at "Making…" after a restart | `video-lab/data/veo/clips/<id>.json` (`operation`) | The studio picks it up again at start (`resumeAiClips`); one never sent to Google is refunded. |

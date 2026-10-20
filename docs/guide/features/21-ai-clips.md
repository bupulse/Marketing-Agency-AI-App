# AI clips (Google Veo)

"AI makes the clips" puts 2 or 3 short **real moving clips** of your product into a Motion video: hands using the
product, the product in a Kigali setting, a slow close-up. Google Veo makes each clip from your product photo, so your
real product is in it. BuPulse then adds its own text, music and voice-over on top (the clip's own sound is muted).

**Page:** the Video Studio, **Create** (`/create`), Motion engine, the **Options** pill: "AI makes the clips (Google
Veo)".

**Price:** 65 credits for each 4 s clip (95 for 6 s, 130 for 8 s), on top of the video's 35 credits. Three 4 s clips
make the whole video 230 credits (2,300 RWF). The Generate button shows the total before you press it. A clip Google
cannot make gives its credits back.

## How to use it

1. Open **Create**, pick the product (the PRODUCT tile) and its photos.
2. Open **Options** and choose **2 clips** or **3 clips** under "AI makes the clips". The price of the clips is on each
   button.
3. Press **Generate**. The message line says "Making AI clip 1 of 3…", then 2 of 3, then 3 of 3: about one minute a
   clip (up to 6 minutes at Google's busy times). The clips are made at the same time.
4. Claude then designs the video with the clips in it, and you make the MP4 as usual.
5. A client's clips are also saved in their BuPulse **Photos**, folder **AI clips**, so they can use them again.

## What the clips will and will not show

- The product as it is in the photo: same shape, colours and details.
- No text, letters, logos or brand names in the clip (BuPulse writes the price and the phone number on top).
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
| Veo calls (submit, poll, download), errors in plain English, prices, prompts, the default shot plan | `lib/video-engine/veo.ts` |
| Credits (`veoClipCredits`: 4 s 65, 6 s 95, 8 s 130) | `lib/video-engine/credits.ts` |
| Ledger price (seconds as input tokens), feature `video-veo`, provider `veo` | `lib/ai/pricing.ts`, `lib/video-engine/ledger-features.ts` |
| Service switch "Google Veo AI clips" (`veo`: `GEMINI_API_KEY`, optional `VEO_MODEL`, `VEO_USD_PER_SECOND`) and its free test | `lib/admin/service-catalog.ts`, `lib/admin/service-tests.ts` |
| Runs, credits and refunds, retries, Gallery copies, resume after a restart, clips into the design brief | `video-lab/ai-clips.ts` |
| Routes: `GET /api/ai-clips/status`, `POST /api/ai-clips`, `GET /api/ai-clips`, `GET /api/ai-clips/runs/<vr-id>`, `GET /videos/veo/<vc-id>.mp4` (all "any", scoped to the business) | `video-lab/server.ts`, `video-lab/scope.ts` |
| The Create page's choice and the wait | `video-lab/site/client/ai-clips.ts` |
| Tests (fetch mocked: no spend) | `tests/video-engine/veo.test.ts`, `tests/video-lab/ai-clips.test.ts` |

More: `docs/VIDEO_ENGINE.md` "Veo AI clips", costs in `docs/AI_COSTS.md` "Veo AI clips".

## If something goes wrong

| Symptom | Where to look | Usual fix |
| --- | --- | --- |
| "AI clips are not available right now: they are waiting for their Google key." | `GEMINI_API_KEY` in `.env` or Admin -> Services | Add the Gemini key. |
| "AI clips are paused right now." | Admin -> Services, Google Veo AI clips (off until switched on) | Switch it on. |
| "Google Veo needs billing turned on…" | Google AI Studio, Billing, for the key's project | Turn billing on (Veo has no free tier) or top up the prepaid credit. |
| "Google Veo is at its limit right now…" | Google's per-minute or per-day quota | Wait a few minutes; fewer clips at once. |
| "Google declined this clip under its safety rules." | The photo (a real person's face?) or the shot | Use a product-only photo; the credits are already back. |
| A clip stays at "Making…" after a restart | `video-lab/data/veo/clips/<id>.json` (`operation`) | The studio picks it up again at start (`resumeAiClips`); one never sent to Google is refunded. |

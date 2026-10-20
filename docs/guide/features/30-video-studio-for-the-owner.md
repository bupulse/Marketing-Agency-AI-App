# The Video Studio, for the owner

What you (the BuPulse owner) switch, watch and pay for in the Video Studio. The client side is in
[The Video Studio, for clients](29-video-studio-for-clients.md); how the engine works is in
[Video Studio](20-video-studio.md), [Viral recipes](22-viral-recipes.md) and [AI clips](21-ai-clips.md).

## The two sites

| | BuPulse (bupulse.com) | Video Studio (studio.bupulse.com) |
|---|---|---|
| Clients do | See and schedule videos, credits, top-ups, the bell and email | Make videos |
| Code | `app/dashboard/video/**`, `lib/video-library/**` | `video-lab/**`, `lib/video-engine/**`, `lib/video-studio/**` |
| Runs on | The normal BuPulse hosting | This Mac first (port 3110, behind the Cloudflare tunnel `bupulse-studio`) |

Both use the same database and Storage. The studio signs clients in with a one-use ticket from BuPulse (2 minutes) and
keeps a 12-hour session. Your own door to the studio is `/login` with `STUDIO_PASSWORD`; your test studio is
`npm run lab` on localhost:3100. Going live step by step: [docs/STUDIO_DEPLOY.md](../../STUDIO_DEPLOY.md), "Going
live (for the owner)".

## Switches (Admin → Services)

| Service | What it does | Off means |
|---|---|---|
| **Video Studio** (`studio`, off by default) | The "Open Video Studio ↗" button and new sign-ins. `STUDIO_URL` sets the address. | Clients see "Video Studio: coming soon"; their library and credits stay. |
| **Google Veo AI clips** (`veo`) | "AI makes the clips". Uses `GEMINI_API_KEY` (billing must be on in Google AI Studio). | The choice is hidden; videos use photos and phone clips. |
| **ElevenLabs** (`elevenlabs`) | Voice-overs. | Videos are made without a voice-over, with captions and music only. |
| **Gemini** (`gemini`) | AI images and presenter shots (and holds Veo's key). | AI images pause with a friendly message. |
| **Seedance** (`seedance`) | AI video, "coming soon" until the BytePlus key day ([docs/SEEDANCE_KEY_DAY.md](../../SEEDANCE_KEY_DAY.md)). | Nothing changes for clients today. |

Premium 3D shows "coming soon" at launch (it renders on this Mac; it opens after Motion is live).

## Credits and plans

- 1 credit = 10 RWF. A price is the provider's cost × 2.2, rounded to 5 credits, except the prices you set (design 35,
  voice-over 15, Premium 3D 100 / 150). The code: `lib/video-engine/credits.ts`.
- Monthly credits per plan: `PLAN_VIDEO_CREDITS` in `lib/plans.ts` (Trial 50, Starter 100, Standard 100, Business 500,
  Pro 1,500), written into each plan; change them in **Admin → Plans** (custom plans too).
- Clients top up with the `block:videoCredits` block in **Billing** (MoMo). Usage shows in **Admin → Usage**.
- Every paid step is charged through `lib/usage.ts` before the provider is called and refunded once if it fails.

## What a video costs BuPulse

| Step | Cost to BuPulse | Client pays |
|---|---|---|
| Claude design (one Motion video) | about $0.11 | 35 credits (350 RWF, about $0.24) |
| ElevenLabs voice-over take | $0.04 to $0.08 | 15 credits |
| Gemini AI image or presenter shot | about $0.04 | 15 credits |
| Google Veo clip, 4 / 6 / 8 s (Veo 3.1 Lite, 720p) | $0.20 / $0.30 / $0.40 | 65 / 95 / 130 credits |
| Rendering the MP4 (in the client's browser) | free | free |

So a viral video with a voice-over and three 4-second AI clips costs BuPulse about $0.80 and the client 245 credits
(2,450 RWF, about $1.70). The details and the real test log: [docs/AI_COSTS.md](../../AI_COSTS.md), "Video" and "Veo
AI clips". Real spend lands in the cost ledger (features `video-design`, `video-voice`, `video-image`, `video-veo`).

## The viral library (yours only)

- `/viral` in your studio: the viral videos the research team saved (TikTok, Instagram, Facebook, YouTube Shorts),
  with their numbers, a breakdown of how each was made and its still frames. Clients never see this page.
- The rows are in `docs/research/viral/<platform>.jsonl`; the frames stay on this Mac (`video-lab/data/viral/frames`)
  and are never published.
- After new rows land, refresh what the engine learns from: `node lib/video-engine/brain/viral-ingest.ts`, then
  restart the studio. The index keeps no captions, comments, frames or account names.

## Checks before you switch it on

1. `node --env-file=.env scripts/video-lab/qa-routes.mjs`: every route answers the right people only.
2. `node --env-file=.env scripts/video-lab/qa-client.mjs`: a signed-in client makes a real video that lands in the
   library (needs `STUDIO_SESSION_SECRET` and `STUDIO_DEV_TICKETS=1` on a test studio, never production).
3. Switch to `ANTHROPIC_API_KEY` for the studio's designs: the test studio uses the Claude subscription, production
   never does.

## If something goes wrong

| You see | Where to look | What to do |
|---|---|---|
| Clients say the button is missing | Admin → Services → Video Studio | Switch it on; check `STUDIO_URL`. |
| "AI clips are paused" for everyone | Admin → Services → Google Veo AI clips; Google AI Studio billing | Switch it on, or turn billing on for the Gemini key. |
| A client's credits did not come back | Admin → Usage; the job in `VideoJob` | A failed step refunds once; check the job's status and the ledger. |
| The studio is down | `tools/bin/studio-run.sh` and `studio-tunnel.sh`; launchd `com.bupulse.studio` and `com.bupulse.studio-tunnel` | Restart them; `/healthz` answers when it is up. (`studio-online.sh` is the test studio's tunnel, video.bupulse.com.) |

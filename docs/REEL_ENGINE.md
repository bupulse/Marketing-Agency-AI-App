# Reel engine (temporary): 30-second AI reels with Google Veo

Owner request (23 October 2026): until the Video Studio's Seedance engine (studio.bupulse.com, the video-engine
session) is ready, BuPulse makes interesting 30-second reels itself, the same way as the image engine (a team of agents,
never the same twice), with Google Veo through the existing GEMINI_API_KEY. It lives on BuPulse's Videos page; when the
studio's engine is ready, this one is switched off.

## Owner decisions (23 October 2026)

- **A 30-second reel** like Instagram Reels and TikTok: 4 Veo clips of 8 seconds in story order (hook, the product in
  use, the result, the call to action), shown 7.5 s each.
- **An AI presenter per company**: a Black Rwandan adult who fits the customers, made once (a Nano Banana Pro portrait,
  `ReelPresenter`) and reused in every reel; the other people are Rwandan too.
- **Kinyarwanda first**: Veo speaks the lines itself (lips in sync); the test is in both Kinyarwanda and English. If
  Veo's Kinyarwanda is not good, the fallback is the existing rule (English voice, Kinyarwanda subtitles).
- **Veo 3.1 Lite** by default (about $0.40 a clip), **Veo 3.1 Fast** as Pro (about $0.80).
- **Test first, price later**: no credits are charged yet; it is on only for the companies in `REEL_ENGINE_BUSINESSES`
  with the "veo" service switched on, and all reels together stop at the owner's test budget (`REEL_TEST_CAP_USD`,
  **$10**). Every paid clip is in the AI ledger (feature `reelEngine`, provider `veo`) and in the reel's `costUsd`.

## How a reel is made

| Agent | File | Job |
| --- | --- | --- |
| Brain | lib/image-engine/engine.ts `loadFacts` | The business, the product, its photos, the brief |
| Director | lib/reel-engine/story.ts `directReel` | One variant per beat (4 hooks, 3 in-use, 3 results, 3 calls to action) and a camera move per clip, those the company had least |
| Prompter | lib/reel-engine/writer.ts | Title, caption, hashtags, music mood, and per clip: the start frame, the motion and camera, and the spoken line (at most 16 words, no invented numbers) in the reel's language. Gemini writes Kinyarwanda; Claude English when it is there |
| Painter | `createEngineDesign` (Nano Banana 2) | Each clip's start frame (9:16) from the presenter's portrait and the product photo, with the anti-slop rules, checked once |
| Filmmaker | lib/video-engine/veo.ts (read-only) | Veo image-to-video from the start frame, the line spoken in the reel's language |
| Editor | the owner's browser, lib/video-engine/encode.ts (read-only) | Joins the 4 clips with their own sound, a subtitle per line, the brand on the last scene and a music track, into a 30 s MP4 |

`stepReel` does one unit of work per call (a start frame; or sending the framed clips to Veo; or checking the clips
being filmed and saving the finished ones to `gallery-videos/<userId>/clips/reels/`), so no request runs long. The
screen (components/video/unique-reels.tsx) calls it every 6 seconds, then joins the reel and uploads it.

Cost of one reel: about $1.89 with Lite (4 start frames $0.27, 4 clips $1.60, checks), about $3.49 with Fast; the
presenter's portrait once ($0.13).

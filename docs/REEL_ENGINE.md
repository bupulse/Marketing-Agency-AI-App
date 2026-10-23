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

## 23 October 2026: Veo 3.1 retired, Gemini Omni Flash

Google retired the Veo 3.1 preview models the same day (404 "no longer available"); nothing was billed. The shared
client lib/video-engine/veo.ts (video-engine session) moves to **Gemini Omni Flash** (`gemini-omni-1.1-flash`, owner's
choice), keeping submit / check / download: about $0.10 a second, so about $0.80 a clip and **about $3.49 a reel**. The
reel engine follows `veoModel()` and `veoClipUsd()`, reads clips through `veoClipBytes` (a link or inline bytes), and asks
for "about 8 seconds" in the prompt (Omni has no duration setting). One model for now: the Lite / Pro choice is hidden.
Kinyarwanda speech is untested by Google; if it is poor, the fallback stays an English voice with Kinyarwanda subtitles.

## First test (23 October 2026, LEAF, Kinyarwanda): what it taught

- **The tab must stay in front**: Chrome pauses a background tab's timers, so the reel stopped after 2 start frames.
  Now the Videos page opens on the latest reel and carries on with it, and a step runs again when the tab comes back.
- **Google sometimes refuses a clip** (Omni: `INVALID_ARGUMENT`, "There was a problem processing your request", failed
  at once, nothing charged). 3 of 4 clips were filmed and the 4th refused, which failed the reel. Now a refused clip is
  sent again up to 2 times, and a failed reel has "Try the failed clips again" that keeps the filmed clips.
- The presenter's description said "undefined" for some company ids (fixed); the portrait itself was right.
- **Omni speaks Kinyarwanda** (checked by a Gemini transcript of the 3 filmed clips, less than $0.01): the lines came back
  almost word for word, clear and natural, lips in sync on camera, ambient sound, no music. Weak spots: hands warp a
  little when the presenter gestures, and in one clip the tower changed shape halfway (a reason to keep the product's
  own photo as the start frame and to ask for little product movement).
- **Google refuses a spoken price**: the call to action ("Iboneka ku mafaranga ibihumbi magana abiri na mirongo
  itanu. Twandikire kuri WhatsApp uyu munsi!") was refused with `INVALID_ARGUMENT` every time; with a start frame Google
  had accepted it was still refused, without "WhatsApp" still refused, without the price sentence it was filmed at once.
  So `spokenLine` leaves every sentence about money out of the speech and the subtitle, and the writer is told the
  price goes in the caption only. "Try the failed clips again" re-sends with the new rule.
- **First finished reel** (Kinyarwanda, 30.07 s, 720x1280; Gemini's review 7.5/10): the 4 lines spoken correctly and
  matching the subtitles, the voice clear over the music, the brand at the end. Its fixes, made after: the main
  WhatsApp number (else the phone) of Business info is shown under the brand on the last scene, and each clip is asked
  to be one continuous shot (Omni put small jump cuts inside 3 clips). Hands touching plants still warp a little.
- **Second reel** (English, 30.07 s; Gemini's review 7.5/10): all 4 clips filmed at the first try, lines matching the
  subtitles, the brand and the +250 WhatsApp number on the last scene. Weak spots: hands and faces of people in the
  background, and the "scale" result variant (many towers in a big place) makes the model invent surreal tower shapes.
  Ideas from the review: show the price as text on the last scene (it can be written, only not spoken), and Kinyarwanda
  subtitles on an English reel.
- **Joining needs the tab in front**: the browser encoder slowed to a crawl (13% after minutes) while the tab was
  behind another window, as timers do. Open: say so on the screen, or join the reel on the server.
- **Test total: $8.22 of the $10** (docs/AI_COSTS.md, "Reel engine test reels"). The "veo" switch was turned on in the
  TEST database for the test (owner's OK; TEST has no admin login) and turned off after the second reel.
- **Polish after the test (owner's choice, no new spending):** the product's price from Business info is written on
  the last scene under the contact (only speaking it is refused); the "close shots of hands" in-use idea became a
  medium shot of the product working, and the "many towers" result idea became a family or team enjoying the result;
  the writer and every clip prompt ask for medium shots, no close-ups of fingers, one of the product with its shape
  unchanged; joining says "Keep this tab in front until it is done".

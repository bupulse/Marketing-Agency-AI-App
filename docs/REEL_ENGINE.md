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

## Round 2: viral, human, real physics (owner, 23 October 2026)

The owner after the first two reels: "it has AI slop… it doesn't obey physics at all, you don't see hands touching the
leaf and you can see people passing through products"; follow how viral videos are made (his examples: a presenter
walking up to a phone camera in a car showroom, quick cuts and stickers that go with the music; an AI comedy ad where
the product is the payoff); the right place for the product ("a product for farming… has to go in green houses");
"make it feel human and make it fun and interactive"; and learn it for every business, not only the test one. The test
budget became **$20** and the "veo" switch stays on.

| What | Where | How |
| --- | --- | --- |
| The right place | writer.ts `SECTOR_SETTINGS` | The business's sector (`sectorFromText`) gives where its product is really used (agriculture: a greenhouse, a farm field, a home or rooftop garden, never a market); the writer picks one `setting` for the reel; every frame and clip is told it; the presenter's portrait gives only her face, hair and clothes, never its place |
| Viral techniques | engine.ts, writer.ts `recipeLines` | A viral recipe from the video engine's library (`viralRecipe`, docs/VIRAL_RECIPES.md, `footage.generated`) gives the opening, the story, the camera feel, the caption and the sound; its sources are kept on the reel |
| Human and fun | story.ts `BEATS`, writer.ts | New ideas: the presenter walking up to the phone camera, a friend's funny everyday struggle, a real reaction, "comment one word"; a hook sticker of at most 4 words; one or two stressed words per line |
| Real physics | story.ts `CLIP_RULES`, the frame prompt | Every clip: filmed on a phone by a friend, every touch makes contact, nobody passes through objects or people, objects keep shape and number, at most two people and no crowd, one continuous shot |
| Real sounds | `CLIP_RULES` | The video model makes crisp real sounds of what happens (steps, water, leaves, a click, a whoosh on a fast move) inside each clip; the music comes on top |
| The Checker | checker.ts | Gemini watches every clip (about $0.003) for bodies or objects passing through each other, hands without contact or with fused fingers, faces changing, the product changing, garbled text, cuts, the wrong place or a crowd; a failed clip is filmed again with what went wrong (`avoid`), at most 2 a reel (`MAX_REFILMS`) and only inside the test budget |
| The edit | story.ts `buildReelSpec`, `reelCuts` | 8 shots: each clip is a shot and a punch-in on the same moving clip (its sound runs straight through); flash, whip and zoom cuts between clips; the first punch at about 1.8 s; captions pop in word by word with the stressed words in the brand colour; the hook sticker; the brand, the contact and a price sticker at the end |
| On the beat | beats.ts | The music library has no tempo, so the browser finds the track's beat (onset curve, autocorrelation, phase) and every cut snaps to it |
- **First round-2 reel** (Kinyarwanda, balcony in Kigali, $3.47, every clip passed the checker): Gemini's review found
  natural physics, no AI slop and the right place, but 6.8/10 because the edits were too quiet (a 16% punch-in reads as
  a plain cut) and the end crowded. Now: three shots a clip (a cut about every 2.5 s on the beat), a 30% punch-in,
  captions 35% bigger with the stressed words in yellow, and at the end the brand with the price sticker, then the
  WhatsApp number on its own. "Re-cut it (free)" edits a finished reel again from its paid clips. One finished clip is
  saved and checked per step (four in one request outlasted the test site's connection). A product photo that cannot
  be read is skipped.
- **The viral re-cut** (free, from the same clips; 7/10): frame by frame the edits are there (the 30% punch-in, a white
  flash and a whip blur between clips, captions a few words at a time with yellow stressed words, the price then the
  WhatsApp number at the end), and Gemini judged the footage "entirely genuine live-action". It saw a phone on a tripod
  in the last clip: the camera move said "static phone on a small tripod" and the model filmed it. The moves never name
  equipment now, every clip says the camera is never seen, and the checker fails a clip that shows one.

## Round 3: the viral montage (owner, 24 October 2026)

The owner: "you didn't use methods like this [a Rwandan car seller's reel] … with the edits and the beats and songs
create some cool edit". That reel: the presenter in the real place, full of energy (walks up to the phone, dances), cut
every 1 to 2 seconds with product shots (fast spins, tilted angles, details), big game-style stickers ("MAPLE GEELY" in
flames, "+25M RWF" in green), flashes, all on the song's beat.

- **7 clips** (`directMontage`): 3 talking clips of 8 s (the hook, how it works, the call to action) and 4 product
  shots of 4 s with no talking (`BROLL_SHOTS`: a fast tilted spin round the product, a low-angle reveal, a detail
  push-in, a whip pan into its place, the result), about $4.50 a reel (7 frames, 40 s of video, checks).
- **The edit** (`buildMontageSpec`, about 21 shots of 1.4 s on average): the hook talking with product shots cut in on
  the beat while the voice runs on (the talking clip's sound plays under the cutaway); a 7-second montage of product
  shots on every beat or two, spun and punched in, with whip, flash and spin cuts and the product's name then the price
  as big 3D stickers (yellow on red, green); how it works, cut the same way; the call to action with the brand and the
  WhatsApp number. A vivid grade and a little glow.
- **The writer** is told the style (energy, a groove or small dance on the beat, jokes, product shots between) and
  writes a `tag` (the product's name, 3 words at most) and only frames and moves for the product shots.
- A clip that failed for good fails the reel only when the others are finished, so "Try again" never pays twice.
- Old reels (4 talking clips) are still cut the round-2 way.
- **Google's limit** (first montage reel): all 7 clips were sent at once and Omni answered 6 of them with
  `RESOURCE_EXHAUSTED` (its interactions report it in `errors[].code`; the shared client turned it into "could not make
  this clip", so they were counted as refusals and failed). Now at most `VEO_PARALLEL` (3) clips film at once, and a
  clip Google is too busy for (a quota error, or a submit answered 429) waits a minute and goes again without counting
  as a try. The video-engine session was asked to map `RESOURCE_EXHAUSTED` to the "quota" kind in veo.ts.
- **Google's quota for the project** (24 October 2026, 01:45 CAT): after about 20 Omni clips in a day (the reels and
  the video engine's tests), even a single clip sent alone is answered `RESOURCE_EXHAUSTED`. That is the project's
  quota for Gemini Omni video, not clips sent at the same time. Google resets daily quotas at midnight Pacific time
  (about 09:00 in Kigali); a higher quota is asked for in Google AI Studio (paid tier limits). Until then a reel waits.
- **The montage reel, finished** (24 October 2026, 09:56 to 11:08 CAT, after the quota reset): "Try the failed clips
  again" filmed the 6 clips (3 at a time), the checker sent one product shot back once (a hard cut where people
  vanished), and the browser joined it: 30.07 s, about 21 shots, $4.94 for the reel. Gemini's review, 6/10: physics
  natural, no AI artifacts, fast cuts and stickers "mirror effective direct-to-consumer Reels pacing", voice clear and
  the Kinyarwanda captions follow it. What it lost points for: **a different tower in almost every shot**, and the
  place going between the rooftop and a greenhouse.
- **Why: the product album.** LEAF's Hydro Tower album holds 8 photos of 8 different towers (a steel spiral, terracotta
  pots, a white "tree", a fluted column, grey blocks, a tube rack…), and each clip's frame took the next photo, with
  that photo's greenhouse. Now a reel keeps one product photo for every frame (`plan.productPhoto`: the album's first,
  the product's main photo, unless it cannot be read), and the frame takes only the product from it, never its place.

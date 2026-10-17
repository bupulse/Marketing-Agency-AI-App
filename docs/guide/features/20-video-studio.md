# Video Studio

BuPulse's studio for marketing videos: it turns a product from the knowledge base (its photos, price and facts) into
ready-to-post videos for TikTok, Instagram, Facebook and YouTube Shorts. It has three engines:
- **Motion:** animated videos that Claude designs and your browser draws, in under a minute.
- **Premium 3D:** real 3D scenes that Blender renders on the studio computer, in a few minutes.
- **Real video:** filmed-looking clips with moving people, made by Seedance 2.0 at BytePlus.

Every video costs studio credits, shown on the Generate button before you press it.

**Page:** the Video Studio, **Create** (`/create` on video.bupulse.com behind the studio password, or
http://localhost:3100/create when it runs on the Mac). Also: **Showcase** (`/showcase`), **My videos** (`/videos`),
**Pricing** (`/pricing`) and one page per model (`/app/video/seedance-2-0`, `/app/video/motion`...).

**Plans:** the Video Studio is still in testing; clients do not see it yet. The lab wallet starts with 5,000 test
credits; top-ups on Pricing are test packs with no payment.

## Try it in five minutes

1. **Open the studio.** Go to video.bupulse.com and sign in with the studio password (`STUDIO_PASSWORD` in `.env` on
   the Mac). On the Mac itself, http://localhost:3100 needs no password. The amber bar at the top means Claude runs
   on your subscription: fine for testing, switch to the API key before any client uses it.
2. **A Motion video (35 credits, plus 15 for the voice-over).** Open **Create**, choose **Motion**, press **PRODUCT**
   and pick **Nova Phones Kigali → Samsung Galaxy A56**. Click one of the three **opening lines** above the prompt (for
   example "Samsung Galaxy A56 · 420,000 RWF"), then **Generate**. In about a minute the design plays; press **Make
   MP4** (the voice-over is on).
   *Look and listen for:* your chosen line as the opening, the real phone photo, the exact price and WhatsApp number,
   the voice speaking clearly over the music, and under the video the **Caption check** and **Research score** (aim
   for 70 or more) and any **Check these facts** lines (red means a claim the product's facts do not support).
3. **Premium 3D with voice (100 + 15 credits, about 5 to 8 minutes).** Pick **E2E Starter Test → Kitenge summer
   dress**, then **Quality → Premium 3D (Blender)** at 540p with **Voice-over** and **Music** on, and **Generate**. You
   can keep working; the card shows the progress.
   *Look and listen for:* the dress standing free (cut out) on a plinth, 3D lettering and the 3D price, smooth camera
   movement, and the voice starting just after the first beat with the music lower underneath and fading at the end.
   The finished Kitenge clip already in **My videos** ("Premium 3D", 540p) has sound too: start there if time is short.
4. **A Seedance preview (free until the BytePlus key).** Switch to **Real video**, keep the Galaxy A56, press
   **⚡ Quick plan**, then **Generate**.
   *Look for:* the storyboard frames with your photo inside and the camera move drawn on top, the shot list, and the
   price the real clip will cost. No credits are taken. Under **Get inspired**, any example's **Use this** fills the
   whole form for you.

## The three engines

| Engine | What you get | Best for | Time | Credits |
| --- | --- | --- | --- | --- |
| **Motion** (✦) | Your photos, animated text, shapes, camera moves and a film look, 8 to 30 s; library music; an optional voice-over | Most posts: offers, new stock, prices, lists, "3 reasons" | Design about 30 to 60 s, MP4 about 30 s | 35 a design, + 15 for the voice-over |
| **Premium 3D** (Motion → Quality → Premium 3D) | A real 3D scene: the product on a turntable, 3D titles, glass and chrome, 4 to 8 s | Launches and premium products, where the look matters most | About 3 to 6 minutes (720p about twice as long), one clip at a time | 100 at 540p, 150 at 720p; render again 70 |
| **Real video** (🎬, Seedance 2.0) | A filmed-looking clip of 4 to 15 s: people, hands, places, real camera work, with sound | UGC-style reviews, unboxings, tours, food, fashion on a person | Usually 1 to 5 minutes | By quality, resolution and length: Mini 480p 5 s 55, Fast 720p 5 s 190, Pro 1080p 5 s 590 |

**Choosing an engine:**
- **Start with Motion.** It is the cheapest and the fastest, and it shows your real photos and exact prices.
- **Premium 3D** is for when the product should look like an advert from a big brand.
- **Real video** is for when you need people or real places moving. BuPulse adds the price, the number and the
  caption on top afterwards: Seedance clips have no text.

## Making a video, step by step

1. **Pick the product.** Press the **PRODUCT** tile and choose the business and the product. Its first photos become
   the references (Image 1, Image 2...). Press **+** to add more: your own uploads, AI images, a finished video.
2. **Pick the engine.** **Real video** or **Motion**, at the left of the prompt bar.
3. **Pick a template.** The template pill (for example "Product hero") opens the gallery below the bar. Each card plays
   a live example when your mouse is over it. Categories: product shots, motion, 3D motion, UGC, TikTok, ads,
   posters and offers, marketplace, cinematic.
4. **Say where it will be posted (Motion).** The **Made for** pill (Any, Instagram, TikTok, Facebook, YouTube Shorts).
   Claude keeps the price, the number and the call to action clear of that app's buttons, and picks the length that
   works there.
5. **Shape and length.** **9:16** is right for Reels, TikTok and Shorts. The length is 8 to 30 s for Motion, 4 to 8 s
   for Premium 3D and 4 to 15 s for Real video.
6. **Quality.**
   - **Motion:** the MP4's size (480p, 720p, 1080p). The design is the same at every size.
   - **Premium 3D:** 540p or 720p.
   - **Real video:** Mini (best value), Fast or Pro (best; only Pro makes 1080p), and the resolution.
7. **More.**
   - **Motion:**
     - **Voice-over:** 15 credits, added when the MP4 is made. It is reused for free if nothing changed.
     - **Fixed lens:** no camera moves.
     - **Opening hook:** the first seconds' style, or let Claude choose.
   - **Real video:**
     - **Generate sound:** ambient sound, music and short spoken lines.
     - **Fixed lens:** BuPulse asks for a still camera in the prompt.
     - **Seed:** to repeat a result.
     - **Draft (480p):** on Seedance 2.0 this is a normal, cheaper 480p clip.
     - **Offline:** Seedance 2.0 does not offer it yet, so the clip runs at the normal price.
8. **A presenter (AVATAR tile).**
   - **Motion:** free cartoon presenters, drawn by the engine (Keza, Bosco, Mama Uwase...), or realistic AI presenter
     photos (15 credits each).
   - **Real video:** Seedance refuses photos of real-looking faces, so presenters come from BytePlus's digital
     character library. Until the key arrives the studio shows six preview characters (Amani, Kalisa...), which are
     only for looking.
9. **The prompt.**
   - **Motion:** write a line if you like ("make the price bigger", "mention free delivery"). Claude writes the rest.
   - **Real video:** press **⚡ Quick plan** (free, instant: BuPulse's own shot plan from your product) or **✨ Write
     with Claude** (Claude writes the shot list, with the research). Change anything you like. The prompt says
     "Image 1", "Image 2" for your photos, in the order of the reference strip.
10. **Generate.** The button shows the credits. They are taken when you press it and given back if the video fails.
    Your video appears under **Your generations**. Press it to open the drawer:
    - **Watch it.**
    - **Make the MP4 (Motion):** with the voice-over if it is on.
    - **Download.**
    - **Edit:** describe a change ("bigger price").
    - **Extend:** add a few seconds.
    - **Render again (Premium 3D).**
    - **Copy:** the caption and hashtags.

**Versions:** the − 1/4 + pill makes up to 4 different designs at once (up to 3 for Real video), each charged.

## What the numbers and warnings mean

- **Credits.** 1 credit = 10 RWF. A price is the provider's cost × 2.2, rounded to 5 credits (Premium 3D and the
  voice-over are set by the owner). What each video really costs BuPulse is in [docs/AI_COSTS.md](../../AI_COSTS.md),
  "Video".
- **Research score N/100 (Motion).** How well the design follows the research (see [Video Brain](19-video-brain.md)).
  The drawer lists what it missed, scene by scene. A low score never blocks anything.
- **N facts to check.** A number or claim in the video that is not in the product's facts:
  - **red:** found nowhere in the facts;
  - **amber:** only in the business's general description.
  Check it before posting.
- **Caption check N/100.** The post text and hashtags against the platform's habits: the product and the price first,
  how to order, the number, the place, and the right number of hashtags. Cards under 70 get a badge.
- **Real video checks (under the prompt bar, as you type).**
  - **Red (blocks Generate):** what BytePlus would refuse before you pay. For example "the prompt talks about Image 3
    but only 2 images are attached", "Seedance 2.0 Fast makes 480p or 720p", or "BytePlus takes reference videos
    only as a public link".
  - **Amber (does not block):** what would probably disappoint, such as text asked for in the video (Seedance garbles
    letters), camera moves with a fixed lens, or a photo that may show a person.
  - **Left out:** a reference BytePlus would refuse (a video too short, an audio file that is not mp3 or wav) is left
    out, with the reason.
- **Voice cut to fit 30 s.** The spoken lines were longer than the video; the end was cut.

## Previews and the real key

Until the BytePlus key (`SEEDANCE_API_KEY`) is added, **Generate on Real video makes a free preview**: no credits
are taken, and after a few seconds the drawer shows a storyboard. It has:
- the shots with their times, camera moves and sounds;
- 3 or 4 sketched frames (with your photo where the shot uses it);
- what the real clip will cost and how long it usually takes.

From the drawer you can make it as a Motion video instead, or edit the prompt. The notice bar says whether Seedance is
connected.

The day the key arrives, follow [docs/SEEDANCE_KEY_DAY.md](../../SEEDANCE_KEY_DAY.md). After it is in `.env` and the
studio has restarted, Generate sends real Seedance jobs and takes credits; there is no other switch. Earlier previews
stay in your generations as previews.

## The showcase and the gallery

- **Showcase** and **My videos:** every finished video of all three engines, with a viewer showing the prompt or
  caption and the cost. Previews are left out.
- **The hero carousel** at the top of Create: real clips made in the studio.
- **The template gallery** (under the bar): every template with a live example.
- **Get inspired** (Real video and the Seedance model pages): 12 example storyboards made from the test products. Each
  is a free preview with its shot list and its price at every quality. **Use this** opens Create with the same
  prompt, product and photos.

## Limits

- **Premium 3D:** renders one clip at a time on the studio computer (about 20 an hour at most). Its clips are silent
  until Blender mixes sound.
- **Real video:**
  - **Faces:** no photos of real people's faces; use the character library.
  - **Kinyarwanda:** Seedance does not speak Kinyarwanda reliably, so a Kinyarwanda business gets music and sound only,
    and the voice-over goes on top.
  - **Reference videos:** only while the video.bupulse.com tunnel runs.
- **Daily cap:** the lab stops paid calls at $5 a day (Kigali time) and says so.
- **Claude on the subscription:** in testing, Claude runs on the owner's Claude subscription. Before any deploy it
  must switch to the API key.

## For developers

### Where the code lives

| Part | Where |
|---|---|
| Pages and their scripts | `video-lab/site/` (`layout.html`, `pages/*.html`, `client/create.ts`, `client/showcase.ts`, `client/pricing.ts`, `models.json`), built by `scripts/video-lab/start.mjs` (`npm run lab`) |
| Server and routes | `video-lab/server.ts` (`/api/design`, `/api/jobs/*`, `/api/seedance/*`, `/api/blender/*`, `/api/quote`, `/api/showcase`, `/api/wallet`) |
| Credits and wallet | `video-lab/credits.ts` (`CLAUDE_VIDEO_CREDITS`, `seedanceCredits`, `PREMIUM_3D_CREDITS`, `VOICE_OVER_CREDITS`, `charge`, `refund`) |
| Motion engine | `lib/video-engine/` (`designer.ts`, `spec.ts`, `validate.ts`, `draw.ts`, `animate.ts`, `encode.ts`, `templates.ts`, `styles.ts`, `cast.ts`) |
| Premium 3D | `lib/video-engine/blender-design.ts`, `video-lab/premium-jobs.ts`, `tools/blender/`, [docs/BLENDER.md](../../BLENDER.md) |
| Voice-over | `video-lab/voice.ts` (ElevenLabs) |
| Research Brain | `lib/video-engine/brain/` ([Video Brain](19-video-brain.md)) |
| Seedance | `lib/video-engine/seedance.ts` (BytePlus calls), `seedance-brain.ts` (templates, rules, plans, checks), `seedance-prompt.ts` (Claude's prompt writer), `seedance-overlay.ts` (BuPulse's text over a clip), `seedance-characters.ts` (presenters), `video-lab/seedance-jobs.ts` (jobs and previews), `video-lab/seedance-references.ts` and `seedance-sources.ts` (photos and files for BytePlus), `video-lab/seedance-mock/` (storyboards, examples) |
| Cost records | `video-lab/store.ts` (`ledger.jsonl`, daily cap) |
| Tests | `tests/video-engine/*.test.ts` |
| Docs | [docs/VIDEO_ENGINE.md](../../VIDEO_ENGINE.md) (how it works), [docs/SEEDANCE_KEY_DAY.md](../../SEEDANCE_KEY_DAY.md), [docs/AI_COSTS.md](../../AI_COSTS.md) "Video" |

## If something goes wrong

| Symptom | First place to look | Usual fix |
|---|---|---|
| "Not enough credits" | Pricing, the wallet | Add a test pack on Pricing (no payment in the lab). |
| "Today's test budget is used: $… of $5.00" | `video-lab/data/ledger.jsonl`, `VIDEO_LAB_DAILY_USD` | Wait for tomorrow (Kigali time), or raise the cap in `.env` if the owner agrees. |
| Real video only makes previews | The notice bar; `node --env-file=.env scripts/video-lab/seedance-check.mjs` | Add `SEEDANCE_API_KEY` and restart `npm run lab` ([SEEDANCE_KEY_DAY.md](../../SEEDANCE_KEY_DAY.md)). |
| Generate is greyed out on Real video | The red check under the prompt bar | Do what it says (for example remove "Image 3", or pick Pro for 1080p). |
| "BytePlus declined the content" | The references: a person's face? | Use product photos and a digital character; the credits come back by themselves. |
| Premium 3D is disabled | `GET /api/blender/status` | Blender is missing or not found on this Mac ([docs/BLENDER.md](../../BLENDER.md)). |
| The MP4 has no voice | The drawer's message; ElevenLabs in Admin → Services | Check `ELEVENLABS_API_KEY`; the MP4 is made without the voice when the take fails, and the credits come back. |
| A video's price or number is wrong | The drawer's "Check these facts" | Fix the product's facts in the knowledge base and generate again; Claude only uses what is there. |

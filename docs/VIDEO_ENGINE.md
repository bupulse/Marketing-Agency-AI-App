# Video engine (Claude-designed videos)

Owner decision (16 October 2026): BuPulse's main video engine is **Claude-designed**. Claude (Sonnet) reads the
product, its photos and the brand, and writes a full **motion design**: scenes, photo moves, animated text, shapes,
colours, transitions, music mood, the post caption and hashtags. Our own renderer draws it at 30 fps and makes the MP4,
in the browser or the video robot's headless Chrome, for free. Seedance (BytePlus) is the **backup and premium** engine
for shots that need real moving people; it plugs into the same lab next.

Why: cost. A Claude design costs about **$0.05 to $0.12** per video; rendering is free. A Seedance clip costs about
$0.35 (480p) to $0.76 (720p) per 5 seconds. Claude cannot make photographs or realistic moving people: no text model
can. Realistic people come from image or video models. Research behind this: `docs/research/VIDEO_COMPETITORS_TEARDOWN.md`.

It is in testing in the **Video Lab**, outside the app. Clients do not see it yet.

## How a video is made

1. **Brief** (`lib/video-engine/designer.ts`, `briefText`): the business (name, description, content language,
   brand colours, phone, website, country, voice) and the product (name, summary, description, price text, why buy,
   features, for whom), fenced as data (`<<<BUSINESS ... BUSINESS>>>`). It also carries the chosen style and hook, the
   shape (9:16, 4:5, 1:1, 16:9) and the length (6 to 30 s), plus the owner's own line. Up to 4 product photos are sent as
   images: Claude **sees** them, chooses crops, colours and how to place them.
2. **Claude designs** (`designVideo`): one call to the Messages API (model `claude-sonnet-5-5`, effort medium, at most
   12,000 tokens out). Claude answers with one JSON object of the `MotionSpec` type (`lib/video-engine/spec.ts`,
   described to Claude in `SPEC_FORMAT`). Claude writes data, never code. The rules in `systemPrompt`: a scroll-stopping
   first 1.5 s, a call to action at the end, only facts from the brief (no invented prices, discounts or claims), the
   business's language, the safe area, contrast, at most 2 fonts, motion in every scene. If the answer cannot be read,
   one more call explains the problem; both calls are counted.
3. **Checked and repaired** (`lib/video-engine/validate.ts`, pure). Nothing Claude writes reaches the renderer unchecked:
   - unknown fonts, animations, transitions and shapes fall back to defaults;
   - colours must be hex or rgb(a), numbers are clamped and text is cut to length;
   - layers that point at photos we do not have are dropped;
   - the scenes are scaled to the requested length (each 1.2 to 8 s, 2 to 8 scenes).
4. **Drawn** (`lib/video-engine/draw.ts`, `animate.ts`): plain 2D canvas calls, the same in every browser and in
   headless Chrome.
   - **Layers:** photo (cover or contain, rounded, shadow, border, slow zoom towards a focus point), text (7
     self-hosted fonts, word wrap that shrinks to fit, highlighted words, a box behind) and shape (rect, circle, ring,
     line, starburst, blob, arrow, optionally drawing themselves in).
   - **Motion:** keyframes (offset, scale, rotate, opacity) with 7 easings, and 12 text entrances (fade, rise, drop,
     pop, zoom, slides, typewriter, word by word, words popping, blur in).
   - **Backgrounds:** solid, gradient or a blurred, dimmed photo, with moving dots, lines or grain.
   - **Transitions:** cut, fade, slide up, slide left, zoom, wipe, flash.
5. **MP4** (`lib/video-engine/encode.ts`): WebCodecs H.264 + `mp4-muxer` (as the slideshow renderer), with the music
   library track (looped, faded in 1 s and out 1.5 s, at 85%) encoded to AAC. A 12 s 9:16 video is about 5 MB and takes
   about 30 s to make on a laptop.

## Styles and hooks

`lib/video-engine/styles.ts`, written for Rwanda and East Africa (like Higgsfield's Marketing Studio presets).

| Styles | Product hero, Bold words, Dark minimal, Colour pop, Offer flash, Cinematic story, 3 reasons, Local market |
| --- | --- |
| Hooks | Let Claude choose, A question, Bold claim, Price reveal, Problem then fix, POV, Countdown |

Each one is a short art direction added to Claude's brief.

## The Video Lab

A small local site for testing the engine, separate from the app (`video-lab/`, `scripts/video-lab/start.mjs`).

1. `.env` must point at the TEST database (the lab refuses any other).
2. **How the lab reaches Claude:**
   - **Testing (now):** the owner's **Claude subscription**, through the Claude Code CLI logged in on this computer
     (`video-lab/claude-cli.ts`, `claude -p` in restricted mode with only the Read tool, in a temporary folder holding
     the photos). It is used when `ANTHROPIC_API_KEY` is empty, or with `VIDEO_LAB_CLAUDE=subscription`. It costs
     nothing extra; the lab still shows what the same call would cost on the API.
   - **Before any deploy: switch to the API key.** Set `ANTHROPIC_API_KEY` (in `.env`, or saved in Admin, Services,
     which the lab reads like the app, `loadSavedKeys`). A subscription is for the owner's own use and must never run
     the app for clients; the app's code path (`designVideo` default transport) uses the API only.
3. `npm run lab`, then open `http://localhost:3100` in Chrome.
4. Pick a business and product from the test database. Choose the photos Claude may use (up to 4), a style, a hook,
   the shape and the length. Add your own line if you like, and see the estimated cost. Then press **Design with
   Claude**.
5. The video plays live in the preview: play, pause and scrub.
6. **Make MP4** renders it in the browser, saves it and offers the download.
7. The design JSON can be edited by hand and applied (no AI, no cost).
8. **Sample design** is a free, hand-made design that tests the renderer without Claude (`lib/video-engine/sample.ts`).

What it keeps (`video-lab/data/`, git-ignored):

- every test (`jobs/*.json`: brief, design, Claude usage, cost, video size and render time);
- the MP4s (`videos/`);
- every paid call (`ledger.jsonl`);
- cached photos and music.

**Daily cap:** $5 a day (owner decision; `VIDEO_LAB_DAILY_USD`). Before each design the lab checks that today's spend
plus the worst case of one design (`maxDesignCost`, two full calls) fits; otherwise it says so and waits for tomorrow
(Kigali time).

The lab reads the database only (`video-lab/data-source.ts`, `pg` with default TLS checks) and listens on 127.0.0.1
only.

## Costs

| Video | Cost | Where it goes |
| --- | --- | --- |
| Claude-designed, 2 to 4 photos | about $0.05 to $0.12 (Sonnet: about 6,000 to 10,000 tokens in, 4,000 to 7,000 out) | the lab ledger; in the app, the AI ledger (`withLedger`) |
| Rendering and MP4 | free | the owner's browser or the video robot |
| Music | free | the library (`MusicTrack`) |
| Voice-over (next) | ElevenLabs characters, as today (docs/VOICE_AND_MUSIC.md) | |
| Seedance clip (next, premium) | about $0.35 (480p) to $0.76 (720p) per 5 s, BytePlus estimate | |

The lab shows the real tokens and cost of every test (`docs/AI_COSTS.md`).

**Measured** (16 October 2026, Nova Phones Kigali, Samsung Galaxy A56, Product hero, 9:16, 15 s, 2 photos):

- **Design:** Sonnet, 12,121 tokens in and 4,447 out, **$0.103 on the API** ($0 through the subscription), 35 s.
  The result was 5 scenes, the brand's blue and yellow, and only facts from the product data (specs, colours, price,
  MoMo, warranty, the WhatsApp number).
- **MP4:** 6.9 MB, made in 23 s in Chrome, with library music.

## Not yet

- **Voice-over** from the scenes' `say` lines (ElevenLabs, timed like `fitPlanToVoice`).
- **Seedance:** an async job through BytePlus ModelArk: `POST /contents/generations/tasks`, then
  `GET /contents/generations/tasks/{id}` or a webhook. Video URLs last 24 hours, so a clip is saved at once.
  - Seedance does not accept reference photos with **real human faces**. People must come from the ModelArk
    digital-character library (owner decision), from Seedream 5.0 outputs (trusted for 30 days) or from verified real
    people.
  - It waits for the BytePlus key (`SEEDANCE_API_KEY`) and the library to be activated.
- **In the app:** the "Make a video" panel and Autopilot calling `designVideo` through `withLedger` (feature `video`),
  the robot rendering specs, plan quotas, and the guide page. Today's slideshow videos (docs/CONTENT_VISUALS.md) keep
  working unchanged.

## Code

| Part | Path |
| --- | --- |
| Spec types and limits | `lib/video-engine/spec.ts` |
| Checking and repair | `lib/video-engine/validate.ts` |
| Timing maths | `lib/video-engine/animate.ts` |
| Canvas renderer | `lib/video-engine/draw.ts` |
| Fonts, photos, MP4 | `lib/video-engine/encode.ts` |
| Claude designer | `lib/video-engine/designer.ts` |
| Styles and hooks | `lib/video-engine/styles.ts` |
| Free sample design | `lib/video-engine/sample.ts` |
| Video Lab | `video-lab/server.ts`, `video-lab/data-source.ts`, `video-lab/store.ts`, `video-lab/client/`, `scripts/video-lab/start.mjs` (`npm run lab`) |
| Tests | `tests/video-engine/engine.test.ts` |

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

## Camera, look and transitions (the "Seedance feel")

Claude is also the director of photography: every scene can have a **camera** (`Scene.camera`, `cameraAt` and
`parallax` in `animate.ts`).

- **15 moves:** static, dolly in/out, pan left/right, tilt up/down, orbit left/right, crane up/down, crash zoom,
  push-pull (dolly zoom), dutch roll and handheld. Each has an intensity, an optional extra shake (deterministic, so a
  re-render is identical) and an optional **focus pull** (`focusFrom` and `focusTo`, depths).
- **Depth and parallax:** every layer has a depth, 0 (far) to 1 (near). Near layers move and zoom more than far ones,
  like a real camera in a 3D set. The background is drawn larger while the camera moves, so its edges never show.
- **Focus:** layers away from the focus depth are blurred. Text is a graphic on top of the shot, so it always stays
  sharp.
- **Film look (`MotionSpec.look`):** colour grades (warm, cool, teal-orange, vivid, mono, film, faded, night), glow,
  drifting light leaks, vignette, grain and cinema bars. The grade and glow are applied to the whole frame from an
  off-screen buffer; the rest is drawn on top.
- **Transitions:** cut, fade, slide up, slide left, zoom, wipe and flash, plus whip (motion blur), blur zoom, spin and
  dip to black.

## Modes and settings (like Seedance)

| Mode | What Claude does |
| --- | --- |
| Reference (default) | Uses up to 4 photos freely (Seedance's "omni reference") |
| Text | No photos: text, shapes, colour and camera only |
| Image | Photo 1 is the opening frame, brought to life |
| First + last | Opens on photo 1, ends on photo 2, and connects them |
| Edit | Gets the current design and the owner's change ("make the price bigger"), returns the whole updated design; the length may change |
| Extend | Keeps every scene and adds about 3 to 8 seconds of new ones (at most 30 s in all) |

**Settings:**

- **Shape:** 9:16, 3:4, 4:5, 1:1, 4:3, 16:9 or 21:9.
- **Length:** 4 to 30 s.
- **Quality:** 480p, 720p or 1080p. This only changes the MP4's pixel size, since the design uses fractions of the
  canvas; the encoder picks the H.264 level for the size.
- **Fixed lens:** no camera moves.
- **Music:** on or off.
- **Versions:** 1 to 4, each told to look clearly different, made two at a time.

**References:** the owner can also upload photos to the lab (`video-lab/data/uploads`).

## Templates

`lib/video-engine/templates.ts`: 26 templates in 8 categories, like Higgsfield's Marketing Studio:

| Category | Templates |
| --- | --- |
| Product shot | Product hero, Studio turntable, Macro details, Fresh splash |
| Motion | Bold words, Hypermotion, Dark minimal, Colour pop, Typography poster |
| UGC | Customer review, Unboxing, POV moment, Problem to fix |
| TikTok | This saved me, 3 reasons, Secret hack |
| Ads | Offer flash, TV spot, Brand story |
| Posters & offers | Event poster, Price drop |
| Marketplace | Listing video, Colour options |
| Cinematic | Cinematic story, Golden hour, Local market |

- **Art direction:** each template gives the layout, the camera language, the look and the pacing.
- **UGC templates:** these are marked `presenter`. Until AI influencers exist, they are carried by the product and
  first-person captions.
- **Gallery previews:** each template has a live example video, made once (`POST /api/template-previews`, kept in
  `video-lab/data/template-previews/`). It plays when the mouse is over its card.

## AI influencers (owner decision: both kinds)

- **Realistic photo influencers** (`video-lab/influencers.ts`): 8 fictional East African presenters (Aline, Eric,
  Grace, Kevin, Diane, Patrick, Sandrine, Jean-Paul), each with an age, a look, a vibe and a usual place.
  - **Portrait:** made once with Gemini (`gemini-2.5-flash-image`, about $0.039). Every later image keeps this face.
  - **Shot:** the presenter holding, showing, using or unboxing the product, made from the portrait and the product
    photo, so the face and the product stay the same (about $0.039).
  - **In the video:** a shot becomes a reference photo with a note ("Aline (AI presenter) holding..."). Claude uses
    it like UGC footage: full frame, handheld camera, first-person captions. The lips do not move; talking presenters
    come with Seedance.
  - **Rules** (as in `lib/designs/prompt.ts`): fictional adults only, never a real or famous person or a lookalike,
    same clothes, and no added or changed brand logos.
  - **Spending:** real money, counted in the lab ledger and the daily cap.
- **Cartoon presenters** (`lib/video-engine/cast.ts`, `CharacterLayer`, `drawCharacter`): Keza, Bosco, Mama Uwase,
  Ganza, Ineza and Teta, drawn by the engine, so they are free.
  - They have skin, hair (short, afro, braids, bun, twists, long, bald), outfit and accent colours, and optional
    glasses.
  - They breathe, blink and gesture (stand, wave, point, present, thumbs up, hold), and their mouth moves inside the
    talk windows Claude sets.
  - The presenter keeps a lower corner to themselves; text and the product go elsewhere.

Measured, 16 October 2026 (Galaxy A56):

- **Aline:** portrait 28 s, $0.039; shot holding the phone 32 s, $0.039.
- **Customer review design with the shot:** 15 s, $0.113 on the API (subscription $0). The result: handheld,
  TikTok-style captions, 5 stars, macro detail shots with a ring on the camera, an end card.
- **Colour pop with Keza:** 12 s, $0.161 on the API.

## Styles and hooks

`lib/video-engine/styles.ts`, written for Rwanda and East Africa (like Higgsfield's Marketing Studio presets).

| Styles | now the templates above (`VIDEO_STYLES` is kept as an alias) |
| --- | --- |
| Hooks | Let Claude choose, A question, Bold claim, Price reveal, Problem then fix, POV, Countdown, Product hit, Stop scrolling, Did you know?, Big reveal |

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

Later the same night (house listing, Kibagabaga):

- **Cinematic story design:** 15 s, 6 scenes. Claude chose dolly in, pan, crane up, orbit, push-pull and dolly out,
  with dip and fade transitions, a teal-orange grade, light leaks, grain and cinema bars. Every claim was in the
  listing. It took 29 s, with 15,264 tokens in and 3,313 out: $0.095 on the API.
- **Edit ("bigger price, own final scene, longer opening"):** 32 s, $0.138 on the API.

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
| Templates | `lib/video-engine/templates.ts` |
| Styles and hooks | `lib/video-engine/styles.ts` |
| Free sample design | `lib/video-engine/sample.ts` |
| Cartoon presenters | `lib/video-engine/cast.ts` (drawn in `draw.ts`) |
| Realistic influencers (lab) | `video-lab/influencers.ts` |
| Video Lab | `video-lab/server.ts`, `video-lab/data-source.ts`, `video-lab/store.ts`, `video-lab/client/`, `scripts/video-lab/start.mjs` (`npm run lab`) |
| Tests | `tests/video-engine/engine.test.ts`, `tests/video-engine/camera-and-modes.test.ts` |

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
   - the scenes are scaled to the requested length (each 1.2 to 8 s, 2 to 8 scenes; a video clip layer may make one
     scene and skips the 6-second floor);
   - layout repairs, described under "Validator repairs" in Templates below.
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

`lib/video-engine/templates.ts`: 33 templates in 9 categories, like Higgsfield's Marketing Studio:

| Category | Templates |
| --- | --- |
| Product shot | Product hero, Studio turntable, Macro details, Fresh splash |
| Motion | Bold words, Hypermotion, Dark minimal, Colour pop, Typography poster |
| UGC | Customer review, Unboxing, POV moment, Problem to fix |
| TikTok | This saved me, 3 reasons, Secret hack |
| Ads | Offer flash, Kigali price-first, TV spot, Brand story |
| Posters & offers | Event poster, Price drop |
| Marketplace | Listing video, Colour options |
| Cinematic | Cinematic story, Golden hour, Local market |
| 3D motion | 3D title drop, Showroom turntable, Glass cards, Chrome luxe, Confetti launch, Floating product reveal |

- **Art direction:** each template gives the layout, the camera language, the look and the pacing.
- **UGC templates:** these are marked `presenter`. Until AI influencers exist, they are carried by the product and
  first-person captions.
- **Gallery previews:** each template has a live example video, made once (`POST /api/template-previews`, kept in
  `video-lab/data/template-previews/`). It plays when the mouse is over its card.
- **Per-template limits:** the Brain's `templateStyle` and `STYLE_LIMITS` (`brain/score.ts`) set how many text lines a
  scene may hold (luxury 2, direct and showcase 3, lists 5); `productMinHeight` (`templates.ts`) sets how much of the
  frame height the product fills (55% on product hero, studio and showroom turntable and floating reveal, nothing
  forced on text-led templates, 45% on the rest).

### Validator repairs

`validateSpec` (`validate.ts`, `subject.ts`) repairs what a design gets wrong, so the same rules hold for every design,
edit and re-shape. `designVideo` passes it the photos (size and cut-out box), platform, phone, `productMin`, `maxLines`,
`facts` and `purpose`.

- **Safe areas:** text, and the pill or badge behind it, stays inside the platform's area from the Brain
  (`safeAreaFor`); price, phone and call to action sit in the middle band on Shorts.
- **Legibility:** contrast-checked colours, a veil on photos and clips under light text, minimum sizes, reading time,
  texts kept apart by the height they are drawn at (wrapped word by word).
- **Product:** text and badges are moved off the product (a cut-out, a turntable, or a photo card kept clear whole).
  A product photo grows to the template's minimum height, or shrinks to the room its text leaves.
- **Shapes in the frame:** a ring, circle, burst or blob meant to sit inside the frame stays inside it at its largest
  keyframe scale and under camera moves. A badge that carries a price is centred on it and arrives with it.
- **Line limits:** a scene over its template's limit sends its smallest line to a neighbouring scene with room, or
  drops it (the price and the number do not count).
- **Ratings:** star ratings, review counts, "rated", "customers love" and a drawn row of 4 or 5 stars are removed
  (with the spoken and caption sentences) unless the facts give them.
- **Phone:** a quiet number line in every scene of a vertical ad, and the end card's number labelled ("WhatsApp …",
  "Call or WhatsApp …"). A page post (`purpose: "post"`) keeps the number for its end card only, unlabelled.
- **Re-shape:** see "Re-shape (another ratio)" below.

### QA (17 October 2026)

QA_NUMBERS_HERE

## 3D look

Claude is the specialist in 3D motion graphics. The renderer draws a "3D look" on the plain 2D canvas (no WebGL), so
the owner's browser and the video robot's headless Chrome draw the same pixels. Every value comes from the frame time,
so a re-render of a frame is identical (a test draws the same frame twice and compares every canvas call). Fields
(`lib/video-engine/spec.ts`, checked and repaired by `validate.ts`, taught to Claude in `SPEC_FORMAT`):

| Field | What it draws |
| --- | --- |
| `scene.light` `{ x, y, intensity, color, fog, fogColor }` | The key light. It lights 3D letters, turntables, glass and metal, and photos (a highlight on the near side, shade and a cast shadow on the far side), with a soft beam where it shines from (fainter over photo backgrounds). `fog` fades far layers (low depth) and adds haze. |
| `text.text3d` `{ depth, side, bevel, spin, material }` (or `true`) | Extruded letters: stacked copies run back towards the camera's vanishing point and away from the light, so the sides turn as the camera orbits or pans. A lit face, an optional bevel rim, a spin-in on entrance, and a metal or glass face (with a dark outline so it reads on any background). |
| `photo.turntable` `{ spin, angle, reflection, sweep }` (or `true`) | The photo swings round in true perspective (columns clipped to a straight-edged trapezoid) with a card edge. It stands on its own lit floor, with a contact shadow and a reflection that fades out, and a shine glides across it. It always stays inside its box, so text placed outside it is never covered. |
| `kind: "particles"` `{ particle, count, colors, size, speed, seed }` | `dust`, `sparkles`, `bokeh`, `confetti` or `bubbles`, seeded. Each particle has its own depth (its own parallax); confetti flips in 3D; bubble glints follow the light. |
| `material: "glass" \| "metal"` (shapes, `text.box`) | Glass: a frosted see-through tint with a bright rim and a sheen. Metal: brushed bands lit by the key light, for small parts only (badges, bars, rings, bursts). |

- **Code:** the maths is in `animate.ts` (`extrusion`, `vanishingPoint`, `turntableAt`, `turntableColumn`,
  `particleAt`, `fogAmount`); the drawing is in `draw3d.ts` (`turntableFit` keeps the turntable in its box). A camera
  zoom never pushes text past 92% of the width.
- **Templates:** a "3D motion" category with 3D title drop, Showroom turntable, Glass cards, Chrome luxury and Launch
  party; Studio turntable uses `turntable` too.
- **Rules for Claude (`systemPrompt`):**
  - 3D for hooks, prices and end cards, with an orbit or pan camera so the sides turn.
  - Never a large metal or glass panel, and never over the product.
  - Rings go around their text.
  - Text on a gold or silver shape must contrast with it.
  - Text boxes never overlap the product's box.
  - Photo backgrounds under text are dimmed 0.45 to 0.6.
- **Quality loop (17 October 2026):** three rounds of real designs (3D title drop and Showroom turntable for Nova Phones
  Galaxy A56, Chrome luxury for the Kibagabaga house, plus a Kinyarwanda version), rendered and checked frame by
  frame. The rounds fixed:
  - text over the turntable;
  - floor glow in the wrong place;
  - metal slabs;
  - gold on gold;
  - silver on light photos;
  - phone numbers in the voice;
  - captions pushed to the edges by a crash zoom.
- **Limits:**
  - The turntable turns the whole photo like a card; it looks best with product photos on plain backgrounds (there
    is no background removal).
  - Glass has no real backdrop blur, and fog is a filter approximation.
- **Cut-outs (free, no AI):** `cutout.ts` lifts a product off a plain background (border check, flood by colour that
  stops at edges, the photo's own shadow removed, 2-pixel shave and feather, trimmed PNG). Busy photos (shops, rooms,
  streets) are refused with a reason. `video-lab/cutouts.ts` caches them in `video-lab/data/cutouts/`. A photo layer
  with `cutout: true` (turntable or `fit: "contain"`) uses the cut-out loaded under the key `${n}:cutout`
  (`loadPhotos(urls, cutoutUrls)`), and the brief marks such photos "cut-out available".
- **Speed:** 2 to 27 ms per frame at 720p in headless Chrome. A 13-second 480p MP4 with sound takes about 20 s.

## Voice-over

Each scene's `say` line is spoken by ElevenLabs (`eleven_multilingual_v2`, the default voice JB Pro from
`lib/voice/voices.ts`) in one take "with timestamps" (the time of every character). The take is cut into one cue per
scene, and the scenes are stretched so each lasts at least its line.

- **`lib/video-engine/voice.ts`:** has no `"server-only"` import, because `lib/ai/tts.ts` cannot be bundled into the
  lab.
  - `speakSpec(spec, { apiKey, voiceId?, model?, fetchImpl? })`: the take and each line's timing.
  - `fitSpecToVoice(spec, voice)`: returns `{ spec, cues, fits }`. Each line plays 0.15 to 0.25 s after its scene
    starts, a scene shorter than its line is stretched (up to 8 s), and a line that still does not fit runs into the
    next scene. Over 30 s, scenes without a line are shortened first; the voice is cut only as a last resort
    (`fits: false`).
  - `placeVoice` and `cueTimings` are pure and shared with the browser.
- **`video-lab/voice.ts`:** `makeVoiceForJob(spec, jobId, { voiceId?, language? })` returns `{ hash, url, spec, cues,
  fits, voiceId, characters, durationMs, costUsd, cached, spokenLanguage, note }`.
  - It keeps the take in `video-lab/data/voice/<hash>.mp3` (+ `.json`), so the same lines in the same voice are never
    paid for twice.
  - It checks the daily cap and records `elevenlabs-voice` in the ledger before the take is used.
  - `readVoiceMp3(hash)` and `VOICE_ROUTE` (`/api/voice/<hash>.mp3`) serve the take.
- **Mixing (`encode.ts`):** `encodeSpecMp4(fittedSpec, photos, { musicUrl, voice: { url, cues } })` mixes with
  `lib/voice/mix.ts`. The voice plays at full level; the music at 85%, ducked to 20% under speech, fading in over 1 s
  and out over 1.5 s.
- **Kinyarwanda (owner rule, 17 October 2026):** the voice model cannot speak Kinyarwanda or Swahili.
  - For those businesses the on-screen text and the caption stay in the content language, and the `say` lines are
    written and spoken in English. French stays French, and the other content languages the model speaks keep their
    own language (`voice-language.ts`, `voiceLanguage`).
  - The designer's brief names the voice-over language.
  - The page gets `spokenLanguage` and a `note` to show the owner.
  - Lines that still look like Kinyarwanda (a design made before this rule) are refused before anything is paid.
- **Writing rules for Claude:**
  - A `say` line on every scene, about 2.5 words per second.
  - The last line is the call to action.
  - Numbers written as people say them (phone numbers in groups).
- **Measured cost:** the sample's four lines were 120 characters, $0.036 (list price $0.30 per 1,000 characters),
  8.8 s of speech; the same lines again cost $0 (cache). A 3D design costs $0.12 to $0.14 API-equivalent (Sonnet 5.5),
  so a 12 to 15 s 3D video with a voice-over is about $0.16 to $0.20.
- **Limits:** the live preview has no sound (the voice is in the exported MP4).

## Re-shape (another ratio)

The studio re-shapes a finished design (9:16 to 1:1 or 4:5) by running `validateSpec` again on the stored spec with the
new `ratio`. No new design is made and nothing is paid. Positions are fractions of the canvas, so every layer keeps its
place, and the validator repairs what the new shape breaks.

- **Pass the same options as `designVideo`:** `photos` (each photo's size and its cut-out box), `platform`, `phone`,
  `productMin: productMinHeight(styleId)` (`templates.ts`) and `maxLines: STYLE_LIMITS[templateStyle(styleId)].maxLines`
  (`brain/score.ts`), `purpose`. Leave `facts` out, so lines the owner wrote are kept.
- **Safe area:** vertical shapes (9:16, 3:4, 4:5) use the platform's area from the Brain (`safeAreaFor`); 1:1 and wider
  shapes use the wide area (5% from each edge). Text, and the pill or badge behind it, moves inside it.
- **Product:**
  - A product photo (a cut-out, a turntable or a photo card) is grown to the template's minimum height (45%, 55% on
    product templates) or shrunk to the room the text leaves.
  - Text and badges are then moved off it: lines go to the bands above and below, a photo card is kept clear whole.
- **Text:** lines are kept apart by the height they are drawn at (wrapped word by word, wider for bold). A square
  canvas has less height, so a narrow column of words grows taller.
- **Shapes:** a ring, circle, burst or blob meant to sit inside the frame stays inside it at its largest keyframe scale
  and under camera moves (a ring around a title ran off the left edge at 1:1).
- **Phone and end card:** the quiet phone line is added only on vertical shapes. The end card's bare number gets
  "WhatsApp" or "Call or WhatsApp", except on page posts.
- **Repeatable:** most designs come back unchanged when validated again (45 of the 60 loop-6 designs). The others move a
  line by a few hundredths.

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

## The Video Studio (17 October 2026)

Owner decisions: the studio is **BuPulse's video studio** (BuPulse brand, RWF credits, BuPulse clients later), built
"fully like Seedance and Higgsfield", with **Seedance 2.0 through BytePlus** for real video and the Claude engine for
instant motion videos. It runs outside the app for now (`npm run lab`, http://localhost:3100) so it can be tested
today; it joins the app once the design is approved.

| Page | What it is |
| --- | --- |
| `/` | Home like seedance2ai.io: hero video with a quick prompt box, the model cards (AI video, AI image, Claude 3D motion) with their credit prices, showcase, "How to create" in 3 steps with studio screenshots (`video-lab/site/static/`), features, use cases, example quotes (labelled as examples), pricing, FAQ |
| `/app/video/seedance-2-0`, `-fast`, `-mini` | One generator page per Seedance tier: the Create page with that tier preselected, plus the model's blurb, what it is good at, its credits per 5 s and example prompts that fill the prompt box |
| `/app/video/seedance-2-5` | Coming soon: same look, explains it arrives with the BytePlus key; its example prompts open Seedance 2.0 |
| `/app/video/motion` | Claude 3D motion: the Create page with the Motion engine preselected |
| `/app/image/nano-banana` | AI image (Gemini): a prompt and up to 3 reference photos (product photos or uploads), 5 shapes, 15 credits an image (charged first, refunded on failure). Each image is saved as an upload with a gallery; "Use in a video" opens `/create?ref=<id>` with it as Image 1 |
| `/api-docs` | The studio's JSON API for developers (quote, uploads, Seedance submit and jobs, motion design, image, showcase, errors); keys per business come with the app |
| `/create` | The studio, like Higgsfield's Marketing Studio: a hero carousel of videos, one prompt bar for both engines (Real video / Motion), pill settings (mode, template, ratio, duration, quality, more, versions), Avatar and Product tiles, Generate with the credits, your generations, the template gallery with live previews. A drawer shows each video with edit and extend |
| `/showcase`, `/videos` | Every finished video of both engines, with a viewer showing the prompt or caption and the cost |
| `/pricing` | Credit packs in RWF (test wallet top-ups, no payment), the Seedance rate table, the wallet |
| `/guide` | How to use it, prompt tips, FAQ |
| `/lab` | The earlier developer lab page, kept |

Every page has the language switcher EN / FR / RW (`video-lab/site/client/i18n.ts`: elements marked `data-i18n` take
French or Kinyarwanda from a dictionary; the choice is kept in the browser). Old and seedance2ai-style paths redirect
(`/app/video/seedance?tier=…`, `/templates`, `/developers`, `/explore`, `/prompt-guide`); unknown pages show a 404
page with links. The models and their copy live in `video-lab/site/models.json` (the build, the server routes and the
pages read it). Videos are served with Range requests, so a page full of videos only reads what it shows.

- **Seedance on the page:** while there is no BytePlus key, Generate on Real video makes a free **preview** (see
  "Preview mode" below): the drawer waits for the storyboard, then shows its frames (SVG, shown as images), the shot
  table, the setting, what it will cost with the key and the usual wait, with "Make it as a Motion video instead" (keeps
  the prompt; asks for a product if none is picked) and "Edit the prompt". Its card shows the first frame. The request
  is checked as you type (`POST /api/seedance/check`): errors (for example "Image 3" with 2 photos, 1080p on Fast) show
  under the prompt bar and block Generate; warnings are shown and do not. **⚡ Quick plan** (`POST /api/seedance/plan`)
  writes BuPulse's own shot plan from the product, free and instant (press again for another plan); **Write with
  Claude** shows its rule checks and says when it fell back to the plan. The notice bar says whether Seedance is
  connected (`GET /api/seedance/status`, checked every 5 minutes). Preview jobs stay out of the showcase.
- **Voice-over (Motion videos):** More, Voice-over (on by default). Making the MP4 first asks for the take
  (`POST /api/jobs/<id>/voice`, ElevenLabs, `video-lab/voice.ts`), renders with the fitted design and the voice, and
  says "Voice cut to fit 30 s" when the lines were too long. **15 credits** a take (`VOICE_OVER_CREDITS`, now in
  `lib/video-engine/credits.ts` with the other prices), taken first
  and given back when it fails, when the design has no lines, or when the same take is already saved (a new MP4 of the
  same design is free). Generate on Motion shows design + voice (35 + 15 = 50 credits). If the voice fails, the MP4 is made
  without it and the page says so. The old `/lab` page has the same toggle. First real take (17 October, Nova Phones,
  219 characters, 12.7 s): $0.066; the 480p MP4 has video and sound tracks.
- **3D motion templates:** the `3d` category ("3D motion": 3D title drop, showroom turntable, glass cards, chrome
  luxury, launch party) is preselected on `/app/video/motion`, with its first template chosen. Category names follow the
  language switcher.

- **Get inspired** (Seedance model pages and `/create` on Real video): the example storyboards
  (`GET /api/seedance/examples`, optional `sector` and `format`, read fresh from `video-lab/seedance-mock/examples/`)
  as a grid: the first frame, title, sector and format, "from X credits"; hover flips through the frames; filter chips
  by sector and format; a card opens the frames, shot list, notes, the price per quality, the product it was made from
  and the preview notice. **Use this** opens `/create` with Seedance, the prompt, 9:16, its length, its product and as
  many of the product's photos as the prompt uses (`?engine=seedance&prompt=…&ratio=…&seconds=…&business=…&product=…&photos=…`).
- **Cut-outs and platforms (Motion):** `GET /api/photo/<id>?cutout=1` serves the product lifted off a plain background
  (`video-lab/cutouts.ts`; 404 with the reason otherwise, for example "The background is not plain"). Each design tells
  Claude which photos can be cut out, and the page loads the cut-outs with the photos (a photo without one just skips
  it). A **platform** pill (Any, Instagram, TikTok, Facebook, YouTube Shorts) goes into the design brief. Every
  template has a live preview, including the six 3D ones and Kigali price-first (made 17 October with Claude on the
  subscription).
- **Premium 3D (Blender)** (Motion, Quality menu; \`video-lab/premium-jobs.ts\`): Claude designs one Blender scene from
  the same brief as a Motion video (\`designBlenderScene\`), then Blender renders it on this Mac (\`renderBlenderScene\`,
  540p or 720p, 4 to 8 s, one render at a time). **100 credits at 540p, 150 at 720p** (\`PREMIUM_3D_CREDITS\`, owner
  decision 17 October from the Blender measurements), taken first and given back when the design or the render fails,
  or when the studio restarts during it. **Render again** (\`POST /api/blender/jobs/<id>/rerender\`, 540p or 720p) renders
  a finished clip's saved scene with the same photos and no new design: **70 credits**. Measured: a 6 s 540p re-render
  took 9 min 37 s while the Mac's load average was about 100 (other agents rendering). The drawer lists the fact
  warnings and the scene repairs the studio made to Claude's scene. The server copies the photos it already holds
  (and their cut-outs) into the job's own folder and gives Blender only those paths: nothing from the browser or from
  Claude becomes a file path. Routes: \`GET /api/blender/status\` (the option is disabled with a note when Blender is
  missing), \`POST /api/blender/render\` (the Motion design body; answers the job at once), \`GET /api/blender/jobs\`,
  \`GET /api/blender/jobs/<id>\` (status, progress 0 to 1, then the video), \`/videos/blender/<id>.mp4\`. The drawer shows
  the progress, then the video, the caption and the fact warnings; finished clips appear in the showcase as
  "Premium 3D". First real clip (17 October, Kitenge summer dress, Showroom turntable, 6 s, with the cut-out): 5
  minutes in all, 4 min 31 s of it Blender, while other agents used the Mac.
- **Fact check and research score (Motion):** each design keeps the designer's \`warnings\`; the drawer lists them
  under "Check these facts" (red: not in the product's facts; amber: only in the business description) and cards show
  "N facts to check". When the designer returns a \`score\`, the drawer and cards show "Research score N/100" and what
  it missed.
- **Add BuPulse text (Seedance):** a finished clip's drawer offers "Add BuPulse text (free)": \`POST
  /api/seedance/jobs/<id>/overlay\` builds \`seedanceOverlaySpec\` (the clip as a full-frame video layer, the hook in the
  first 3 s, the price on the product shot, the phone bar on every scene, the call to action at the end) and checks it
  with \`validateSpec\`. The drawer plays it live (the clip's frames under the text, \`openVideoFrames\`), then "Make MP4
  with text" encodes it in the browser like a Motion video and saves it as the job's "with text" version
  (\`/videos/seedance/<id>-text.mp4\`, kept in \`video-lab/seedance-overlays.ts\`, not in the Seedance job). It shows the
  caption and hashtags with their caption check. No credits. In preview mode (no key, no clip) the same step runs on
  a **stand-in**, a finished studio MP4 with sound of the same product when there is one, labelled "Stand-in clip" in
  the drawer only. Tested 17 October on a Galaxy A56 preview: 5.09 s MP4 with video and sound tracks, the stand-in's
  frames moving under the hook, price, call to action and phone bar, caption check 100.
- **Ad or post (Motion):** an "Ad / Post" pill next to the platform. Post means an organic post on the business's
  page: the brief carries \`purpose: "post"\` (read by the Brain's context, the design score and the caption check),
  the job keeps it and its card shows "Post". Tested: a Galaxy A56 post scored caption 85 with the post rule (0 to 3
  hashtags) and research 94. Still open: the opening-line chips ignore purpose, and the validator puts the number on
  every scene of a post too (reported to the Brain and the motion engine).
- **Plan a week (Motion):** "📅 Plan a week" (at the end of the opening-line chips) runs the Brain's \`planSeries\` for
  the product (\`GET /api/plan\`, free): seven days with platform, opening line, template, length and a note. Each row's
  **Generate** fills the form (template, platform, length, voice, the chosen line) and makes it as a normal Motion
  design (35 credits).
- **First comment (Motion and Seedance):** under the caption, "First comment (pin it)" with a Copy button: the Brain's
  \`firstCommentFor\` (\`GET /api/first-comment\`): the price, the place and the WhatsApp number, or the Kinyarwanda kit
  ("Igiciro ni … / Turi i … / Nandikira kuri WhatsApp …") for a Kinyarwanda business.
- **Opening lines (Motion):** once a product is chosen, three chips above the prompt bar give the Brain's opening
  lines for that product, template, platform and length (\`GET /api/hooks\` → \`suggestHooks\`; the reason is the
  tooltip). A click chooses one (a second click lets Claude choose); the design then gets the Brain's context for it
  (\`brainContext(brainBriefFromDesign(brief), { chosenHook })\` as the brief's research). Tested: "Samsung Galaxy A56 ·
  420,000 RWF" became scene 1's opening text, caption check and research score 100.
- **Caption check (Motion):** after each design the Brain's \`scoreCaption\` checks the post caption and hashtags for
  the platform; the job keeps \`captionScore\` and \`captionMissed\` (an edit or extend with the same caption keeps the
  parent's). The drawer shows "Caption check N/100", the caption and what it misses; cards under 70 get a badge.
- **Premium 3D sound (prepared):** a "Recording the voice-over…" step between design and render makes the scene's
  spoken line with ElevenLabs (10 credits, given back when it fails or the take is reused) and picks a library track,
  both kept in the job's folder. It is switched off (\`BLENDER_MIXES_AUDIO\` in \`video-lab/premium-jobs.ts\`) until
  \`renderBlenderScene\` mixes sound in: until then clips are silent and the menu says so.
- **Generations and the drawer:** every card shows a poster (the MP4 one second in, the live first frame of a design,
  or a storyboard frame with its name in a bar underneath). The drawer is two columns: the player as tall as the screen
  allows on the left (the finished MP4 with its voice when there is one, else the live preview), the details on the
  right. The hero carousel shows 7 real clips (only the centre one plays; the others show a still) (5 MP4s were made on 17 October through the page, 1080p with voice-over:
  Launch party, 3D title drop, Kigali price-first, Showroom turntable and Floating product reveal). Cut-outs are asked
  for only when they exist or were never tried (`GET /api/cutouts`; `/api/products` marks each photo `cutout`
  true, false or null), so the console shows no 404 per photo.
- **Builds never take the studio down:** `npm run lab` builds into `video-lab/.build-next` and swaps it in only when
  every step worked; when a build fails (an agent mid-edit in a shared file) it prints the error and starts the last
  good build.

**Online access:** see "Online access (video.bupulse.com)" below (password gate, tunnel, supervisor).

**Seedance (real video)** (`lib/video-engine/seedance.ts`, `video-lab/seedance-jobs.ts`):

- Modes: reference (up to 9 images, 3 videos, 3 audio), text, image to video (first frame), first and last frame,
  edit (the finished video as Video 1 plus the change) and extend. Quality Mini, Fast or Pro; 480p, 720p, 1080p;
  7 ratios; 4 to 15 s; sound; fixed lens (asked for in the prompt); draft (a cheap 480p clip); seed; 1 to 3
  versions. Offline (flex) is kept in the settings for when BytePlus adds it to the 2.0 series; today it runs online.
- A job charges credits first, creates the BytePlus task, polls every 10 s, downloads the MP4 as soon as it is ready
  (the BytePlus link lasts 24 hours) and refunds the credits when the task fails or is cancelled. Polling resumes after
  a restart. References go as embedded data (the lab has no public address); real usage tokens are priced and logged.
- **Write it with Claude** (`lib/video-engine/seedance-prompt.ts`): Claude writes the Seedance shot list from the
  product facts, the template and the references (only facts, references by number, product fidelity, no real faces).
  Its system prompt is the brain's rules and camera words; its brief carries the brain's starting shot plan. If Claude
  cannot be reached, the plan itself becomes the prompt (`fallback` says so), and every answer is checked
  (`issues`).
- Waiting for `SEEDANCE_API_KEY` (BytePlus ModelArk, ap-southeast-1) and the digital character library. Until then
  every Seedance request becomes a free **preview** (below). Everything else is built and unit-tested against the
  documented API; the first real clip will confirm it.

**Seedance brain** (`lib/video-engine/seedance-brain.ts`, no AI, instant):

- **Shot types and camera words** Seedance responds to: 13 shot types (macro, close-up, selfie, POV, top-down, hero end
  shot...) and 15 camera moves (slow push-in, orbit, gimbal walk-through, drone, handheld, whip pan, rack focus...),
  each with what it is good for.
- **30 templates** by business (shop, restaurant, salon, phone shop, real estate, fashion, events, services,
  education, plus 6 for any business) and format (product reveal, UGC testimonial with a fictional presenter, before
  and after, unboxing, tour, offer). Each is 3 to 5 timed shots with a Rwandan setting, light, music, sounds and the
  spoken lines it may use.
- **Rules** for Claude (`SEEDANCE_RULES`): time structure, one camera move per shot, a hook in the first 1 to 2 s, the
  product exactly as in its photo, references by number, only facts from the brief, no real faces (fictional adults or
  library characters), no text in the video (captions are added afterwards), sound lines in quotes, and **no spoken
  line in Kinyarwanda or Swahili** (Seedance does not speak them reliably; the ElevenLabs voice-over goes on top).
- **`planSeedanceShots(brief)`**: picks a template (asked for, or by the business kind it reads from the product and
  business text, and the format of the chosen Claude template) and fills it: whole-second time codes adding up to the
  length, one shot every 2.5 to 3 s, the product named with its photo ("the Galaxy A56 from Image 1" plus one fidelity
  sentence), the house or venue photo as the place, at most 1 spoken line up to 8 s and 2 above, only the price, the
  first "why buy" and the business name as facts. It returns notes for the owner (no photo, fictional presenter, no
  price, no Kinyarwanda line).
- **`checkSeedanceRequest(req)`**: before anything is paid, in plain English. Errors (BytePlus would refuse): a
  quality that cannot make the resolution (Fast or Mini at 1080p), more than 9 photos, 3 videos or 3 audio, audio
  without a photo or video, a closing frame without an opening frame, a ratio Seedance does not make, a bad seed, an
  empty prompt, a prompt naming "Image 3" when 2 photos are attached. Warnings: durations outside 4 to 15 whole
  seconds, a draft at 720p or 1080p (drafts are 480p), labels that look like a person (faces cannot be detected here),
  text asked for in the video, camera moves with a fixed lens, a spoken line with sound off, time codes that do not add
  up, very large references. It also returns the estimated cost.

**Preview mode** (`video-lab/seedance-mock/`, while there is no key):

- `submitSeedance` does not throw without the key: it makes a job with status `preview` (credits 0, the real price in
  `preview.wouldCostCredits`, the notice "Preview: Seedance arrives with the BytePlus key...") that becomes
  `preview-ready` after 3 to 8 seconds. No credits are charged, cancelling refunds nothing.
- The storyboard (`getSeedancePreview(id)`) is read from the prompt itself, whoever wrote it: the setting, each shot
  (time, shot type, camera move, action, sound, spoken line, which reference it uses), 3 or 4 sketched frames as SVG
  (the reference photo inside when the shot uses one, the camera move drawn on top), the reference list with small
  photos, the estimate (dollars, credits, the usual wait: Mini about 3 to 4 minutes, Fast 4 to 5, Pro 6 to 7) and the
  checks above.
- With the key, nothing changes: the same call charges, creates the BytePlus task and polls. Offline (flex) tasks are
  now checked every minute for up to 48 hours (BytePlus keeps them up to 48 hours), not refunded after 20 minutes.

**Example storyboards** ("Get inspired" on the Seedance pages; `video-lab/seedance-mock/examples/`): 12 free
storyboards made from the TEST database's real products with the brain and the storyboard renderer, with no key, no
Claude and no cost (`node --env-file=.env scripts/video-lab/seedance-examples.mjs`; `--list` shows the products and
their sectors). The sectors take turns and each one goes through the formats it shows best, so all 6 formats appear.
Each file has the title, sector, format, template, prompt, notes, the storyboard with its SVG frames and the
product's photos, the credits the real clip would cost at every quality and resolution, and the product and business
it came from. Only the products' own facts are used. A price with conditions in brackets, like "90,000 RWF (depends on
the size)", is never spoken, and long names are shortened in the shots. `listSeedanceExamples({sector, format})`
(`video-lab/seedance-mock/preview.ts`) reads them in gallery order. On 17 October 2026 they come from 4 clearly-test
businesses (a phone shop, a fashion boutique, real estate and a cleaning service). A business that looks like a real
company is left out (owner decision): `--skip "<name>"`, kept for every later run in the git-ignored
`video-lab/data/seedance-examples-skip.txt`. So shop, salon, restaurant, events and education have no examples until test products exist. The sector is
read from the product name first, then its summary, then the business, so a real-estate agency's cleaning service
counts as a service.

**Seedance overlay** (BuPulse's text over a finished clip; `lib/video-engine/seedance-overlay.ts`,
`lib/video-engine/video-source.ts`): a Seedance clip has clean frames, so the price, the number, the hook and the call
to action are drawn on top by the motion engine. `seedanceOverlaySpec({ brief, clipUrl, prompt?, shots?, seconds? })`
builds a MotionSpec with these parts:

- **Scenes:** one scene per shot, all cuts, each with a full-frame `video` layer (`start` = where in the clip the scene
  begins, `sound` = keep the clip's own audio). Shots under 1.2 s join a neighbour.
- **Text:** the hook in the first 3 s (the Brain's best hook that the facts can fill), the price on the product shot,
  the number on every scene and the call to action on the last. A calm template shows a small quiet number on its first
  shot, then the bar.
- **Placement and language:** everything is inside `safeAreaFor(platform)` (on Shorts the price, number and call to
  action sit in the middle band), with sizes at or above the validator's 0.03, so `validateSpec` moves nothing. Text is
  in Kinyarwanda for a Kinyarwanda business ("Kuri … gusa", "Duhamagare").

`seedanceOverlayCaption(brief)` fills the Brain's caption formula and falls back to BuPulse's complete form; the one
returned passes `scoreCaption` on TikTok, Instagram, Facebook and Shorts in English, French and Kinyarwanda.
`VideoSource.open(url)` / `frameAt(ms)` gives the renderer the clip's frames: mp4box reads the sample table (npm
`mp4box`, exact 2.4.1), WebCodecs decodes front to back from the nearest keyframe, and a small cache closes old frames.

**What Seedance 2.0 takes** (the ModelArk API reference "Create a video generation task" and the Seedance 2.0 tutorial,
read 17 October 2026; `video-lab/seedance-references.ts` applies it):

| Input | How it can be sent | Limits (Seedance 2.0, Fast, Mini) |
| --- | --- | --- |
| Text prompt | in the request | English (also Spanish, Indonesian, Portuguese, Japanese); up to about 1,000 words, best 60 to 160 |
| Images (`image_url`, role `reference_image`) | public URL, Base64 `data:image/<format>;base64,...` (lowercase format), or `asset://<id>` | 0 to 9; jpeg, png, webp, bmp, tiff, gif, heic, heif; 300 to 6,000 px a side; width/height 0.4 to 2.5; under 30 MB each |
| First frame / first + last frames (roles `first_frame`, `last_frame`) | as images | 1 or 2 images; cannot be mixed with reference videos or audio (different modes) |
| Videos (`video_url`, role `reference_video`) | public URL or `asset://<id>` only, never Base64 | 0 to 3; mp4 or mov; 2 to 15 s each and 15 s in all; 300 to 6,000 px; 407,696 to 8,295,044 pixels; 24 to 60 fps; under 200 MB |
| Audio (`audio_url`, role `reference_audio`) | public URL, Base64 `data:audio/wav` or `data:audio/mp3`, or `asset://<id>` | 0 to 3; wav or mp3; 2 to 15 s each and 15 s in all; under 15 MB; never alone (an image or video with it) |
| The whole request | | 64 MB at most ("do not use Base64 for large files") |

- **Not on the 2.0 series:**
  - `camera_fixed` (1.x only): BuPulse writes "static camera" into the prompt instead.
  - `draft` (2.5 and 1.5 pro only): a BuPulse "draft" is a normal 480p clip.
  - `service_tier: "flex"` (not yet): it runs online.
  - None of these are sent.
- **Tasks:** BuPulse sets `execution_expires_after` to 1 hour, so a task BytePlus has not finished by then ends unbilled
  and the studio gives the credits back. Prompts name references as "Image 1", "Video 1", "Audio 1", counted per kind
  in the request's order. Real human faces are refused; digital characters (`asset://`) and authorized real-person
  assets are the way.
- **Images from the studio go inline:**
  - product photos as JPEG; cut-outs (`co:<photo>`) as PNG, keeping the transparency; presenter portraits
    (`pp:<presenter>`) as JPEG;
  - turned upright, padded into 0.4 to 2.5 (a cut-out with transparency), the long side kept to 2,048 px and the short
    side at least 300 px;
  - made smaller (1,536, then 1,024, then 768 px) if all the inline data would pass 48 MB.
- **Videos go as a public link only through the tunnel:** `STUDIO_PUBLIC_URL`, e.g. `https://video.bupulse.com`.
  The link must be https and not local, and it is used only when the file answers there. Otherwise the video is left
  out and the owner is told why. Each kind keeps the page's order, so the labels the prompt writer saw ("Image 1: …")
  match.
- **Dry run:** `node scripts/video-lab/seedance-check.mjs --dry [--image photo.jpg] [--cutout product.png] [--audio
  song.mp3]` prints the exact request body with each file summarised (format, size, pixels), the checks and the
  estimated cost. It needs no key and sends nothing.

**Going live with Seedance** (the owner's steps; BytePlus console wording may differ slightly):

1. Sign in at console.byteplus.com with the BuPulse account. ModelArk activates Seedance 2.0 only with a balance over
   USD 30, an AI Savings Plan of USD 30 or more, or a Seedance resource pack with quota (the prepaid pack).
2. Open **ModelArk** and choose the region **Asia Pacific (ap-southeast-1)** at the top. The key and the models must
   be in this region (the studio calls `https://ark.ap-southeast.bytepluses.com/api/v3`).
3. **Activate the models:** ModelArk, Model activation (or Model management), find **Seedance 2.0**, **Seedance 2.0
   Fast** and **Seedance 2.0 Mini**, and activate each (accept the terms).
4. **Digital character library:** in ModelArk, open the digital character (virtual human) assets, apply or activate
   if asked, and pick or create the presenters BuPulse will use. Each one has an id like `asset://...`: send the ids
   to Claude to add them to the presenter list. Without it, people are only fictional and described in words.
5. **API key:** ModelArk, API keys, Create API key. Copy it.
6. Open `.env` in `/Users/macbook1/BuPulse-video` and add one line: `SEEDANCE_API_KEY=` followed by the key (no
   quotes, no spaces). Do not paste it in a chat.
7. In Terminal, in that folder: `node --env-file=.env scripts/video-lab/seedance-check.mjs`. It lists one task at
   BytePlus (free) and says **connected**, **key invalid**, **not activated** or **unreachable**, with what to do.
8. Optional, free: `node scripts/video-lab/seedance-check.mjs --dry` shows exactly what will be sent.
   When it says connected: `node --env-file=.env scripts/video-lab/seedance-check.mjs --make-clip`. This makes the
   first real clip (Seedance 2.0 Mini, 480p, 4 s, text only, with sound, about **$0.14**), waits for it (usually 1 to 4
   minutes), saves it in `video-lab/data/seedance/videos/check-....mp4` and writes the real cost to the lab ledger.
   It respects the lab's daily cap. Ctrl+C cancels a queued task.
9. Restart `npm run lab`. The studio now sends real Seedance jobs; previews stop.

Checked on 17 October 2026: the ModelArk address answers, and a made-up key gets `401 AuthenticationError`, which the
check reports as "key invalid".

**Credits** (`video-lab/credits.ts`): 1 credit = 10 RWF. A price is the estimated provider cost x 2.2 margin, rounded
to 5 credits: for example Seedance Fast 720p 5 s = 190 credits (1,900 RWF), Mini 480p 5 s = 55, Pro 1080p 5 s = 590;
a Motion video = 30 credits; a presenter image = 15. Packs: 1,000 credits for 10,000 RWF, 3,500 for 30,000, 7,500 for
60,000. The lab wallet starts with 5,000 test credits (`VIDEO_LAB_START_CREDITS`). In the app these become plan
allowances and MoMo add-ons.

## Studio pages and buttons (QA 17 Oct)

A Playwright pass over every studio page (Chrome, 1440 px and 390 px wide): every link on every page was opened, and
every button that does not spend credits was clicked, plus the sign-in page as an online visitor. **110 of 110 work**,
with no script errors on any page (fifth pass, after the Seedance previews and gallery, voice-over, 3D templates,
cut-outs, the platform picker, Premium 3D, the fact checks, the password gate and the visual pass on /create). Fixed during the passes: links that lost their query (`/app/video/seedance?tier=mini` opened the
default tier), `#influencers` that opened nothing, the quality and options menus cut off by the hero, pill buttons
that did nothing until the database had answered, pickers that opened only after their data arrived, the nav wrapping
at 1280 px, and pages full of videos that downloaded every MP4 in full (no Range support) and blocked the browser's
connections to the studio.

| Page | Button or link | Where it goes / what it does | Works |
| --- | --- | --- | --- |
| every page (nav/footer) | link "B BuPulse Video Studio" | / | yes |
| every page (nav/footer) | link "AI video ▾" | /app/video/seedance-2-0 | yes |
| every page (nav/footer) | link "Seedance 2.0 Fast (Quicker and cheaper)" | /app/video/seedance-2-0-fast | yes |
| every page (nav/footer) | link "Seedance 2.0 Mini (Best value)" | /app/video/seedance-2-0-mini | yes |
| every page (nav/footer) | link "Seedance 2.5  (soon, the next model)" | /app/video/seedance-2-5 | yes |
| every page (nav/footer) | link "Claude 3D motion (Instant animated videos)" | /app/video/motion | yes |
| every page (nav/footer) | link "AI image" | /app/image/nano-banana | yes |
| every page (nav/footer) | link "Templates" | /templates (lands on /create) | yes |
| every page (nav/footer) | link "Showcase" | /showcase | yes |
| every page (nav/footer) | link "Pricing" | /pricing | yes |
| every page (nav/footer) | link "Guide" | /guide | yes |
| every page (nav/footer) | link "API NEW" | /api-docs | yes |
| / | link "Premium 3DKitenge summer dress" | /showcase#bl-ccf2f2564cd3 (lands on /showcase) | yes |
| / | link "Video tile: Samsung Galaxy A56" | /showcase#20261017-f81fcb95 (lands on /showcase) | yes |
| / | link "Video tile: Samsung Galaxy A56" | /showcase#20261017-a7150886 (lands on /showcase) | yes |
| / | link "Video tile: Kitenge summer dress" | /showcase#20261017-6cade78f (lands on /showcase) | yes |
| / | link "Video tile: Kitenge summer dress" | /showcase#20261017-843b1a68 (lands on /showcase) | yes |
| / | link "Video tile: Samsung Galaxy A56" | /showcase#20261017-89f68a6a (lands on /showcase) | yes |
| / | link "Video tile: 3-bedroom house with garden, Kibag" | /showcase#20261017-a87cc367 (lands on /showcase) | yes |
| / | link "Video tile: 3-bedroom house with garden, Kibag" | /showcase#20261016-3a334e91 (lands on /showcase) | yes |
| / | link "Video tile: Samsung Galaxy A56" | /showcase#20261016-f0ba04ce (lands on /showcase) | yes |
| / | link "Get credits" | /pricing#pack-starter (lands on /pricing) | yes |
| / | link "Get credits" | /pricing#pack-business (lands on /pricing) | yes |
| / | link "Get credits" | /pricing#pack-studio (lands on /pricing) | yes |
| every page (nav/footer) | link "AI influencers" | /app/video/motion#influencers (lands on /app/video/motion) | yes |
| every page (nav/footer) | link "My videos" | /videos | yes |
| every page (nav/footer) | link "FAQ" | /guide#faq (lands on /guide) | yes |
| every page (nav/footer) | link "Developer lab" | /lab | yes |
| /app/image/nano-banana | link "Use in a video" | /create?ref=up-d3db27b561aa | yes |
| /app/image/nano-banana | link "Use in a 3D motion video" | /app/video/motion?ref=up-d3db27b561aa | yes |
| every page | AI video menu (hover) | shows 5 models | yes |
| every page | Language FR | page text in French | yes |
| every page | Language RW | page text in Kinyarwanda; kept on the next page | yes |
| every page | Language EN | back to English | yes |
| every page | Wallet chip | /pricing | yes |
| every page (phone width) | Menu button ☰ | opens the nav; page width 390px | yes |
| / | Make a real video (quick prompt) | /app/video/seedance-2-0?prompt=… | yes |
| / | Make a 3D motion video (quick prompt) | /app/video/motion?prompt=… | yes |
| / | Model card prices | credits from /api/pricing; 90 to 190 credits per 5 s (by resolution) | yes |
| / | Showcase tile | /showcase#<id> opens the video | yes |
| / | How to create screenshots | /static/step-1..3.jpg load | yes |
| / | FAQ items | open and close | yes |
| /app/video/seedance-2-0 | Opens preselected | seedance, Seedance 2.0 ·; quality Seedance 2.0 · 720p, Generate shows ✦ 240 | yes |
| /app/video/seedance-2-0 | Example prompt | fills the prompt box | yes |
| /app/video/seedance-2-0-fast | Opens preselected | seedance, Fast ·; quality Fast · 720p, Generate shows ✦ 190 | yes |
| /app/video/seedance-2-0-fast | Example prompt | fills the prompt box | yes |
| /app/video/seedance-2-0-mini | Opens preselected | seedance, Mini ·; quality Mini · 720p, Generate shows ✦ 120 | yes |
| /app/video/seedance-2-0-mini | Example prompt | fills the prompt box | yes |
| /app/video/motion | Opens preselected | claude, 1080p; quality 1080p, Generate shows ✦ 40 | yes |
| /app/video/motion | Example prompt | fills the prompt box | yes |
| /create | Opens preselected | seedance, Fast ·; quality Fast · 720p, Generate shows ✦ 190 | yes |
| /app/video/<model>, /create | Mode pill | opens its menu, a choice applies | yes |
| /app/video/<model>, /create | Ratio pill | opens its menu, a choice applies | yes |
| /app/video/<model>, /create | Duration pill | opens its menu, a choice applies | yes |
| /app/video/<model>, /create | Quality pill | opens its menu, a choice applies | yes |
| /app/video/<model>, /create | More options pill | opens its menu, a choice applies | yes |
| /app/video/<model> | Versions − / + | 1 to 4 | yes |
| /app/video/<model> | Template pill | scrolls to the templates | yes |
| /app/video/<model> | Template card | selects the template; Macro details | yes |
| /app/video/<model> | Engine Motion / Real video | switches engine | yes |
| /app/video/<model> | + (references) | picker with upload, videos and photos; 1 choices | yes |
| /app/video/<model> | Reference tile (click) | removes it | yes |
| /app/video/<model> | Upload (in + picker) | opens the file chooser | yes |
| /app/video/<model> | PRODUCT tile | product picker, sets product and photos | yes |
| /app/video/<model> | AVATAR tile | presenter picker (closed without choosing: a choice can cost credits); 8 presenters | yes |
| /app/video/<model> | Prompt naming a missing photo | error under the prompt bar; Generate blocked | yes |
| /app/video/<model> | ⚡ Quick plan | free shot plan in the prompt box; Quick plan: Golden hour exterior. Press again for another pl | yes |
| /app/video/<model> | GENERATE (Real video, no BytePlus key) | free preview: storyboard frames, shot list, price; no credits; 3 frames; 590 credits with the key; wallet unchanged | yes |
| /app/video/<model> | Preview: Edit the prompt | closes the drawer, prompt back in the box | yes |
| /app/video/seedance-2-0-mini | Preview: Make it as a Motion video instead (no product) | switches to Motion, keeps the prompt, opens the product picker; with a product picked it starts the Motion design (30 credits), not clicked | yes |
| /app/video/motion | Opens on 3D templates | category 3D motion, template 3D title drop; 3D motion, 3D title drop | yes |
| /app/video/motion | More: Voice-over toggle | on by default; Generate shows design + voice credits; ✦ 40 with voice, ✦ 30 without | yes |
| /app/video/motion | Language RW | template categories in Kinyarwanda | yes |
| /app/video/seedance-2-0 | Get inspired: cards | example storyboards; hover flips frames; 12 examples | yes |
| /app/video/seedance-2-0 | Get inspired: sector and format chips | filter the cards; real estate 2, tour 2 | yes |
| /app/video/seedance-2-0 | Get inspired: card | detail: frames, shot list, notes, credits per quality, product | yes |
| /app/video/seedance-2-0 | Get inspired: Use this | /create with Seedance, the prompt, 9:16, the length, the product and its photos; 12s, 2 photo(s) | yes |
| /app/video/motion | Platform pill | Any / Instagram / TikTok / Facebook / YouTube; only for Motion | yes |
| /app/video/motion | Quality: Premium 3D (Blender) | Generate shows 120 credits; lengths 4 to 8 s; the wait is stated | yes |
| /app/video/motion | Premium 3D clip card | drawer with the video, length, credits, render time; StatusReadyLength6 sCredits120Render time4 min 31 sVoice lineBright ki | yes |
| /create | Hero carousel | at least 7 real clips; 7 clips | yes |
| /create | Finished Motion video card | drawer plays the MP4 (with voice) beside the details; player 675 x 800 px | yes |
| /create | Every generation card | shows a poster (video, live frame or storyboard frame) | yes |
| /create | Cut-outs | no 404 for photos known to have none | yes |
| /api/photo/<id>?cutout=1 | Cut-out of a product photo | PNG for a plain background, 404 with the reason otherwise | yes |
| /create | Generation card | opens the drawer; Close; drawer actions: Make it as a Motion video instead, Edit the prompt | yes |
| /create | Drawer Download | the MP4 file; /videos/blender/bl-ccf2f2564cd3.mp4 | yes |
| /templates | Templates link | /create#tgrid scrolled to the gallery | yes |
| /app/video/motion#influencers | AI influencers link | opens the presenter picker | yes |
| /app/video/seedance-2-5 | Example prompt | opens Seedance 2.0 with the prompt | yes |
| /app/image/nano-banana | + Product photo | picker, adds Image 1 | yes |
| /app/image/nano-banana | Reference tile (click) | removes it | yes |
| /app/image/nano-banana | + Upload a photo | opens the file chooser | yes |
| /app/image/nano-banana | Shape chips | select 9:16 | yes |
| /app/image/nano-banana | GENERATE with empty prompt | says 'Describe the image first' | yes |
| /app/image/nano-banana | Gallery image | shows it large; 2 images | yes |
| /app/image/nano-banana | Download | the JPEG | yes |
| /app/image/nano-banana | Example prompt | fills the prompt | yes |
| /app/image/nano-banana | Use in a video | /create?ref=<image> with it as Image 1 | yes |
| /app/image/nano-banana | Use in a 3D motion video | /app/video/motion?ref=<image> | yes |
| /pricing | Buy (test: adds credits) | adds the pack to the test wallet; 12700 -> 13700 test credits | yes |
| /showcase | Filters | All / Seedance / Motion | yes |
| /showcase | Video tile | viewer with Download; Close; 9 videos | yes |
| /videos | Filters | All / Seedance / Motion / In progress | yes |
| /videos | Video tile | viewer with Download; Close; 9 videos | yes |
| /guide | FAQ items | open | yes |
| /api-docs | Contents links | jump to each section | yes |
| /api-docs | Rates table | filled from /api/pricing | yes |
| online (video.bupulse.com) | Any page, not signed in | /login page; API answers 401; wrong password: 'That password is not right' | yes |
| /nope-404 | Unknown page | 404 page with links | yes |

**Not clicked, because they spend credits or call a paid model** (each follows the same charge-first,
refund-on-failure pattern): Generate on Motion (30 credits a version, 40 with the voice-over), Generate on the AI image
page (15 credits; tested for real twice on 17 October, about $0.04 each, both fine), the voice-over itself (tested for
real once through the API, $0.066, then reused for free; the MP4 with voice was made in Chrome and has video and sound
tracks), choosing a realistic AI presenter (15 credits), "Make it as a Motion video instead" when a product is picked
(starts a Motion design), the drawer's Apply change and Extend +5 s, Make MP4 (free, but slow), Write with Claude (a
Claude call on the owner's subscription), Generate with Premium 3D (120 credits and minutes of rendering; made for real once on 17 October, see above), and
Seedance with the key (waits for `SEEDANCE_API_KEY`; until then
Generate makes a free preview, which was clicked). The test wallet gained 1,000 pretend credits per QA run from the
"Buy (test)" check.

## Online access (video.bupulse.com)

Owner decision (17 October 2026): the studio is reachable online while the owner is away, from this Mac.

- **Tunnel:** `tools/bin/studio-online.sh` (git-ignored folder) creates its own Cloudflare tunnel `bupulse-video`
  (separate from the app's `bupulse-test` tunnel on port 3001), points `video.bupulse.com` at it and runs it to
  `http://localhost:3100`. The owner runs it in a Terminal and leaves the window open. `~/bin/cloudflared` (signed)
  is used; the unsigned GitHub download in `tools/bin` is a fallback.
- **Password gate** (`video-lab/gate.ts`): every request that is not local (Host localhost/127.0.0.1 on port 3100 and
  no proxy headers) needs the signed `bp_studio` cookie from `/login` (`STUDIO_PASSWORD` in `.env`; 10 tries per 10
  minutes per IP; `x-robots-tag: noindex`). Local automation and the agents keep working without a cookie. A tunnel
  that rewrites Host to localhost still counts as online, because it adds proxy headers. Without the cookie, pages go
  to `/login` and the API answers 401. The password is compared in constant time. The cookie is an HMAC of the
  password with a secret kept in `video-lab/data/gate-secret` (so restarts do not sign anyone out; changing the
  password does): httpOnly, SameSite=Lax, Secure over https, 30 days. `/logout` signs a device out. Without
  `STUDIO_PASSWORD`, online visitors are refused.
- **Kept alive:** `caffeinate -dims` stops the Mac sleeping; a supervisor script restarts `npm run lab` whenever
  nothing answers on port 3100 (the agents restart it themselves while they work).
- **Never for clients:** the studio still runs Claude on the owner's subscription and the TEST database; this link
  is the owner's own remote access, not a deployment.

## The Video Lab (developer page, `/lab`)

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
| Seedance (BytePlus) | `lib/video-engine/seedance.ts`, `lib/video-engine/seedance-prompt.ts`, `lib/video-engine/seedance-brain.ts`, `video-lab/seedance-jobs.ts`, `video-lab/seedance-mock/` (previews), `scripts/video-lab/seedance-check.mjs` (readiness) |
| Studio site | `video-lab/site/` (layout, `site.css`, `models.json`, `pages/`, `client/`, `static/`), `video-lab/credits.ts`, `scripts/video-lab/start.mjs` |
| AI image (Nano Banana) | `generateImage`, `listImages` in `video-lab/influencers.ts`; `POST /api/image`, `GET /api/images` in `video-lab/server.ts` |
| Password gate (online access) | `video-lab/gate.ts`, `tests/video-lab/gate.test.ts` |
| Video Lab | `video-lab/server.ts`, `video-lab/data-source.ts`, `video-lab/store.ts`, `video-lab/client/`, `scripts/video-lab/start.mjs` (`npm run lab`) |
| Tests | `tests/video-engine/engine.test.ts`, `tests/video-engine/camera-and-modes.test.ts`, `tests/video-engine/seedance.test.ts`, `tests/video-engine/seedance-brain.test.ts`, `tests/video-engine/seedance-preview.test.ts`, `tests/video-engine/credits.test.ts` |

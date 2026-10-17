# Premium 3D clips with Blender

Owner decision (17 October 2026): Claude specialises in 3D motion graphics. Next to the browser "3D look" of the motion
engine (docs/VIDEO_ENGINE.md, "3D look"), a **Blender pipeline** makes real 3D clips on this Mac, for free: Claude
writes a small JSON scene, Blender (Eevee) renders it and writes an MP4. It is meant to become the **"Premium 3D"
quality** of the Claude 3D motion engine in the studio.

What it makes: a glossy studio floor with real reflections and soft shadows, a three-point studio light, the product
photo standing in the set (on a rounded card, on a box, or cut out), extruded and bevelled 3D letters in metal, chrome,
gloss, glass, matte or neon, props (plinths, spheres, rings, boxes, cylinders), confetti, sparkles, bubbles and dust,
and a real camera (orbit, dolly, crane, dolly zoom) with the studio's easing curves.

It is in testing. The studio does not call it yet (see "Wiring it into the studio").

## Files

| Part | Path |
| --- | --- |
| Renderer (runs inside Blender) | `tools/blender/render.py` |
| Scene format, checks and defaults, command line, the text for Claude | `tools/blender/scene.ts` |
| Example scenes | `tools/blender/scenes/*.json` |
| Job runner for the server | `video-lab/blender-jobs.ts` |
| Claude designs a scene from the brief | `lib/video-engine/blender-design.ts` |
| Frames out of a rendered MP4 (through Blender, no ffmpeg needed) | `tools/blender/frames.py` |
| Contact sheet of stills or frames | `tools/blender/contact-sheet.mjs` |
| Test cutout of the phone photo | `tools/blender/test-cutout.mjs` (writes `video-lab/data/blender/test/phone-cutout.png`) |
| Tests (Blender mocked) | `tests/video-engine/blender.test.ts` |

## Run a render by hand

Blender 5.2 is installed at `/Applications/Blender.app`. From the repository folder:

```sh
# The MP4 (Eevee, H.264, no sound)
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -noaudio -P tools/blender/render.py -- \
  --scene tools/blender/scenes/product-turntable.json --out video-lab/data/blender/test/product-turntable.mp4

# Three PNG stills (at 10 %, 50 % and 95 % of the clip) instead of the MP4, to check the look quickly
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -noaudio -P tools/blender/render.py -- \
  --scene tools/blender/scenes/product-turntable.json --out /tmp/x.mp4 --stills 0.1,0.5,0.95 --stills-dir /tmp/stills

# Add --preview for 480p and 8 samples (a still in about 2 to 7 seconds)
node tools/blender/contact-sheet.mjs /tmp/sheet.jpg --width 270 /tmp/stills/*.png

# Frames out of the finished MP4, to check the real video
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -noaudio -P tools/blender/frames.py -- \
  --video video-lab/data/blender/test/product-turntable.mp4 --at 0.05,0.35,0.65,0.95 --out-dir /tmp/frames
```

Other options: `--fonts-dir` (default `public/fonts/video`, the studio's fonts, read as WOFF2 directly) and
`--base-dir` (the folder relative image paths start from; default the repository). The poster example uses a test
cutout: run `node tools/blender/test-cutout.mjs` once first (without it, the phone shows on a card instead).

The renderer prints lines the job runner reads: `BLENDER_SCENE 540x960 96 frames`, `BLENDER_PROGRESS <frame> <total>`,
`BLENDER_WARN ...`, `BLENDER_ERROR ...` and `BLENDER_DONE <path> <seconds>s`.

## The scene format

One JSON object. **Units:** the product is about 2.5 tall. x goes left (-) to right (+), y away from the camera (+) or
towards it (-), z up from the floor (0). The camera starts in front (at -y) and looks at `camera.target`. Every field is
optional: missing or wrong values get the defaults below (`normalizeBlenderScene` in `tools/blender/scene.ts`, and the
same again in `render.py`). Claude gets the short version, `BLENDER_SCENE_FORMAT`.

| Field | Values (default) | Meaning |
| --- | --- | --- |
| `version`, `title` | 1, text | |
| `canvas.ratio` | 9:16, 3:4, 4:5, 1:1, 4:3, 16:9 (9:16) | as the studio's ratios |
| `canvas.quality` | 480p, 540p, 720p, 1080p (540p) | the short side: 540p 9:16 = 540 x 960 |
| `canvas.fps` | 24, 25, 30 (24) | |
| `canvas.samples` | 1 to 128 (16) | Eevee samples: render time grows with it; 16 is clean, 32 to 64 for finals |
| `duration` | 1 to 15 s (4) | |
| `seed` | integer (1) | the only source of randomness (particles): same scene, same video |
| `background.kind` | studio, gradient, solid (studio) | the set is always a round "infinite" studio sweep (floor curving into a wall), so the camera can orbit anywhere; studio adds a soft glow of the second colour on the wall behind the product |
| `background.colors` | [hex, hex] (#1a1d24, #3a4255) | studio: the backdrop and the glow behind the product; gradient: low and high wall colours; solid: one colour |
| `background.floor.color` | hex (the first colour) | |
| `background.floor.reflect` | 0 to 1 (0.55) | 0 = matte, 1 = mirror; 0.6 to 0.85 is the glossy studio floor |
| `background.light.preset` | studio, soft, dramatic, warm (studio) | key, fill, two rim strips and a top softbox in different balances |
| `background.light.intensity` | 0.2 to 3 (1) | |
| `background.light.rim` | hex (#bcd4ff) | colour of the edge lights behind the subject |
| `background.light.side` | left, right (left) | side of the key light |
| `camera.move` | static, orbitLeft, orbitRight, dollyIn, dollyOut, craneUp, craneDown, pushPull (orbitRight) | the studio's moves done by a real camera; pushPull is a true dolly zoom (Vertigo) |
| `camera.intensity` | 0 to 1 (0.5) | orbit: 8 to 50 degrees each way; dolly: up to 55 % further; crane: rise; pushPull: up to half the distance |
| `camera.ease` | linear, in, out, inOut, back, elastic, bounce (inOut) | the studio's curves (`lib/video-engine/animate.ts`, `ease`) |
| `camera.target` | [x, y, z] ([0, 0, 1.6]) | the point it looks at |
| `camera.distance` | 2 to 20 (8) | |
| `camera.height` | -2 to 10 (1.8) | above the floor (crane moves move around the target instead) |
| `camera.lens` | 18 to 135 mm (50) | |
| `camera.fstop` | 0 or 0.8 to 32 (0) | 0 = all sharp (faster); 2 to 8 = blurred background |
| `product` | object or null | |
| `product.photo` | 1-based number | the photo from the studio's list (the server turns it into a path); hand-written scenes may use `image` and `cutout` paths instead |
| `product.shape` | card, box (card) | without a cutout: the photo on a rounded card 0.06 thick, or on a box (front and back faces) |
| `product.height` | 0.3 to 6 (2.4) | the width follows the photo |
| `product.position` | [x, y, z] ([0, 0, 0]) | bottom centre; on a plinth, z = the plinth's height |
| `product.radius` | 0 to 0.5 (0.08) | card corner rounding |
| `product.frame` | hex (#f4f4f4) | colour of the card edges |
| texts: `texts[]` (up to 6) | | extruded 3D letters |
| `text` | up to 60 characters | |
| `font` | inter, poppins, nunito, space-grotesk, anton, playfair, dm-serif (anton) | the studio's fonts (bold weights) |
| `size` | 0.1 to 3 (0.6) | font size: capitals are about 0.65 x size tall; a line is about 0.26 x size x characters wide in anton, 0.36 in poppins, about 0.47 in the others (measured) |
| `position` | [x, y, z] ([0, 0, 3]) | centre |
| `rotation` | -90 to 90 degrees (0) | turn around the vertical |
| `depth` | 0 to 1 (0.25) | extrusion (1 = half the font size) |
| `bevel` | 0 to 1 (0.5) | rounded edges that catch the light |
| `material` | metal, chrome, gloss, matte, glass, neon (metal) | metal and chrome mirror the studio softboxes; gloss is lacquered plastic; neon glows |
| `color` | hex (#ffffff) | |
| `face` | 0 to 1 (0.6) | how much the letters turn towards a moving camera, so they stay readable while their sides still show |
| props: `props[]` (up to 12) | | |
| `kind` | plinth, sphere, ring, box, cylinder (sphere) | |
| `position` | [x, y, z] | sphere and ring: centre; plinth, box, cylinder: bottom centre |
| `size` | 0.05 to 6 (0.5) | diameter, or width for a box |
| `height` | 0 to 6 (0 = automatic) | plinth (size x 0.35), box (= size), cylinder (= size) |
| `material`, `color` | as texts (gloss, #ffffff) | |
| particles: `particles[]` (up to 3 groups) | | |
| `kind` | confetti, sparkles, bubbles, dust (sparkles) | confetti falls and tumbles; sparkles twinkle; bubbles rise (glass); dust drifts |
| `count` | 1 to 150 (40) | |
| `colors` | up to 5 hex (white) | |
| `size`, `speed` | 0.2 to 4 (1), 0 to 3 (1) | |
| `center`, `area` | [x, y, z], [w, d, h] ([0, 0, 2.5], [6, 4, 6]) | the box they fill |
| `seed` | integer (the scene's seed) | |
| motion, on `product`, `texts[]` and `props[]` | | |
| `enter` | none, spinIn, rise, drop, scale, pop (product rise, text spinIn, props none) | spinIn: turns in from the side and grows (ease back); rise: comes up and grows; drop: falls in and bounces; scale: grows; pop: grows with an overshoot. Hidden before it. |
| `enterAt`, `enterFor` | seconds (0, 0.9) | |
| `idle` | none, float, swing, turntable, spin (product float, others none) | float: bobs and sways; swing: turns `angle` degrees each way, `spin` swings over the clip; turntable: `spin` full turns over the clip; spin: `angle` degrees per second x `spin` |
| `spin`, `angle` | 0 to 4 (1), 5 to 360 (30) | |
| `look.contrast` | base, medium, high, punchy (medium) | AgX looks |
| `look.exposure` | -3 to 3 (0) | |
| `look.bloom` | 0 to 1 (0.3) | glow around bright parts (compositor) |

**Framing:** in 9:16 at distance 10 with a 50 mm lens the frame is about 4 wide and 7 tall around the target. Keep
things within x -1.6 to 1.6, texts in front of or above the product (never inside it or a plinth).

**Deterministic:** no random numbers without the seed, and every animated value (camera, objects, particles) is
computed in Python and keyed on every frame, so a re-render gives the same video.

## The three examples (`tools/blender/scenes/`)

| Scene | What it shows |
| --- | --- |
| `product-turntable.json` | the phone photo on a rounded card rising and swinging on a black mirror floor, a chrome "GALAXY A56" spinning in above it, dust, a slow orbit, studio light with a blue glow |
| `text-reveal.json` | "A56" in gold metal spinning in, "SAMSUNG GALAXY" rising, the business name in neon, a gold ring, confetti and sparkles on a purple set, dolly in |
| `poster-plinth.json` | a 3D poster: the cut-out phone dropping onto a white plinth, its real price (420,000 RWF) in orange gloss, the name in blue gloss, gloss and metal spheres, a glass ring, a box, a light blue set, crane up |

Every word in them is a fact of the test product (Samsung Galaxy A56 at Nova Phones Kigali, 420,000 RWF): examples
never invent facts. They use a cached lab photo (`video-lab/data/photos/`, git-ignored), so they render on this Mac
only.

## Render times (measured)

Apple M1, Blender 5.2.2, Eevee, 540 x 960, 24 fps, 16 samples, screen-traced reflections, 17 October 2026. Other
agents were using the Mac at the same time (load average shown): the quiet-Mac figure is the poster.

| Scene | Length | Frames | Render | Per frame | MP4 | Load average |
| --- | --- | --- | --- | --- | --- | --- |
| product-turntable | 4 s | 96 | 184 s | 1.9 s | 0.51 MB | about 50 to 75 |
| text-reveal (70 confetti, 30 sparkles) | 4 s | 96 | 185 s | 1.9 s | 0.97 MB | about 75 |
| poster-plinth (cutout, glass ring) | 5 s | 120 | 106 s | 0.9 s | 0.47 MB | 7 to 25 |

The same poster took 216 s (1.8 s a frame) at load 75 to 150, and the first turntable render 409 s (4.3 s a frame)
before the speed-ups (shadows from two lights only, depth of field off by default). So on a quiet Mac a 4 to 6 s test
clip at 540p takes about 1.5 to 2 minutes; at 720p expect roughly 1.8 times that (pixels), not yet measured.

Quick looks: three `--preview` stills (480p, 8 samples) took 4 to 20 s, Blender's start included (the poster, with
glass, was the slowest). Time grows with the number of pixels and with samples. What cost the most in a test frame:
samples (time roughly in proportion), soft shadows (so only the key and top lights cast them), depth of field (off
unless `fstop` is set; about a fifth of the frame time) and glass.

## Limits

- **Photos are flat.** The product is a photo: on a card or box it looks like a printed card in a 3D set; a cutout
  stands free and looks far better. The motion engine now makes free cut-outs of photos on plain backgrounds
  (`lib/video-engine/cutout.ts`, cached by `video-lab/cutouts.ts` in `video-lab/data/cutouts/<id>.png`): the server
  passes that file as `cutout` in the photo list. Photos on busy backgrounds (a shop, a room) are refused there and
  stay on a card. The poster example uses a hand-measured test cutout instead (`test-cutout.mjs`), since its photo is
  taken in a shop.
- A cutout is a flat plane: keep `idle` to swing (15 to 35 degrees) or float; a full turntable shows its edge.
- Reflections are screen-traced: the floor mirrors what is on screen, not what is behind the camera.
- No sound: the studio adds music and the ElevenLabs voice-over afterwards, as for the other engines.
- Text is one line per entry (no wrapping); Latin letters only (the latin and latin-ext fonts).
- Render time: minutes, not seconds. One render at a time (`renderBlenderScene` queues them). The job runner stops a
  render after 15 minutes.
- Mac only for now (the path to Blender). Elsewhere set `BLENDER_BIN`; Linux servers need Blender with a GPU for Eevee.

## Claude designs the scene (`lib/video-engine/blender-design.ts`)

`designBlenderScene(brief, send, model?, { photos, quality? })` takes the motion engine's `DesignBrief` (business,
product facts, photos with their cut-out flags, `styleId` = the template, ratio, seconds, note, research) and makes one
Claude call through the given transport (`apiTransport(key)` for the app, `subscriptionTransport()` in the lab).

- **Prompt:** `blenderSystemPrompt()` is `BLENDER_SCENE_FORMAT` plus the rules. Facts come only from the brief, names
  are spelled as given, and the price is written exactly as the brief has it (no price, no price on screen). The
  product is `"photo": n`; a cut-out or card product swings or floats, never spins. At most 3 texts, one line each,
  with sizes that read on a phone. A tested layout gives the coordinates (product, title above, price below, camera
  9.5 away). Brand colours; dark studio sets for electronics and luxury, bright sets for homes, food and fashion.
  Everything has entered by 60 % of the clip, so the clip ends on the product, its name and its price.
  `blenderBriefText()` is the motion engine's `briefText` (same facts, template direction, research and photo notes),
  with the length clamped to 4 to 8 s and the frame size per unit of distance for the ratio.
- **Checks after the answer:**
  - `extractJson` and then `normalizeBlenderScene` with the server's photo list.
  - The answer is unusable when there is no JSON, when there is no product although photos were given (or its photo
    number does not exist), or when there are no texts. Claude is then asked once more, with the problems spelled out.
    A refusal stops at once. Usage is kept on failure (`DesignError.usage`).
  - **House rules repaired, each listed in `warnings`:**
    - the brief's length and ratio;
    - turntable or spin on a flat product becomes a swing;
    - one line per text;
    - a word one or two letters off a fact word gets the brief's spelling ("KIBAGABARA" became "KIBAGABAGA" in a
      test);
    - the business phone is written as the brief writes it;
    - chrome below size 0.8 becomes gloss;
    - text size is at least 0.5;
    - late entrances are moved earlier.
  - `fitLayout`:
    - a text in front of the product moves above or below it (the product rises when the price needs room under it);
    - texts never touch each other;
    - props move beside the product;
    - the camera aims at the middle of everything and steps back until it all fits, with room for an orbit's
      parallax.
  - Entrances never cross the product: a text above it drops in, a text below it rises.
  - `blenderFactCheck` runs the motion engine's fact check (`factcheck.ts`) on the texts, the voice line and the
    caption.
- **Returns** `{ scene, caption, hashtags, say, warnings, factWarnings, usage, costUsd, apiEquivalentUsd, attempts }`.

**Tested on 17 October 2026** (owner's subscription, `claude-sonnet-5-5`; 5 rounds of 3 clips, each looked at frame
by frame):
- Clips: Samsung Galaxy A56 (Nova Phones Kigali, 420,000 RWF) with the `3d-title-drop` and `showroom-turntable`
  directions, and the Kibagabaga house (120,000,000 RWF, `showroom-turntable`). 6 s, 9:16.
- **Claude design:**
  - 15 to 26 s;
  - 18,000 to 20,000 tokens in (two or three photos) and 1,600 to 2,300 tokens out;
  - **$0.078 to $0.091 a design on the API** ($0 on the subscription);
  - one attempt every time, and no fact warnings.
- **Preview render** (480p, 8 samples, 144 frames): 63 to 209 s depending on how busy the Mac was (load average 15 to
  100).
- **What the rounds fixed:**
  - Round 1: the product was missing because of a bug, since fixed (a checked scene lost its photo when it was
    checked again; `renderBlenderScene` now needs the same `photos` and refuses a scene whose product photo is
    missing).
  - Rounds 2 and 3: texts covering the product, tiny lines and props at the frame edge. Fixed with the layout recipe,
    `fitLayout`, minimum sizes and font widths measured in Blender.
  - Round 3: a misspelled place name, fixed by the spelling repair; chrome lines that did not read, fixed by the
    chrome rule.
  - Round 4: a title rising through the product, fixed by the entrance rule.
  - Round 5: all three read as product ads.
- The contact sheets of each round are in `video-lab/data/blender/design/r1` to `r5/contact-sheet.jpg` (git-ignored).

## Premium 3D credits

What one clip costs us:
- **Claude's design:** about $0.08 to $0.09 on the API (measured above). Budget **$0.10**, the same as a Motion
  video.
- **Rendering:** free (Blender), but it takes the Mac:
  - about 1.5 to 3.5 minutes for 6 s at 540p and 16 samples;
  - roughly double that at 720p (not yet measured);
  - one render at a time, so at most about 20 clips an hour;
  - electricity is negligible.
- **Voice-over (optional):** as for the other engines (`VOICE_OVER_CREDITS`).

**Proposal: 100 credits (1,000 RWF, about $0.69) for a 540p clip of up to 8 s, and 150 credits (1,500 RWF) at
720p.** This means `PREMIUM_3D_CREDITS = 100` in `video-lab/credits.ts`, plus 50 for 720p.
- The design alone, at the studio's margin, is 30 credits (`CLAUDE_VIDEO_CREDITS`). The other 70 pay for the machine
  slot: about 20,000 RWF for each hour the Mac renders, which keeps the queue for paying clips.
- It sits between a Motion video (30) and Seedance: Mini 480p 5 s is 55 credits, Fast 720p 5 s is 190.
- A failed render is refunded. A re-render of the same scene (for example after the owner moves a text) costs only
  the machine slot: 70 credits.
- Revisit once 720p and real queue lengths are measured.

## Wiring it into the studio

The plan: a **"Premium 3D" quality** on the Claude 3D motion engine. Everything below is in place except the server
routes and the site.

**The exact calls the server makes** (`video-lab/server.ts`), with the same brief it builds for `designVideo` today:

```ts
import { designBlenderScene } from "@/lib/video-engine/blender-design";
import { blenderAvailable, renderBlenderScene } from "./blender-jobs";

// photos: one entry per brief photo, in the same order; files the server resolved itself
const photos = photoIds.map((id, i) => ({
  image: `video-lab/data/photos/${id}-1280.jpg`, // photoJpeg(id, 1280, businessId) caches it there
  cutout: briefPhotos[i].cutout ? `video-lab/data/cutouts/${id}.png` : null, // cutoutForPhoto(id) caches it there
}));
const design = await designBlenderScene(brief, transport, DESIGNER_MODEL, { photos }); // transport: apiTransport(key) or subscriptionTransport()
// record design.usage in the ledger, show design.warnings / design.factWarnings, keep design.caption, .hashtags, .say
const result = await renderBlenderScene(design.scene, `video-lab/data/blender/videos/${jobId}.mp4`, { photos, onProgress: (p) => (job.progress = p) });
// result: { path, bytes, seconds, log, warnings, scene }
```

- `GET /api/blender/status` returns `{ available: await blenderAvailable() }`, so the studio shows Premium 3D only
  when Blender is installed.
- `POST /api/blender/design` and then `POST /api/blender/render`, or one `POST /api/blender` that does both:
  - charge `PREMIUM_3D_CREDITS` up front and refund on failure;
  - do not await the render inside the request: store a job and return its id (`video-lab/seedance-jobs.ts` shows
    the pattern);
  - **never** take paths from the browser or from Claude. Only the server's `photos` list is used (raw paths in a
    scene are dropped).
- `GET /api/blender/jobs/:id` returns status and progress (0 to 1) for the progress bar, then the video URL.
- Optional, free: a quick still first, `renderBlenderScene(design.scene, out, { photos, stills: [0.98], preview: true })`
  (a few seconds), shown while the clip renders.
- Site (`video-lab/site/**`):
  - a "Premium 3D" choice on the 3D motion page and the template pages `3d-title-drop`, `showroom-turntable`,
    `chrome-luxe` and `confetti-launch`;
  - the expected wait (2 to 4 minutes for 6 s at 540p);
  - the progress bar, and the still as the poster image.

## Tests

`npx vitest run tests/video-engine/blender.test.ts tests/video-engine/blender-design.test.ts`. Design tests, with
Claude mocked: the call, the retry with the problems, a refusal, fact warnings, the spelling, phone, chrome, length,
entrance and layout repairs, and the brief text. Runner tests: photo paths, limits, the three example
scenes (no repairs needed), canvas sizes, the command line, progress lines, and the job runner with Blender mocked
(progress, log, errors, the timeout, a missing Blender). Vitest never needs Blender.

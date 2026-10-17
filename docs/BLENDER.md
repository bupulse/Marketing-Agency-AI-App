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
| `background.kind` | studio, daylight, neon, gradient, solid (studio) | the set is always a round "infinite" studio sweep (floor curving into a wall), so the camera can orbit anywhere. studio: the dark showroom with a soft glow of the second colour behind the product; daylight: a bright set under a white sky with a brand-colour accent wall (7.5 x 8.2, rounded) behind the product; neon: a dark set with a neon arch behind the product and two neon tubes, in the second colour (see "Premium looks") |
| `background.colors` | [hex, hex] (#1a1d24, #3a4255) | studio: the backdrop and the glow; daylight: the light set and the accent wall; neon: the dark set and the neon colour; gradient: low and high wall colours; solid: one colour |
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
| `weight` | bold, regular (bold) | the font's two weights (inter, poppins, nunito 800/600; space-grotesk 700/500; playfair 700/600; anton and dm-serif have one) |
| `plate` | null or hex (null) | a clean flat label on a rounded bar of this colour (the phone number, a call to action): no extrusion, a slight glow of its own so it reads in any light |
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
| `look.bloom` | 0 to 1 (0.2) | glow around really bright parts only (threshold 1.0: neon, highlights), so text edges stay crisp |
| `sound.voiceAt` | 0 to 15 s (0.3) | when the voice-over starts |
| `sound.voiceVolume`, `sound.musicVolume` | 0 to 2 (1), 0 to 1 (0.18 under a voice, 0.7 alone) | |
| `sound.voice`, `sound.music` | paths, hand-written scenes only | dropped by `normalizeBlenderScene`; the studio passes the files to the runner instead |

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
- Sound is one voice-over and one music bed, mixed by Blender (see "Sound"). A voice longer than the clip is cut at the
  end of the clip, so keep `say` to about 2.5 words a second of the clip.
- Text is one line per entry (no wrapping); Latin letters only (the latin and latin-ext fonts).
- Render time: minutes, not seconds. One render at a time (`renderBlenderScene` queues them). The job runner stops a
  render after 15 minutes.
- Mac only for now (the path to Blender). Elsewhere set `BLENDER_BIN`; Linux servers need Blender with a GPU for Eevee.

## Premium looks

Every clip also gets these, whatever its look:
- **A plinth:** the product stands on it, like in a product shoot, with a contact shadow and a reflection on the floor.
- **A thick card:** a product without a cut-out is printed on a rounded card 0.14 thick, with a 5-step bevel, glossy
  edges and a thin clear coat.
- **A sweep:** a tall, thin light crosses in front of the product once, between 22 % and 62 % of the clip. It makes
  highlights only (no diffuse light) and does not touch the floor, so a bright streak glides over the card, the
  plinth and the letters.
- **Glow only on really bright parts:** neon and highlights glow (bloom threshold 1.0), so text edges stay crisp.

The three looks:

| Look | Set | Light | For |
| --- | --- | --- | --- |
| `studio` (dark showroom) | near-black sweep, a soft glow of the brand colour on the wall behind the product, mirror-like floor | key, fill, two rim strips, top softbox | phones, electronics, cosmetics, watches, luxury |
| `daylight` | warm-white sweep under a white sky, a rounded accent wall in the brand colour behind the product, satin floor, white matte plinth | one big soft key (clear soft shadow), the sky as fill | homes, food, fashion, beauty, family and everyday products |
| `neon` | near-black sweep, a neon arch behind the product, two neon tubes and coloured light from them, mirror floor | dramatic, rim in the neon colour, bloom 0.4 | launches, offers, tech, fashion drops, young audiences |

`lookForTemplate(templateId, productName)` recommends the look, and the brief tells Claude:
- `neon` for title-drop, confetti/launch, hypermotion, glass cards, colour pop, offers and TikTok formats;
- `daylight` for homes, food and fashion products, and for the market, golden-hour, marketplace, UGC and brand-story
  templates;
- `studio` otherwise.

**Staging repairs** (`stage`, every Claude scene, each listed in `warnings`):
- The product stands on a plinth (a gloss dark one, or matte white in daylight; size = the product's width + 0.6,
  at least 2.4; height 0.95). The plinth grows if the price and the phone bar need more room on its front.
- The product swings 10 to 22 degrees.
- The camera never stays still (dolly in 0.35), unless the lens is fixed.
- Titles face the camera more (0.8 or more) and are less deep (0.35 or less), so the letters stay crisp while the
  camera moves.
- The phone number becomes a flat bar:
  - poppins regular, 0.3 to 0.4, on the brand colour;
  - white or near-black text, whichever contrasts with the bar;
  - grouped as `+250 788 300 400`;
  - at the bottom of the plinth's front, with the price above it.
- The camera turns around a point a third of the way to the plinth's front, so an orbit barely slides the price and
  the bar.
- Glow is capped at 0.2 (0.4 for neon).

**Tested on 17 October 2026** (loop 2). The same three briefs as before: the Galaxy A56 with `3d-title-drop` (neon)
and `showroom-turntable` (studio), and the Kibagabaga house (daylight). Claude on the owner's subscription.
- **Final quality:** 540p, 16 samples, 6 s (144 frames).
- **Design per clip:** 23 to 57 s; 19,500 to 21,100 tokens in and 1,500 to 2,200 out; **$0.081 to $0.095 on the API**;
  one attempt each; no fact warnings.
- **Render, final quality:** 422 to 517 s (2.9 to 3.6 s a frame) while other agents kept the Mac busy (load average 57
  to 100). The older, simpler scenes rendered at 0.9 s a frame on a quiet Mac. The new looks have not been timed on a
  quiet Mac yet; expect about 2.5 to 4 minutes there.
- **Contact sheets:**
  - final: `video-lab/data/blender/design/r8/contact-sheet.jpg`;
  - the first final round: r6;
  - quick stills: `r7/sheet-stills.jpg`.
- **What loop 2 fixed:**
  - the flat card in a black void (now a thick card on a plinth, in three looks);
  - the phone number as cramped 3D letters (now a flat bar);
  - a still camera and product;
  - soft glow on every edge;
  - the neon arch crossing the title;
  - the product too small once the plinth was added (camera margins and an orbit pivot nearer the front);
  - a plinth label turning into the plinth (labels on the plinth now stay flat to it).
- **Still soft:** thin gold anton titles at 540p (their bevel catches little light). A bigger title, poppins bold or
  720p reads better.

**Loop 3** (17 October 2026):
- **Cut-outs stand on the plinth.** A photo with a cut-out is shown as the cut-out itself, with a little thickness:
  7 copies of its silhouette, 0.07 deep, the back ones darker. The edge shows as it swings, and it casts its own
  shadow (`cutout_stack` in `render.py`). Tall, narrow products (aspect under 0.7) stand 3.2 tall. The card is kept
  only for photos without a cut-out.
- **Crisp titles:**
  - The default font is poppins.
  - A title in anton longer than 4 letters becomes poppins bold.
  - Bold titles are at least 0.75, but shrink to fit the frame at the layout's distance, never below 0.6.
  - Labels on the plinth's front are shallow (depth 0.12 or less) and flat to it, so they do not smear when seen at an
    angle.
- **Frame 0 is the thumbnail:**
  - A new entrance, `settle`, is visible from the first frame: a small turn, lift and scale that settles by 0.6 s.
  - The product and the main title always use it, from 0 s.
  - The look's accent (glow, accent wall, neon arch) is part of the set, so it shows from frame 0 as well.
- **Tested:**
  - The Kitenge summer dress (E2E Starter Test, 25,000 RWF, three cut-outs) on the daylight look, plus the three
    earlier briefs. Every word comes from the brief, and there were no fact warnings.
  - Final contact sheet: `video-lab/data/blender/design/r11/contact-sheet.jpg`. The first column is frame 0.
  - Quick stills: `r9`, `r10`.
- **Design:** 18 to 36 s per clip, $0.086 to $0.099 on the API, one attempt each.
- **Render at 540p, final quality (6 s, 144 frames):**
  - neon 112 s and dress 151 s, at load average about 5 to 30;
  - showroom 481 s and house 285 s, while the Mac was busier.
- **720p, measured back to back on the dress at load average 5 to 10:**
  - 540p took 113 s (0.79 s a frame, 0.83 MB);
  - 720p took 198 s (1.37 s a frame, 1.23 MB);
  - so 720p costs **1.75 times** the render time of 540p.
  - Titles are visibly sharper (`r11/title-540-vs-720.jpg`).
  - On a quiet Mac a 6 s clip takes about 2 minutes at 540p and about 3.5 minutes at 720p.

**Loop 4** (17 October 2026):
- **Photo cards fill the frame.** `fillFrame` grows a card (not a cut-out) until it fills at least 40 % of the
  frame's height at the widest moment of the camera move. The title moves up with it and the camera steps back if it
  must.
- **Wide subjects get a wide card.** A house, a room or a landscape photo gets a wide card, cropped from the photo's
  centre (`crop`, the card's width / height): 1.15 in a tall frame, 1.6 in square and wide frames, with an orbit
  instead of a dolly.
  - Why not 16:10 in 9:16: a 16:10 card as wide as a 9:16 frame is only 35 % of its height. 40 % needs a card no
    wider than about 1.2 : 1 once the plinth and margins are counted.
- **More photos.** With 2 or 3 photos, the card flips half a turn to the next photo, at the middle or at the thirds
  (`product.more`, resolved to `gallery`). Each flip comes with a small camera push.
  - Front: photo 1, then photo 3, switched while the back faces the camera. Back: photo 2.
  - Every photo is cropped to the card's shape.
  - A cut-out stays single.
- **The phone bar says what it is for:**
  - "WhatsApp +250 ..." when the facts mention WhatsApp;
  - otherwise "Call +250 ..." ("Hamagara" in Kinyarwanda, "Appelez le" in French, "Piga simu" in Swahili);
  - a business without a phone keeps a line such as "Find us at Kibagabaga".
  - The plinth is at least as wide as the bar.
- **Lines inside the daylight accent wall.** A line over the wall shrinks to the wall's width as seen from the
  text's depth, minus an orbit's slide and a margin. Below 0.4 it wraps to two lines (`wrapInTwo`; the render keeps
  the line break).
- **The last 0.8 s hold still.** The camera finishes its move 0.8 s before the end, and the flips are over by then.
  The price and the bar have no idle motion.
- **Tested:**
  - Final contact sheet: `video-lab/data/blender/design/r13/contact-sheet.jpg`, at 0, 45 %, 80 % and 98 % of each
    clip.
  - The house flips through its 3 photos (garden, living room, pool).
  - Design: 19 to 23 s per clip, $0.091 to $0.102 on the API.
  - Render (540p final, 6 s): house 198 s, showroom 252 s, neon 274 s, dress 289 s, at load average 25 to 50.

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
// sound (optional): the server copies the voice take (made from design.say) and a music track into the job's folder
const result = await renderBlenderScene(design.scene, `video-lab/data/blender/videos/${jobId}.mp4`, { photos, audio: `${jobFolder}/voice.mp3`, music: `${jobFolder}/music.mp3`, jobDir: jobFolder, onProgress: (p) => (job.progress = p) });
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
  - the expected wait for 6 s: about 2 minutes at 540p and 3.5 minutes at 720p on a quiet Mac, up to 8 to 10 minutes
    when it is busy;
  - the progress bar, and the still as the poster image.

## Sound (voice-over and music, mixed by Blender)

Premium 3D clips get their sound from Blender itself: no separate ffmpeg, no re-encode in the browser.
- `render.py` puts the voice and the music in the video sequencer as sound strips:
  - the voice starts at `sound.voiceAt` (default 0.3 s);
  - the music starts at 0, at 0.18 under a voice (0.7 alone), and fades out over the last half second;
  - both are trimmed to the clip.
- Blender's built-in FFmpeg then writes them into the MP4 as AAC (stereo, 48 kHz, 160 kb/s).
- Sound-only strips do not replace the 3D picture.
- By hand: `--audio voice.mp3 --music music.mp3 [--voice-at 0.5] [--music-volume 0.2]`. Stills ignore the sound.

**The runner's options**:
`renderBlenderScene(scene, outPath, { photos, audio, music, voiceAt, musicVolume, jobDir, onProgress })`.
- `audio`: the voice file. `music`: the music file. Both are absolute paths to MP3, WAV, M4A, AAC, OGG or FLAC.
- They must be inside `jobDir`, the job's own folder (default: the folder of `outPath`). Links are resolved first, so
  a link cannot point outside it.
- Anything else is refused with a plain-English error before Blender starts (`checkSoundPath` in
  `tools/blender/scene.ts`).
- The server copies the take and the track into the job's folder, as it does for the photos. For example
  `video-lab/data/blender/photos/<job id>/voice.mp3` and `music.mp3`, then
  `{ audio, music, jobDir: <that folder> }`.
- Never paths from the browser or from Claude.

**Tested on 17 October 2026**:
- The round-5 Kibagabaga house clip, 8 s at 540p (192 frames), with its real ElevenLabs take from the cache
  (`video-lab/data/voice/d3bd...mp3`, 12.7 s, no new cost) and the library's "corporate inspiring" track.
- The MP4 has an H.264 track of 8.00 s and an AAC track of 8.02 s. The voice is cut at 8 s, after its third line.
- Level in a gap between two voice lines: 0.024, against 0.133 for the music file at the same moment. That is the
  0.18 music level; the fade at the end goes down to 0.007.
- Render: 546 s at load average about 110 (other agents were busy).
- What the sound costs: with a nearly free picture (1 sample, 480p, 192 frames), with sound took 157 s and 400 s, and
  without sound took 145 s and 178 s, back to back at load average 90 to 100. Mixing the sound adds no measurable time;
  the differences are the load.

## Tests

`npx vitest run tests/video-engine/blender.test.ts tests/video-engine/blender-design.test.ts`. Sound: the scene's
sound fields (paths dropped), the job-folder check (`..`, a neighbouring folder, links, extensions), the command line
and the runner refusing sound from outside the job's folder. Design tests, with
Claude mocked: the call, the retry with the problems, a refusal, fact warnings, the spelling, phone, chrome, length,
entrance and layout repairs, and the brief text. Runner tests: photo paths, limits, the three example
scenes (no repairs needed), canvas sizes, the command line, progress lines, and the job runner with Blender mocked
(progress, log, errors, the timeout, a missing Blender). Vitest never needs Blender.

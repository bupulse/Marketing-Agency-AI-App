# Anti-slop: making the image engine's pictures look real

Owner feedback (23 October 2026): the engine's pictures look like "AI slop". We do not train our own model; we steer
Google's Nano Banana models with the prompt, then check and fix every picture. The framework below is built into
lib/image-engine/realism.ts (rules), prompter.ts (how concepts are written), painter-prompt.ts (what the image model
gets), director.ts (a real camera per picture) and check.ts / checker.ts (the slop check and fix).

## 1. The slop markers

| Marker | What it looks like | Where we fight it |
| --- | --- | --- |
| Plastic skin | Waxy, airbrushed faces, no pores, porcelain glow | REAL (skin with pores, blemishes, shine), NEVER, Checker |
| Stock-photo people | Everyone grinning at the camera, posed, same age and body | REAL (caught mid-task, not everyone smiles or looks), Prompter brief |
| Glow and saturation | HDR, teal-and-orange, neon haze, lens flares, bokeh blobs | LIGHTS (real sources only), NEVER, slop words removed, Checker |
| Render look | 3D, video-game or digital-painting finish | REAL ("unretouched real photograph, not AI art, not CGI"), CAMERAS, Checker |
| Perfect produce and props | Identical lettuces, cloned faces, symmetry | REAL (uneven sizes, imperfect leaves), NEVER, Checker |
| Broken anatomy | Extra or merged fingers, twisted limbs | REAL (five fingers, natural grip), NEVER, Checker → Editor |
| Impossible physics | Floating, melting, repeating objects, wrong scale | REAL (correct perspective, nothing floating), Checker |
| Background gibberish | Fake signs and letters | NEVER, Checker |
| Generic "cinematic" composition | Centred hero, empty glossy set, dramatic sky | Director (shots, layouts), Prompter (specific lived-in places), slightly off-centre |

## 2. Before and after (how the Prompter now writes)

1. **Farm product.** Slop-prone: "A happy farmer smiling in a stunning vibrant greenhouse full of lush perfect
   vegetables, cinematic lighting." Traps: grinning stock farmer, glowing green, identical lettuces, glossy CGI
   greenhouse. Re-engineered: "Mid-morning in a plastic-covered greenhouse on the edge of town, sun diffused through
   the dusty roof. A woman in her fifties in a faded green apron and rubber boots kneels to cut a lettuce, soil on her
   fingers, looking at the plant, not the camera. Crates, a coiled hose and a puddle on the concrete path behind her.
   35mm documentary photo, slightly off-centre, the top third calm for the words."
2. **Hair salon.** Slop-prone: "Beautiful woman with perfect glossy hair in a luxury salon, glamorous, 8k."
   Traps: plastic skin, impossible shine, empty marble set, model pose. Re-engineered: "Saturday afternoon in a small
   salon with mirrors and a fan on the counter. A stylist in her thirties finishes braiding a client's hair; the client
   checks it in a hand mirror, half-smiling. Hair clips and a spray bottle on the trolley, daylight from the street
   door mixing with a warm bulb. Candid smartphone photo, slight noise in the shadows."
3. **Phone shop.** Slop-prone: "Sleek futuristic smartphone floating with neon glow, epic, hyper-realistic."
   Traps: floating product, neon haze, render look, fake reflections. Re-engineered: "A phone on a scratched glass
   counter in a busy phone shop, a customer's hand reaching for it, receipts and a charging cable beside it, other
   customers out of focus near the door. Overcast daylight from the shop front, on-camera flash snapshot, real
   reflections on the glass."

The Prompter's instructions carry a bad/good example like these, and its image prompts lose the hype words in code
(`stripSlop`: stunning, vibrant, lush, glowing, cinematic, hyper-realistic, 8k, perfect, flawless, masterpiece…).

## 3. Rules every picture gets (and the check after)

- **A real camera per picture** (Director axis, least used first): candid smartphone; 35mm documentary; Kodak Portra
  400 film; editorial 50mm; on-camera flash snapshot; medium format; wide 24mm environmental portrait.
- **Light with a source**: late-afternoon sun, window light, an open shop, tungsten bulbs, overcast, a side door,
  midday sun with hard shadows (no neon, no "cinematic" glow).
- **REAL** (positive rules): unretouched photograph; real textures and small imperfections; light you can point to;
  people mid-task, varied, not all smiling; lived-in background in correct perspective; a photographer's composition.
- **NEVER** (negative rules, as instructions because image models take no negative prompt): plastic skin; glow,
  saturation, HDR, teal-orange, flares; 3D render look; clones and symmetry; broken fingers and limbs; melted or
  impossible objects; gibberish signs; fake bokeh and vignettes; stock grins at the camera.
- **Words**: flat print-ad typography placed on the photo (no glow, 3D or letter shadows).
- **Checker**: besides the words, reads the photo for the markers (plastic skin, broken hands, warped objects,
  gibberish, clones, glow, render look). Any marker sends the picture to the Editor once: "make it look like an
  unretouched real photograph: fix …". The card shows the result.

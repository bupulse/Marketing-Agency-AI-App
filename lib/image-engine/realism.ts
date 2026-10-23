// Anti-slop rules for the image engine (docs/IMAGE_ANTI_SLOP.md, owner request 23 October 2026: "the images look like
// AI slop"). AI slop is the hyper-polished, plastic, over-saturated, generic look: waxy skin, everyone grinning at the
// camera, glowing teal-and-orange light, perfect identical produce, warped hands and nonsense background details. Every
// picture therefore gets a real camera (CAMERAS, a Director axis), photographic rules (REAL), things to avoid (NEVER),
// and the Prompter's words are cleaned of the vocabulary that pulls models towards that look (stripSlop). The Checker
// looks for the markers (SLOP_MARKERS) and the Editor fixes them once. Pure, so it is tested.

/** The camera and medium each picture is "shot" on: real gear and real looks, never a render. */
export const CAMERAS = [
  "a candid smartphone photo (iPhone main camera, natural processing, slight noise in the shadows)",
  "a 35mm documentary photo (Canon EOS R6, 35mm f/2 lens, available light, photojournalism style)",
  "a film photo on Kodak Portra 400 (soft natural grain, gentle true-to-life colour)",
  "an editorial magazine photo (Sony A7 IV, 50mm f/1.8, natural light, honest colour)",
  "an on-camera flash snapshot (direct flash, real shadows behind people, slightly overexposed foreground)",
  "a medium format photo (Fujifilm GFX, 63mm lens, fine detail, calm natural colour)",
  "a wide 24mm environmental portrait (people small in a real working space, everything sharp)",
] as const;

/** Photographic rules every picture follows: texture, light with a source, real people, a believable world. */
export const REAL = [
  "Make it look like an unretouched real photograph, not AI art, not CGI, not a stock photo.",
  "Real textures: skin with pores, small blemishes and natural shine; work clothes with creases, dust and wear; soil, water drops and fingerprints where people work; plants and produce of uneven sizes with a few imperfect leaves.",
  "Light from a real source you could point to (sun through the roof, a window, a lamp, overcast sky), with natural falloff and real shadows; true-to-life, slightly muted colour.",
  "People are caught in the middle of real tasks, not posing; varied ages and bodies; not everyone smiles or looks at the camera; hands hold things naturally with five fingers each.",
  "A believable, lived-in background: real tools, cables, crates, puddles, a bit of clutter, all in correct perspective and scale; nothing floating, melting or repeating.",
  "Composition a photographer would choose: slightly off-centre, some depth, natural lens perspective.",
] as const;

/** What must never be in the picture: the slop markers, said as instructions (image models take no negative prompt). */
export const NEVER = [
  "plastic, waxy or airbrushed skin",
  "glowing, over-saturated or HDR colour, teal-and-orange grading, neon haze, lens flares",
  "a glossy 3D render or video-game look",
  "identical, cloned or symmetrical people or produce",
  "extra, missing or merged fingers, twisted limbs",
  "warped, melted or impossible objects and physics",
  "gibberish letters or fake signs in the background",
  "fake bokeh blobs, dreamy soft-focus glow, a vignette",
  "stock-photo grins with everyone staring at the camera",
] as const;

/** The markers the Checker looks for (the same list, as questions to answer about a finished picture). */
export const SLOP_MARKERS = [
  "plastic or waxy skin",
  "extra, missing or merged fingers or limbs",
  "warped, melted or impossible objects",
  "gibberish letters or fake signs in the background",
  "cloned or identical faces or produce",
  "over-saturated, glowing or HDR-looking colour",
  "looks like a 3D render or digital painting rather than a photo",
] as const;

/** Words that pull image models towards the slop look; taken out of the Prompter's image prompts. */
const SLOP_WORDS = [
  "stunning", "breathtaking", "gorgeous", "beautiful", "epic", "majestic", "magical", "dreamy", "ethereal",
  "vibrant", "vivid", "lush", "glowing", "radiant", "sparkling", "dazzling",
  "cinematic", "hyper-?realistic", "photo-?realistic", "ultra-?realistic", "ultra-?detailed", "hyper-?detailed", "highly detailed",
  "8k", "4k", "uhd", "hdr", "masterpiece", "award-?winning", "trending on artstation", "octane render", "unreal engine",
  "flawless", "perfect", "pristine", "immaculate", "spotless", "picture-?perfect",
];
const SLOP_RE = new RegExp(`\\b(${SLOP_WORDS.join("|")})\\b,?\\s*`, "gi");

/** The prompt without slop words (and the double spaces or stray commas they leave). */
export function stripSlop(text: string): string {
  return text
    .replace(SLOP_RE, "")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/\(\s*\)/g, "")
    .trim();
}

/** The realism block for the Painter: the camera, the photographic rules and what never to show. */
export function realismBlock(camera: string): string {
  return [`Shot as ${camera}.`, ...REAL, `Never: ${NEVER.join("; ")}.`].join("\n");
}

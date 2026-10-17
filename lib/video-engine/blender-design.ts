// Premium 3D (docs/BLENDER.md): Claude designs one Blender scene (tools/blender/scene.ts) from the same brief as the
// motion engine. One Claude call through the given transport; if the answer cannot be used, one more call with the
// problems explained (like designVideo). The scene is checked and completed by normalizeBlenderScene, then the server
// renders it with video-lab/blender-jobs.ts. Claude writes data only; it never names a file: the product is "photo": n.
import { BLENDER_RATIOS, BLENDER_SCENE_FORMAT, normalizeBlenderScene, type BlenderPhoto, type BlenderScene } from "@/tools/blender/scene";
import { DESIGNER_MODEL, DesignError, apiSum, briefText, type ClaudeTransport, type DesignBrief, type DesignUsage } from "./designer";
import { factCheck, type FactWarning } from "./factcheck";
import type { MotionSpec } from "./spec";
import { extractJson } from "./validate";

const MAX_OUTPUT_TOKENS = 6_000;
export const BLENDER_MIN_SECONDS = 4;
export const BLENDER_MAX_SECONDS = 8;

export type BlenderDesign = {
  scene: BlenderScene;
  /** Post caption and hashtags, and one voice-over line for the whole clip (may be empty). */
  caption: string;
  hashtags: string[];
  say: string;
  /** Repairs made to Claude's scene (normalizeBlenderScene and the rules below). */
  warnings: string[];
  /** Numbers and claims in the texts that the brief does not give (factcheck.ts), for the owner to check. */
  factWarnings: FactWarning[];
  usage: DesignUsage[];
  costUsd: number;
  apiEquivalentUsd: number;
  attempts: number;
};

export type BlenderDesignOptions = {
  /** The files behind the brief's photos, in the same order (the server's cache). Without them, placeholders "photo:1". */
  photos?: BlenderPhoto[];
  quality?: BlenderScene["canvas"]["quality"];
};

/** How much of the set a 50 mm lens sees, per unit of camera distance, for a ratio (the camera's sensor is 36 mm). */
function framePerDistance(ratio: string): { width: number; height: number } {
  const [w, h] = ratio.split(":").map(Number);
  const long = (2 * 18) / 50; // the long side of the frame at distance 1
  return w >= h ? { width: long, height: (long * h) / w } : { width: (long * w) / h, height: long };
}

export function blenderSystemPrompt(): string {
  return [
    "You are BuPulse's 3D motion designer. You design premium 3D product clips for small businesses in Rwanda and East Africa, rendered by Blender: one continuous shot of 4 to 8 seconds for Reels, TikTok and Shorts.",
    "You do not write code. You answer with ONE JSON object: a Blender scene in the format below, plus three extra keys: \"caption\" (the post caption, in the content language), \"hashtags\" (3 to 8, without #) and \"say\" (one voice-over line for the whole clip, about 2.5 words per second, in the voice-over language, or empty).",
    "",
    BLENDER_SCENE_FORMAT,
    "",
    "Rules:",
    "- Facts: every word, number and price on screen comes from the brief; copy names and places letter for letter. Never invent prices, discounts, dates, guarantees, 'new', 'best', 'original' or any number. Write a price exactly as the brief gives it (\"420,000 RWF\"). No price in the brief: no price on screen. The business description is about the shop, not this product.",
    "- The product: \"product\": { \"photo\": n } with the best photo of the product itself. When that photo is marked 'cut-out available' the cut-out itself stands on its plinth (with a little thickness and its own shadow): always prefer such a photo; otherwise the photo is printed on a thick rounded card (\"shape\": \"card\") that fills at least 40 % of the frame's height; with 2 or 3 photos list the others in \"more\" (the card flips to the next photo at the middle, or at the thirds); a wide subject (a house, a room) gets \"crop\": 1.15 in 9:16 (1.6 in square and wide frames). Either way it is flat: \"idle\": \"swing\" (angle 12 to 20, spin 0.5), never \"turntable\" or \"spin\". Photos of rooms, houses or streets are shown on a card, large.",
    "- The product is the hero: large, centred (x 0), standing on a plinth (the podium of a product shoot), visible from about 0.3 s and still clearly visible in the last frame. The clip ends on the product with its name and the price (if given).",
    "- Three looks (background.kind); the brief recommends one for its template, use it unless the brand clearly asks for another:",
    "  - \"studio\": the dark showroom. colors [a near-black such as #0b0d12, the brand colour as the glow behind the product], floor the near-black with reflect 0.75 to 0.85, light \"studio\". For phones, electronics, cosmetics, watches, luxury. Plinth: gloss in a very dark brand shade.",
    "  - \"daylight\": a bright, soft studio. colors [a warm white such as #f4f1ec, the brand colour for the accent wall behind the product], floor the same white with reflect 0.25 to 0.35, light \"soft\". For homes, food, fashion, beauty, family and everyday products. Plinth: matte white. Text over the accent wall: white when the wall is a strong colour, the dark brand colour when it is pale.",
    "  - \"neon\": a dark set lit by a neon arch and tubes. colors [a near-black such as #07060f, a bright brand colour for the neon], floor the near-black with reflect 0.85, light \"dramatic\" with rim the neon colour. For launches, offers, tech, fashion drops and young audiences. Plinth: gloss near-black.",
    "- Layout that works for 9:16 (the frame factors in the brief scale it for other ratios): camera target [0, 0, 2.4], distance 10.5, height 1.6, lens 50. A plinth prop at [0, 0, 0], size = the product's width + 0.6 (at least 2.4), height 0.95. The product on it at [0, 0, 0.95], height 2.8 (2.4 for a wide photo such as a house). Title above: [0, -0.3, 4.35], font poppins (or inter), weight bold, size 0.8 to 1.0 (at most 10 characters at 1.0, 12 at 0.8: use the short product name), depth 0.3, face 0.85. Price on the front of the plinth: [0, -(plinth size / 2 + 0.12), 0.62], size 0.5 to 0.6, weight bold. One more short line, if needed, above the title: [0, -0.3, 5.15], size 0.45 to 0.55, weight regular. The phone number last, labelled with what it is for (\"WhatsApp +250 788 300 400\" when the facts mention WhatsApp, otherwise \"Call +250 ...\" in the content language; a business without a phone: where to find it, \"Find us at Kibagabaga\"), as a clean flat bar on the plinth under the price: font poppins, weight regular, size 0.32, plate = the brand colour, color white or the dark brand colour (whichever contrasts with the plate), position [0, -(plinth size / 2 + 0.12), 0.22], enter pop at about half the clip.",
    "- Texts: at most 4 (title, price, one short line, the phone bar), one line each (no line breaks). Two weights: the title and the price bold (poppins or inter, weight bold; anton only for one very short word), the other lines regular (inter or poppins, weight regular). size is the font size (capitals are about 0.65 x size tall); smaller than 0.45 does not read on a phone, except the phone bar (0.32 on its plate). A line is about 0.26 x size x characters wide in anton, 0.36 in poppins and 0.47 in inter, nunito, space-grotesk, playfair or dm-serif: keep it narrower than the frame width minus 0.6.",
    "- Never put a text over the product: texts sit above its top or on or in front of the plinth below it, never at the product's height in front of it. Leave 0.2 between texts.",
    "- Text materials: \"metal\" (gold, for prices and titles on dark sets) and \"gloss\" (clean coloured or white letters) read best; \"chrome\" only for big titles (size 0.8 or more) on dark sets; \"neon\" only in the neon look; on daylight sets gloss or matte, never gold or silver. depth 0.3 to 0.5, bevel 0.4 to 0.6.",
    "- Props besides the plinth: only when the template asks (a ring or spheres for launches and luxury), at most 2, small (size 0.3 to 0.6), beside the product (|x| = half its width + 0.5), never in front of it or across a text. Particles: confetti only for launches and offers; sparkles or dust otherwise (count 20 to 40).",
    "- Motion: every clip moves. Camera: orbitRight or orbitLeft (intensity 0.3 to 0.45) or dollyIn (0.3 to 0.5), never static. The product swings gently (above). The title floats (idle float) after it enters. A light sweeps across the product by itself.",
    "- Timing: the first frame is the thumbnail, so the product and the title are already on screen at 0 s: both enter \"settle\" at 0 s for 0.6 s. The other lines arrive by 40 % of the clip, the phone bar at about half; everything has entered by 60 % so the end holds still and readable for at least 1.5 s.",
    "- look: contrast \"medium\", bloom 0.15 (0.35 for neon), exposure 0 (0.2 for daylight). fstop 0.",
    "- Follow the template's art direction (written for the 2D engine: translate its spirit, colours, camera and materials to this 3D scene) and the research block where they fit these rules.",
    "- canvas: the ratio from the brief, quality \"540p\", fps 24. duration: the seconds from the brief. A seed of your choice.",
  ].join("\n");
}

/** The look a template asks for: launches and drops in neon, homes, food, fashion and everyday products in daylight,
 * phones, electronics and luxury in the dark showroom. */
export function lookForTemplate(templateId: string, productName = ""): "studio" | "daylight" | "neon" {
  if (/title-drop|confetti|launch|hypermotion|glass-cards|colour-pop|tiktok|offer|price-drop/.test(templateId)) return "neon";
  if (/house|home|apartment|plot|room|food|dress|fashion|kitenge|shoe|bag|cake|coffee|juice/i.test(productName)) return "daylight";
  if (/kigali-market|golden-hour|marketplace|ugc|brand-story|ice-splash|colour-options/.test(templateId)) return "daylight";
  return "studio";
}

/** The user message: the motion engine's brief (business, product, photos, template, research), plus the 3D frame size. */
export function blenderBriefText(brief: DesignBrief): string {
  const ratio = (BLENDER_RATIOS as readonly string[]).includes(brief.ratio) ? brief.ratio : "9:16";
  const seconds = Math.min(BLENDER_MAX_SECONDS, Math.max(BLENDER_MIN_SECONDS, Math.round(brief.seconds)));
  const f = framePerDistance(ratio);
  const base = briefText({ ...brief, ratio: ratio as DesignBrief["ratio"], seconds, mode: "reference", base: null, cartoonId: null, variation: null });
  const extra = [
    `This is a Premium 3D clip: answer with a Blender scene (not a MotionSpec). Ratio ${ratio}, ${seconds} seconds.`,
    `Frame size with a 50 mm lens: about ${f.width.toFixed(2)} x distance wide and ${f.height.toFixed(2)} x distance tall (at distance 9: ${(9 * f.width).toFixed(1)} wide, ${(9 * f.height).toFixed(1)} tall), centred on the camera target.`,
    `Recommended look for this template: "${lookForTemplate(brief.styleId, brief.product.name)}".`,
    brief.fixedLens ? "Fixed lens: camera move static." : "",
    brief.mode === "text" || !brief.photos.length ? "No photos: \"product\": null; the clip is 3D text, props and particles, with the product's name as the hero." : "",
  ].filter(Boolean);
  return `${extra.join("\n")}\n\n${base}`;
}

/** Problems that make an answer unusable (the retry explains them to Claude). */
function problems(raw: unknown, scene: BlenderScene, warnings: string[], brief: DesignBrief): string[] {
  const out: string[] = [];
  const r = (raw ?? {}) as { product?: unknown; texts?: unknown };
  const wantsProduct = brief.mode !== "text" && brief.photos.length > 0;
  if (wantsProduct && !scene.product) out.push(`"product" must be { "photo": n } with n from 1 to ${brief.photos.length}`);
  if (!scene.texts.length) out.push("there must be at least one text (the product's name)");
  if (!Array.isArray(r.texts) && r.texts !== undefined) out.push('"texts" must be an array');
  for (const w of warnings) if (/not allowed|does not exist/.test(w)) out.push(w);
  return out;
}

/**
 * Designs one Blender scene for the brief. Returns the checked scene (ready for renderBlenderScene), the caption, the
 * repairs and the fact warnings. Usage of every call is returned (also on failure, in DesignError.usage).
 */
export async function designBlenderScene(brief: DesignBrief, send: ClaudeTransport, model = DESIGNER_MODEL, opts: BlenderDesignOptions = {}): Promise<BlenderDesign> {
  const system = blenderSystemPrompt();
  const content: unknown[] = [
    { type: "text", text: blenderBriefText(brief) },
    ...brief.photos.flatMap((p, i) => [
      { type: "text", text: `Photo ${i + 1}:` },
      { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.base64 } },
    ]),
  ];
  const photos: BlenderPhoto[] = opts.photos ?? brief.photos.map((p, i) => ({ image: `photo:${i + 1}`, cutout: p.cutout ? `photo:${i + 1}:cutout` : null }));
  const seconds = Math.min(BLENDER_MAX_SECONDS, Math.max(BLENDER_MIN_SECONDS, Math.round(brief.seconds)));
  const usage: DesignUsage[] = [];
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const turn = attempt === 1 ? content : [...content, { type: "text", text: `Your previous answer could not be used: ${lastError}. Answer again with one complete, valid JSON Blender scene only.` }];
    const answer = await send({ model, system, content: turn, maxTokens: MAX_OUTPUT_TOKENS }).catch((e: unknown) => {
      throw e instanceof DesignError ? new DesignError(e.message, [...usage, ...e.usage]) : e;
    });
    usage.push(answer.usage);
    if (answer.stop === "refusal") throw new DesignError("Claude declined to design this clip.", usage);
    let raw: unknown;
    try {
      raw = extractJson(answer.text);
    } catch (e) {
      lastError = answer.stop === "max_tokens" ? "it was cut off because it was too long" : e instanceof Error ? e.message : "invalid answer";
      continue;
    }
    const { scene, warnings } = normalizeBlenderScene(raw, { photos });
    const found = problems(raw, scene, warnings, brief).map((x) => x.replace(/\.$/, ""));
    if (found.length) {
      lastError = found.join("; ");
      continue;
    }
    repair(scene, brief, seconds, { ...opts, photos }, warnings);
    const extra = raw as { caption?: unknown; hashtags?: unknown; say?: unknown };
    const caption = typeof extra.caption === "string" ? extra.caption.slice(0, 600) : "";
    const hashtags = Array.isArray(extra.hashtags) ? extra.hashtags.filter((h): h is string => typeof h === "string").map((h) => h.replace(/^#/, "").trim()).filter(Boolean).slice(0, 12) : [];
    const say = typeof extra.say === "string" ? extra.say.slice(0, 300) : "";
    return { scene, caption, hashtags, say, warnings, factWarnings: blenderFactCheck(scene, caption, say, brief), usage, costUsd: sum(usage), apiEquivalentUsd: apiSum(usage), attempts: attempt };
  }
  throw new DesignError("Claude's 3D design could not be used. Please try again.", usage);
}

/** The house rules a scene must keep whatever Claude wrote; each change is listed in `warnings`. */
function repair(scene: BlenderScene, brief: DesignBrief, seconds: number, opts: BlenderDesignOptions, warnings: string[]): void {
  if (scene.duration !== seconds) {
    warnings.push(`Length set to ${seconds} s (the brief's length).`);
    scene.duration = seconds;
  }
  const ratio = (BLENDER_RATIOS as readonly string[]).includes(brief.ratio) ? (brief.ratio as BlenderScene["canvas"]["ratio"]) : "9:16";
  scene.canvas.ratio = ratio;
  scene.canvas.quality = opts.quality ?? "540p";
  if (brief.fixedLens) scene.camera.move = "static";
  // A product photo is flat (a cut-out plane or a card): a full turn shows its edge or its mirrored back.
  if (scene.product && (scene.product.idle === "turntable" || scene.product.idle === "spin")) {
    warnings.push(`The product's "${scene.product.idle}" became a swing: a photo is flat and would show its edge.`);
    scene.product.idle = "swing";
    scene.product.angle = Math.min(scene.product.angle, 30);
    scene.product.spin = Math.min(scene.product.spin, 1);
  }
  const facts = factWords(brief);
  const phoneDigits = (brief.business.phone ?? "").replace(/\D/g, "");
  for (const t of scene.texts) {
    // The business's phone number, written the way the brief writes it (groups of digits read better).
    const digits = t.text.replace(/\D/g, "");
    if (phoneDigits.length >= 9 && digits.length >= 9 && (phoneDigits.endsWith(digits) || digits.endsWith(phoneDigits)) && t.text !== brief.business.phone) {
      t.text = brief.business.phone as string;
    }
    const fixed = fixSpelling(t.text, facts);
    if (fixed !== t.text) {
      warnings.push(`"${t.text}" corrected to "${fixed}" (the spelling in the brief).`);
      t.text = fixed;
    }
    // Chrome mirrors the dark set: only big titles catch enough light to read.
    if (t.material === "chrome" && t.size < 0.8) {
      t.material = "gloss";
      warnings.push(`"${t.text}" is gloss instead of chrome so it reads at this size.`);
    }
    // Smaller letters do not read on a phone at 540p (a label on its bar reads at 0.3).
    if (t.size < 0.5 && !t.plate) {
      t.size = 0.5;
      warnings.push(`"${t.text}" made bigger so it reads on a phone.`);
    }
    if (/[\r\n]/.test(t.text)) {
      t.text = t.text.replace(/\s*[\r\n]+\s*/g, " ");
      warnings.push(`"${t.text}" was put on one line.`);
    }
  }
  // Everything has entered by 60 % of the clip, so the end holds still and readable.
  const latest = scene.duration * 0.6;
  for (const m of [scene.product, ...scene.texts]) {
    if (m && m.enter !== "none" && m.enterAt + m.enterFor > latest) {
      m.enterAt = Math.max(0, Math.round((latest - m.enterFor) * 100) / 100);
      if (m.enterAt + m.enterFor > latest) m.enterFor = Math.max(0.3, latest - m.enterAt);
      warnings.push("An entrance was moved earlier so the end of the clip holds still.");
    }
  }
  const photo = scene.product?.photo ? brief.photos[scene.product.photo - 1] : undefined;
  const aspect = stage(scene, brief, photo && photo.height ? photo.width / photo.height : 1, warnings, opts.photos);
  fitLayout(scene, aspect, warnings);
  fillFrame(scene, aspect, warnings);
  // fitLayout runs once per size step: keep each repair once.
  const unique = [...new Set(warnings)];
  warnings.splice(0, warnings.length, ...unique);
  // Entrances never cross the product: a text above it drops in (a rise would come up through it), one below rises.
  const p = scene.product;
  if (p) {
    for (const t of scene.texts) {
      const above = t.position[2] > p.position[2] + p.height / 2;
      if (above && t.enter === "rise") t.enter = "drop";
      if (!above && t.enter === "drop") t.enter = "rise";
    }
  }
}

/** How light a colour is, 0 (black) to 1 (white). */
function lightness(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The premium staging every clip gets, whatever Claude wrote: the product stands on a plinth, the camera and the
 * product move, the phone number is a clean flat bar in the brand colour, and the glow stays soft (text stays crisp).
 */
export function stage(scene: BlenderScene, brief: DesignBrief, aspect: number, warnings: string[], photos?: BlenderPhoto[]): number {
  const look = scene.background.kind;
  const cam = scene.camera;
  if (!brief.fixedLens && cam.move === "static") {
    cam.move = "dollyIn";
    cam.intensity = 0.35;
    warnings.push("The camera moves (dolly in): a still camera looks flat.");
  }
  if (cam.move !== "static" && cam.intensity < 0.25) cam.intensity = 0.3;
  const maxBloom = look === "neon" ? 0.4 : 0.2;
  if (scene.look.bloom > maxBloom) scene.look.bloom = maxBloom;
  const p = scene.product;
  if (p) {
    // A card shows every photo (it flips to the next at the middle, or at the thirds); a cut-out stays single.
    if (p.cutout) {
      p.more = [];
      p.gallery = [];
    } else if (photos && brief.photos.length > 1) {
      // Every photo, Claude's order first (at most 3 in all).
      const all = [...p.more, ...brief.photos.map((_, i) => i + 1)].filter((n, i, list) => n !== p.photo && !!photos[n - 1] && list.indexOf(n) === i).slice(0, 2);
      if (all.length !== p.more.length) warnings.push(`The card flips to show ${all.length + 1} photos.`);
      p.more = all;
      p.gallery = all.map((n) => photos[n - 1].image);
    }
    // A wide subject (a house, a room, a landscape photo) gets a wide card, cropped from the photo's centre: about 7:6 in a
    // tall frame, so it can still fill 40 % of the frame's height; 16:10 in square and wide frames.
    const wide = aspect >= 1.2 || /\b(house|home|apartment|villa|plot|land|room|hotel|office|restaurant|garden|compound)\b/i.test(brief.product.name);
    if (!p.cutout && wide && p.crop === null) {
      const [rw, rh] = scene.canvas.ratio.split(":").map(Number);
      p.crop = rw < rh ? 1.15 : 1.6;
      warnings.push("A wide card for a wide subject.");
    }
    // A wide card nearly fills the frame's width: a dolly (wider at one end) would leave it small, so it orbits.
    if (p.crop && p.crop > 1 && (cam.move === "dollyIn" || cam.move === "dollyOut")) {
      cam.move = "orbitRight";
      cam.intensity = 0.3;
      warnings.push("The camera orbits instead of dollying: a wide card fills the frame's width.");
    }
    if (!p.cutout && p.crop) aspect = p.crop;
    if (p.idle !== "swing") {
      warnings.push(`The product swings gently instead of "${p.idle}".`);
      p.idle = "swing";
      p.spin = 0.5;
    }
    p.angle = Math.min(22, Math.max(10, p.angle));
    // A tall, narrow product (a dress, a bottle) stands taller so it still fills the frame.
    if (aspect < 0.7 && p.height < 3.2) p.height = 3.2;
    const width = p.height * aspect;
    let plinth = scene.props.find((pr) => pr.kind === "plinth" && Math.abs(pr.position[0] - p.position[0]) < 0.6 && Math.abs(pr.position[1] - p.position[1]) < 0.6);
    if (!plinth) {
      const dark = look === "daylight" ? null : look === "studio" ? "#15171c" : "#0c0b14";
      plinth = {
        kind: "plinth",
        position: [p.position[0], p.position[1], 0],
        size: round2(Math.max(2.4, width + 0.6)),
        height: 0.95,
        material: dark ? "gloss" : "matte",
        color: dark ?? "#ffffff",
        enter: "none",
        enterAt: 0,
        enterFor: 0.9,
        idle: "none",
        spin: 1,
        angle: 30,
      };
      scene.props.unshift(plinth);
      warnings.push("The product stands on a plinth.");
    }
    if (plinth.size < width + 0.5) plinth.size = round2(width + 0.6);
    if (plinth.height < 0.3) plinth.height = 0.95;
    if (Math.abs(p.position[2] - plinth.height) > 0.01) p.position = [p.position[0], p.position[1], plinth.height];
  }
  // The phone number: a flat bar in the brand colour, at the front, not shouting 3D letters.
  const phone = (brief.business.phone ?? "").replace(/\D/g, "");
  const plate = brief.business.colors?.[0] && /^#[0-9a-f]{6}$/i.test(brief.business.colors[0]) ? brief.business.colors[0] : scene.background.colors[1];
  for (const t of scene.texts) {
    const digits = t.text.replace(/\D/g, "");
    if (!(phone.length >= 9 && digits.length >= 9 && (phone.endsWith(digits) || digits.endsWith(phone))) && !t.plate) continue;
    if (!t.plate) warnings.push(`"${t.text}" is a flat bar, not 3D letters.`);
    t.plate = t.plate ?? plate;
    t.font = "poppins";
    t.weight = "regular";
    t.size = Math.min(0.4, Math.max(0.3, t.size));
    t.depth = 0;
    t.bevel = 0;
    t.color = lightness(t.plate) < 0.55 ? "#ffffff" : "#111111";
    if (t.enter === "spinIn" || t.enter === "drop") t.enter = "pop";
    t.text = groupPhone(t.text);
    // A number alone does not say what it is for: label it (the Brain's labelled-number rule).
    if (/^[+\d\s()-]+$/.test(t.text)) {
      t.text = `${phoneLabel(brief)} ${t.text}`;
      warnings.push(`The phone bar says what the number is for: "${t.text}".`);
    }
  }
  if (!p) return aspect;
  // Frame 0 is the thumbnail: the product is there from the first frame and settles into place by 0.6 s.
  if (p.enter !== "settle" || p.enterAt !== 0 || p.enterFor > 0.6) {
    Object.assign(p, { enter: "settle", enterAt: 0, enterFor: 0.6 });
    warnings.push("The product is on screen from the first frame (the thumbnail).");
  }
  // Titles: a crisp bold sans, big enough, there from the first frame; they face the camera and are not too deep.
  const maxWidth = framePerDistance(scene.canvas.ratio).width * 10.5 - 0.6;
  const titles = scene.texts.filter((t) => !t.plate && t.position[2] >= p.position[2] + p.height / 2);
  for (const t of titles) {
    if (t.font === "anton" && t.text.length > 4) {
      t.font = "poppins";
      warnings.push(`"${t.text}" is in poppins bold: thin condensed letters blur at 540p.`);
    }
    t.weight = t.weight === "regular" && t !== titles[0] ? "regular" : "bold";
    const fit = maxWidth / (textWidth({ ...t, size: 1 }) || 1);
    const wanted = Math.min(t.weight === "bold" ? Math.max(t.size, 0.75) : t.size, fit);
    t.size = round2(Math.max(t.weight === "bold" ? 0.6 : 0.45, wanted));
    t.face = Math.max(t.face, 0.8);
    t.depth = Math.min(t.depth, 0.35);
  }
  // Daylight: a line over the accent wall stays inside it (white text on the white set would vanish): smaller, then on
  // two lines. The wall (7.5 wide, 3.4 behind the product) looks narrower from the text's depth, and an orbit slides it.
  if (look === "daylight") {
    const camY = cam.target[1] - cam.distance;
    const slide = cam.move === "orbitLeft" || cam.move === "orbitRight" ? Math.sin(((8 + 42 * cam.intensity) * Math.PI) / 180) : 0;
    for (const t of titles) {
      const near = t.position[1] - camY;
      const far = 3.4 - camY;
      const wall = (7.5 * near) / far - 2 * (3.4 - t.position[1]) * slide * (near / far) - 0.5;
      if (textWidth(t) <= wall) continue;
      const floor = t === titles[0] && t.weight === "bold" ? 0.6 : 0.4;
      t.size = round2(Math.max(floor, (wall / textWidth({ ...t, size: 1 })) * 0.98));
      if (textWidth(t) > wall && t.text.includes(" ")) {
        t.text = wrapInTwo(t.text);
        t.size = round2(Math.min(t.size * 1.4, Math.max(floor, (wall / textWidth({ ...t, size: 1 })) * 0.98)));
      }
      warnings.push(`"${t.text.replace("\n", " / ")}" fits inside the accent wall.`);
    }
  }
  const main = [...titles].sort((a, b) => b.size - a.size)[0];
  if (main && (main.enter !== "settle" || main.enterAt !== 0)) {
    Object.assign(main, { enter: "settle", enterAt: 0, enterFor: 0.6 });
    warnings.push(`"${main.text}" is on screen from the first frame (the thumbnail).`);
  }
  // On the front of the plinth: the bar at the bottom, the price (and any low line) above it; the plinth grows to hold them.
  const plinth = scene.props.find((pr) => pr.kind === "plinth")!;
  const front = round2(plinth.position[1] - plinth.size / 2 - 0.12);
  let top = 0.05;
  const low = scene.texts.filter((t) => t.position[2] < p.position[2] + p.height / 2).sort((a, b) => Number(!!b.plate) - Number(!!a.plate) || a.position[2] - b.position[2]);
  for (const t of low) {
    const h = t.plate ? textHeight(t) + 0.45 * t.size : textHeight(t);
    const z = Math.max(top + h / 2, t.plate ? 0 : t.position[2]);
    t.position = [t.position[0], Math.min(t.position[1], front), round2(z)];
    // A label on the plinth's front stays flat to it (turning to the camera would push its ends into the plinth) and
    // shallow (seen at an angle, deep letters show their sides and smear).
    t.face = 0;
    t.depth = Math.min(t.depth, 0.12);
    t.bevel = Math.min(t.bevel, 0.3);
    top = z + h / 2 + 0.12;
  }
  const widest = Math.max(0, ...low.map((t) => textWidth(t)));
  if (plinth.size < widest + 0.4) plinth.size = round2(widest + 0.4);
  const needed = round2(Math.max(plinth.height, top + 0.02));
  if (needed > plinth.height) {
    plinth.height = needed;
    warnings.push("The plinth grew to hold the price and the phone bar.");
  }
  p.position = [p.position[0], p.position[1], plinth.height];
  // The camera turns around a point a third of the way to the plinth's front, so an orbit slides the price and the bar
  // less (they are nearest the camera) while the product still turns.
  if (low.length) scene.camera.target = [scene.camera.target[0], round2(front * 0.35), scene.camera.target[2]];
  return aspect;
}

/** What the phone bar's number is for, in the content language: WhatsApp when the facts mention it, else a call. */
export function phoneLabel(brief: DesignBrief): string {
  const p = brief.product;
  const facts = [brief.business.description, brief.business.name, p.summary, p.description, ...(p.usps ?? []), ...(p.features ?? []), brief.note].filter(Boolean).join(" ");
  if (/whats\s?app/i.test(facts)) return "WhatsApp";
  const lang = (brief.business.language ?? "").toLowerCase();
  if (/^(rw|kin)/.test(lang)) return "Hamagara";
  if (/^(fr)/.test(lang)) return "Appelez le";
  if (/^(sw|kis)/.test(lang)) return "Piga simu";
  return "Call";
}

/** Splits a line in two at the space nearest its middle. */
export function wrapInTwo(text: string): string {
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

/**
 * A photo card fills at least 40 % of the frame's height, even at the widest moment of the camera move: the product
 * grows (the title moves up with it and the camera steps back if it must), a few times until it settles.
 */
export function fillFrame(scene: BlenderScene, aspect: number, warnings: string[]): void {
  const p = scene.product;
  if (!p || p.cutout) return;
  const cam = scene.camera;
  const f = framePerDistance(scene.canvas.ratio);
  for (let i = 0; i < 4; i++) {
    const widest = cam.move === "dollyIn" || cam.move === "dollyOut" ? 1 + 0.55 * cam.intensity : 1;
    const share = p.height / (f.height * cam.distance * widest * (50 / cam.lens));
    if (share >= 0.4) return;
    p.height = round2(Math.min(5, (p.height * 0.42) / share));
    const plinth = scene.props.find((pr) => pr.kind === "plinth");
    if (plinth && plinth.size < p.height * aspect + 0.3) plinth.size = round2(p.height * aspect + 0.3);
    if (i === 0) warnings.push("The photo card is bigger: it fills at least 40 % of the frame.");
    fitLayout(scene, aspect, warnings);
  }
}

/** A Rwandan number in groups ("+250788300400" becomes "+250 788 300 400"); other numbers stay as they are. */
export function groupPhone(text: string): string {
  const m = /^\s*(\+?250)\s*(\d{3})\s*(\d{3})\s*(\d{3})\s*$/.exec(text);
  return m ? `+250 ${m[2]} ${m[3]} ${m[4]}` : text;
}

/** Width of one character at size 1, measured in Blender 5.2 on "GALAXY A56 420,000 RWF" (capitals and digits). */
const CHAR_WIDTH: Record<BlenderScene["texts"][number]["font"], number> = { anton: 0.26, poppins: 0.36, inter: 0.47, nunito: 0.47, "space-grotesk": 0.47, playfair: 0.49, "dm-serif": 0.45 };
type TextBox = Pick<BlenderScene["texts"][number], "font" | "size" | "text">;
/** About how wide a line of 3D text is, in scene units. */
export const textWidth = (t: TextBox & { plate?: string | null }) => CHAR_WIDTH[t.font] * t.size * Math.max(...t.text.split("\n").map((l) => l.length)) + (t.plate ? 0.64 * t.size + 0.1 : 0);
/** How tall its capitals are (size is the font size: capitals are about 0.6 to 0.7 of it). */
export const textHeight = (t: Pick<BlenderScene["texts"][number], "size"> & { text?: string }) => {
  const n = t.text ? t.text.split("\n").length : 1;
  return 0.7 * t.size * n + 0.35 * t.size * (n - 1);
};

/**
 * Keeps the ad readable whatever Claude placed: texts in front of the product move above or below it (the product rises
 * when there is no room under it), texts do not overlap each other, props in front of the product move behind it, and
 * the camera aims at the middle of it all and stands far enough back to see it with a margin. `aspect`: the product
 * photo's width / height. Each change is listed in `warnings`.
 */
export function fitLayout(scene: BlenderScene, aspect: number, warnings: string[]): void {
  const p = scene.product;
  const box = p ? { w: p.height * aspect, z0: p.position[2], z1: p.position[2] + p.height, x: p.position[0], y: p.position[1] } : null;
  const overlapsX = (a: number, aw: number, b: number, bw: number) => Math.abs(a - b) < (aw + bw) / 2;
  const texts = [...scene.texts].sort((a, b) => a.position[2] - b.position[2]);
  if (box && p) {
    const mid = (box.z0 + box.z1) / 2;
    const covering = (t: (typeof texts)[number]) => t.position[1] < box.y + 0.3 && overlapsX(t.position[0], textWidth(t), box.x, box.w) && Math.abs(t.position[2] - mid) < (textHeight(t) + p.height) / 2;
    // Texts below the middle go under the product, lowest first; the product rises if they need the room.
    let floorZ = 0.12;
    for (const t of texts.filter((t) => covering(t) && t.position[2] < mid)) {
      const z = Math.max(floorZ + textHeight(t) / 2, Math.min(t.position[2], box.z0 - 0.15 - textHeight(t) / 2));
      t.position = [t.position[0], t.position[1], round2(z)];
      floorZ = z + textHeight(t) / 2 + 0.2;
      if (floorZ - 0.05 > box.z0) {
        const lift = floorZ - 0.05 - box.z0;
        box.z0 += lift;
        box.z1 += lift;
        p.position = [p.position[0], p.position[1], round2(box.z0)];
      }
      warnings.push(`"${t.text}" moved under the product so it does not cover it.`);
    }
    let topZ = box.z1 + 0.2;
    for (const t of texts.filter((t) => t.position[2] >= mid)) {
      if (t.position[1] < box.y + 0.3 && overlapsX(t.position[0], textWidth(t), box.x, box.w) && t.position[2] - textHeight(t) / 2 < topZ) {
        t.position = [t.position[0], t.position[1], round2(topZ + textHeight(t) / 2)];
        warnings.push(`"${t.text}" moved above the product so it does not cover it.`);
      }
      topZ = Math.max(topZ, t.position[2] + textHeight(t) / 2 + 0.2);
    }
    // The plinth under the product: it rises with the product, and the texts low down stand in front of it (the
    // phone bar further forward, so it shows below the price).
    const plinth = scene.props.find((pr) => pr.kind === "plinth" && Math.abs(pr.position[0] - box.x) < 0.6 && Math.abs(pr.position[1] - box.y) < 0.6);
    if (plinth) {
      if (box.z0 > 0.3 && Math.abs(plinth.height - box.z0) > 0.01) plinth.height = round2(box.z0);
      const r = plinth.size / 2;
      for (const t of texts) {
        if (t.position[2] - textHeight(t) / 2 > plinth.height + 0.05 || !overlapsX(t.position[0], textWidth(t), plinth.position[0], plinth.size)) continue;
        const front = round2(plinth.position[1] - r - 0.12);
        if (t.position[1] > front) {
          t.position = [t.position[0], front, t.position[2]];
          warnings.push(`"${t.text}" moved in front of the plinth.`);
        }
      }
    }
    // Props (not the plinth under it) never hide the product or hide behind it: they go to its sides.
    for (const pr of scene.props) {
      if (pr.kind === "plinth" || !overlapsX(pr.position[0], pr.size, box.x, box.w) || pr.position[2] > box.z1 || pr.position[2] + pr.size < box.z0) continue;
      const side = pr.position[0] < box.x ? -1 : 1;
      pr.position = [round2(box.x + side * (box.w / 2 + pr.size / 2 + 0.15)), Math.max(pr.position[1], round2(box.y + 0.6)), pr.position[2]];
      warnings.push(`A ${pr.kind} moved beside the product so it does not cover or hide behind it.`);
    }
  }
  // Texts that still overlap each other: the upper one moves up.
  for (let i = 1; i < texts.length; i++) {
    const a = texts[i - 1];
    const b = texts[i];
    const gap = b.position[2] - textHeight(b) / 2 - (a.position[2] + textHeight(a) / 2);
    if (gap < 0.15 && overlapsX(a.position[0], textWidth(a), b.position[0], textWidth(b)) && Math.abs(a.position[1] - b.position[1]) < 0.6) {
      b.position = [b.position[0], b.position[1], round2(b.position[2] + 0.15 - gap)];
      warnings.push(`"${b.text}" moved up so it does not touch "${a.text}".`);
    }
  }
  // The camera: aim at the middle of everything and stand back far enough (at the end of its move) to see it all.
  // An orbit slides things in front of the target sideways (parallax): give them that much more room.
  const cam = scene.camera;
  const slide = cam.move === "orbitLeft" || cam.move === "orbitRight" ? Math.sin(((8 + 42 * cam.intensity) * Math.PI) / 180) : 0;
  const parts = [
    ...(box ? [{ z0: box.z0, z1: box.z1, half: Math.abs(box.x) + box.w / 2 }] : []),
    // Texts in front of the target are nearer the camera, so they look bigger too.
    ...scene.texts.map((t) => {
      const nearer = Math.max(0, cam.target[1] - t.position[1]);
      return { z0: t.position[2] - textHeight(t) / 2, z1: t.position[2] + textHeight(t) / 2, half: (Math.abs(t.position[0]) + textWidth(t) / 2) * (1 + nearer / cam.distance) + 1.2 * nearer * slide };
    }),
    ...scene.props.filter((pr) => pr.kind === "sphere" || pr.kind === "ring").map((pr) => ({ z0: pr.position[2] - pr.size / 2, z1: pr.position[2] + pr.size / 2, half: Math.abs(pr.position[0]) + pr.size / 2 })),
    ...scene.props.filter((pr) => pr.kind === "plinth").map((pr) => ({ z0: pr.position[2], z1: pr.position[2] + pr.height, half: Math.abs(pr.position[0]) + pr.size / 2 })),
  ];
  if (!parts.length) return;
  const z0 = Math.min(...parts.map((x) => x.z0));
  const z1 = Math.max(...parts.map((x) => x.z1));
  const half = Math.max(...parts.map((x) => x.half));
  const f = framePerDistance(scene.canvas.ratio);
  const k = 50 / cam.lens;
  const needed = Math.max((z1 - z0 + 0.6) / (f.height * k), (2 * half + 0.4) / (f.width * k));
  const endFactor = cam.move === "dollyIn" ? 1 - 0.12 * cam.intensity : 1;
  const distance = Math.min(18, needed / endFactor);
  const centre = round2((z0 + z1) / 2);
  if (Math.abs(cam.target[2] - centre) > 0.3) {
    cam.target = [0, cam.target[1], centre];
    warnings.push("The camera now aims at the middle of the product and the texts.");
  }
  if (cam.distance < distance) {
    cam.distance = round2(distance);
    warnings.push(`The camera moved back to ${cam.distance} so everything fits.`);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The words of the brief's facts (business and product names, product facts, the owner's note), lower case. */
function factWords(brief: DesignBrief): Set<string> {
  const p = brief.product;
  const text = [brief.business.name, p.name, p.summary, p.description, p.price, ...(p.usps ?? []), ...(p.features ?? []), p.targetCustomer, brief.note].filter(Boolean).join(" ");
  return new Set(text.toLowerCase().match(/\p{L}+/gu) ?? []);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/**
 * Puts back the brief's spelling of a word Claude got slightly wrong ("KIBAGABARA" for Kibagabaga): a word of 5 letters
 * or more that is not in the facts but is 1 or 2 letters away from a fact word with the same first letter. The case of
 * Claude's word is kept (all capitals stay capitals).
 */
export function fixSpelling(text: string, facts: Set<string>): string {
  return text.replace(/\p{L}{5,}/gu, (word) => {
    const w = word.toLowerCase();
    if (facts.has(w) || facts.has(w.replace(/s$/, ""))) return word;
    let best: string | null = null;
    for (const f of facts) {
      if (f.length < 5 || f[0] !== w[0] || Math.abs(f.length - w.length) > 2) continue;
      const d = editDistance(w, f);
      if (d <= (w.length >= 8 ? 2 : 1) && (!best || d < editDistance(w, best))) best = f;
    }
    if (!best) return word;
    if (word === word.toUpperCase()) return best.toUpperCase();
    return word[0] === word[0].toUpperCase() ? best[0].toUpperCase() + best.slice(1) : best;
  });
}

/** factCheck (factcheck.ts) on the scene's texts, the voice line and the caption. */
export function blenderFactCheck(scene: BlenderScene, caption: string, say: string, brief: DesignBrief): FactWarning[] {
  const layers = scene.texts.map((t) => ({ kind: "text", text: t.text }));
  const asSpec = { scenes: [{ layers, say }], caption } as unknown as Pick<MotionSpec, "scenes" | "caption">;
  return factCheck(asSpec, brief).map((w) => ({ ...w, where: w.where.replace(/^scene 1 text/, "3D text").replace(/^scene 1 voice/, "voice-over") }));
}

const sum = (usage: DesignUsage[]) => Math.round(usage.reduce((s, u) => s + u.costUsd, 0) * 1_000_000) / 1_000_000;

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
    "- The product: \"product\": { \"photo\": n } with the best photo of the product itself. When that photo is marked 'cut-out available' the product stands free in the set: use \"idle\": \"swing\" (angle 15 to 30, spin 0.5) or \"float\", never \"turntable\" or \"spin\" (it is a flat picture and would show its edge). Without a cut-out it is printed on a rounded card (\"shape\": \"card\"): also swing or float. Photos of rooms, houses or streets are shown on a card, large.",
    "- The product is the hero: large, centred (x 0), visible from about 0.3 s, and still clearly visible in the last frame. The clip ends on the product with its name (and the price, if given).",
    "- Layout that works for 9:16 (start from it; the frame factors in the brief scale it for other ratios): camera target [0, 0, 2.2], distance 9.5, height 1.6, lens 50 (the frame is then about 3.8 wide and 6.8 tall, from z -1.2 to 5.6 around the target). Product height 2.6 at position [0, 0, 0.9] (its bottom at z 0.9, top at 3.5): floating with idle float, or standing on a plinth of height 0.9. Title above it: position [0, -0.3, 4.15], size 0.8 to 1.0. Price (or one short line) below it, in front: position [0, -1.0, 0.45], size 0.6 to 0.7. One more short line, if really needed, goes above the title ([0, -0.3, 5.0], size 0.5 to 0.6), never lower than the price. A wide photo (a house, a room) is wider than tall: height 2.2 so it fits the width.",
    "- Texts: at most 3, one line each (no line breaks): the product's name or hook (1 to 3 words), the price if given, and at most one more short line (3 to 4 words). size is the font size (capitals are about 0.65 x size tall): titles 0.8 to 1.0, other lines 0.5 to 0.7 (smaller does not read on a phone). A line is about 0.26 x size x characters wide in anton, 0.36 in poppins and 0.47 in inter, nunito, space-grotesk, playfair or dm-serif: keep it narrower than the frame width minus 0.6.",
    "- Never put a text over the product: texts sit above its top or below its bottom, never at the same height in front of it. Leave 0.2 between texts. The phone number and long sentences belong in the caption, not in the clip.",
    "- Readability: text contrasts with the background behind it (light text on dark sets, dark or saturated text on light sets). Metal and chrome text only on dark sets (chrome only for big titles, size 0.8 or more; gold metal or white gloss read best); on light sets use gloss or matte in a strong brand colour. Never gold or silver text on a white set.",
    "- Props: only when the template asks for them (a plinth for posters, a ring or spheres for launches and luxury); otherwise none. At most 3, small (size 0.3 to 0.6), beside the product (|x| = half the product's width + 0.5), never in front of it or across a text. Particles: confetti only for launches and offers; sparkles or dust otherwise (count 20 to 50).",
    "- Camera: keep the layout's target and distance unless the content needs more room. Moves: orbitRight or orbitLeft (intensity 0.3 to 0.45) to show depth, dollyIn (0.3 to 0.5) to build, craneUp (0.2 to 0.3) for a poster reveal. fstop 0.",
    "- Timing: the product enters first (enterAt 0 to 0.3), the title by 0.6 s, the other lines by 40 % of the clip; everything has entered by 60 % so the end holds still and readable for at least 1.5 s.",
    "- Look: use the brand colours for the set (background colours, glow, props, text). Dark studio sets (\"studio\" with a near-black backdrop and a brand-colour glow, floor reflect 0.7 to 0.85) suit phones, electronics, cosmetics and luxury; bright gradient sets (light floor, reflect 0.3 to 0.5, light preset soft) suit food, fashion, homes and family products.",
    "- Follow the template's art direction (written for the 2D engine: translate its spirit, colours, camera and materials to this 3D scene) and the research block where they fit these rules.",
    "- canvas: the ratio from the brief, quality \"540p\", fps 24. duration: the seconds from the brief. A seed of your choice.",
  ].join("\n");
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
    repair(scene, brief, seconds, opts, warnings);
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
    // Smaller letters do not read on a phone at 540p.
    if (t.size < 0.5) {
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
  fitLayout(scene, photo && photo.height ? photo.width / photo.height : 1, warnings);
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

/** Width of one character at size 1, measured in Blender 5.2 on "GALAXY A56 420,000 RWF" (capitals and digits). */
const CHAR_WIDTH: Record<BlenderScene["texts"][number]["font"], number> = { anton: 0.26, poppins: 0.36, inter: 0.47, nunito: 0.47, "space-grotesk": 0.47, playfair: 0.49, "dm-serif": 0.45 };
type TextBox = Pick<BlenderScene["texts"][number], "font" | "size" | "text">;
/** About how wide a line of 3D text is, in scene units. */
export const textWidth = (t: TextBox) => CHAR_WIDTH[t.font] * t.size * t.text.length;
/** How tall its capitals are (size is the font size: capitals are about 0.6 to 0.7 of it). */
export const textHeight = (t: Pick<BlenderScene["texts"][number], "size">) => 0.7 * t.size;

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
    if (gap < 0.15 && overlapsX(a.position[0], textWidth(a), b.position[0], textWidth(b)) && Math.abs(a.position[1] - b.position[1]) < 1) {
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
      return { z0: t.position[2] - textHeight(t) / 2, z1: t.position[2] + textHeight(t) / 2, half: (Math.abs(t.position[0]) + textWidth(t) / 2) * (1 + nearer / cam.distance) + nearer * slide };
    }),
    ...scene.props.filter((pr) => pr.kind === "sphere" || pr.kind === "ring").map((pr) => ({ z0: pr.position[2] - pr.size / 2, z1: pr.position[2] + pr.size / 2, half: Math.abs(pr.position[0]) + pr.size / 2 })),
  ];
  if (!parts.length) return;
  const z0 = Math.min(...parts.map((x) => x.z0));
  const z1 = Math.max(...parts.map((x) => x.z1));
  const half = Math.max(...parts.map((x) => x.half));
  const f = framePerDistance(scene.canvas.ratio);
  const k = 50 / cam.lens;
  const needed = Math.max((z1 - z0 + 0.9) / (f.height * k), (2 * half + 0.6) / (f.width * k));
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

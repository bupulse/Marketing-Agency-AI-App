// The viral recipe (docs/VIRAL_RECIPES.md): instead of one of the fixed templates, every video is designed from the
// techniques of real viral videos (the viral library, docs/research/viral/, indexed by viral-ingest.ts into
// data/viral.json). For one brief it picks 3 to 5 matching videos (the same or a neighbouring sector first, then the
// same platform, East Africa first and Rwanda highest, weighted by how viral they were) and mixes their techniques into
// one original recipe: the opening from one video, the beats from another, the text, the price and phone placement,
// the camera, the loop and the caption from others, each with the id it came from. A seeded random draw keeps two
// videos of one product different, and the business's last recipes are avoided (another opening, layout and beat
// order). Facts still come only from the brief. Pure: the same input and seed always give the same recipe.
import viralJson from "./data/viral.json";
import type { ViralBeat, ViralRole, ViralVideo } from "./viral-ingest";
import { FORMATS, SECTORS, type FormatId, type SectorId } from "./types";
import { safeAreaFor } from "./database";
import type { CameraMove } from "../spec";

export type { ViralVideo, ViralBeat, ViralRole };
export const VIRAL: ViralVideo[] = viralJson as ViralVideo[];
const BY_ID = new Map(VIRAL.map((v) => [v.id, v]));
export const viralById = (id: string, lab: readonly ViralVideo[] = []): ViralVideo | null => BY_ID.get(id) ?? lab.find((v) => v.id === id) ?? null;

/** What a Training Lab reel adds to its score (a curated video's strength is worth up to 25), and what an avoided one loses. */
export const LAB_BONUS = 10;
export const AVOID_PENALTY = 25;

/**
 * A beat that wants filmed footage or an AI clip, and what the clip should show. `source`: a phone clip the client
 * added, an AI clip (Veo, image-to-video from the product photo), or a photo when neither is there.
 */
export type ClipNeed = { beat: number; seconds: 4 | 6 | 8; shot: string; source: "phone" | "ai" | "photo" };
/** The designer's platforms (designer.ts PLATFORMS: "youtube" is Shorts). */
export type RecipePlatform = "tiktok" | "instagram" | "facebook" | "youtube";
/** How the recipe checks that the design opens the way it says (score.ts). */
export type OpeningCheck = "price" | "question" | "number" | "visual" | "text";
export type Band = "top" | "middle" | "bottom";
export type PriceAt = "opening" | "every-scene" | "middle" | "end" | "none";

export type RecipeInput = {
  /** The Brain's sector of the business (select.ts sectorFromText). */
  sector: SectorId;
  product: string;
  platform?: RecipePlatform | null;
  country?: string | null;
  language?: string | null;
  purpose?: "ad" | "post";
  seconds: number;
  hasPrice: boolean;
  hasPhone: boolean;
  /** The brief names a place (an area, a street) or a real offer: openings built on them need them. */
  hasLocation?: boolean;
  hasOffer?: boolean;
  /** The product stands on the floor or the ground (a tower, a sofa, a car): clips never have it held up to the camera. */
  large?: boolean;
  /** What footage there is: photos always; the client's phone clips (0 to 4); AI clips once the Veo step is on. */
  /**
   * What footage there is: photos always; the client's phone clips (0 to 4); AI clips once the Veo step is on.
   * `generated`: the whole video is filmed by a video model (Seedance), so every technique can be remade.
   */
  footage?: { phoneClips?: number; aiClips?: boolean; /** AI clips already made (at most 3 beats then take one); none given: up to 3. */ aiCount?: number; generated?: boolean };
  /** The business's recent recipes (newest first; about 5 are read): the new one avoids their opening, layout and beat order. */
  recent?: ViralRecipe[];
  /**
   * The owner's Training Lab reels as viral rows (ids "lab:<TrainingExample id>", lib/training-lab/viral-rows.ts): they join
   * the pool beside the curated ones, with a small bonus (LAB_BONUS) that stays below a curated video's strength.
   */
  lab?: ViralVideo[];
  /** Ids or opening types the owner's Lab says never to copy: matching videos lose AVOID_PENALTY (none is filtered out). */
  avoid?: string[];
  /** Any text: the same seed gives the same recipe; a new job gets a new seed. */
  seed: string;
};

/** One beat: what to show (in the engine's words, for this product), and what the viral video showed there (`seen`). */
export type RecipeBeat = { from: number; to: number; role: ViralRole; what: string; seen: string; source: string; footage: "photo" | "phone" | "ai" };

/** One original recipe, mixed from several viral videos. Stored in VideoJob.brief.recipe. */
export type ViralRecipe = {
  version: 1;
  seed: string;
  seconds: number;
  platform: RecipePlatform | null;
  purpose: "ad" | "post";
  /** The Brain format closest to it (the research block and the score read it). */
  format: FormatId;
  opening: { hookType: string; idea: string; seen: string; check: OpeningCheck; source: string };
  beats: RecipeBeat[];
  /** The beats' roles in order ("hook-show-show-cta"): two recipes with the same order look alike. */
  order: string;
  cuts: { per10s: [number, number]; scenes: [number, number]; source: string };
  text: { style: string; band: Band; y: [number, number]; source: string };
  price: { at: PriceAt; band: Band; how: string; source: string | null };
  phone: { at: "every-scene" | "end" | "none"; how: string; source: string | null };
  camera: { feel: string; moves: CameraMove[]; shake: number; source: string };
  loop: { on: boolean; source: string | null };
  caption: { lines: [number, number]; hashtags: [number, number]; price: boolean; phone: boolean; place: boolean; dm: boolean; question: boolean; emoji: boolean; source: string };
  sound: { mood: string; voice: string; source: string };
  /** The text band and the price's place ("top/opening"): two recipes with the same layout look alike. */
  layout: string;
  clipNeeds: ClipNeed[];
  /** Which technique came from which viral video. */
  sources: { id: string; uses: string[] }[];
};

// ---- Seeded randomness

/** A 32-bit hash of a text (FNV-1a). */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}
/** A small fast generator (mulberry32): numbers 0 to 1, the same sequence for the same seed. */
export function seededRandom(seed: string): () => number {
  let a = hashSeed(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Matching

/** Sectors whose viral videos borrow well: a hydroponics farm learns from shops and food, a salon from fashion. */
export const NEIGHBOURS: Record<SectorId, SectorId[]> = {
  restaurant: ["events", "agriculture", "shop"],
  "phone-shop": ["shop", "services"],
  salon: ["fashion", "clinic", "shop"],
  fashion: ["salon", "shop"],
  "real-estate": ["services", "events"],
  school: ["services", "clinic"],
  "car-rental": ["services", "events"],
  clinic: ["salon", "services", "school"],
  events: ["restaurant", "fashion"],
  services: ["real-estate", "car-rental", "clinic"],
  agriculture: ["shop", "restaurant", "services"],
  shop: ["phone-shop", "fashion", "salon", "agriculture"],
};
const sectorOf = (v: ViralVideo): SectorId => ((SECTORS as readonly string[]).includes(v.sector) ? (v.sector as SectorId) : "shop");

/** Openings built on the price: never for a brief without one, nor for a page post (no price push). */
const PRICE_HOOKS = new Set(["price-banner", "number-in-hand", "price-on-each", "price-list-card", "price-pill", "price-first", "was-now", "offer-badge-day", "menu-card-loop"]);
/** Openings built on another fact: a place, a real offer, a running series. */
const FACT_HOOKS: Record<string, "location" | "offer" | "never"> = { "location-stack": "location", "was-now": "offer", "offer-badge-day": "offer", "series-episode": "never" };
/** Whether the brief has what a video's opening is built on. */
export function openingFits(v: ViralVideo, input: Pick<RecipeInput, "hasPrice" | "hasLocation" | "hasOffer" | "purpose">): boolean {
  if (PRICE_HOOKS.has(v.hookType) && (!input.hasPrice || input.purpose === "post")) return false;
  const need = FACT_HOOKS[v.hookType];
  return need === "location" ? !!input.hasLocation : need === "offer" ? !!input.hasOffer : need !== "never";
}
const OPENING_CHECK: Record<string, OpeningCheck> = {
  "price-banner": "price", "number-in-hand": "price", "price-on-each": "price", "price-list-card": "price", "price-pill": "price", "price-first": "price", "was-now": "price",
  "direct-question": "question", "pain-question": "question",
  "numbered-list": "number", "step-routine": "number", "series-episode": "number",
  "result-first": "visual", "demo-first": "visual", "appetite-shot": "visual", "macro-rim-light": "visual", "unwrap-reveal": "visual", "happy-customer": "visual", "owner-with-stock": "visual", "door-open-walk": "visual", "cards-in-hand": "visual", curiosity: "visual",
};
/** The opening idea of each hook type, in the engine's words (the viral video's own first seconds go with it as "seen"). */
export const HOOK_IDEAS: Record<string, string> = {
  curiosity: "an unexpected first picture or line that makes people wait to see what it is",
  "result-first": "the finished result first, the how after",
  "demo-first": "the product already working in the first frame",
  "number-in-hand": "the product held to the camera with its price in a big box beside it",
  "poster-first": "a finished poster frame: the product, its name and the key fact all on screen at 0 s",
  "owner-with-stock": "the owner's hands in front of the stock, the product held up",
  "occasion-title": "a title that names the moment or season it is for",
  "bold-local-claim": "one bold, true line about the product and the city",
  "price-banner": "a title banner with what it is, where, and the price, from frame 0",
  "pov-local-find": "'POV:' a local moment of finding this product",
  "direct-question": "a direct question to the viewer in big text",
  "now-available": "a banner saying it is now available here",
  "appetite-shot": "a close, rich shot of the product at its most tempting",
  "pain-question": "the everyday problem, asked as a question",
  "expert-card": "a name card for the expert or the owner",
  "macro-rim-light": "an extreme close-up of the product with a bright rim of light",
  "numbered-list": "a '3 things' promise with the first item at once",
  "happy-customer": "a happy customer with the product",
  "before-after-word": "the word BEFORE on the old way, then AFTER on the product",
  "unwrap-reveal": "hands opening the package and lifting the product out",
  "location-stack": "the place stacked on screen: city, area, landmark",
  "price-on-each": "every item or option shown with its own big price",
  "series-episode": "an episode title (Part 1, Day 3) that promises more",
  "door-open-walk": "the door opens and the camera walks in",
  "comment-reply": "a viewer's question answered on screen",
  "pov-rescue": "'POV:' the product saves an everyday moment",
  "me-when": "'Me when…' a relatable moment",
  "local-greeting": "a greeting in the local language",
  "service-claim": "the service promise in one line",
  "kinetic-phrase": "a short phrase punched in word by word",
  "cards-in-hand": "the options fanned out in a hand",
  "price-list-card": "a clean price list card",
  "price-pill": "a small price pill on the product",
  "offer-badge-day": "an offer badge with the day it ends (only a real offer)",
  "was-now": "the old and the new price (only when the brief gives both)",
  "dont-say-say": "'Don't say X, say Y'",
  "giant-word": "one giant word behind the product",
  "step-routine": "step 1 of a routine on screen",
  "price-first": "the price first, then the product",
  "menu-card-loop": "a menu card that loops",
};
const FORMAT_OF: Record<string, FormatId> = { "price-banner": "offer", "comment-reply": "ugc-testimonial", "price-on-each": "list", "unwrap-reveal": "unboxing", "pov-local-find": "ugc-testimonial", "price-list-card": "list" };
const toFormat = (f: string): FormatId => ((FORMATS as readonly string[]).includes(f) ? (f as FormatId) : (FORMAT_OF[f] ?? "product-reveal"));

/** Whether a video's look can be remade with what the brief has (its opening and beats need its footage). */
export function feasible(v: ViralVideo, footage: RecipeInput["footage"] = {}): boolean {
  if (footage.generated) return true;
  const phone = (footage.phoneClips ?? 0) > 0;
  if (v.needs.includes("person")) return phone;
  if (v.needs.includes("filmed")) return phone || (!!footage.aiClips && v.needs.includes("ai-ok"));
  return true;
}

export type Scored = { v: ViralVideo; score: number; why: string[] };

/**
 * Every viral video scored for a brief: sector (same 40, neighbouring 22), platform 15, Rwanda 18 or East Africa 10,
 * viral strength up to 25, the facts it needs (a price opening without a price: -15), purpose, recently used (-25),
 * plus up to 28 of seeded chance (two videos of one product should not keep drawing the same few). Best first.
 */
export function scoreViral(input: RecipeInput, rng: () => number = seededRandom(input.seed)): Scored[] {
  const recentSources = new Set((input.recent ?? []).slice(0, 5).flatMap((r) => r.sources.map((s) => s.id)));
  const near = NEIGHBOURS[input.sector] ?? [];
  const post = input.purpose === "post";
  const avoid = new Set(input.avoid ?? []);
  const pool = input.lab?.length ? [...VIRAL, ...input.lab] : VIRAL;
  return pool.map((v) => {
    const why: string[] = [];
    let score = 0;
    const s = sectorOf(v);
    const add = (points: number, reason: string) => {
      score += points;
      why.push(reason);
    };
    if (s === input.sector) add(40, "same sector");
    else if (near.includes(s)) add(22, "neighbouring sector");
    if (input.platform && v.platform === input.platform) add(15, "same platform");
    if (v.country === "RW") add(18, "Rwanda");
    else if (v.region === "east-africa") add(10, "East Africa");
    score += 25 * v.strength;
    if (!openingFits(v, input)) score -= 15;
    if (input.hasPrice && !post && v.priceShown) score += 4;
    if (post && !v.isAd && v.kind !== "creator") score += 6;
    if (v.kind === "creator") score -= 4;
    if (recentSources.has(v.id)) add(-25, "used recently");
    if (v.id.startsWith("lab:")) add(LAB_BONUS, "your Training Lab");
    if (avoid.has(v.id) || avoid.has(v.hookType)) add(-AVOID_PENALTY, "the owner said never");
    // A Lab reel's chance comes from its own seed, so the draws for the curated videos stay as they were without a Lab.
    score += 28 * (v.id.startsWith("lab:") ? seededRandom(`${input.seed}:${v.id}`)() : rng());
    return { v, score: Math.round(score * 10) / 10, why };
  }).sort((a, z) => z.score - a.score || a.v.id.localeCompare(z.v.id));
}

/** 3 to 5 videos from different accounts (at most two with one opening type), at least one whose look the footage can make. */
export function pickViral(input: RecipeInput, rng: () => number = seededRandom(input.seed)): Scored[] {
  const ranked = scoreViral(input, rng);
  const count = 3 + Math.floor(rng() * 3);
  const picked: Scored[] = [];
  for (const s of ranked) {
    if (picked.length >= count) break;
    if (picked.some((p) => p.v.group === s.v.group)) continue;
    if (picked.filter((p) => p.v.hookType === s.v.hookType).length >= 2) continue;
    picked.push(s);
  }
  // The opening and the beats need footage the brief has: two such videos, so they can come from different ones.
  for (let tries = 0; tries < 2 && picked.filter((p) => feasible(p.v, input.footage)).length < 2; tries++) {
    const extra = ranked.find((s) => feasible(s.v, input.footage) && !picked.includes(s) && !picked.some((p) => p.v.group === s.v.group));
    if (!extra) break;
    const drop = [...picked].reverse().find((p) => !feasible(p.v, input.footage));
    if (drop && picked.length >= count) picked.splice(picked.indexOf(drop), 1, extra);
    else picked.push(extra);
  }
  return picked.slice(0, 5);
}

// ---- Mixing

const round5 = (n: number) => Math.round(n * 2) / 2;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const short = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The first band a text style names ("top", "lower third", "centre"), or null. */
export function bandOf(text: string): Band | null {
  const t = text.toLowerCase();
  const hits: [Band, number][] = (
    [
      ["top", /\btop\b|\bupper\b|\bheader\b/],
      ["bottom", /\bbottom\b|\blower\b|\bfooter\b|\bstrip\b/],
      ["middle", /\bmiddle\b|\bcent(re|er)\b|\bcentred\b|\bcentered\b/],
    ] as [Band, RegExp][]
  ).flatMap(([b, re]) => {
    const i = t.search(re);
    return i >= 0 ? [[b, i] as [Band, number]] : [];
  });
  return hits.sort((a, z) => a[1] - z[1])[0]?.[0] ?? null;
}

/** Where a band sits on the platform's screen: inside its safe area (Shorts keeps the price and contact in the middle). */
export function bandY(band: Band, platform: RecipePlatform | null): [number, number] {
  const a = safeAreaFor(platform ?? "any");
  const y: [number, number] = band === "top" ? [a.top + 0.02, a.top + 0.2] : band === "bottom" ? [a.bottom - 0.18, a.bottom - 0.02] : [0.36, 0.6];
  return [Math.round(y[0] * 100) / 100, Math.round(y[1] * 100) / 100];
}

const PRICE_WORD = /\{price\}|\bprice|\bprices\b|\d+\s?k\b/i;
const EVERY = /whole clip|whole video|every (frame|scene|shot|cut)|stays|throughout|permanent|fixed|all \d+ ?s|never changes|the entire|on screen the whole/i;
function priceAt(v: ViralVideo): PriceAt {
  const opening = /\{price\}/.test(v.hook) || PRICE_WORD.test(v.first3s);
  const beats = v.beats.filter((b) => PRICE_WORD.test(b.what)).length;
  const stays = EVERY.test(v.textStyle) && /price|\{price\}/i.test(v.textStyle);
  if ((opening && (stays || beats >= Math.max(2, v.beats.length - 1))) || stays) return "every-scene";
  if (opening) return "opening";
  if (beats && PRICE_WORD.test(v.beats[v.beats.length - 1]?.what ?? "") && beats === 1) return "end";
  return "middle";
}
const clauseWith = (text: string, re: RegExp) => text.split(/[;.]/).find((c) => re.test(c)) ?? "";

const CAMERAS: [RegExp, CameraMove[], number][] = [
  [/orbit|turn|rotat|spin|360/i, ["orbitLeft", "orbitRight", "dollyIn"], 0],
  [/gimbal|glide|tracking|steady/i, ["dollyIn", "panLeft", "craneUp"], 0.08],
  [/handheld|hand-held|selfie|walk|phone in hand/i, ["handheld", "dollyIn", "panRight"], 0.25],
  [/zoom|push/i, ["crashZoom", "dollyIn", "pushPull"], 0.05],
  [/static|locked|tripod|stand|fixed/i, ["dollyIn", "static", "tiltDown"], 0],
  [/none|poster|graphic|animation|render|slides?|motion/i, ["dollyIn", "pushPull", "panLeft"], 0],
];
const MOODS: [RegExp, string][] = [
  [/afro|amapiano|bongo|gengetone|kinyarwanda song|rwandan song/i, "afro"],
  [/energetic|fast|hype|drill|trap/i, "energetic"],
  [/calm|soft|piano|chill|lo-?fi|ambient/i, "calm"],
  [/acoustic|guitar/i, "acoustic"],
  [/cinematic|epic|inspir|orchestral/i, "inspiring"],
  [/warm|gospel|r&b|rnb|soul/i, "warm"],
  [/upbeat|dance|trending|beat|pop|happy/i, "upbeat"],
];
const HASHTAGS: Record<string, [number, number]> = { tiktok: [4, 6], instagram: [3, 6], facebook: [0, 3], youtube: [1, 3], any: [4, 6] };

/** What each kind of beat is for, in the recipe's words. */
const BEAT_JOBS: Record<ViralRole, string> = { hook: "stop the scroll", show: "show the product", proof: "prove it (only true facts)", offer: "the offer (only what the brief gives)", cta: "how to order" };

/** A clip of 4, 6 or 8 seconds (Veo's lengths) for a beat. */
const clipSeconds = (len: number): 4 | 6 | 8 => (len <= 4.5 ? 4 : len <= 6.5 ? 6 : 8);
/**
 * What a clip for this beat should show, in the engine's words (never the other video's product). `large`: a product
 * that stands on the floor or the ground (a hydroponic tower, a sofa, a car) is never "held up to the camera".
 */
export function shotFor(what: string, role: ViralRole, product: string, camera: string, index = 0, large = false): string {
  const w = what.toLowerCase();
  const cam = /handheld|selfie|walk/i.test(camera) ? ", handheld" : /static|locked|tripod/i.test(camera) ? ", steady camera" : "";
  if (/unbox|unwrap|opens? the (box|bag|package)|package/.test(w)) return `Hands open the package and lift out the ${product}${cam}.`;
  if (/pour|serv|plate|bite|eat|cook|sizzl|steam/.test(w)) return `The ${product} served close up, steam or movement in the frame${cam}.`;
  if (/walk|door|enter|tour|room|shop floor|aisle|counter|outside|street/.test(w)) return `A slow walk through the shop or farm to the ${product}${cam}.`;
  if (/appl|spray|wash|use[sd]?\b|demo|install|plant|water|grow|fill|test/.test(w)) return `The ${product} in use, close on the hands${cam}.`;
  if (/hold|hand|turn|rotat|show|lift|up to the camera/.test(w)) return large ? `Hands rest on the ${product} where it stands, the camera moving slowly around it${cam}.` : `A hand holds the ${product} up to the camera and turns it slowly${cam}.`;
  if (role === "hook") return `A close, moving first look at the ${product}${cam}.`;
  const plain = [`A slow push in on the ${product} in a real setting${cam}.`, `A close detail of the ${product}: its texture, its parts, its label${cam}.`, `The ${product} from a low angle, the light moving across it${cam}.`, `The ${product} beside a hand or a person, so its size reads${cam}.`];
  return plain[index % plain.length];
}

/** Another video's prices and numbers out of a description ("150,000 Rwf", "RWF 20K"): only its technique is an example. */
export const withoutFigures = (text: string): string =>
  text.replace(/(?:(?:rwf|frw|kes|ksh|ugx|tzs|usd|\$)\s*)?\d{1,3}(?:[,.]\d{3})+(?:\s*(?:rwf|frw|kes|ksh|ugx|tzs|\/-))?|(?:rwf|frw|kes|ksh|ugx|tzs|usd|\$)\s*\d+(?:[.,]\d+)?\s*[km]?\b|\b\d+(?:[.,]\d+)?\s*(?:k|m|rwf|frw|kes|ksh|ugx|tzs)\b/gi, "[price]");

/** Shapes the beats source's structure to `seconds`, with the opening and the ending the recipe wants. */
function shapeBeats(src: ViralVideo, opening: ViralVideo, seconds: number, post: boolean, ctaWhat: string): Omit<RecipeBeat, "footage" | "seen">[] {
  const beats = src.beats.length ? src.beats : [{ from: 0, to: 3, role: "hook" as ViralRole, beat: "hook", what: src.first3s }, { from: 3, to: 10, role: "show" as ViralRole, beat: "show", what: src.lesson }];
  const max = clamp(Math.round(seconds / 3), 3, 6);
  let middle = beats.slice(1).filter((b, i, all) => !(i === all.length - 1 && b.role === "cta"));
  if (!middle.length) middle = [{ ...beats[0], role: "show", what: opening.beats[1]?.what ?? src.lesson }];
  // Too many middle beats for the length: neighbours are joined (their lengths and descriptions).
  while (middle.length > max - 2) {
    let best = 0;
    for (let i = 1; i < middle.length - 1; i++) if (middle[i].to - middle[i].from + (middle[i + 1].to - middle[i + 1].from) < middle[best].to - middle[best].from + (middle[best + 1].to - middle[best + 1].from)) best = i;
    const [a, b] = [middle[best], middle[best + 1]];
    middle.splice(best, 2, { ...a, to: b.to, role: a.role === "show" ? b.role : a.role, what: `${a.what}; then ${b.what}` });
  }
  const last = beats[beats.length - 1];
  // The ending is always this business's own: the source's end card is only what it looked like.
  const end = { role: "cta" as ViralRole, what: post ? "the shop sign or the logo, a warm last look (no hard sell)" : ctaWhat, seen: last.role === "cta" && last !== beats[0] ? last.what : "" };
  const hookLen = clamp(Math.min(3, seconds * 0.22), 1.5, 3);
  const ctaLen = clamp(seconds * 0.18, 2, 4);
  const ref = middle.reduce((s, b) => s + Math.max(0.5, b.to - b.from), 0);
  const room = Math.max(1.5 * middle.length, seconds - hookLen - ctaLen);
  const out: Omit<RecipeBeat, "footage" | "seen">[] = [{ from: 0, to: round5(hookLen), role: "hook", what: opening.first3s || HOOK_IDEAS[opening.hookType] || opening.lesson, source: opening.id }];
  let t = hookLen;
  for (const b of middle) {
    t += (Math.max(0.5, b.to - b.from) / ref) * room;
    const from = out[out.length - 1].to;
    out.push({ from, to: Math.max(from + 1.5, round5(Math.min(seconds - 1.5, t))), role: b.role === "hook" ? "show" : b.role, what: b.what, source: src.id });
  }
  const from = out[out.length - 1].to;
  out.push({ from, to: Math.max(from + 1.5, seconds), role: "cta", what: end.seen || end.what, source: end.seen ? src.id : opening.id });
  return out.map((b) => ({ ...b, what: short(b.what, 200) }));
}

/**
 * The recipe for one brief: 3 to 5 viral videos mixed into one original plan. Each technique comes from a video that
 * fits it (the opening and the beats from videos the footage can remake, the price placement from one that showed a
 * price...), unused videos first, so every pick lends something; the opening and the beats never come from the same
 * video when there is a choice, and the recent recipes' openings, layouts and beat orders are avoided. Pure.
 */
export function viralRecipe(input: RecipeInput): ViralRecipe {
  const rng = seededRandom(input.seed);
  const picks = pickViral(input, rng);
  const seconds = clamp(Math.round(input.seconds || 15), 6, 30);
  const platform = input.platform ?? null;
  const post = input.purpose === "post";
  const recent = (input.recent ?? []).slice(0, 5);
  const uses = new Map<string, string[]>();
  const lend = (v: ViralVideo | null | undefined, what: string) => {
    if (!v) return null;
    uses.set(v.id, [...(uses.get(v.id) ?? []), what]);
    return v.id;
  };
  // Each pick's luck for this seed: among equally fitting picks, the slot goes to score plus luck, not score alone.
  const luck = new Map(picks.map((p) => [p.v.id, 20 * rng()]));
  /** The best pick for a slot: one that fits, then one not used yet, then a fresh choice over the recent recipes, then score and luck. */
  const choose = (fits: (v: ViralVideo) => boolean, fresh: (v: ViralVideo) => boolean = () => true, avoid: ViralVideo[] = []): ViralVideo | null => {
    const ok = picks.filter((p) => fits(p.v));
    if (!ok.length) return null;
    const rank = (p: Scored) => (avoid.includes(p.v) ? 4 : 0) + (uses.has(p.v.id) ? 2 : 0) + (fresh(p.v) ? 0 : 1);
    const worth = (p: Scored) => p.score + (luck.get(p.v.id) ?? 0);
    return [...ok].sort((a, z) => rank(a) - rank(z) || worth(z) - worth(a))[0].v;
  };
  const can = (v: ViralVideo) => feasible(v, input.footage);
  const priceOk = (v: ViralVideo) => openingFits(v, input);

  // The opening: a video the footage can remake, with an opening type the recent recipes did not use.
  const recentOpenings = new Set(recent.map((r) => r.opening.hookType));
  const openV = choose((v) => can(v) && priceOk(v), (v) => !recentOpenings.has(v.hookType)) ?? choose(can) ?? picks[0].v;
  lend(openV, "opening");
  const openingCheck0 = OPENING_CHECK[openV.hookType] ?? "text";
  const opening = { hookType: openV.hookType, idea: HOOK_IDEAS[openV.hookType] ?? short(openV.lesson), seen: short(openV.first3s, 220), check: openingCheck0 === "price" && (!input.hasPrice || post) ? ("text" as OpeningCheck) : openingCheck0, source: openV.id };

  // The phone and the call to action (ads): a video that kept its number on screen.
  const phoneV = !post && input.hasPhone ? choose((v) => v.phoneShown) : null;
  const ctaWhat = input.hasPhone ? "the business name, the price if the brief gives one, and 'WhatsApp' or 'Call' with the number" : "the business name and how to order";

  // The beats: another video the footage can remake, with an order the recent recipes did not use.
  const recentOrders = new Set(recent.map((r) => r.order));
  const orderOf = (v: ViralVideo) => shapeBeats(v, openV, seconds, post, ctaWhat).map((b) => b.role).join("-");
  const beatsV = choose(can, (v) => !recentOrders.has(orderOf(v)), [openV]) ?? openV;
  lend(beatsV, "beats");
  const shaped = shapeBeats(beatsV, openV, seconds, post, ctaWhat);
  const order = shaped.map((b) => b.role).join("-");

  // The pace: the median cut rate of the picks.
  const rates = picks.map((p) => p.v.cutsPer10s).filter((n): n is number => typeof n === "number" && n > 0).sort((a, b) => a - b);
  const median = rates.length ? rates[Math.floor(rates.length / 2)] : 3;
  const per10 = clamp(median, 1.5, 7);
  const cutsV = choose((v) => v.cutsPer10s !== null && Math.abs((v.cutsPer10s ?? 0) - median) < 0.01) ?? beatsV;
  lend(cutsV, "pace");
  const lo = Math.max(1, Math.round((per10 - 1) * 2) / 2);
  const hi = Math.round((per10 + 1) * 2) / 2;
  const scenes: [number, number] = [clamp(Math.floor((lo * seconds) / 10), Math.max(2, shaped.length - 1), 8), clamp(Math.ceil((hi * seconds) / 10), shaped.length, 8)];

  // The text and the price: a layout the recent recipes did not use.
  const recentLayouts = new Set(recent.map((r) => r.layout));
  // A style that is only a watermark or "no captions" says nothing about where text goes.
  const styled = (v: ViralVideo) => !!v.textStyle && !/^(none|no)\b|no (captions|text|on-screen)|watermark|handle only|burned-in (account )?handle/i.test(v.textStyle) && !!bandOf(v.textStyle);
  const priceV = input.hasPrice && !post ? choose((v) => v.priceShown) : null;
  const priceAtOf = (v: ViralVideo | null): PriceAt => (!input.hasPrice || post ? "none" : v ? priceAt(v) : "opening");
  const at = priceAtOf(priceV);
  const textV = choose(styled, (v) => !recentLayouts.has(`${bandOf(v.textStyle) ?? "top"}/${at}`), [openV]) ?? openV;
  lend(textV, "text");
  if (priceV) lend(priceV, "price");
  const textBand = bandOf(textV.textStyle) ?? "top";
  const youtube = platform === "youtube";
  const priceBand: Band = youtube ? "middle" : (priceV ? (bandOf(clauseWith(priceV.textStyle, /price|\{price\}/i)) ?? bandOf(priceV.first3s)) : null) ?? (textBand === "top" ? "top" : "middle");
  const priceClause = priceV ? clauseWith(priceV.textStyle, /price|\{price\}/i) : "";
  const priceHow =
    at === "none"
      ? post ? "No price on screen: a page post keeps it for the caption." : "No price in the brief: show none."
      : `${at === "every-scene" ? "On screen from 0 s to the end" : at === "opening" ? "In the opening, from 0 s, then again on the end card" : at === "end" ? "Saved for the last scene, big" : "Brought in mid-video when the product is shown, and again at the end"}, in the ${priceBand} band${priceClause ? ` (seen: ${short(priceClause.trim(), 110)})` : ", in a bold box"}.`;
  if (phoneV) lend(phoneV, "phone");
  const phoneAt: "every-scene" | "end" | "none" = post || !input.hasPhone ? "none" : phoneV && EVERY.test(`${phoneV.textStyle} ${phoneV.first3s}`) ? "every-scene" : platform === "facebook" ? "every-scene" : "end";
  const phoneHow = phoneAt === "none" ? (post ? "The number only on the end card or in the caption (a page post)." : "No number in the brief: the end card says how to order.") : phoneAt === "every-scene" ? "A clear number strip ('WhatsApp …') from 0 s to the end, in the same place in every scene." : "A small quiet number line in every scene, then the number big with 'WhatsApp' or 'Call' on the end card.";

  // The camera, the loop, the caption and the sound.
  const camV = choose((v) => !!v.camera, () => true, [openV, beatsV]) ?? beatsV;
  lend(camV, "camera");
  const cam = CAMERAS.find(([re]) => re.test(camV.camera)) ?? [null, ["dollyIn", "panRight", "orbitLeft"] as CameraMove[], 0];
  const loopV = platform === "facebook" ? null : choose((v) => v.loop);
  if (loopV) lend(loopV, "loop");
  const capV = choose((v) => !platform || v.platform === platform, () => true, [openV]) ?? choose(() => true) ?? openV;
  lend(capV, "caption");
  const sndV = choose((v) => MOODS.some(([re]) => re.test(v.music)) || /none|music only|talk|speak|voice/i.test(v.voice)) ?? capV;
  lend(sndV, "sound");
  const mood = MOODS.find(([re]) => re.test(sndV.music))?.[1] ?? "upbeat";
  const voice = /\bnone\b|music only|no voice|no voice-over/i.test(sndV.voice) ? "music carries it: the words on screen tell the story (a short voice-over may follow them)" : /owner|presenter|talk|speak|creator|doctor|host|staff/i.test(sndV.voice) ? "a friendly first-person voice-over, like the owner talking to a customer" : "a short, friendly voice-over";

  // Footage per beat: the client's phone clips where the source was filmed, AI clips (at most 3) where a product shot
  // can be made from the photo, photos everywhere else.
  let phoneLeft = Math.max(0, Math.min(4, input.footage?.phoneClips ?? 0));
  let aiLeft = input.footage?.aiClips ? Math.min(3, input.footage.aiCount ?? 3) : 0;
  const filmed = (id: string) => !(viralById(id, input.lab)?.needs.includes("photos") ?? true);
  const product = input.product || "product";
  const ctaEnd = post ? "the shop sign or the logo, a warm last look (no hard sell)" : ctaWhat;
  const beats: RecipeBeat[] = shaped.map((b, i) => {
    const wantsFilm = filmed(b.source) && b.role !== "cta";
    let footage: RecipeBeat["footage"] = "photo";
    if (wantsFilm && phoneLeft > 0) footage = "phone";
    else if (wantsFilm && aiLeft > 0 && (viralById(b.source, input.lab)?.needs.includes("ai-ok") ?? false)) footage = "ai";
    else if (i > 0 && b.role === "show" && aiLeft > 0 && !phoneLeft) footage = "ai";
    if (footage === "phone") phoneLeft--;
    if (footage === "ai") aiLeft--;
    // What to show, for this product; the viral video's own beat stays as the example.
    const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1).replace(/\.$/, "");
    const what = i === 0 ? opening.idea : b.role === "cta" ? `${BEAT_JOBS.cta}: ${ctaEnd}` : `${BEAT_JOBS[b.role]}: ${lower(shotFor(b.what, b.role, product, camV.camera, i, !!input.large))}`;
    return { ...b, what, seen: withoutFigures(i === 0 ? opening.seen : short(b.what, 160)), footage };
  });
  // Phone clips the client added are used even when the sources were made from photos: the show beats take them.
  for (const b of beats) {
    if (phoneLeft <= 0 || b.footage !== "photo" || b.role === "cta") continue;
    b.footage = "phone";
    phoneLeft--;
  }
  // Each clip shows something different: a shot already given to another beat makes way for the next plain one.
  const shots = new Set<string>();
  const shotOf = (b: RecipeBeat, i: number) => {
    let shot = shotFor(b.seen, b.role, product, camV.camera, i, !!input.large);
    for (let k = 0; shots.has(shot) && k < 4; k++) shot = shotFor("", "show", product, camV.camera, i + k, !!input.large);
    shots.add(shot);
    return shot;
  };
  const clipNeeds: ClipNeed[] = beats.flatMap((b, i) => {
    if (b.footage === "photo") return [];
    const shot = shotOf(b, i);
    return [{ beat: i + 1, seconds: clipSeconds(b.to - b.from), shot: b.footage === "phone" ? `Your phone clip: ${shot.replace(/\.$/, "")} (the shop, the hands with the product, or the owner talking).` : shot, source: b.footage }];
  });

  const sources = picks.filter((p) => uses.has(p.v.id)).map((p) => ({ id: p.v.id, uses: uses.get(p.v.id)! }));
  // A pick that lent nothing yet lends its lesson to the text (every pick is in the mix).
  for (const p of picks) if (!uses.has(p.v.id)) sources.push({ id: p.v.id, uses: ["lesson"] });

  return {
    version: 1,
    seed: input.seed,
    seconds,
    platform,
    purpose: post ? "post" : "ad",
    format: toFormat(beatsV.format),
    opening,
    beats,
    order,
    cuts: { per10s: [lo, hi], scenes, source: cutsV.id },
    text: { style: short(textV.textStyle, 160), band: textBand, y: bandY(textBand, platform), source: textV.id },
    price: { at, band: priceBand, how: priceHow, source: priceV?.id ?? null },
    phone: { at: phoneAt, how: phoneHow, source: phoneV?.id ?? null },
    camera: { feel: short(camV.camera, 120), moves: cam[1], shake: cam[2], source: camV.id },
    loop: { on: !!loopV, source: loopV?.id ?? null },
    caption: {
      lines: [clamp(capV.caption.lines - 1, 2, 4), clamp(capV.caption.lines + 1, 3, 5)],
      hashtags: HASHTAGS[platform ?? "any"],
      price: input.hasPrice && !post,
      phone: input.hasPhone && !post,
      place: capV.caption.place,
      dm: capV.caption.dm,
      question: capV.caption.question,
      emoji: capV.caption.emoji,
      source: capV.id,
    },
    sound: { mood, voice, source: sndV.id },
    layout: `${textBand}/${at}`,
    clipNeeds,
    sources,
  };
}

// ---- The recipe for Claude and for the client

const SECTOR_NOUN: Record<string, string> = { restaurant: "restaurant", "phone-shop": "phone-shop", salon: "salon", fashion: "fashion", "real-estate": "property", school: "school", "car-rental": "car-hire", clinic: "clinic", events: "events", services: "services", agriculture: "farm", shop: "shop" };
const COUNTRY: Record<string, string> = { RW: "Rwandan", KE: "Kenyan", UG: "Ugandan", TZ: "Tanzanian", BI: "Burundian", CD: "Congolese" };
/** "a Kigali fashion TikTok", "a Kenyan restaurant Facebook ad", "a global phone-shop Short": never the account. */
export function describeViral(v: ViralVideo): string {
  const place = v.city && v.region === "east-africa" ? v.city : v.country && COUNTRY[v.country] ? COUNTRY[v.country] : "global";
  const what = v.platform === "tiktok" ? "TikTok" : v.platform === "instagram" ? "reel" : v.platform === "youtube" ? "Short" : v.isAd ? "Facebook ad" : "Facebook video";
  const art = /^[aeiou]/i.test(place) ? "an" : "a";
  return `${art} ${place} ${SECTOR_NOUN[v.sector] ?? v.sector} ${what}`;
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);
const ref = (id: string | null) => {
  const v = id ? viralById(id) : null;
  return v ? `${v.id}, ${describeViral(v)} (${v.reach})` : "BuPulse's research";
};

/**
 * The recipe as the designer's brief block (it takes the place of the template line). Facts still come only from
 * the brief: the viral videos' words, prices and numbers are examples of where things go, never content.
 */
export function recipeText(r: ViralRecipe, opts: { clips?: number } = {}): string {
  const lines = [
    `Viral recipe: an original mix of techniques from ${r.sources.length} viral videos BuPulse studied (ids in brackets). It sets the opening, the beats, the pace, where the text, price and number go, the camera and the loop. Use the techniques, never the other videos' words, products, prices or numbers: every fact comes from the brief.`,
    `- Opening (0 to ${fmt(r.beats[0].to)} s, from ${ref(r.opening.source)}): ${r.opening.idea}. Seen there: ${withoutFigures(r.opening.seen)}`,
    `- Beats (${r.seconds} s, from ${r.beats[1]?.source ?? r.opening.source}):`,
    ...r.beats.map((b, i) => `  ${i + 1}. ${fmt(b.from)}-${fmt(b.to)} s ${b.role}: ${b.what}${i > 0 && b.seen ? ` (there: ${b.seen})` : ""}${b.footage !== "photo" && opts.clips ? ` [${b.footage === "phone" ? "a phone clip" : "an AI clip"}]` : ""}`),
    `- Pace: ${fmt(r.cuts.per10s[0])} to ${fmt(r.cuts.per10s[1])} changes per 10 s: ${r.cuts.scenes[0]} to ${r.cuts.scenes[1]} scenes (from ${r.cuts.source}).`,
    `- Text: ${r.text.style.replace(/[\s.;,]*$/, ".")} Keep it in the ${r.text.band} band (y ${r.text.y[0]} to ${r.text.y[1]}), inside the platform's safe area (from ${r.text.source}).`,
    `- Price: ${r.price.how}${r.price.source ? ` (from ${r.price.source})` : ""}`,
    `- Number: ${r.phone.how}${r.phone.source ? ` (from ${r.phone.source})` : ""}`,
    `- Camera: feels like "${r.camera.feel}": use ${r.camera.moves.join(", ")}${r.camera.shake ? `, handheld shake about ${r.camera.shake}` : ""} (from ${r.camera.source}).`,
    r.loop.on ? `- Loop: the last frame flows back into the first (same picture or the same words), so the replay feels seamless (from ${r.loop.source}).` : "",
    `- Caption: ${r.caption.lines[0]} to ${r.caption.lines[1]} short lines${r.caption.price ? ", the product and its price first" : ", the product first"}${r.caption.place ? ", a 📍 line with the area if the brief gives one" : ""}${r.caption.phone ? ", how to order with the number" : ""}${r.caption.dm ? " (or 'DM to order')" : ""}${r.caption.question ? ", a question that invites comments" : ""}; ${r.caption.hashtags[0]} to ${r.caption.hashtags[1]} hashtags (from ${r.caption.source}).`,
    `- Sound: music mood ${r.sound.mood}; ${r.sound.voice} (from ${r.sound.source}).`,
    "Where the recipe and the research block disagree, the recipe wins on look and order; an opening line the owner chose, and the research block's don'ts, win over the recipe.",
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * The recipe for a Seedance prompt (seedance-prompt.ts): the opening, the shots scaled to the clip's length and the
 * camera, with no words in the frames (BuPulse adds the price and the number on top afterwards).
 */
export function seedanceRecipeText(r: ViralRecipe, seconds: number): string {
  const k = seconds / r.seconds;
  const t = (n: number) => fmt(Math.round(n * k * 2) / 2);
  return [
    `Viral recipe: an original mix of techniques from ${r.sources.length} viral videos BuPulse studied (ids in brackets). Follow its opening, its shots and its camera; never the other videos' products, people, words or prices.`,
    `- Opening (0 to ${t(r.beats[0].to)} s, from ${ref(r.opening.source)}): ${r.opening.idea}. Seen there: ${withoutFigures(r.opening.seen)}`,
    `- Shots (from ${r.beats[1]?.source ?? r.opening.source}): ${r.beats.map((b, i) => `${t(b.from)}-${i === r.beats.length - 1 ? fmt(seconds) : t(b.to)} s ${b.role}: ${b.what}`).join("; ")}.`,
    `- Camera: feels like "${r.camera.feel}" (from ${r.camera.source}).`,
    r.loop.on ? `- Loop: the last shot flows back into the first (from ${r.loop.source}).` : "",
    `- Sound: music mood ${r.sound.mood}.`,
    "- No words, prices, numbers or logos in the frames: BuPulse adds the price and the number on top afterwards. End on a clean shot of the product with space above it.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** "Why this video" for the client, in plain English: what each technique was borrowed from (no names, no frames). */
export function recipeWhy(r: ViralRecipe): string[] {
  const d = (id: string | null) => {
    const v = id ? viralById(id) : null;
    return v ? `${describeViral(v)} with ${v.reach}` : null;
  };
  const opening = d(r.opening.source);
  const beats = r.beats[1] ? d(r.beats[1].source) : null;
  const price = r.price.source ? d(r.price.source) : null;
  const camera = d(r.camera.source);
  const out = [
    opening ? `Opens like ${opening}: ${r.opening.idea}.` : "",
    beats && r.beats[1]?.source !== r.opening.source ? `Its story follows ${beats}: ${r.beats.slice(1).map((b) => b.role === "cta" ? "how to order" : b.role === "proof" ? "the proof" : b.role === "offer" ? "the offer" : "the product").filter((x, i, all) => all.indexOf(x) === i).join(", then ")}.` : "",
    price && r.price.at !== "none" ? `The price is placed the way ${price} did it: ${r.price.how.split(" (seen")[0].replace(/\.$/, "").toLowerCase()}.` : "",
    camera && r.camera.source !== r.opening.source ? `The camera moves like ${camera}.` : "",
    r.loop.on ? "The end flows back into the start, so it replays smoothly (loops get watched twice)." : "",
    `Pace: about ${fmt((r.cuts.per10s[0] + r.cuts.per10s[1]) / 2)} changes every 10 seconds, the speed of the videos it learned from.`,
  ];
  return out.filter(Boolean);
}

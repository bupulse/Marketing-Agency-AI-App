// Scores a finished design against the brain's rules that a program can check (docs/research/BRAIN.md, "Scoring a
// design"): a Claude MotionSpec (scoreDesign) or a Seedance prompt (scoreSeedancePrompt). Each check is worth some
// points; checks that do not apply to the brief (a price check with no price) are left out, and the score is the
// share of the remaining points that passed, 0 to 100. Pure and deterministic, for the studio and the template sweep.
import { detectCamera, lintSeedancePrompt, promptTimecodes } from "../seedance-brain";
import type { Layer, MotionSpec, Scene, TextLayer } from "../spec";
import { voiceLanguage } from "../voice-language";
import { BRAIN, SAFE_AREAS, formatById } from "./index";
import { hasKinyarwanda } from "./language";
import { brainFor, formatFromTemplate } from "./select";
import type { FormatId, Platform } from "./types";

export { SAFE_AREAS, hasKinyarwanda };

/** One check: the brain rule it enforces (null for an engine limit), why it passed or failed, and the scene (0-based). */
export type ScoreItem = { id: string; rule: string | null; points: number; reason: string; scene: number | null };
export type DesignScore = { score: number; passed: ScoreItem[]; failed: ScoreItem[] };

/** The facts a design is checked against. A DesignBrief fits this shape. */
export type ScoreBrief = {
  business: { name: string; phone?: string | null; website?: string | null; description?: string | null; language?: string | null; country?: string | null };
  product: { name: string; price?: string | null; summary?: string | null; description?: string | null; usps?: string[]; features?: string[] };
  styleId?: string | null;
  seconds?: number;
  /** The brain's or designer.ts's platform key (youtube = Shorts). */
  platform?: string | null;
  note?: string | null;
  fixedLens?: boolean;
};
export type ScoreOptions = { platform?: string | null; format?: FormatId | null; voice?: boolean };

/** Wide and square shapes only keep a small margin. */
const WIDE_AREA = { top: 0.05, bottom: 0.95, left: 0.04, right: 0.96 };
const TOLERANCE = 0.01;

const PLATFORM_KEYS: Record<string, Platform> = { tiktok: "tiktok", instagram: "instagram", facebook: "facebook", youtube: "shorts", shorts: "shorts" };
const platformOf = (v: string | null | undefined): Platform | "any" => (v && PLATFORM_KEYS[v]) || "any";

// ---- How a template treats text and contact

/**
 * Templates are not all direct-response ads (docs/research/brain-audit.md): luxury and cinematic ones are meant to have
 * few words and the number only at the end, list and poster ones stack several lines on purpose. The checks below use
 * these thresholds instead of one rule for all.
 */
export type TemplateStyle = "direct" | "list" | "showcase" | "brand" | "luxury";
const STYLE_BY_TEMPLATE: Record<string, TemplateStyle> = {
  "kigali-price-first": "direct", "offer-flash": "direct", "price-drop": "direct", "tiktok-gadget": "direct", "tiktok-secret": "direct",
  "tiktok-3-reasons": "list", "glass-cards": "list", "typography-poster": "list", "event-poster": "list", "product-hero": "list", "marketplace-listing": "list", "colour-options": "list",
  "brand-story": "brand", "tv-spot": "brand", "kigali-market": "brand",
  "dark-minimal": "luxury", "chrome-luxe": "luxury", "golden-hour": "luxury", "story-cinematic": "luxury",
};
/** The template's style; templates not listed (product shots, motion, 3D, UGC) are "showcase". */
export const templateStyle = (id: string | null | undefined): TemplateStyle => STYLE_BY_TEMPLATE[id ?? ""] ?? "showcase";
/**
 * Per style: whether the number must be in every scene (always, only for Facebook, or never: the last scene is enough),
 * how many text lines a scene may hold besides the price and the number, and whether the price must come early.
 */
export const STYLE_LIMITS: Record<TemplateStyle, { phoneEveryScene: "always" | "facebook" | "never"; maxLines: number; priceEarly: boolean }> = {
  // Owner decision (17 October 2026): every template keeps the number on screen in every scene; luxury, cinematic and
  // minimal ones as a small quiet line (size about 0.03) with the full contact at the end. Any size counts.
  direct: { phoneEveryScene: "always", maxLines: 3, priceEarly: true },
  list: { phoneEveryScene: "always", maxLines: 5, priceEarly: true },
  showcase: { phoneEveryScene: "always", maxLines: 3, priceEarly: true },
  brand: { phoneEveryScene: "always", maxLines: 3, priceEarly: false },
  luxury: { phoneEveryScene: "always", maxLines: 2, priceEarly: false },
};

// ---- Reading text

const digits = (s: string) => s.replace(/\D/g, "");
/** A phone number's last 9 digits: 0788 300 400 and +250 788 300 400 match. */
const phoneKey = (phone: string) => digits(phone).slice(-9);
const hasPhone = (text: string, phone: string) => {
  const key = phoneKey(phone);
  return key.length >= 6 && digits(text).includes(key);
};

/**
 * Phone numbers (9+ digits in groups split by spaces or dashes, or one run of 9 to 13 digits) taken out before amounts
 * are read. A group never runs into a price ("0788 300 400 420,000 RWF") or across a line break.
 */
const PHONE_RUN = /\(?\+?\d{1,4}\)?(?:[ \t-]+\d{2,6}(?![\d,.]))+|\b\d{9,13}\b/g;
const withoutPhones = (text: string) => text.replace(PHONE_RUN, (m) => (digits(m).length >= 9 ? " " : m));

/**
 * Money-like amounts in a text (420,000 / 420.000 / 420K / 1.2M / 15%), as numbers, read the way factcheck.ts reads
 * them: phone numbers are taken out first, a space or a bullet never joins two numbers, and digits glued to letters
 * (A56, 5G, 256GB) are model names, not amounts; a K, an M or a currency (48,000RWF, 18k) still counts.
 */
export function amounts(text: string): number[] {
  const out: number[] = [];
  for (const m of withoutPhones(text).matchAll(/(?<![\p{L}\d.,])(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s*([kKmM]\b|%)?(?!(?!(?:rwf|frw|rfw|ksh|kes|ugx|tzs)\b|[km]\b)\p{L})/giu)) {
    const raw = m[1];
    if (digits(raw).length >= 9) continue;
    const grouped = /^\d{1,3}([,.]\d{3})+$/.test(raw);
    let n = grouped ? Number(digits(raw)) : Number(raw);
    if (m[2] && /k/i.test(m[2])) n *= 1_000;
    if (m[2] && /m/i.test(m[2])) n *= 1_000_000;
    if (Number.isFinite(n)) out.push(Math.round(n));
  }
  return out;
}
/** Amounts that look like money or a discount: 1,000 and up, anything with K/M, RWF/FRW or %. */
function moneyAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of withoutPhones(text).matchAll(/(?<![\p{L}\d.,])(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s*([kKmM]\b|%|rwf|frw|rfw|ksh|kes|ugx|tzs)?(?!(?!(?:rwf|frw|rfw|ksh|kes|ugx|tzs)\b|[km]\b)\p{L})/giu)) {
    const value = amounts(m[0])[0];
    if (value === undefined) continue;
    if (m[2] || value >= 1000) out.push(value);
  }
  return out;
}

const ROUTE = /\b(whats\s?app|call|order|dm|inbox|book|visit|find us|shop now|buy|tel|phone|contact|vubavuba|location|website|www\.|\.com|\.rw|commandez|appelez|réservez|hamagara|twandikire|tumiza|gura|sura|ahantu)\b/i;
const CTA_VERB = /\b(order|call|whats\s?app|book|visit|buy|shop|dm|get yours|come|reserve|register|enrol|join|message|commandez|appelez|réservez|venez|hamagara|duhamagare|uhamagare|uduhamagare|tumiza|gura|iyandikishe|ngwino|muze|sura|twandikire|utwandikire|tuvugishe)\b/i;

const isText = (l: Layer): l is TextLayer => l.kind === "text";
const texts = (s: Scene) => s.layers.filter(isText).filter((l) => l.text.trim());
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const snippet = (s: string) => (s.length > 40 ? `${s.slice(0, 37)}...` : s);

/** A scene moves when its camera moves, or any layer animates, has keyframes, zooms, turns, floats or talks. */
function sceneMoves(s: Scene): boolean {
  if (s.camera && s.camera.move !== "static") return true;
  return s.layers.some(
    (l) =>
      (l.keyframes?.length ?? 0) > 1 ||
      l.kind === "particles" ||
      l.kind === "character" ||
      (l.kind === "text" && !!l.animate && l.animate !== "none") ||
      (l.kind === "photo" && ((l.zoomTo ?? 1) > 1.01 || !!l.turntable)) ||
      (l.kind === "shape" && !!l.draw),
  );
}

// Phrases the do-not-copy rules forbid. Superlatives and urgency only pass when the brief itself says them.
const NEVER: [string, RegExp][] = [
  ["no-fake-income", /you have received|received \d[\d,.]*\s*(rwf|frw)|m-?money|mobile money received|get rich|passive income|make \$?\d+k|earn [\d,.]+\s*k?\s*(rwf |frw )?(a|per) day|work and earn|akayabo|ugusezera k.ubukene|income proof/i],
  ["no-body-before-after", /\b(cure[sd]?|miracle|lose weight|weight loss|burn fat|acne[- ]free|clears? (your )?acne|guaranteed results|tummy trimming|stop snoring)\b/i],
  ["no-fake-customers", /\b(5|five)[- ]stars?\b|\b\d+\s*(happy|satisfied) (customers|clients)\b|\breplying to @/i],
  ["no-prompt-wrapper", /comment\s*["“]?prompt|how (i|to) made? this|made with ai|link in bio/i],
  ["no-watermarks", /\b(capcut|tiktok\.com|@tiktok)\b/i],
];
const SUPERLATIVE = /\b(best|cheapest|biggest|most affordable|number one|no\.? ?1|#1|lowest price|meilleur|moins cher)\b/i;
const URGENCY = /\b(only \d+ left|few left|limited stock|while stocks? last|hurry|ends (today|soon|tonight)|last chance|today only)\b/i;
const CLAIMS = /\b(free delivery|pay (after|on) delivery|\d+\s*% off|discount|guarantee[d]?|warranty)\b/i;

function briefText(b: ScoreBrief): string {
  return [b.business.name, b.business.description, b.product.name, b.product.price, b.product.summary, b.product.description, ...(b.product.usps ?? []), ...(b.product.features ?? []), b.note].filter(Boolean).join(" \n ");
}

type Check = { id: string; rule: string | null; points: number; ok: boolean; reason: string; scene?: number | null };

function result(checks: Check[]): DesignScore {
  const total = checks.reduce((s, c) => s + c.points, 0);
  const got = checks.filter((c) => c.ok).reduce((s, c) => s + c.points, 0);
  const item = (c: Check): ScoreItem => ({ id: c.id, rule: c.rule, points: c.points, reason: c.reason, scene: c.scene ?? null });
  return { score: total ? Math.round((100 * got) / total) : 100, passed: checks.filter((c) => c.ok).map(item), failed: checks.filter((c) => !c.ok).map(item) };
}

/** Where each scene starts, in seconds. */
const starts = (spec: MotionSpec) => spec.scenes.reduce<number[]>((acc, s, i) => [...acc, i ? acc[i - 1] + spec.scenes[i - 1].seconds : 0], []);

/** The first scene whose text (or say line) matches, else null. */
function firstScene(spec: MotionSpec, test: (text: string) => boolean): number | null {
  const i = spec.scenes.findIndex((s) => texts(s).some((l) => test(l.text)));
  return i >= 0 ? i : null;
}

// ---- The Claude design

/** Checks a Claude design against the brain's mechanical rules. Pure. */
export function scoreDesign(spec: MotionSpec, brief: ScoreBrief, options: ScoreOptions = {}): DesignScore {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const scenes = spec.scenes ?? [];
  if (!scenes.length) return result([{ id: "scenes", rule: null, points: 1, ok: false, reason: "The design has no scenes.", scene: null }]);
  const at = starts(spec);
  const total = Math.round(scenes.reduce((s, x) => s + x.seconds, 0) * 10) / 10;
  const platform = platformOf(options.platform ?? brief.platform);
  const format = formatById(options.format) ?? formatById(formatFromTemplate(brief.styleId)) ?? null;
  const pick = brainFor({ platform, sector: null, format: format?.id ?? null, engine: "claude", language: brief.business.language, hasPrice: !!brief.product.price, hasPhone: !!brief.business.phone, seconds: total });
  const facts = briefText(brief);
  const last = scenes.length - 1;
  const lastText = [...texts(scenes[last]).map((l) => l.text), scenes[last].say ?? ""].join(" \n ");
  const price = brief.product.price?.trim() || "";
  const phone = brief.business.phone?.trim() || "";
  const style = templateStyle(brief.styleId);
  const limits = STYLE_LIMITS[style];

  // 1. The hook: text on screen within the first 1.5 s.
  const early = scenes.flatMap((s, i) => texts(s).map((l) => ({ l, i, t: at[i] + (l.from ?? 0) * s.seconds }))).filter((x) => x.t <= 1.5);
  add(early.length
    ? { id: "hook-text", rule: "hook-3s", points: 15, ok: true, reason: `The hook "${snippet(early[0].l.text)}" is on screen at ${early[0].t.toFixed(1)} s.`, scene: early[0].i }
    : { id: "hook-text", rule: "hook-3s", points: 15, ok: false, reason: "No text is on screen in the first 1.5 seconds: open with the hook in big words (most people watch muted).", scene: 0 });
  const hook = early[0]?.l.text ?? "";
  if (hook) {
    const n = words(hook);
    add({ id: "hook-short", rule: "first-caption-0s", points: 4, ok: n <= 8, reason: n <= 8 ? `The hook is ${n} words.` : `The hook is ${n} words; keep it to about 5 (at most 8).`, scene: early[0].i });
  }

  // 2. The price, when the brief has one: on screen, and early.
  if (price) {
    const wanted = amounts(price);
    const shows = (t: string) => (wanted.length ? amounts(t).some((v) => wanted.includes(v)) : t.toLowerCase().includes(price.toLowerCase()));
    const i = firstScene(spec, shows);
    add(i === null
      ? { id: "price-shown", rule: "price-stays", points: 12, ok: false, reason: `The price (${price}) is in the brief but never on screen.`, scene: null }
      : { id: "price-shown", rule: "price-stays", points: 12, ok: true, reason: `The price is on screen from scene ${i + 1}.`, scene: i });
    // When the price must appear: in the hook for formats whose first beat carries it (1.5 s on Facebook for direct
    // ads, else 3 s); otherwise by the beat that first shows it (a before/after shows it after the result). Luxury and
    // brand templates may keep it for the end.
    const beat = pick.timeline.find((b) => /price/i.test(b.onScreen));
    if (i !== null && limits.priceEarly && beat) {
      const t = at[i] + Math.min(...texts(scenes[i]).filter((l) => shows(l.text)).map((l) => (l.from ?? 0) * scenes[i].seconds));
      const by = beat.role === "hook" ? (platform === "facebook" && style === "direct" ? 1.5 : 3) : beat.from + 1;
      add({ id: "price-early", rule: "price-first-frame", points: platform === "facebook" ? 8 : 5, ok: t <= by, reason: t <= by ? `The price appears at ${t.toFixed(1)} s.` : `The price first appears at ${t.toFixed(1)} s; for this format show it by ${by} s${beat.role === "hook" ? " (top third)" : ""}.`, scene: i });
    }
  }

  // 3. The way to order in the last scene, and the number to the end.
  if (phone) {
    add(hasPhone(lastText, phone)
      ? { id: "contact-last", rule: "cta-route", points: 12, ok: true, reason: "The phone or WhatsApp number is in the last scene.", scene: last }
      : { id: "contact-last", rule: "cta-route", points: 12, ok: false, reason: `The last scene does not show the number (${phone}).`, scene: last });
    const missing = scenes.map((s, i) => (texts(s).some((l) => hasPhone(l.text, phone)) ? -1 : i)).filter((i) => i >= 0);
    const everyScene = limits.phoneEveryScene === "always" || (limits.phoneEveryScene === "facebook" && platform === "facebook");
    if (everyScene) add({ id: "phone-bar", rule: "phone-bar", points: 6, ok: missing.length === 0, reason: missing.length ? `The number is missing from scene${missing.length > 1 ? "s" : ""} ${missing.map((i) => i + 1).join(", ")}; keep it on screen from 0 s to the end (a small quiet line is enough${style === "luxury" || style === "brand" ? " for this template" : ""}).` : "The number stays on screen in every scene.", scene: missing[0] ?? null });
  } else {
    add({ id: "contact-last", rule: "cta-route", points: 12, ok: ROUTE.test(lastText), reason: ROUTE.test(lastText) ? "The last scene names a way to order." : "The last scene does not say how to order (WhatsApp, call, visit, the website).", scene: last });
  }
  add({ id: "cta", rule: "cta-route", points: 8, ok: CTA_VERB.test(lastText), reason: CTA_VERB.test(lastText) ? "The last scene has a call to action." : "The last scene has no call to action (Order, Call, WhatsApp, Book, Visit...).", scene: last });

  // 4. Every scene moves.
  const still = brief.fixedLens ? [] : scenes.map((s, i) => (sceneMoves(s) ? -1 : i)).filter((i) => i >= 0);
  add({ id: "motion", rule: "cut-rhythm", points: 10, ok: still.length === 0, reason: still.length ? `Scene${still.length > 1 ? "s" : ""} ${still.map((i) => i + 1).join(", ")} ${still.length > 1 ? "do" : "does"} not move (no camera move, entrance, keyframes or zoom).` : "Every scene moves.", scene: still[0] ?? null });

  // 5. Text inside the platform's safe area.
  const vertical = spec.ratio === "9:16" || spec.ratio === "3:4" || spec.ratio === "4:5";
  const area = vertical ? SAFE_AREAS[platform] : WIDE_AREA;
  const outsideArea = (l: TextLayer) => l.y - l.h / 2 < area.top - TOLERANCE || l.y + l.h / 2 > area.bottom + TOLERANCE || l.x - l.w / 2 < area.left - TOLERANCE || l.x + l.w / 2 > area.right + TOLERANCE;
  const offCanvas = (l: TextLayer) => l.x - l.w / 2 < 0 || l.x + l.w / 2 > 1 || l.y - l.h / 2 < 0 || l.y + l.h / 2 > 1;
  const contact = (l: TextLayer) => (phone && hasPhone(l.text, phone)) || (price && amounts(l.text).some((v) => amounts(price).includes(v))) || CTA_VERB.test(l.text);
  const outside = scenes.flatMap((s, i) => texts(s).filter(outsideArea).map((l) => ({ l, i })));
  const box = `${platform === "any" ? "the apps' edges" : platform}: y ${area.top} to ${area.bottom}, x ${area.left} to ${area.right}`;
  const describe = (list: typeof outside) => `"${snippet(list[0].l.text)}" in scene ${list[0].i + 1}${list.length > 1 ? ` and ${list.length - 1} more` : ""}`;
  // The price, the number and the call to action must never sit under the app's buttons; other text matters less, and
  // a giant word that runs off the canvas on purpose, or a giant background word behind the product (size above 0.22,
  // depth 0.35 or less: "GALAXY", "5G" in the 3D templates), is a design choice, not a mistake.
  // Instagram's exception (instagram-patterns.md): a small shop name or phone line kept in the lower-left corner in
  // every scene reads fine, because it is small and constant.
  const cornerLine = (l: TextLayer) => platform === "instagram" && l.size <= 0.035 && l.x - l.w / 2 >= 0.03 && l.x + l.w / 2 <= 0.6 && l.y + l.h / 2 <= 0.95 && scenes.every((sc) => texts(sc).some((t) => t.text === l.text));
  const hidden = outside.filter((x) => contact(x.l) && !cornerLine(x.l));
  const backdrop = (l: TextLayer) => l.size > 0.22 && (l.depth ?? 0.8) <= 0.35;
  const strays = outside.filter((x) => !contact(x.l) && !offCanvas(x.l) && !backdrop(x.l));
  add({ id: "safe-area-contact", rule: "text-placement", points: 7, ok: hidden.length === 0, reason: hidden.length ? `${describe(hidden)}: the price, number or call to action goes under the app's buttons (${box}).` : "The price, number and call to action are inside the safe area.", scene: hidden[0]?.i ?? null });
  add({ id: "safe-area", rule: "text-placement", points: 3, ok: strays.length === 0, reason: strays.length ? `${describe(strays)} goes outside the safe area (${box}).` : "All other text is inside the safe area.", scene: strays[0]?.i ?? null });

  // 6. Length and scene count for the format.
  const [lo, hi] = pick.length.range;
  // The length is the owner's (or the template's) choice: a design that keeps the requested length passes.
  const asked = brief.seconds && Math.abs(total - brief.seconds) <= 1.5;
  const inRange = total >= Math.max(6, Math.min(lo, 30)) - 0.5 && total <= Math.min(30, hi) + 0.5;
  add({ id: "length", rule: "length", points: 6, ok: !!asked || inRange, reason: asked ? `${total} s, the requested length${inRange ? "" : ` (the research range for ${pick.format.name.toLowerCase()} is ${lo} to ${hi} s)`}.` : inRange ? `${total} s fits ${pick.format.name.toLowerCase()} (${lo} to ${hi} s).` : `${total} s is outside ${lo} to ${Math.min(30, hi)} s for ${pick.format.name.toLowerCase()}${platform === "any" ? "" : ` on ${platform}`}.`, scene: null });
  // Scenes: one fewer to two more than the format's beats, or as many as its cut rhythm allows (kinetic type: many).
  const beats = pick.timeline.length;
  const [sLo, sHi] = [Math.max(2, beats - 1), Math.min(8, Math.max(beats + 2, Math.ceil((pick.format.cutsPer10s[1] * total) / 10)))];
  add({ id: "scene-count", rule: "cut-rhythm", points: 5, ok: scenes.length >= sLo && scenes.length <= sHi, reason: scenes.length >= sLo && scenes.length <= sHi ? `${scenes.length} scenes for ${beats} beats.` : `${scenes.length} scenes; ${pick.format.name.toLowerCase()} at ${total} s works with ${sLo} to ${sHi} (${beats} beats).`, scene: null });

  // 7. A say line per scene when the voice is on.
  if (options.voice) {
    const silent = scenes.map((s, i) => (s.say?.trim() ? -1 : i)).filter((i) => i >= 0);
    add({ id: "say-lines", rule: "voice-early", points: 8, ok: silent.length === 0, reason: silent.length ? `Scene${silent.length > 1 ? "s" : ""} ${silent.map((i) => i + 1).join(", ")} ${silent.length > 1 ? "have" : "has"} no say line.` : "Every scene has a say line.", scene: silent[0] ?? null });
    const long = scenes.map((s, i) => ({ i, n: words(s.say ?? ""), max: Math.ceil(s.seconds * 3) + 1 })).filter((x) => x.n > x.max);
    add({ id: "say-length", rule: "voice-early", points: 4, ok: long.length === 0, reason: long.length ? `The say line of scene ${long[0].i + 1} has ${long[0].n} words for ${scenes[long[0].i].seconds} s (about 2.5 words a second).` : "The say lines fit their scenes.", scene: long[0]?.i ?? null });
  }

  // 8. On-screen text short enough, at most two lines at once (plus the fixed price and phone strip).
  const wordy = scenes.flatMap((s, i) => texts(s).filter((l) => words(l.text) > 12).map((l) => ({ l, i })));
  add({ id: "text-length", rule: "two-lines", points: 5, ok: wordy.length === 0, reason: wordy.length ? `"${snippet(wordy[0].l.text)}" in scene ${wordy[0].i + 1} has ${words(wordy[0].l.text)} words; keep lines to about 10.` : "Every text line is short.", scene: wordy[0]?.i ?? null });
  const fixed = (l: TextLayer) => (phone && hasPhone(l.text, phone)) || (price && amounts(l.text).some((v) => amounts(price).includes(v)));
  const crowded = scenes.map((s, i) => ({ i, n: texts(s).filter((l) => !fixed(l)).length })).filter((x) => x.n > limits.maxLines);
  add({ id: "text-crowd", rule: "two-lines", points: 4, ok: crowded.length === 0, reason: crowded.length ? `Scene ${crowded[0].i + 1} has ${crowded[0].n} text lines besides the price and number; a ${style} template keeps to ${limits.maxLines}.` : "No scene is crowded with text.", scene: crowded[0]?.i ?? null });

  // 9. The post caption.
  const caption = `${spec.caption ?? ""} ${(spec.hashtags ?? []).join(" ")}`;
  const captionMisses = [!spec.caption?.trim() ? "a caption" : "", phone && !hasPhone(caption, phone) ? "the number" : "", price && !amounts(caption).some((v) => amounts(price).includes(v)) ? "the price" : "", (spec.hashtags?.length ?? 0) < 2 ? "2 or more hashtags" : ""].filter(Boolean);
  add({ id: "caption", rule: "caption-complete", points: 6, ok: captionMisses.length === 0 && (spec.caption?.length ?? 0) <= 600, reason: captionMisses.length ? `The post caption is missing ${captionMisses.join(", ")}.` : (spec.caption?.length ?? 0) > 600 ? "The post caption is over 600 characters." : "The post caption has the facts.", scene: null });

  // 10. Nothing from the do-not-copy list, and no facts the brief does not give.
  const all = scenes.map((s, i) => ({ i, text: [...texts(s).map((l) => l.text), s.say ?? ""].join(" \n ") }));
  all.push({ i: -1, text: caption });
  const hits: { rule: string; i: number; what: string }[] = [];
  for (const { i, text } of all) {
    for (const [rule, re] of NEVER) {
      const m = text.match(re);
      if (m) hits.push({ rule, i, what: m[0] });
    }
    for (const [rule, re] of [["no-made-up-superlative", SUPERLATIVE], ["no-invented-facts", URGENCY], ["no-invented-facts", CLAIMS]] as const) {
      const m = text.match(re);
      if (m && !new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(facts)) hits.push({ rule, i, what: m[0] });
    }
  }
  const sceneOf = (i: number) => (i >= 0 ? i : null);
  const where = (i: number) => (i >= 0 ? `scene ${i + 1}` : "the caption");
  const banned = hits.filter((h) => h.rule !== "no-invented-facts");
  add({ id: "do-not-copy", rule: banned[0]?.rule ?? "no-fake-income", points: 12, ok: banned.length === 0, reason: banned.length ? `"${banned[0].what}" in ${where(banned[0].i)} breaks the do-not-copy list (${banned[0].rule}).` : "Nothing from the do-not-copy list.", scene: banned.length ? sceneOf(banned[0].i) : null });
  const known = new Set(amounts(facts));
  const invented = all.flatMap(({ i, text }) => moneyAmounts(text).filter((v) => !known.has(v)).map((v) => ({ i, what: String(v) })));
  const claims = hits.filter((h) => h.rule === "no-invented-facts");
  const bad = [...invented, ...claims];
  add({ id: "facts", rule: "no-invented-facts", points: 10, ok: bad.length === 0, reason: bad.length ? `"${bad[0].what}" in ${where(bad[0].i)} is not in the brief (prices, discounts, stock and delivery come only from the owner).` : "Every number and promise comes from the brief.", scene: bad.length ? sceneOf(bad[0].i) : null });

  return result(checks);
}

// ---- The Seedance prompt

/** The facts a Seedance prompt is checked against. A PromptBrief fits this shape. */
export type PromptScoreBrief = {
  business: { name: string; description?: string | null; language?: string | null };
  product: { name: string; price?: string | null; summary?: string | null; description?: string | null; usps?: string[]; features?: string[] };
  references?: string[];
  seconds: number;
  audio?: boolean;
  fixedLens?: boolean;
  note?: string | null;
  /** The template (Seedance or Claude engine id) or the format, so before/after and tour prompts are judged as such. */
  templateId?: string | null;
  format?: string | null;
};

/** Action verbs that make a first shot move (a hand places, a presenter shrugs, the cloth pulls away). */
const MOTION_WORDS = /\b(pulls?|reveals?|turns?|turning|lifts?|pours?|opens?|slides?|rises?|spins?|unwraps?|unrolls?|bites?|walks?|steps?|enters?|glides?|swings?|splash(es)?|steam(ing)?|sizzl\w*|drops?|flies|whips?|rotates?|places?|puts?|picks?|holds? up|shows?|waves?|shrugs?|dances?|twirls?|cuts?|slices?|dips?|sprinkles?|stirs?|fills?|lights? up|glows?|emerges?|appears?)\b/i;
/** Real places a Seedance clip can be set in (seedance-brain.ts "place" rule). */
const PLACE_WORDS_SEEDANCE = /\b(kigali|rwanda\w*|east african|hillside|hills|market|shop|store|boutique|salon|barber|kitchen|street|counter|home|house|room|bedroom|restaurant|caf[eé]|office|compound|garden|balcony|venue|hall|workshop|classroom|school|table|terrace|yard)\b/i;
/** A before/after's first shot is the result (the research's "Wait for it...", tt-102). */
const RESULT_WORDS = /\b(result|after|finished|transformed|spotless|shining|new look|the final)\b/i;
// A child as the subject; "baby clothes" or "a baby carrier" (the product) is fine.
const FACE_WORDS = /\b(famous|celebrit\w*|lookalike|look-alike|resembl\w+|real (person|face|people)|the actor|the singer|the footballer)\b|\b(children|kids)\b|\b(a|the|young|little) (child|kid|toddler|baby|boy|girl)\b(?! (clothes|shoes|carrier|products?|shop|food|bottle|formula|wear))/i;

/** Checks a Seedance prompt against the brain's and the Seedance brain's rules. Pure. */
export function scoreSeedancePrompt(prompt: string, brief: PromptScoreBrief): DesignScore {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const text = prompt.trim();
  const refs = brief.references ?? [];
  const images = refs.filter((r) => /^\s*image\b/i.test(r)).length;

  // 1. Time codes that cover the clip, 2 to 5 shots.
  const codes = promptTimecodes(text);
  const end = codes.length ? Math.max(...codes.map((c) => c[1])) : 0;
  const gaps = codes.slice(1).filter((c, i) => Math.abs(c[0] - codes[i][1]) > 0.5).length;
  const timeOk = codes.length >= 2 && codes.length <= 5 && codes[0][0] === 0 && Math.abs(end - brief.seconds) <= 1 && gaps === 0;
  add({ id: "timecodes", rule: "cut-rhythm", points: 15, ok: timeOk, reason: !codes.length ? "No time codes: write '0-2s: ...; 2-5s: ...' covering the whole clip." : timeOk ? `${codes.length} shots from 0 to ${end} s.` : `The time codes (${codes.map((c) => `${c[0]}-${c[1]}s`).join(", ")}) should start at 0, follow on, end at ${brief.seconds} s and hold 2 to 5 shots.`, scene: null });

  // 2. The hook: motion or a reveal in the first shot (a shot lasts 2 to 4 s); in a before/after, the result itself
  // (held still is fine: "Wait for it...") is the hook, and it must come first.
  const format = brief.format ?? formatFromTemplate(brief.templateId) ?? null;
  const shots = text.split(/(?=\b\d+(?:\.\d+)?\s*(?:-|–|to)\s*\d+(?:\.\d+)?\s*s)/i).filter((s) => promptTimecodes(s).length);
  const first = shots[0] ?? text;
  const firstEnd = codes[0]?.[1] ?? Infinity;
  const resultFirst = format === "before-after" && RESULT_WORDS.test(first);
  const moving = resultFirst || MOTION_WORDS.test(first) || (detectCamera(first)?.id ?? "static") !== "static";
  add({ id: "hook-shot", rule: "hook-3s", points: 15, ok: moving && firstEnd <= 4, reason: !moving ? "The first shot has no motion or reveal; open with an action (a hand lifts, the cloth pulls away) or a camera move." : firstEnd > 4 ? `The first shot runs to ${firstEnd} s; open with a shot of 2 to 4 s.` : resultFirst ? "It opens on the result." : "The first shot opens on motion.", scene: 0 });
  if (format === "before-after") add({ id: "result-first", rule: "result-first", points: 8, ok: RESULT_WORDS.test(first), reason: RESULT_WORDS.test(first) ? "The result comes first." : "A before/after shows the result first, then the before (the first shot here is the before).", scene: 0 });

  // 3. Product fidelity, when a product image is attached.
  if (images) {
    const ok = /exactly as in (the |its )?(photo|image|picture)|same shape,? colou?rs?/i.test(text);
    add({ id: "fidelity", rule: "seedance-clean-frames", points: 12, ok, reason: ok ? "The prompt keeps the product exactly as in its photo." : "Add the fidelity sentence: 'the product from Image 1, exactly as in the photo: same shape, colours, logo and label'.", scene: null });
  }

  // 4. No real, famous or lookalike faces, no children.
  const face = text.match(FACE_WORDS);
  add({ id: "people", rule: "no-lookalikes", points: 10, ok: !face, reason: face ? `"${face[0]}": people must be fictional adults described generally.` : "No real, famous or child subjects.", scene: null });

  // 5. No facts the brief does not give.
  const facts = [brief.business.name, brief.business.description, brief.product.name, brief.product.price, brief.product.summary, brief.product.description, ...(brief.product.usps ?? []), ...(brief.product.features ?? []), brief.note].filter(Boolean).join(" \n ");
  const known = new Set(amounts(facts));
  const noCodes = text.replace(/\b\d+(?:\.\d+)?\s*(?:-|–|to)\s*\d+(?:\.\d+)?\s*s(?:ec(?:onds?)?)?\b/gi, " ");
  const invented = moneyAmounts(noCodes).filter((v) => !known.has(v)).map(String);
  const claim = [noCodes.match(CLAIMS)?.[0], noCodes.match(URGENCY)?.[0], noCodes.match(SUPERLATIVE)?.[0]].filter((m): m is string => !!m && !facts.toLowerCase().includes(m.toLowerCase()));
  const bad = [...invented, ...claim];
  add({ id: "facts", rule: "no-invented-facts", points: 12, ok: bad.length === 0, reason: bad.length ? `"${bad[0]}" is not in the brief.` : "Every number and promise comes from the brief.", scene: null });

  // Seedance films 4 to 15 whole seconds (seedance.ts SEEDANCE_LIMITS); longer videos are joined from clips.
  const clipOk = Number.isInteger(brief.seconds) && brief.seconds >= 4 && brief.seconds <= 15;
  add({ id: "clip-length", rule: null, points: 5, ok: clipOk, reason: clipOk ? `${brief.seconds} s is a length Seedance films.` : `Seedance films 4 to 15 whole seconds; ${brief.seconds} s must be split into clips.`, scene: null });

  // A real place: a Kigali shop, a street, a salon, a home; a plain studio only for a product reveal's hero shots.
  const placed = PLACE_WORDS_SEEDANCE.test(text) || (format === "product-reveal" && /\bstudio\b/i.test(text));
  add({ id: "real-place", rule: "real-place", points: 6, ok: placed, reason: placed ? "The clip is set in a real place." : "Set the clip in a real place (a Kigali shop counter, a market stall, a salon chair, a home, a street), not an empty void.", scene: null });

  // 6. 60 to 160 words.
  const n = words(text);
  add({ id: "length-words", rule: null, points: 8, ok: n >= 60 && n <= 160, reason: n >= 60 && n <= 160 ? `${n} words.` : `${n} words; Seedance follows 60 to 160 words best.`, scene: null });

  // 7. Clean frames, and references that exist (the Seedance lint).
  const lint = lintSeedancePrompt(text, { seconds: brief.seconds, images, videos: refs.filter((r) => /^\s*video\b/i.test(r)).length, audios: refs.filter((r) => /^\s*audio\b/i.test(r)).length, fixedLens: brief.fixedLens, audio: brief.audio });
  // The lint catches "on-screen text" and "captions"; this also catches "the text SALE on screen", "a sign that reads".
  const asksText = text.split(/[.\n]/).some((x) => !/\b(no|without|never)\b/i.test(x) && /\b(text|words?|letters|sign|banner|title)\b[^.]{0,40}\b(on[- ]screen|appears?|reads?|says?|written)\b|\bon[- ]screen\b/i.test(x));
  const textIssue = lint.find((i) => i.code === "on-screen-text")?.message ?? (asksText ? "The prompt asks for text in the video. Seedance garbles letters; BuPulse adds the text afterwards." : null);
  add({ id: "clean-frames", rule: "seedance-clean-frames", points: 10, ok: !textIssue, reason: textIssue ?? "No text asked for in the frames.", scene: null });
  const refIssue = lint.find((i) => i.code === "reference-missing" || i.code === "reference-unused");
  if (refs.length || refIssue) add({ id: "references", rule: null, points: 8, ok: !refIssue, reason: refIssue ? refIssue.message : "The references are named and exist.", scene: null });

  // 8. Sound: no spoken line without sound, none in Kinyarwanda or Swahili.
  const spoken = /"[^"]{3,}"|“[^”]{3,}”/.test(text);
  const v = voiceLanguage(brief.business.language);
  const soundBad = (brief.audio === false && spoken) || (spoken && v.spokenLanguage !== v.captionLanguage);
  add({ id: "sound", rule: "voice-language", points: 8, ok: !soundBad, reason: !soundBad ? "The sound fits the settings." : brief.audio === false ? "Sound is off but the prompt has a spoken line." : `The prompt has a spoken line, but Seedance cannot speak ${v.captionLanguage}: music and ambient sound only.`, scene: null });

  // 9. A clean hero end shot.
  const lastShot = shots[shots.length - 1] ?? "";
  // A tour ends on the place: a wide reveal of the view or the front has the same clean space for the overlay.
  const hero = /\bhero\b|centred|centered|space above|clean (end|final|shot)/i.test(lastShot) || (format === "tour" && /\b(wide|pull-?back|view|front|exterior|establishing)\b/i.test(lastShot));
  add({ id: "hero-end", rule: "seedance-clean-frames", points: 5, ok: hero, reason: hero ? "It ends on a clean hero shot." : "End on a clean hero shot of the product with space above it for BuPulse's text.", scene: shots.length ? shots.length - 1 : null });

  return result(checks);
}

// ---- The post caption and hashtags
// Based on the caption corpus (docs/research/reels/captions.jsonl, 125 captions, 111 Rwandan, and captions-patterns.md).

export type CaptionScore = DesignScore & { /** The failed checks' reasons, in order: what the caption misses. */ missed: string[] };

/** City and country words that make a hashtag local, by the business's country (Rwanda when none is given). */
const LOCAL_TAGS: Record<string, RegExp> = {
  RW: /kigali|rwanda|^rw|kgl|_250|musanze|rubavu|huye|kicukiro|gasabo|nyarugenge|remera|kimironko|kibagabaga/,
  KE: /nairobi|kenya|mombasa|kisumu|^ke/,
  UG: /kampala|uganda|^ug/,
  TZ: /tanzania|dar|zanzibar|arusha|^tz/,
};
const COUNTRY_CODES: [RegExp, string][] = [[/kenya/i, "KE"], [/uganda/i, "UG"], [/tanzania/i, "TZ"], [/rwanda/i, "RW"]];
/** Broad reach tags: one or two are normal, a pile of them is the low-view habit. */
const BROAD_TAGS = /^(fyp\w*|foryou\w*|viral\w*|trending\w*|explore\w*|reels\w*|tiktok\w*|instagood|xyzbca|capcut)$/;
const PLACE_WORDS = /📍|\b(next to|opposite|near|behind|in front of|same building|located|location|loc|plaza|house|room \d+|building|street|st|road|av(e|enue)?\.?|KK \d+|KG \d+|KN \d+|kigali|kicukiro|gasabo|nyarugenge|kimironko|remera|kacyiru|kiyovu|nyamirambo|gishushu|kibagabaga|kabeza|kanombe|gikondo|nyarutarama|muhima|downtown|musanze|rubavu|huye)\b/i;
/** Delivery in English, French ("livraison", "livré", "à domicile") and Kinyarwanda (both spellings of "we bring it to you"). */
const DELIVERY_WORDS = /(?<![\p{L}])(deliver(y|ies|ed)?|livraisons?|livr(é|e)(e?s?)|livrons|livrer|à domicile|tuyikujyezaho|tuyikugezaho|tubagezaho|tukugezaho|kugeza)(?![\p{L}])/iu;
const NO_SUBSCRIBE = /\b(subscribe|like and follow|hit the bell|turn on notifications|abonne[zr]?)\b/i;
const MAX_CHARS: Record<Platform | "any", number> = { facebook: 600, tiktok: 300, instagram: 300, shorts: 100, any: 600 };

const tagsOf = (caption: string, hashtags: string[]) => [...new Set([...hashtags, ...(caption.match(/#[\p{L}\p{N}_]+/gu) ?? [])].map((t) => t.replace(/^#/, "").trim().toLowerCase()).filter(Boolean))];

/**
 * Grades a post caption and its hashtags against the caption corpus and the platform's habits
 * (brain/data/captions.json): the product and price up front, the way to order and the number, the price, the place,
 * delivery when the owner delivers, the hashtag count and mix, Kinyarwanda for a Kinyarwanda business, the length, and
 * the forbidden lines. Pure.
 */
export function scoreCaption(caption: string, hashtags: string[], brief: ScoreBrief, options: ScoreOptions = {}): CaptionScore {
  const checks: Check[] = [];
  const add = (c: Omit<Check, "scene">) => checks.push({ ...c, scene: null });
  const text = (caption ?? "").trim();
  const platform = platformOf(options.platform ?? brief.platform);
  const where = platform === "any" ? "TikTok" : platform === "shorts" ? "YouTube Shorts" : platform[0].toUpperCase() + platform.slice(1);
  const guide = BRAIN.captions.platforms.find((p) => p.platform === (platform === "any" ? "tiktok" : platform))!;
  const facts = briefText(brief);
  const phone = brief.business.phone?.trim() || "";
  const price = brief.product.price?.trim() || "";
  const shorts = platform === "shorts";
  const body = text.replace(/#[\p{L}\p{N}_]+/gu, " ").trim();

  add({ id: "caption-present", rule: "caption-complete", points: 10, ok: body.length > 0, reason: body ? "There is a caption." : text ? "The caption is hashtags only; write what is sold, the price and how to order." : "There is no caption; write one." });

  // The product, and the price or offer, in the first 60 characters (a Short's title: 40).
  const head = text.slice(0, shorts ? 40 : 60).toLowerCase();
  const nameWords = brief.product.name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  const named = nameWords.some((w) => head.includes(w));
  const offerWords = (brief.note ?? "").toLowerCase().split(/[^\p{L}\p{N}%]+/u).filter((w) => w.length >= 4);
  const priced = (price !== "" && amounts(head).some((v) => amounts(price).includes(v))) || offerWords.some((w) => head.includes(w)) || (shorts && /\d/.test(head));
  const wantsPrice = (price !== "" || offerWords.length > 0) && !shorts;
  const leads = (named || (shorts && priced)) && (!wantsPrice || priced);
  add({ id: "first-line", rule: shorts ? "shorts-title" : "caption-complete", points: 10, ok: leads, reason: leads ? `The product${wantsPrice ? " and the price or offer" : ""} come first.` : `Put the product${wantsPrice ? " and the price or offer" : ""} in the first ${shorts ? 40 : 60} characters ("Jumpsuit Diras kuri 18k gusa", "Commercial blender, 48,000 RWF").` });

  // The way to order, and the number when the business has one (any written form: 0788218567, 0788 218 567, +250 788 218 567).
  const routed = CTA_VERB.test(text) || ROUTE.test(text);
  add({ id: "caption-cta", rule: shorts ? "shorts-pointer" : "cta-route", points: 12, ok: routed, reason: routed ? "The caption says how to order." : `Say how to order: "Call/WhatsApp: ${phone || "…"}", "DM to order"${/kinyarwanda/i.test(brief.business.language ?? "") ? ', "Duhamagare cyangwa utwandikire kuri WhatsApp"' : ""}.` });
  if (phone) {
    const ok = hasPhone(text, phone);
    add({ id: "caption-phone", rule: "caption-complete", points: 12, ok, reason: ok ? "The phone number is in the caption." : `Add the number: "Call/WhatsApp: ${phone}".` });
  }
  if (price) {
    const shown = amounts(text).some((v) => amounts(price).includes(v));
    add({ id: "caption-price", rule: "caption-complete", points: platform === "facebook" ? 8 : 4, ok: shown, reason: shown ? "The price is in the caption." : `Add the price (${price}).` });
  }
  if (PLACE_WORDS.test([brief.business.description, brief.note].filter(Boolean).join(" "))) {
    const placed = PLACE_WORDS.test(text);
    add({ id: "caption-place", rule: "landmark", points: 6, ok: placed, reason: placed ? "The caption says where the business is." : "Add a 📍 line with the area and a landmark ('next to …', 'opposite …')." });
  }
  if (DELIVERY_WORDS.test(facts)) {
    const said = DELIVERY_WORDS.test(text);
    add({ id: "caption-delivery", rule: "trust-line", points: 6, ok: said, reason: said ? "The delivery line is there." : "The business delivers: say it ('Free delivery in Kigali', 'Delivery available')." });
  }

  // Hashtags: the platform's count (Facebook 0 to 3, TikTok and Instagram 4 to 6, Shorts 1 to 3); when there are any, a
  // local one and at most two broad ones (#shorts is Shorts' own tag, not a broad one).
  const tags = tagsOf(text, hashtags ?? []);
  const [lo, hi] = guide.hashtags.count;
  add({ id: "hashtag-count", rule: "local-hashtags", points: 8, ok: tags.length >= lo && tags.length <= hi, reason: tags.length >= lo && tags.length <= hi ? `${tags.length} hashtags (${lo} to ${hi} on ${where}).` : `${tags.length} hashtags; captions that work on ${where} use ${lo} to ${hi}.` });
  if (tags.length) {
    const country = COUNTRY_CODES.find(([re]) => re.test(brief.business.description ?? "") || re.test(brief.business.country ?? ""))?.[1] ?? "RW";
    const local = tags.filter((t) => LOCAL_TAGS[country].test(t));
    const broad = tags.filter((t) => BROAD_TAGS.test(t));
    const mixed = local.length >= 1 && broad.length <= 2;
    add({ id: "hashtag-mix", rule: "local-hashtags", points: 8, ok: mixed, reason: mixed ? `Local tags (${local.map((t) => `#${t}`).join(" ")}) with ${broad.length} broad tag${broad.length === 1 ? "" : "s"}.` : !local.length ? `Add a local tag (${guide.hashtags.local.slice(0, 3).join(" ")}).` : `${broad.length} broad tags (${broad.map((t) => `#${t}`).join(" ")}); keep at most 2 and lead with the city.` });
  }

  // Kinyarwanda businesses: Kinyarwanda in the caption (mixed is fine; models, sizes and RWF stay as they are).
  if (/kinyarwanda|^rw$|^kin$/i.test((brief.business.language ?? "").trim())) {
    const rw = hasKinyarwanda(text);
    add({ id: "caption-language", rule: "language-mix", points: 8, ok: rw, reason: rw ? "The caption speaks Kinyarwanda." : "This business writes in Kinyarwanda: write the offer and the invitation in Kinyarwanda ('kuri … gusa', 'Duhamagare'), keep the model and the price as they are." });
  }

  // Length: a Short's title under 100 characters, TikTok and Instagram one or two lines, Facebook under 600.
  const max = MAX_CHARS[platform];
  add({ id: "caption-length", rule: shorts ? "shorts-title" : "caption-layout", points: 4, ok: text.length <= max, reason: text.length <= max ? `${text.length} characters.` : `${text.length} characters; keep it under ${max} on ${where}.` });

  // Forbidden lines and facts the brief does not give.
  const banned = NEVER.map(([rule, re]) => ({ rule, m: text.match(re) })).filter((x) => x.m);
  const sup = text.match(SUPERLATIVE);
  if (sup && !new RegExp(sup[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(facts)) banned.push({ rule: "no-made-up-superlative", m: sup });
  const sub = shorts ? text.match(NO_SUBSCRIBE) : null;
  if (sub) banned.push({ rule: "no-subscribe", m: sub });
  add({ id: "caption-do-not-copy", rule: banned[0]?.rule ?? "no-made-up-superlative", points: 10, ok: !banned.length, reason: banned.length ? `"${banned[0].m![0]}" breaks the do-not-copy list (${banned[0].rule}).` : "No forbidden lines." });
  const known = new Set(amounts(facts));
  const madeIn = tags.includes("madeinrwanda") && !/made in rwanda/i.test(facts) ? ["#MadeInRwanda (only for goods made in Rwanda)"] : [];
  const invented = [...moneyAmounts(text).filter((v) => !known.has(v)).map(String), ...[text.match(URGENCY)?.[0], text.match(CLAIMS)?.[0]].filter((m): m is string => !!m && !facts.toLowerCase().includes(m.toLowerCase())), ...madeIn];
  add({ id: "caption-facts", rule: "no-invented-facts", points: 10, ok: !invented.length, reason: invented.length ? `"${invented[0]}" is not in the brief.` : "Every number and promise comes from the brief." });

  const r = result(checks);
  return { ...r, missed: r.failed.map((f) => f.reason) };
}

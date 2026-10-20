// BuPulse's text over a finished Seedance clip (docs/VIDEO_ENGINE.md, "Seedance overlay"). A Seedance clip comes back
// with clean frames (no price, no number, no caption: the prompt asks for that, seedance-brain.ts "text" rule), so the
// motion engine draws them on top: the clip is a full-frame "video" layer in a MotionSpec, one scene per shot (cuts
// only, so the clip plays straight through), with the hook in the first 3 s, the price on the product shot, the
// phone bar on every scene and the call to action on the last, all inside the platform's safe area, in the business's
// language. The caption and hashtags follow the Brain's caption formulas and are checked with its scoreCaption.
// Pure: no network, no clock. The renderer (draw.ts/encode.ts) learns the video layer from the motion engine.
import { BRAIN, safeAreaFor, type SafeArea } from "./brain";
import { scoreCaption, type CaptionScore } from "./brain/score";
import { brainBriefFromPrompt, brainFor } from "./brain/select";
import { languageOf, planSeedanceShots, promptTimecodes } from "./seedance-brain";
import type { PromptBrief } from "./seedance-prompt";
import { RATIOS, SPEC_LIMITS, YOUTUBE_MIDDLE_BAND, isRatio, type Layer, type MotionSpec, type Ratio, type Scene, type TextLayer } from "./spec";
import { localPhone } from "./validate";

// The clip is a spec.ts VideoLayer: `start` is where in the clip each scene begins (seconds), so consecutive scenes play
// the clip straight through; `sound` keeps the clip's own audio (Seedance's ambient sound and lines) under any music.

export type OverlayInput = {
  /** The brief the clip was made from: business (with phone), product, platform, seconds, ratio, template. */
  brief: PromptBrief;
  /** Where the browser can read the MP4 (/videos/seedance/<id>.mp4 in the studio). */
  clipUrl: string;
  /** The shots' times in the clip; default: the prompt's time codes when given, else the plan's. */
  shots?: { from: number; to: number; action?: string }[];
  /** The prompt the clip was made from (its time codes give the shots). */
  prompt?: string | null;
  /** The clip's real length in seconds (default: the brief's). */
  seconds?: number;
};

/** Templates calm enough to keep the number small on the first shot (owner decision: the number is always on screen). */
const LUXURY = new Set(["phone-hero", "realestate-golden", "events-venue-tour", "any-product-hero", "restaurant-dish-hero"]);
const VERTICAL = new Set<Ratio>(["9:16", "3:4", "4:5"]);
const WIDE_AREA: SafeArea = { top: 0.05, bottom: 0.95, left: 0.04, right: 0.96 };
const HOOK_SECONDS = 3;
const PALETTE = { background: "#000000", primary: "#111111", accent: "#ffd23f", text: "#ffffff" };

type Lang = "en" | "fr" | "rw";
const langOf = (language: string | null | undefined): Lang => {
  const l = languageOf(language);
  return l === "fr" ? "fr" : l === "rw" ? "rw" : "en";
};
/** On-screen words by language. Kinyarwanda uses the sellers' own words from the caption corpus (captions.json). */
const WORDS: Record<Lang, { price: (p: string) => string; cta: (phone: boolean) => string; phone: (n: string) => string; dm: string }> = {
  en: { price: (p) => p, cta: (phone) => (phone ? "Call or WhatsApp to order" : "DM to order"), phone: (n) => `Call/WhatsApp ${n}`, dm: "DM to order" },
  fr: { price: (p) => p, cta: (phone) => (phone ? "Appelez ou écrivez sur WhatsApp" : "Commandez en DM"), phone: (n) => `Appel/WhatsApp ${n}`, dm: "Commandez en DM" },
  rw: { price: (p) => `Kuri ${p} gusa`, cta: (phone) => (phone ? "Duhamagare cyangwa utwandikire" : "Twandikire kuri DM"), phone: (n) => `Duhamagare: ${n}`, dm: "Twandikire kuri DM" },
};

const round = (n: number) => Math.round(n * 1000) / 1000;
const shortName = (name: string) => name.split(/\s+[–—-]\s+|,\s*/)[0].trim() || name.trim();

/** The shots as scenes: scaled to the clip's length, and a shot shorter than the spec's floor joins its neighbour. */
export function overlayTimings(input: OverlayInput): { from: number; to: number; action: string }[] {
  const seconds = input.seconds ?? input.brief.seconds;
  const fromPrompt = input.prompt ? promptTimecodes(input.prompt).map(([from, to]) => ({ from, to, action: "" })) : [];
  const given = input.shots?.length ? input.shots.map((s) => ({ ...s, action: s.action ?? "" })) : fromPrompt.length >= 2 ? fromPrompt : planSeedanceShots({ ...input.brief, seconds }).shots;
  const end = Math.max(...given.map((s) => s.to)) || seconds;
  const k = seconds / end;
  const out = given.map((s) => ({ from: round(s.from * k), to: round(s.to * k), action: s.action ?? "" }));
  for (let i = 0; i < out.length && out.length > 2; ) {
    if (out[i].to - out[i].from >= SPEC_LIMITS.minSceneSeconds) {
      i++;
      continue;
    }
    // Join the next shot (the last one joins the one before); the product shot keeps its action.
    const j = i === out.length - 1 ? i - 1 : i;
    out.splice(j, 2, { from: out[j].from, to: out[j + 1].to, action: `${out[j].action} ${out[j + 1].action}`.trim() });
  }
  out[0].from = 0;
  out[out.length - 1].to = round(seconds);
  return out;
}

/** The hook: the Brain's best hook that can be filled from the brief's facts alone, else the product (and price). */
export function overlayHook(b: PromptBrief): string {
  const lang = langOf(b.business.language);
  const name = shortName(b.product.name);
  const price = b.product.price?.trim() && !/[(]/.test(b.product.price) ? b.product.price.trim() : null;
  if (lang === "rw") return price ? `Kuri ${price} tuguha ${name}` : name;
  if (lang === "fr") return price ? `${name} à ${price}` : name;
  const facts: Record<string, string | null> = { product: name, price, business: b.business.name.trim(), claim: b.product.usps?.find((u) => u.trim() && u.split(/\s+/).length <= 6)?.trim().replace(/[.!]+$/, "") ?? null };
  const pick = brainFor(brainBriefFromPrompt(b, { platform: b.platform ?? null, hasPhone: !!b.business.phone?.trim() }));
  for (const h of pick.hooks) {
    // Descriptions in brackets are directions, not words; only the first of several alternatives is used.
    const pattern = h.pattern.split(" / ")[0].replace(/\s*\([^)]*\)/g, "").split(" | ").slice(0, 2).join(" · ").trim();
    if (!pattern || /\.\.\./.test(pattern)) continue;
    const keys = [...pattern.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (keys.some((k) => !facts[k])) continue;
    // "{price} RWF" in a pattern when the price already says its currency: the word once.
    const text = pattern
      .replace(/\{(\w+)\}/g, (_, k: string) => facts[k] as string)
      .replace(/\b(\p{L}+)(\s+\1\b)+/giu, "$1");
    if (text.split(/\s+/).length <= 8) return text;
  }
  return price ? `${name} · ${price}` : name;
}

/** Text height (fraction of the canvas height) for `text` at `size` in a box `w` wide, on a canvas `aspect` = W/H. */
function textBox(text: string, size: number, w: number, aspect: number): { lines: number; h: number } {
  const perLine = Math.max(6, Math.floor(w / (size * 0.56)));
  const lines = Math.max(1, Math.ceil(text.length / perLine));
  return { lines, h: round(lines * size * aspect * 1.3 + 0.025) };
}

/** A text layer that fits its box: the size shrinks (never under the validator's 0.03) until it takes at most `maxLines`. */
function fitted(text: string, o: { x: number; y: number; w: number; size: number; aspect: number; maxLines: number; font?: TextLayer["font"]; weight?: number; color: string; box?: TextLayer["box"]; uppercase?: boolean; from?: number; to?: number; animate?: TextLayer["animate"] }): TextLayer {
  let size = o.size;
  let fit = textBox(text, size, o.w, o.aspect);
  while (fit.lines > o.maxLines && size > 0.031) {
    size = round(Math.max(0.03, size * 0.9));
    fit = textBox(text, size, o.w, o.aspect);
  }
  return {
    kind: "text",
    text,
    x: o.x,
    y: o.y,
    w: o.w,
    h: fit.h,
    from: o.from ?? 0,
    to: o.to ?? 1,
    depth: 0.95,
    font: o.font ?? "poppins",
    weight: o.weight ?? 800,
    size,
    color: o.color,
    align: "center",
    uppercase: o.uppercase ?? false,
    box: o.box ?? null,
    highlight: null,
    shadow: true,
    text3d: null,
    animate: o.animate ?? "pop",
    animateFor: 0.35,
  };
}

/** Keeps a layer's box inside the area (centre moved in; never wider or taller than the area). */
const inside = (l: TextLayer, a: SafeArea): TextLayer => {
  const w = Math.min(l.w, round(a.right - a.left));
  const h = Math.min(l.h, round(a.bottom - a.top));
  return { ...l, w, h, x: round(Math.min(a.right - w / 2, Math.max(a.left + w / 2, l.x))), y: round(Math.min(a.bottom - h / 2, Math.max(a.top + h / 2, l.y))) };
};

/** Which shot shows the product: the first after the opening one that names it, else the last. */
function productShot(shots: { action: string }[], b: PromptBrief): number {
  const name = shortName(b.product.name).toLowerCase();
  const i = shots.findIndex((s, j) => j > 0 && (s.action.toLowerCase().includes(name) || /\bImage \d/.test(s.action)));
  return i >= 0 ? i : shots.length - 1;
}

/** The overlay spec for a finished Seedance clip (see the file header). */
export function seedanceOverlaySpec(input: OverlayInput): MotionSpec {
  const b = input.brief;
  const ratio: Ratio = isRatio(b.ratio) ? b.ratio : "9:16";
  const { width, height } = RATIOS[ratio];
  const aspect = width / height;
  // Sizes are fractions of the canvas width: on wide shapes the same words take less of it.
  const k = Math.min(1, Math.max(0.3, (height / width) / (16 / 9)));
  const size = (n: number) => round(Math.max(0.03, n * k));
  const platform = b.platform ?? null;
  const vertical = VERTICAL.has(ratio);
  const area = vertical ? safeAreaFor(platform) : WIDE_AREA;
  const shorts = vertical && (platform === "youtube" || platform === "shorts");
  // On YouTube Shorts the price, the number and the call to action sit in the middle band.
  const contact: SafeArea = shorts ? { ...area, ...YOUTUBE_MIDDLE_BAND } : area;
  const lang = langOf(b.business.language);
  const words = WORDS[lang];
  const phone = b.business.phone?.trim() ? localPhone(b.business.phone) : null;
  const price = b.product.price?.trim() && !/[(]/.test(b.product.price) && b.product.price.trim().length <= 40 ? b.product.price.trim() : null;
  const plan = planSeedanceShots({ ...b, seconds: input.seconds ?? b.seconds });
  const luxury = LUXURY.has(plan.templateId);
  const shots = overlayTimings(input);
  const productAt = productShot(shots, b);
  const cx = round((area.left + area.right) / 2);
  const W = round(area.right - area.left);
  const hook = overlayHook(b);

  const scenes: Scene[] = shots.map((s, i) => {
    const seconds = round(s.to - s.from);
    const layers: Layer[] = [{ kind: "video", url: input.clipUrl, fit: "cover", start: s.from, sound: true, x: 0.5, y: 0.5, w: 1, h: 1, depth: 0 }];
    const texts: TextLayer[] = [];
    let top = area.top;
    // The hook, in the first 3 s (on every scene that starts before then, while it has time to be read there).
    if (s.from < HOOK_SECONDS) {
      const to = Math.min(1, (HOOK_SECONDS - s.from) / seconds);
      if (i === 0 || to * seconds >= 1.2) {
        const l = fitted(hook, { x: cx, y: 0, w: W, size: size(0.07), aspect, maxLines: 2, color: PALETTE.text, box: { color: "rgba(0,0,0,0.45)", padding: 0.02, radius: 0.2 }, from: 0, to: round(to), animate: i === 0 ? "pop" : "none" });
        texts.push({ ...l, y: round(top + l.h / 2) });
        top += l.h + 0.015;
      }
    }
    // The price on the product shot.
    if (price && i === productAt) {
      const pTop = shorts ? Math.max(top, contact.top) : top;
      const l = fitted(words.price(price), { x: cx, y: 0, w: Math.min(W, 0.7), size: size(0.075), aspect, maxLines: 1, color: "#111111", box: { color: PALETTE.accent, padding: 0.02, radius: 0.3 }, from: 0.1, animate: "pop" });
      texts.push({ ...l, y: round(pTop + l.h / 2) });
    }
    // The number on every scene: a bar, or a small quiet line on a calm template's first shot.
    let bottom = contact.bottom;
    if (phone) {
      const quiet = luxury && i === 0;
      const l = quiet
        ? fitted(phone, { x: cx, y: 0, w: Math.min(W, 0.7), size: 0.03, aspect, maxLines: 1, font: "inter", weight: 600, color: "rgba(255,255,255,0.85)", animate: "none" })
        : fitted(words.phone(phone), { x: cx, y: 0, w: W, size: size(0.042), aspect, maxLines: 1, font: "inter", weight: 800, color: PALETTE.text, box: { color: "rgba(0,0,0,0.6)", padding: 0.015, radius: 0.5 }, animate: "none" });
      texts.push({ ...l, y: round(bottom - l.h / 2) });
      bottom -= l.h + 0.015;
    }
    // The call to action on the last shot.
    if (i === shots.length - 1) {
      const l = fitted(phone ? words.cta(true) : words.dm, { x: cx, y: 0, w: W, size: size(0.058), aspect, maxLines: 2, color: "#111111", box: { color: "#ffffff", padding: 0.02, radius: 0.3 }, from: 0.1, animate: "rise" });
      texts.push({ ...l, y: round(bottom - l.h / 2) });
    }
    layers.push(...texts.map((t) => inside(t, t.text === hook ? area : contact)));
    return { seconds, background: { kind: "solid", colors: ["#000000"] }, layers, transition: "cut", camera: { move: "static" } };
  });

  const { caption, hashtags } = seedanceOverlayCaption(b);
  return {
    version: 1,
    title: `${shortName(b.product.name)}: ${plan.templateName}`.slice(0, 80),
    ratio,
    fps: 30,
    palette: PALETTE,
    scenes,
    // The clip brings its own sound; music is the owner's choice in the studio.
    music: null,
    caption,
    hashtags,
    look: { grade: "none", grain: 0, vignette: 0, glow: 0, lightLeak: 0, letterbox: false },
  };
}

// ---- The post caption

const LOCAL_TAG = /kigali|rwanda|^rw|kgl|_250/i;
const PLACE = /\b(kigali|kicukiro|gasabo|nyarugenge|kimironko|remera|kacyiru|kiyovu|nyamirambo|kibagabaga|kabeza|kanombe|gikondo|nyarutarama|musanze|rubavu|huye)\b/i;
const DELIVERS = /\b(deliver(y|ies|ed)?)\b/i;
const tag = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");

/** Fills a Brain caption formula from the facts; a part that needs a fact the brief does not give is left out. */
function fillFormula(pattern: string, facts: Record<string, string | null>): string {
  const parts = pattern
    .replace(/#[{}\p{L}\p{N}_]+/gu, "")
    .split(/\n|\s+\|\s+|(?=\s(?:📍|📞|📲|🚚|✅|💰|🔹|🛏️|🕘|💆|👉|💬))/u)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const keys = [...part.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (keys.some((k) => !facts[k])) continue;
    out.push(part.replace(/\{(\w+)\}/g, (_, k: string) => facts[k] as string).replace(/\.{3}/g, "").trim());
  }
  return out.join("\n").replace(/[ \t]+/g, " ").trim();
}

/**
 * The post caption and hashtags: the Brain's formula for the sector and platform, filled with the brief's facts; when
 * that misses a check of scoreCaption (the product and price first, how to order, the number, the place, delivery,
 * Kinyarwanda, the length), BuPulse's own complete form is used instead. Returns the better one with its score.
 */
export function seedanceOverlayCaption(b: PromptBrief): { caption: string; hashtags: string[]; score: CaptionScore } {
  const lang = langOf(b.business.language);
  const platform = b.platform ?? null;
  const pick = brainFor(brainBriefFromPrompt(b, { platform, hasPhone: !!b.business.phone?.trim() }));
  const guide = BRAIN.captions.platforms.find((p) => p.platform === (pick.platform === "any" ? "tiktok" : pick.platform))!;
  const name = shortName(b.product.name);
  const phone = b.business.phone?.trim() ? localPhone(b.business.phone) : null;
  const price = b.product.price?.trim() && !/[(]/.test(b.product.price) ? b.product.price.trim() : null;
  const usp = b.product.usps?.find((u) => u.trim() && u.split(/\s+/).length <= 10)?.trim().replace(/[.!]+$/, "") ?? null;
  const area = [b.business.description, b.note].filter(Boolean).join(" ").match(PLACE)?.[0] ?? null;
  const delivers = DELIVERS.test([b.business.description, b.product.description, b.product.summary, ...(b.product.usps ?? []), ...(b.product.features ?? [])].filter(Boolean).join(" "));
  const shorts = pick.platform === "shorts";

  // Hashtags: the platform's count, a local one first, the business's own, no broad pile.
  const [lo, hi] = guide.hashtags.count;
  const local = guide.hashtags.local.map((t) => tag(t)).filter((t) => LOCAL_TAG.test(t) || t.toLowerCase() === "shorts");
  const want = Math.min(hi, Math.max(lo, shorts ? 2 : pick.platform === "facebook" ? 2 : 5));
  const hashtags = [...new Set([...local.slice(0, Math.max(1, want - 1)), tag(b.business.name)])].filter(Boolean).slice(0, want);
  while (hashtags.length < lo && local.length > hashtags.length) hashtags.push(local[hashtags.length]);

  const facts: Record<string, string | null> = { product: name, price, business: b.business.name.trim(), phone, claim: usp, area, city: area && /kigali/i.test(area) ? "Kigali" : null, emoji: "✨", offer: null, landmark: null, day: null, count: null, problem: null, result: null, old_price: null, sector: null };
  const formula = fillFormula(pick.caption.formula.pattern, facts);

  // BuPulse's own form, per language: product and price first, the claim, the place, delivery, how to order.
  const route = phone ? (lang === "rw" ? `📞 Duhamagare cyangwa utwandikire kuri WhatsApp: ${phone}` : lang === "fr" ? `📞 Appelez ou WhatsApp : ${phone}` : `📞 Call/WhatsApp: ${phone}`) : lang === "rw" ? "📩 Twandikire kuri DM" : lang === "fr" ? "📩 Commandez en DM" : "📩 DM to order";
  const first = price ? (lang === "rw" ? `🔥 ${name} kuri ${price} gusa` : lang === "fr" ? `🔥 ${name} à ${price}` : `🔥 ${name}, ${price}`) : `🔥 ${name}`;
  // A Short's title: under 100 characters, the product and price in the first 40, then place, delivery and the number.
  const own = shorts
    ? [price ? (lang === "rw" ? `${name} kuri ${price} gusa` : `${name} ${price}`) : name, area ?? "", delivers ? (lang === "rw" ? "Tubagezaho" : "Delivery") : "", phone ? `${lang === "rw" ? "Duhamagare" : "Call"} ${phone}` : lang === "rw" ? "Twandikire" : "DM to order"].filter(Boolean).join(" · ")
    : [first, usp ? `✅ ${usp}` : "", area ? `📍 ${area}` : "", delivers ? (lang === "rw" ? "🚚 Tubagezaho" : lang === "fr" ? "🚚 Livraison disponible (delivery)" : "🚚 Delivery available") : "", route].filter(Boolean).join("\n");

  const brief = { ...b, business: { ...b.business, phone: b.business.phone ?? null } };
  const options = { platform };
  const candidates = [formula, own].filter(Boolean).map((caption) => ({ caption, hashtags, score: scoreCaption(caption, hashtags, brief, options) }));
  return candidates.find((c) => c.score.failed.length === 0) ?? candidates.sort((x, y) => y.score.score - x.score.score)[0];
}

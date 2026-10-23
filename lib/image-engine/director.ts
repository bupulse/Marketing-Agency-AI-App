// The Director (docs/IMAGE_ENGINE.md): the first agent of the image engine. Plain code, no AI and no cost. For a batch
// it decides each picture's ad pattern, shot, light and layout, which product photo it starts from, and whether the
// Painter makes it on Pro or Lite. It reads the company's recent pictures (ImageConcept rows) and picks what was used
// least, so a batch never repeats itself and a company never gets the same idea twice in a row. Pure, so it is tested.
import { LAYOUTS, LIGHTS, PATTERNS, SHOTS, type Pattern, type Treatment } from "./patterns";

export type Tier = "lite" | "pro";
/**
 * Image credits per picture (owner decisions, 23 October 2026): Lite is Nano Banana 2 (about $0.067, it writes words
 * far better than Nano Banana) at 2 credits, Nano Banana Pro (about $0.134) at 4, so a credit is about $0.034.
 */
export const TIER_CREDITS: Record<Tier, number> = { lite: 2, pro: 4 };
/** Auto quality: the batch's first picture is Pro, then one in PRO_EVERY, while the credits allow. */
export const PRO_EVERY = 4;

export type Quality = "auto" | "pro" | "lite";
export type RecentConcept = { pattern: string; shot: string; light: string; layout: string };
export type Slot = { pattern: string; shot: string; light: string; layout: string; treatment: Treatment; photoIndex: number | null; tier: Tier };

/** A small stable hash (FNV-1a), for tie-breaks that are the same for the same seed. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** How much each value was used lately: the newest picture counts 1, older ones less (0.92 per picture back). */
function usage(recent: readonly RecentConcept[], key: keyof RecentConcept): Map<string, number> {
  const out = new Map<string, number>();
  recent.forEach((r, i) => out.set(r[key], (out.get(r[key]) ?? 0) + Math.pow(0.92, i)));
  return out;
}

/** The value used least (recently and in this batch so far); ties broken by the seed. */
function pick<T extends string>(values: readonly T[], used: Map<string, number>, batch: Map<string, number>, seed: string): T {
  const score = (v: T) => (batch.get(v) ?? 0) * 100 + (used.get(v) ?? 0);
  return [...values].sort((a, b) => score(a) - score(b) || hash(`${seed}:${a}`) - hash(`${seed}:${b}`))[0];
}

/** Which tiers a batch gets within its credits: fewer pictures when the credits do not reach one Lite picture each. */
export function chooseTiers(count: number, budget: number, quality: Quality): Tier[] {
  const n = Math.max(0, Math.min(Math.floor(count), Math.floor(budget / TIER_CREDITS.lite)));
  if (n === 0) return [];
  // Turning a Lite picture into a Pro one costs the difference.
  const upgrades = Math.floor((budget - n * TIER_CREDITS.lite) / (TIER_CREDITS.pro - TIER_CREDITS.lite));
  const wanted = quality === "lite" ? 0 : quality === "pro" ? n : 1 + Math.floor((n - 1) / PRO_EVERY);
  const pro = Math.max(0, Math.min(wanted, upgrades, n));
  return Array.from({ length: n }, (_, i): Tier => (i < pro ? "pro" : "lite"));
}

export const creditsOf = (tiers: readonly Tier[]) => tiers.reduce((sum, t) => sum + TIER_CREDITS[t], 0);

/**
 * The batch's slots, in order (the Pro pictures first). Patterns that need a fact the business lacks (real reviews, a
 * price) are left out; "New in the range" pictures are always allowed (owner decision, 23 October 2026).
 */
export function directBatch(input: {
  tiers: readonly Tier[];
  recent: readonly RecentConcept[];
  photoCount: number;
  facts: { reviews: boolean; price: boolean };
  seed: string;
  /** Patterns the brief asked for, tried first (e.g. "at-scale" and "product-line" for "large scale, new designs"). */
  prefer?: readonly string[];
}): Slot[] {
  const allowed = PATTERNS.filter((p) => !p.needs || (p.needs === "reviews" ? input.facts.reviews : input.facts.price));
  const used = {
    pattern: usage(input.recent, "pattern"),
    shot: usage(input.recent, "shot"),
    light: usage(input.recent, "light"),
    layout: usage(input.recent, "layout"),
  };
  const batch = { pattern: new Map<string, number>(), shot: new Map<string, number>(), light: new Map<string, number>(), layout: new Map<string, number>() };
  const bump = (m: Map<string, number>, v: string) => m.set(v, (m.get(v) ?? 0) + 1);
  const preferred = (input.prefer ?? []).filter((id) => allowed.some((p) => p.id === id));
  // Photos rotate from where the last pictures left off.
  const photoStart = input.photoCount > 0 ? hash(`${input.seed}:photo`) % input.photoCount : 0;

  return input.tiers.map((tier, i) => {
    const seed = `${input.seed}:${i}`;
    const next = preferred.find((id) => !batch.pattern.has(id));
    const pattern: Pattern = (next && allowed.find((p) => p.id === next)) || allowed.find((p) => p.id === pick(allowed.map((x) => x.id), used.pattern, batch.pattern, seed))!;
    // A product-only picture has no one to shoot over the shoulder of or to portrait.
    const shot = pick(pattern.people === "no" ? SHOTS.filter((s) => s !== "over-the-shoulder" && s !== "eye-level portrait") : SHOTS, used.shot, batch.shot, seed);
    const light = pick(LIGHTS, used.light, batch.light, seed);
    const layout = pick(LAYOUTS, used.layout, batch.layout, seed);
    bump(batch.pattern, pattern.id);
    bump(batch.shot, shot);
    bump(batch.light, light);
    bump(batch.layout, layout);
    return { pattern: pattern.id, shot, light, layout, treatment: pattern.treatment, photoIndex: input.photoCount > 0 ? (photoStart + i) % input.photoCount : null, tier };
  });
}

/** Patterns a brief asks for, from its words ("large scale", "new designs", "before and after", "how it works"…). */
export function patternsFromBrief(brief: string | null | undefined): string[] {
  const b = (brief ?? "").toLowerCase();
  const out: string[] = [];
  const add = (re: RegExp, id: string) => re.test(b) && !out.includes(id) && out.push(id);
  add(/\b(large|big|commercial|whole farm|industrial|at scale|scale)\b/, "at-scale");
  add(/\b(different (products?|designs?)|new (products?|designs?|models?|versions?)|variants?|range|similar)\b/, "product-line");
  add(/\b(before|after)\b/, "before-after");
  add(/\b(how it works|steps|explain)\b/, "how-it-works");
  add(/\b(happy|smil\w*|result|yield|harvest|enjoy\w*)\b/, "outcome");
  add(/\b(team|staff|behind)\b/, "behind-scenes");
  add(/\b(offer|discount|promo\w*|sale|price)\b/, "offer");
  add(/\b(vs|versus|old way|compare\w*)\b/, "old-vs-new");
  return out;
}

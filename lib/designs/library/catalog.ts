// The design library's catalogue (docs/DESIGNS.md, "Design library"): every style x layout family x variant, with
// what each design fits, and the chooser the art director uses. Client-safe and pure: no rendering code, so the admin
// gallery, the art director and the tests share it. The drawing is lib/designs/library/render.tsx.
import { ASPECT_RATIOS, type AspectRatio } from "@/lib/designs/layout";
import { PACKS, type PackId } from "@/lib/designs/packs";
import { STYLES } from "./styles";

/** What a slide is about; the art director's template and the slide's place in a carousel decide it. */
export const ANGLES = ["general", "new", "price", "offer", "event", "listing", "showcase", "news", "announcement", "tips", "how-it-works", "quote", "testimonial", "feature"] as const;
export type Angle = (typeof ANGLES)[number];

export function isAngle(value: unknown): value is Angle {
  return typeof value === "string" && (ANGLES as readonly string[]).includes(value);
}

export type FamilyId =
  | "hero"
  | "split"
  | "polaroid"
  | "circle"
  | "diagonal"
  | "magazine"
  | "price"
  | "steps"
  | "quote"
  | "testimonial"
  | "features"
  | "poster"
  | "banner"
  | "minimal";

/** Whether a family draws the photo: always (needs one), when there is one (else brand art), or never (text design). */
export type PhotoUse = "required" | "optional" | "none";

export type FamilyInfo = {
  id: FamilyId;
  name: string;
  description: string;
  fits: Angle[];
  photo: PhotoUse;
  /** Headline plus subline characters the layout holds comfortably at its smallest type. */
  capacity: number;
  aspects: readonly AspectRatio[];
};

export const FAMILIES: FamilyInfo[] = [
  { id: "hero", name: "Photo hero", description: "Full-bleed photo with a text panel.", fits: ["new", "showcase", "listing", "offer", "news", "general"], photo: "required", capacity: 150, aspects: ASPECT_RATIOS },
  { id: "split", name: "Split", description: "Photo on one side, message on the other.", fits: ["new", "feature", "listing", "showcase", "news", "how-it-works", "general"], photo: "optional", capacity: 190, aspects: ASPECT_RATIOS },
  { id: "polaroid", name: "Framed photo", description: "A framed or polaroid photo on a patterned ground.", fits: ["showcase", "new", "testimonial", "event", "general"], photo: "required", capacity: 120, aspects: ASPECT_RATIOS },
  { id: "circle", name: "Round crop", description: "Photo in a circle or arch beside large type.", fits: ["new", "feature", "testimonial", "offer", "general"], photo: "optional", capacity: 150, aspects: ASPECT_RATIOS },
  { id: "diagonal", name: "Diagonal band", description: "A slanted brand band across the photo or colour.", fits: ["offer", "price", "announcement", "new", "event"], photo: "optional", capacity: 120, aspects: ASPECT_RATIOS },
  { id: "magazine", name: "Magazine cover", description: "Masthead, cover photo and cover lines.", fits: ["news", "new", "showcase", "feature", "general"], photo: "required", capacity: 150, aspects: ASPECT_RATIOS },
  { id: "price", name: "Price tag", description: "The price or deal as the hero, with the product beside it.", fits: ["price", "offer", "new", "listing"], photo: "optional", capacity: 110, aspects: ASPECT_RATIOS },
  { id: "steps", name: "Step card", description: "A numbered step or tip with room to explain it.", fits: ["how-it-works", "tips"], photo: "none", capacity: 210, aspects: ASPECT_RATIOS },
  { id: "quote", name: "Quote card", description: "A saying or tip in large type.", fits: ["quote", "tips", "general"], photo: "none", capacity: 200, aspects: ASPECT_RATIOS },
  { id: "testimonial", name: "Testimonial", description: "A customer's words with stars and an optional portrait.", fits: ["testimonial", "quote"], photo: "optional", capacity: 200, aspects: ASPECT_RATIOS },
  { id: "features", name: "Feature grid", description: "A headline and up to four short features as tiles.", fits: ["feature", "how-it-works", "tips", "new", "listing"], photo: "optional", capacity: 200, aspects: ASPECT_RATIOS },
  { id: "poster", name: "Event poster", description: "A poster with a big date block and the details.", fits: ["event", "announcement", "offer"], photo: "optional", capacity: 150, aspects: ASPECT_RATIOS },
  { id: "banner", name: "Announcement banner", description: "A loud banner message on the brand colours.", fits: ["announcement", "news", "offer", "event"], photo: "optional", capacity: 130, aspects: ASPECT_RATIOS },
  { id: "minimal", name: "Minimal", description: "Small, quiet type with one accent and space around it.", fits: ["general", "quote", "news", "announcement", "tips"], photo: "optional", capacity: 170, aspects: ASPECT_RATIOS },
];

const FAMILY_BY_ID = new Map(FAMILIES.map((f) => [f.id, f]));

export function familyOf(id: FamilyId): FamilyInfo {
  return FAMILY_BY_ID.get(id)!;
}

// ---- variants ----

/** Main surface tone; text colour is chosen against it by contrast. */
export type Tone = "paper" | "brand" | "night" | "tint";
export type Shape = "rect" | "round" | "arch" | "circle" | "slant";
export type Accent = "bar" | "dot" | "underline" | "corner" | "frame" | "none";
export type Scale = "s" | "m" | "l";

/** The knobs that make a family's variants differ. `motif` indexes the style's motifs; -1 is none. */
export type Knobs = { tone: Tone; motif: number; flip: boolean; shape: Shape; accent: Accent; scale: Scale; center: boolean };

// The values each family may take, chosen so every combination looks good. Order matters: variant 1 takes the first.
type KnobSpace = { tone: Tone[]; motif: number[]; flip: boolean[]; shape: Shape[]; accent: Accent[]; scale: Scale[]; center: boolean[] };

const ALL_MOTIFS = [0, 1, 2, -1];
const SPACES: Record<FamilyId, KnobSpace> = {
  hero: { tone: ["paper", "brand", "night"], motif: [-1, 0], flip: [false, true], shape: ["rect", "round", "slant"], accent: ["bar", "corner", "underline", "none"], scale: ["m", "l", "s"], center: [false, true] },
  split: { tone: ["paper", "brand", "night", "tint"], motif: ALL_MOTIFS, flip: [false, true], shape: ["rect", "arch", "round"], accent: ["bar", "underline", "dot"], scale: ["m", "l", "s"], center: [false] },
  polaroid: { tone: ["tint", "paper", "brand", "night"], motif: [0, 1, 2], flip: [false, true], shape: ["rect", "round"], accent: ["frame", "corner", "none"], scale: ["m", "s", "l"], center: [true, false] },
  circle: { tone: ["paper", "brand", "tint", "night"], motif: [0, -1, 1], flip: [false, true], shape: ["circle", "arch"], accent: ["dot", "underline", "bar"], scale: ["m", "l", "s"], center: [false, true] },
  diagonal: { tone: ["brand", "night", "paper"], motif: [-1, 0, 1], flip: [false, true], shape: ["slant", "rect"], accent: ["bar", "none", "dot"], scale: ["l", "m"], center: [false] },
  magazine: { tone: ["paper", "night", "brand"], motif: [-1], flip: [false, true], shape: ["rect"], accent: ["bar", "underline", "corner", "dot"], scale: ["l", "m"], center: [false, true] },
  price: { tone: ["brand", "paper", "night", "tint"], motif: [-1, 0, 1, 2], flip: [false, true], shape: ["round", "circle", "rect"], accent: ["dot", "bar", "none"], scale: ["l", "m"], center: [false, true] },
  steps: { tone: ["paper", "brand", "tint", "night"], motif: ALL_MOTIFS, flip: [false, true], shape: ["circle", "rect", "round"], accent: ["underline", "bar", "corner"], scale: ["m", "l", "s"], center: [false, true] },
  quote: { tone: ["brand", "paper", "night", "tint"], motif: [-1, 0, 1, 2], flip: [false, true], shape: ["rect"], accent: ["bar", "none", "underline", "frame"], scale: ["m", "l", "s"], center: [true, false] },
  testimonial: { tone: ["paper", "tint", "brand", "night"], motif: [-1, 0, 1], flip: [false, true], shape: ["circle", "round"], accent: ["frame", "none", "bar"], scale: ["m", "s", "l"], center: [true, false] },
  features: { tone: ["paper", "night", "tint", "brand"], motif: [-1, 0, 1], flip: [false, true], shape: ["round", "rect", "circle"], accent: ["dot", "bar", "none", "underline"], scale: ["m", "s"], center: [false, true] },
  poster: { tone: ["night", "brand", "paper", "tint"], motif: [0, 1, 2, -1], flip: [false, true], shape: ["rect", "arch", "round"], accent: ["frame", "bar", "corner"], scale: ["l", "m"], center: [true, false] },
  banner: { tone: ["brand", "night", "tint", "paper"], motif: [0, 1, -1, 2], flip: [false, true], shape: ["rect", "slant"], accent: ["underline", "bar", "dot", "none"], scale: ["l", "m"], center: [true, false] },
  minimal: { tone: ["paper", "night", "tint", "brand"], motif: [-1, 0], flip: [false, true], shape: ["rect", "round", "circle"], accent: ["dot", "underline", "none", "bar"], scale: ["s", "m"], center: [false, true] },
};

/** Variants per family and style: 14 families x 7 = 98 designs per style. */
export const VARIANTS_PER_FAMILY = 7;

export type DesignInfo = {
  /** Deterministic id: `<style>/<family>-<nn>`, nn from 01. */
  id: string;
  style: PackId;
  family: FamilyId;
  variant: number;
  knobs: Knobs;
  fits: Angle[];
  needsPhoto: boolean;
  usesPhoto: boolean;
  capacity: number;
  aspects: readonly AspectRatio[];
};

/** A small stable string hash (FNV-1a), for deterministic offsets and tie-breaks. */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const KNOB_KEYS: (keyof Knobs)[] = ["tone", "motif", "flip", "shape", "accent", "scale", "center"];

function distance(a: Knobs, b: Knobs): number {
  return KNOB_KEYS.filter((k) => a[k] !== b[k]).length;
}

/**
 * The family's variants in a style. The first takes each knob's first (safest) value, in the style's favourite tone;
 * each next one is the combination furthest from all chosen so far (most knobs different), ties broken by a per-style
 * hash, so the seven look as different as the family allows and neighbours always differ in several knobs. A motif
 * the style does not have is no motif.
 */
function variantsOf(style: PackId, family: FamilyId): Knobs[] {
  const order = STYLES[style].tones;
  const base0 = SPACES[family];
  // The style's favourite tones come first, so a luxe family opens dark and a fresh one on a light tint.
  const space = { ...base0, tone: [...base0.tone].sort((a, b) => order.indexOf(a) - order.indexOf(b)) };
  const motifs = STYLES[style].motifs.length;
  const motifValues = [...new Set(space.motif.map((m) => (m >= 0 && m < motifs ? m : -1)))];
  const all: Knobs[] = [];
  for (const tone of space.tone)
    for (const motif of motifValues)
      for (const flip of space.flip)
        for (const shape of space.shape)
          for (const accent of space.accent)
            for (const scale of space.scale)
              for (const center of space.center) all.push({ tone, motif, flip, shape, accent, scale, center });
  const chosen: Knobs[] = [all[0]];
  const tie = (k: Knobs) => hash(`${style}/${family}/${JSON.stringify(k)}`);
  while (chosen.length < VARIANTS_PER_FAMILY && chosen.length < all.length) {
    let best: Knobs | null = null;
    let bestScore = -1;
    for (const candidate of all) {
      if (chosen.includes(candidate)) continue;
      // Far from everything chosen, and especially from the previous variant (its neighbour in the gallery).
      const score = Math.min(...chosen.map((c) => distance(c, candidate))) * 10 + distance(chosen[chosen.length - 1], candidate);
      if (score > bestScore || (score === bestScore && best && tie(candidate) < tie(best))) {
        best = candidate;
        bestScore = score;
      }
    }
    chosen.push(best!);
  }
  return chosen;
}

function buildCatalog(): DesignInfo[] {
  const out: DesignInfo[] = [];
  for (const { id: style } of PACKS) {
    for (const family of FAMILIES) {
      variantsOf(style, family.id).forEach((knobs, i) => {
        out.push({
          id: `${style}/${family.id}-${String(i + 1).padStart(2, "0")}`,
          style,
          family: family.id,
          variant: i + 1,
          knobs,
          fits: family.fits,
          needsPhoto: family.photo === "required",
          usesPhoto: family.photo !== "none",
          capacity: Math.round(family.capacity * (knobs.scale === "l" ? 0.8 : knobs.scale === "s" ? 1.15 : 1)),
          aspects: family.aspects,
        });
      });
    }
  }
  return out;
}

/** Every design, style by style, family by family. */
export const DESIGNS: DesignInfo[] = buildCatalog();
const DESIGN_BY_ID = new Map(DESIGNS.map((d) => [d.id, d]));

export function isDesignId(value: unknown): value is string {
  return typeof value === "string" && DESIGN_BY_ID.has(value);
}

export function getDesign(id: string): DesignInfo | null {
  return DESIGN_BY_ID.get(id) ?? null;
}

export function designsOf(style: PackId): DesignInfo[] {
  return DESIGNS.filter((d) => d.style === style);
}

/** Designs per style, for the docs and the admin gallery. */
export function designCounts(): Record<PackId, number> {
  const counts = Object.fromEntries(PACKS.map((p) => [p.id, 0])) as Record<PackId, number>;
  for (const d of DESIGNS) counts[d.style] += 1;
  return counts;
}

// ---- choosing ----

export type ChooseDesignInput = {
  /** The business's style; any style when missing. */
  style?: PackId | null;
  angle: Angle;
  aspect: AspectRatio;
  hasPhoto: boolean;
  /** Characters of headline plus subline. */
  textLength: number;
  /** The business's recently used design ids, newest first: never repeated while others fit. */
  recent: readonly string[];
  /** Spreads ties so two posts on the same day get different designs (the content or slide id). */
  seed?: string;
};

/**
 * The design for a slide, chosen by BuPulse (the owner never picks): one that suits the angle, the aspect, the photo
 * situation and the text length, and that the business has not used recently. Families used recently score lower, so
 * consecutive posts change layout, not only colour. Deterministic for the same input.
 */
export function chooseDesign(input: ChooseDesignInput): string {
  const recent = new Set(input.recent);
  const recentFamilies = input.recent.slice(0, 6).map((id) => getDesign(id)?.family).filter(Boolean) as FamilyId[];
  const pool = DESIGNS.filter((d) => (!input.style || d.style === input.style) && d.aspects.includes(input.aspect) && (input.hasPhoto || !d.needsPhoto));
  const scored = pool.map((d) => {
    let score = 0;
    const fit = d.fits.indexOf(input.angle);
    if (fit >= 0) score += 40 - fit * 4;
    else if (d.fits.includes("general")) score += 6;
    else score -= 30;
    // A photo should be shown when there is one; a text design is better without.
    if (input.hasPhoto) score += d.usesPhoto ? 12 : -18;
    else score += d.usesPhoto ? -4 : 6;
    if (input.textLength > d.capacity) score -= 25 + (input.textLength - d.capacity) / 4;
    if (recent.has(d.id)) score -= 100;
    const lastUse = recentFamilies.indexOf(d.family);
    if (lastUse >= 0) score -= 16 - lastUse * 2;
    return { d, score, tie: hash(`${input.seed ?? ""}|${d.id}`) };
  });
  scored.sort((a, b) => b.score - a.score || a.tie - b.tie);
  return (scored[0]?.d ?? DESIGNS[0]).id;
}

/** A design of the same style and family nearest to `id` that draws without a photo (a photo failed to load). */
export function designWithoutPhoto(id: string, angle: Angle = "general"): string {
  const d = getDesign(id);
  if (!d || !d.needsPhoto) return id;
  return chooseDesign({ style: d.style, angle: d.fits.includes(angle) ? angle : d.fits[0], aspect: "1:1", hasPhoto: false, textLength: 0, recent: [], seed: id });
}

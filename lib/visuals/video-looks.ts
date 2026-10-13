// Video looks (docs/DESIGNS.md, "Video looks"): how a content video is laid out, moves and is captioned, per style.
// Data only, built compositionally from the style tokens (lib/designs/library/styles.ts) x look families x knobs, and
// read by the browser renderer (components/visuals/video-renderer.ts), which the video robot runs too. Client-safe and
// pure, so it is unit tested. The art director picks a look with chooseVideoLook; the owner never picks.
import { contrastRatio, readableTextColor } from "@/lib/color-contrast";
import { STYLES, type Motif } from "@/lib/designs/library/styles";
import { PACKS, type PackId } from "@/lib/designs/packs";
import type { Motion, VideoPlan } from "./types";

/** How one scene is laid out. "price" and "outro" are chosen per scene (a price in the text, the closing scene). */
export type VideoLayout = "lower-third" | "kinetic" | "framed" | "split" | "card" | "steps" | "quote" | "price" | "outro";
export type VideoTransition = "crossfade" | "slide" | "zoom" | "wipe";
export type CaptionBox = "none" | "bar" | "pill" | "block" | "underline";
export type VideoAngle = "promo" | "tips" | "story" | "testimonial" | "event" | "announcement";
export type LookFamily = "cinematic" | "kinetic" | "framed" | "split" | "card" | "steps" | "quote" | "editorial";
/** Canvas-drawable backdrop patterns for scenes without a photo. */
export type VideoMotif = "dots" | "stripes" | "rings" | "waves" | "grid" | "sunburst" | "zigzag" | "confetti" | "leaves" | "plus" | "checker" | "triangles" | "marks" | "lines" | "blobs";

export interface VideoLook {
  id: string;
  style: PackId;
  family: LookFamily;
  name: string;
  layouts: { hook: VideoLayout; body: VideoLayout };
  transition: { kind: VideoTransition; ms: number };
  caption: { position: "top" | "middle" | "lower"; box: CaptionBox; align: "left" | "center"; upper: boolean; scale: number; accent: "bar" | "dot" | "none" };
  motion: { zoom: number; sequence: Motion[] };
  palette: { background: "deep" | "primary" | "paper" | "night"; accent: "primary" | "highlight" | "metal" };
  motif: VideoMotif;
  fits: VideoAngle[];
  /** Looks built around photos; without any they are skipped by the chooser. */
  needsPhoto: boolean;
}

const FAMILIES: Record<LookFamily, { hook: VideoLayout; body: VideoLayout; fits: VideoAngle[]; needsPhoto: boolean }> = {
  cinematic: { hook: "lower-third", body: "lower-third", fits: ["promo", "story", "announcement"], needsPhoto: true },
  kinetic: { hook: "kinetic", body: "lower-third", fits: ["announcement", "promo", "event"], needsPhoto: false },
  framed: { hook: "framed", body: "framed", fits: ["story", "promo", "testimonial"], needsPhoto: true },
  split: { hook: "split", body: "split", fits: ["promo", "event", "story"], needsPhoto: true },
  card: { hook: "lower-third", body: "card", fits: ["promo", "tips", "announcement"], needsPhoto: true },
  steps: { hook: "kinetic", body: "steps", fits: ["tips"], needsPhoto: false },
  quote: { hook: "kinetic", body: "quote", fits: ["testimonial", "story"], needsPhoto: false },
  editorial: { hook: "split", body: "card", fits: ["story", "event", "promo"], needsPhoto: true },
};
const FAMILY_ORDER: LookFamily[] = ["cinematic", "kinetic", "framed", "split", "card", "steps", "quote", "editorial"];

const MOTIF_MAP: Record<Motif, VideoMotif> = {
  grid: "grid",
  dots: "dots",
  diagonal: "stripes",
  zigzag: "zigzag",
  waves: "waves",
  rings: "rings",
  confetti: "confetti",
  arches: "rings",
  leaves: "leaves",
  sunburst: "sunburst",
  mudcloth: "marks",
  triangles: "triangles",
  chevrons: "zigzag",
  hairlines: "lines",
  plus: "plus",
  deco: "sunburst",
  blobs: "blobs",
  checker: "checker",
};

// Per style: the transitions, caption boxes and backgrounds that suit it, and how slowly it moves.
type StyleMotion = { transitions: VideoTransition[]; ms: number; boxes: CaptionBox[]; backgrounds: VideoLook["palette"]["background"][]; zooms: number[]; align: "left" | "center" };
const STYLE_MOTION: Record<PackId, StyleMotion> = {
  clean: { transitions: ["crossfade", "slide", "wipe"], ms: 500, boxes: ["none", "bar", "block"], backgrounds: ["deep", "primary"], zooms: [1.1, 1.14], align: "left" },
  elegant: { transitions: ["crossfade", "zoom"], ms: 700, boxes: ["none", "underline"], backgrounds: ["deep", "paper"], zooms: [1.06, 1.1], align: "center" },
  bold: { transitions: ["slide", "wipe", "zoom"], ms: 350, boxes: ["block", "bar"], backgrounds: ["night", "primary"], zooms: [1.16, 1.2], align: "left" },
  warm: { transitions: ["crossfade", "slide", "zoom"], ms: 550, boxes: ["pill", "none"], backgrounds: ["deep", "paper", "primary"], zooms: [1.08, 1.12], align: "center" },
  playful: { transitions: ["slide", "zoom", "wipe"], ms: 400, boxes: ["pill", "block"], backgrounds: ["primary", "paper"], zooms: [1.12, 1.18], align: "center" },
  minimal: { transitions: ["crossfade", "wipe"], ms: 650, boxes: ["none", "underline"], backgrounds: ["paper", "night"], zooms: [1.06, 1.08], align: "left" },
  luxe: { transitions: ["crossfade", "zoom"], ms: 750, boxes: ["none", "underline", "bar"], backgrounds: ["night", "deep"], zooms: [1.06, 1.1], align: "center" },
  vibrant: { transitions: ["slide", "wipe", "zoom"], ms: 400, boxes: ["block", "pill"], backgrounds: ["primary", "deep"], zooms: [1.14, 1.2], align: "center" },
  earthy: { transitions: ["crossfade", "slide"], ms: 600, boxes: ["block", "none", "underline"], backgrounds: ["night", "paper", "deep"], zooms: [1.08, 1.12], align: "left" },
  corporate: { transitions: ["wipe", "slide", "crossfade"], ms: 450, boxes: ["bar", "block", "none"], backgrounds: ["night", "deep"], zooms: [1.08, 1.12], align: "left" },
  fresh: { transitions: ["crossfade", "slide", "zoom"], ms: 550, boxes: ["pill", "none"], backgrounds: ["paper", "deep", "primary"], zooms: [1.08, 1.14], align: "center" },
  retro: { transitions: ["wipe", "slide", "crossfade"], ms: 450, boxes: ["block", "pill"], backgrounds: ["night", "paper", "primary"], zooms: [1.1, 1.16], align: "center" },
};

const SEQUENCES: Motion[][] = [
  ["zoom-in", "pan-right", "zoom-out", "pan-left"],
  ["pan-left", "zoom-in", "pan-right", "zoom-out"],
  ["zoom-out", "zoom-in", "pan-left", "pan-right"],
];
const POSITIONS: VideoLook["caption"]["position"][] = ["lower", "middle", "lower", "top"];
const ACCENTS: VideoLook["caption"]["accent"][] = ["bar", "none", "dot"];
const LOOKS_PER_STYLE = 12;

function buildLooks(style: PackId, styleIndex: number): VideoLook[] {
  const tokens = STYLES[style];
  const m = STYLE_MOTION[style];
  const motifs = tokens.motifs.map((t) => MOTIF_MAP[t]);
  const out: VideoLook[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < LOOKS_PER_STYLE && i < LOOKS_PER_STYLE * 4; i++) {
    // Neighbours always differ in family (stride 1) and mostly in transition, box and background (other strides).
    const family = FAMILY_ORDER[(i + styleIndex) % FAMILY_ORDER.length];
    const f = FAMILIES[family];
    const round = Math.floor(i / FAMILY_ORDER.length);
    const transition = m.transitions[(i + round) % m.transitions.length];
    const box = m.boxes[(i * 2 + round + styleIndex) % m.boxes.length];
    const background = m.backgrounds[(i + 2 * round) % m.backgrounds.length];
    const look: VideoLook = {
      id: `${style}/v-${String(out.length + 1).padStart(2, "0")}`,
      style,
      family,
      name: `${PACKS.find((p) => p.id === style)?.name ?? style} ${family} ${out.length + 1}`,
      layouts: { hook: f.hook, body: f.body },
      transition: { kind: transition, ms: m.ms },
      caption: {
        position: f.body === "lower-third" ? POSITIONS[(i + round) % POSITIONS.length] : "lower",
        box,
        align: family === "kinetic" || family === "quote" ? "center" : m.align,
        upper: tokens.video.upper,
        scale: [1, 1.1, 0.92][(i + round) % 3],
        accent: ACCENTS[(i + styleIndex) % ACCENTS.length],
      },
      motion: { zoom: m.zooms[(i + round) % m.zooms.length], sequence: SEQUENCES[(i + round) % SEQUENCES.length] },
      palette: { background, accent: tokens.metal ? "metal" : (i + round) % 3 === 2 ? "highlight" : "primary" },
      motif: motifs[(i + round) % motifs.length] ?? "dots",
      fits: f.fits,
      needsPhoto: f.needsPhoto,
    };
    const key = JSON.stringify({ ...look, id: "", name: "" });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(look);
  }
  return out;
}

export const VIDEO_LOOKS: VideoLook[] = PACKS.flatMap((p, i) => buildLooks(p.id, i));
const BY_ID = new Map(VIDEO_LOOKS.map((l) => [l.id, l]));

export function isVideoLookId(value: unknown): value is string {
  return typeof value === "string" && BY_ID.has(value);
}

export function getVideoLook(id: string | null | undefined): VideoLook | null {
  return (id && BY_ID.get(id)) || null;
}

/** Number of looks per style. */
export function videoLookCounts(): Record<PackId, number> {
  return Object.fromEntries(PACKS.map((p) => [p.id, VIDEO_LOOKS.filter((l) => l.style === p.id).length])) as Record<PackId, number>;
}

/** FNV-1a: a small stable hash for deterministic tie-breaks. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface ChooseVideoLookInput {
  style?: PackId | null;
  angle?: VideoAngle | null;
  hasPhoto: boolean;
  /** Scenes in the video; steps looks want at least two body scenes. */
  sceneCount?: number;
  /** Look ids the business used recently, newest first. */
  recent: readonly string[];
  /** Makes the choice vary between contents while staying reproducible (the content or group id). */
  seed?: string;
}

/**
 * The look for a video: one of the style's looks that fits the angle and the photos, avoiding the business's recent
 * looks and the family of the newest one. Deterministic for the same input.
 */
export function chooseVideoLook(input: ChooseVideoLookInput): string {
  const pool = VIDEO_LOOKS.filter((l) => !input.style || l.style === input.style);
  const usable = pool.filter((l) => input.hasPhoto || !l.needsPhoto);
  const candidates = usable.length ? usable : pool.length ? pool : VIDEO_LOOKS;
  const recent = new Set(input.recent);
  const newestFamily = getVideoLook(input.recent[0])?.family;
  const recentFamilies = new Set(input.recent.map((r) => getVideoLook(r)?.family).filter(Boolean));
  const seed = input.seed ?? "";
  let best: VideoLook = candidates[0];
  let bestScore = -Infinity;
  for (const look of candidates) {
    let score = 0;
    if (input.angle && look.fits.includes(input.angle)) score += 3;
    if (input.angle && look.fits[0] === input.angle) score += 1;
    if (recent.has(look.id)) score -= 10;
    if (look.family === newestFamily) score -= 2;
    else if (recentFamilies.has(look.family)) score -= 1;
    if (look.family === "steps" && (input.sceneCount ?? 0) < 4) score -= 2;
    if (input.hasPhoto && look.needsPhoto) score += 0.5;
    // Tie-break: a stable fraction from the seed and the look.
    score += (hashString(`${seed}|${look.id}`) % 1000) / 2000;
    if (score > bestScore) {
      bestScore = score;
      best = look;
    }
  }
  return best.id;
}

// ---- per-scene layout and colours ----

const PRICE = /(?:[$€£₦]|\b(?:RWF|FRW|KES|KSH|UGX|TZS|USD|EUR|GHS|NGN|ZAR)\b)\s?\d(?:[\d,.\s]*\d)?|\d[\d,.]*\s?(?:k\b|K\b)?\s?(?:\b(?:RWF|FRW|KES|KSH|UGX|TZS|USD|EUR|GHS|NGN|ZAR)\b|%)/;

/** The price, discount or amount a caption states ("RWF 15,000", "20%", "$9"), or null. */
export function priceIn(text: string): string | null {
  const m = PRICE.exec(text);
  return m ? m[0].trim() : null;
}

/** The layout of scene `index`: the closing scene is the outro, a body scene stating a price is a price card. */
export function sceneLayout(look: VideoLook, scene: Pick<VideoPlan["scenes"][number], "role" | "text">): VideoLayout {
  if (scene.role === "cta") return "outro";
  if (scene.role === "hook") return look.layouts.hook;
  if (priceIn(scene.text)) return "price";
  return look.layouts.body;
}

/** White or near-black text on `background`; pure black where near-black misses WCAG AA (mid greys). */
export function readableOn(background: string): string {
  const text = readableTextColor(background);
  return contrastRatio(text, background) >= 4.5 ? text : "#000000";
}

export type LookColors = {
  background: string;
  onBackground: string;
  accent: string;
  onAccent: string;
  paper: string;
  onPaper: string;
};

/** The look's colours from the plan's brand colours, every text colour readable (WCAG) on its surface. */
export function lookColors(look: VideoLook, colors: VideoPlan["colors"]): LookColors {
  const tokens = STYLES[look.style];
  const primary = colors.accent;
  const highlight = colors.highlight ?? colors.accent;
  const background =
    look.palette.background === "paper" ? tokens.paper : look.palette.background === "night" ? (tokens.night ?? colors.background) : look.palette.background === "primary" ? primary : colors.background;
  let accent = look.palette.accent === "metal" ? (tokens.metal ?? primary) : look.palette.accent === "highlight" ? highlight : primary;
  // An accent that disappears into the background is swapped for the other brand colour, else the text colour.
  if (contrastRatio(accent, background) < 1.6) {
    const other = accent === primary ? highlight : primary;
    accent = contrastRatio(other, background) >= 1.6 ? other : readableOn(background);
  }
  return {
    background,
    onBackground: readableOn(background),
    accent,
    onAccent: readableOn(accent),
    paper: tokens.paper,
    onPaper: readableOn(tokens.paper),
  };
}

/**
 * How a scene's caption is painted: its text colour, the solid box behind it (or null) and whether a dark scrim is
 * laid over the photo first. Text is always on a solid colour it contrasts with, or white on a scrim over a photo.
 */
export function captionPaint(look: VideoLook, layout: VideoLayout, colors: VideoPlan["colors"], hasPhoto: boolean): { text: string; box: string | null; scrim: boolean } {
  const c = lookColors(look, colors);
  if (layout === "card" || layout === "steps") return { text: c.onPaper, box: c.paper, scrim: false };
  const boxed = layout === "lower-third" || layout === "framed" || layout === "split" || layout === "price";
  const box = !boxed ? null : look.caption.box === "block" ? c.accent : look.caption.box === "pill" ? c.paper : look.caption.box === "bar" ? c.background : null;
  if (box) return { text: readableOn(box), box, scrim: false };
  if ((layout === "lower-third" || layout === "price") && hasPhoto) return { text: "#FFFFFF", box: null, scrim: true };
  // Split panels, framed, kinetic (its photo is veiled in the background colour), quote and outro scenes sit on the
  // look's background.
  return { text: c.onBackground, box: null, scrim: false };
}

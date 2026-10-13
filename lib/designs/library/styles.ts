// Style tokens of the design library (docs/DESIGNS.md, "Design library"): what makes a style look like itself, shared
// by the image layouts (Satori) and the video looks (canvas). Client-safe data only.
import type { PackId } from "@/lib/designs/packs";

/** Decorative patterns drawn from the brand colours (lib/designs/library/motifs.ts). */
export type Motif =
  | "grid"
  | "dots"
  | "diagonal"
  | "zigzag"
  | "waves"
  | "rings"
  | "confetti"
  | "arches"
  | "leaves"
  | "sunburst"
  | "mudcloth"
  | "triangles"
  | "chevrons"
  | "hairlines"
  | "plus"
  | "deco"
  | "blobs"
  | "checker";

export type StyleTokens = {
  id: PackId;
  /** Display font for headlines (Satori name; loaded by lib/designs/templates/fonts.ts). Inter is the body font. */
  font: { family: string; weight: 400 | 500 | 700 | 800; charWidth: number; upper: boolean; tracking: number; lineHeight: number };
  /** Inter weight for sublines and small text. */
  bodyWeight: 500 | 800;
  /** Light surface and the text on it. */
  paper: string;
  ink: string;
  /** A fixed dark surface; null uses the brand's deep tone. */
  night: string | null;
  /** A metal accent (luxe gold) used for rules and frames instead of the brand accent. */
  metal: string | null;
  /** Corner radius for panels and photos, at a 1080px short side. */
  radius: number;
  /** Rule and frame weight. */
  stroke: number;
  shadow: "none" | "soft" | "hard";
  motifs: Motif[];
  kicker: "rule" | "pill" | "caps" | "tag";
  chip: "pill" | "block" | "circle" | "tag" | "stamp";
  /** Degrees stickers and chips may tilt (0 for none). */
  tilt: number;
  /** A hue the brand colours lean toward (earthy terracotta, fresh green); null keeps the brand as it is. */
  lean: { toward: string; amount: number } | null;
  /** Surface tones this style leans on, most typical first: a family's variants take its tones in this order. */
  tones: ("paper" | "brand" | "night" | "tint")[];
  /** Caption font for videos (self-hosted in public/fonts/video). */
  video: { family: string; css: string; slug: string; weights: number[]; weight: number; upper: boolean };
};

const INTER_VIDEO = { family: "Inter", css: "Inter, system-ui, sans-serif", slug: "inter", weights: [800, 600], weight: 800, upper: false };
const PLAYFAIR_VIDEO = { family: "Playfair Display", css: '"Playfair Display", Georgia, serif', slug: "playfair-display", weights: [700, 600], weight: 700, upper: false };
const NUNITO_VIDEO = { family: "Nunito", css: 'Nunito, "Trebuchet MS", system-ui, sans-serif', slug: "nunito", weights: [800, 600], weight: 800, upper: false };
const DM_SERIF_VIDEO = { family: "DM Serif Display", css: '"DM Serif Display", Georgia, serif', slug: "dm-serif-display", weights: [400], weight: 400, upper: false };

const WHITE = "#FFFFFF";
const INK = "#0B0B0F";

export const STYLES: Record<PackId, StyleTokens> = {
  clean: {
    id: "clean",
    tones: ["paper", "brand", "tint", "night"],
    font: { family: "Inter", weight: 800, charWidth: 0.6, upper: false, tracking: -0.025, lineHeight: 1.06 },
    bodyWeight: 500,
    paper: WHITE,
    ink: INK,
    night: null,
    metal: null,
    radius: 0,
    stroke: 3,
    shadow: "soft",
    motifs: ["grid", "hairlines", "plus", "rings", "diagonal"],
    kicker: "rule",
    chip: "pill",
    tilt: 0,
    lean: null,
    video: INTER_VIDEO,
  },
  elegant: {
    id: "elegant",
    tones: ["paper", "tint", "night", "brand"],
    font: { family: "Playfair Display", weight: 700, charWidth: 0.56, upper: false, tracking: -0.01, lineHeight: 1.12 },
    bodyWeight: 500,
    paper: "#FBF7F1",
    ink: "#1E1A16",
    night: null,
    metal: null,
    radius: 0,
    stroke: 2,
    shadow: "none",
    motifs: ["hairlines", "arches", "rings", "deco"],
    kicker: "caps",
    chip: "tag",
    tilt: 0,
    lean: null,
    video: PLAYFAIR_VIDEO,
  },
  bold: {
    id: "bold",
    tones: ["night", "brand", "paper", "tint"],
    font: { family: "Anton", weight: 400, charWidth: 0.5, upper: true, tracking: 0.005, lineHeight: 1.0 },
    bodyWeight: 800,
    paper: "#F4F4F0",
    ink: INK,
    night: "#0E0E10",
    metal: null,
    radius: 0,
    stroke: 8,
    shadow: "hard",
    motifs: ["diagonal", "chevrons", "triangles", "checker"],
    kicker: "tag",
    chip: "block",
    tilt: -4,
    lean: null,
    video: { family: "Anton", css: 'Anton, Impact, "Arial Narrow", sans-serif', slug: "anton", weights: [400], weight: 400, upper: true },
  },
  warm: {
    id: "warm",
    tones: ["tint", "brand", "paper", "night"],
    font: { family: "Nunito", weight: 800, charWidth: 0.58, upper: false, tracking: -0.01, lineHeight: 1.08 },
    bodyWeight: 500,
    paper: "#FFF6EC",
    ink: "#2A1A12",
    night: null,
    metal: null,
    radius: 44,
    stroke: 4,
    shadow: "soft",
    motifs: ["waves", "blobs", "dots", "arches"],
    kicker: "pill",
    chip: "circle",
    tilt: 0,
    lean: null,
    video: NUNITO_VIDEO,
  },
  playful: {
    id: "playful",
    tones: ["brand", "tint", "paper", "night"],
    font: { family: "Nunito", weight: 800, charWidth: 0.58, upper: false, tracking: -0.01, lineHeight: 1.06 },
    bodyWeight: 800,
    paper: "#FFFDF7",
    ink: "#16121F",
    night: null,
    metal: null,
    radius: 32,
    stroke: 6,
    shadow: "hard",
    motifs: ["confetti", "dots", "zigzag", "blobs", "checker"],
    kicker: "pill",
    chip: "stamp",
    tilt: -5,
    lean: null,
    video: NUNITO_VIDEO,
  },
  minimal: {
    id: "minimal",
    tones: ["paper", "tint", "night", "brand"],
    font: { family: "Inter", weight: 500, charWidth: 0.56, upper: false, tracking: -0.035, lineHeight: 1.1 },
    bodyWeight: 500,
    paper: "#FAFAF8",
    ink: "#111111",
    night: "#111111",
    metal: null,
    radius: 0,
    stroke: 2,
    shadow: "none",
    motifs: ["hairlines", "plus", "grid"],
    kicker: "caps",
    chip: "tag",
    tilt: 0,
    lean: null,
    video: INTER_VIDEO,
  },
  luxe: {
    id: "luxe",
    tones: ["night", "paper", "tint", "brand"],
    font: { family: "Playfair Display", weight: 700, charWidth: 0.56, upper: false, tracking: 0, lineHeight: 1.12 },
    bodyWeight: 500,
    paper: "#F6F1E7",
    ink: "#15120D",
    night: "#0F0E0C",
    metal: "#C9A45C",
    radius: 0,
    stroke: 2,
    shadow: "none",
    motifs: ["deco", "hairlines", "arches", "sunburst"],
    kicker: "caps",
    chip: "tag",
    tilt: 0,
    lean: null,
    video: PLAYFAIR_VIDEO,
  },
  vibrant: {
    id: "vibrant",
    tones: ["brand", "night", "tint", "paper"],
    font: { family: "Poppins", weight: 800, charWidth: 0.64, upper: false, tracking: -0.03, lineHeight: 1.04 },
    bodyWeight: 800,
    paper: "#FFFFFF",
    ink: "#120F1F",
    night: null,
    metal: null,
    radius: 28,
    stroke: 6,
    shadow: "hard",
    motifs: ["blobs", "zigzag", "triangles", "dots", "rings", "checker"],
    kicker: "tag",
    chip: "circle",
    tilt: -3,
    lean: null,
    video: { family: "Poppins", css: "Poppins, system-ui, sans-serif", slug: "poppins", weights: [800, 600], weight: 800, upper: false },
  },
  earthy: {
    id: "earthy",
    tones: ["tint", "night", "paper", "brand"],
    font: { family: "DM Serif Display", weight: 400, charWidth: 0.52, upper: false, tracking: -0.01, lineHeight: 1.1 },
    bodyWeight: 500,
    paper: "#F3EADB",
    ink: "#2B1D14",
    night: "#2B1D14",
    metal: null,
    radius: 18,
    stroke: 4,
    shadow: "none",
    motifs: ["mudcloth", "zigzag", "triangles", "waves", "dots"],
    kicker: "caps",
    chip: "stamp",
    tilt: 0,
    lean: { toward: "#B5562F", amount: 0.22 },
    video: DM_SERIF_VIDEO,
  },
  corporate: {
    id: "corporate",
    tones: ["night", "paper", "tint", "brand"],
    font: { family: "Space Grotesk", weight: 700, charWidth: 0.58, upper: false, tracking: -0.02, lineHeight: 1.06 },
    bodyWeight: 500,
    paper: "#F5F7FA",
    ink: "#0C1424",
    night: "#0C1424",
    metal: null,
    radius: 10,
    stroke: 2,
    shadow: "soft",
    motifs: ["grid", "plus", "diagonal", "hairlines", "rings"],
    kicker: "tag",
    chip: "block",
    tilt: 0,
    lean: null,
    video: { family: "Space Grotesk", css: '"Space Grotesk", system-ui, sans-serif', slug: "space-grotesk", weights: [700, 500], weight: 700, upper: false },
  },
  fresh: {
    id: "fresh",
    tones: ["tint", "paper", "brand", "night"],
    font: { family: "Nunito", weight: 800, charWidth: 0.58, upper: false, tracking: -0.015, lineHeight: 1.08 },
    bodyWeight: 500,
    paper: "#F4FAF3",
    ink: "#13241A",
    night: null,
    metal: null,
    radius: 36,
    stroke: 3,
    shadow: "soft",
    motifs: ["leaves", "waves", "dots", "blobs", "arches"],
    kicker: "pill",
    chip: "pill",
    tilt: 0,
    lean: { toward: "#2E9E5B", amount: 0.12 },
    video: NUNITO_VIDEO,
  },
  retro: {
    id: "retro",
    tones: ["paper", "brand", "night", "tint"],
    font: { family: "DM Serif Display", weight: 400, charWidth: 0.52, upper: false, tracking: -0.01, lineHeight: 1.06 },
    bodyWeight: 800,
    paper: "#F5E9D3",
    ink: "#2A1B12",
    night: "#2A1B12",
    metal: null,
    radius: 24,
    stroke: 5,
    shadow: "hard",
    motifs: ["sunburst", "chevrons", "waves", "checker", "rings"],
    kicker: "pill",
    chip: "stamp",
    tilt: -3,
    lean: { toward: "#D9822B", amount: 0.15 },
    video: DM_SERIF_VIDEO,
  },
};

export function styleOf(id: PackId | undefined | null): StyleTokens {
  return (id && STYLES[id]) || STYLES.clean;
}

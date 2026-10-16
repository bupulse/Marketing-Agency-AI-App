// The Claude video engine (docs/VIDEO_ENGINE.md): the motion spec Claude writes for one video. Claude never writes code:
// it fills in this data, which is checked and repaired (validate.ts) and then drawn frame by frame on a 2D canvas
// (draw.ts), in the owner's browser or the video robot's headless Chrome, and encoded to MP4 (encode.ts).
// Client-safe and pure: shared by the designer (server), the renderer (browser), the Video Lab and the tests.

/** Shapes a video can be made in, and their canvas size in pixels. */
export const RATIOS = {
  "9:16": { width: 1080, height: 1920 },
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
} as const;
export type Ratio = keyof typeof RATIOS;
export const isRatio = (v: unknown): v is Ratio => typeof v === "string" && v in RATIOS;

/** Self-hosted fonts (public/fonts/video, SIL OFL) and the weights we ship for each. */
export const FONTS = {
  inter: { family: "Inter", slug: "inter", weights: [600, 800] },
  poppins: { family: "Poppins", slug: "poppins", weights: [600, 800] },
  nunito: { family: "Nunito", slug: "nunito", weights: [600, 800] },
  "space-grotesk": { family: "Space Grotesk", slug: "space-grotesk", weights: [500, 700] },
  anton: { family: "Anton", slug: "anton", weights: [400] },
  playfair: { family: "Playfair Display", slug: "playfair-display", weights: [600, 700] },
  "dm-serif": { family: "DM Serif Display", slug: "dm-serif-display", weights: [400] },
} as const;
export type FontId = keyof typeof FONTS;

export const EASES = ["linear", "in", "out", "inOut", "back", "elastic", "bounce"] as const;
export type Ease = (typeof EASES)[number];

export const TEXT_ANIMATIONS = ["none", "fade", "rise", "drop", "pop", "zoom", "slideLeft", "slideRight", "typewriter", "words", "wordsPop", "blurIn"] as const;
export type TextAnimation = (typeof TEXT_ANIMATIONS)[number];

export const TRANSITIONS = ["cut", "fade", "slideUp", "slideLeft", "zoom", "wipe", "flash"] as const;
export type Transition = (typeof TRANSITIONS)[number];

export const SHAPES = ["rect", "circle", "ring", "line", "burst", "blob", "arrow"] as const;
export type ShapeKind = (typeof SHAPES)[number];

/**
 * A change over the scene. `at` is the moment in the scene, 0 (its start) to 1 (its end). Positions are fractions of
 * the canvas (0.5 = middle); `dx`/`dy` move a layer from its own position; `scale` 1 = its size; `rotate` in degrees.
 */
export interface Keyframe {
  at: number;
  dx?: number;
  dy?: number;
  scale?: number;
  rotate?: number;
  opacity?: number;
  ease?: Ease;
}

/** Common to every layer: its box (centre x, y and size w, h as fractions of the canvas) and its motion. */
interface LayerBase {
  x: number;
  y: number;
  w: number;
  h: number;
  /** When the layer appears and leaves, as fractions of the scene (default 0 and 1). */
  from?: number;
  to?: number;
  keyframes?: Keyframe[];
}

export interface PhotoLayer extends LayerBase {
  kind: "photo";
  /** 1-based index into the photos the designer was given. */
  photo: number;
  fit?: "cover" | "contain";
  /** Corner radius as a fraction of the box's shorter side (0.5 = circle-ish). */
  radius?: number;
  shadow?: boolean;
  border?: string | null;
  /** A slow zoom inside the box, from 1 to `zoomTo` (1 to 1.3), towards the focus point (fractions of the photo). */
  zoomTo?: number;
  focusX?: number;
  focusY?: number;
}

export interface TextLayer extends LayerBase {
  kind: "text";
  text: string;
  font: FontId;
  weight?: number;
  /** Font size as a fraction of the canvas width (0.02 to 0.2). */
  size: number;
  color: string;
  align?: "left" | "center" | "right";
  uppercase?: boolean;
  lineHeight?: number;
  /** A box behind the text. */
  box?: { color: string; padding?: number; radius?: number } | null;
  /** Words (exact, case-insensitive) painted in another colour. */
  highlight?: { words: string[]; color: string } | null;
  shadow?: boolean;
  animate?: TextAnimation;
  /** Length of the entrance animation in seconds (default 0.6). */
  animateFor?: number;
}

export interface ShapeLayer extends LayerBase {
  kind: "shape";
  shape: ShapeKind;
  color: string;
  /** For ring and line: stroke width as a fraction of the canvas width. */
  stroke?: number;
  radius?: number;
  /** Draw the shape progressively (lines, rings) over the entrance. */
  draw?: boolean;
}

export type Layer = PhotoLayer | TextLayer | ShapeLayer;

export interface Background {
  kind: "solid" | "gradient" | "photo";
  colors: string[];
  /** Gradient direction in degrees (0 = top to bottom). */
  angle?: number;
  photo?: number;
  /** Photo backgrounds: blur in pixels (0 to 40) and a dark veil (0 to 0.8) so text reads. */
  blur?: number;
  dim?: number;
  /** Subtle moving dots or grain on top of the background. */
  texture?: "none" | "dots" | "grain" | "lines";
}

export interface Scene {
  /** Scene length in seconds. */
  seconds: number;
  background: Background;
  layers: Layer[];
  /** How this scene arrives from the one before (ignored on the first). */
  transition?: Transition;
  /** What the voice says during this scene (optional; for the voice-over step). */
  say?: string;
}

export interface MotionSpec {
  version: 1;
  title: string;
  ratio: Ratio;
  fps: 30;
  palette: { background: string; primary: string; accent: string; text: string };
  scenes: Scene[];
  /** Music mood for the library track (lib/music), or null for none. */
  music: string | null;
  /** Post caption and hashtags to publish with the video. */
  caption: string;
  hashtags: string[];
}

export const SPEC_LIMITS = {
  minScenes: 2,
  maxScenes: 8,
  minSceneSeconds: 1.2,
  maxSceneSeconds: 8,
  minTotalSeconds: 6,
  maxTotalSeconds: 30,
  maxLayers: 14,
  maxText: 140,
  transitionSeconds: 0.45,
  caption: 600,
  hashtags: 12,
} as const;

/** Canvas size of a spec. */
export function canvasSize(spec: Pick<MotionSpec, "ratio">): { width: number; height: number } {
  return RATIOS[spec.ratio] ?? RATIOS["9:16"];
}

/** Total length in milliseconds. */
export function totalMs(spec: Pick<MotionSpec, "scenes">): number {
  return Math.round(spec.scenes.reduce((sum, s) => sum + s.seconds, 0) * 1000);
}

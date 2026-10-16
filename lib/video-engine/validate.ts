// Checks and repairs a motion spec from Claude (docs/VIDEO_ENGINE.md). Pure. Nothing Claude writes reaches the renderer
// unchecked: unknown values fall back to safe defaults, numbers are clamped to the canvas, text is cut to length,
// layers pointing at photos we do not have are dropped, and the scenes are fitted to the length that was asked for.
import {
  EASES,
  FONTS,
  SHAPES,
  SPEC_LIMITS,
  TEXT_ANIMATIONS,
  TRANSITIONS,
  isRatio,
  type Background,
  type Ease,
  type FontId,
  type Keyframe,
  type Layer,
  type MotionSpec,
  type Ratio,
  type Scene,
} from "./spec";

export class SpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecError";
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const optNum = (v: unknown, min: number, max: number): number | undefined => (v === undefined || v === null ? undefined : num(v, min, max, min));
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback);

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGBA = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;
/** A colour the canvas understands: hex or rgb(a) only (no names, no CSS functions that could do anything else). */
export function color(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  return HEX.test(s) || RGBA.test(s) ? s : fallback;
}

/** Plain text: control characters removed, spaces collapsed, cut to `max` characters on a word boundary. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space >= max * 0.5 ? cut.slice(0, space) : cut).trim();
}

function keyframes(v: unknown): Keyframe[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const list = v
    .filter(isObj)
    .slice(0, 8)
    .map((k) => ({
      at: num(k.at, 0, 1, 0),
      dx: optNum(k.dx, -1.5, 1.5),
      dy: optNum(k.dy, -1.5, 1.5),
      scale: optNum(k.scale, 0, 4),
      rotate: optNum(k.rotate, -720, 720),
      opacity: optNum(k.opacity, 0, 1),
      ease: k.ease === undefined ? undefined : oneOf<Ease>(k.ease, EASES, "inOut"),
    }))
    .sort((a, b) => a.at - b.at);
  return list.length ? list : undefined;
}

function box(l: Obj) {
  const from = num(l.from, 0, 0.95, 0);
  return {
    x: num(l.x, -0.5, 1.5, 0.5),
    y: num(l.y, -0.5, 1.5, 0.5),
    w: num(l.w, 0.01, 2, 0.8),
    h: num(l.h, 0.005, 2, 0.2),
    from,
    to: Math.max(from + 0.05, num(l.to, 0.05, 1, 1)),
    keyframes: keyframes(l.keyframes),
  };
}

function layer(v: unknown, photoCount: number, palette: MotionSpec["palette"]): Layer | null {
  if (!isObj(v)) return null;
  if (v.kind === "photo") {
    const photo = Math.round(num(v.photo, 0, 99, 0));
    if (photo < 1 || photo > photoCount) return null;
    return {
      kind: "photo",
      ...box(v),
      photo,
      fit: v.fit === "contain" ? "contain" : "cover",
      radius: optNum(v.radius, 0, 0.5),
      shadow: v.shadow === true,
      border: v.border ? color(v.border, palette.accent) : null,
      zoomTo: optNum(v.zoomTo, 1, 1.4),
      focusX: optNum(v.focusX, 0, 1),
      focusY: optNum(v.focusY, 0, 1),
    };
  }
  if (v.kind === "text") {
    const text = cleanText(v.text, SPEC_LIMITS.maxText);
    if (!text) return null;
    const font = oneOf<FontId>(v.font, Object.keys(FONTS) as FontId[], "inter");
    const weights: readonly number[] = FONTS[font].weights;
    const wanted = num(v.weight, 100, 900, weights[weights.length - 1]);
    const weight = weights.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best), weights[0]);
    const hl = isObj(v.highlight) && Array.isArray(v.highlight.words) ? v.highlight : null;
    return {
      kind: "text",
      ...box(v),
      text,
      font,
      weight,
      size: num(v.size, 0.02, 0.22, 0.07),
      color: color(v.color, palette.text),
      align: oneOf(v.align, ["left", "center", "right"] as const, "center"),
      uppercase: v.uppercase === true,
      lineHeight: optNum(v.lineHeight, 0.8, 1.8),
      box: isObj(v.box) ? { color: color(v.box.color, palette.primary), padding: optNum(v.box.padding, 0, 0.1), radius: optNum(v.box.radius, 0, 0.5) } : null,
      highlight: hl
        ? { words: (hl.words as unknown[]).map((w) => cleanText(w, 30).toLowerCase()).filter(Boolean).slice(0, 6), color: color(hl.color, palette.accent) }
        : null,
      shadow: v.shadow === true,
      animate: oneOf(v.animate, TEXT_ANIMATIONS, "fade"),
      animateFor: optNum(v.animateFor, 0.1, 3),
    };
  }
  if (v.kind === "shape") {
    return {
      kind: "shape",
      ...box(v),
      shape: oneOf(v.shape, SHAPES, "rect"),
      color: color(v.color, palette.accent),
      stroke: optNum(v.stroke, 0.001, 0.05),
      radius: optNum(v.radius, 0, 0.5),
      draw: v.draw === true,
    };
  }
  return null;
}

function background(v: unknown, photoCount: number, palette: MotionSpec["palette"]): Background {
  const b = isObj(v) ? v : {};
  const kind = oneOf(b.kind, ["solid", "gradient", "photo"] as const, "solid");
  const colors = (Array.isArray(b.colors) ? b.colors : []).slice(0, 4).map((c) => color(c, palette.background));
  const photo = Math.round(num(b.photo, 0, 99, 0));
  if (kind === "photo" && photo >= 1 && photo <= photoCount) {
    return { kind, colors: colors.length ? colors : [palette.background], photo, blur: num(b.blur, 0, 40, 0), dim: num(b.dim, 0, 0.8, 0.25), texture: oneOf(b.texture, ["none", "dots", "grain", "lines"] as const, "none") };
  }
  if (kind === "gradient" && colors.length >= 2) {
    return { kind, colors, angle: num(b.angle, -360, 360, 0), texture: oneOf(b.texture, ["none", "dots", "grain", "lines"] as const, "none") };
  }
  return { kind: "solid", colors: [colors[0] ?? palette.background], texture: oneOf(b.texture, ["none", "dots", "grain", "lines"] as const, "none") };
}

/**
 * Repairs Claude's answer into a spec the renderer can always draw. Throws SpecError only when nothing usable is left
 * (no scenes). `photoCount` is how many photos the designer was given; `seconds` is the length that was asked for.
 */
export function validateSpec(raw: unknown, opts: { ratio: Ratio; photoCount: number; seconds: number }): MotionSpec {
  if (!isObj(raw)) throw new SpecError("The design was not a JSON object.");
  const p = isObj(raw.palette) ? raw.palette : {};
  const palette = {
    background: color(p.background, "#111111"),
    primary: color(p.primary, "#1f6feb"),
    accent: color(p.accent, "#ffcc00"),
    text: color(p.text, "#ffffff"),
  };
  const scenes: Scene[] = (Array.isArray(raw.scenes) ? raw.scenes : [])
    .filter(isObj)
    .slice(0, SPEC_LIMITS.maxScenes)
    .map((s, i) => ({
      seconds: num(s.seconds, SPEC_LIMITS.minSceneSeconds, SPEC_LIMITS.maxSceneSeconds, 3),
      background: background(s.background, opts.photoCount, palette),
      layers: (Array.isArray(s.layers) ? s.layers : [])
        .slice(0, SPEC_LIMITS.maxLayers)
        .map((l) => layer(l, opts.photoCount, palette))
        .filter((l): l is Layer => l !== null),
      transition: i === 0 ? "cut" : oneOf(s.transition, TRANSITIONS, "fade"),
      say: cleanText(s.say, 160) || undefined,
    }));
  if (scenes.length < SPEC_LIMITS.minScenes) throw new SpecError("The design had too few scenes.");
  fitLength(scenes, opts.seconds);
  return {
    version: 1,
    title: cleanText(raw.title, 80) || "Video",
    ratio: isRatio(raw.ratio) ? raw.ratio : opts.ratio,
    fps: 30,
    palette,
    scenes,
    music: typeof raw.music === "string" ? cleanText(raw.music, 30).toLowerCase() || null : null,
    caption: cleanText(raw.caption, SPEC_LIMITS.caption),
    hashtags: (Array.isArray(raw.hashtags) ? raw.hashtags : [])
      .map((h) => cleanText(h, 40).replace(/^#*/, "").replace(/[^\p{L}\p{N}_]/gu, ""))
      .filter(Boolean)
      .slice(0, SPEC_LIMITS.hashtags),
  };
}

/** Scales scene lengths so the video lasts `seconds` (within the limits), keeping each scene between its bounds. */
export function fitLength(scenes: Scene[], seconds: number): void {
  const target = Math.min(SPEC_LIMITS.maxTotalSeconds, Math.max(SPEC_LIMITS.minTotalSeconds, seconds));
  for (let pass = 0; pass < 4; pass++) {
    const total = scenes.reduce((sum, s) => sum + s.seconds, 0);
    if (Math.abs(total - target) < 0.05) break;
    const factor = target / total;
    for (const s of scenes) s.seconds = Math.min(SPEC_LIMITS.maxSceneSeconds, Math.max(SPEC_LIMITS.minSceneSeconds, s.seconds * factor));
  }
  for (const s of scenes) s.seconds = Math.round(s.seconds * 100) / 100;
}

/** Pulls the JSON object out of a model answer (tolerates ```json fences and text around it). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new SpecError("The design did not contain JSON.");
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new SpecError("The design's JSON could not be read.");
  }
}

// Checks and repairs a motion spec from Claude (docs/VIDEO_ENGINE.md). Pure. Nothing Claude writes reaches the renderer
// unchecked: unknown values fall back to safe defaults, numbers are clamped to the canvas, text is cut to length,
// layers pointing at photos we do not have are dropped, and the scenes are fitted to the length that was asked for.
import {
  CAMERA_MOVES,
  CHARACTER_HAIR,
  CHARACTER_POSES,
  EASES,
  FONTS,
  GRADES,
  MATERIALS,
  PARTICLE_KINDS,
  SHAPES,
  SPEC_LIMITS,
  TEXT_ANIMATIONS,
  TRANSITIONS,
  isRatio,
  type Background,
  type Camera,
  type Ease,
  type FontId,
  type Keyframe,
  type Layer,
  type Light,
  type Look,
  type Material,
  type MotionSpec,
  type Ratio,
  type Scene,
  type Text3d,
  type Turntable,
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
    depth: optNum(l.depth, 0, 1),
  };
}

function camera(v: unknown, fixedLens: boolean): Camera | undefined {
  if (!isObj(v)) return undefined;
  const move = fixedLens ? "static" : oneOf(v.move, CAMERA_MOVES, "static");
  return {
    move,
    intensity: optNum(v.intensity, 0, 1),
    shake: fixedLens ? undefined : optNum(v.shake, 0, 1),
    ease: v.ease === undefined ? undefined : oneOf<Ease>(v.ease, EASES, "inOut"),
    focusFrom: optNum(v.focusFrom, 0, 1),
    focusTo: optNum(v.focusTo, 0, 1),
  };
}

function look(v: unknown): Look | undefined {
  if (!isObj(v)) return undefined;
  return {
    grade: oneOf(v.grade, GRADES, "none"),
    grain: optNum(v.grain, 0, 1),
    vignette: optNum(v.vignette, 0, 1),
    glow: optNum(v.glow, 0, 1),
    lightLeak: optNum(v.lightLeak, 0, 1),
    letterbox: v.letterbox === true,
  };
}

const material = (v: unknown): Material | undefined => (typeof v === "string" && (MATERIALS as readonly string[]).includes(v) ? (v as Material) : undefined);

function light(v: unknown): Light | undefined {
  if (!isObj(v)) return undefined;
  const fog = optNum(v.fog, 0, 1);
  return {
    // The light may sit just outside the frame (a sun above, a lamp at the side).
    x: num(v.x, -0.5, 1.5, 0.25),
    y: num(v.y, -0.5, 1.5, 0.15),
    intensity: num(v.intensity, 0, 1, 0.6),
    color: color(v.color, "#ffffff"),
    fog,
    fogColor: fog ? color(v.fogColor, "#c8d2e6") : undefined,
  };
}

function text3d(v: unknown): Text3d | null {
  if (v === true) return { depth: 0.5 };
  if (!isObj(v)) return null;
  return {
    depth: num(v.depth, 0.05, 1, 0.5),
    side: v.side ? color(v.side, "#333333") : undefined,
    bevel: v.bevel === true,
    spin: v.spin === true,
    material: material(v.material),
  };
}

function turntable(v: unknown): Turntable | null {
  if (v === true) return { spin: 1, angle: 35, reflection: 0.35, sweep: true };
  if (!isObj(v)) return null;
  return { spin: num(v.spin, 0.2, 3, 1), angle: num(v.angle, 10, 60, 35), reflection: num(v.reflection, 0, 1, 0.35), sweep: v.sweep !== false };
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
      turntable: turntable(v.turntable),
      cutout: v.cutout === true ? true : undefined,
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
      // Up to 0.22 of the width; a short word far back (depth <= 0.35) may be giant, up to 0.4, behind the product.
      size: num(v.size, 0.02, text.length <= 16 && num(v.depth, 0, 1, 1) <= 0.35 ? 0.4 : 0.22, 0.07),
      color: color(v.color, palette.text),
      align: oneOf(v.align, ["left", "center", "right"] as const, "center"),
      uppercase: v.uppercase === true,
      lineHeight: optNum(v.lineHeight, 0.8, 1.8),
      box: isObj(v.box) ? { color: color(v.box.color, palette.primary), padding: optNum(v.box.padding, 0, 0.1), radius: optNum(v.box.radius, 0, 0.5), material: material(v.box.material) } : null,
      highlight: hl
        ? { words: (hl.words as unknown[]).map((w) => cleanText(w, 30).toLowerCase()).filter(Boolean).slice(0, 6), color: color(hl.color, palette.accent) }
        : null,
      shadow: v.shadow === true,
      text3d: text3d(v.text3d),
      animate: oneOf(v.animate, TEXT_ANIMATIONS, "fade"),
      animateFor: optNum(v.animateFor, 0.1, 3),
    };
  }
  if (v.kind === "character") {
    const talk = (Array.isArray(v.talk) ? v.talk : [])
      .filter((w): w is unknown[] => Array.isArray(w) && w.length === 2)
      .slice(0, 6)
      .map((w) => {
        const a = num(w[0], 0, 1, 0);
        return [a, Math.max(a, num(w[1], 0, 1, a))] as [number, number];
      });
    return {
      kind: "character",
      ...box(v),
      skin: color(v.skin, "#8d5524"),
      hair: oneOf(v.hair, CHARACTER_HAIR, "short"),
      hairColor: color(v.hairColor, "#1b1b1b"),
      outfit: color(v.outfit, palette.primary),
      accent: v.accent ? color(v.accent, palette.accent) : undefined,
      glasses: v.glasses === true,
      pose: oneOf(v.pose, CHARACTER_POSES, "stand"),
      talk,
      side: v.side === "left" ? "left" : "right",
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
      material: material(v.material),
    };
  }
  if (v.kind === "particles") {
    const colors = (Array.isArray(v.colors) ? v.colors : []).slice(0, 5).map((c) => color(c, "#ffffff"));
    // A particle field is usually the whole frame: without a box it fills the canvas.
    const b = box({ x: 0.5, y: 0.5, w: 1, h: 1, ...v });
    return {
      kind: "particles",
      ...b,
      particle: oneOf(v.particle, PARTICLE_KINDS, "dust"),
      count: Math.round(num(v.count, 4, 80, 30)),
      colors: colors.length ? colors : undefined,
      size: optNum(v.size, 0.002, 0.08),
      speed: optNum(v.speed, 0, 2),
      seed: Math.round(num(v.seed, 0, 9999, 1)),
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
export function validateSpec(raw: unknown, opts: { ratio: Ratio; photoCount: number; seconds: number; fixedLens?: boolean }): MotionSpec {
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
      camera: camera(s.camera, opts.fixedLens === true),
      light: light(s.light),
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
    look: look(raw.look),
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

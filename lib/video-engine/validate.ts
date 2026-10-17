// Checks and repairs a motion spec from Claude (docs/VIDEO_ENGINE.md). Pure. Nothing Claude writes reaches the renderer
// unchecked: unknown values fall back to safe defaults, numbers are clamped to the canvas, text is cut to length,
// layers pointing at photos we do not have are dropped, and the scenes are fitted to the length that was asked for.
import { safeAreaFor as brainSafeArea, type SafeArea } from "@/lib/video-engine/brain";
import { cameraAt } from "./animate";
import { luminance, rgba } from "./draw3d";
import { CONTACT, badgesOffProduct, cutoutBox, drawnHeight, isBackdropWord, keepOffSubject, productArea, productBox, sceneSubject, type PhotoInfo } from "./subject";
import {
  CAMERA_MOVES,
  CHARACTER_HAIR,
  CHARACTER_POSES,
  EASES,
  FONTS,
  GRADES,
  MATERIALS,
  PARTICLE_KINDS,
  YOUTUBE_MIDDLE_BAND,
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
  type PhotoLayer,
  type Ratio,
  type Scene,
  type Text3d,
  type TextLayer,
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

/** A post caption: its line breaks kept (captions are written as 2 to 4 short lines), each line cleaned, at most one blank line in a row. */
export function cleanCaption(v: unknown): string {
  if (typeof v !== "string") return "";
  const lines = v.replace(/\r\n?/g, "\n").split("\n").map((l) => cleanText(l, SPEC_LIMITS.caption));
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text.length <= SPEC_LIMITS.caption ? text : cleanText(text.replace(/\n/g, " "), SPEC_LIMITS.caption);
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
      dim: optNum(v.dim, 0, 0.8),
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
      // At least 0.03 of the width (smaller is unreadable on a phone); the display serifs, whose hairlines vanish at
      // small sizes, at least 0.065.
      size: num(v.size, font === "playfair" || font === "dm-serif" ? 0.065 : 0.03, text.length <= 16 && num(v.depth, 0, 1, 1) <= 0.35 && !CONTACT.test(text) ? 0.4 : 0.22, 0.07),
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
  if (v.kind === "video") {
    // A clip the studio serves (/videos/...), an https address or a blob: from the page; nothing else is loaded.
    const url = typeof v.url === "string" ? v.url.trim() : "";
    if (!/^(?:\/[\w./%-]+|https:\/\/[\w.-]+(?::\d+)?\/[\w./%?=&-]*|blob:[\w:/.-]+)$/.test(url) || url.length > 500) return null;
    return {
      kind: "video",
      ...box({ x: 0.5, y: 0.5, w: 1, h: 1, ...v }),
      url,
      fit: v.fit === "contain" ? "contain" : "cover",
      start: Math.round(num(v.start, 0, 600, 0) * 1000) / 1000,
      sound: v.sound === true,
      dim: optNum(v.dim, 0, 0.8),
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

const colourDistance = (a: string, b: string) => {
  const x = rgba(a);
  const y = rgba(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};
const covers = (outer: Layer, inner: Layer) => Math.abs(inner.x - outer.x) <= outer.w / 2 && Math.abs(inner.y - outer.y) <= outer.h / 2;
const overlaps = (a: Layer, b: Layer) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
const FILLED = new Set(["rect", "circle", "burst", "blob"]);
/** Text colour that reads on `behind`: near-black or white, whichever has the higher contrast ratio (WCAG). */
function readableOn(behind: string): string {
  const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgba(behind);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return (L + 0.05) / 0.056 >= 1.05 / (L + 0.05) ? "#111111" : "#ffffff";
}

/**
 * Keeps a scene's text readable, whatever the design says (the template sweep of 17 October 2026 found each case):
 * a filled shape listed after text it covers goes under that text; text the same colour as the shape or solid box
 * behind it gets a colour that reads on it; a large photo under light text gets a dark veil (a background dim does
 * nothing when a full-frame photo layer covers it); a turntable is never smaller than about half the frame. Repairs
 * are stable: a checked spec checks the same again.
 */
export function legible(input: Layer[]): Layer[] {
  // A decorative shape drawn over text hides it: move each such shape to just before the first text it covers.
  const layers = [...input];
  for (let i = 1; i < layers.length; i++) {
    const s = layers[i];
    if (s.kind !== "shape" || !FILLED.has(s.shape) || s.material === "glass") continue;
    const first = layers.findIndex((t, j) => j < i && t.kind === "text" && overlaps(s, t));
    if (first >= 0) {
      layers.splice(i, 1);
      layers.splice(first, 0, s);
    }
  }
  return layers.map((l, i) => {
    if (l.kind === "photo" && l.turntable && (l.w < 0.6 || l.h < 0.42)) return { ...l, w: Math.max(l.w, 0.6), h: Math.max(l.h, 0.42) };
    if (((l.kind === "photo" && !l.turntable) || l.kind === "video") && Math.min(l.w, 1) * Math.min(l.h, 1) >= 0.6) {
      const lightTextOver = layers.slice(i + 1).some((t) => t.kind === "text" && !t.box && luminance(t.color) > 0.6 && covers(l, t));
      if (lightTextOver && (l.dim ?? 0) < 0.4) return { ...l, dim: 0.4 };
    }
    if (l.kind === "text") {
      // A see-through box (alpha under 0.6) shows what is behind it, so its own colour says little: left alone.
      if (l.box && !l.box.material && rgba(l.box.color)[3] >= 0.6 && colourDistance(l.color, l.box.color) < 90) return { ...l, color: readableOn(l.box.color) };
      if (!l.box) {
        const shapes = layers.slice(0, i).reverse().filter((s): s is Extract<Layer, { kind: "shape" }> => s.kind === "shape" && FILLED.has(s.shape) && s.material !== "glass");
        const behind = shapes.find((s) => covers(s, l));
        let out = l;
        if (behind && colourDistance(l.color, behind.color) < 90) out = { ...out, color: readableOn(behind.color) };
        // Highlighted words in the shape's own colour vanish into it: they take the colour that reads on it.
        if (behind && out.highlight && colourDistance(out.highlight.color, behind.color) < 90) out = { ...out, highlight: { ...out.highlight, color: readableOn(behind.color) } };
        // Partly over a shape of its own colour (the clash is only at one end): a shadow keeps the letters apart from it.
        const clash = shapes.some((s) => s !== behind && overlaps(s, l) && (colourDistance(out.color, s.color) < 90 || (out.highlight && colourDistance(out.highlight.color, s.color) < 90)));
        if (clash && !out.shadow) out = { ...out, shadow: true };
        // Text on a badge fits inside the badge (a price half on a yellow burst, half on the pink behind it vanished on
        // the pink): round badges keep it to 80% of their width, rectangles 92%.
        if (behind) {
          const room = Math.round(behind.w * (behind.shape === "rect" ? 0.92 : 0.8) * 1000) / 1000;
          if (out.w > room + 1e-9) out = { ...out, w: room, x: behind.x };
        }
        return out;
      }
    }
    return l;
  });
}

const VERTICAL = new Set<Ratio>(["9:16", "3:4", "4:5"]);
/**
 * Where text must stay on a vertical video: the brain's area for the platform (brain SAFE_AREAS, youtube = Shorts);
 * with no platform, the strictest common box (TikTok's: Instagram and TikTok cover the bottom 20%, TikTok and Shorts
 * the right edge), so a video is safe wherever it is posted.
 */
export const STRICT_AREA: SafeArea = { top: 0.12, bottom: 0.78, left: 0.07, right: 0.85 };
export const safeAreaFor = (platform: string | null | undefined): SafeArea => (platform ? brainSafeArea(platform) : STRICT_AREA);
/** Square and wide videos (feeds, YouTube) have no app buttons over them: text only keeps a small margin (the brain's). */
export const WIDE_AREA: SafeArea = { top: 0.05, bottom: 0.95, left: 0.04, right: 0.96 };
const areaFor = (ratio: Ratio, platform: string | null | undefined): SafeArea => (VERTICAL.has(ratio) ? safeAreaFor(platform) : WIDE_AREA);
/** Most hashtags per platform (the brain audit: Facebook 0 to 3, TikTok and Instagram 4 to 6, Shorts 1 to 3). */
const HASHTAGS: Record<string, number> = { facebook: 3, tiktok: 6, instagram: 6, youtube: 3 };
/** A price, a phone number or a call to action (on YouTube Shorts it goes in the middle band). */


/**
 * Moves text boxes into the platform's safe area of a vertical video (the template sweep found contact lines at y
 * 0.85 to 0.9, under TikTok's and Instagram's own captions); on YouTube Shorts the price, phone and call to action
 * go in the middle band. A giant background word (bigger than 0.22, cut by the frame edge on purpose) is left where
 * it is. Stable: a moved box stays put on the next check.
 */
export function inSafeArea(layers: Layer[], ratio: Ratio, platform: string | null = null): Layer[] {
  const area = areaFor(ratio, platform);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const out = [...layers];
  layers.forEach((l, i) => {
    if (l.kind !== "text" || isBackdropWord(l)) return;
    const A = platform === "youtube" && VERTICAL.has(ratio) && CONTACT.test(l.text) ? { ...area, ...YOUTUBE_MIDDLE_BAND } : area;
    const w = Math.min(l.w, round(A.right - A.left));
    const h = Math.min(l.h, round(A.bottom - A.top));
    // Keep what is drawn inside, not just the box: a short box with big letters spills over its edges.
    const half = Math.min(round(A.bottom - A.top) / 2, Math.max(h, drawnHeight({ ...l, w }, ratio)) / 2);
    const x = round(Math.min(A.right - w / 2, Math.max(A.left + w / 2, l.x)));
    const y = round(Math.min(A.bottom - half, Math.max(A.top + half, l.y)));
    if (x === l.x && y === l.y && w === l.w && h === l.h) return;
    out[i] = { ...l, x, y, w, h };
    // The shape right behind it (a phone bar, a price pill, a badge it sits on) moves with it, or the bar is left
    // empty below the number.
    layers.forEach((s, j) => {
      if (s.kind !== "shape") return;
      const pill = Math.abs(s.x - l.x) <= l.w / 2 && Math.abs(s.y - l.y) <= l.h / 2 && s.h <= l.h * 2;
      const badge = ["burst", "circle", "blob"].includes(s.shape) && Math.abs(l.x - s.x) <= s.w / 2 && Math.abs(l.y - s.y) <= s.h / 2 && s.w * s.h <= 0.25;
      if (!pill && !badge) return;
      out[j] = { ...s, x: round(s.x + x - l.x), y: round(s.y + y - l.y), w: Math.min(s.w, round(A.right - A.left)) };
    });
  });
  return out;
}

/**
 * Text never lies on other text: two texts on screen together whose letters (as drawn) overlap are pulled apart, the
 * lower one moved down under the upper, or, without room below, the upper one moved up (a square video put a price
 * behind its own headline). A backing shape moves with its text. Giant backdrop words are left alone.
 */
export function apartTexts(layers: Layer[], ratio: Ratio, area: SafeArea): Layer[] {
  const out = [...layers];
  const gap = 0.01;
  const texts = () =>
    out
      .map((l, i) => ({ l, i }))
      .filter((t): t is { l: Extract<Layer, { kind: "text" }>; i: number } => t.l.kind === "text" && !isBackdropWord(t.l))
      .sort((a, b) => a.l.y - b.l.y);
  const together = (a: Layer, b: Layer) => Math.max(a.from ?? 0, b.from ?? 0) < Math.min(a.to ?? 1, b.to ?? 1);
  const move = (i: number, dy: number) => {
    const t = out[i];
    out[i] = { ...t, y: Math.round((t.y + dy) * 1000) / 1000 };
    layers.forEach((s, j) => {
      if (s.kind === "shape" && Math.abs(s.x - t.x) <= t.w / 2 && Math.abs(s.y - t.y) <= t.h / 2 && s.h <= t.h * 2) out[j] = { ...s, y: Math.round((s.y + dy) * 1000) / 1000 };
    });
  };
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    const list = texts();
    for (let k = 1; k < list.length; k++) {
      const a = out[list[k - 1].i] as Extract<Layer, { kind: "text" }>;
      const b = out[list[k].i] as Extract<Layer, { kind: "text" }>;
      if (!together(a, b) || Math.abs(a.x - b.x) >= (a.w + b.w) / 2) continue;
      const ha = drawnHeight(a, ratio) / 2;
      const hb = drawnHeight(b, ratio) / 2;
      // Plain letters right above a pill (a column of words over the phone bar) read as touching it: a wider gap.
      const overlapBy = a.y + ha + (!a.box && b.box ? 2 * gap : gap) - (b.y - hb);
      if (overlapBy <= 0.002) continue;
      if (b.y + hb + overlapBy <= area.bottom) move(list[k].i, overlapBy);
      else if (a.y - ha - overlapBy >= area.top) move(list[k - 1].i, -overlapBy);
      else continue;
      moved = true;
    }
    if (!moved) break;
  }
  return out;
}

/** WCAG contrast ratio of two colours (1 to 21). */
function contrast(a: string, b: string): number {
  const L = (c: string) => {
    const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    const [r, g, bl] = rgba(c);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
  };
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * Small text lying straight on a plain or gradient background (not on a photo, a shape or a box) reads on it: under
 * 3:1 contrast with the background's colours it takes near-black or white (the sweep found a faded white phone line on
 * a pale grey studio background).
 */
function readableOnBackground(layers: Layer[], bg: Background): Layer[] {
  if (bg.kind === "photo") return layers;
  return layers.map((l, i) => {
    if (l.kind !== "text" || l.box || l.size > 0.06) return l;
    const covered = layers.slice(0, i).some((s) => (s.kind === "photo" || s.kind === "shape") && covers(s, l));
    if (covered) return l;
    const worst = Math.min(...bg.colors.map((c) => contrast(l.color, c)));
    if (worst >= 3) return l;
    const pick = readableOn(bg.colors[Math.floor(bg.colors.length / 2)] ?? bg.colors[0]);
    return Math.min(...bg.colors.map((c) => contrast(pick, c))) > worst ? { ...l, color: pick } : l;
  });
}

/** Words a voice says in a second (an advert's clear pace). */
export const WORDS_PER_SECOND = 2.5;

/**
 * A say line far longer than its scene (more than 1.3 times the words it has time for) is cut back to its first whole
 * sentences that fit; a line with no clause that fits is kept (the voice-over then stretches the scene, voice.ts).
 */
export function fitSay(say: string, seconds: number): string {
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  const most = Math.floor(seconds * WORDS_PER_SECOND * 1.3) + 1;
  if (words(say) <= most) return say;
  // Whole sentences only: a comma can sit inside a spoken phone number ("zero seven eight eight, one two three...").
  const clauses = say.split(/(?<=[.!?;])\s+/);
  let out = "";
  for (const c of clauses) {
    const next = out ? `${out} ${c}` : c;
    if (words(next) > most) break;
    out = next;
  }
  if (!out) return say;
  return /[.!?…]$/.test(out) ? out : `${out.replace(/[,;:]$/, "")}.`;
}

const ORDER_WORDS = /\b(?:order|call|whatsapp|book|visit|buy|shop|dm|message|contact|hamagara|twandikire|commandez|appelez)\b/i;

/**
 * The last scene must say how to order (the brain audit found end cards with a bare number): when it shows a phone
 * number but no ordering word, the number reads "Call or WhatsApp <number>" (the brief's phone is its phone and
 * WhatsApp line).
 */
function withOrderWords(layers: Layer[]): Layer[] {
  const texts = layers.filter((l): l is Extract<Layer, { kind: "text" }> => l.kind === "text");
  // A bare number on the end card says what it is for (viewers ask "is that WhatsApp?"; the scorer's number-labelled):
  // "WhatsApp 0788 …" next to an order line, "Call or WhatsApp 0788 …" when the scene has none.
  const phone = texts.find((t) => t.text.replace(/\D/g, "").length >= 9 && /^[+\d\s().-]+$/.test(t.text.trim()));
  if (!phone) return layers;
  const label = texts.some((t) => t !== phone && ORDER_WORDS.test(t.text)) ? "WhatsApp" : "Call or WhatsApp";
  return layers.map((l) => (l === phone ? { ...phone, text: cleanText(`${label} ${phone.text.trim()}`, SPEC_LIMITS.maxText) } : l));
}

/**
 * A product big enough to sell (lead's review of the dress sheets, 17 October 2026): when a scene's one product photo
 * (a cut-out, a turntable or a photo card: subject.ts productBox) fills less than `min` of the frame height, its box
 * grows (the product no wider than 90% of the frame) into the room the scene's text leaves: the lines above the
 * product keep a band at the top of the safe area, the lines below (and the quiet phone line still to come) a band at
 * the bottom; with no text on a side the product may reach the frame's edge. A product too big for its text shrinks
 * to that room (not below 35% of the frame). The product repair that follows settles the text in those bands. Scenes
 * with two or more product photos (colour options side by side) are left as designed.
 */
function bigEnough(layers: Layer[], ratio: Ratio, photos: (PhotoInfo | undefined)[], min: number, area: SafeArea, phone: boolean, camera?: Camera): Layer[] {
  if (min <= 0) return layers;
  const cuts = layers.filter((l): l is PhotoLayer => l.kind === "photo" && !!productBox(l, ratio, photos[l.photo - 1]));
  if (cuts.length !== 1) return layers;
  const l = cuts[0];
  const b = productBox(l, ratio, photos[l.photo - 1]) as NonNullable<ReturnType<typeof productBox>>;
  // What the text must clear: the product (on a turntable with its shadow and the top of its reflection), as the
  // product repair (subject.ts sceneSubject) sees it.
  const o = productArea(l, ratio, photos[l.photo - 1]) as NonNullable<ReturnType<typeof productArea>>;
  const gap = 0.02;
  const pcy = o.y + o.h / 2;
  // Only the lines over or under the product take height from it: a column of text beside it (a side-by-side layout)
  // does not, as long as the grown product stays clear of it.
  // Measured as it first shows: a slow zoom (zoomTo) grows a cut-out past that by the end of the scene.
  const z = l.turntable || !cutoutBox(l, ratio, photos[l.photo - 1]) ? 1 : Math.max(1, l.zoomTo ?? 1);
  const want = b.h / z < min * 0.95 ? min * z : b.h;
  const half = Math.min(0.9, (b.w * want) / b.h) / 2;
  const pcx = b.x + b.w / 2;
  const texts = layers.filter((t): t is TextLayer => t.kind === "text" && !isBackdropWord(t) && Math.min(t.x + t.w / 2, pcx + half) - Math.max(t.x - t.w / 2, pcx - half) > 0.03);
  // The height the letters are drawn at (as the product repair stacks them), not a roomy box.
  const need = (list: TextLayer[]) => (list.length ? list.reduce((s, t) => s + drawnHeight(t, ratio) + gap, 0) : 0);
  const above = need(texts.filter((t) => t.y < pcy));
  // The quiet phone line (withPhoneLine) goes at the bottom of the safe area when the scene has no number yet.
  const quiet = phone && !texts.some((t) => /\d{3}[\s-]?\d{3}/.test(t.text)) ? 0.04 + gap : 0;
  const below = need(texts.filter((t) => t.y >= pcy)) + quiet;
  // One more gap between the product and its nearest line (the letters' entrances and shadows need it).
  // A camera zoom spreads the product out from the frame's centre while the text holds its place: the room shrinks
  // by the scene's largest zoom.
  const zoom = Math.max(cameraAt(camera, 0, 0).zoom, cameraAt(camera, 1, 0).zoom, 1);
  const top = 0.5 + ((above ? area.top + above + gap : 0.04) - 0.5) / zoom;
  const bottom = 0.5 + ((below ? area.bottom - below - gap : 0.96) - 0.5) / zoom;
  const room = bottom - top;
  // Grown to the minimum when smaller; shrunk to the room when the text cannot fit around it (never below 35% of the
  // frame: the text gives way after that).
  const fit = Math.max(Math.min(want / b.h, 0.9 / b.w, room / o.h), Math.min(1, (0.35 * z) / b.h));
  const k = Math.abs(fit - 1) <= 0.03 ? 1 : fit;
  // The product area's centre keeps its offset from the layer's centre, scaled (a turntable stands it above its
  // floor), and the area moves into the room left by the text.
  const nx = l.x + (pcx - l.x) * k;
  const ny = l.y + (pcy - l.y) * k;
  const w = b.w * k;
  const h = o.h * k;
  const dx = Math.max(0.05 - (nx - w / 2), Math.min(0, 0.95 - (nx + w / 2)));
  // Into its room; when even the smallest product is taller than the room, centred on it, inside the frame.
  const dy = h <= room ? Math.max(top - (ny - h / 2), Math.min(0, bottom - (ny + h / 2))) : Math.min(0.98 - h / 2, Math.max(0.02 + h / 2, (top + bottom) / 2)) - ny;
  // The right size already and inside its room: as designed. Otherwise it moves into the room (the text needs it).
  if (k === 1 && Math.abs(dx) < 0.005 && Math.abs(dy) < 0.005) return layers;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const grown: PhotoLayer = { ...l, w: r3(Math.min(2, l.w * k)), h: r3(Math.min(2, l.h * k)), x: r3(l.x + dx), y: r3(l.y + dy) };
  // A card or frame made for the photo (a shape on the same centre, about its size) grows and moves with it.
  const card = (x: Layer) => x.kind === "shape" && Math.abs(x.x - l.x) <= 0.05 && Math.abs(x.y - l.y) <= 0.05 && x.w >= l.w * 0.7 && x.w <= l.w * 1.4 && x.h >= l.h * 0.7 && x.h <= l.h * 1.4;
  return layers.map((x) => (x === l ? grown : card(x) ? { ...x, w: r3(Math.min(2, x.w * k)), h: r3(Math.min(2, x.h * k)), x: r3(grown.x + (x.x - l.x) * k), y: r3(grown.y + (x.y - l.y) * k) } : x));
}

/** A star rating, a review count or "customers love": social proof only the facts can give. */
export const RATING = /(?:\b(?:[1-5](?:\.\d)?|one|two|three|four|five)[- ]?stars?\b|★|⭐|\b\d[\d,.]*\s*k?\+?\s*(?:reviews?|ratings?)\b|\b(?:top[- ])?rated\b|\bratings?\b|\bcustomers? love\b|\b\d[\d,.]*\s*k?\+?\s*(?:happy|satisfied)\s+(?:customers|clients)\b)/i;
const sentences = (text: string) => text.match(/[^.!?]+[.!?]*/g)?.map((x) => x.trim()).filter(Boolean) ?? [];
/** A caption without the sentences that claim a rating (line breaks kept). */
const withoutRatings = (caption: string) =>
  caption
    .split("\n")
    .map((line) => (RATING.test(line) ? sentences(line).filter((x) => !RATING.test(x)).join(" ") : line))
    .filter((line, i, all) => line.trim() || (i > 0 && all[i - 1].trim()))
    .join("\n")
    .trim();
/**
 * A row of 4 or 5 small identical stars, bursts or circles side by side: a drawn star rating (the house ugc-review
 * showed five yellow bursts under its price). Empty when there is none.
 */
function starRow(layers: Layer[]): Layer[] {
  const small = layers.filter((l): l is Extract<Layer, { kind: "shape" }> => l.kind === "shape" && ["star", "burst", "circle"].includes(l.shape) && l.w <= 0.12 && l.h <= 0.12);
  for (const a of small) {
    const row = small.filter((b) => b.shape === a.shape && b.color === a.color && Math.abs(b.y - a.y) <= 0.02 && Math.abs(b.w - a.w) <= 0.01 && Math.abs(b.h - a.h) <= 0.01).sort((p, q) => p.x - q.x);
    if (row.length < 4 || row.length > 5) continue;
    const steps = row.slice(1).map((b, i) => b.x - row[i].x);
    if (Math.max(...steps) - Math.min(...steps) <= 0.03 && Math.max(...steps) <= a.w * 3) return row;
  }
  return [];
}

/**
 * A badge (burst, circle, blob) that carries a price, a number or a call to action but sits off it (a big burst
 * centred below the price, its spikes behind the top line only) is centred on that text, cut down evenly to about the
 * text's size and shown from when the text is: the badge and its price arrive together.
 */
function badgesOnTheirText(layers: Layer[], ratio: Ratio): Layer[] {
  const out = [...layers];
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  layers.forEach((b, i) => {
    if (b.kind !== "shape" || !["burst", "circle", "blob"].includes(b.shape)) return;
    const t = layers
      .filter((x): x is TextLayer => x.kind === "text" && CONTACT.test(x.text) && Math.abs(x.x - b.x) <= b.w / 2 && Math.abs(x.y - b.y) <= b.h / 2)
      .sort((p, q) => Math.abs(p.y - b.y) - Math.abs(q.y - b.y))[0];
    if (!t || (Math.abs(t.x - b.x) <= b.w * 0.2 && Math.abs(t.y - b.y) <= b.h * 0.2)) return;
    // The inner part of a burst (inside its spikes) is about two thirds of its box: it holds the text's line. It
    // stays inside the frame around its text.
    const wide = Math.min(t.w, t.text.length * t.size * 0.62);
    const fits = Math.min((2 * Math.min(t.y, 1 - t.y)) / b.h, (2 * Math.min(t.x, 1 - t.x)) / b.w);
    const k = Math.min(1, fits, Math.max(wide / 0.65 / b.w, (drawnHeight(t, ratio) * 1.6) / b.h));
    out[i] = { ...b, x: t.x, y: t.y, w: r3(b.w * k), h: r3(b.h * k), from: t.from ?? 0, to: Math.max(t.to ?? 1, b.to ?? 1) };
    // Too small now to hold the whole line: the text gets a box in the badge's colour (its colour was chosen for it).
    const j = layers.indexOf(t);
    if (!t.box && b.w * k * 0.65 < wide) out[j] = { ...t, box: { color: b.color, padding: 0.015, radius: 0.3 } };
  });
  return out;
}

/** A shape right behind a text (a pill, a badge): its centre inside the text's box, not much taller than it. */
const backs = (s: Layer, t: TextLayer) => s.kind === "shape" && Math.abs(s.x - t.x) <= t.w / 2 && Math.abs(s.y - t.y) <= t.h / 2 && s.h <= t.h * 2.2;

/**
 * The template's line limit (the Brain's STYLE_LIMITS: luxury 2, direct and showcase 3, lists 5), besides the price
 * and the phone number: an extra line moves, with its pill, to the next scene (or the one before) that has room, and is
 * dropped when none has (the voice line says the scene's message anyway). The smallest lines go first.
 */
function keepLineLimit(scenes: Scene[], max: number): void {
  // The number, and a price (an amount with its currency or a k: "5,000 mAh" is a feature line, not a price).
  const fixed = (t: TextLayer) => /\d{3}[\s-]?\d{3}[\s-]?\d{3}/.test(t.text) || /\d[\d,.]*\s*(?:k\b|rwf\b|frw\b|ksh\b|ugx\b|tsh\b)|\b(?:rwf|frw)\s*\d/i.test(t.text);
  const lines = (s: Scene) => s.layers.filter((l): l is TextLayer => l.kind === "text" && l.text.trim() !== "" && !fixed(l));
  scenes.forEach((s, i) => {
    const extra = lines(s).length - max;
    if (extra <= 0) return;
    const out = [...lines(s)].sort((a, b) => a.size - b.size || s.layers.indexOf(b) - s.layers.indexOf(a)).slice(0, extra);
    for (const t of out) {
      const moving = s.layers.filter((l) => l === t || backs(l, t));
      s.layers = s.layers.filter((l) => !moving.includes(l));
      const to = [scenes[i + 1], scenes[i - 1]].find((x) => x && lines(x).length < max && x.layers.length + moving.length <= SPEC_LIMITS.maxLayers);
      if (to) to.layers.push(...moving);
    }
  });
}

/**
 * A ring, circle, burst or blob meant to sit inside the frame (its box within 5% of the edges) stays inside it at its
 * largest keyframe scale: a ring around a title, scaled to 1.15, ran off the left edge (and a re-shape to 1:1 brings
 * the edges closer). It shrinks evenly to fit, then moves in. Shapes that bleed off the frame on purpose are left.
 */
function shapesInFrame(layers: Layer[]): Layer[] {
  return layers.map((l) => {
    if (l.kind !== "shape" || !["ring", "circle", "burst", "blob"].includes(l.shape)) return l;
    if (l.x - l.w / 2 < -0.05 || l.x + l.w / 2 > 1.05 || l.y - l.h / 2 < -0.05 || l.y + l.h / 2 > 1.05) return l;
    const grow = Math.max(1, ...(l.keyframes ?? []).map((f) => f.scale ?? 1));
    const k = Math.min(1, 0.98 / (l.w * grow), 0.98 / (l.h * grow));
    const w = l.w * k;
    const h = l.h * k;
    const half = { x: (w * grow) / 2, y: (h * grow) / 2 };
    const x = Math.min(0.99 - half.x, Math.max(0.01 + half.x, l.x));
    const y = Math.min(0.99 - half.y, Math.max(0.01 + half.y, l.y));
    if (k === 1 && Math.abs(x - l.x) < 1e-9 && Math.abs(y - l.y) < 1e-9) return l;
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    return { ...l, w: r3(w), h: r3(h), x: r3(x), y: r3(y) };
  });
}

/** The phone number as people read it in Rwanda: "+250 788 300 400" -> "0788 300 400"; other numbers as given. */
export function localPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (/^2507\d{8}$/.test(d)) return `0${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  if (/^07\d{8}$/.test(d)) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  return phone.trim();
}

/**
 * Every scene of a vertical video carries the phone number (owner decision, 17 October 2026: the research shows the
 * number on screen from the first frame to the last). A scene without it gets a small, quiet line (size 0.03, the
 * palette's text colour slightly faded, no pill) at the bottom of the safe area, or the top when that is taken or
 * covers the product; on YouTube Shorts at the bottom of the middle band. Calm templates keep their look.
 */
function withPhoneLine(scene: Scene, phone: string, palette: MotionSpec["palette"], area: SafeArea, platform: string | null, ratio: Ratio, photos: (PhotoInfo | undefined)[]): Layer[] {
  const digits = phone.replace(/\D/g, "").replace(/^(?:250|0)/, "");
  if (digits.length < 7 || scene.layers.length >= SPEC_LIMITS.maxLayers) return scene.layers;
  const has = scene.layers.some((l) => l.kind === "text" && l.text.replace(/\D/g, "").replace(/^(?:250|0)/, "").includes(digits.slice(-6)));
  if (has) return scene.layers;
  const [r, g, b] = rgba(palette.text);
  const h = 0.04;
  const subject = sceneSubject(scene, ratio, photos);
  const free = (y: number) => {
    const box = { x: 0.5, y, w: 0.7, h };
    const hitsText = scene.layers.some((l) => l.kind === "text" && overlaps(l, box as Layer));
    const hitsProduct = subject ? Math.abs(y - (subject.y + subject.h / 2)) < (h + subject.h) / 2 : false;
    return !hitsText && !hitsProduct;
  };
  // The bottom of the safe area, else its top; when lines hold both, just above the lowest line or under the highest.
  const lines = scene.layers.filter((l): l is TextLayer => l.kind === "text").map((t) => ({ top: t.y - drawnHeight(t, ratio) / 2, bottom: t.y + drawnHeight(t, ratio) / 2 }));
  const lowest = Math.min(...lines.filter((l) => l.bottom > 0.5).map((l) => l.top), 2);
  const highest = Math.max(...lines.filter((l) => l.top < 0.5).map((l) => l.bottom), -1);
  const between = [lowest - 0.01 - h / 2, highest + 0.01 + h / 2].filter((y) => y - h / 2 >= area.top && y + h / 2 <= area.bottom);
  const spots = platform === "youtube" ? [YOUTUBE_MIDDLE_BAND.bottom - h / 2] : [area.bottom - h / 2, area.top + h / 2, ...between];
  // A photo filling the frame leaves no free spot off the product: the line then goes on the photo, in a dark caption
  // box like the scene's other lines there (only clear of the text).
  const clearOfText = (y: number) => !scene.layers.some((l) => l.kind === "text" && overlaps(l, { x: 0.5, y, w: 0.7, h } as Layer));
  const fullFrame = !!subject && subject.h >= 0.5 && subject.w >= 0.5;
  const onProduct = spots.find(free) === undefined && fullFrame ? spots.find(clearOfText) : undefined;
  const y = spots.find(free) ?? onProduct;
  if (y === undefined) return scene.layers;
  const line: Layer = {
    kind: "text",
    x: 0.5,
    y: Math.round(y * 1000) / 1000,
    w: 0.7,
    h,
    from: 0,
    to: 1,
    depth: 0.95,
    // Labelled, so viewers know it takes WhatsApp (the brief's phone is its "Phone / WhatsApp" line).
    text: `WhatsApp ${localPhone(phone)}`,
    font: "inter",
    weight: 600,
    size: 0.03,
    color: onProduct === undefined ? `rgba(${r},${g},${b},0.85)` : "#ffffff",
    align: "center",
    uppercase: false,
    box: onProduct === undefined ? null : { color: "rgba(0,0,0,0.55)", padding: 0.012, radius: 0.4 },
    highlight: null,
    shadow: true,
    text3d: null,
    animate: "none",
  };
  return [...scene.layers, line];
}

/** The shortest time a text stays fully on screen after its entrance, in seconds (the sweep found lines arriving too late to read). */
export const MIN_READ_SECONDS = 1.2;

/** A text that would arrive too late to be read appears earlier, so it is fully on screen for MIN_READ_SECONDS. */
function readable(l: Layer, sceneSeconds: number): Layer {
  if (l.kind !== "text") return l;
  const from = l.from ?? 0;
  const to = l.to ?? 1;
  const need = (MIN_READ_SECONDS + (l.animate === "none" ? 0 : (l.animateFor ?? 0.6))) / sceneSeconds;
  if (to - from >= need - 1e-9) return l;
  return { ...l, from: Math.max(0, Math.round((to - need) * 1000) / 1000) };
}

/**
 * Repairs Claude's answer into a spec the renderer can always draw. Throws SpecError only when nothing usable is left
 * (no scenes). `photoCount` is how many photos the designer was given; `seconds` is the length that was asked for.
 */
/**
 * `photos`: what is known about photo n (index n - 1): its size and the product's box in it (the cut-out's box), so
 * text can be kept off the product. `platform`: the safe area to keep text in (designer.ts PLATFORMS keys).
 */
export type ValidateOptions = {
  ratio: Ratio;
  photoCount: number;
  seconds: number;
  fixedLens?: boolean;
  photos?: (PhotoInfo | undefined)[];
  platform?: string | null;
  phone?: string | null;
  /** The smallest share of the frame height a cut-out product fills (templates.ts productMinHeight); 0 or none: as designed. */
  productMin?: number;
  /**
   * The brief's facts (product, business description, the owner's note): a star rating or review count they do not
   * give is dropped. Undefined: not checked (edits of a stored design keep what the owner wrote).
   */
  facts?: string;
  /** Text lines a scene may hold besides the price and the number (the Brain's STYLE_LIMITS for the template); none: no limit. */
  maxLines?: number;
  /**
   * An ad (the default) or a post on the business's own page: a post is for followers, so no quiet phone line is
   * added, the number may show on the end card only, and no "Call or WhatsApp" is put in front of it.
   */
  purpose?: "ad" | "post" | null;
};

export function validateSpec(raw: unknown, opts: ValidateOptions): MotionSpec {
  if (!isObj(raw)) throw new SpecError("The design was not a JSON object.");
  const p = isObj(raw.palette) ? raw.palette : {};
  const palette = {
    background: color(p.background, "#111111"),
    primary: color(p.primary, "#1f6feb"),
    accent: color(p.accent, "#ffcc00"),
    text: color(p.text, "#ffffff"),
  };
  const all: Scene[] = (Array.isArray(raw.scenes) ? raw.scenes : [])
    .filter(isObj)
    .slice(0, SPEC_LIMITS.maxScenes)
    .map((s, i) => ({
      seconds: num(s.seconds, SPEC_LIMITS.minSceneSeconds, SPEC_LIMITS.maxSceneSeconds, 3),
      background: background(s.background, opts.photoCount, palette),
      layers: legible(
        (Array.isArray(s.layers) ? s.layers : [])
          .slice(0, SPEC_LIMITS.maxLayers)
          .map((l) => layer(l, opts.photoCount, palette))
          .filter((l): l is Layer => l !== null),
      ),
      transition: i === 0 ? "cut" : oneOf(s.transition, TRANSITIONS, "fade"),
      say: cleanText(s.say, 160) || undefined,
      camera: camera(s.camera, opts.fixedLens === true),
      light: light(s.light),
    }));
  // A video clip (a Seedance overlay) brings its own pacing: one shot may be the whole video, and a clip of 4 or 5
  // seconds is not stretched to the 6-second floor. At most one clip per scene.
  for (const s of all) {
    const first = s.layers.findIndex((l) => l.kind === "video");
    if (first >= 0) s.layers = s.layers.filter((l, i) => l.kind !== "video" || i === first);
  }
  // Star ratings and review counts the facts do not give are fake social proof (the Brain's no-fake-customers): the
  // line goes (with the pill or badge behind it), and so does the sentence that says it aloud.
  if (opts.facts !== undefined && !RATING.test(opts.facts)) {
    for (const s of all) {
      const fake = s.layers.filter((l): l is TextLayer => l.kind === "text" && RATING.test(l.text));
      const stars = starRow(s.layers);
      s.layers = s.layers.filter((l) => !fake.includes(l as TextLayer) && !fake.some((t) => backs(l, t)) && !stars.includes(l));
      if (s.say && RATING.test(s.say)) s.say = sentences(s.say).filter((x) => !RATING.test(x)).join(" ").trim() || undefined;
    }
  }
  if (opts.maxLines) keepLineLimit(all, opts.maxLines);
  const post = opts.purpose === "post";
  // A page post keeps the number for its end card: a number line (and its pill) in an earlier scene goes.
  if (post) {
    all.forEach((s, i) => {
      if (i === all.length - 1) return;
      const numbers = s.layers.filter((l): l is TextLayer => l.kind === "text" && /\d{3}[\s-]?\d{3}[\s-]?\d{3}|\d{9,}/.test(l.text.replace(/\+?250\s?/, "0")));
      s.layers = s.layers.filter((l) => !numbers.includes(l as TextLayer) && !numbers.some((t) => backs(l, t)));
    });
  }
  const hasVideo = all.some((s) => s.layers.some((l) => l.kind === "video"));
  const minScenes = hasVideo ? 1 : SPEC_LIMITS.minScenes;
  // A scene with nothing in it (no layer, no voice line) is a dead second at most: dropped, keeping at least two.
  let empty = all.filter((s) => s.layers.length === 0 && !s.say).length;
  const scenes = all.filter((s) => (s.layers.length > 0 || !!s.say || all.length - empty-- < minScenes ? true : false));
  if (scenes.length < minScenes) throw new SpecError("The design had too few scenes.");
  // The first scene arrives with a cut, whichever scene it was.
  scenes[0].transition = "cut";
  const ratio = isRatio(raw.ratio) ? raw.ratio : opts.ratio;
  const area = areaFor(ratio, opts.platform);
  // Into the safe area first, then off the product (it restacks inside the safe bands), then the safe area again for
  // anything the restack widened.
  const safe = (layers: Layer[]) => inSafeArea(layers, ratio, opts.platform ?? null);
  for (const s of scenes) {
    const tall = VERTICAL.has(ratio) || ratio === "1:1";
    const sized = (layers: Layer[]) => (tall ? bigEnough(layers, ratio, opts.photos ?? [], opts.productMin ?? 0, area, !!opts.phone && !post, s.camera) : layers);
    // The product's size depends on where the text sits and the text's place on the product's size: repeated while
    // the size repair still changes something (at most three times). Not until nothing moves at all: a band of text
    // over a full-frame photo is restacked on every pass and would shrink a little more each time.
    for (let pass = 0; pass === 0 || (pass < 3 && sized(s.layers) !== s.layers); pass++) {
      s.layers = badgesOnTheirText(sized(s.layers), ratio);
      const subject = tall ? sceneSubject(s, ratio, opts.photos ?? []) : null;
      s.layers = shapesInFrame(safe(keepOffSubject(apartTexts(safe(badgesOffProduct(s.layers, subject)), ratio, area), subject, area, ratio)));
    }
  }
  fitLength(scenes, opts.seconds, hasVideo ? SPEC_LIMITS.minSceneSeconds * scenes.length : SPEC_LIMITS.minTotalSeconds);
  for (const s of scenes) {
    s.layers = s.layers.map((l) => readable(l, s.seconds));
    if (s.say) s.say = fitSay(s.say, s.seconds);
    if (VERTICAL.has(ratio) && opts.phone && !post) s.layers = withPhoneLine(s, opts.phone, palette, area, opts.platform ?? null, ratio, opts.photos ?? []);
    s.layers = readableOnBackground(s.layers, s.background);
  }
  if (!post) scenes[scenes.length - 1].layers = withOrderWords(scenes[scenes.length - 1].layers);
  return {
    version: 1,
    title: cleanText(raw.title, 80) || "Video",
    ratio: isRatio(raw.ratio) ? raw.ratio : opts.ratio,
    fps: 30,
    palette,
    scenes,
    music: typeof raw.music === "string" ? cleanText(raw.music, 30).toLowerCase() || null : null,
    caption: opts.facts !== undefined && !RATING.test(opts.facts) ? withoutRatings(cleanCaption(raw.caption)) : cleanCaption(raw.caption),
    hashtags: (Array.isArray(raw.hashtags) ? raw.hashtags : [])
      .map((h) => cleanText(h, 40).replace(/^#*/, "").replace(/[^\p{L}\p{N}_]/gu, ""))
      .filter(Boolean)
      .slice(0, HASHTAGS[opts.platform ?? ""] ?? SPEC_LIMITS.hashtags),
    look: look(raw.look),
  };
}

/** Scales scene lengths so the video lasts `seconds` (within the limits), keeping each scene between its bounds. */
export function fitLength(scenes: Scene[], seconds: number, minTotal: number = SPEC_LIMITS.minTotalSeconds): void {
  const target = Math.min(SPEC_LIMITS.maxTotalSeconds, Math.max(minTotal, seconds));
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

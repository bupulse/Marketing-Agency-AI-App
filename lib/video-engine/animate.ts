// Timing maths of the Claude video engine (docs/VIDEO_ENGINE.md): easing, keyframes, which scene shows when, and how
// far each entrance animation has got. Pure and unit tested; draw.ts turns these numbers into pixels.
import { SPEC_LIMITS, type Ease, type Keyframe, type Layer, type MotionSpec, type TextAnimation } from "./spec";

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function ease(kind: Ease | undefined, t: number): number {
  const x = clamp01(t);
  switch (kind) {
    case "linear":
      return x;
    case "in":
      return x * x * x;
    case "out":
      return 1 - Math.pow(1 - x, 3);
    case "back": {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }
    case "elastic": {
      if (x === 0 || x === 1) return x;
      return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
    }
    case "bounce": {
      const n1 = 7.5625;
      const d1 = 2.75;
      let y = x;
      if (y < 1 / d1) return n1 * y * y;
      if (y < 2 / d1) return n1 * (y -= 1.5 / d1) * y + 0.75;
      if (y < 2.5 / d1) return n1 * (y -= 2.25 / d1) * y + 0.9375;
      return n1 * (y -= 2.625 / d1) * y + 0.984375;
    }
    case "inOut":
    default:
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }
}

export type Pose = { dx: number; dy: number; scale: number; rotate: number; opacity: number };
const REST: Pose = { dx: 0, dy: 0, scale: 1, rotate: 0, opacity: 1 };

/**
 * The layer's pose at scene progress `p` (0..1) from its keyframes. Each property is interpolated between the
 * keyframes that set it, with the later keyframe's easing; before the first and after the last it holds.
 */
export function poseAt(frames: Keyframe[] | undefined, p: number): Pose {
  if (!frames || frames.length === 0) return { ...REST };
  const pose = { ...REST };
  for (const key of ["dx", "dy", "scale", "rotate", "opacity"] as const) {
    const set = frames.filter((f) => f[key] !== undefined);
    if (set.length === 0) continue;
    if (p <= set[0].at) {
      pose[key] = set[0][key] as number;
      continue;
    }
    const last = set[set.length - 1];
    if (p >= last.at) {
      pose[key] = last[key] as number;
      continue;
    }
    for (let i = 1; i < set.length; i++) {
      const a = set[i - 1];
      const b = set[i];
      if (p <= b.at) {
        const span = b.at - a.at || 1;
        pose[key] = lerp(a[key] as number, b[key] as number, ease(b.ease, (p - a.at) / span));
        break;
      }
    }
  }
  return pose;
}

export type SceneSlot = { index: number; startMs: number; endMs: number };

/** Start and end of each scene in milliseconds. */
export function sceneSlots(spec: Pick<MotionSpec, "scenes">): SceneSlot[] {
  let t = 0;
  return spec.scenes.map((s, index) => {
    const startMs = t;
    t += Math.round(s.seconds * 1000);
    return { index, startMs, endMs: t };
  });
}

export type ActiveScene = { index: number; progress: number; localMs: number };

/**
 * The scenes to draw at `tMs`: the current one, and during the first `transitionSeconds` of a scene the previous one
 * too (drawn first, below), with how far the transition has got (0..1).
 */
export function scenesAt(spec: Pick<MotionSpec, "scenes">, tMs: number): { current: ActiveScene; previous: ActiveScene | null; transition: number } {
  const slots = sceneSlots(spec);
  const last = slots[slots.length - 1];
  const t = Math.min(Math.max(0, tMs), Math.max(0, last.endMs - 1));
  const slot = slots.find((s) => t >= s.startMs && t < s.endMs) ?? last;
  const active = (s: SceneSlot, at: number): ActiveScene => ({ index: s.index, localMs: at - s.startMs, progress: clamp01((at - s.startMs) / (s.endMs - s.startMs)) });
  const current = active(slot, t);
  const tMsTransition = SPEC_LIMITS.transitionSeconds * 1000;
  const kind = spec.scenes[slot.index].transition ?? "fade";
  if (slot.index === 0 || kind === "cut" || current.localMs >= tMsTransition) return { current, previous: null, transition: 1 };
  const prev = slots[slot.index - 1];
  return { current, previous: active(prev, Math.min(t, prev.endMs - 1)), transition: clamp01(current.localMs / tMsTransition) };
}

/** Whether a layer is on screen at scene progress `p`, and how far its entrance (0..1) and exit (1..0) have got. */
export function layerWindow(layer: Pick<Layer, "from" | "to">, p: number, sceneSeconds: number, entranceSeconds = 0.6): { visible: boolean; enter: number; exit: number } {
  const from = layer.from ?? 0;
  const to = layer.to ?? 1;
  if (p < from || p > to + 1e-9) return { visible: false, enter: 0, exit: 0 };
  const sinceFrom = (p - from) * sceneSeconds;
  const untilTo = (to - p) * sceneSeconds;
  const exitSeconds = to >= 1 ? 0 : 0.3;
  return {
    visible: true,
    enter: clamp01(sinceFrom / Math.max(0.05, entranceSeconds)),
    exit: exitSeconds === 0 ? 1 : clamp01(untilTo / exitSeconds),
  };
}

/** How a text entrance changes the whole text box at entrance progress `e` (0..1). Per-word effects are in draw.ts. */
export function textEntrance(kind: TextAnimation | undefined, e: number): { dx: number; dy: number; scale: number; opacity: number; blur: number } {
  const out = ease("out", e);
  const back = ease("back", e);
  switch (kind) {
    case "none":
      return { dx: 0, dy: 0, scale: 1, opacity: 1, blur: 0 };
    case "rise":
      return { dx: 0, dy: (1 - out) * 0.04, scale: 1, opacity: out, blur: 0 };
    case "drop":
      return { dx: 0, dy: -(1 - ease("bounce", e)) * 0.08, scale: 1, opacity: Math.min(1, e * 3), blur: 0 };
    case "pop":
      return { dx: 0, dy: 0, scale: 0.4 + 0.6 * back, opacity: Math.min(1, e * 2.5), blur: 0 };
    case "zoom":
      return { dx: 0, dy: 0, scale: 1.6 - 0.6 * out, opacity: out, blur: 0 };
    case "slideLeft":
      return { dx: (1 - out) * 0.25, dy: 0, scale: 1, opacity: out, blur: 0 };
    case "slideRight":
      return { dx: -(1 - out) * 0.25, dy: 0, scale: 1, opacity: out, blur: 0 };
    case "blurIn":
      return { dx: 0, dy: 0, scale: 1.04 - 0.04 * out, opacity: out, blur: (1 - out) * 18 };
    case "typewriter":
    case "words":
    case "wordsPop":
      return { dx: 0, dy: 0, scale: 1, opacity: 1, blur: 0 };
    case "fade":
    default:
      return { dx: 0, dy: 0, scale: 1, opacity: out, blur: 0 };
  }
}

/** Number of frames and the timestamp of frame `i` in microseconds. */
export const frameCount = (spec: Pick<MotionSpec, "scenes" | "fps">) => Math.max(1, Math.round((spec.scenes.reduce((s, x) => s + x.seconds, 0) * spec.fps)));
export const frameUs = (i: number, fps: number) => Math.round((i * 1_000_000) / fps);

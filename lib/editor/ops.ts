// Edit operations for the in-house video editor (docs/research/EDITOR.md): each takes a MotionSpec and returns a new one,
// never changing the input, and returns the same spec when the index or the value is bad. The editor's state is the
// spec, so undo/redo is a list of specs. SPEC_LIMITS' scene length applies; maxScenes does not (reel specs have about 20
// scenes). Pure.
import { snapToBeat, type MusicBeat } from "@/lib/reel-engine/story";
import { GRADES, SPEC_LIMITS, TRANSITIONS, totalMs, type Grade, type Layer, type MotionSpec, type Scene, type ShapeLayer, type TextLayer, type Transition } from "@/lib/video-engine/spec";

const r2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MIN = SPEC_LIMITS.minSceneSeconds;
const MAX = SPEC_LIMITS.maxSceneSeconds;
const has = (spec: MotionSpec, i: number) => Number.isInteger(i) && i >= 0 && i < spec.scenes.length;

/** A copy of the spec with scene `i` replaced. */
const withScene = (spec: MotionSpec, i: number, scene: Scene): MotionSpec => ({ ...spec, scenes: spec.scenes.map((s, k) => (k === i ? scene : s)) });

/** The length of the whole video in seconds. */
export const totalSeconds = (spec: MotionSpec): number => r2(totalMs(spec) / 1000);

/**
 * Trims shot `i`: `start` is where in its clip the shot begins, `seconds` its length (kept between the scene limits).
 * With `clipSeconds` (the clip's real length) the shot never runs past the clip's end.
 */
export function trimShot(spec: MotionSpec, i: number, change: { start?: number; seconds?: number }, opts: { clipSeconds?: number } = {}): MotionSpec {
  if (!has(spec, i)) return spec;
  const scene = spec.scenes[i];
  const { start, seconds } = change;
  if ((start !== undefined && !Number.isFinite(start)) || (seconds !== undefined && !Number.isFinite(seconds))) return spec;
  const clip = opts.clipSeconds && opts.clipSeconds > 0 ? opts.clipSeconds : null;
  const video = scene.layers.find((l) => l.kind === "video");
  let from = video?.kind === "video" ? video.start : 0;
  if (start !== undefined && video) from = Math.max(0, clip ? Math.min(start, clip - MIN) : start);
  let length = seconds === undefined ? scene.seconds : clamp(seconds, MIN, MAX);
  if (clip && video && (seconds !== undefined || start !== undefined)) length = clamp(Math.min(length, clip - from), MIN, MAX);
  from = r2(from);
  length = r2(length);
  const changesStart = video?.kind === "video" && from !== video.start;
  if (length === scene.seconds && !changesStart) return spec;
  const layers = changesStart ? scene.layers.map((l) => (l.kind === "video" ? { ...l, start: from } : l)) : scene.layers;
  return withScene(spec, i, { ...scene, seconds: length, layers });
}

/** Where a layer's [from, to] (fractions of the scene) lands in the part of the scene between fractions `a` and `b`. */
function remap(layer: Layer, a: number, b: number): Layer | null {
  const from = layer.from ?? 0;
  const to = layer.to ?? 1;
  if (to <= a || from >= b) return null;
  const f = r2((Math.max(from, a) - a) / (b - a));
  const t = r2((Math.min(to, b) - a) / (b - a));
  return { ...layer, ...(f > 0 ? { from: f } : { from: undefined }), ...(t < 1 ? { to: t } : { to: undefined }) };
}

/**
 * Splits shot `i` at `atSeconds` into two scenes. The second begins later in the same clip, arrives with a cut, and
 * layers that run across the split appear in both (their timing re-fitted). Each part must be at least the minimum length.
 */
export function splitShot(spec: MotionSpec, i: number, atSeconds: number): MotionSpec {
  if (!has(spec, i) || !Number.isFinite(atSeconds)) return spec;
  const scene = spec.scenes[i];
  const at = r2(atSeconds);
  if (at < MIN || scene.seconds - at < MIN) return spec;
  const f = at / scene.seconds;
  const part = (a: number, b: number, shift: number): Layer[] =>
    scene.layers.flatMap((l) => {
      const m = remap(l, a, b);
      if (!m) return [];
      return [m.kind === "video" ? { ...m, start: r2(m.start + shift) } : m];
    });
  const first: Scene = { ...scene, seconds: at, layers: part(0, f, 0) };
  const second: Scene = { ...scene, seconds: r2(scene.seconds - at), layers: part(f, 1, at), transition: "cut" };
  return { ...spec, scenes: [...spec.scenes.slice(0, i), first, second, ...spec.scenes.slice(i + 1)] };
}

/** Removes shot `i` (the last shot cannot be removed). */
export function deleteShot(spec: MotionSpec, i: number): MotionSpec {
  if (!has(spec, i) || spec.scenes.length < 2) return spec;
  return { ...spec, scenes: spec.scenes.filter((_, k) => k !== i) };
}

/** Moves shot `from` so it ends up at position `to`. */
export function moveShot(spec: MotionSpec, from: number, to: number): MotionSpec {
  if (!has(spec, from) || !has(spec, to) || from === to) return spec;
  const scenes = [...spec.scenes];
  const [moved] = scenes.splice(from, 1);
  scenes.splice(to, 0, moved);
  return { ...spec, scenes };
}

/** How shot `i` arrives from the one before it (only the kinds in TRANSITIONS). */
export function setTransition(spec: MotionSpec, i: number, kind: Transition): MotionSpec {
  if (!has(spec, i) || !(TRANSITIONS as readonly string[]).includes(kind) || spec.scenes[i].transition === kind) return spec;
  return withScene(spec, i, { ...spec.scenes[i], transition: kind });
}

/**
 * The punch-in of shot `i`: every clip or photo layer gets two scale keyframes, `amount` at the start and a little more
 * at the end (a slow push in), like the reel engine's shots (1 = as filmed, 1.3 = a 30% punch-in). A spin (rotate) stays.
 */
export function setZoom(spec: MotionSpec, i: number, amount: number): MotionSpec {
  if (!has(spec, i) || !Number.isFinite(amount)) return spec;
  const scene = spec.scenes[i];
  if (!scene.layers.some((l) => l.kind === "video" || l.kind === "photo")) return spec;
  const from = r2(clamp(amount, 1, 2));
  const to = r2(Math.min(2, from + 0.06));
  const layers = scene.layers.map((l) => {
    if (l.kind !== "video" && l.kind !== "photo") return l;
    const turn = (at: number) => l.keyframes?.find((k) => k.at === at)?.rotate;
    const key = (at: number, scale: number) => ({ at, scale, ...(turn(at) ? { rotate: turn(at) } : {}) });
    return { ...l, keyframes: [key(0, from), key(1, to)] };
  });
  return withScene(spec, i, { ...scene, layers });
}

/** The words of a text layer (caption, hook, sticker): shot `i`, layer `layerIndex`. */
export function setCaptionText(spec: MotionSpec, i: number, layerIndex: number, text: string): MotionSpec {
  if (!has(spec, i) || typeof text !== "string") return spec;
  const layer = spec.scenes[i].layers[layerIndex];
  const clean = text.replace(/\s+/g, " ").trim().slice(0, SPEC_LIMITS.maxText);
  if (!layer || layer.kind !== "text" || !clean || clean === layer.text) return spec;
  return withScene(spec, i, { ...spec.scenes[i], layers: spec.scenes[i].layers.map((l, k) => (k === layerIndex ? { ...layer, text: clean } : l)) });
}

/** A text sticker: the words on a coloured box, near the top (move it with x and y). */
export function textSticker(text: string, over: Partial<TextLayer> = {}): TextLayer {
  return { kind: "text", text: text.slice(0, SPEC_LIMITS.maxText), font: "inter", weight: 900, size: 0.07, color: "#FFFFFF", align: "center", shadow: true, animate: "pop", animateFor: 0.35, box: { color: "#E11D48", padding: 0.025, radius: 0.03 }, x: 0.5, y: 0.2, w: 0.8, h: 0.1, ...over };
}

/** Puts a sticker on shot `i`: a text layer with a box, or a shape. At most SPEC_LIMITS.maxLayers layers a shot. */
export function addSticker(spec: MotionSpec, i: number, sticker: TextLayer | ShapeLayer): MotionSpec {
  if (!has(spec, i) || !sticker) return spec;
  const ok = (sticker.kind === "text" && !!sticker.box && !!sticker.text.trim()) || sticker.kind === "shape";
  const scene = spec.scenes[i];
  if (!ok || scene.layers.length >= SPEC_LIMITS.maxLayers) return spec;
  return withScene(spec, i, { ...scene, layers: [...scene.layers, sticker] });
}

/** Takes a sticker (a text or shape layer) off shot `i`; the clip and photo layers cannot be removed this way. */
export function removeSticker(spec: MotionSpec, i: number, layerIndex: number): MotionSpec {
  if (!has(spec, i)) return spec;
  const layer = spec.scenes[i].layers[layerIndex];
  if (!layer || (layer.kind !== "text" && layer.kind !== "shape")) return spec;
  return withScene(spec, i, { ...spec.scenes[i], layers: spec.scenes[i].layers.filter((_, k) => k !== layerIndex) });
}

/** The colour grade over the whole video (the other look settings stay). */
export function setLook(spec: MotionSpec, grade: Grade): MotionSpec {
  if (!(GRADES as readonly string[]).includes(grade) || (spec.look?.grade ?? "none") === grade) return spec;
  return { ...spec, look: { ...spec.look, grade } };
}

/**
 * Moves each cut to the nearest beat of the music (within half a beat), keeping the total length and every shot within
 * the scene limits. A shot that follows on from the one before in the same clip moves with the cut, so the sound runs on.
 */
export function snapCutsToBeats(spec: MotionSpec, beat: MusicBeat): MotionSpec {
  if (!beat || spec.scenes.length < 2) return spec;
  const total = totalMs(spec) / 1000;
  const old: number[] = [];
  let t = 0;
  for (const s of spec.scenes.slice(0, -1)) old.push((t += s.seconds));
  const bounds: number[] = [];
  let prev = 0;
  old.forEach((o, k) => {
    const left = spec.scenes.length - 1 - k;
    const lo = Math.max(prev + MIN, o - beat.period / 2, total - left * MAX);
    const hi = Math.min(prev + MAX, o + beat.period / 2, total - left * MIN);
    prev = r2(lo <= hi ? snapToBeat(o, lo, hi, beat) : clamp(o, prev + MIN, Math.max(prev + MIN, total - left * MIN)));
    bounds.push(prev);
  });
  const ends = [...bounds, r2(total)];
  const clipOf = (s: Scene) => s.layers.find((l) => l.kind === "video");
  const scenes = spec.scenes.map((s, k) => {
    const seconds = r2(ends[k] - (k ? ends[k - 1] : 0));
    const before = k ? spec.scenes[k - 1] : null;
    const a = before && clipOf(before);
    const b = clipOf(s);
    // Contiguous with the shot before (same clip, picking up where it ended): its start moves with the cut.
    const shift = k ? bounds[k - 1] - old[k - 1] : 0;
    const follows = !!a && !!b && a.kind === "video" && b.kind === "video" && a.url === b.url && Math.abs(a.start + before.seconds - b.start) < 0.05;
    const layers = follows && shift ? s.layers.map((l) => (l.kind === "video" ? { ...l, start: r2(Math.max(0, l.start + shift)) } : l)) : s.layers;
    return seconds === s.seconds && layers === s.layers ? s : { ...s, seconds, layers };
  });
  return scenes.every((s, k) => s === spec.scenes[k]) ? spec : { ...spec, scenes };
}

// ---- Undo and redo: plain data, the specs before and after the present one.

export const HISTORY_STEPS = 100;
export type History = { past: MotionSpec[]; present: MotionSpec; future: MotionSpec[] };
export type Op = (spec: MotionSpec) => MotionSpec;

export const createHistory = (spec: MotionSpec): History => ({ past: [], present: spec, future: [] });

/** Runs an edit: an edit that changes nothing (the same spec back) adds no step; a new edit clears the redo steps. */
export function apply(h: History, op: Op): History {
  const next = op(h.present);
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_STEPS), present: next, future: [] };
}

export function undo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_STEPS), present: h.future[0], future: h.future.slice(1) };
}

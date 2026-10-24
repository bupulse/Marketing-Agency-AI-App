// Sizes and positions on the editor's timeline, as pure functions: a shot's width from its length, which shot a time
// falls in, where the playhead line sits, and the trim a drag means. Pure.
import { SPEC_LIMITS, type MotionSpec } from "@/lib/video-engine/spec";

export const PX_PER_SECOND = 44;
export const MIN_BLOCK_PX = 56;

const r1 = (v: number) => Math.round(v * 10) / 10;

export const blockWidth = (seconds: number, pps = PX_PER_SECOND) => Math.max(MIN_BLOCK_PX, Math.round(seconds * pps));

/** When each shot starts, in seconds. */
export function shotStarts(spec: Pick<MotionSpec, "scenes">): number[] {
  let at = 0;
  return spec.scenes.map((s) => {
    const start = at;
    at += s.seconds;
    return start;
  });
}

/** The shot a time (seconds) falls in; the last shot at or past the end. */
export function shotAt(spec: Pick<MotionSpec, "scenes">, seconds: number): number {
  const starts = shotStarts(spec);
  for (let i = starts.length - 1; i >= 0; i--) if (seconds >= starts[i]) return i;
  return 0;
}

/** Where the playhead line is, in px from the left of the timeline (inside the shot's block, in proportion). */
export function playheadX(spec: Pick<MotionSpec, "scenes">, seconds: number, gap = 0, pps = PX_PER_SECOND): number {
  const i = shotAt(spec, seconds);
  const starts = shotStarts(spec);
  const before = spec.scenes.slice(0, i).reduce((x, s) => x + blockWidth(s.seconds, pps) + gap, 0);
  const inside = Math.min(1, Math.max(0, (seconds - starts[i]) / spec.scenes[i].seconds));
  return Math.round(before + inside * blockWidth(spec.scenes[i].seconds, pps));
}

/** The new length for a shot when its right edge is dragged by `deltaPx` (to 0.1 s, within the scene limits). */
export function trimFromDrag(startSeconds: number, deltaPx: number, pps = PX_PER_SECOND): number {
  return Math.min(SPEC_LIMITS.maxSceneSeconds, Math.max(SPEC_LIMITS.minSceneSeconds, r1(startSeconds + deltaPx / pps)));
}

/** The seconds as the owner reads them: "12.5 s". */
export const secondsText = (s: number) => `${r1(s)} s`;

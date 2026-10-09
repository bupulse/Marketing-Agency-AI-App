import { Easing, interpolate, spring } from "remotion";

export const ease = Easing.bezier(0.22, 1, 0.36, 1);

/** 0 → 1 over `dur` frames from `start`, eased. */
export const prog = (frame: number, start: number, dur = 18) =>
  interpolate(frame, [start, start + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });

/** Springy pop from `start`. */
export const pop = (frame: number, fps: number, start: number, damping = 14) => spring({ frame: frame - start, fps, config: { damping } });

/** Fade + rise style for an element appearing at `start`. */
export const rise = (frame: number, start: number, dist = 24, dur = 18): React.CSSProperties => {
  const p = prog(frame, start, dur);
  return { opacity: p, transform: `translateY(${(1 - p) * dist}px)` };
};

/** Characters of `text` visible when typing from `start` at `cps` characters per second (30 fps). */
export const typed = (text: string, frame: number, start: number, cps = 28) =>
  text.slice(0, Math.max(0, Math.floor(((frame - start) / 30) * cps)));

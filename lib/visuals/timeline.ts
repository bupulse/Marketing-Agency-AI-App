// Pure timeline maths for the browser video renderer: which scenes are on screen at a time, how opaque, where the
// Ken Burns move is, and how a caption wraps. No DOM, so it is unit tested.
import type { Motion, VideoPlan } from "./types";

/** When each scene starts: scenes overlap by the crossfade. */
export function sceneStarts(plan: Pick<VideoPlan, "scenes" | "crossfadeMs">): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const scene of plan.scenes) {
    starts.push(t);
    t += scene.durationMs - plan.crossfadeMs;
  }
  return starts;
}

/** Length of the whole video: every scene, minus one crossfade between each pair. */
export function totalDuration(scenes: { durationMs: number }[], crossfadeMs: number): number {
  if (scenes.length === 0) return 0;
  return scenes.reduce((sum, s) => sum + s.durationMs, 0) - crossfadeMs * (scenes.length - 1);
}

export function frameCount(plan: Pick<VideoPlan, "totalMs" | "fps">): number {
  return Math.max(1, Math.ceil((plan.totalMs / 1000) * plan.fps));
}

/** Timestamp of a frame in microseconds (what WebCodecs wants). */
export function frameTimestampUs(frame: number, fps: number): number {
  return Math.round((frame * 1_000_000) / fps);
}

export type Layer = { index: number; opacity: number; progress: number };

/**
 * The scenes visible at `tMs`, bottom first. A scene fades in over the crossfade while the one before it is still
 * fully drawn underneath, so the picture never dips to black. `progress` runs 0..1 over the scene's own duration.
 */
export function layersAt(plan: Pick<VideoPlan, "scenes" | "crossfadeMs">, tMs: number): Layer[] {
  const starts = sceneStarts(plan);
  const layers: Layer[] = [];
  plan.scenes.forEach((scene, index) => {
    const start = starts[index];
    const end = start + scene.durationMs;
    const last = index === plan.scenes.length - 1;
    if (tMs < start || (tMs >= end && !last)) return;
    const local = Math.min(tMs - start, scene.durationMs);
    const fade = index === 0 || plan.crossfadeMs <= 0 ? 1 : Math.min(1, local / plan.crossfadeMs);
    layers.push({ index, opacity: fade, progress: scene.durationMs > 0 ? local / scene.durationMs : 1 });
  });
  // A fully opaque layer hides everything under it.
  const top = layers.map((l) => l.opacity >= 1).lastIndexOf(true);
  return top > 0 ? layers.slice(top) : layers;
}

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

/**
 * The part of the source image to draw for a Ken Burns move: the image covers the frame (cropped, never stretched),
 * then zooms between 1 and `zoom` or pans across the spare width. Returns a source rectangle for drawImage.
 */
export function kenBurns(
  motion: Motion,
  progress: number,
  image: { width: number; height: number },
  frame: { width: number; height: number },
  zoom = 1.12,
): { sx: number; sy: number; sw: number; sh: number } {
  const p = ease(Math.min(1, Math.max(0, progress)));
  const frameRatio = frame.width / frame.height;
  // The largest rectangle with the frame's shape inside the image.
  let cw = image.width;
  let ch = image.width / frameRatio;
  if (ch > image.height) {
    ch = image.height;
    cw = image.height * frameRatio;
  }
  const scale = motion === "zoom-in" ? 1 + (zoom - 1) * p : motion === "zoom-out" ? zoom - (zoom - 1) * p : zoom;
  const sw = cw / scale;
  const sh = ch / scale;
  const spareX = image.width - sw;
  const spareY = image.height - sh;
  let sx = spareX / 2;
  if (motion === "pan-left") sx = spareX * (1 - p);
  if (motion === "pan-right") sx = spareX * p;
  return { sx, sy: spareY / 2, sw, sh };
}

/** Caption opacity within a scene: in over the first 12%, out over the last 8% (the next scene's crossfade covers it). */
export function captionOpacity(progress: number): number {
  if (progress < 0.12) return progress / 0.12;
  if (progress > 0.92) return Math.max(0, (1 - progress) / 0.08);
  return 1;
}

/** How far a caption has risen into place (0 = 40px low, 1 = in place), over the first 15% of the scene. */
export function captionRise(progress: number): number {
  return ease(Math.min(1, progress / 0.15));
}

/**
 * Wraps text into lines no wider than `maxWidth`, measured with `measure` (canvas measureText in the browser, a
 * character count in tests). A word longer than a line is cut. At most `maxLines`; the last one ends with "…" when cut.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number, maxLines = 4): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const raw of words) {
    let word = raw;
    while (measure(word) > maxWidth && word.length > 1) {
      let cut = word.length - 1;
      while (cut > 1 && measure(word.slice(0, cut)) > maxWidth) cut--;
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= maxWidth) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.replace(/[\s,;:.]+$/, "")}…`;
  return kept;
}

/** Seconds counted toward the plan's video allowance: whole seconds, rounded up. */
export function billableSeconds(totalMs: number): number {
  return Math.max(1, Math.ceil(totalMs / 1000));
}

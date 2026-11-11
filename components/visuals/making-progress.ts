// The loading screen's maths (components/visuals/making-screen.tsx), pure and unit tested: the steps of making a
// day's set, how far along it is, and the percentage shown. The owner's rule (11 November 2026): the number climbs
// fast to about 60%, then slows down, never reaches 100 before the set is ready, and jumps to 100 when it is.
//
// Real progress comes from the server when it has it (MakingProgress: the shape lib/visuals/progress.ts is expected to
// give; any part may be missing), else it is estimated from the visuals the page already has (progressFromVisuals).
// The shown number is the larger of the real one and the eased clock, and never goes back.
import type { VisualView } from "@/lib/visuals/types";

export const MAKING_STEPS = ["captions", "images", "reel", "music", "ready"] as const;
export type MakingStep = (typeof MAKING_STEPS)[number];

export const STEP_LABEL: Record<MakingStep, string> = {
  captions: "Writing captions",
  images: "Designing images",
  reel: "Making the reel",
  music: "Adding music",
  ready: "Ready",
};

/** Where each step starts and ends on the 0 to 100 scale. */
const SPAN: Record<MakingStep, [number, number]> = { captions: [0, 15], images: [15, 60], reel: [60, 88], music: [88, 98], ready: [100, 100] };

/** How long each step usually takes (ms): sets how slowly the clock creeps after 60%. */
export const STEP_MS: Record<MakingStep, number> = { captions: 20_000, images: 45_000, reel: 60_000, music: 15_000, ready: 0 };

export interface MakingProgress {
  step: MakingStep;
  /** How far the current step is, 0 to 1, when known (slides drawn, render progress). */
  fraction?: number | null;
  /** The set's images in order; a null url is still being drawn. */
  images?: { url: string | null; alt?: string }[];
  /** Whether the set has a reel, and music in it (steps without them are left out). */
  reel?: boolean;
  music?: boolean;
  /** Set when making failed: shown instead of the ring's step. */
  failed?: string | null;
}

/** The steps this set goes through (no reel: no "Making the reel" or "Adding music"). */
export function stepsFor(p: Pick<MakingProgress, "reel" | "music">): MakingStep[] {
  return MAKING_STEPS.filter((s) => (s === "reel" ? p.reel !== false : s === "music" ? p.reel !== false && p.music !== false : true));
}

/** The real percentage from the step and its fraction (100 only when ready). */
export function realPercent(p: Pick<MakingProgress, "step" | "fraction">): number {
  const [from, to] = SPAN[p.step];
  const f = Math.min(1, Math.max(0, p.fraction ?? 0));
  return p.step === "ready" ? 100 : Math.min(99, from + (to - from) * f);
}

/**
 * The eased clock: from 1% to 60% in the first `fastMs` (fast, easing out), then creeping toward 96% with a time
 * constant of `slowMs`. Never 100.
 */
export function easedPercent(elapsedMs: number, fastMs = 6_000, slowMs = 45_000): number {
  const t = Math.max(0, elapsedMs);
  if (t < fastMs) {
    const x = t / fastMs;
    return 1 + 59 * (1 - (1 - x) ** 3);
  }
  return 60 + 36 * (1 - Math.exp(-(t - fastMs) / Math.max(1_000, slowMs)));
}

/** The number on screen: 100 when done; else the larger of real and clock, below 100, and never lower than before. */
export function shownPercent(previous: number, clock: number, real: number, done: boolean): number {
  if (done) return 100;
  return Math.max(previous, Math.min(99, Math.max(clock, real)));
}

/**
 * The fallback estimate, from what the page already shows: a set still being written (captions), its image visuals
 * (pending: designing; slides drawn), its video (pending: the reel is being made; near the end of a browser render:
 * music is being mixed in).
 */
export function progressFromVisuals(input: {
  writing?: boolean;
  images: (VisualView | null)[];
  videos: (VisualView | null)[];
  /** Slides drawn of the total, while this page draws a picture. */
  drawing?: { drawn: number; total: number } | null;
  /** This browser's render of the reel, 0 to 1. */
  render?: number | null;
}): MakingProgress {
  const images = input.images.filter((v): v is VisualView => !!v);
  const videos = input.videos.filter((v): v is VisualView => !!v);
  const reel = videos.length > 0;
  const music = videos.some((v) => !!v.videoPlan?.music);
  const urls = images.flatMap((v): { url: string | null; alt: string }[] => (v.items.length ? v.items.map((i) => ({ url: i.url, alt: "" })) : (v.imagePlan?.slides ?? [null]).map(() => ({ url: null, alt: "" }))));
  const failed = [...images, ...videos].find((v) => v.status === "failed")?.error ?? null;
  const base = { images: urls, reel, music, failed: failed && !images.some((v) => v.status === "pending") && !videos.some((v) => v.status === "pending") ? failed : null };
  if (input.writing) return { ...base, step: "captions", fraction: null };
  const pendingImages = images.filter((v) => v.status === "pending");
  if (pendingImages.length > 0) {
    const total = urls.length || 1;
    const drawn = urls.filter((u) => u.url).length + (input.drawing ? input.drawing.drawn : 0);
    return { ...base, step: "images", fraction: Math.min(1, drawn / total) };
  }
  const pendingVideo = videos.find((v) => v.status === "pending");
  if (pendingVideo) {
    const r = input.render ?? null;
    // The browser mixes the music in at the end of its render; the server's render reports no fraction.
    if (music && r !== null && r >= 0.85) return { ...base, step: "music", fraction: (r - 0.85) / 0.15 };
    return { ...base, step: "reel", fraction: r === null ? null : Math.min(1, r / 0.85) };
  }
  return { ...base, step: "ready", fraction: 1 };
}

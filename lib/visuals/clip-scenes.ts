// AI clips in a video plan (docs/CONTENT_VISUALS.md "Video quality"; the server side is lib/visuals/ai-clips.ts):
// which scenes get a clip, the plan with the made clips in it, and the plan back to a simple video with the reason.
// Pure, so it is unit tested and the renderer, the robot and the sweep agree.
import { totalDuration } from "./timeline";
import { VIDEO_LIMITS, type VideoPlan } from "./types";

/** One clip of a video as the visual keeps it (ContentVisual.clipJobs): no image bytes, no keys. */
export type ClipJob = {
  /** The scene the clip plays in. */
  scene: number;
  /** The photo it starts from (its first frame). */
  photoPath: string;
  /** Google's operation, once submitted. */
  operation: string | null;
  status: "submitted" | "made" | "failed";
  /** The clip in the media bucket (`<userId>/aiclips/<visualId>-<scene>.mp4`) once made. */
  path?: string | null;
  bytes?: number;
  /** The clip's real length, read from the file (Gemini Omni has no length setting). */
  ms?: number;
  /** Why it failed: a VeoError kind ("blocked", "failed", "timeout"...), never Google's own words. */
  error?: string | null;
};

/** What the owner reads when the clips were not (all) made. */
export const CLIP_NOTES = {
  off: "AI clips are paused right now, so this is a simple video. No studio credits were used.",
  credits: "Not enough studio credits for AI clips, so this is a simple video. No studio credits were used.",
  blockedAccount: "Your account cannot use studio credits right now, so this is a simple video.",
  noPhoto: "AI clips start from a product photo and this video has none, so it is a simple video. No studio credits were used.",
  busy: "BuPulse made its most AI clips for today, so this is a simple video. No studio credits were used.",
  blocked: "Google declined the AI clips for this video under its safety rules, so it is a simple video. Your studio credits are back.",
  failed: "The AI clips could not be made, so this is a simple video. Your studio credits are back.",
  timeout: "The AI clips took too long, so this is a simple video. Your studio credits are back.",
  googleBusy: "Google was too busy to make the AI clips, so this is a simple video. Your studio credits are back.",
  partial: "One AI clip could not be made, so that scene shows your photo. Its studio credits are back.",
} as const;

/**
 * The scenes that get a clip: scenes with a photo (the clip starts from it), the opening scene first (a moving first
 * second holds viewers), then the body scenes; the closing scene keeps the business name on the brand backdrop.
 * Different photos first, then a photo again (Veo makes a different shot of it).
 */
export function pickClipScenes(plan: Pick<VideoPlan, "scenes">, count: number): { scene: number; photoPath: string }[] {
  const candidates = plan.scenes.flatMap((s, i) => (s.photoPath && s.role !== "cta" ? [{ scene: i, photoPath: s.photoPath }] : []));
  const picked: { scene: number; photoPath: string }[] = [];
  const used = new Set<string>();
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (used.has(c.photoPath)) continue;
    picked.push(c);
    used.add(c.photoPath);
  }
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (!picked.some((p) => p.scene === c.scene)) picked.push(c);
  }
  return picked.sort((a, b) => a.scene - b.scene);
}

/**
 * Durations with the clip scenes held for their clip's length (at most a scene's maximum), the video still within 30 s:
 * the other scenes give up time first (down to their minimum), then the clip scenes.
 */
export function clipDurations(durations: number[], clipMs: Map<number, number>, crossfadeMs: number): number[] {
  const out = durations.map((d, i) => (clipMs.has(i) ? Math.max(d, Math.min(VIDEO_LIMITS.maxSceneMs, clipMs.get(i)!)) : d));
  const over = () => out.reduce((a, b) => a + b, 0) - crossfadeMs * Math.max(0, out.length - 1) - VIDEO_LIMITS.maxMs;
  for (const clips of [false, true]) {
    const excess = over();
    if (excess <= 0) break;
    const which = out.map((_, i) => clipMs.has(i) === clips);
    const slack = out.reduce((sum, d, i) => sum + (which[i] ? Math.max(0, d - VIDEO_LIMITS.minSceneMs) : 0), 0);
    if (slack <= 0) continue;
    const k = Math.min(1, excess / slack);
    for (let i = 0; i < out.length; i++) if (which[i]) out[i] -= Math.ceil((Math.max(0, out[i] - VIDEO_LIMITS.minSceneMs) * k) / 10) * 10;
  }
  return out;
}

/** The plan with the made clips in their scenes (the photo stays as the stand-in), timed around them. */
export function withClips(plan: VideoPlan, made: { scene: number; path: string; ms: number }[], note: string | null = null): VideoPlan {
  const byScene = new Map(made.filter((m) => m.scene >= 0 && m.scene < plan.scenes.length).map((m) => [m.scene, m]));
  const durations = clipDurations(
    plan.scenes.map((s) => s.durationMs),
    new Map([...byScene].map(([i, m]) => [i, m.ms])),
    plan.crossfadeMs,
  );
  const scenes = plan.scenes.map((s, i) => ({ ...s, durationMs: durations[i], clipPath: byScene.get(i)?.path ?? null }));
  return { ...plan, quality: "ai", aiNote: note, scenes, totalMs: totalDuration(scenes, plan.crossfadeMs) };
}

/** The plan as a simple video, with the reason; the mark is cleared so nothing tries again. */
export function withoutClips(plan: VideoPlan, note: string): VideoPlan {
  return { ...plan, quality: "simple", aiNote: note, scenes: plan.scenes.map((s) => ({ ...s, clipPath: null })) };
}

/** The clip files a plan uses (to sign for the renderer, and to delete with the video). */
export function clipPathsOf(plan: Pick<VideoPlan, "scenes"> | null | undefined): string[] {
  return [...new Set((plan?.scenes ?? []).flatMap((s) => (s.clipPath ? [s.clipPath] : [])))];
}

/** Where a made clip is stored: the owner's own folder in the media bucket. */
export const clipStoragePath = (userId: string, visualId: string, scene: number) => `${userId}/aiclips/${visualId}-${scene}.mp4`;
export const isOwnClipPath = (userId: string, path: string) => path.startsWith(`${userId}/aiclips/`) && !path.includes("..") && /\.mp4$/.test(path);

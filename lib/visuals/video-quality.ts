// The owner's video quality for the videos BuPulse makes by itself (Autopilot and Daily posts; owner decision,
// 23 October 2026, docs/CONTENT_VISUALS.md "Video quality"). Pure and client-safe: the settings forms, the planners and
// the tests share it.
//
// - "simple": the slideshow of the business's photos with captions, music and the voice-over (what was always made).
// - "ai": the video also gets real moving clips made by AI (Google Veo), paid in studio credits; the video engine makes
//   them overnight and falls back to the slideshow when the credits, the switch or the AI cannot.
// - "mix": one video in four is "ai", the others "simple".
import { z } from "zod";

export const VIDEO_QUALITIES = ["simple", "mix", "ai"] as const;
export type VideoQuality = (typeof VIDEO_QUALITIES)[number];
export const DEFAULT_VIDEO_QUALITY: VideoQuality = "simple";
export const videoQualitySchema = z.enum(VIDEO_QUALITIES);

/** What one AI video asks the engine for: clips of this many seconds (veoClipCredits prices them on the server). */
export const AI_CLIPS_PER_VIDEO = 2;
export const AI_CLIP_SECONDS = 6;

/** In "mix", one video in MIX_EVERY gets AI clips. */
export const MIX_EVERY = 4;

/** A stored value as a quality; anything unknown is "simple". */
export function readVideoQuality(value: unknown): VideoQuality {
  return (VIDEO_QUALITIES as readonly unknown[]).includes(value) ? (value as VideoQuality) : DEFAULT_VIDEO_QUALITY;
}

/** A small stable hash (FNV-1a) of the video's group or content id, so "mix" picks the same videos every time. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** True when this video (its group or content id as the seed) should get AI clips. */
export function videoGetsAiClips(quality: VideoQuality | null | undefined, seed: string): boolean {
  if (quality === "ai") return true;
  if (quality === "mix") return hash(seed) % MIX_EVERY === 0;
  return false;
}

/** The choices as the settings forms show them; `aiVideoCredits` is about what one AI video costs in studio credits. */
export function videoQualityChoices(aiVideoCredits: number): { value: VideoQuality; label: string; hint: string }[] {
  return [
    { value: "simple", label: "Simple videos", hint: "Your photos with captions, music and a voice-over. No studio credits." },
    { value: "mix", label: "Mix", hint: `One video in ${MIX_EVERY} gets real AI clips (about ${aiVideoCredits} studio credits each), the others are simple.` },
    { value: "ai", label: "AI videos", hint: `Every video gets real AI clips: the best look, about ${aiVideoCredits} studio credits each, so your credits go fast.` },
  ];
}

/** What the forms say when AI clips cannot be made right now (the admin switch is off). */
export const AI_VIDEOS_OFF = "AI videos are not switched on yet: simple videos are made.";

/** What the forms say about running out: the video is never skipped. */
export const AI_VIDEOS_FALLBACK = "When your studio credits run low, BuPulse makes a simple video instead.";

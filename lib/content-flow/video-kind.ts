// Which video the studio makes for the day (owner update, 11 November 2026: "on the video days you can use the UGC
// ads, Seedance videos etc., but this is the side of the studio to decide"). The decision lives here, in the studio's
// planning, never in the post agent: the post agent only receives "the reel" and distributes it
// (lib/content-flow/day-set.ts).
// - A pictures day: the daily slideshow made from the day's pictures (words on screen, voice-over, library music).
// - A skit day (the plan's talking skits, lib/skits): the skit is the day's video; no other reel is made.
// - A video day: the first kind that is available and suits the idea, else the slideshow:
//   UGC-style presenter ad -> Seedance AI video -> the owner's own Gallery video -> slideshow with AI clips ->
//   slideshow. Kinds that need money or another service say why they were not used (plan limits, costs, switched off).
// Pure: the availability is passed in (studioVideoOptions says what this build can make).
import type { AngleId } from "@/lib/studio/angles";
import type { DayFormat } from "./day-set";

export const DAY_VIDEO_KINDS = ["slideshow", "ai-clips", "album", "seedance", "ugc", "skit"] as const;
export type DayVideoKind = (typeof DAY_VIDEO_KINDS)[number];

export type KindOption = { available: boolean; reason?: string };

export type VideoKindContext = {
  format: DayFormat;
  angle?: AngleId | null;
  /** The plan's talking skit is today's video (lib/skits/schedule.ts). */
  skitDay?: boolean;
  /** The subject's album has an MP4 video of the owner's that was not used lately (free). */
  albumVideo?: boolean;
  /** The owner's video quality (Content -> Settings) asks for AI clips in this video (lib/visuals/video-quality.ts). */
  aiClips?: boolean;
  seedance?: KindOption;
  ugc?: KindOption;
};

export type VideoKindChoice = {
  kind: DayVideoKind;
  /** In the owner's words, for the run's notes and the loading screen. */
  reason: string;
  /** Kinds that were considered and why they were not used. */
  passed: { kind: DayVideoKind; reason: string }[];
};

/** Ideas a presenter talking to the camera sells best (an offer, a story, why us). */
const UGC_ANGLES: readonly AngleId[] = ["price", "story", "why-us", "cta", "spotlight", "before-after", "faq"];
/** Ideas that need real motion of the product or the place. */
const SEEDANCE_ANGLES: readonly AngleId[] = ["features", "how-it-works", "behind-scenes", "spotlight", "news", "breaking", "before-after", "seasonal"];

/** The kinds BuPulse makes itself as a reel plan from the day's pictures (the renderer turns the plan into the MP4). */
export const PLAN_KINDS: readonly DayVideoKind[] = ["slideshow", "ai-clips"];

export function chooseDayVideoKind(ctx: VideoKindContext): VideoKindChoice {
  const passed: VideoKindChoice["passed"] = [];
  if (ctx.skitDay) return { kind: "skit", reason: "Today's video is your talking skit.", passed };
  if (ctx.format === "images") return { kind: "slideshow", reason: "A short reel made from today's pictures, with a voice-over and music.", passed };
  const suits = (list: readonly AngleId[]) => !ctx.angle || list.includes(ctx.angle);
  const consider = (kind: DayVideoKind, option: KindOption | undefined, fits: boolean): boolean => {
    if (!option?.available) {
      passed.push({ kind, reason: option?.reason ?? "not available" });
      return false;
    }
    if (!fits) {
      passed.push({ kind, reason: "does not suit today's idea" });
      return false;
    }
    return true;
  };
  if (consider("ugc", ctx.ugc, suits(UGC_ANGLES))) return { kind: "ugc", reason: "A presenter-style video ad suits today's idea.", passed };
  if (consider("seedance", ctx.seedance, suits(SEEDANCE_ANGLES))) return { kind: "seedance", reason: "An AI video shows the product in motion.", passed };
  if (ctx.albumVideo) return { kind: "album", reason: "Your own video from the Gallery is today's reel.", passed };
  passed.push({ kind: "album", reason: "no new video of yours in the Gallery" });
  if (ctx.aiClips) return { kind: "ai-clips", reason: "A reel with AI video clips made from today's pictures.", passed };
  return { kind: "slideshow", reason: "A reel made from today's pictures, with a voice-over and music.", passed };
}

/**
 * What this build's studio can make on a video day (the hook for the video studio, lib/video-studio, and the UGC ads
 * of the Ad Brain work once merged). Seedance videos are paid per clip (lib/video-engine/credits.ts) and made in the
 * Video Studio (studio.bupulse.com) with the owner's choices; UGC ads are not in this build. Until they can be
 * started from the day's plan within the plan's video credits, they are not chosen and the slideshow is used.
 */
export function studioVideoOptions(): { seedance: KindOption; ugc: KindOption } {
  return {
    seedance: { available: false, reason: "Seedance videos are made in the Video Studio for now (paid per clip)." },
    ugc: { available: false, reason: "UGC presenter ads are not in this version yet." },
  };
}

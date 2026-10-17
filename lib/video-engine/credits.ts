// Video Studio prices in credits (docs/VIDEO_ENGINE.md, "Studio"; docs/AI_COSTS.md, "Video"). Pure, so the lab
// (video-lab/credits.ts, its wallet), the app (plan allowances, docs/VIDEO_APP_INTEGRATION.md) and the tests price
// every video the same way. 1 credit = 10 RWF for the Rwanda launch (100 credits = 1,000 RWF, about $0.69). A credit
// price is the estimated provider cost × 2.2, rounded to 5 credits, except the prices the owner set directly.
import { SEEDANCE_USD_PER_SECOND, type SeedanceResolution, type SeedanceTier } from "./seedance";

export const RWF_PER_CREDIT = 10;
export const USD_PER_RWF = 1 / 1450;
/** Margin over the estimated provider cost. */
export const MARGIN = 2.2;

/** The estimated provider cost in USD as credits: × MARGIN, in RWF, rounded to 5 credits, at least 5. */
export const creditsForUsd = (usd: number): number => Math.max(5, Math.round((usd * MARGIN) / USD_PER_RWF / RWF_PER_CREDIT / 5) * 5);

/** Credits for a Seedance clip: seconds × the tier's rate at that resolution, with the margin, rounded to 5. */
export function seedanceCredits(tier: SeedanceTier, resolution: SeedanceResolution, seconds: number): number {
  return creditsForUsd(SEEDANCE_USD_PER_SECOND[tier][resolution] * seconds);
}

/**
 * Credits for one Claude-designed Motion video. Owner decision, 17 October 2026: 35 (the measured design, about
 * $0.107, × 2.2 is about 34; it was 30 from a $0.10 budget).
 */
export const CLAUDE_VIDEO_CREDITS = 35;
/** Credits for one realistic presenter image (Gemini, about $0.04): out of video credits, not the AI image allowance. */
export const PRESENTER_IMAGE_CREDITS = creditsForUsd(0.04);
/**
 * Credits for one voice-over take. Owner decision, 17 October 2026: 15 (a take measured $0.036 to $0.078 at the list
 * price; 10 was about cost). A take already made for the same lines is free.
 */
export const VOICE_OVER_CREDITS = 15;
/**
 * Credits for one Premium 3D clip, by resolution (up to 8 s): Claude designs a Blender scene (about $0.09) and the
 * studio computer renders it (1.5 to 3.5 minutes at 540p, about twice that at 720p). Owner decision, 17 October 2026.
 */
export const PREMIUM_3D_CREDITS = { "540p": 100, "720p": 150 } as const;
export type PremiumQuality = keyof typeof PREMIUM_3D_CREDITS;
export const isPremiumQuality = (v: unknown): v is PremiumQuality => typeof v === "string" && v in PREMIUM_3D_CREDITS;
/** Rendering a finished Premium 3D scene again (no new design), at either resolution: the machine slot. */
export const PREMIUM_RERENDER_CREDITS = 70;

// Each plan's monthly video credits: PLAN_VIDEO_CREDITS in lib/plans.ts.

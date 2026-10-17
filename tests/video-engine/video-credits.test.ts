import { describe, expect, it } from "vitest";
import * as lab from "@/video-lab/credits";
import { PLAN_VIDEO_CREDITS, SEED_PLANS } from "@/lib/plans";
import { CLAUDE_VIDEO_CREDITS, PREMIUM_3D_CREDITS, PREMIUM_RERENDER_CREDITS, PRESENTER_IMAGE_CREDITS, VOICE_OVER_CREDITS, creditsForUsd, isPremiumQuality, seedanceCredits } from "@/lib/video-engine/credits";

describe("video credits (lib/video-engine/credits.ts)", () => {
  it("prices Seedance clips exactly as the cost sheet (docs/AI_COSTS.md, Video)", () => {
    const table: [Parameters<typeof seedanceCredits>, number][] = [
      [["mini", "480p", 4], 45],
      [["mini", "480p", 5], 55],
      [["mini", "720p", 5], 120],
      [["fast", "480p", 5], 90],
      [["fast", "720p", 5], 190],
      [["fast", "720p", 10], 385],
      [["pro", "720p", 5], 240],
      [["pro", "1080p", 5], 590],
      [["pro", "1080p", 10], 1180],
      [["pro", "1080p", 15], 1770],
    ];
    for (const [args, credits] of table) expect(seedanceCredits(...args), args.join(" ")).toBe(credits);
  });

  it("rounds the cost × 2.2 to 5 credits, never under 5", () => {
    expect(creditsForUsd(0)).toBe(5);
    expect(creditsForUsd(0.04)).toBe(15);
    expect(creditsForUsd(0.1)).toBe(30);
    for (const usd of [0.013, 0.2, 0.77, 3.1]) expect(creditsForUsd(usd) % 5).toBe(0);
  });

  it("the owner's prices of 17 October: Motion 35, voice-over 15, presenter 15, Premium 3D 100/150, re-render 70", () => {
    expect([CLAUDE_VIDEO_CREDITS, VOICE_OVER_CREDITS, PRESENTER_IMAGE_CREDITS, PREMIUM_3D_CREDITS["540p"], PREMIUM_3D_CREDITS["720p"], PREMIUM_RERENDER_CREDITS]).toEqual([35, 15, 15, 100, 150, 70]);
    expect(isPremiumQuality("720p")).toBe(true);
    expect(isPremiumQuality("1080p")).toBe(false);
  });

  it("the plans' monthly video credits; the trial's 50 pay for one Motion video with a voice-over", () => {
    expect(PLAN_VIDEO_CREDITS).toEqual({ TRIAL: 50, STARTER: 100, STANDARD: 100, BUSINESS: 500, PRO: 1500 });
    expect(CLAUDE_VIDEO_CREDITS + VOICE_OVER_CREDITS).toBeLessThanOrEqual(PLAN_VIDEO_CREDITS.TRIAL);
    // The seed plans carry them (the database rows got them from the migration).
    expect([SEED_PLANS.TRIAL.limits.videoCredits, SEED_PLANS.STANDARD.limits.videoCredits, SEED_PLANS.PRO.limits.videoCredits]).toEqual([50, 100, 1500]);
  });

  it("the lab sells at exactly these prices (it re-exports them)", () => {
    expect(lab.CLAUDE_VIDEO_CREDITS).toBe(CLAUDE_VIDEO_CREDITS);
    expect(lab.VOICE_OVER_CREDITS).toBe(VOICE_OVER_CREDITS);
    expect(lab.PRESENTER_IMAGE_CREDITS).toBe(PRESENTER_IMAGE_CREDITS);
    expect(lab.PREMIUM_3D_CREDITS).toBe(PREMIUM_3D_CREDITS);
    expect(lab.PREMIUM_RERENDER_CREDITS).toBe(PREMIUM_RERENDER_CREDITS);
    expect(lab.seedanceCredits).toBe(seedanceCredits);
  });
});

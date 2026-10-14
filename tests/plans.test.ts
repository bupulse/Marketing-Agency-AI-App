import { describe, expect, it } from "vitest";
import { PLANS, TRIAL_DAYS } from "@/lib/plans";

describe("plans", () => {
  it("prices the paid plans", () => {
    expect(PLANS.TRIAL.priceUsdMonthly).toBe(0);
    expect(PLANS.STANDARD.priceUsdMonthly).toBe(49);
    expect(PLANS.PRO.priceUsdMonthly).toBe(99);
  });

  it("gives higher plans at least the limits of lower ones", () => {
    for (const metric of Object.keys(PLANS.TRIAL.limits) as (keyof typeof PLANS.TRIAL.limits)[]) {
      // The trial's one sample video is the exception: Standard has no video (it is sold as an add-on).
      // The trial's sample voiceover too.
      if (metric !== "videos" && metric !== "voiceCharacters") expect(PLANS.STANDARD.limits[metric] ?? 0).toBeGreaterThanOrEqual(PLANS.TRIAL.limits[metric] ?? 0);
      expect(PLANS.PRO.limits[metric] ?? 0).toBeGreaterThanOrEqual(PLANS.STANDARD.limits[metric] ?? 0);
    }
  });

  it("limits the trial to a few texts and images", () => {
    expect(PLANS.TRIAL.limits).toMatchObject({ text: 10, image: 5 });
    expect(TRIAL_DAYS).toBe(7);
  });
});

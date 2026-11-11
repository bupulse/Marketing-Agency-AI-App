import { describe, expect, it } from "vitest";
import { checkSpend, clipCost, DEFAULT_AD_LIMITS, estimate, planFits, UNIT_USD } from "@/lib/ad-brain/budget";

const limits = { ...DEFAULT_AD_LIMITS };

describe("the Ad Brain's spend limits", () => {
  it("are the owner's $3 an ad and $30 a month by default", () => {
    expect(DEFAULT_AD_LIMITS).toEqual({ perAdUsd: 3, monthlyUsd: 30 });
  });

  it("let a paid step through while it fits both limits", () => {
    expect(checkSpend({ adSpentUsd: 1, monthSpentUsd: 10, nextUsd: 0.71, limits, what: "a 7 s AI clip" })).toEqual({ ok: true });
    // Landing exactly on the limit is allowed.
    expect(checkSpend({ adSpentUsd: 2.5, monthSpentUsd: 0, nextUsd: 0.5, limits, what: "x" }).ok).toBe(true);
  });

  it("stop before passing the ad's limit, saying why in plain English", () => {
    const r = checkSpend({ adSpentUsd: 2.71, monthSpentUsd: 5, nextUsd: 0.71, limits, what: "a 7 s AI clip" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.limit).toBe("ad");
      expect(r.message).toMatch(/this ad's \$3\.00 limit: it has spent \$2\.71 and the next step \(a 7 s AI clip, about \$0\.71\)/);
    }
  });

  it("stop before passing the month's limit", () => {
    const r = checkSpend({ adSpentUsd: 0.2, monthSpentUsd: 29.9, nextUsd: 0.2, limits, what: "the judge" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.limit).toBe("month");
  });

  it("price clips per second and estimate a plan", () => {
    expect(clipCost(7)).toBeCloseTo(0.7098, 4);
    expect(estimate([{ label: "a", usd: UNIT_USD.frame }, { label: "b", usd: clipCost(5) }]).totalUsd).toBeCloseTo(0.541, 3);
  });

  it("refuse a whole plan that cannot fit, before anything is paid", () => {
    expect(planFits({ planUsd: 2.2, adSpentUsd: 0.05, monthSpentUsd: 0, limits })).toBeNull();
    expect(planFits({ planUsd: 3.2, adSpentUsd: 0.05, monthSpentUsd: 0, limits })).toMatch(/more than the \$3\.00 limit per ad/);
    expect(planFits({ planUsd: 2, adSpentUsd: 0, monthSpentUsd: 29, limits })).toMatch(/past the \$30\.00 monthly limit/);
  });
});

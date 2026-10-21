import { describe, expect, it } from "vitest";
import { computePeriodPay, deductionsFor, milestonesPaidFor, payoutFor, readPayRules, splitWhole, withoutPost, type PostInput } from "@/lib/creators/pay";
import { daysInclusive, periodsFor } from "@/lib/creators/periods";

const post = (over: Partial<PostInput> & Pick<PostInput, "postId" | "creatorId">): PostInput => ({
  status: "TRACKING",
  postedInPeriod: true,
  viewsAtStart: 0,
  viewsAtEnd: 0,
  ...over,
});

describe("splitting whole amounts", () => {
  it("adds up exactly and keeps the shares", () => {
    expect(splitWhole(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitWhole(10, [0, 5, 5])).toEqual([0, 5, 5]);
    expect(splitWhole(7, [0, 0])).toEqual([0, 0]);
    expect(splitWhole(0, [3, 4])).toEqual([0, 0]);
  });
});

describe("a period's pay", () => {
  it("pays the rate per 1,000 views, up to the creator's target (the owner's example)", () => {
    const pay = computePeriodPay({ ratePerThousand: 2000 }, { viewTargetPerCreator: 50_000 }, [post({ postId: "p1", creatorId: "c1", viewsAtEnd: 80_000 })]);
    expect(pay.creators[0]).toMatchObject({ views: 80_000, countedViews: 50_000, amount: 100_000 });
    expect(pay.limitsHit).toContain("creatorTarget");
  });

  it("counts only the views made inside the period", () => {
    const pay = computePeriodPay({ ratePerThousand: 1000 }, {}, [post({ postId: "p1", creatorId: "c1", postedInPeriod: false, viewsAtStart: 30_000, viewsAtEnd: 42_000 })]);
    expect(pay.creators[0].views).toBe(12_000);
    expect(pay.amount).toBe(12_000);
  });

  it("scales every creator by the same share when the campaign target is passed", () => {
    const pay = computePeriodPay({ ratePerThousand: 1000 }, { viewTargetCampaign: 30_000 }, [
      post({ postId: "a", creatorId: "c1", viewsAtEnd: 40_000 }),
      post({ postId: "b", creatorId: "c2", viewsAtEnd: 20_000 }),
    ]);
    expect(pay.creators.map((c) => c.countedViews)).toEqual([20_000, 10_000]);
    expect(pay.countedViews).toBe(30_000);
    expect(pay.limitsHit).toContain("campaignTarget");
  });

  it("pays nothing for removed, rejected or unchecked posts", () => {
    const pay = computePeriodPay({ ratePerThousand: 1000, feePerPost: 500 }, {}, [
      post({ postId: "a", creatorId: "c1", status: "REMOVED", viewsAtEnd: 9_000 }),
      post({ postId: "b", creatorId: "c1", status: "REJECTED", viewsAtEnd: 9_000 }),
      post({ postId: "c", creatorId: "c1", status: "CHECKING", viewsAtEnd: 9_000 }),
      post({ postId: "d", creatorId: "c1", status: "FINAL", viewsAtEnd: 1_000 }),
    ]);
    expect(pay.creators[0].posts.map((p) => p.amount)).toEqual([0, 0, 0, 1_500]);
  });

  it("pays a milestone once, and the fee only in the period the post was made", () => {
    const rules = readPayRules({ milestones: [{ views: 50_000, amount: 15_000 }, { views: 10_000, amount: 5_000 }], feePerPost: 1_000 });
    const first = computePeriodPay(rules, {}, [post({ postId: "p", creatorId: "c", viewsAtEnd: 12_000 })]);
    expect(first.creators[0].posts[0]).toMatchObject({ milestones: [10_000], milestonePay: 5_000, fee: 1_000, amount: 6_000 });
    const later = computePeriodPay(rules, {}, [post({ postId: "p", creatorId: "c", postedInPeriod: false, viewsAtStart: 12_000, viewsAtEnd: 60_000, milestonesPaid: milestonesPaidFor("p", [first.creators[0]]) })]);
    expect(later.creators[0].posts[0]).toMatchObject({ milestones: [50_000], milestonePay: 15_000, fee: 0, amount: 15_000 });
  });

  it("applies the post cap, the creator cap and the budget, in that order", () => {
    const rules = { ratePerThousand: 1000, capPerPost: 8_000, capPerCreator: 12_000 };
    const pay = computePeriodPay(rules, { budget: 15_000 }, [
      post({ postId: "a", creatorId: "c1", viewsAtEnd: 10_000 }),
      post({ postId: "b", creatorId: "c1", viewsAtEnd: 10_000 }),
      post({ postId: "c", creatorId: "c2", viewsAtEnd: 6_000 }),
    ]);
    // c1: 8,000 + 8,000 capped to 12,000; c2: 6,000. Together 18,000 over the 15,000 budget: 10,000 and 5,000.
    expect(pay.creators.map((c) => c.amount)).toEqual([10_000, 5_000]);
    expect(pay.creators[0].posts.map((p) => p.amount)).toEqual([5_000, 5_000]);
    expect(pay.amount).toBe(15_000);
    expect(pay.limitsHit).toEqual(expect.arrayContaining(["capPerPost", "capPerCreator", "budget"]));
  });

  it("never counts falling view numbers as negative", () => {
    const pay = computePeriodPay({ ratePerThousand: 1000 }, {}, [post({ postId: "p", creatorId: "c", postedInPeriod: false, viewsAtStart: 5_000, viewsAtEnd: 4_000 })]);
    expect(pay.amount).toBe(0);
  });

  it("reads broken rules as paying nothing", () => {
    expect(readPayRules({ ratePerThousand: -5 })).toEqual({});
    expect(readPayRules(null)).toEqual({ milestones: [] });
  });
});

describe("removed posts and payouts", () => {
  const line = computePeriodPay({ ratePerThousand: 1000 }, {}, [post({ postId: "a", creatorId: "c", viewsAtEnd: 4_000 }), post({ postId: "b", creatorId: "c", viewsAtEnd: 6_000 })]).creators[0];

  it("drops an unpaid post's pay to 0", () => {
    const due = payoutFor(line, []);
    expect(due.amount).toBe(10_000);
    expect(withoutPost(due.breakdown, "a")).toMatchObject({ amount: 6_000 });
    expect(withoutPost(due.breakdown, "nope")).toBeNull();
  });

  it("takes a paid post's pay off the next payout, once, never below 0", () => {
    const paid = payoutFor(line, []).breakdown;
    const owed = deductionsFor(new Set(["b"]), [paid], new Set());
    expect(owed).toEqual([{ postId: "b", amount: 6_000 }]);
    expect(deductionsFor(new Set(["b"]), [paid], new Set(["b"]))).toEqual([]);
    const next = computePeriodPay({ ratePerThousand: 1000 }, {}, [post({ postId: "z", creatorId: "c", viewsAtEnd: 2_500 })]).creators[0];
    const out = payoutFor(next, owed);
    expect(out).toMatchObject({ amount: 0, deductions: 2_500 });
    expect(out.breakdown.stillOwed).toBe(3_500);
  });
});

describe("pay periods", () => {
  it("cuts a campaign into 30-day periods in the company's timezone", () => {
    const p = periodsFor("2026-11-01", "2026-12-31", "Africa/Kigali");
    expect(daysInclusive("2026-11-01", "2026-12-31")).toBe(61);
    expect(p.map((x) => [x.startsOn, x.endsOn])).toEqual([
      ["2026-11-01", "2026-11-30"],
      ["2026-12-01", "2026-12-30"],
      ["2026-12-31", "2026-12-31"],
    ]);
    expect(p[0].startsAt.toISOString()).toBe("2026-10-31T22:00:00.000Z");
    expect(p[0].endsAt.toISOString()).toBe(p[1].startsAt.toISOString());
  });

  it("refuses an end before the start", () => {
    expect(periodsFor("2026-11-10", "2026-11-01", "Africa/Kigali")).toEqual([]);
  });
});

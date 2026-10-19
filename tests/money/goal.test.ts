import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GoalSection } from "@/components/admin/money/goal-section";
import { cleanSetting, DEFAULT_SETTINGS } from "@/lib/admin/settings";
import { GOAL_PATH, goalProgress, launchMonthNo, mrrInRwf } from "@/lib/money/goal";

// The goal tracker on Admin -> Revenue: MRR in RWF against 9M RWF a month and the pace plan (docs/bizdev/PLAN.md).

const base = { goalRwf: 9_000_000, startMonth: "2026-11" };

describe("goal maths", () => {
  it("counts launch months from the start month", () => {
    expect(launchMonthNo("2026-11", "2026-11")).toBe(1);
    expect(launchMonthNo("2026-11", "2027-02")).toBe(4);
    expect(launchMonthNo("2026-11", "2026-10")).toBe(0);
  });

  it("adds RWF exactly and converts only the rest", () => {
    // 100,000 RWF paid by Mobile Money (booked as $69) plus a $40 card client at 1,470 RWF/USD.
    expect(mrrInRwf(6900 + 4000, { rwfMinor: 100_000, rwfUsdCents: 6900 }, 1470)).toBe(158_800);
    expect(mrrInRwf(0, { rwfMinor: 0, rwfUsdCents: 0 }, 1470)).toBe(0);
  });

  it("follows the pace plan: about 1.7M, 3.9M, 6.3M, then the whole goal", () => {
    expect(GOAL_PATH).toEqual([0.19, 0.43, 0.7, 1]);
    const targets = ["2026-11", "2026-12", "2027-01", "2027-02", "2027-06"].map((m) => goalProgress({ ...base, mrrRwf: 0, payingNow: 0, thisMonth: m }).targetRwf);
    expect(targets).toEqual([1_710_000, 3_870_000, 6_300_000, 9_000_000, 9_000_000]);
  });

  it("says how far, whether on track and how many clients are still needed", () => {
    const g = goalProgress({ ...base, mrrRwf: 4_000_000, payingNow: 70, thisMonth: "2026-12" });
    expect(g).toMatchObject({ monthNo: 2, pct: 44.4, gapRwf: 5_000_000, onTrack: true, arpuRwf: 57_143, clientsToGoal: 88, monthsLeft: 3, perMonth: 30 });
    const behind = goalProgress({ ...base, mrrRwf: 3_000_000, payingNow: 60, thisMonth: "2027-01" });
    expect(behind.onTrack).toBe(false);
  });

  it("before the launch and with no paying client, nothing is invented", () => {
    const g = goalProgress({ ...base, mrrRwf: 0, payingNow: 0, thisMonth: "2026-10" });
    expect(g).toMatchObject({ monthNo: null, targetRwf: null, onTrack: null, arpuRwf: null, clientsToGoal: null, perMonth: null, pct: 0 });
  });

  it("at the goal: nothing more needed", () => {
    const g = goalProgress({ ...base, mrrRwf: 9_500_000, payingNow: 160, thisMonth: "2027-03" });
    expect(g).toMatchObject({ gapRwf: 0, clientsToGoal: 0, monthsLeft: 0, perMonth: 0, onTrack: true, pct: 105.6 });
  });
});

describe("goal settings", () => {
  it("defaults to 9,000,000 RWF from November 2026, and checks what the owner types", () => {
    expect(DEFAULT_SETTINGS.revenueGoalRwf).toBe(9_000_000);
    expect(DEFAULT_SETTINGS.goalStartMonth).toBe("2026-11");
    expect(cleanSetting.revenueGoalRwf("12,000,000")).toBe(12_000_000);
    expect(() => cleanSetting.revenueGoalRwf("-1")).toThrow(/income goal/);
    expect(cleanSetting.goalStartMonth(" 2027-01 ")).toBe("2027-01");
    for (const bad of ["2027-13", "Nov 2026", "2027-1"]) expect(() => cleanSetting.goalStartMonth(bad)).toThrow(/launch month/);
  });
});

describe("the goal section", () => {
  it("shows the goal, the month's target and the clients needed, in RWF", () => {
    const g = goalProgress({ ...base, mrrRwf: 4_000_000, payingNow: 70, thisMonth: "2026-12" });
    const html = renderToStaticMarkup(createElement(GoalSection, { g, newThisMonth: 12, startMonth: "2026-11" }));
    expect(html).toContain("Goal: RWF");
    expect(html).toContain("9,000,000");
    expect(html).toContain("Target for the end of month 2");
    expect(html).toContain("On track");
    expect(html).toContain("About 30 a month needed");
    expect(html).toContain('href="/admin/settings#goal"');
  });
});

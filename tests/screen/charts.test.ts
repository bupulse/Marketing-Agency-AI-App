import { describe, expect, it } from "vitest";
import { BOOKS, type MoneyDisplay } from "@/lib/money/display";
import { compactMoney, dailyRevenue, fillDays, goalProgress, goalRwfFrom, mixedMinor, shares, trialLeftShare } from "@/lib/screen/shared";
import { kigaliMonthStart } from "@/lib/time/kigali";

// The sales TV's charts are shaped from plain data: revenue per Kigali day, sign-ups per day, the goal and the bars.

const RWF: MoneyDisplay = { currency: "RWF", rates: { usdToRwf: 1450, usdToEur: 0.9 } };

describe("revenue per day", () => {
  const now = new Date("2026-10-03T10:00:00Z");
  const start = kigaliMonthStart(now);
  it("has every day from the 1st (Kigali) to today, quiet days at zero", () => {
    const days = dailyRevenue([], start, now);
    expect(days.map((d) => d.day)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(days.every((d) => d.usdCents === 0)).toBe(true);
  });
  it("puts a payment at 01:00 Kigali on the 2nd on the 2nd, keeps the RWF part exact, and nets refunds", () => {
    const days = dailyRevenue(
      [
        { at: new Date("2026-10-01T23:00:00Z"), usdCents: 2000, currency: "RWF", localMinor: 29_000 },
        { at: new Date("2026-10-02T09:00:00Z"), usdCents: 1500, currency: "USD", localMinor: 1500 },
        { at: new Date("2026-10-02T12:00:00Z"), usdCents: -500, currency: "USD", localMinor: -500 },
        { at: new Date("2026-09-30T12:00:00Z"), usdCents: 9999, currency: "USD", localMinor: 9999 },
      ],
      start,
      now,
    );
    expect(days[1]).toEqual({ day: "2026-10-02", usdCents: 3000, rwfMinor: 29_000, rwfUsdCents: 2000 });
    expect(days[0].usdCents).toBe(0);
  });
});

describe("sign-ups per day", () => {
  it("fills 14 days ending today, missing days at zero", () => {
    const out = fillDays([{ day: "2026-10-14", count: 3 }, { day: "2026-10-02", count: 1 }], "2026-10-14");
    expect(out).toHaveLength(14);
    expect(out[0]).toEqual({ day: "2026-10-01", count: 0 });
    expect(out[1]).toEqual({ day: "2026-10-02", count: 1 });
    expect(out[13]).toEqual({ day: "2026-10-14", count: 3 });
  });
});

describe("amounts on the charts", () => {
  it("are exact RWF for the part paid in RWF, the rest converted", () => {
    expect(mixedMinor({ usdCents: 3000, rwfMinor: 29_000, rwfUsdCents: 2000 }, RWF)).toBe(29_000 + 14_500);
    expect(mixedMinor({ usdCents: 3000, rwfMinor: 29_000, rwfUsdCents: 2000 }, BOOKS)).toBe(3000);
    expect(mixedMinor({ usdCents: 1000 }, { ...RWF, currency: "EUR" })).toBe(900);
  });
  it("are short on the labels", () => {
    expect(compactMoney(1_234_567, "RWF")).toBe("RWF 1.2M");
    expect(compactMoney(450_000, "USD")).toBe("$4.5k");
    expect(compactMoney(98_000, "EUR")).toBe("€980");
  });
});

describe("goal and bars", () => {
  it("measures the month against the RWF goal (9M by default)", () => {
    expect(goalRwfFrom(undefined)).toBe(9_000_000);
    expect(goalRwfFrom("12000000")).toBe(12_000_000);
    expect(goalRwfFrom("lots")).toBe(9_000_000);
    const g = goalProgress({ monthCents: 310_345, monthRwfMinor: 4_000_000, monthRwfUsdCents: 275_862 }, RWF.rates, 9_000_000);
    expect(g.rwf).toBe(4_000_000 + Math.round(34_483 * 14.5));
    expect(g.share).toBeCloseTo(g.rwf / 9_000_000, 6);
  });
  it("gives each agent their part of the board and each trial what is left", () => {
    expect(shares([300, 100, 0, -50])).toEqual([0.75, 0.25, 0, 0]);
    expect(shares([0, 0])).toEqual([0, 0]);
    expect(trialLeftShare(7, 14)).toBe(0.5);
    expect(trialLeftShare(20, 14)).toBe(1);
    expect(trialLeftShare(0, 14)).toBe(0);
  });
});

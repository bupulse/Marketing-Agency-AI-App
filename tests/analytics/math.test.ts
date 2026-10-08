import { describe, expect, it } from "vitest";
import { subscriptionEventsFor, addDays, churnPct, computeMrrCents, conversionPct, daysInMonth, eachDay, fixedCostForDay, parseMoneyEvent, pct, profitCents } from "@/lib/analytics/math";

describe("MRR", () => {
  it("sums monthly plans and a twelfth of yearly plans, in cents", () => {
    // 3 x Standard monthly ($49) + 2 x Pro monthly ($99) + 1 x Pro yearly ($990 -> $82.50)
    expect(computeMrrCents([{ plan: "STANDARD", interval: "MONTH", count: 3 }, { plan: "PRO", interval: "MONTH", count: 2 }, { plan: "PRO", interval: "YEAR", count: 1 }])).toBe(14700 + 19800 + 8250);
  });
  it("ignores trials and unknown plans", () => {
    expect(computeMrrCents([{ plan: "TRIAL", interval: "MONTH", count: 10 }, { plan: "NOPE", interval: "MONTH", count: 1 }])).toBe(0);
    expect(computeMrrCents([])).toBe(0);
  });
});

describe("rates", () => {
  it("conversion and percentages", () => {
    expect(conversionPct(3, 20)).toBe(15);
    expect(conversionPct(1, 3)).toBe(33.3);
    expect(conversionPct(0, 0)).toBeNull();
    expect(pct(5, 0)).toBeNull();
  });
  it("churn is cancellations over everyone who was subscribed at the start of the day", () => {
    expect(churnPct(2, 18)).toBe(10);
    expect(churnPct(0, 0)).toBeNull();
    expect(churnPct(0, 10)).toBe(0);
  });
});

describe("monthly costs spread over days", () => {
  const costs = [
    { month: "2026-10", category: "hosting", amountCents: 3100 },
    { month: "2026-10", category: "email", amountCents: 6200 },
    { month: "2026-11", category: "hosting", amountCents: 9999 },
  ];
  it("divides evenly by the days of that month", () => {
    expect(daysInMonth("2026-10")).toBe(31);
    expect(daysInMonth("2026-02")).toBe(28);
    const d = fixedCostForDay("2026-10-15", costs);
    expect(d.total).toBeCloseTo(300);
    expect(d.byCategory).toEqual({ hosting: 100, email: 200 });
  });
  it("adds up to the monthly amount over the month and ignores other months", () => {
    const total = eachDay("2026-10-01", "2026-10-31").reduce((s, day) => s + fixedCostForDay(day, costs).total, 0);
    expect(total).toBeCloseTo(9300);
    expect(fixedCostForDay("2026-12-01", costs).total).toBe(0);
  });
});

describe("profit", () => {
  it("is revenue minus refunds, AI cost and the day's share of fixed cost", () => {
    expect(profitCents(10000, 1000, 250.5, 300)).toBe(8449.5);
    expect(profitCents(0, 0, 10, 100)).toBe(-110);
  });
});

describe("dates", () => {
  it("eachDay and addDays", () => {
    expect(eachDay("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("Paddle money events", () => {
  const at = new Date("2026-10-08T00:00:00Z");
  it("reads a completed payment without tax", () => {
    const e = { event_type: "transaction.completed", occurred_at: "2026-10-07T12:00:00Z", data: { id: "txn_1", currency_code: "USD", details: { totals: { total: "4900", tax: "400" } } } };
    expect(parseMoneyEvent("transaction.completed", e, at)).toEqual({ kind: "payment", cents: 4500, id: "txn_1", at: new Date("2026-10-07T12:00:00Z") });
  });
  it("reads only approved refunds", () => {
    const e = (status: string) => ({ data: { id: "adj_1", action: "refund", status, currency_code: "USD", totals: { total: "1000", tax: "0" } } });
    expect(parseMoneyEvent("adjustment.updated", e("approved"), at)?.cents).toBe(1000);
    expect(parseMoneyEvent("adjustment.updated", e("pending_approval"), at)).toBeNull();
    expect(parseMoneyEvent("adjustment.created", { data: { id: "a", action: "credit", status: "approved", totals: { total: "5" } } }, at)).toBeNull();
  });
  it("skips other currencies and other events", () => {
    expect(parseMoneyEvent("transaction.completed", { data: { currency_code: "EUR", details: { totals: { total: "100" } } } }, at)).toBeNull();
    expect(parseMoneyEvent("subscription.updated", {}, at)).toBeNull();
    expect(parseMoneyEvent("transaction.completed", null, at)).toBeNull();
  });
});

import { summarize } from "@/lib/analytics/queries";

describe("summarize", () => {
  it("writes a short plain-English report", () => {
    const text = summarize(
      {
        range: { from: "2026-10-01", to: "2026-10-07" }, visits: 200, uniqueVisitors: 150, sessions: 160, signups: 10, trialStarts: 10, paidStarts: 2, trialToPaidPct: 20,
        mrrCents: 9800, activeSubscriptions: 2, cancellations: 0, churnPct: 0, dau: 3, wau: 5, mau: 9, revenueCents: 9800, costCents: 1234.5, profitCents: 8565.5,
        previous: { visits: 100, uniqueVisitors: 80, signups: 10, paidStarts: 1, revenueCents: 0, costCents: 0, profitCents: 0 },
      },
      { sources: [{ key: "google", signups: 4, paid: 1, signupPct: 2, paidPct: 25 }], industries: [{ key: "Salon", signups: 3, paid: 1, signupPct: null, paidPct: 33.3 }], networks: [{ network: "instagram", posts: 3, avgEngagement: 10, avgReach: 100 }] },
    );
    expect(text).toContain("200 visits (up 100% on the period before)");
    expect(text).toContain("MRR is $98.00 from 2 subscribers");
    expect(text).toContain("a profit of $85.66");
    expect(text).toContain("google");
    expect(text).toContain("Salon");
    expect(text).toContain("instagram");
  });
});

describe("Paddle net revenue (after tax and fee)", () => {
  const at = new Date("2026-10-08T00:00:00Z");
  it("prefers payout earnings", () => {
    const e = { data: { id: "t", currency_code: "EUR", details: { totals: { currency_code: "EUR", total: "5000", tax: "800", fee: "300", earnings: "3900" }, payout_totals: { currency_code: "USD", total: "5400", tax: "860", fee: "320", earnings: "4220" } } } };
    expect(parseMoneyEvent("transaction.completed", e, at)?.cents).toBe(4220); // a EUR payment counts through its USD payout
  });
  it("falls back to total - tax - fee", () => {
    const e = { data: { id: "t", currency_code: "USD", details: { totals: { total: "4900", tax: "400", fee: "300" } } } };
    expect(parseMoneyEvent("transaction.completed", e, at)?.cents).toBe(4200);
  });
  it("skips when only a non-USD figure exists", () => {
    expect(parseMoneyEvent("transaction.completed", { data: { currency_code: "EUR", details: { totals: { total: "100" } } } }, at)).toBeNull();
  });
  it("refunds use the payout earnings too", () => {
    const e = { data: { id: "a", action: "refund", status: "approved", totals: { currency_code: "USD", total: "1000", tax: "0" }, payout_totals: { currency_code: "USD", earnings: "910" } } };
    expect(parseMoneyEvent("adjustment.updated", e, at)?.cents).toBe(910);
  });
});

describe("subscriptionEventsFor", () => {
  const paying = (plan: string) => ({ plan, status: "ACTIVE", cancelAtPeriodEnd: false });
  it("counts a paid start only when the account was not paying", () => {
    expect(subscriptionEventsFor(null, { plan: "STANDARD", status: "ACTIVE" }, false)).toEqual(["upgrade"]);
    expect(subscriptionEventsFor({ plan: "TRIAL", status: "TRIALING", cancelAtPeriodEnd: false }, { plan: "PRO", status: "ACTIVE" }, false)).toEqual(["upgrade"]);
    expect(subscriptionEventsFor({ plan: "STANDARD", status: "CANCELED", cancelAtPeriodEnd: false }, { plan: "STANDARD", status: "ACTIVE" }, false)).toEqual(["upgrade"]);
  });
  it("records a plan switch while paying as plan_change, never an upgrade", () => {
    expect(subscriptionEventsFor(paying("STANDARD"), { plan: "PRO", status: "ACTIVE" }, false)).toEqual(["plan_change"]);
    expect(subscriptionEventsFor(paying("PRO"), { plan: "STANDARD", status: "ACTIVE" }, false)).toEqual(["plan_change"]);
  });
  it("does nothing for a renewal and handles cancellations", () => {
    expect(subscriptionEventsFor(paying("PRO"), { plan: "PRO", status: "ACTIVE" }, false)).toEqual([]);
    expect(subscriptionEventsFor(paying("PRO"), { plan: "PRO", status: "ACTIVE" }, true)).toEqual(["cancel_scheduled"]);
    expect(subscriptionEventsFor(paying("PRO"), { plan: "PRO", status: "CANCELED" }, true)).toEqual(["cancel", "cancel_scheduled"]);
    expect(subscriptionEventsFor({ plan: "TRIAL", status: "TRIALING", cancelAtPeriodEnd: false }, { plan: "TRIAL", status: "EXPIRED" }, false)).toEqual([]);
  });
});

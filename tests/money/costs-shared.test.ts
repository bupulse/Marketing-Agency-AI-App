import { describe, expect, it } from "vitest";
import { addMonths, billKeyForLedger, buildMonthCosts, monthAdjustments, monthsBetween, recurringCentsForMonth, recurringCostSchema, usdCentsOf, type RecurringCostRow } from "@/lib/money/costs-shared";

const rec = (over: Partial<RecurringCostRow> = {}): RecurringCostRow => ({ id: "c1", name: "Cloudflare Workers Paid", provider: "cloudflare", category: "hosting", amountMinor: 500, currency: "USD", usdRate: null, period: "month", startMonth: "2026-09", endMonth: null, note: null, ...over });

describe("months", () => {
  it("lists months across a year end", () => {
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});

describe("recurring costs", () => {
  it("counts a monthly cost inside its months only", () => {
    expect(recurringCentsForMonth(rec(), "2026-08", 1450)).toBe(0);
    expect(recurringCentsForMonth(rec(), "2026-10", 1450)).toBe(500);
    expect(recurringCentsForMonth(rec({ endMonth: "2026-10" }), "2026-11", 1450)).toBe(0);
  });
  it("spreads a yearly cost (the domain) over 12 months", () => {
    expect(recurringCentsForMonth(rec({ period: "year", amountMinor: 1200 }), "2026-10", 1450)).toBe(100);
  });
  it("converts RWF at the rate", () => {
    expect(usdCentsOf(14_500, "RWF", 1450)).toBe(1000);
    expect(recurringCentsForMonth(rec({ currency: "RWF", amountMinor: 29_000 }), "2026-10", 1450)).toBe(2000);
  });
  it("keeps the rate saved with an RWF cost when the rate in Settings changes", () => {
    const cost = rec({ currency: "RWF", amountMinor: 29_000, usdRate: 1450 });
    expect(recurringCentsForMonth(cost, "2026-10", 1450)).toBe(2000);
    expect(recurringCentsForMonth(cost, "2026-10", 1000)).toBe(2000);
  });
  it("refuses an end before the start", () => {
    expect(recurringCostSchema.safeParse({ name: "x", provider: "other", category: "tools", amount: 1, currency: "USD", period: "month", startMonth: "2026-10", endMonth: "2026-09" }).success).toBe(false);
  });
});

describe("month costs", () => {
  const base = { months: ["2026-10"], recurring: [rec()], entered: [], rwfPerUsd: 1450 };

  it("shows the ledger estimate, marked estimate, when no bill was entered", () => {
    const [m] = buildMonthCosts({ ...base, ledger: [{ month: "2026-10", provider: "gemini", cents: 42, calls: 10, estimatedCalls: 1 }], bills: [] });
    const google = m.lines.find((l) => l.key === "ai:google_ai")!;
    expect(google).toMatchObject({ source: "estimate", cents: 42, calls: 10, estimatedCalls: 1, label: "Google AI (Gemini)" });
    expect(m.totalCents).toBe(542);
    expect(m.estimateCents).toBe(42);
  });

  it("replaces the estimate with the real bill and keeps the estimate to compare", () => {
    const [m] = buildMonthCosts({ ...base, ledger: [{ month: "2026-10", provider: "gemini", cents: 42, calls: 10, estimatedCalls: 0 }], bills: [{ provider: "google_ai", month: "2026-10", usdCents: 103 }] });
    const google = m.lines.find((l) => l.key === "ai:google_ai")!;
    expect(google).toMatchObject({ source: "actual", cents: 103, estimateCents: 42 });
    expect(m.totalCents).toBe(603);
    expect(m.aiCents).toBe(103);
    expect(monthAdjustments(m)).toEqual({ recurringCents: 500, billDeltaCents: 61 });
  });

  it("counts a bill for a provider with no ledger calls (e.g. Higgsfield)", () => {
    const [m] = buildMonthCosts({ ...base, ledger: [], bills: [{ provider: "higgsfield", month: "2026-10", usdCents: 900 }] });
    expect(m.lines.find((l) => l.key === "ai:higgsfield")).toMatchObject({ source: "actual", cents: 900, estimateCents: 0 });
  });

  it("keeps costs entered on the old monthly form", () => {
    const [m] = buildMonthCosts({ ...base, recurring: [], ledger: [], bills: [], entered: [{ month: "2026-10", category: "email", amountCents: 700 }] });
    expect(m.enteredCents).toBe(700);
    expect(m.totalCents).toBe(700);
  });

  it("maps ledger providers to bill providers", () => {
    expect(billKeyForLedger("gemini")).toBe("google_ai");
    expect(billKeyForLedger("claude")).toBe("anthropic");
    expect(billKeyForLedger("elevenlabs")).toBe("elevenlabs");
    expect(billKeyForLedger("newco")).toBe("newco");
  });
});

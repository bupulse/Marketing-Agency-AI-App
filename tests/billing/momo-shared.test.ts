import { describe, expect, it } from "vitest";
import {
  cleanMomoSettings,
  formatMomoAmount,
  graceEnd,
  isReference,
  makeReference,
  momoConfigured,
  momoPriceOf,
  momoSettingsProblem,
  nextManualPeriod,
  planManualPeriod,
  proofSchema,
  REFERENCE_ALPHABET,
  reminderDue,
  usdCentsOf,
  whatsappText,
} from "@/lib/billing/momo-shared";

const d = (s: string) => new Date(s);

describe("payment reference", () => {
  it("is BP- plus unambiguous characters (no 0, O, 1 or I)", () => {
    expect(REFERENCE_ALPHABET).not.toMatch(/[01OI]/);
    for (let i = 0; i < 200; i++) {
      const ref = makeReference();
      expect(ref).toMatch(/^BP-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
      expect(isReference(ref)).toBe(true);
    }
    expect(makeReference(6)).toHaveLength(9);
    expect(makeReference(4, () => 0)).toBe("BP-AAAA");
    expect(makeReference(4, () => 0.999999)).toBe("BP-9999");
  });

  it("refuses anything else", () => {
    for (const bad of ["BP-7K30", "bp-7k3q", "BP-7K3", "7K3Q", "BP-7K3QABCD", 42, null]) expect(isReference(bad)).toBe(false);
  });
});

describe("the period a confirmed payment buys", () => {
  const now = d("2026-10-14T10:00:00Z");
  const base = { plan: "STANDARD", interval: "MONTH" as const, cancelAtPeriodEnd: false };
  it("starts now (fresh) for a trial, an ended plan or a card plan that still renews", () => {
    expect(planManualPeriod({ ...base, status: "TRIALING", currentPeriodEnd: null, provider: null }, "STANDARD", "MONTH", now)).toEqual({ mode: "fresh", start: now, end: d("2026-11-14T10:00:00Z"), daysLeft: 0 });
    expect(planManualPeriod({ ...base, status: "PAST_DUE", currentPeriodEnd: d("2026-10-10T00:00:00Z"), provider: "MANUAL_MOMO" }, "STANDARD", "MONTH", now).mode).toBe("fresh");
    expect(planManualPeriod({ ...base, status: "ACTIVE", currentPeriodEnd: d("2026-11-01T00:00:00Z"), provider: "PADDLE" }, "STANDARD", "MONTH", now).mode).toBe("fresh");
    expect(nextManualPeriod({ ...base, status: "TRIALING", currentPeriodEnd: null, provider: null }, "STANDARD", "MONTH", now)).toEqual({ start: now, end: d("2026-11-14T10:00:00Z") });
  });
  it("extends a running Mobile Money period of the same plan and interval from its end, monthly or yearly", () => {
    const sub = { ...base, status: "ACTIVE", currentPeriodEnd: d("2026-10-20T00:00:00Z"), provider: "MANUAL_MOMO" };
    expect(planManualPeriod(sub, "STANDARD", "MONTH", now)).toEqual({ mode: "extend", start: d("2026-10-20T00:00:00Z"), end: d("2026-11-20T00:00:00Z"), daysLeft: 6 });
    expect(planManualPeriod({ ...sub, interval: "YEAR" }, "STANDARD", "YEAR", now).end).toEqual(d("2027-10-20T00:00:00Z"));
  });
  it("a different plan or interval replaces the running period from now, saying how many days are given up", () => {
    const sub = { ...base, status: "ACTIVE", currentPeriodEnd: d("2026-10-20T00:00:00Z"), provider: "MANUAL_MOMO" };
    expect(planManualPeriod(sub, "PRO", "MONTH", now)).toEqual({ mode: "replace", start: now, end: d("2026-11-14T10:00:00Z"), daysLeft: 6 });
    expect(planManualPeriod(sub, "STANDARD", "YEAR", now)).toMatchObject({ mode: "replace", start: now, end: d("2027-10-14T10:00:00Z") });
  });
  it("a card plan cancelled at its period end hands over to Mobile Money from that end", () => {
    const sub = { ...base, status: "ACTIVE", currentPeriodEnd: d("2026-11-01T00:00:00Z"), provider: "PADDLE", cancelAtPeriodEnd: true };
    expect(planManualPeriod(sub, "STANDARD", "MONTH", now)).toMatchObject({ mode: "extend", start: d("2026-11-01T00:00:00Z"), end: d("2026-12-01T00:00:00Z"), daysLeft: 18 });
    expect(planManualPeriod(sub, "PRO", "MONTH", now)).toMatchObject({ mode: "replace", start: now });
  });
  it("a period that already ended (inside grace) starts now, not from the old end", () => {
    expect(planManualPeriod({ ...base, status: "ACTIVE", currentPeriodEnd: d("2026-10-13T00:00:00Z"), provider: "MANUAL_MOMO" }, "STANDARD", "MONTH", now)).toMatchObject({ mode: "fresh", start: now });
  });
  it("grace is 3 days after the end", () => {
    expect(graceEnd(d("2026-10-20T00:00:00Z"))).toEqual(d("2026-10-23T00:00:00Z"));
  });
});

describe("reminder timing", () => {
  const end = d("2026-10-20T00:00:00Z");
  it("5 days before, then 1 day before (also right after the end, inside grace), nothing earlier or after grace", () => {
    expect(reminderDue(end, d("2026-10-10T00:00:00Z"))).toBeNull();
    expect(reminderDue(end, d("2026-10-15T00:00:00Z"))).toBe("5d");
    expect(reminderDue(end, d("2026-10-17T12:00:00Z"))).toBe("5d");
    expect(reminderDue(end, d("2026-10-19T00:00:00Z"))).toBe("1d");
    expect(reminderDue(end, d("2026-10-21T00:00:00Z"))).toBe("1d");
    expect(reminderDue(end, d("2026-10-24T00:00:00Z"))).toBeNull();
  });
});

describe("money", () => {
  it("formats francs without decimals and dollars with", () => {
    expect(formatMomoAmount(15000)).toBe("15,000 RWF");
    expect(formatMomoAmount(1200, "USD")).toBe("12.00 USD");
  });
  it("converts for the USD revenue roll-up at the pricing rate", () => {
    expect(usdCentsOf(15000, "RWF", 1450)).toBe(1034);
    expect(usdCentsOf(4900, "USD", 1450)).toBe(4900);
    expect(usdCentsOf(15000, "RWF", 0)).toBe(0);
  });
  it("a plan's Mobile Money price is its regional price, and only where the region takes Mobile Money", () => {
    const rw = { monthlyPriceCents: 15000, yearlyPriceCents: 150000, currency: "RWF", paymentMethods: ["momo", "card"] };
    expect(momoPriceOf(rw, "MONTH")).toEqual({ amountMinor: 15000, currency: "RWF" });
    expect(momoPriceOf(rw, "YEAR")).toEqual({ amountMinor: 150000, currency: "RWF" });
    expect(momoPriceOf({ ...rw, currency: "usd", paymentMethods: ["card"] }, "MONTH")).toBeNull();
  });
});

describe("owner settings", () => {
  it("reads a stored row defensively and knows when Mobile Money can be offered", () => {
    expect(cleanMomoSettings(null)).toEqual({ merchantCode: "", momoNumber: "", accountName: "", airtelNumber: "" });
    expect(momoConfigured(cleanMomoSettings(null))).toBe(false);
    // A row written before R1 still carries prices and a rate: both are ignored (regional prices and the pricing setting rule).
    const s = cleanMomoSettings({ merchantCode: " 123456 ", momoNumber: "078", usdToRwf: 1300, prices: { STANDARD: { monthlyMinor: 1, yearlyMinor: 2 } } });
    expect(s).toEqual({ merchantCode: "123456", momoNumber: "078", accountName: "", airtelNumber: "" });
    expect(momoConfigured(s)).toBe(true);
  });
});

describe("what the owner may save", () => {
  const ok = { merchantCode: "123456", momoNumber: "078 123 4567", accountName: "BuPulse", airtelNumber: "+250 730 000 000" };
  it("accepts a digit code, phone numbers and a short name; refuses the rest in words", () => {
    expect(momoSettingsProblem(ok)).toBeNull();
    expect(momoSettingsProblem({ ...ok, merchantCode: "", momoNumber: "", airtelNumber: "" })).toBeNull();
    expect(momoSettingsProblem({ ...ok, merchantCode: "12AB" })).toMatch(/4 to 12 digits/);
    expect(momoSettingsProblem({ ...ok, merchantCode: "1234567890123" })).toMatch(/4 to 12 digits/);
    expect(momoSettingsProblem({ ...ok, momoNumber: "0781" })).toMatch(/MTN MoMo number must be a phone number/);
    expect(momoSettingsProblem({ ...ok, airtelNumber: "call me" })).toMatch(/Airtel Money number must be a phone number/);
    expect(momoSettingsProblem({ ...ok, accountName: "x".repeat(81) })).toMatch(/80 characters/);
  });
});

describe("what the client types", () => {
  const ok = { paymentId: "p1", transactionId: "ABC-123.4", payerPhone: "078 123 4567", network: "MTN" };
  it("accepts a transaction id, a phone and a network", () => {
    expect(proofSchema.safeParse(ok).success).toBe(true);
    expect(proofSchema.safeParse({ ...ok, payerPhone: "+250 788 123 456" }).success).toBe(true);
  });
  it("refuses a short or odd transaction id, a short phone and an unknown network", () => {
    expect(proofSchema.safeParse({ ...ok, transactionId: "ab" }).error?.issues[0].message).toMatch(/transaction id/);
    expect(proofSchema.safeParse({ ...ok, transactionId: "abc def" }).success).toBe(false);
    expect(proofSchema.safeParse({ ...ok, payerPhone: "0781" }).error?.issues[0].message).toMatch(/phone number/);
    expect(proofSchema.safeParse({ ...ok, network: "TIGO" }).error?.issues[0].message).toMatch(/MTN or Airtel/);
  });
});

describe("WhatsApp-ready text", () => {
  it("names the plan, the amount, the reference and the account", () => {
    expect(whatsappText({ planName: "Starter", amountMinor: 15000, currency: "RWF", reference: "BP-7K3Q", email: "a@b.rw" })).toBe("Hello BuPulse, I am renewing my Starter plan (15,000 RWF) by Mobile Money.\nReference: BP-7K3Q\nAccount: a@b.rw");
  });
});

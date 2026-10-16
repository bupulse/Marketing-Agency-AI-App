import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// The admin console's display currency (lib/money/display.ts, lib/money/display-server.ts): one formatter, conversion
// with "≈" and the original as tooltip, RWF exact when it was stored in RWF, stored rates winning over today's, the
// Settings fields, and the EUR rate's daily ECB refresh with its fallback.

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, cookie: undefined as string | undefined }));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (h.cookie ? { value: h.cookie } : undefined) }) }));

import { BOOKS, convertMinor, formatMoney, parseFrankfurter, showMixed, showMoney, type MoneyDisplay } from "@/lib/money/display";
import { moneyFmt } from "@/components/admin/money";
import { money } from "@/lib/admin/format";
import { cleanSetting, getSettings, setSetting } from "@/lib/admin/settings";
import { consoleContext } from "@/lib/admin/types";
import { adminMoney, defaultMoney, effectiveUsdToEur, EUR_LIVE_KEY, refreshEurRate } from "@/lib/money/display-server";
import { screenMoney, screenTotal } from "@/lib/screen/shared";
import { mrrRwf, rwfPartOf, sumRwf, type RevenueEntry } from "@/lib/money/revenue-shared";
import { paymentAmount } from "@/lib/admin/today";
import { leaderboard } from "@/lib/sales/attribution";

const rates = { usdToRwf: 1450, usdToEur: 0.92 };
const as = (currency: MoneyDisplay["currency"]): MoneyDisplay => ({ currency, rates });

beforeEach(() => {
  h.db = createFakeDb();
  h.cookie = undefined;
});

describe("formatting (one helper)", () => {
  it("RWF without decimals, USD and EUR with cents, negatives, and the admin's money() is the same helper", () => {
    expect(formatMoney(35000, "RWF")).toBe("RWF\u00a035,000");
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
    expect(formatMoney(1250, "EUR")).toBe("€12.50");
    expect(formatMoney(-500, "USD")).toBe("-$5.00");
    expect(money(35000, "RWF")).toBe(formatMoney(35000, "RWF"));
    expect(money(4900)).toBe("$49.00");
  });
});

describe("conversion", () => {
  it("USD <-> RWF <-> EUR in each currency's smallest unit, rounded", () => {
    expect(convertMinor(1000, "USD", "RWF", rates)).toBe(14500); // $10 -> 14,500 RWF
    expect(convertMinor(35000, "RWF", "USD", rates)).toBe(2414); // 24.137... -> $24.14
    expect(convertMinor(1000, "USD", "EUR", rates)).toBe(920);
    expect(convertMinor(35000, "RWF", "EUR", rates)).toBe(2221);
    expect(convertMinor(999, "USD", "USD", rates)).toBe(999);
    expect(convertMinor(1, "GBP", "USD", rates)).toBeNull();
  });

  it("a stored RWF rate wins over today's", () => {
    expect(convertMinor(1000, "USD", "RWF", rates, 1300)).toBe(13000);
    expect(convertMinor(13000, "RWF", "USD", rates, 1300)).toBe(1000);
  });

  it("shown exactly in its own currency; converted with ≈ and the original as tooltip", () => {
    expect(showMoney(35000, "RWF", as("RWF"))).toEqual({ text: "RWF\u00a035,000", approx: false, title: null });
    expect(showMoney(35000, "RWF", as("USD"))).toEqual({ text: "≈ $24.14", approx: true, title: "RWF\u00a035,000" });
    expect(showMoney(4900, "USD", as("RWF"))).toEqual({ text: "≈ RWF\u00a071,050", approx: true, title: "$49.00" });
    expect(showMoney(4900, "USD", as("EUR"))).toMatchObject({ text: "≈ €45.08", title: "$49.00" });
    expect(showMoney(1000, "USD", as("RWF"), { rwfRate: 1300 })).toMatchObject({ text: "≈ RWF\u00a013,000", title: "$10.00 (at 1,300 RWF/USD)" });
    // No rate for that currency: stays as stored, never invented.
    expect(showMoney(500, "GBP", as("RWF"))).toEqual({ text: "£5.00", approx: false, title: null });
  });

  it("totals with an RWF part: the RWF received is exact in RWF (no round trip through USD), only the rest converted", () => {
    // 35,000 RWF fixed at $25.00 (rate 1,400 that day) plus a $49.00 card payment.
    const total = { usdCents: 7400, rwfMinor: 35000, rwfUsdCents: 2500 };
    expect(showMixed(total, as("RWF"))).toMatchObject({ text: "≈ RWF\u00a0106,050", approx: true });
    expect(showMixed({ usdCents: 2500, rwfMinor: 35000, rwfUsdCents: 2500 }, as("RWF"))).toEqual({ text: "RWF\u00a035,000", approx: false, title: null });
    expect(showMixed(total, as("USD"))).toMatchObject({ text: "$74.00", approx: false });
    expect(showMixed(total, as("EUR"))).toMatchObject({ text: "≈ €68.08", approx: true });
  });

  it("the page helper: text, tooltip and the default (the books, USD, nothing converted)", () => {
    const fx = moneyFmt(as("RWF"));
    expect(fx.text(4900)).toBe("≈ RWF\u00a071,050");
    expect(fx.title(4900)).toBe("$49.00");
    expect(fx.title(35000, "RWF")).toBeUndefined();
    expect(moneyFmt(BOOKS).text(4900)).toBe("$49.00");
  });

  it("reads the ECB answer of api.frankfurter.app, and refuses nonsense", () => {
    expect(parseFrankfurter({ amount: 1, base: "USD", date: "2026-10-13", rates: { EUR: 0.9214 } })).toBe(0.9214);
    expect(parseFrankfurter({ rates: { EUR: 0 } })).toBeNull();
    expect(parseFrankfurter({ rates: {} })).toBeNull();
    expect(parseFrankfurter(null)).toBeNull();
  });
});

describe("settings", () => {
  it("default currency RWF | USD | EUR, the EUR rate 0.1 to 10, the refresh switch", () => {
    expect(cleanSetting.displayCurrency("eur")).toBe("EUR");
    expect(() => cleanSetting.displayCurrency("GBP")).toThrow(/RWF, USD or EUR/);
    expect(cleanSetting.usdToEur("0.93")).toBe(0.93);
    expect(() => cleanSetting.usdToEur("50")).toThrow(/USD to EUR/);
    expect(cleanSetting.eurRateAuto("on")).toBe(true);
    expect(cleanSetting.eurRateAuto(false)).toBe(false);
  });

  it("defaults (USD, 0.92, refresh off); saved values are audited; the admin's cookie wins over the default", async () => {
    expect(await getSettings()).toMatchObject({ displayCurrency: "USD", usdToEur: 0.92, eurRateAuto: false });
    await setSetting(consoleContext("198.51.100.1"), "displayCurrency", "RWF");
    await setSetting(consoleContext("198.51.100.1"), "usdToEur", "0.95");
    expect(h.db.auditLog.rows.filter((r) => r.action === "update_setting")).toHaveLength(2);
    expect(await adminMoney()).toEqual({ currency: "RWF", rates: { usdToRwf: (await getSettings()).usdToRwf, usdToEur: 0.95 } });
    h.cookie = "EUR";
    expect((await adminMoney()).currency).toBe("EUR");
    h.cookie = "XYZ"; // a tampered cookie falls back to the default
    expect((await adminMoney()).currency).toBe("RWF");
  });
});

describe("the EUR rate's daily refresh (ECB, free)", () => {
  const ecb = (rate: unknown, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => ({ rates: { EUR: rate } }) })) as unknown as typeof fetch;

  it("off: nothing is fetched and the stored rate is used", async () => {
    const fetchImpl = ecb(0.9);
    expect(await refreshEurRate({ fetchImpl })).toEqual({ ok: false, rate: null });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await effectiveUsdToEur({ usdToEur: 0.92, eurRateAuto: false })).toMatchObject({ rate: 0.92, source: "settings" });
  });

  it("on: the ECB rate is stored and used while fresh; a failed fetch keeps the stored rate; an old one falls back", async () => {
    await setSetting(consoleContext(null), "eurRateAuto", true);
    const now = new Date("2026-10-13T06:00:00Z");
    expect(await refreshEurRate({ fetchImpl: ecb(0.9131), now })).toEqual({ ok: true, rate: 0.9131 });
    expect(h.db.adminSetting.rows.find((r) => r.key === EUR_LIVE_KEY)?.value).toEqual({ rate: 0.9131, fetchedAt: now.toISOString() });
    expect(await effectiveUsdToEur({ usdToEur: 0.92, eurRateAuto: true }, new Date("2026-10-14T06:00:00Z"))).toMatchObject({ rate: 0.9131, source: "ecb" });
    // The API is down: the last good rate stays, nothing is overwritten.
    expect(await refreshEurRate({ fetchImpl: ecb(null, false), now: new Date("2026-10-14T06:00:00Z") })).toEqual({ ok: false, rate: null });
    expect(h.db.adminSetting.rows.find((r) => r.key === EUR_LIVE_KEY)?.value).toMatchObject({ rate: 0.9131 });
    // More than 3 days without a fresh rate: the stored Settings rate.
    expect(await effectiveUsdToEur({ usdToEur: 0.92, eurRateAuto: true }, new Date("2026-10-20T06:00:00Z"))).toMatchObject({ rate: 0.92, source: "settings" });
    // "Refresh now" fetches even with the switch off.
    await setSetting(consoleContext(null), "eurRateAuto", false);
    expect(await refreshEurRate({ force: true, fetchImpl: ecb(0.95), now })).toEqual({ ok: true, rate: 0.95 });
  });
});

describe("the sales room TV", () => {
  it("uses the default currency from Settings, never an admin's cookie", async () => {
    await setSetting(consoleContext(null), "displayCurrency", "RWF");
    h.cookie = "EUR";
    expect((await defaultMoney()).currency).toBe("RWF");
  });

  it("a payment made in RWF shows its exact RWF amount on the celebration card; others are converted with ≈", () => {
    const rwf = as("RWF");
    expect(screenMoney(rwf, 2414, { minor: 35000, currency: "RWF" })).toBe("RWF\u00a035,000");
    expect(screenMoney(rwf, 4900, { minor: 4900, currency: "USD" })).toBe("≈ RWF\u00a071,050");
    expect(screenMoney(as("USD"), 4900, { minor: 4900, currency: "USD" })).toBe("$49.00");
    expect(screenTotal(rwf, 2500, 35000, 2500)).toBe("RWF\u00a035,000");
  });
});

describe("RWF payments add up exactly (no trip through USD)", () => {
  const rwfPay = (id: string, rwf: number, usdCents: number, userId = "u1", over: Partial<RevenueEntry> = {}): RevenueEntry => ({ id, at: new Date("2026-10-13T08:00:00Z"), month: "2026-10", userId, kind: "payment", usdCents, method: "momo", localMinor: rwf, currency: "RWF", plan: "STANDARD", priceId: null, partial: false, ...over });
  const card = (id: string, usdCents: number, userId = "u2"): RevenueEntry => ({ id, at: new Date("2026-10-13T08:00:00Z"), month: "2026-10", userId, kind: "payment", usdCents, method: "card", localMinor: usdCents, currency: "USD", plan: "PRO", priceId: null, partial: false });

  it("one 98,000 RWF payment (booked at $67.59) shows RWF 98,000 exactly in RWF, $67.59 in USD", () => {
    const part = rwfPartOf([rwfPay("a", 98000, 6759)]);
    const fx = moneyFmt(as("RWF"));
    expect(fx.amount(6759, part)).toBe("RWF 98,000");
    expect(moneyFmt(as("USD")).amount(6759, part)).toBe("$67.59");
    // Profit: the costs (USD) are converted, so the figure is approximate.
    expect(fx.amount(6759 - 1000, part)).toBe(`≈ RWF ${(98000 - 14500).toLocaleString("en-US")}`);
  });

  it("Today's payments: the original amount in its own currency; in USD with the RWF in brackets", () => {
    const e = { usdCents: 6759, localMinor: 98000, currency: "RWF" };
    expect(paymentAmount(e, as("RWF"))).toBe("RWF 98,000");
    expect(paymentAmount(e, as("USD"))).toBe("$67.59 (RWF 98,000)");
    expect(paymentAmount(e, as("EUR"))).toBe("≈ €62.18");
    expect(paymentAmount({ usdCents: 4900, localMinor: 4900, currency: "USD" }, as("RWF"))).toBe("≈ RWF 71,050");
  });

  it("MRR and ARPU of Mobile Money clients keep their RWF; a yearly payment is a twelfth", () => {
    const entries = [rwfPay("a", 98000, 6759, "u1"), rwfPay("b", 1200000, 82759, "u3"), card("c", 4900, "u2")];
    const subs = [{ userId: "u1", plan: "STANDARD", interval: "MONTH", provider: "MANUAL_MOMO" }, { userId: "u3", plan: "STANDARD", interval: "YEAR", provider: "MANUAL_MOMO" }, { userId: "u2", plan: "PRO", interval: "MONTH", provider: "PADDLE" }];
    const byUser = new Map([["u1", 6759], ["u3", 6897], ["u2", 4900]]);
    const parts = mrrRwf(subs, entries, byUser);
    expect(parts.get("u1")).toEqual({ rwfMinor: 98000, rwfUsdCents: 6759 });
    expect(parts.get("u3")).toEqual({ rwfMinor: 100000, rwfUsdCents: 6897 });
    expect(parts.has("u2")).toBe(false);
    expect(sumRwf(parts.values(), 3)).toEqual({ rwfMinor: 66000, rwfUsdCents: 4552 });
  });

  it("the leaderboard keeps each agent's RWF exact, the team share split equally", () => {
    const rows = leaderboard({ entries: [rwfPay("a", 98000, 6759, "u1"), rwfPay("b", 30000, 2069, "u9")], assignments: [{ userId: "u1", staffId: "A", startsAt: new Date("2026-01-01T00:00:00Z"), endsAt: null }], agents: [{ staffId: "A", name: "Alice" }, { staffId: "B", name: "Bob" }] });
    const alice = rows.find((r) => r.staffId === "A")!;
    expect(alice.ownRwf).toEqual({ rwfMinor: 98000, rwfUsdCents: 6759 });
    expect(alice.teamShareRwf).toEqual({ rwfMinor: 15000, rwfUsdCents: 1035 });
    expect(moneyFmt(as("RWF")).amount(alice.totalCents, alice.totalRwf)).toBe("RWF 113,000");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// Which plans each region offers and at what price (lib/region-prices.ts), the admin price service, and the company region.

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/billing/paddle-catalog", () => ({ paddleConnected: () => false, createPaddleProduct: vi.fn(), createPaddlePrice: vi.fn(), archivePaddlePrice: vi.fn(), updatePaddleProduct: vi.fn() }));

import { getRegionPlans, regionPriceIdFor, resetRegionPriceCache } from "@/lib/region-prices";
import { companyRegion, regionFromCountryName, resetRegionCache } from "@/lib/region";
import { recomputeCardPrices, removeRegionPrice, saveRegion, setCompanyRegion, setRegionPrice } from "@/lib/admin/regions-service";
import { setSetting } from "@/lib/admin/settings";
import { resetPlanCache } from "@/lib/plan-catalog";
import { consoleContext, type AdminError } from "@/lib/admin/types";

const CONSOLE = consoleContext("198.51.100.1");
const code = async (p: Promise<unknown>) => p.then(() => null, (e: AdminError) => `${e.code}: ${e.message}`);

/** What the migration seeds: the three regions, the two Rwanda plans, and the prices per region. */
function seed() {
  h.db.pricingRegion.rows.push(
    { key: "RW", name: "Rwanda", currency: "RWF", countries: ["RW"], paymentMethods: ["momo", "card"], active: true, sortOrder: 0 },
    { key: "EAC", name: "East Africa", currency: "USD", countries: ["KE", "UG", "TZ", "BI", "SS", "CD", "SO"], paymentMethods: ["card"], active: true, sortOrder: 10 },
    { key: "GLOBAL", name: "Everywhere else", currency: "USD", countries: [], paymentMethods: ["card"], active: true, sortOrder: 20 },
  );
  const rwPlan = (key: string, name: string, sortOrder: number, text: number, image: number, seats: number, highlight: boolean) => ({
    id: `plan_${key.toLowerCase()}`, key, name, description: "", isTrial: false, trialDays: null, status: "active", sortOrder, highlight, monthlyPriceCents: 1200, yearlyPriceCents: 11600, currency: "USD",
    limits: { text, image, chat: 0, videoSeconds: 0, voiceCharacters: 0, seats }, highlights: [`${text} AI texts`], featureKeys: ["content", "designs", "calendar", "gallery"], features: [], capabilities: {}, paddlePrices: [], syncState: "not_synced", syncError: null, createdAt: new Date(), updatedAt: new Date(),
  });
  h.db.planDefinition.rows.push(rwPlan("STARTER", "Starter", 5, 60, 30, 1, false), rwPlan("BUSINESS", "Business", 6, 200, 100, 3, true));
  const price = (planKey: string, regionKey: string, currency: string, monthlyMinor: number, yearlyMinor: number, card?: [number, number]) => ({
    id: `prp_${planKey}_${regionKey}`, planKey, regionKey, currency, monthlyMinor, yearlyMinor, cardMonthlyUsdCents: card?.[0] ?? (currency === "USD" ? monthlyMinor : null), cardYearlyUsdCents: card?.[1] ?? (currency === "USD" ? yearlyMinor : null), paddleMonthlyPriceId: null, paddleYearlyPriceId: null, updatedAt: new Date(),
  });
  h.db.planRegionPrice.rows.push(
    price("STANDARD", "GLOBAL", "USD", 4900, 49000), price("PRO", "GLOBAL", "USD", 9900, 99000),
    price("STANDARD", "EAC", "USD", 2500, 25000), price("PRO", "EAC", "USD", 4900, 49000),
    price("STARTER", "RW", "RWF", 15000, 150000, [1200, 11600]), price("BUSINESS", "RW", "RWF", 35000, 350000, [2800, 27100]),
  );
}

beforeEach(() => {
  h.db = createFakeDb();
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  seed();
});

describe("plans by region", () => {
  it("Rwanda sees Starter and Business in RWF with card prices and both payment methods", async () => {
    const plans = await getRegionPlans("RW");
    expect(plans.map((p) => [p.key, p.currency, p.monthlyPriceCents, p.yearlyPriceCents])).toEqual([["STARTER", "RWF", 15000, 150000], ["BUSINESS", "RWF", 35000, 350000]]);
    expect(plans[0].card).toEqual({ monthlyUsdCents: 1200, yearlyUsdCents: 11600 });
    expect(plans[0].paymentMethods).toEqual(["momo", "card"]);
    expect(plans[0].features).toEqual(["content", "designs", "calendar", "gallery"]);
  });

  it("East Africa sees Standard $25 and Pro $49; the rest of the world keeps $49 and $99 from the plan builder", async () => {
    expect((await getRegionPlans("EAC")).map((p) => [p.key, p.monthlyPriceCents, p.yearlyPriceCents, p.card])).toEqual([["STANDARD", 2500, 25000, null], ["PRO", 4900, 49000, null]]);
    expect((await getRegionPlans("GLOBAL")).map((p) => [p.key, p.monthlyPriceCents, p.currency])).toEqual([["STANDARD", 4900, "USD"], ["PRO", 9900, "USD"]]);
    expect(await getRegionPlans("MARS")).toEqual([]);
  });

  it("a plan with no regional price at all is offered in GLOBAL at its own price, and a hidden plan nowhere", async () => {
    h.db.planDefinition.rows.push({ ...h.db.planDefinition.rows.find((r) => r.key === "PRO")!, id: "plan_new", key: "NEW", name: "New", monthlyPriceCents: 1500, yearlyPriceCents: 15000, sortOrder: 30 });
    h.db.planDefinition.rows.push({ ...h.db.planDefinition.rows.find((r) => r.key === "PRO")!, id: "plan_hid", key: "HID", name: "Hidden", status: "hidden", sortOrder: 31 });
    resetPlanCache();
    expect((await getRegionPlans("GLOBAL")).map((p) => p.key)).toEqual(["STANDARD", "PRO", "NEW"]);
    expect((await getRegionPlans("RW")).map((p) => p.key)).toEqual(["STARTER", "BUSINESS"]);
  });

  it("price ids: GLOBAL uses the plan's own (env fallback), other regions wait for the Paddle sync", async () => {
    process.env.PADDLE_PRICE_STANDARD_MONTH = "pri_std_m";
    expect(await regionPriceIdFor("PADDLE", "STANDARD", "GLOBAL", "MONTH")).toBe("pri_std_m");
    expect(await regionPriceIdFor("PADDLE", "STANDARD", "EAC", "MONTH")).toBeNull();
    expect(await regionPriceIdFor("PADDLE", "STARTER", "GLOBAL", "MONTH")).toBeNull(); // not offered there
    h.db.planRegionPrice.rows.find((r) => r.planKey === "STANDARD" && r.regionKey === "EAC")!.paddleMonthlyPriceId = "pri_eac_m";
    resetRegionPriceCache();
    expect(await regionPriceIdFor("PADDLE", "STANDARD", "EAC", "MONTH")).toBe("pri_eac_m");
    delete process.env.PADDLE_PRICE_STANDARD_MONTH;
  });
});

describe("company region", () => {
  it("comes from the business row and falls back to the catch-all", async () => {
    h.db.business.rows.push({ id: "b_rw", userId: "u1", pricingRegion: "RW" }, { id: "b_old", userId: "u2", pricingRegion: "GONE" });
    expect((await companyRegion("b_rw")).key).toBe("RW");
    expect((await companyRegion("b_old")).key).toBe("GLOBAL");
    expect((await companyRegion("nobody")).key).toBe("GLOBAL");
    expect(await regionFromCountryName("Uganda")).toBe("EAC");
  });

  it("an admin can move a company, audited", async () => {
    h.db.business.rows.push({ id: "b1", userId: "u1", pricingRegion: "GLOBAL" });
    expect(await setCompanyRegion(CONSOLE, { businessId: "b1", regionKey: "rw" })).toMatchObject({ pricingRegion: "RW", changed: true });
    expect(h.db.business.rows[0].pricingRegion).toBe("RW");
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ action: "update_company_region", target: "business:b1", before: { pricingRegion: "GLOBAL" }, after: { pricingRegion: "RW" } });
    expect(await code(setCompanyRegion(CONSOLE, { businessId: "b1", regionKey: "MARS" }))).toMatch(/^not_found/);
  });
});

describe("admin prices", () => {
  it("sets a regional price with the derived card price, clears stale Paddle ids, and audits", async () => {
    const row = await setRegionPrice(CONSOLE, { planKey: "PRO", regionKey: "RW", monthlyMinor: 70000, yearlyMinor: 700000 });
    expect(row).toMatchObject({ currency: "RWF", monthlyMinor: 70000, cardMonthlyUsdCents: 5500, cardYearlyUsdCents: 54100 }); // 48.28 * 1.12 = 54.07 -> $55
    expect((await getRegionPlans("RW")).map((p) => p.key)).toEqual(["STARTER", "BUSINESS", "PRO"]);
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ action: "create_region_price", target: "plan:PRO" });
    h.db.planRegionPrice.rows.find((r) => r.planKey === "PRO" && r.regionKey === "RW")!.paddleMonthlyPriceId = "pri_x";
    await setRegionPrice(CONSOLE, { planKey: "PRO", regionKey: "RW", monthlyMinor: 65000, yearlyMinor: 650000 });
    expect(h.db.planRegionPrice.rows.find((r) => r.planKey === "PRO" && r.regionKey === "RW")).toMatchObject({ monthlyMinor: 65000, paddleMonthlyPriceId: null });
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ action: "update_region_price" });
  });

  it("refuses GLOBAL (plan builder), the trial, unknown plans and bad amounts", async () => {
    expect(await code(setRegionPrice(CONSOLE, { planKey: "PRO", regionKey: "GLOBAL", monthlyMinor: 1, yearlyMinor: 1 }))).toMatch(/^conflict: .*Plans/);
    expect(await code(setRegionPrice(CONSOLE, { planKey: "TRIAL", regionKey: "RW", monthlyMinor: 1, yearlyMinor: 1 }))).toMatch(/^conflict/);
    expect(await code(setRegionPrice(CONSOLE, { planKey: "NOPE", regionKey: "RW", monthlyMinor: 1, yearlyMinor: 1 }))).toMatch(/^not_found/);
    expect(await code(setRegionPrice(CONSOLE, { planKey: "PRO", regionKey: "RW", monthlyMinor: 0, yearlyMinor: 1 }))).toMatch(/^invalid/);
  });

  it("recomputes card prices from the settings, and removing a price stops the offer", async () => {
    await setSetting(CONSOLE, "usdToRwf", 1300);
    expect(await recomputeCardPrices(CONSOLE)).toEqual({ changed: 2 });
    const starter = h.db.planRegionPrice.rows.find((r) => r.planKey === "STARTER")!;
    expect(starter.cardMonthlyUsdCents).toBe(1300); // 15000/1300*1.12 = 12.92 -> $13
    expect(await recomputeCardPrices(CONSOLE)).toEqual({ changed: 0 });
    await removeRegionPrice(CONSOLE, { planKey: "STARTER", regionKey: "RW" });
    expect((await getRegionPlans("RW")).map((p) => p.key)).toEqual(["BUSINESS"]);
    expect(await code(removeRegionPrice(CONSOLE, { planKey: "STARTER", regionKey: "RW" }))).toMatch(/^not_found/);
  });

  it("validates regions: one catch-all, no shared countries, the catch-all cannot be switched off", async () => {
    expect(await code(saveRegion(CONSOLE, { key: "GLOBAL", name: "Rest", currency: "USD", countries: [], paymentMethods: ["card"], active: false }))).toMatch(/^conflict/);
    expect(await code(saveRegion(CONSOLE, { key: "KE", name: "Kenya", currency: "KES", countries: ["KE"], paymentMethods: ["card"] }))).toMatch(/^conflict: East Africa already lists KE/);
    expect(await code(saveRegion(CONSOLE, { key: "ke", name: "Kenya", currency: "KES", countries: ["KE"], paymentMethods: [] }))).toMatch(/^invalid/);
    const made = await saveRegion(CONSOLE, { key: "ng", name: "Nigeria", currency: "NGN", countries: ["ng"], paymentMethods: ["card"], sortOrder: 15 });
    expect(made).toMatchObject({ key: "NG", countries: ["NG"], currency: "NGN", active: true });
    expect(await regionFromCountryName("Nigeria")).toBe("GLOBAL"); // no name mapping for it; the code path is by ISO code
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ action: "create_region", target: "region:NG" });
  });

  it("settings are validated", async () => {
    expect(await code(setSetting(CONSOLE, "trialDays", 0))).toMatch(/^invalid/);
    expect(await setSetting(CONSOLE, "trialDays", "5")).toBe(5);
    expect(await code(setSetting(CONSOLE, "meetingLink", "meet.google.com/x"))).toMatch(/^invalid/);
    expect(await setSetting(CONSOLE, "meetingLink", "https://meet.google.com/abc-defg-hij")).toBe("https://meet.google.com/abc-defg-hij");
    expect(await setSetting(CONSOLE, "blockedDates", "2026-12-25\n2026-12-26, 2026-12-25")).toEqual(["2026-12-25", "2026-12-26"]);
    expect(await code(setSetting(CONSOLE, "blockedDates", "2026-13-01"))).toMatch(/^invalid/);
    expect(await code(setSetting(CONSOLE, "slotMinutes", 32))).toMatch(/^invalid/);
    expect(h.db.auditLog.rows.filter((r) => r.action === "update_setting")).toHaveLength(4);
  });
});

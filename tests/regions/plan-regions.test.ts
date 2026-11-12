import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// Regions with Live / Coming soon, their countries (one region per country), which regions a plan is shown in, how a
// visitor is matched to a region, and VAT per region (docs/REGIONS.md).

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/billing/paddle-catalog", () => ({ paddleConnected: () => false, createPaddleProduct: vi.fn(), createPaddlePrice: vi.fn(), archivePaddlePrice: vi.fn(), updatePaddleProduct: vi.fn() }));

import { getRegionPlans, regionalPlansFor, resetRegionPriceCache } from "@/lib/region-prices";
import { regionFromCountryCode, resetRegionCache, resolveDisplay, resolveDisplayRegionKey } from "@/lib/region";
import { checkPlanRegions, countryClashes, deleteRegion, moveRegion, planRegionOptions, regionKeyFromName, saveRegion, setPlanRegions } from "@/lib/admin/regions-service";
import { resetPlanCache, getPlans } from "@/lib/plan-catalog";
import { consoleContext, type AdminError } from "@/lib/admin/types";
import { comingSoonRegionFor, COUNTRY_CODES, REGION_SEEDS, regionKeyForCountryCode, type RegionInfo } from "@/lib/region-format";
import { ISO_COUNTRIES, ISO_COUNTRY_CODES } from "@/lib/iso-countries";
import { formatVatRate, parseVatPercent, vatMinorOf, vatOf, vatPercentOf, vatSentence, withVat } from "@/lib/vat";
import { computeTotals } from "@/lib/invoices/shared";
import { revenueByMonth, toRevenueEntry } from "@/lib/money/revenue-shared";

const CONSOLE = consoleContext("198.51.100.1");
const code = async (p: Promise<unknown>) => p.then(() => null, (e: AdminError) => `${e.code}: ${e.message}`);
const copy = (r: RegionInfo) => ({ ...r, countries: [...r.countries], paymentMethods: [...r.paymentMethods] });

const AFRICA = ["DZ", "AO", "BJ", "BW", "BF", "BI", "CV", "CM", "CF", "TD", "KM", "CG", "CD", "CI", "DJ", "EG", "GQ", "ER", "SZ", "ET", "GA", "GM", "GH", "GN", "GW", "KE", "LS", "LR", "LY", "MG", "MW", "ML", "MR", "MU", "MA", "MZ", "NA", "NE", "NG", "RW", "ST", "SN", "SC", "SL", "SO", "ZA", "SS", "SD", "TZ", "TG", "TN", "UG", "ZM", "ZW"];

/** The migration's state: the seeded regions, the Rwanda plans priced in RW only, Standard and Pro in East Africa and the rest of the world. */
function seed() {
  h.db.pricingRegion.rows.push(...REGION_SEEDS.map(copy));
  const plan = (key: string, name: string, sortOrder: number, monthly: number) => ({
    id: `plan_${key.toLowerCase()}`, key, name, description: "", isTrial: false, trialDays: null, status: "active", sortOrder, highlight: false, monthlyPriceCents: monthly, yearlyPriceCents: monthly * 10, currency: "USD", isCustom: false,
    limits: { text: 60, image: 30, chat: 0, videos: 0, voiceCharacters: 0, seats: 1 }, highlights: [], featureKeys: ["content"], features: [], capabilities: {}, paddlePrices: [], syncState: "not_synced", syncError: null, createdAt: new Date(), updatedAt: new Date(),
  });
  h.db.planDefinition.rows.push(plan("STARTER", "Starter", 5, 1200), plan("BUSINESS", "Business", 6, 3800));
  const price = (planKey: string, regionKey: string, currency: string, monthlyMinor: number) => ({ id: `prp_${planKey}_${regionKey}`, planKey, regionKey, currency, monthlyMinor, yearlyMinor: monthlyMinor * 10, cardMonthlyUsdCents: currency === "USD" ? monthlyMinor : 1200, cardYearlyUsdCents: currency === "USD" ? monthlyMinor * 10 : 11600, paddleMonthlyPriceId: null, paddleYearlyPriceId: null, updatedAt: new Date() });
  h.db.planRegionPrice.rows.push(
    price("STANDARD", "GLOBAL", "USD", 4900), price("PRO", "GLOBAL", "USD", 9900),
    price("STANDARD", "EAC", "USD", 2500), price("PRO", "EAC", "USD", 4900),
    price("STARTER", "RW", "RWF", 15000), price("BUSINESS", "RW", "RWF", 50000),
  );
}

beforeEach(() => {
  h.db = createFakeDb();
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  seed();
});

describe("the seeded regions", () => {
  it("every country is in at most one region, every code is ISO, and every African country is in a region", () => {
    const seen = new Map<string, string>();
    for (const r of REGION_SEEDS) for (const c of r.countries) {
      expect(seen.get(c), `${c} is in ${seen.get(c)} and ${r.key}`).toBeUndefined();
      expect(ISO_COUNTRIES[c], `${c} is not an ISO code`).toBeDefined();
      seen.set(c, r.key);
    }
    for (const c of AFRICA) expect(seen.has(c), `${c} has no region`).toBe(true);
    expect(seen.get("RW")).toBe("RW");
    expect(seen.get("KE")).toBe("EAC");
    expect(seen.get("NG")).toBe("WEST_AFRICA");
  });

  it("Rwanda, East Africa and the rest of the world are live; the others are coming soon; Rwanda has 18% VAT", () => {
    expect(REGION_SEEDS.filter((r) => r.active).map((r) => r.key)).toEqual(["RW", "EAC", "GLOBAL"]);
    expect(REGION_SEEDS.find((r) => r.key === "GLOBAL")).toMatchObject({ name: "Rest of the world", countries: [] });
    expect(REGION_SEEDS.find((r) => r.key === "RW")?.vatRateBps).toBe(1800);
    expect(REGION_SEEDS.filter((r) => (r.vatRateBps ?? 0) > 0).map((r) => r.key)).toEqual(["RW"]);
  });

  it("the ISO list has 250 unique codes (Kosovo included) and holds every sign-up country", () => {
    expect(ISO_COUNTRY_CODES).toHaveLength(250);
    for (const c of Object.values(COUNTRY_CODES)) expect(ISO_COUNTRIES[c], c).toBeDefined();
  });
});

describe("which region a visitor gets", () => {
  it("a live region's country gets it; a coming-soon region's country, an unknown code or none gets the rest of the world", () => {
    expect(regionKeyForCountryCode("RW", REGION_SEEDS)).toBe("RW");
    expect(regionKeyForCountryCode("ke", REGION_SEEDS)).toBe("EAC");
    expect(regionKeyForCountryCode("ET", REGION_SEEDS)).toBe("EAC");
    expect(regionKeyForCountryCode("NG", REGION_SEEDS)).toBe("GLOBAL"); // West Africa is coming soon
    expect(regionKeyForCountryCode("US", REGION_SEEDS)).toBe("GLOBAL");
    expect(regionKeyForCountryCode("ZZ", REGION_SEEDS)).toBe("GLOBAL");
    expect(regionKeyForCountryCode(null, REGION_SEEDS)).toBe("GLOBAL");
    expect(comingSoonRegionFor("NG", REGION_SEEDS)?.name).toBe("West Africa");
    expect(comingSoonRegionFor("KE", REGION_SEEDS)).toBeNull();
  });

  it("precedence: when two live regions list a country (older data), the smaller region wins, then the lower order", () => {
    const regions = REGION_SEEDS.map((r) => (r.key === "EAC" ? { ...r, countries: [...r.countries, "RW"] } : r));
    expect(regionKeyForCountryCode("RW", regions)).toBe("RW");
    const tie = [...regions, { key: "KE1", name: "Kenya", currency: "KES", countries: ["KE"], paymentMethods: ["card" as const], active: true, sortOrder: 50 }];
    expect(regionKeyForCountryCode("KE", tie)).toBe("KE1");
  });

  it("a coming-soon region going live takes its countries at once", async () => {
    h.db.pricingRegion.rows.find((r) => r.key === "WEST_AFRICA")!.active = true;
    resetRegionCache();
    expect(await regionFromCountryCode("NG")).toBe("WEST_AFRICA");
  });

  it("the dev override takes a live region key or a country code (?region=KE); a coming-soon key is ignored", () => {
    expect(resolveDisplayRegionKey({ query: "KE", ip: "RW" }, REGION_SEEDS)).toBe("EAC");
    expect(resolveDisplayRegionKey({ query: "NG", ip: "RW" }, REGION_SEEDS)).toBe("GLOBAL");
    expect(resolveDisplayRegionKey({ query: "us" }, REGION_SEEDS)).toBe("GLOBAL");
    expect(resolveDisplayRegionKey({ query: "EAC", ip: "RW" }, REGION_SEEDS)).toBe("EAC");
    expect(resolveDisplayRegionKey({ query: "WEST_AFRICA", ip: "RW" }, REGION_SEEDS)).toBe("RW");
    expect(resolveDisplayRegionKey({ cookie: "RW", ip: "US" }, REGION_SEEDS)).toBe("RW");
    expect(resolveDisplay({ ip: "NG" }, REGION_SEEDS)).toEqual({ key: "GLOBAL", country: "NG" });
  });
});

describe("plans per region", () => {
  it("each live region sees only its plans; a coming-soon region offers nothing to anyone", async () => {
    expect((await getRegionPlans("RW")).map((p) => p.key)).toEqual(["STARTER", "BUSINESS"]);
    expect((await getRegionPlans("EAC")).map((p) => p.key)).toEqual(["STANDARD", "PRO"]);
    expect((await getRegionPlans("GLOBAL")).map((p) => p.key)).toEqual(["STANDARD", "PRO"]);
    expect(await getRegionPlans("WEST_AFRICA")).toEqual([]);
  });

  it("Rwanda's plans carry 18% VAT on top; East Africa and the rest of the world carry none", async () => {
    const [starter, business] = await getRegionPlans("RW");
    expect(starter.monthlyPriceCents).toBe(15000); // before VAT
    expect(business.vat).toEqual({ rateBps: 1800, label: "VAT", monthly: { netMinor: 50000, vatMinor: 9000, totalMinor: 59000, rateBps: 1800, label: "VAT" }, yearly: { netMinor: 500000, vatMinor: 90000, totalMinor: 590000, rateBps: 1800, label: "VAT" } });
    expect((await getRegionPlans("EAC"))[0].vat).toBeNull();
    expect((await getRegionPlans("GLOBAL"))[0].vat).toBeNull();
  });

  it("a region at 0% shows no VAT, whatever its label", async () => {
    const plans = await getPlans();
    const rw = { ...REGION_SEEDS[0], vatRateBps: 0, vatLabel: "TVA" };
    const prices = h.db.planRegionPrice.rows.map((r) => ({ ...r })) as never;
    expect(regionalPlansFor(plans, prices, rw).every((p) => p.vat === null)).toBe(true);
  });
});

describe("VAT maths", () => {
  it("adds the rate on top, rounded to the currency's smallest unit (whole francs)", () => {
    expect(vatMinorOf(50000, 1800)).toBe(9000);
    expect(vatMinorOf(15000, 1800)).toBe(2700);
    expect(vatMinorOf(33333, 1800)).toBe(6000); // 5999.94 -> 6,000 RWF
    expect(vatMinorOf(4999, 1650)).toBe(825); // 824.835 cents -> 825
    expect(vatMinorOf(50000, 0)).toBe(0);
    expect(withVat(50000, { rateBps: 1800, label: "VAT" })).toEqual({ netMinor: 50000, vatMinor: 9000, totalMinor: 59000, rateBps: 1800, label: "VAT" });
    expect(withVat(50000, null)).toMatchObject({ vatMinor: 0, totalMinor: 50000, rateBps: 0 });
  });

  it("reads and prints rates, and says the price in one line", () => {
    expect(parseVatPercent("18")).toBe(1800);
    expect(parseVatPercent("16.5%")).toBe(1650);
    expect(parseVatPercent("")).toBe(0);
    expect(parseVatPercent("101")).toBeNull();
    expect(parseVatPercent("abc")).toBeNull();
    expect(formatVatRate(1800)).toBe("18%");
    expect(formatVatRate(1650)).toBe("16.5%");
    expect(vatOf({ vatRateBps: 0 })).toBeNull();
    expect(vatOf({ vatRateBps: 1800, vatLabel: "" })).toEqual({ rateBps: 1800, label: "VAT" });
    expect(vatSentence(withVat(50000, { rateBps: 1800, label: "VAT" }), "RWF")).toBe("50,000 + 9,000 VAT = 59,000 RWF");
    expect(vatSentence(withVat(4900, null), "USD")).toBe("$49");
  });

  it("an invoice at Rwanda's rate: subtotal 50,000, VAT 18% 9,000, total 59,000 (the rate is stored on it)", () => {
    expect(vatPercentOf(1800)).toBe(18);
    expect(vatPercentOf(0)).toBeNull();
    expect(computeTotals([{ description: "Business plan", quantity: 1, unitMinor: 50000 }], vatPercentOf(1800))).toEqual({ subtotalMinor: 50000, taxMinor: 9000, totalMinor: 59000 });
    expect(computeTotals([{ description: "Plan", quantity: 1, unitMinor: 4900 }], vatPercentOf(0))).toEqual({ subtotalMinor: 4900, taxMinor: 0, totalMinor: 4900 });
  });

  it("VAT is never revenue: a Mobile Money payment counts before VAT and its VAT is shown apart", () => {
    const at = new Date("2026-11-10T08:00:00Z");
    const e = toRevenueEntry({ eventId: "p1", type: "manual_payment.confirmed", createdAt: at, userId: "u1", payload: { occurred_at: at.toISOString(), data: { id: "BP-1", amount_minor: 59000, currency: "RWF", usd_cents: 3448, vat_minor: 9000, vat_rate_bps: 1800, vat_usd_cents: 621, network: "MTN" } } })!;
    expect(e).toMatchObject({ usdCents: 3448, localMinor: 50000, vatUsdCents: 621, vatLocalMinor: 9000, method: "momo" });
    const [month] = revenueByMonth([e], ["2026-11"]);
    expect(month).toMatchObject({ netCents: 3448, rwfMinor: 50000, vatCents: 621, vatRwfMinor: 9000 });
    // An older payment (no VAT fields) is unchanged.
    const old = toRevenueEntry({ eventId: "p0", type: "manual_payment.confirmed", createdAt: at, userId: "u1", payload: { data: { id: "BP-0", amount_minor: 15000, currency: "RWF", usd_cents: 1034, network: "MTN" } } })!;
    expect(old).toMatchObject({ usdCents: 1034, localMinor: 15000, vatUsdCents: 0 });
  });
});

describe("admin: regions", () => {
  it("a country belongs to one region, coming-soon ones included; Move here takes it, and is audited on both", async () => {
    expect(await code(saveRegion(CONSOLE, { key: "", name: "Nigeria", currency: "NGN", countries: ["NG"], paymentMethods: ["card"], isNew: true }))).toMatch(/^conflict: West Africa already lists NG/);
    const made = await saveRegion(CONSOLE, { key: "", name: "Nigeria", currency: "NGN", countries: ["ng"], paymentMethods: ["card"], move: true, isNew: true });
    expect(made).toMatchObject({ key: "NIGERIA", countries: ["NG"], active: true });
    expect(h.db.pricingRegion.rows.find((r) => r.key === "WEST_AFRICA")!.countries).not.toContain("NG");
    expect(h.db.auditLog.rows.map((r) => r.action)).toEqual(["move_region_countries", "create_region"]);
    expect(h.db.auditLog.rows[0]).toMatchObject({ target: "region:WEST_AFRICA", after: expect.objectContaining({ movedTo: "NIGERIA", moved: ["NG"] }) });
    expect(await regionFromCountryCode("NG")).toBe("NIGERIA");
    expect(countryClashes({ key: "X", countries: ["KE", "US"] }, REGION_SEEDS).map((c) => [c.region.key, c.countries])).toEqual([["EAC", ["KE"]], ["NORTH_AMERICA", ["US"]]]);
  });

  it("refuses: emptying another region, a second catch-all, bad codes, a taken key, the catch-all off, bad VAT", async () => {
    expect(await code(saveRegion(CONSOLE, { key: "RW2", name: "Rwanda 2", currency: "RWF", countries: ["RW"], paymentMethods: ["momo"], move: true, isNew: true }))).toMatch(/would leave Rwanda with no country/);
    expect(await code(saveRegion(CONSOLE, { key: "MARS", name: "Mars", currency: "USD", countries: [], paymentMethods: ["card"], isNew: true }))).toMatch(/^invalid: Add at least one country/);
    expect(await code(saveRegion(CONSOLE, { key: "X1", name: "X", currency: "USD", countries: ["QQ"], paymentMethods: ["card"], isNew: true }))).toMatch(/^invalid: "QQ" is not a country code/);
    expect(await code(saveRegion(CONSOLE, { key: "EAC", name: "East", currency: "USD", countries: ["KE"], paymentMethods: ["card"], isNew: true }))).toMatch(/^conflict: There is already a region with the key EAC/);
    expect(await code(saveRegion(CONSOLE, { key: "GLOBAL", name: "Rest of the world", currency: "USD", countries: [], paymentMethods: ["card"], active: false }))).toMatch(/always live/);
    expect(await code(saveRegion(CONSOLE, { key: "RW", name: "Rwanda", currency: "RWF", countries: ["RW"], paymentMethods: ["momo"], vatRateBps: 20000 }))).toMatch(/^invalid: VAT/);
    expect(h.db.auditLog.rows).toHaveLength(0);
  });

  it("sets VAT and status; a region companies are billed in cannot become coming soon", async () => {
    const saved = await saveRegion(CONSOLE, { key: "EAC", name: "East Africa", currency: "USD", countries: REGION_SEEDS[1].countries, paymentMethods: ["card"], vatRateBps: 1600, vatLabel: "VAT" });
    expect(saved).toMatchObject({ vatRateBps: 1600, active: true });
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ action: "update_region", target: "region:EAC", before: expect.objectContaining({ vatRateBps: 0 }), after: expect.objectContaining({ vatRateBps: 1600 }) });
    h.db.business.rows.push({ id: "b1", userId: "u1", pricingRegion: "EAC" });
    expect(await code(saveRegion(CONSOLE, { key: "EAC", name: "East Africa", currency: "USD", countries: REGION_SEEDS[1].countries, paymentMethods: ["card"], active: false }))).toMatch(/^conflict: 1 company is billed in East Africa/);
    expect(await code(saveRegion(CONSOLE, { key: "WEST_AFRICA", name: "West Africa", currency: "USD", countries: REGION_SEEDS[2].countries, paymentMethods: ["card"], active: true }))).toBeNull();
  });

  it("delete: refused for the catch-all, a billed region and a plan's only region; otherwise its prices go with it", async () => {
    expect(await code(deleteRegion(CONSOLE, { key: "GLOBAL" }))).toMatch(/cannot be deleted/);
    expect(await code(deleteRegion(CONSOLE, { key: "RW" }))).toMatch(/^conflict: Starter, Business are offered only in Rwanda/);
    h.db.business.rows.push({ id: "b1", userId: "u1", pricingRegion: "EAC" });
    expect(await code(deleteRegion(CONSOLE, { key: "EAC" }))).toMatch(/billed in East Africa/);
    h.db.business.rows.length = 0;
    expect(await deleteRegion(CONSOLE, { key: "EAC" })).toEqual({ key: "EAC", name: "East Africa" });
    expect(h.db.pricingRegion.rows.some((r) => r.key === "EAC")).toBe(false);
    expect(h.db.planRegionPrice.rows.some((r) => r.regionKey === "EAC")).toBe(false);
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ action: "delete_region", target: "region:EAC", before: expect.objectContaining({ key: "EAC", prices: expect.any(Array) }) });
    resetRegionCache();
    expect(await regionFromCountryCode("KE")).toBe("GLOBAL");
  });

  it("reorders one place at a time, audited", async () => {
    expect(await moveRegion(CONSOLE, { key: "EAC", direction: "up" })).toEqual({ key: "EAC", moved: true });
    const order = [...h.db.pricingRegion.rows].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.key);
    expect(order.slice(0, 2)).toEqual(["EAC", "RW"]);
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ action: "reorder_regions" });
    expect(await moveRegion(CONSOLE, { key: "EAC", direction: "up" })).toEqual({ key: "EAC", moved: false });
  });

  it("makes keys from names", () => {
    expect(regionKeyFromName("West Africa")).toBe("WEST_AFRICA");
    expect(regionKeyFromName("Côte d'Ivoire & Ghana")).toBe("COTE_D_IVOIRE_GH");
    expect(regionKeyFromName("1")).toBe("");
  });
});

describe("admin: where a plan is shown", () => {
  it("the form's options: every region in order, coming soon marked, this plan's prices; a new plan starts in the rest of the world", async () => {
    const opts = await planRegionOptions("BUSINESS");
    expect(opts.filter((o) => o.selected).map((o) => [o.key, o.selected])).toEqual([["RW", { monthlyMinor: 50000, yearlyMinor: 500000 }]]);
    expect(opts.find((o) => o.key === "EUROPE")).toMatchObject({ status: "COMING_SOON", selected: null });
    expect(opts.find((o) => o.key === "RW")).toMatchObject({ vatRateBps: 1800, status: "LIVE" });
    expect((await planRegionOptions(null)).filter((o) => o.selected).map((o) => o.key)).toEqual(["GLOBAL"]);
  });

  it("adds East Africa and the rest of the world to a Rwanda plan, re-prices Rwanda, and audits once", async () => {
    const r = await setPlanRegions(CONSOLE, "BUSINESS", [{ regionKey: "RW", monthlyMinor: 55000, yearlyMinor: 550000 }, { regionKey: "EAC", monthlyMinor: 3000, yearlyMinor: 30000 }, { regionKey: "GLOBAL" }]);
    expect(r).toEqual({ changed: true, regions: ["RW", "EAC", "GLOBAL"] });
    resetRegionPriceCache();
    expect((await getRegionPlans("EAC")).map((p) => p.key)).toContain("BUSINESS");
    expect((await getRegionPlans("GLOBAL")).find((p) => p.key === "BUSINESS")?.monthlyPriceCents).toBe(3800); // the plan's own price
    expect((await getRegionPlans("RW")).find((p) => p.key === "BUSINESS")?.vat?.monthly.totalMinor).toBe(64900);
    expect(h.db.auditLog.rows.filter((a) => a.action === "update_plan_regions")).toHaveLength(1);
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ target: "plan:BUSINESS", before: { regions: [expect.objectContaining({ regionKey: "RW", monthlyMinor: 50000 })] } });
    // Same choice again: nothing to do, no audit row.
    expect((await setPlanRegions(CONSOLE, "BUSINESS", [{ regionKey: "RW", monthlyMinor: 55000, yearlyMinor: 550000 }, { regionKey: "EAC", monthlyMinor: 3000, yearlyMinor: 30000 }, { regionKey: "GLOBAL" }])).changed).toBe(false);
    // Removing Rwanda: the plan leaves the Rwanda pricing page.
    await setPlanRegions(CONSOLE, "BUSINESS", [{ regionKey: "GLOBAL" }]);
    resetRegionPriceCache();
    expect((await getRegionPlans("RW")).map((p) => p.key)).toEqual(["STARTER"]);
  });

  it("refuses: no region, a coming-soon region, a missing price, the trial and unknown regions", async () => {
    expect(await code(checkPlanRegions("BUSINESS", []))).toMatch(/^invalid: Choose at least one region/);
    expect(await code(checkPlanRegions("BUSINESS", [{ regionKey: "EUROPE", monthlyMinor: 1, yearlyMinor: 1 }]))).toMatch(/^conflict: Europe is coming soon/);
    expect(await code(checkPlanRegions(null, [{ regionKey: "RW", monthlyMinor: null, yearlyMinor: 10 }]))).toMatch(/^invalid: Rwanda: enter the monthly price before VAT/);
    expect(await code(checkPlanRegions(null, [{ regionKey: "MARS" }]))).toMatch(/^not_found/);
    h.db.planDefinition.rows.push({ ...h.db.planDefinition.rows[0], id: "plan_trial", key: "TRIAL", isTrial: true });
    resetPlanCache();
    expect(await code(setPlanRegions(CONSOLE, "TRIAL", [{ regionKey: "GLOBAL" }]))).toMatch(/^conflict: The free trial/);
    expect(h.db.auditLog.rows).toHaveLength(0);
  });

  it("a plan already in a region that became coming soon may keep it", async () => {
    h.db.pricingRegion.rows.find((r) => r.key === "EAC")!.active = false;
    resetRegionCache();
    expect(await code(checkPlanRegions("PRO", [{ regionKey: "EAC", monthlyMinor: 4900, yearlyMinor: 49000 }, { regionKey: "GLOBAL" }]))).toBeNull();
    expect(await code(checkPlanRegions("STARTER", [{ regionKey: "EAC", monthlyMinor: 4900, yearlyMinor: 49000 }]))).toMatch(/coming soon/);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// The soft region check (lib/region-check.ts): an IP country in a dearer region than the company's is flagged for the
// admin at sign-up and payment starts, never blocked; the admin changes the region or dismisses it (audited).

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, headers: new Headers() }));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/billing/paddle-catalog", () => ({ paddleConnected: () => false, createPaddleProduct: vi.fn(), createPaddlePrice: vi.fn(), archivePaddlePrice: vi.fn(), updatePaddleProduct: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => h.headers, cookies: async () => ({ get: () => undefined }) }));

import { dearerRegion, noteRegionMismatch, openRegionMismatches, parseMismatch, priceLevelUsdCents } from "@/lib/region-check";
import { resetRegionPriceCache } from "@/lib/region-prices";
import { resetRegionCache } from "@/lib/region";
import { resetPlanCache } from "@/lib/plan-catalog";
import { dismissRegionMismatch, setCompanyRegion } from "@/lib/admin/regions-service";
import { consoleContext } from "@/lib/admin/types";

const CONSOLE = consoleContext("198.51.100.1");
const from = (country: string) => new Headers({ "cf-ipcountry": country });
const business = () => h.db.business.rows.find((b) => b.id === "b1")!;

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
  h.headers = new Headers();
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  seed();
  h.db.business.rows.push({ id: "b1", name: "Kigali Bakery", pricingRegion: "RW", regionMismatch: null, regionMismatchAt: null });
});

describe("region check", () => {
  it("flags a Rwanda company paying from Kenya (EAC is dearer) without blocking, with the country and when", async () => {
    const now = new Date("2026-10-14T08:00:00Z");
    const flag = await noteRegionMismatch("b1", "momo", from("KE"), now);
    expect(flag).toMatchObject({ country: "KE", ipRegion: "EAC", companyRegion: "RW", source: "momo", seenAt: now.toISOString(), firstSeenAt: now.toISOString() });
    expect(business().regionMismatchAt).toEqual(now);
    expect(parseMismatch(business().regionMismatch)).toMatchObject({ country: "KE" });
    const open = await openRegionMismatches();
    expect(open.map((m) => [m.businessId, m.flag.country])).toEqual([["b1", "KE"]]);
    // Seen again: first seen is kept, last seen moves.
    const later = new Date("2026-10-15T08:00:00Z");
    expect(await noteRegionMismatch("b1", "card", from("KE"), later)).toMatchObject({ firstSeenAt: now.toISOString(), seenAt: later.toISOString(), source: "card" });
  });

  it("does not flag the same region, a cheaper region, or an unknown country", async () => {
    expect(await noteRegionMismatch("b1", "momo", from("RW"))).toBeNull();
    expect(await noteRegionMismatch("b1", "momo", new Headers())).toBeNull();
    expect(await noteRegionMismatch("b1", "momo", from("XX"))).toBeNull();
    expect(await noteRegionMismatch("b1", "momo", from("T1"))).toBeNull();
    business().pricingRegion = "GLOBAL"; // signed up as "everywhere else", paying from Rwanda: cheaper, fine
    expect(await noteRegionMismatch("b1", "card", from("RW"))).toBeNull();
    expect(await noteRegionMismatch("b1", "card", from("KE"))).toBeNull();
    expect(business().regionMismatchAt).toBeNull();
  });

  it("flags an EAC company seen from France (GLOBAL), reading the request's headers by default", async () => {
    business().pricingRegion = "EAC";
    h.headers = from("FR");
    expect(await noteRegionMismatch("b1", "signup")).toMatchObject({ country: "FR", ipRegion: "GLOBAL", source: "signup" });
  });

  it("never throws: a database failure is logged and the payment goes on", async () => {
    h.db.business.findUnique = vi.fn(async () => {
      throw new Error("db down");
    }) as never;
    expect(await noteRegionMismatch("b1", "momo", from("KE"))).toBeNull();
  });

  it("Change region clears the flag; Dismiss closes it, is audited, and the same country is not raised again", async () => {
    await noteRegionMismatch("b1", "momo", from("KE"));
    await setCompanyRegion(CONSOLE, { businessId: "b1", regionKey: "EAC" });
    expect(business().pricingRegion).toBe("EAC");
    expect(business().regionMismatchAt).toBeNull();
    expect(parseMismatch(business().regionMismatch)).toBeNull();

    business().pricingRegion = "RW";
    await noteRegionMismatch("b1", "momo", from("KE"));
    expect(await dismissRegionMismatch(CONSOLE, { businessId: "b1" })).toEqual({ businessId: "b1", changed: true });
    expect(business().regionMismatchAt).toBeNull();
    expect(parseMismatch(business().regionMismatch)?.dismissedAt).toBeTruthy();
    expect(h.db.auditLog.rows.some((r) => r.action === "dismiss_region_mismatch" && r.target === "business:b1")).toBe(true);
    expect(await noteRegionMismatch("b1", "momo", from("KE"))).toBeNull();
    expect(await openRegionMismatches()).toEqual([]);
    // Another dearer country is a new flag.
    expect(await noteRegionMismatch("b1", "momo", from("FR"))).toMatchObject({ country: "FR", ipRegion: "GLOBAL" });
  });

  it("pure helpers: the cheapest USD price per region, and only a dearer region counts", () => {
    const plan = (currency: string, monthlyPriceCents: number, card: number | null) => ({ currency, monthlyPriceCents, card: card === null ? null : { monthlyUsdCents: card, yearlyUsdCents: card * 10 } }) as never;
    expect(priceLevelUsdCents([plan("RWF", 15000, 1200), plan("RWF", 35000, 2800)])).toBe(1200);
    expect(priceLevelUsdCents([plan("USD", 4900, null), plan("USD", 9900, null)])).toBe(4900);
    expect(priceLevelUsdCents([plan("RWF", 15000, null)])).toBeNull();
    const regions = [
      { key: "RW", name: "Rwanda", currency: "RWF", countries: ["RW"], paymentMethods: ["momo", "card"] as never, active: true, sortOrder: 0 },
      { key: "GLOBAL", name: "Everywhere else", currency: "USD", countries: [], paymentMethods: ["card"] as never, active: true, sortOrder: 20 },
    ];
    const levels: Record<string, number | null> = { RW: 1200, GLOBAL: 4900 };
    expect(dearerRegion({ country: "US", companyRegion: "RW", regions, level: (k) => levels[k] })).toBe("GLOBAL");
    expect(dearerRegion({ country: "RW", companyRegion: "GLOBAL", regions, level: (k) => levels[k] })).toBeNull();
    expect(dearerRegion({ country: null, companyRegion: "RW", regions, level: (k) => levels[k] })).toBeNull();
    expect(dearerRegion({ country: "US", companyRegion: "RW", regions, level: () => null })).toBeNull();
  });
});

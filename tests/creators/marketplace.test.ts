import { beforeEach, describe, expect, it, vi } from "vitest";

// The marketplace /creators (docs/CREATOR_MARKETPLACE.md): the listing rule, the four filters from the query string,
// the order (best pay; full campaigns last), and the database read that applies them (lib/creators/marketplace.ts).

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  features: new Map<string, boolean>(),
  limits: new Map<string, number>(),
}));
vi.mock("@/lib/db", () => ({ prisma: { creatorCampaign: { findMany: h.findMany } } }));
vi.mock("@/lib/entitlements", () => ({ hasFeature: vi.fn(async ({ businessId }: { businessId: string }) => h.features.get(businessId) ?? false) }));
vi.mock("@/lib/creators/campaigns", () => ({ campaignLimits: vi.fn(async (id: string) => ({ liveCampaigns: 2, creatorsPerCampaign: h.limits.get(id) ?? 20 })) }));
vi.mock("@/lib/creators/logos", () => ({ logoUrls: vi.fn(async () => new Map([["logos/b1.png", "https://signed/b1"]])) }));
vi.mock("@/lib/creators/record", async (orig) => ({ ...(await orig<typeof import("@/lib/creators/record")>()), paymentRecords: vi.fn(async () => new Map()) }));

import { byBestPay, filterMarket, hasFilters, isListed, marketHref, NO_FILTERS, placesLeft, readMarketFilters, whenOf, type MarketItem } from "@/lib/creators/market-filters";
import { listedCampaigns, marketplace } from "@/lib/creators/marketplace";

describe("readMarketFilters and marketHref", () => {
  it("reads the four filters and ignores anything else", () => {
    expect(readMarketFilters({})).toEqual(NO_FILTERS);
    expect(readMarketFilters({ platform: "TikTok", sort: "pay", type: "retail", when: "soon" })).toEqual({ platform: "tiktok", sort: "pay", type: "retail", when: "soon" });
    expect(readMarketFilters({ platform: "youtube", sort: "cheap", type: "../x", when: "later" })).toEqual(NO_FILTERS);
    expect(readMarketFilters({ platform: ["instagram", "facebook"] }).platform).toBe("instagram");
  });

  it("makes a short link to share, and back", () => {
    expect(marketHref(NO_FILTERS)).toBe("/creators");
    const f = { platform: "instagram" as const, sort: "pay" as const, type: "food", when: "now" as const };
    const href = marketHref(f);
    expect(href).toBe("/creators?platform=instagram&sort=pay&type=food&when=now");
    expect(readMarketFilters(Object.fromEntries(new URL(href, "https://x").searchParams))).toEqual(f);
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, sort: "pay" })).toBe(true);
  });
});

describe("isListed", () => {
  const base = { status: "LIVE", acceptingApplications: true, listed: true, hiddenAt: null, hasFeature: true, endsOn: "2026-10-21", today: "2026-10-21" };
  it("lists LIVE, accepting, listed, not hidden, in the plan, until its last day", () => {
    expect(isListed(base)).toBe(true);
    expect(isListed({ ...base, status: "PAUSED" })).toBe(false);
    expect(isListed({ ...base, status: "DRAFT" })).toBe(false);
    expect(isListed({ ...base, acceptingApplications: false })).toBe(false);
    expect(isListed({ ...base, listed: false })).toBe(false);
    expect(isListed({ ...base, hiddenAt: new Date() })).toBe(false);
    expect(isListed({ ...base, hasFeature: false })).toBe(false);
    expect(isListed({ ...base, today: "2026-10-22" })).toBe(false);
  });
});

describe("filterMarket", () => {
  const item = (id: string, over: Partial<MarketItem> = {}): MarketItem & { id: string } => ({
    id,
    platforms: ["instagram"],
    payRules: {},
    industrySlug: null,
    startsOn: "2026-10-01",
    today: "2026-10-21",
    placesLeft: 5,
    createdAt: new Date(`2026-10-${10 + Number(id.slice(1))}T00:00:00Z`),
    ...over,
  });
  const ids = (list: { id: string }[]) => list.map((i) => i.id);

  it("filters by platform, business type and when (with places left)", () => {
    const items = [item("c1", { platforms: ["tiktok"], industrySlug: "food" }), item("c2", { startsOn: "2026-11-01" }), item("c3", { placesLeft: 0 }), item("c4", { platforms: ["instagram", "tiktok"] })];
    expect(ids(filterMarket(items, { ...NO_FILTERS, platform: "tiktok" }))).toEqual(["c4", "c1"]);
    expect(ids(filterMarket(items, { ...NO_FILTERS, type: "food" }))).toEqual(["c1"]);
    expect(ids(filterMarket(items, { ...NO_FILTERS, when: "soon" }))).toEqual(["c2"]);
    // Open now leaves out the full one; without the filter it is last.
    expect(ids(filterMarket(items, { ...NO_FILTERS, when: "now" }))).toEqual(["c4", "c1"]);
    expect(ids(filterMarket(items, NO_FILTERS))).toEqual(["c4", "c2", "c1", "c3"]);
  });

  it("sorts by best pay: rate per 1,000 views, then fee per post, then newest", () => {
    const items = [item("c1", { payRules: { ratePerThousand: 1000 } }), item("c2", { payRules: { ratePerThousand: 2000 } }), item("c3", { payRules: { ratePerThousand: 1000, feePerPost: 500 } }), item("c4", { payRules: { feePerPost: 9000 } })];
    expect(ids(filterMarket(items, { ...NO_FILTERS, sort: "pay" }))).toEqual(["c2", "c3", "c1", "c4"]);
    expect(byBestPay(items[0], items[0])).toBe(0);
    expect(whenOf(item("x", { startsOn: "2026-10-21" }))).toBe("now");
    expect(placesLeft(20, 25)).toBe(0);
    expect(placesLeft(20, 3)).toBe(17);
  });
});

describe("listedCampaigns", () => {
  const NOW = new Date("2026-10-21T20:00:00Z"); // 22:00 in Kigali, 23:00 in Nairobi
  const row = (id: string, businessId: string, over: Record<string, unknown> = {}) => ({
    id,
    slug: `s-${id}`,
    name: `Campaign ${id}`,
    status: "LIVE",
    acceptingApplications: true,
    listed: true,
    hiddenAt: null,
    startsOn: new Date("2026-10-01"),
    endsOn: new Date("2026-10-30"),
    platforms: ["instagram"],
    currency: "RWF",
    payRules: { ratePerThousand: 2000 },
    viewTargetPerCreator: null,
    viewTargetCampaign: null,
    createdAt: new Date("2026-10-01"),
    businessId,
    business: { name: `Company ${businessId}`, logoUrl: `logos/${businessId}.png`, timezone: "Africa/Kigali", industry: "Food", industryRef: { slug: "food", name: "Food & drink" } },
    periods: [],
    _count: { creators: 3 },
    ...over,
  });

  beforeEach(() => {
    h.findMany.mockReset();
    h.features = new Map([["b1", true], ["b2", false]]);
    h.limits = new Map([["b1", 4]]);
  });

  it("asks the database for live, accepting, listed, visible campaigns, then keeps those whose company has the feature and whose last day has not passed", async () => {
    h.findMany.mockResolvedValue([row("c1", "b1"), row("c2", "b2"), row("c3", "b1", { endsOn: new Date("2026-10-20") })]);
    const cards = await listedCampaigns(NOW);
    expect(h.findMany.mock.calls[0][0].where).toMatchObject({ status: "LIVE", acceptingApplications: true, listed: true, hiddenAt: null });
    expect(cards.map((c) => c.id)).toEqual(["c1"]);
    expect(cards[0]).toMatchObject({ placesLeft: 1, industrySlug: "food", company: { id: "b1", name: "Company b1", logoUrl: "https://signed/b1", industry: "Food & drink" }, record: { isNew: true } });
    expect(cards[0].pay[0]).toMatch(/2,000 RWF/);
  });

  it("gives the business types listed now for the filter", async () => {
    h.features.set("b2", true);
    h.findMany.mockResolvedValue([row("c1", "b1"), row("c2", "b2", { business: { name: "B2", logoUrl: null, timezone: "UTC", industry: "Shop", industryRef: { slug: "retail", name: "Shops & retail" } } })]);
    const { cards, total, types } = await marketplace({ ...NO_FILTERS, type: "retail" }, NOW);
    expect(total).toBe(2);
    expect(cards.map((c) => c.id)).toEqual(["c2"]);
    expect(types).toEqual([{ slug: "food", name: "Food & drink" }, { slug: "retail", name: "Shops & retail" }]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// resolveIndustryChoice: the Brand form may keep a deactivated current sector, and an unknown slug refetches the
// table only when the cached copy is stale. ensureAccount re-validates the (client-writable) sign-up metadata.

const h = vi.hoisted(() => ({ findMany: vi.fn(), userFind: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { industry: { findMany: h.findMany }, user: { findUnique: h.userFind, upsert: h.upsert } } }));
vi.mock("@/lib/region", () => ({ regionFromCountryName: async () => "RW" }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: { signup: "signup" }, trackEvent: vi.fn() }));

import { industryOptions, resetIndustryCache, resolveIndustryChoice } from "@/lib/industries/server";
import { ensureAccount } from "@/lib/account";

const row = (slug: string, active: boolean) => ({ id: `id_${slug}`, slug, name: slug.toUpperCase(), shortDescription: "", customers: "", offerings: "", postIdeas: "", tone: "", hashtags: [], seasons: "", avoid: "", active, sortOrder: 0 });
const DESC = "We sell kitenge dresses and accessories to young women in Kigali.";
const pick = (industry: string) => ({ industry, industryOther: "", industryDescription: DESC });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  resetIndustryCache();
  h.findMany.mockResolvedValue([row("retail", true), row("old", false)]);
});

describe("resolveIndustryChoice", () => {
  it("refuses an inactive sector unless it is the company's current one", async () => {
    expect(await resolveIndustryChoice(pick("old"))).toBeNull();
    expect(await resolveIndustryChoice(pick("old"), { currentIndustryId: "id_retail" })).toBeNull();
    expect(await resolveIndustryChoice(pick("old"), { currentIndustryId: "id_old" })).toMatchObject({ industryId: "id_old", industry: "OLD" });
  });

  it("lists the current inactive sector in the Brand options, marked", async () => {
    expect(await industryOptions()).toEqual([{ slug: "retail", name: "RETAIL" }]);
    expect(await industryOptions({ currentIndustryId: "id_old" })).toEqual([
      { slug: "retail", name: "RETAIL" },
      { slug: "old", name: "OLD (no longer offered)" },
    ]);
  });

  it("refetches for an unknown slug only when the cache is older than about 5 s", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
    expect(await resolveIndustryChoice(pick("nope"))).toBeNull();
    expect(h.findMany).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-12T10:00:02Z"));
    await resolveIndustryChoice(pick("nope"));
    expect(h.findMany).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-12T10:00:07Z"));
    h.findMany.mockResolvedValue([row("retail", true), row("nope", true)]);
    expect(await resolveIndustryChoice(pick("nope"))).toMatchObject({ industryId: "id_nope" });
    expect(h.findMany).toHaveBeenCalledTimes(2);
  });
});

describe("ensureAccount sign-up metadata", () => {
  const user = (meta: Record<string, unknown>) => ({ id: "u1", email: "a@b.rw", email_confirmed_at: "2026-10-12", user_metadata: { organisation_name: "Inzu", ceo_name: "Aline", country: "Rwanda", ...meta }, identities: [] }) as never;
  const business = () => h.upsert.mock.calls[0][0].create.business.create;
  beforeEach(() => {
    h.userFind.mockResolvedValue(null);
    h.upsert.mockResolvedValue({ business: { id: "b1" } });
  });

  it("stores an active sector with a long enough description", async () => {
    await ensureAccount(user({ industry_slug: "retail", industry_description: DESC }));
    expect(business()).toMatchObject({ industryId: "id_retail", industry: "RETAIL", industryDescription: DESC });
    expect(business().detailsCompletedAt).toBeInstanceOf(Date);
  });

  it("stores nothing for the industry (and asks again on /welcome) for a short description, an inactive sector, or empty Other", async () => {
    for (const meta of [
      { industry_slug: "retail", industry_description: "too short" },
      { industry_slug: "old", industry_description: DESC },
      { industry_slug: "other", industry_other: "", industry_description: DESC },
    ]) {
      h.upsert.mockClear();
      await ensureAccount(user(meta));
      expect(business()).toMatchObject({ industry: null, industryId: null, industryOther: null, industryDescription: null, detailsCompletedAt: null });
    }
  });

  it("keeps a valid Other text", async () => {
    await ensureAccount(user({ industry_slug: "other", industry_other: "Car wash", industry_description: DESC }));
    expect(business()).toMatchObject({ industryId: null, industryOther: "Car wash", industry: "Car wash" });
  });
});

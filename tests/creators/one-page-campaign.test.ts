import { beforeEach, describe, expect, it, vi } from "vitest";

// The one-page form's server side (createOnePageCampaign in lib/creators/campaigns.ts) against a mocked database: the
// owner's answers stored on the campaign and its pay period as given, the rest from the suggestion, and the checks.

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const prisma = {
    business: { findUnique: fn() },
    campaign: { findFirst: fn() },
    product: { findMany: fn() },
    creatorCampaign: { findFirst: fn(), findUnique: fn(), count: fn(), create: fn(), update: fn(), updateMany: fn() },
    creatorTask: { findMany: fn(), count: fn(), createMany: fn() },
    creatorPeriod: { findFirst: fn() },
    campaignCreator: { count: fn() },
    mediaAsset: { count: fn(), findFirst: fn(), findMany: fn() },
    $executeRaw: fn(),
    $transaction: vi.fn(),
  };
  return { prisma, limits: { liveCampaigns: 2, creatorsPerCampaign: 20 } as Record<string, number> };
});

vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/plan-catalog", () => ({ getPlanLimits: vi.fn(async () => ({ text: 0, image: 0, videos: 0, voiceCharacters: 0, chat: 0, videoCredits: 0, seats: 1, ...h.limits })) }));
vi.mock("@/lib/auth/request-site", () => ({ linkSiteUrl: async () => "https://bupulse.com", frontLinkUrl: async () => "https://bupulse.com" }));
vi.mock("@/lib/publishing/email", () => ({ renderEmail: () => ({ html: "", text: "" }), sendEmail: vi.fn(async () => true) }));
vi.mock("@/lib/region", () => ({ companyRegion: async () => ({ currency: "RWF" }) }));
vi.mock("@/lib/team/service", () => ({ newInviteToken: () => "t", hashToken: async (t: string) => t }));

import { createOnePageCampaign, saveStep, type CampaignActor } from "@/lib/creators/campaigns";
import type { OnePageInput } from "@/lib/creators/one-page";
import { templateSuggestion } from "@/lib/creators/wizard-suggest";

const OWNER: CampaignActor = { actorId: "u1", businessId: "b1", role: "OWNER" };
const MEMBER: CampaignActor = { actorId: "u2", businessId: "b1", role: "MEMBER" };
const NOW = new Date("2026-10-31T08:00:00Z");

const suggestion = (over: Partial<ReturnType<typeof templateSuggestion>> = {}) => ({
  ...templateSuggestion({ businessName: "LEAF", industry: "Juice bar", country: "Rwanda", contentLanguage: "Kinyarwanda", instagramHandle: "leafjuice", currency: "RWF", networks: ["instagram", "facebook"], productNames: ["Passion juice"], creatorsPerCampaign: 20, idea: "Film yourself trying our passion juice", name: "", kind: "PRODUCT_REVIEW" }),
  ...over,
});

const input = (over: Partial<OnePageInput> = {}): OnePageInput => ({
  language: "rw",
  description: "Film yourself trying our passion juice at home. One video a week. Use #LeafJuice in the caption.",
  currency: "RWF",
  ratePerThousand: 500,
  budget: 500_000,
  maxPerCreator: 50_000,
  unlimitedCreators: false,
  maxCreators: 10,
  platforms: ["instagram", "facebook"],
  coverAssetId: "a-cover",
  productId: "p1",
  productName: "Passion juice",
  productLinks: ["https://example.com/passion-juice"],
  productPhotoIds: ["a1", "a2", "not-mine"],
  ...over,
});

const code = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; message: string }) => `${e.code}: ${e.message}`);
const created = () => h.prisma.creatorCampaign.create.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  h.limits = { liveCampaigns: 2, creatorsPerCampaign: 20 };
  h.prisma.$transaction.mockImplementation(async (run: (tx: typeof h.prisma) => unknown) => run(h.prisma));
  h.prisma.business.findUnique.mockResolvedValue({ name: "LEAF", timezone: "Africa/Kigali", userId: "u1", user: { subscription: { plan: "BUSINESS" } } });
  h.prisma.product.findMany.mockResolvedValue([{ id: "p1" }]);
  // Only the company's own Photos come back (the one "not-mine" asks for is someone else's).
  h.prisma.mediaAsset.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((id) => id !== "not-mine").map((id) => ({ id })));
  h.prisma.creatorCampaign.count.mockResolvedValue(0);
  h.prisma.creatorCampaign.create.mockImplementation(async ({ data }: { data: { slug: string } }) => ({ id: "c1", slug: data.slug }));
});

describe("createOnePageCampaign", () => {
  it("is for owners and admins only", async () => {
    expect(await code(createOnePageCampaign(MEMBER, input(), suggestion()))).toBe("forbidden: Ask your company owner or an admin to do this.");
  });

  it("stores the owner's answers as given: language, description, pay rules, places, networks, cover and product", async () => {
    await createOnePageCampaign(OWNER, input(), suggestion(), { now: NOW });
    const data = created();
    expect(data).toMatchObject({
      businessId: "b1",
      language: "rw",
      idea: input().description,
      productIds: ["p1"],
      platforms: ["instagram", "facebook"],
      currency: "RWF",
      maxCreators: 10,
      // Set up already: Settings opens every step, and it goes live from its page.
      setupStep: null,
      look: { coverAssetId: "a-cover" },
      files: { exampleLinks: [], productName: "Passion juice", productLinks: ["https://example.com/passion-juice"], productPhotoIds: ["a1", "a2"] },
      createdBy: "u1",
    });
    expect(data.status).toBeUndefined(); // a DRAFT (the column's default)
    expect(data.payRules).toEqual({ ratePerThousand: 500, rateViews: 1_000, feePerPost: null, milestones: [], capPerPost: null, capPerCreator: 50_000 });
  });

  it("runs from today in the company's timezone for 30 days, one pay period holding the whole budget", async () => {
    await createOnePageCampaign(OWNER, input(), suggestion(), { now: NOW });
    const data = created();
    expect(data.startsOn).toEqual(new Date("2026-10-31"));
    expect(data.endsOn).toEqual(new Date("2026-11-29"));
    expect(data.periods.create).toHaveLength(1);
    expect(data.periods.create[0]).toMatchObject({ index: 1, budget: 500_000 });
  });

  it("fills the rest from the suggestion: name, goal, brief, tasks on the owner's networks, rules, form and the caption check", async () => {
    await createOnePageCampaign(OWNER, input(), suggestion({ name: "Passion juice week" }), { now: NOW });
    const data = created();
    expect(data).toMatchObject({ name: "Passion juice week", kind: "PRODUCT_REVIEW", goal: "SALES", formats: ["REEL", "STORY"], briefEvery: "MONTH" });
    expect(data.brief).toMatch(/Passion juice/);
    expect(data.dos.length).toBeGreaterThan(0);
    expect(data.donts.length).toBeGreaterThan(0);
    expect(data.applicationForm.fields.length).toBeGreaterThan(0);
    expect(data.tasks.create).toHaveLength(1);
    expect(data.tasks.create[0]).toMatchObject({ platforms: ["instagram", "facebook"], startsOn: new Date("2026-10-31"), endsOn: new Date("2026-11-29") });
    // The description's #hashtag first, then the AI's (the business's account and its hashtag).
    expect(data.mentions).toEqual(["#LeafJuice", "@leafjuice", "#LEAF"]);
    // Creators who post in the campaign's language; the number who can join is also the cost estimate's.
    expect(data.requirements).toMatchObject({ languages: ["Kinyarwanda"], creatorsWanted: 10 });
  });

  it("stores Unlimited as no limit of its own", async () => {
    await createOnePageCampaign(OWNER, input({ unlimitedCreators: true, maxCreators: null }), suggestion(), { now: NOW });
    expect(created().maxCreators).toBeNull();
    expect(created().requirements.creatorsWanted).toBe(5);
  });

  it("refuses less than 500 RWF per 1,000 views, in the company's currency whatever the form sent", async () => {
    expect(await code(createOnePageCampaign(OWNER, input({ ratePerThousand: 499 }), suggestion()))).toBe("invalid: 500 RWF is the minimum for 1,000 views.");
    expect(await code(createOnePageCampaign(OWNER, input({ ratePerThousand: 2, currency: "USD" }), suggestion()))).toBe("invalid: 500 RWF is the minimum for 1,000 views.");
    expect(h.prisma.creatorCampaign.create).not.toHaveBeenCalled();
  });

  it("refuses more creators than the plan, TikTok before it is set up, and a cover that is not the company's", async () => {
    h.limits.creatorsPerCampaign = 5;
    expect(await code(createOnePageCampaign(OWNER, input({ maxCreators: 6 }), suggestion()))).toMatch(/^limit: Your plan allows 5 creators in one campaign/);
    expect(await code(createOnePageCampaign(OWNER, input({ maxCreators: 5, platforms: ["tiktok"] }), suggestion()))).toBe("invalid: TikTok is coming soon: BuPulse cannot count its views yet.");
    expect(await code(createOnePageCampaign(OWNER, input({ maxCreators: 5, coverAssetId: "not-mine" }), suggestion()))).toBe("invalid: That background picture is no longer in your Photos. Pick another one.");
    expect(h.prisma.creatorCampaign.create).not.toHaveBeenCalled();
  });

  it("makes a campaign that warns but is not blocked when the budget cannot pay every creator the most", async () => {
    await createOnePageCampaign(OWNER, input({ maxCreators: 20, budget: 100_000 }), suggestion(), { now: NOW });
    expect(created().periods.create[0].budget).toBe(100_000);
  });
});

describe("Settings keeps the one-page answers editable", () => {
  const row = { id: "c1", businessId: "b1", name: "Passion juice week", status: "DRAFT", setupStep: null, brief: "Show it.", idea: "Film it", kind: "OTHER", goal: "VIEWS", knowledgeCampaignId: null, productIds: [], requirements: null, platforms: ["instagram"], platformMode: "ANY", formats: [], mentions: [], briefEvery: "MONTH", dos: [], donts: [], startsOn: new Date("2026-11-01"), endsOn: new Date("2026-11-30"), currency: "RWF", payRules: {}, applicationForm: null, files: { exampleLinks: [], productLinks: [], productPhotoIds: ["a1"] }, look: null, language: "en", maxCreators: null };

  beforeEach(() => {
    h.prisma.creatorCampaign.findFirst.mockResolvedValue(row);
    h.prisma.creatorTask.count.mockResolvedValue(1);
  });

  it("Idea changes the language and the product's name, links and pictures (only the company's own)", async () => {
    await saveStep(OWNER, "c1", "idea", { idea: "Film it", name: "", kind: null, knowledgeCampaignId: null, productIds: [], language: "sw", productName: "Mango juice", productLinks: ["https://example.com/mango"], productPhotoIds: ["a2", "not-mine"] });
    expect(h.prisma.creatorCampaign.update.mock.calls[0][0].data).toMatchObject({ language: "sw", files: { productName: "Mango juice", productLinks: ["https://example.com/mango"], productPhotoIds: ["a2"] } });
  });

  it("Creators changes how many can join, at most the plan's", async () => {
    await saveStep(OWNER, "c1", "creators", { requirements: { niches: [], locations: [], languages: ["Swahili"], creatorsWanted: 8 }, maxCreators: 8 });
    expect(h.prisma.creatorCampaign.update.mock.calls[0][0].data).toMatchObject({ maxCreators: 8 });
    expect(await code(saveStep(OWNER, "c1", "creators", { requirements: { niches: [], locations: [], languages: [] }, maxCreators: 21 }))).toMatch(/^limit: Your plan allows 20 creators/);
    // Left out (quick mode, older drafts): unchanged.
    h.prisma.creatorCampaign.update.mockClear();
    await saveStep(OWNER, "c1", "creators", { requirements: { niches: [], locations: [], languages: [] } });
    expect(h.prisma.creatorCampaign.update.mock.calls[0][0].data).not.toHaveProperty("maxCreators");
  });
});

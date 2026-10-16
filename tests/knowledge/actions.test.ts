import { beforeEach, describe, expect, it, vi } from "vitest";
// Plans are not part of this test's database: every plan feature is granted unless `missing` says otherwise.
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));

const prisma = vi.hoisted(() => ({
  business: { findUnique: vi.fn() },
  product: { count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  campaign: { count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
  campaignProduct: { deleteMany: vi.fn(), createMany: vi.fn() },
  generatedContent: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
}));
const role = vi.hoisted(() => ({ value: "MEMBER" as "OWNER" | "ADMIN" | "MEMBER" }));
const service = vi.hoisted(() => ({ generateForSubject: vi.fn(), generatePackForSubject: vi.fn(), draftPostsFromPack: vi.fn(async () => ({})) }));
const rateLimitMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const usage = vi.hoisted(() => {
  class UsageLimitError extends Error {
    constructor(
      public reason: string,
      public metric: string,
    ) {
      super(reason);
    }
  }
  return { UsageLimitError, consumeUsage: vi.fn(), refundUsage: vi.fn() };
});

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/usage", () => usage);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", async () => ({ ...(await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit")), rateLimit: rateLimitMock }));
vi.mock("@/lib/auth/require-user", async () => {
  const { can, ForbiddenError } = await vi.importActual<typeof import("@/lib/team/roles")>("@/lib/team/roles");
  return {
    requireActiveUser: async (permission?: Parameters<typeof can>[1]) => {
      if (permission && !can(role.value, permission)) throw new ForbiddenError(permission);
      return { id: "u1", role: role.value };
    },
  };
});
vi.mock("@/lib/studio/service", async () => ({ ...(await vi.importActual<typeof import("@/lib/studio/service")>("@/lib/studio/service")), generateForSubject: service.generateForSubject }));
// "Write content" makes a content pack (docs/CONTENT_PACKS.md), drafted as posts to review.
vi.mock("@/lib/studio/pack", () => ({ generatePackForSubject: service.generatePackForSubject }));
vi.mock("@/lib/content-board/drafts", async () => ({ ...(await vi.importActual<typeof import("@/lib/content-board/drafts")>("@/lib/content-board/drafts")), draftPostsFromPack: service.draftPostsFromPack }));

import { generateContent, saveEditedContent } from "@/app/dashboard/knowledge/actions";
import { createCampaign, updateCampaign } from "@/app/dashboard/knowledge/campaigns/actions";
import { changeProductStatus, createProduct, deleteProduct, updateProduct } from "@/app/dashboard/knowledge/products/actions";
import { saveProfile } from "@/app/dashboard/knowledge/profile/actions";
import { StudioNotFoundError } from "@/lib/studio/service";
import { missing } from "@/tests/stubs/entitlements";

const product = {
  kind: "SERVICE" as const,
  name: "Home deep cleaning",
  summary: "A full clean of your home by a team of two.",
  priceModel: "FROM" as const,
  price: "25000",
  currency: "RWF",
  usps: ["Same-week booking"],
  details: { duration: "4 hours", places: ["on_site" as const], bookingNeeded: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  role.value = "MEMBER";
  missing.clear();
  prisma.business.findUnique.mockResolvedValue({ id: "b1" });
  prisma.product.count.mockResolvedValue(0);
  prisma.campaign.count.mockResolvedValue(0);
  prisma.product.create.mockResolvedValue({ id: "prod1" });
  prisma.campaign.create.mockResolvedValue({ id: "camp1" });
  prisma.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === "function" ? (arg as (tx: typeof prisma) => unknown)(prisma) : Promise.all(arg as unknown[])));
});

describe("products", () => {
  it("lets a Member create one, with the price in the smallest unit and only the kind's own details", async () => {
    const result = await createProduct({ ...product, details: { ...product.details, warranty: "never stored" } as never });
    expect(result).toEqual({ ok: true, productId: "prod1" });
    const data = prisma.product.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ businessId: "b1", kind: "SERVICE", priceModel: "FROM", priceAmount: 25000, currency: "RWF", status: "ACTIVE" });
    expect(data.details).toEqual({ duration: "4 hours", places: ["on_site"], bookingNeeded: true });
    expect(rateLimitMock).toHaveBeenCalledWith("projectCreate:u1", expect.objectContaining({ limit: 30 }));
  });

  it("answers field errors for the required fields and creates nothing", async () => {
    const result = await createProduct({ ...product, name: " ", summary: "", usps: [], price: "" });
    expect(result).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String), summary: expect.any(String), usps: expect.any(String), price: expect.any(String) } });
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it("needs the content feature, stops at the cap and answers a rate limit in words", async () => {
    missing.add("content");
    expect(await createProduct(product)).toMatchObject({ ok: false, error: expect.stringMatching(/not part of your plan/) });
    missing.clear();
    prisma.product.count.mockResolvedValue(500);
    expect(await createProduct(product)).toMatchObject({ ok: false, error: expect.stringMatching(/limit of 500 products/) });
    const { RateLimitError } = await import("@/lib/rate-limit");
    rateLimitMock.mockRejectedValueOnce(new RateLimitError(120));
    expect(await createProduct(product)).toMatchObject({ ok: false, error: expect.stringContaining("2 minutes") });
  });

  it("only updates, archives and deletes the business's own product", async () => {
    prisma.product.updateMany.mockResolvedValue({ count: 0 });
    prisma.product.deleteMany.mockResolvedValue({ count: 0 });
    expect(await updateProduct("theirs", product)).toMatchObject({ ok: false, error: "We could not find that product." });
    expect(await changeProductStatus("theirs", "ARCHIVED")).toMatchObject({ ok: false });
    expect(await deleteProduct("theirs")).toMatchObject({ ok: false });
    for (const call of [...prisma.product.updateMany.mock.calls, ...prisma.product.deleteMany.mock.calls]) expect(call[0].where).toEqual({ id: "theirs", businessId: "b1" });
  });

  it("deletes without the content feature (removing your own data always works)", async () => {
    missing.add("content");
    prisma.product.deleteMany.mockResolvedValue({ count: 1 });
    expect(await deleteProduct("prod1")).toEqual({ ok: true });
  });
});

describe("campaigns", () => {
  const campaign = { type: "EVENT" as const, name: "Open day", startsOn: "2026-10-24", productIds: ["prod1", "prod1"] };

  it("links only the business's own products", async () => {
    prisma.product.findMany.mockResolvedValue([{ id: "prod1" }]);
    expect(await createCampaign(campaign)).toEqual({ ok: true, campaignId: "camp1" });
    expect(prisma.product.findMany.mock.calls[0][0].where).toEqual({ businessId: "b1", id: { in: ["prod1"] } });
    expect(prisma.campaign.create.mock.calls[0][0].data).toMatchObject({ businessId: "b1", type: "EVENT", startsAt: new Date("2026-10-24T00:00:00.000Z"), products: { create: [{ productId: "prod1" }] } });

    prisma.product.findMany.mockResolvedValue([]);
    expect(await createCampaign({ ...campaign, productIds: ["theirs"] })).toMatchObject({ ok: false, error: expect.stringMatching(/linked products could not be found/) });
  });

  it("refuses an event without a date and an end before the start", async () => {
    expect(await createCampaign({ ...campaign, startsOn: "" })).toMatchObject({ ok: false, fieldErrors: { startsOn: expect.any(String) } });
    expect(await createCampaign({ ...campaign, endsOn: "2026-10-01" })).toMatchObject({ ok: false, fieldErrors: { endsOn: expect.any(String) } });
    expect(prisma.campaign.create).not.toHaveBeenCalled();
  });

  it("replaces the links on update", async () => {
    prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
    prisma.product.findMany.mockResolvedValue([{ id: "prod2" }]);
    expect(await updateCampaign("camp1", { ...campaign, productIds: ["prod2"] })).toEqual({ ok: true, campaignId: "camp1" });
    expect(prisma.campaignProduct.deleteMany).toHaveBeenCalledWith({ where: { campaignId: "camp1", productId: { notIn: ["prod2"] } } });
    expect(prisma.campaignProduct.createMany).toHaveBeenCalledWith({ data: [{ campaignId: "camp1", productId: "prod2" }], skipDuplicates: true });
  });
});

describe("content", () => {
  it("generates for the business's own product, as a regeneration once a version exists", async () => {
    prisma.product.findFirst.mockResolvedValue({ id: "prod1" });
    prisma.campaign.findFirst.mockResolvedValue(null);
    prisma.generatedContent.count.mockResolvedValue(2);
    service.generatePackForSubject.mockResolvedValue({ packId: "pack-1", contents: [{ id: "c2" }, { id: "c3" }] });
    expect(await generateContent("prod1", { instruction: "  shorter " })).toEqual({ ok: true, contentId: "c2" });
    expect(service.generatePackForSubject).toHaveBeenCalledWith(expect.objectContaining({ businessId: "b1", subject: { kind: "product", id: "prod1" }, instruction: "shorter", feature: "regenerate" }));
    expect(service.draftPostsFromPack).toHaveBeenCalledWith({ businessId: "b1" }, "pack-1");
  });

  it("treats another business's product or campaign as not found, without charging", async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    prisma.campaign.findFirst.mockResolvedValue(null);
    expect(await generateContent("theirs")).toMatchObject({ ok: false, error: "We could not find that." });
    expect(prisma.product.findFirst.mock.calls[0][0].where).toEqual({ id: "theirs", businessId: "b1" });
    expect(service.generatePackForSubject).not.toHaveBeenCalled();
  });

  it("maps a usage block and a vanished subject", async () => {
    prisma.product.findFirst.mockResolvedValue({ id: "prod1" });
    prisma.generatedContent.count.mockResolvedValue(0);
    service.generatePackForSubject.mockRejectedValueOnce(new usage.UsageLimitError("trial_expired", "text"));
    expect(await generateContent("prod1")).toMatchObject({ ok: false, blocked: "trial_expired" });
    service.generatePackForSubject.mockRejectedValueOnce(new StudioNotFoundError());
    expect(await generateContent("prod1")).toMatchObject({ ok: false, error: "We could not find that." });
  });

  it("saves an edit as a new version of the same subject, scoped to the business, without a credit", async () => {
    prisma.generatedContent.findFirst.mockResolvedValueOnce(null);
    expect((await saveEditedContent("c-other", { caption: "x", hashtags: [], videoScript: "", adHeadlines: [] })).ok).toBe(false);
    expect(prisma.generatedContent.findFirst.mock.calls[0][0].where).toEqual({ id: "c-other", businessId: "b1" });

    prisma.generatedContent.findFirst.mockResolvedValue({ productId: null, campaignId: "camp1", language: "French" });
    prisma.generatedContent.create.mockResolvedValue({ id: "c3" });
    prisma.generatedContent.findMany.mockResolvedValue([]);
    expect(await saveEditedContent("c1", { caption: "Mon texte", hashtags: ["pain", "#bio"], videoScript: "s", adHeadlines: ["H"] })).toEqual({ ok: true, contentId: "c3" });
    expect(prisma.generatedContent.create.mock.calls[0][0].data).toMatchObject({ businessId: "b1", productId: null, campaignId: "camp1", language: "French", edited: true, provider: "edit", hashtags: ["#pain", "#bio"] });
    expect(service.generateForSubject).not.toHaveBeenCalled();
  });
});

describe("company profile", () => {
  const profile = { name: "Sunrise Bakery", about: "We bake bread every morning in Kimironko.", industry: "other", industryOther: "Bakery", industryDescription: "A family bakery in Kigali selling bread and cakes." };

  it("needs the settings permission: a Member is told to ask", async () => {
    expect(await saveProfile(profile)).toMatchObject({ ok: false, error: expect.stringMatching(/Ask your company owner or an admin/) });
    expect(prisma.business.findUnique).not.toHaveBeenCalled();
  });

  it("requires the name, what the company does and the sector", async () => {
    role.value = "ADMIN";
    expect(await saveProfile({ ...profile, name: "", about: "", industry: "" })).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String), about: expect.any(String), industry: expect.any(String) } });
  });

  it("writes the columns, the profile JSON and the service area into the business info", async () => {
    role.value = "OWNER";
    prisma.business.findUnique.mockResolvedValueOnce({ id: "b1" }).mockResolvedValueOnce({ industryId: null, knowledge: { hours: "8-18", area: "old" } });
    const update = vi.fn();
    (prisma.business as Record<string, unknown>).update = update;
    const result = await saveProfile({ ...profile, website: "sunrise.rw", serviceArea: "Kigali", values: ["Honesty", "honesty"], yearFounded: "2015", size: "6-20" });
    expect(result).toEqual({ ok: true });
    expect(update.mock.calls[0][0]).toMatchObject({
      where: { id: "b1" },
      data: { name: "Sunrise Bakery", website: "https://sunrise.rw", industryId: null, industryOther: "Bakery", industry: "Bakery", profile: { about: profile.about, values: ["Honesty"], yearFounded: 2015, size: "6-20" }, knowledge: { hours: "8-18", area: "Kigali" } },
    });
  });
});

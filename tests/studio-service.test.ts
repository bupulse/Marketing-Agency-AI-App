import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  business: { findUnique: vi.fn() },
  product: { findFirst: vi.fn() },
  campaign: { findFirst: vi.fn() },
  campaignProduct: { findFirst: vi.fn() },
  productPhoto: { findMany: vi.fn() },
  campaignPhoto: { findMany: vi.fn() },
  generatedContent: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn() },
  aiCall: { create: vi.fn(), aggregate: vi.fn().mockResolvedValue({ _sum: { costUsd: 0 } }) },
}));
const usage = vi.hoisted(() => {
  class UsageLimitError extends Error {
    constructor(
      public reason: string,
      public metric: string,
    ) {
      super(reason);
    }
  }
  return { consumeUsage: vi.fn(), refundUsage: vi.fn(), UsageLimitError };
});
const generate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/knowledge/writer-context", () => ({ writerKnowledge: async () => ({ knowledgeBase: null, voiceProfile: null }) }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/usage", () => usage);
vi.mock("@/lib/ai", () => ({ getTextProvider: () => ({ name: "gemini", generate }) }));

import { generateForSubject as generateForProject, StudioNotFoundError } from "@/lib/studio/service";

const periodStart = new Date("2026-10-01T00:00:00Z");
const business = {
  id: "b1",
  name: "Sunrise Bakery",
  industry: "Food",
  description: "Bread",
  audience: "Neighbours",
  tone: "warm",
  website: null,
  contentLanguage: "French",
  knowledge: { hours: "7-18", faqs: [] },
  profile: { tagline: "Fresh every morning", values: ["Honesty"] },
};
const product = {
  id: "p1",
  kind: "PHYSICAL",
  name: "Sourdough loaf",
  category: "Bread",
  summary: "A slow-fermented sourdough loaf.",
  description: "baked at 6am",
  priceModel: "FIXED",
  priceAmount: 3500,
  currency: "RWF",
  priceNote: null,
  usps: ["Baked every morning"],
  features: ["slow fermented"],
  targetCustomer: "Families in Kigali",
  details: { variants: ["Large", "Small"], condition: "new", delivery: "Moto in Kigali", warranty: null },
};
const aiJson = JSON.stringify({ caption: "Pain frais.", hashtags: ["pain"], videoScript: "0-5s four", adHeadlines: ["Pain frais"] });
const args = { userId: "u1", businessId: "b1", subject: { kind: "product" as const, id: "p1" }, feature: "content" as const };

beforeEach(() => {
  vi.resetAllMocks();
  prisma.aiCall.aggregate.mockResolvedValue({ _sum: { costUsd: 0 } }); // under the monthly AI budget
  prisma.business.findUnique.mockResolvedValue(business);
  prisma.product.findFirst.mockResolvedValue(product);
  prisma.productPhoto.findMany.mockResolvedValue([{ asset: { path: "u1/gallery/a.jpg" } }]);
  prisma.generatedContent.findFirst.mockResolvedValue({ caption: "old caption" });
  usage.consumeUsage.mockResolvedValue({ periodStart });
  generate.mockResolvedValue({ text: aiJson, provider: "gemini", model: "gemini-2.5-flash", usage: { inputTokens: 100, outputTokens: 50 } });
  prisma.generatedContent.findMany.mockResolvedValue([]);
  prisma.generatedContent.create.mockImplementation(async ({ data }) => ({ id: "c1", ...data }));
});

describe("generateForProject", () => {
  it("consumes one credit, saves a version with variants and the business language, and writes the ledger", async () => {
    const saved = await generateForProject({ ...args, instruction: "shorter" });

    expect(prisma.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p1", businessId: "b1" } }));
    expect(usage.consumeUsage).toHaveBeenCalledWith("u1", "text");
    expect(usage.refundUsage).not.toHaveBeenCalled();

    const data = prisma.generatedContent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ businessId: "b1", productId: "p1", campaignId: null, language: "French", edited: false, provider: "gemini", hashtags: ["#pain"] });
    expect(data.projectId).toBeUndefined();
    expect(data.variants).toHaveLength(5);
    expect(saved.id).toBe("c1");

    const prompt = generate.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Write all content in French");
    expect(prompt).toContain("The owner asks: shorter");
    expect(prompt).toContain("baked at 6am");
    // The product's full details reach the writer as one fenced data block, and the company profile too.
    expect(prompt).toContain("<<<PRODUCT DATA");
    expect(prompt).toContain("Price: 3,500 RWF");
    expect(prompt).toContain("Why customers choose it:\n- Baked every morning");
    expect(prompt).toContain("Delivery: Moto in Kigali");
    expect(prompt).toContain("Tagline: Fresh every morning");
    expect(prompt).toContain('A previous version read:\n"""old caption"""');

    expect(prisma.aiCall.create).toHaveBeenCalledTimes(1);
    expect(prisma.aiCall.create.mock.calls[0][0].data).toMatchObject({
      userId: "u1",
      businessId: "b1",
      feature: "content",
      provider: "gemini",
      model: "gemini-2.5-flash",
      inputTokens: 100,
      outputTokens: 50,
      success: true,
    });
  });

  it("records the regenerate feature", async () => {
    await generateForProject({ ...args, feature: "regenerate" });
    expect(prisma.aiCall.create.mock.calls[0][0].data.feature).toBe("regenerate");
  });

  it("refunds the credit and logs a failed call when the AI fails", async () => {
    generate.mockRejectedValue(new Error("boom"));
    await expect(generateForProject(args)).rejects.toThrow("boom");
    expect(usage.refundUsage).toHaveBeenCalledWith("u1", "text", periodStart);
    expect(prisma.generatedContent.create).not.toHaveBeenCalled();
    expect(prisma.aiCall.create.mock.calls[0][0].data).toMatchObject({ success: false, feature: "content" });
  });

  it("refunds when the content cannot be saved", async () => {
    prisma.generatedContent.create.mockRejectedValue(new Error("db down"));
    await expect(generateForProject(args)).rejects.toThrow("db down");
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
  });

  it("refunds when the AI returns an unusable format", async () => {
    generate.mockResolvedValue({ text: "nope", provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
    await expect(generateForProject(args)).rejects.toThrow();
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
  });

  it("lets a usage block through without calling the AI", async () => {
    usage.consumeUsage.mockRejectedValue(new usage.UsageLimitError("limit_reached", "text"));
    await expect(generateForProject(args)).rejects.toBeInstanceOf(usage.UsageLimitError);
    expect(generate).not.toHaveBeenCalled();
    expect(usage.refundUsage).not.toHaveBeenCalled();
  });

  it("writes for a campaign with its dates and linked products", async () => {
    prisma.campaign.findFirst.mockResolvedValue({ id: "k1", type: "EVENT", name: "Bread tasting", description: null, startsAt: new Date("2026-10-24T00:00:00Z"), endsAt: null, priceInfo: "Free entry", highlights: ["Live music"], products: [{ product }] });
    prisma.campaignPhoto.findMany.mockResolvedValue([]);
    prisma.campaignProduct.findFirst.mockResolvedValue({ productId: "p1" });
    await generateForProject({ ...args, subject: { kind: "campaign", id: "k1" } });
    expect(prisma.generatedContent.create.mock.calls[0][0].data).toMatchObject({ productId: null, campaignId: "k1" });
    const prompt = generate.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("<<<CAMPAIGN DATA");
    expect(prompt).toContain("Dates: 24 Oct 2026");
    expect(prompt).toContain("- Sourdough loaf: A slow-fermented sourdough loaf. (3,500 RWF)");
  });

  it("does not charge for a product that is not this business's", async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(generateForProject(args)).rejects.toBeInstanceOf(StudioNotFoundError);
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });
});

describe("ledger detail", () => {
  it("records tokens billed by a failed call and the configured model", async () => {
    const { AIProviderError } = await import("@/lib/ai/types");
    generate.mockRejectedValue(new AIProviderError("no text", "gemini", false, { inputTokens: 7, outputTokens: 9 }, "gemini-2.5-flash"));
    await expect(generateForProject(args)).rejects.toThrow();
    expect(prisma.aiCall.create.mock.calls[0][0].data).toMatchObject({ success: false, inputTokens: 7, outputTokens: 9, model: "gemini-2.5-flash" });
  });

  it("records billed tokens when the JSON cannot be parsed", async () => {
    generate.mockResolvedValue({ text: "nope", provider: "gemini", model: "gemini-2.5-flash", usage: { inputTokens: 5, outputTokens: 6 } });
    await expect(generateForProject(args)).rejects.toThrow();
    expect(prisma.aiCall.create.mock.calls[0][0].data).toMatchObject({ inputTokens: 5, outputTokens: 6 });
  });

  it("uses a pre-reserved credit without consuming another", async () => {
    await generateForProject({ ...args, reservation: { periodStart } });
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });

  it("deletes the oldest versions beyond 50", async () => {
    prisma.generatedContent.findMany.mockResolvedValue([{ id: "old1" }]);
    await generateForProject(args);
    expect(prisma.generatedContent.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["old1"] } } });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  project: { findFirst: vi.fn() },
  generatedContent: { create: vi.fn() },
  aiCall: { create: vi.fn() },
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
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/usage", () => usage);
vi.mock("@/lib/ai", () => ({ getTextProvider: () => ({ name: "gemini", generate }) }));

import { generateForProject, StudioNotFoundError } from "@/lib/studio/service";

const periodStart = new Date("2026-10-01T00:00:00Z");
const project = {
  id: "p1",
  type: "product",
  title: "Sourdough loaf",
  price: "$8",
  features: ["slow fermented"],
  details: { notes: "baked at 6am" },
  contents: [{ caption: "old caption" }],
  business: {
    name: "Sunrise Bakery",
    industry: "Food",
    description: "Bread",
    audience: "Neighbours",
    tone: "warm",
    website: null,
    contentLanguage: "French",
    knowledge: { hours: "7-18", faqs: [] },
  },
};
const aiJson = JSON.stringify({ caption: "Pain frais.", hashtags: ["pain"], videoScript: "0-5s four", adHeadlines: ["Pain frais"] });
const args = { userId: "u1", businessId: "b1", projectId: "p1", feature: "content" as const };

beforeEach(() => {
  vi.resetAllMocks();
  prisma.project.findFirst.mockResolvedValue(project);
  usage.consumeUsage.mockResolvedValue({ periodStart });
  generate.mockResolvedValue({ text: aiJson, provider: "gemini", model: "gemini-2.5-flash", usage: { inputTokens: 100, outputTokens: 50 } });
  prisma.generatedContent.create.mockImplementation(async ({ data }) => ({ id: "c1", ...data }));
});

describe("generateForProject", () => {
  it("consumes one credit, saves a version with variants and the business language, and writes the ledger", async () => {
    const saved = await generateForProject({ ...args, instruction: "shorter" });

    expect(prisma.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p1", businessId: "b1" } }));
    expect(usage.consumeUsage).toHaveBeenCalledWith("u1", "text");
    expect(usage.refundUsage).not.toHaveBeenCalled();

    const data = prisma.generatedContent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ projectId: "p1", language: "French", edited: false, provider: "gemini", hashtags: ["#pain"] });
    expect(data.variants).toHaveLength(5);
    expect(saved.id).toBe("c1");

    const prompt = generate.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Write all content in French");
    expect(prompt).toContain("The owner asks: shorter");
    expect(prompt).toContain("baked at 6am");

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

  it("does not charge for a project that is not this business's", async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(generateForProject(args)).rejects.toBeInstanceOf(StudioNotFoundError);
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });
});

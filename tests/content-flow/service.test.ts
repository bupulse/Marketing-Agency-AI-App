import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  business: { findUnique: vi.fn() },
  productPhoto: { findMany: vi.fn() },
  campaignPhoto: { findMany: vi.fn() },
  campaignProduct: { findFirst: vi.fn() },
  mediaAsset: { findMany: vi.fn() },
  contentVisual: { findMany: vi.fn() },
  post: { findMany: vi.fn(), create: vi.fn() },
  contentAngle: { findMany: vi.fn(), upsert: vi.fn() },
  testimonial: { count: vi.fn() },
  knowledgeFaq: { findMany: vi.fn() },
  product: { findFirst: vi.fn() },
  generatedContent: { findMany: vi.fn(), create: vi.fn() },
  connection: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
const usage = vi.hoisted(() => {
  class UsageLimitError extends Error {}
  return { consumeUsage: vi.fn(), refundUsage: vi.fn(), getUsageSummary: vi.fn(), UsageLimitError };
});
const visuals = vi.hoisted(() => ({ aiPhotosAvailable: vi.fn(), videoAvailable: vi.fn(), planVisuals: vi.fn() }));
const ai = vi.hoisted(() => ({ generate: vi.fn() }));
const auto = vi.hoisted(() => ({ autoSchedule: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/usage", () => usage);
vi.mock("@/lib/visuals/service", () => visuals);
vi.mock("@/lib/ai", () => ({ getTextProvider: () => ({ name: "gemini", generate: ai.generate }) }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: (_a: unknown, _b: unknown, fn: () => unknown) => fn() }));
vi.mock("@/lib/content-board/auto", () => auto);
vi.mock("@/lib/studio/service", () => ({ configuredModel: () => "test-model" }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/knowledge/writer-context", () => ({ writerKnowledge: async () => ({ knowledgeBase: null, voiceProfile: null }) }));
vi.mock("@/lib/knowledge/service", async (orig) => ({
  ...(await orig<typeof import("@/lib/knowledge/service")>()),
  writingSubject: vi.fn(async () => ({ subject: { kind: "product", id: "p1" }, type: "product", title: "Hydro tower", context: null, price: "15,000 RWF", features: ["Grows 40 plants"], photoPaths: [] })),
}));

import { runDayContent } from "@/lib/content-flow/service";

const NOW = new Date("2026-10-13T06:00:00Z"); // 08:00 in Kigali
const owner = { userId: "u1", businessId: "b1" };
const album = [
  { asset: { path: "u1/gallery/p1.jpg", name: "Tower in a classroom.jpg", mimeType: "image/jpeg" } },
  { asset: { path: "u1/gallery/v1.mp4", name: "Tower demo.mp4", mimeType: "video/mp4" } },
];

function aiAnswer(caption = "Fresh greens at school, every week.") {
  return { text: JSON.stringify({ caption, hashtags: ["#green", "#school"], headline: "Grow at school", videoScript: "0-3s: hook" }), provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } };
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.business.findUnique.mockResolvedValue({ id: "b1", name: "Green Kigali", timezone: "Africa/Kigali", contentLanguage: "English", industry: null, industryRef: null, description: null, audience: null, tone: "friendly", website: null, knowledge: null, profile: null, marketingProfile: null, brandColors: [] });
  prisma.productPhoto.findMany.mockResolvedValue(album);
  prisma.mediaAsset.findMany.mockResolvedValue([]);
  prisma.contentVisual.findMany.mockResolvedValue([]);
  prisma.post.findMany.mockResolvedValue([]);
  prisma.contentAngle.findMany.mockResolvedValue([{ day: new Date("2026-10-12T00:00:00Z"), angle: "how", hook: "question", structure: "list" }]);
  prisma.contentAngle.upsert.mockResolvedValue({});
  prisma.testimonial.count.mockResolvedValue(0);
  prisma.knowledgeFaq.findMany.mockResolvedValue([]);
  prisma.product.findFirst.mockResolvedValue({ createdAt: new Date("2026-01-01") });
  prisma.generatedContent.findMany.mockResolvedValue([{ caption: "Yesterday's post about the tower." }]);
  let n = 0;
  prisma.generatedContent.create.mockImplementation(async () => ({ id: `content-${++n}` }));
  prisma.connection.findMany.mockResolvedValue([{ id: "c-ig", provider: "instagram", status: "ACTIVE", postingMode: "AUTO", kind: "SOCIAL" }]);
  prisma.post.create.mockImplementation(({ data }: { data: unknown }) => data);
  prisma.$transaction.mockImplementation(async (list: unknown[]) => list.map((_, i) => ({ id: `post-${i}` })));
  usage.consumeUsage.mockResolvedValue({ periodStart: new Date("2026-10-01") });
  usage.refundUsage.mockResolvedValue(undefined);
  usage.getUsageSummary.mockResolvedValue({ used: { text: 2, image: 0 }, limits: { text: 30, image: 10 } });
  visuals.aiPhotosAvailable.mockResolvedValue(true);
  visuals.videoAvailable.mockResolvedValue(true);
  visuals.planVisuals.mockResolvedValue({ image: "v1", video: null });
  ai.generate.mockResolvedValue(aiAnswer());
  auto.autoSchedule.mockResolvedValue({ scheduled: 0, waiting: 3 });
});

describe("AI makes it for me", () => {
  it("writes one post per network (one text generation each), album video first, and drafts them for today", async () => {
    const result = await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "ai", networks: ["instagram", "tiktok", "facebook"] }, NOW);
    expect(result).toMatchObject({ day: "2026-10-13", posts: 3, failed: [], skipped: [] });
    expect(usage.consumeUsage).toHaveBeenCalledTimes(3);
    expect(ai.generate).toHaveBeenCalledTimes(3);

    // Yesterday was "how": today's angle is another one, remembered for the next day.
    expect(result.angle).not.toBe("how");
    expect(prisma.contentAngle.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ subjectKey: "product:p1", source: "studio", angle: result.angle }) }));

    const prompts = ai.generate.mock.calls.map((c) => c[0].prompt as string);
    expect(prompts.find((p) => p.includes("TikTok:"))).toContain('"Tower demo"');
    expect(prompts.every((p) => p.includes("Today's angle:") && p.includes("Yesterday's post about the tower."))).toBe(true);

    const contents = prisma.generatedContent.create.mock.calls.map((c) => c[0].data);
    expect(contents.map((c) => c.network)).toEqual(["instagram", "tiktok", "facebook"]);
    expect(contents[0]).toMatchObject({ businessId: "b1", productId: "p1", mode: "ai", angle: result.angle, forDate: new Date("2026-10-13T00:00:00Z") });

    const posts = prisma.post.create.mock.calls.map((c) => c[0].data);
    expect(posts.find((p) => p.network === "tiktok")).toMatchObject({ format: "SCRIPT", mediaPaths: ["u1/gallery/v1.mp4"], text: "Fresh greens at school, every week.", remindOnly: true, connectionId: null });
    expect(posts.find((p) => p.network === "instagram")).toMatchObject({ format: "POST", mediaPaths: ["u1/gallery/v1.mp4"], connectionId: "c-ig", status: "PENDING_APPROVAL", source: "STUDIO" });
    expect(posts.find((p) => p.network === "facebook")).toMatchObject({ format: "POST", mediaPaths: [] });
    expect(new Set(posts.map((p) => p.groupId)).size).toBe(1);

    // Only Facebook gets a designed picture (the others use the album video), with AI photos allowed.
    expect(visuals.planVisuals).toHaveBeenCalledTimes(1);
    expect(visuals.planVisuals.mock.calls[0][0]).toMatchObject({ target: { contentId: "content-3" }, aiAllowed: true, photos: ["u1/gallery/p1.jpg"], video: false });
    expect(auto.autoSchedule).toHaveBeenCalledWith("b1", ["post-0", "post-1", "post-2"], NOW);
  });

  it("uses free designs only with Free templates", async () => {
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook", "linkedin"] }, NOW);
    expect(visuals.planVisuals.mock.calls.every((c) => c[0].aiAllowed === false)).toBe(true);
  });

  it("refuses before charging when the text generations left do not cover the posts", async () => {
    usage.getUsageSummary.mockResolvedValue({ used: { text: 29, image: 0 }, limits: { text: 30, image: 10 } });
    await expect(runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook", "linkedin"] }, NOW)).rejects.toThrow(/Not enough text generations/);
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });

  it("gives the credit back for a post the AI could not write, and keeps the others", async () => {
    ai.generate.mockRejectedValueOnce(new Error("AI down"));
    const result = await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook", "linkedin"] }, NOW);
    expect(result.posts).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
  });
});

describe("Describe today's content", () => {
  it("puts the owner's brief in the prompt as data", async () => {
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "describe", design: "free", networks: ["facebook"], brief: "Promote the hydro tower for schools this week" }, NOW);
    const prompt = ai.generate.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("<<<OWNER BRIEF\nPromote the hydro tower for schools this week");
    expect(prisma.generatedContent.create.mock.calls[0][0].data).toMatchObject({ mode: "describe", brief: "Promote the hydro tower for schools this week" });
  });

  it("needs a brief", async () => {
    await expect(runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "describe", design: "free", networks: ["facebook"] }, NOW)).rejects.toThrow(/Describe today's content/);
  });
});

describe("Bring my own", () => {
  beforeEach(() => {
    prisma.mediaAsset.findMany.mockResolvedValue([{ path: "u1/gallery/mine.jpg", name: "mine.jpg", mimeType: "image/jpeg" }]);
    ai.generate.mockResolvedValue({ text: JSON.stringify({ caption: "Our tower, now in schools.", hashtags: ["#school"] }), provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
  });

  it("adapts the caption per network, uses the owner's photo as is and skips networks that need a video", async () => {
    const result = await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "own", design: "free", networks: ["facebook", "tiktok"], caption: "Our tower is now in schools!", mediaPaths: ["u1/gallery/mine.jpg", "u9/gallery/not-mine.jpg"] }, NOW);
    expect(result).toMatchObject({ posts: 1, skipped: [{ network: "tiktok", reason: "TikTok needs a video." }], angle: null });
    expect(prisma.mediaAsset.findMany.mock.calls[0][0].where.businessId).toBe("b1");
    expect(ai.generate.mock.calls[0][0].prompt).toContain("<<<OWNER CAPTION\nOur tower is now in schools!");
    expect(prisma.post.create.mock.calls[0][0].data).toMatchObject({ network: "facebook", format: "POST", mediaPaths: ["u1/gallery/mine.jpg"], text: "Our tower, now in schools." });
    expect(visuals.planVisuals).not.toHaveBeenCalled();
    expect(prisma.contentAngle.upsert).not.toHaveBeenCalled();
  });

  it("still posts the owner's own caption, uncharged, when the adaptation fails", async () => {
    ai.generate.mockRejectedValue(new Error("AI down"));
    const result = await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "own", design: "free", networks: ["facebook"], caption: "Our tower is now in schools! #green", mediaPaths: ["u1/gallery/mine.jpg"] }, NOW);
    expect(result.posts).toBe(1);
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
    expect(prisma.post.create.mock.calls[0][0].data).toMatchObject({ text: "Our tower is now in schools!", hashtags: ["#green"] });
  });

  it("needs media from the owner's own gallery", async () => {
    prisma.mediaAsset.findMany.mockResolvedValue([]);
    await expect(runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "own", design: "free", networks: ["facebook"], caption: "Hi", mediaPaths: ["u9/gallery/x.jpg"] }, NOW)).rejects.toThrow(/Choose your photos or videos/);
  });
});

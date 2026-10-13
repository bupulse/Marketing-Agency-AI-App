import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  business: { findUnique: vi.fn(), updateMany: vi.fn() },
  productPhoto: { findMany: vi.fn() },
  campaignPhoto: { findMany: vi.fn() },
  campaignProduct: { findFirst: vi.fn() },
  mediaAsset: { findMany: vi.fn() },
  contentVisual: { findMany: vi.fn() },
  post: { findMany: vi.fn(), create: vi.fn() },
  generatedContent: { findMany: vi.fn(), create: vi.fn() },
  connection: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
const usage = vi.hoisted(() => {
  class UsageLimitError extends Error {}
  return { consumeUsage: vi.fn(), refundUsage: vi.fn(), getUsageSummary: vi.fn(), UsageLimitError };
});
const visuals = vi.hoisted(() => ({ aiPhotosAvailable: vi.fn(), videoAvailable: vi.fn(), planVisuals: vi.fn(), audienceFor: vi.fn(async () => undefined), directionContext: (x: unknown) => x }));
const pack = vi.hoisted(() => ({ angleFacts: vi.fn(), recentAngles: vi.fn(), aiImagesLeft: vi.fn() }));
const director = vi.hoisted(() => ({ directVisual: vi.fn(async (ctx: { aiAllowed: boolean }) => ({ plan: "directed", ai: ctx.aiAllowed })) }));
const ai = vi.hoisted(() => ({ generate: vi.fn() }));
const auto = vi.hoisted(() => ({ autoSchedule: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/usage", () => usage);
vi.mock("@/lib/entitlements", () => ({ featureStatus: vi.fn(async () => "ok") }));
vi.mock("@/lib/visuals/service", () => visuals);
vi.mock("@/lib/studio/pack", () => pack);
vi.mock("@/lib/visuals/art-director", async (orig) => ({ ...(await orig<typeof import("@/lib/visuals/art-director")>()), directVisual: director.directVisual }));
vi.mock("@/lib/visuals/direction", async (orig) => ({ ...(await orig<typeof import("@/lib/visuals/direction")>()), diversifyPack: (plans: unknown[]) => plans }));
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

import { ALREADY_DONE, ALREADY_RUNNING, runDayContent } from "@/lib/content-flow/service";

const NOW = new Date("2026-10-13T06:00:00Z"); // 08:00 in Kigali
const owner = { userId: "u1", businessId: "b1" };
const album = [
  { asset: { path: "u1/gallery/p1.jpg", name: "Tower in a classroom.jpg", mimeType: "image/jpeg" } },
  { asset: { path: "u1/gallery/v1.mp4", name: "Tower demo.mp4", mimeType: "video/mp4" } },
];

/** The pack writer's answer: one post per line of the prompt's list. */
function packAnswer(prompt: string, drop: number[] = []) {
  const count = (prompt.match(/^\d+\. Angle "/gm) ?? []).length;
  const posts = Array.from({ length: count }, (_, i) => ({ index: i + 1, caption: `Post ${i + 1}: fresh greens at school.`, hashtags: ["#green", "#school"], videoScript: "0-3s: hook", headline: "Grow at school" })).filter((p) => !drop.includes(p.index));
  return { text: JSON.stringify({ posts }), provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } };
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.business.findUnique.mockResolvedValue({ id: "b1", name: "Green Kigali", timezone: "Africa/Kigali", contentLanguage: "English", industry: null, industryRef: null, description: null, audience: null, tone: "friendly", website: null, knowledge: null, profile: null, marketingProfile: null, brandColors: [] });
  prisma.business.updateMany.mockResolvedValue({ count: 1 });
  prisma.productPhoto.findMany.mockResolvedValue(album);
  prisma.mediaAsset.findMany.mockResolvedValue([]);
  prisma.contentVisual.findMany.mockResolvedValue([]);
  prisma.post.findMany.mockResolvedValue([]);
  pack.angleFacts.mockResolvedValue({ subjectType: "product", hasPrice: true, isNew: false, hasCompetitors: false, hasFaqs: false, moment: null });
  pack.recentAngles.mockResolvedValue(["features", "price"]);
  pack.aiImagesLeft.mockResolvedValue({ count: 10, exhausted: null });
  prisma.generatedContent.findMany.mockResolvedValue([{ caption: "Yesterday's post about the tower." }]);
  let n = 0;
  prisma.generatedContent.create.mockImplementation(async () => ({ id: `content-${++n}` }));
  prisma.connection.findMany.mockResolvedValue([{ id: "c-ig", provider: "instagram", status: "ACTIVE", postingMode: "AUTO", kind: "SOCIAL" }]);
  prisma.post.create.mockImplementation(({ data }: { data: unknown }) => data);
  prisma.$transaction.mockImplementation(async (list: unknown[]) => list.map((_, i) => ({ id: `post-${i}` })));
  usage.consumeUsage.mockResolvedValue({ periodStart: new Date("2026-10-01") });
  usage.refundUsage.mockResolvedValue(undefined);
  usage.getUsageSummary.mockResolvedValue({ used: { text: 2, image: 0, videoSeconds: 0, voiceCharacters: 0 }, limits: { text: 30, image: 10, videoSeconds: 240, voiceCharacters: 20000 } });
  visuals.aiPhotosAvailable.mockResolvedValue(true);
  visuals.videoAvailable.mockResolvedValue(true);
  visuals.planVisuals.mockResolvedValue({ image: "v1", video: null });
  ai.generate.mockImplementation(async ({ prompt }: { prompt: string }) => packAnswer(prompt));
  auto.autoSchedule.mockResolvedValue({ scheduled: 0, waiting: 3 });
});

describe("AI makes it for me (a content pack for the day)", () => {
  it("writes one post per app in one call (one text generation each), new angles, album video first, drafted for today", async () => {
    const result = await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "ai", networks: ["instagram", "tiktok", "facebook"] }, NOW);
    expect(result).toMatchObject({ day: "2026-10-13", posts: 3, failed: [], skipped: [] });
    expect(usage.consumeUsage).toHaveBeenCalledWith("u1", "text", 3);
    expect(usage.refundUsage).not.toHaveBeenCalled();
    expect(ai.generate).toHaveBeenCalledTimes(1);

    // The packs' rotation: the subject's last angles (features, price) do not come back first; all three differ.
    expect(new Set(result.angles).size).toBe(3);
    expect(result.angles).not.toContain("features");
    expect(result.angles).not.toContain("price");

    const prompt = ai.generate.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('"Tower demo"');
    expect(prompt).toContain("<<<RECENT POSTS\n- Yesterday's post about the tower.");
    expect(prompt).toContain("These posts are for 2026-10-13.");
    expect(prompt).toMatch(/Opening: .* Structure: /);

    const contents = prisma.generatedContent.create.mock.calls.map((c) => c[0].data);
    expect(contents.map((c) => c.network).sort()).toEqual(["facebook", "instagram", "tiktok"]);
    expect(contents[0]).toMatchObject({ businessId: "b1", productId: "p1", mode: "ai", packId: result.packId, forDate: new Date("2026-10-13T00:00:00Z") });
    expect(contents.map((c) => c.angle).sort()).toEqual([...result.angles].sort());

    const posts = prisma.post.create.mock.calls.map((c) => c[0].data);
    expect(posts.find((p) => p.network === "tiktok")).toMatchObject({ format: "SCRIPT", mediaPaths: ["u1/gallery/v1.mp4"], remindOnly: true, connectionId: null });
    expect(posts.find((p) => p.network === "tiktok")!.text).toMatch(/^Post \d: fresh greens/);
    expect(posts.find((p) => p.network === "instagram")).toMatchObject({ format: "POST", mediaPaths: ["u1/gallery/v1.mp4"], connectionId: "c-ig", status: "PENDING_APPROVAL", source: "STUDIO" });
    expect(posts.find((p) => p.network === "facebook")).toMatchObject({ format: "POST", mediaPaths: [] });
    expect(new Set(posts.map((p) => p.groupId))).toEqual(new Set([result.packId]));

    // Only Facebook gets a designed picture (the others use the album video), with AI people photos allowed.
    expect(director.directVisual).toHaveBeenCalledTimes(1);
    expect(director.directVisual.mock.calls[0][0]).toMatchObject({ aiAllowed: true, photos: ["u1/gallery/p1.jpg"], angle: { label: expect.any(String), people: expect.any(String) } });
    expect(visuals.planVisuals).toHaveBeenCalledTimes(1);
    expect(visuals.planVisuals.mock.calls[0][0]).toMatchObject({ precomputed: { plan: "directed" }, video: false });
    expect(auto.autoSchedule).toHaveBeenCalledWith("b1", ["post-0", "post-1", "post-2"], NOW);
  });

  it("uses free designs only with Free templates", async () => {
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook", "linkedin"] }, NOW);
    expect(director.directVisual).toHaveBeenCalledTimes(2);
    expect(director.directVisual.mock.calls.every((c) => c[0].aiAllowed === false)).toBe(true);
    expect(pack.aiImagesLeft).not.toHaveBeenCalled();
  });

  it("gives AI photos only while the plan's images last", async () => {
    pack.aiImagesLeft.mockResolvedValue({ count: 1, exhausted: { refillAt: "2026-11-01" } });
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "ai", networks: ["facebook", "linkedin"] }, NOW);
    expect(director.directVisual.mock.calls.map((c) => c[0].aiAllowed)).toEqual([true, false]);
    expect(visuals.planVisuals.mock.calls[1][0]).toMatchObject({ aiExhausted: { refillAt: "2026-11-01" } });
  });

  it("refuses before charging when the text generations left do not cover the posts", async () => {
    usage.getUsageSummary.mockResolvedValue({ used: { text: 29, image: 0 }, limits: { text: 30, image: 10 } });
    await expect(runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook", "linkedin"] }, NOW)).rejects.toThrow(/Not enough text generations/);
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });

  it("gives the credit back for a post the AI left out, and all of them when the call fails", async () => {
    ai.generate.mockImplementationOnce(async ({ prompt }: { prompt: string }) => packAnswer(prompt, [2]));
    const result = await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook", "linkedin"] }, NOW);
    expect(result.posts).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(usage.refundUsage).toHaveBeenCalledWith("u1", "text", expect.any(Date), 1);
    ai.generate.mockRejectedValueOnce(new Error("AI down"));
    await expect(runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook", "linkedin"] }, NOW)).rejects.toThrow("AI down");
    expect(usage.refundUsage).toHaveBeenLastCalledWith("u1", "text", expect.any(Date), 2);
  });

  it("works for General (the business itself, its newest Gallery photos)", async () => {
    prisma.mediaAsset.findMany.mockResolvedValue([{ path: "u1/gallery/shop.jpg", name: "Our shop front.jpg", mimeType: "image/jpeg" }]);
    const result = await runDayContent(owner, { scope: { kind: "general" }, mode: "ai", design: "free", networks: ["facebook"] }, NOW);
    expect(result.posts).toBe(1);
    expect(pack.recentAngles).toHaveBeenCalledWith("b1", null);
    expect(prisma.generatedContent.create.mock.calls[0][0].data).toMatchObject({ productId: null, campaignId: null });
    expect(ai.generate.mock.calls[0][0].prompt).toContain('"Our shop front"');
  });
});

describe("one run at a time per company", () => {
  const run = (requestKey: string) => runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook"], requestKey }, NOW);

  it("claims the company, runs, and frees the claim keeping the request key", async () => {
    await run("key-12345678");
    expect(prisma.business.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "b1", OR: [{ contentRunUntil: null }, { contentRunUntil: { lt: NOW } }] }, data: { contentRunKey: "key-12345678" } });
    expect(prisma.business.updateMany).toHaveBeenLastCalledWith({ where: { id: "b1", contentRunKey: "key-12345678" }, data: { contentRunUntil: null } });
  });

  it("refuses while another run holds the claim (two tabs, a team member), before anything is charged", async () => {
    prisma.business.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(run("key-other-1")).rejects.toThrow(ALREADY_RUNNING);
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });

  it("never runs the same request twice (a double click)", async () => {
    prisma.business.findUnique.mockResolvedValueOnce({ contentRunKey: "key-12345678", contentRunUntil: new Date(NOW.getTime() + 60_000) });
    await expect(run("key-12345678")).rejects.toThrow(ALREADY_RUNNING);
    prisma.business.findUnique.mockResolvedValueOnce({ contentRunKey: "key-12345678", contentRunUntil: null });
    await expect(run("key-12345678")).rejects.toThrow(ALREADY_DONE);
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it("frees the claim when the run fails", async () => {
    await expect(runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "describe", design: "free", networks: ["facebook"], requestKey: "key-fail-1" }, NOW)).rejects.toThrow(/Describe/);
    expect(prisma.business.updateMany).toHaveBeenLastCalledWith({ where: { id: "b1", contentRunKey: "key-fail-1" }, data: { contentRunUntil: null } });
  });
});

describe("AI images reserved up front", () => {
  it("pays the art director's AI photos when the run starts and marks the slides as paid", async () => {
    const plans = [{ slides: [{ source: "ai" }, { source: "album" }] }, { slides: [{ source: "ai", aiPhotoPath: null }] }];
    director.directVisual.mockImplementationOnce(async () => plans[0] as never).mockImplementationOnce(async () => plans[1] as never);
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "ai", networks: ["facebook", "linkedin"] }, NOW);
    expect(usage.consumeUsage).toHaveBeenCalledWith("u1", "image", 2);
    expect(plans[0].slides[0]).toMatchObject({ prepaidAi: "2026-10-01T00:00:00.000Z" });
    expect(plans[0].slides[1]).not.toHaveProperty("prepaidAi");
  });
});

describe("Describe today's content", () => {
  it("puts the owner's brief in the prompt as data", async () => {
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "describe", design: "free", networks: ["facebook"], brief: "Promote the hydro tower for schools this week" }, NOW);
    const prompt = ai.generate.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("<<<OWNER BRIEF\nPromote the hydro tower for schools this week");
    expect(usage.consumeUsage).toHaveBeenCalledWith("u1", "text", 1);
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
    expect(result).toMatchObject({ posts: 1, skipped: [{ network: "tiktok", reason: "TikTok needs a video." }], angles: [] });
    expect(prisma.mediaAsset.findMany.mock.calls[0][0].where.businessId).toBe("b1");
    expect(ai.generate.mock.calls[0][0].prompt).toContain("<<<OWNER CAPTION\nOur tower is now in schools!");
    expect(prisma.post.create.mock.calls[0][0].data).toMatchObject({ network: "facebook", format: "POST", mediaPaths: ["u1/gallery/mine.jpg"], text: "Our tower, now in schools." });
    expect(visuals.planVisuals).not.toHaveBeenCalled();
    expect(prisma.generatedContent.create.mock.calls[0][0].data).toMatchObject({ mode: "own", angle: null });
  });

  it("still posts the owner's own caption, uncharged, when the adaptation fails", async () => {
    ai.generate.mockRejectedValue(new Error("AI down"));
    const result = await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "own", design: "free", networks: ["facebook"], caption: "Our tower is now in schools! #green", mediaPaths: ["u1/gallery/mine.jpg"] }, NOW);
    expect(result.posts).toBe(1);
    expect(usage.refundUsage).toHaveBeenCalledWith("u1", "text", expect.any(Date), 1);
    expect(prisma.post.create.mock.calls[0][0].data).toMatchObject({ text: "Our tower is now in schools!", hashtags: ["#green"] });
  });

  it("needs media from the owner's own gallery", async () => {
    prisma.mediaAsset.findMany.mockResolvedValue([]);
    await expect(runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "own", design: "free", networks: ["facebook"], caption: "Hi", mediaPaths: ["u9/gallery/x.jpg"] }, NOW)).rejects.toThrow(/Choose your photos or videos/);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  business: { findUnique: vi.fn(), updateMany: vi.fn() },
  productPhoto: { findMany: vi.fn() },
  campaignPhoto: { findMany: vi.fn() },
  campaignProduct: { findFirst: vi.fn() },
  mediaAsset: { findMany: vi.fn() },
  contentVisual: { findMany: vi.fn(), findFirst: vi.fn() },
  post: { findMany: vi.fn(), create: vi.fn(), groupBy: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  generatedContent: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  connection: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
const usage = vi.hoisted(() => {
  class UsageLimitError extends Error {}
  return { consumeUsage: vi.fn(), refundUsage: vi.fn(), getUsageSummary: vi.fn(), UsageLimitError };
});
const visuals = vi.hoisted(() => ({ aiPhotosAvailable: vi.fn(), videoAvailable: vi.fn(), planVisuals: vi.fn(), updateImageVisual: vi.fn(async () => ({ status: "pending" })), audienceFor: vi.fn(async () => undefined), directionContext: (x: unknown) => x }));
const pack = vi.hoisted(() => ({ angleFacts: vi.fn(), recentAngles: vi.fn(), aiImagesLeft: vi.fn() }));
const director = vi.hoisted(() => ({ directVisual: vi.fn(async (ctx: { aiAllowed: boolean; price?: string | null; caption?: string }) => ({ plan: "directed", ai: ctx.aiAllowed })) }));
const ai = vi.hoisted(() => ({ generate: vi.fn() }));
const auto = vi.hoisted(() => ({ autoSchedule: vi.fn() }));
// The format draws (lib/content-flow/format.ts): 0.99 keeps feed apps on pictures; a test lowers it for videos.
const draw = vi.hoisted(() => ({ value: 0.99 }));
vi.mock("@/lib/autopilot/learning", () => ({ seededRandom: () => () => draw.value }));

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

import { ALREADY_DONE, ALREADY_RUNNING, confirmContest, runDayContent } from "@/lib/content-flow/service";

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
  prisma.post.groupBy.mockResolvedValue([]);
  prisma.productPhoto.findMany.mockResolvedValue(album);
  prisma.mediaAsset.findMany.mockResolvedValue([]);
  prisma.contentVisual.findMany.mockResolvedValue([]);
  prisma.post.findMany.mockResolvedValue([]);
  pack.angleFacts.mockResolvedValue({ subjectType: "product", hasPrice: true, isNew: false, hasCompetitors: false, hasFaqs: false, moment: null });
  pack.recentAngles.mockResolvedValue(["features", "price"]);
  pack.aiImagesLeft.mockResolvedValue({ count: 10, exhausted: null });
  prisma.generatedContent.findMany.mockResolvedValue([{ caption: "Yesterday's post about the tower." }]);
  let n = 0;
  prisma.generatedContent.create.mockImplementation(async ({ data }: { data: { caption: string; adHeadlines: string[]; videoScript: string } }) => ({ id: `content-${++n}`, caption: data.caption, adHeadlines: data.adHeadlines, videoScript: data.videoScript }));
  prisma.connection.findMany.mockResolvedValue([{ id: "c-ig", provider: "instagram", status: "ACTIVE", postingMode: "AUTO", kind: "SOCIAL" }]);
  prisma.post.create.mockImplementation(({ data }: { data: unknown }) => data);
  prisma.$transaction.mockImplementation(async (list: unknown[]) => list.map((_, i) => ({ id: `post-${i}` })));
  usage.consumeUsage.mockResolvedValue({ periodStart: new Date("2026-10-01") });
  usage.refundUsage.mockResolvedValue(undefined);
  usage.getUsageSummary.mockResolvedValue({ used: { text: 2, image: 0, videoSeconds: 0, voiceCharacters: 0 }, limits: { text: 30, image: 10, videoSeconds: 240, voiceCharacters: 20000, postsPerAppPerDay: 3 } });
  visuals.aiPhotosAvailable.mockResolvedValue(true);
  visuals.videoAvailable.mockResolvedValue(true);
  visuals.planVisuals.mockResolvedValue({ image: "v1", video: null });
  ai.generate.mockImplementation(async ({ prompt }: { prompt: string }) => packAnswer(prompt));
  auto.autoSchedule.mockResolvedValue({ scheduled: 0, waiting: 3 });
  draw.value = 0.99;
});

describe("AI makes it for me (a content pack for the day)", () => {
  it("writes one post per app in one call (one text generation each), new angles, album video first, drafted for today", async () => {
    // Instagram's draw falls under its video share (0.55), Facebook's not (0.35).
    draw.value = 0.5;
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

describe("picture or video, decided per post", () => {
  const photosOnly = [{ asset: { path: "u1/gallery/p1.jpg", name: "Tower in a classroom.jpg", mimeType: "image/jpeg" } }];

  it("saves each post's format and makes Instagram a Reel BuPulse renders, keeping its caption", async () => {
    prisma.productPhoto.findMany.mockResolvedValue(photosOnly);
    draw.value = 0.5;
    const result = await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["instagram", "facebook"] }, NOW);
    expect(result).toMatchObject({ videos: 1, notes: [] });
    const contents = prisma.generatedContent.create.mock.calls.map((c) => c[0].data);
    expect(Object.fromEntries(contents.map((c) => [c.network, c.format]))).toEqual({ instagram: "video", facebook: "image" });
    const prompt = ai.generate.mock.calls[0][0].prompt as string;
    expect(prompt).toMatch(/Format: a video post \(write the videoScript\)/);
    expect(prompt).toContain("Every video post's videoScript:");
    const ig = prisma.post.create.mock.calls.map((c) => c[0].data).find((p) => p.network === "instagram")!;
    expect(ig).toMatchObject({ format: "SCRIPT", mediaPaths: [] });
    expect(ig.text).toMatch(/^Post \d: fresh greens/);
    expect(visuals.planVisuals.mock.calls.find((c) => c[0].video)?.[0]).toMatchObject({ image: false, video: true });
  });

  it("with no video seconds left, TikTok gets the script to film and the run says why", async () => {
    prisma.productPhoto.findMany.mockResolvedValue(photosOnly);
    usage.getUsageSummary.mockResolvedValue({ used: { text: 2, image: 0, videoSeconds: 240, voiceCharacters: 0 }, limits: { text: 30, image: 10, videoSeconds: 240, voiceCharacters: 20000, postsPerAppPerDay: 3 } });
    const result = await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["tiktok"], format: "video" }, NOW);
    expect(result.notes).toEqual(["TikTok gets a video script to film yourself: your video seconds for this month are used up."]);
    expect(result.videos).toBe(0);
    const tiktok = prisma.post.create.mock.calls[0][0].data;
    expect(tiktok).toMatchObject({ format: "SCRIPT", mediaPaths: [] });
    expect(tiktok.text).toBe("hook");
    expect(visuals.planVisuals).not.toHaveBeenCalled();
  });

  it("writes the script of a video post the pack writer left without one (one more text generation)", async () => {
    prisma.productPhoto.findMany.mockResolvedValue(photosOnly);
    prisma.generatedContent.findFirst.mockResolvedValue({ id: "content-1", caption: "Post 1", angle: "story", network: "tiktok", productId: "p1", campaignId: null });
    prisma.generatedContent.updateMany.mockResolvedValue({ count: 1 });
    ai.generate.mockImplementationOnce(async ({ prompt }: { prompt: string }) => {
      const answer = packAnswer(prompt);
      const parsed = JSON.parse(answer.text);
      parsed.posts[0].videoScript = "";
      return { ...answer, text: JSON.stringify(parsed) };
    });
    ai.generate.mockResolvedValueOnce({ text: JSON.stringify({ scenes: ["[Tower] Grow greens at school.", "[Kids] Pupils pick lettuce.", "[Logo] Ask us today."] }), provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["tiktok"] }, NOW);
    expect(ai.generate).toHaveBeenCalledTimes(2);
    expect(usage.consumeUsage).toHaveBeenCalledWith("u1", "text", 1);
    expect(usage.consumeUsage).toHaveBeenCalledWith("u1", "text");
    expect(prisma.generatedContent.updateMany).toHaveBeenCalledWith({ where: { id: "content-1", businessId: "b1" }, data: { videoScript: "[Tower] Grow greens at school.\n[Kids] Pupils pick lettuce.\n[Logo] Ask us today." } });
    expect(visuals.planVisuals.mock.calls[0][0]).toMatchObject({ video: true, videoScript: expect.stringContaining("Grow greens at school.") });
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

describe("posts per app, price and ideas", () => {
  it("makes the chosen number per app within the plan, counting today's posts", async () => {
    prisma.post.groupBy.mockResolvedValue([{ network: "facebook", _count: { _all: 2 } }]);
    const result = await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook", "linkedin"], perApp: 2 }, NOW);
    const posts = prisma.post.create.mock.calls.map((c) => c[0].data.network);
    expect(posts.filter((n) => n === "linkedin")).toHaveLength(2);
    expect(posts.filter((n) => n === "facebook")).toHaveLength(1);
    expect(usage.consumeUsage).toHaveBeenCalledWith("u1", "text", 3);
    expect(new Set(result.angles).size).toBe(3);
    // Every post of the subject on the app for the day: by hand, Autopilot or here; going out, gone out, or made today without a time.
    const day = { gte: new Date("2026-10-12T22:00:00Z"), lt: new Date("2026-10-13T22:00:00Z") };
    expect(prisma.post.groupBy.mock.calls[0][0].where).toEqual({ businessId: "b1", productId: "p1", status: { not: "CANCELLED" }, OR: [{ scheduledAt: day }, { publishedAt: day }, { scheduledAt: null, publishedAt: null, createdAt: day }] });
  });

  it("skips an app that already has its posts for today", async () => {
    usage.getUsageSummary.mockResolvedValue({ used: { text: 0, image: 0, videoSeconds: 0, voiceCharacters: 0 }, limits: { text: 30, image: 10, videoSeconds: 0, voiceCharacters: 0 } });
    prisma.post.groupBy.mockResolvedValue([{ network: "facebook", _count: { _all: 1 } }]);
    await expect(runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook"], perApp: 3 }, NOW)).rejects.toThrow("Facebook already has its post for today");
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });

  it("No price: no price angle, every post told so, the price taken out of captions and designs", async () => {
    ai.generate.mockImplementation(async ({ prompt }: { prompt: string }) => {
      const answer = packAnswer(prompt);
      const parsed = JSON.parse(answer.text);
      parsed.posts[0].caption = "Fresh greens at school. Only 15,000 RWF!";
      return { ...answer, text: JSON.stringify(parsed) };
    });
    const result = await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook", "linkedin"], price: "none" }, NOW);
    expect(result.angles).not.toContain("price");
    const prompt = ai.generate.mock.calls[0][0].prompt as string;
    expect(prompt.match(/Do not mention any price/g)).toHaveLength(2);
    expect(prisma.post.create.mock.calls.map((c) => c[0].data.text).join(" ")).not.toContain("15,000");
    expect(director.directVisual.mock.calls.every((c) => c[0].price === null)).toBe(true);
  });

  it("AI decides with one price post: the shared prompt has no price; only that post's line carries it; the others are checked field by field", async () => {
    const { writingSubject } = await import("@/lib/knowledge/service");
    vi.mocked(writingSubject).mockResolvedValueOnce({ subject: { kind: "product", id: "p1" }, type: "product", title: "Hydro tower", context: "Name: Hydro tower\nPrice: 15,000 RWF\nFree installation in Kigali", price: "15,000 RWF", features: ["Grows 40 plants", "20% off this week"], photoPaths: [] } as never);
    pack.recentAngles.mockResolvedValue([]);
    ai.generate.mockImplementation(async ({ prompt }: { prompt: string }) => {
      const answer = packAnswer(prompt);
      const parsed = JSON.parse(answer.text);
      for (const p of parsed.posts) {
        p.caption = `Post ${p.index}: fresh greens at school. Now 10k only! Price on request for schools.`;
        p.videoScript = "0-3s: Only 15,000 RWF!\n3-6s: Grow at school.";
        p.headline = "Only 15,000 RWF";
      }
      return { ...answer, text: JSON.stringify(parsed) };
    });
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["instagram", "facebook", "tiktok", "linkedin"], price: "auto" }, NOW);
    const prompt = ai.generate.mock.calls[0][0].prompt as string;
    expect(prompt.match(/State the price exactly as given: 15,000 RWF\./g)).toHaveLength(1);
    const shared = prompt.split("Write 4 posts")[0];
    expect(shared).not.toMatch(/15,000|20% off|Free installation/);
    const contents = prisma.generatedContent.create.mock.calls.map((c) => c[0].data);
    const unpriced = contents.filter((c) => c.angle !== "price");
    expect(unpriced.length).toBe(3);
    for (const c of unpriced) {
      expect(c.caption).toMatch(/^Post \d: fresh greens at school\.$/);
      expect(c.videoScript).not.toMatch(/15,000/);
      expect(c.adHeadlines).toEqual([]);
    }
  });

  it("a contest's picture never shows the placeholders", async () => {
    const business = await prisma.business.findUnique();
    prisma.business.findUnique.mockResolvedValue({ ...business, marketingProfile: { voice: "Fun", do: ["Be playful"], dont: ["Be stiff"], samples: ["Hi!"], answers: [{ topic: "tone", answer: "Fun and playful" }], approvedAt: "2026-10-01" } });
    pack.recentAngles.mockResolvedValue(["features", "price", "story", "tips", "how-it-works", "news", "faq", "behind-scenes", "cta", "tip-of-day", "did-you-know", "poll", "playful", "myth-fact", "trivia", "meme"]);
    director.directVisual.mockImplementationOnce(async () => ({ slides: [{ headline: "Win [PRIZE]!", subline: "Ends [END DATE]", chip: "[PRIZE]", kicker: "Contest" }] }) as never);
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook"] }, NOW);
    expect(prisma.generatedContent.create.mock.calls[0][0].data.angle).toBe("challenge");
    expect(director.directVisual.mock.calls[0][0].caption).not.toMatch(/\[/);
    const plan = visuals.planVisuals.mock.calls[0][0].precomputed;
    expect(plan.slides[0]).toEqual({ headline: "Win!", subline: "Ends", chip: "", kicker: "Contest" });
  });

  it("With price needs a price on the subject", async () => {
    const { writingSubject } = await import("@/lib/knowledge/service");
    vi.mocked(writingSubject).mockResolvedValueOnce({ subject: { kind: "product", id: "p1" }, type: "product", title: "Hydro tower", context: null, price: null, features: [], photoPaths: [] } as never);
    await expect(runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook"], price: "with" }, NOW)).rejects.toThrow(/Add a price/);
  });

  it("a suggested contest waits for the owner's prize and rules, never auto-approved", async () => {
    // A playful brand (Digital Marketing Profile) gets fun ideas; every other fun idea was used lately.
    const business = await prisma.business.findUnique();
    prisma.business.findUnique.mockResolvedValue({ ...business, marketingProfile: { voice: "Fun and warm", do: ["Be playful"], dont: ["Be stiff"], samples: ["Hi!"], answers: [{ topic: "tone", answer: "Fun and playful" }], approvedAt: "2026-10-01" } });
    pack.recentAngles.mockResolvedValue(["features", "price", "story", "tips", "how-it-works", "news", "faq", "behind-scenes", "cta", "tip-of-day", "did-you-know", "poll", "playful", "myth-fact", "trivia", "meme"]);
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["tiktok"] }, NOW);
    const content = prisma.generatedContent.create.mock.calls[0][0].data;
    expect(content.angle).toBe("challenge");
    const post = prisma.post.create.mock.calls[0][0].data;
    expect(post).toMatchObject({ contest: {}, reviewNote: "Needs your confirmation: prize & rules" });
    expect(post.text).toContain("Rules: [HOW THE WINNER IS CHOSEN]. Ends [END DATE]. Prize: [PRIZE].");
  });
});

describe("confirming a contest", () => {
  it("fills in the owner's prize, end date and rule, guarded by updatedAt", async () => {
    const updatedAt = new Date("2026-10-13T05:00:00Z");
    prisma.post.findFirst.mockResolvedValue({ id: "c1", text: "Win [PRIZE]! Rules: [HOW THE WINNER IS CHOSEN]. Ends [END DATE]. Prize: [PRIZE].", status: "PENDING_APPROVAL", contest: {}, contentId: "content-9", updatedAt });
    prisma.post.updateMany.mockResolvedValue({ count: 1 });
    prisma.contentVisual.findFirst.mockResolvedValue({ id: "vis-1" });
    await confirmContest(owner, "c1", { prize: "$50 & more", endsOn: "2026-10-16", howChosen: "Most likes", willPay: true }, NOW);
    const call = prisma.post.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "c1", businessId: "b1", updatedAt });
    // "$" in the prize is kept as typed (no pattern replacement).
    expect(call.data.text).toBe("Win $50 & more! Rules: Most likes. Ends Friday 16 October. Prize: $50 & more.");
    expect(call.data).toMatchObject({ reviewNote: null, contest: { prize: "$50 & more", endsOn: "2026-10-16", howChosen: "Most likes", confirmedAt: NOW.toISOString() } });
    // Not an owner edit, so the redrawn picture still goes on the post; the cover is redrawn with the prize, photo reused.
    expect(call.data).not.toHaveProperty("ownerEditedAt");
    expect(visuals.updateImageVisual).toHaveBeenCalledWith(owner, "vis-1", { slides: [{ index: 0, chip: "$50 & more" }] });
  });

  it("refuses an end date in the past or more than 90 days ahead (business time zone)", async () => {
    prisma.post.findFirst.mockResolvedValue({ id: "c1", text: "Win [PRIZE]", status: "PENDING_APPROVAL", contest: {}, contentId: null, updatedAt: NOW });
    // 00:30 on 13 October in Kigali is still 12 October in UTC: the 12th is already past for the business.
    const kigaliMorning = new Date("2026-10-12T22:30:00Z");
    await expect(confirmContest(owner, "c1", { prize: "x", endsOn: "2026-10-12", howChosen: "y", willPay: true }, kigaliMorning)).rejects.toThrow(/has passed/);
    await expect(confirmContest(owner, "c1", { prize: "x", endsOn: "2027-02-01", howChosen: "y", willPay: true }, NOW)).rejects.toThrow(/within 90 days/);
    expect(prisma.post.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a post that is not a contest, or that changed meanwhile", async () => {
    prisma.post.findFirst.mockResolvedValue({ id: "p", text: "Hi", status: "PENDING_APPROVAL", contest: null, updatedAt: NOW });
    await expect(confirmContest(owner, "p", { prize: "x", endsOn: "2026-10-16", howChosen: "y", willPay: true })).rejects.toThrow(/could not find/);
    prisma.post.findFirst.mockResolvedValue({ id: "c1", text: "Win [PRIZE]", status: "PENDING_APPROVAL", contest: {}, contentId: null, updatedAt: NOW });
    prisma.post.updateMany.mockResolvedValue({ count: 0 });
    await expect(confirmContest(owner, "c1", { prize: "x", endsOn: "2026-10-16", howChosen: "y", willPay: true })).rejects.toThrow(/changed meanwhile/);
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

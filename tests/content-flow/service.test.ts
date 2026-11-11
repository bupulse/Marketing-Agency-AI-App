import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  business: { findUnique: vi.fn(), updateMany: vi.fn() },
  productPhoto: { findMany: vi.fn() },
  campaignPhoto: { findMany: vi.fn() },
  campaignProduct: { findFirst: vi.fn() },
  mediaAsset: { findMany: vi.fn() },
  contentVisual: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  post: { findMany: vi.fn(), create: vi.fn(), groupBy: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  generatedContent: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  connection: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
const usage = vi.hoisted(() => {
  class UsageLimitError extends Error {}
  return { consumeUsage: vi.fn(), refundUsage: vi.fn(), getUsageSummary: vi.fn(), UsageLimitError };
});
const visuals = vi.hoisted(() => ({ aiExhaustedNote: (at: string | null) => `AI images for this month used (${at}).`, aiPhotosAvailable: vi.fn(), videoAvailable: vi.fn(), planVisuals: vi.fn(), updateImageVisual: vi.fn(async () => ({ status: "pending" })), audienceFor: vi.fn(async () => undefined), directionContext: (x: unknown) => x }));
const pack = vi.hoisted(() => ({ angleFacts: vi.fn(), recentAngles: vi.fn(), aiImagesLeft: vi.fn() }));
const director = vi.hoisted(() => ({ directVisual: vi.fn(async (ctx: { aiAllowed: boolean; price?: string | null; caption?: string }) => ({ plan: "directed", ai: ctx.aiAllowed })) }));
const ai = vi.hoisted(() => ({ generate: vi.fn() }));
const auto = vi.hoisted(() => ({ autoSchedule: vi.fn() }));
// The format draws (lib/content-flow/format.ts): 0.99 keeps feed apps on pictures; a test lowers it for videos.
const draw = vi.hoisted(() => ({ value: 0.99 }));
vi.mock("@/lib/autopilot/learning", () => ({ seededRandom: () => () => draw.value }));
// The day's shared sets are drawn on the server after the answer (lib/content-flow/set-worker.ts): mocked here.
const worker = vi.hoisted(() => ({ startSets: vi.fn(async () => undefined) }));
vi.mock("@/lib/content-flow/set-worker", () => worker);
const reel = vi.hoisted(() => ({ createSetReel: vi.fn(async () => "reel-1") }));
vi.mock("@/lib/content-flow/set-reel", () => reel);

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

/** The pack writer's answer: one post per line of the prompt's list, and two pictures and a reel per shared set. */
function packAnswer(prompt: string, drop: number[] = [], images = [{ headline: "Greens at school", idea: "Pupils holding lettuce by the tower" }, { headline: "40 plants, one tower", idea: "The tower in a classroom corner" }]) {
  const count = (prompt.match(/^\d+\. Angle "/gm) ?? []).length;
  const posts = Array.from({ length: count }, (_, i) => ({ index: i + 1, caption: `Post ${i + 1}: fresh greens at school.`, hashtags: ["#green", "#school"], videoScript: "0-3s: hook", adHeadlines: ["Grow at school", "Greens for every class", "Lettuce by Friday"] })).filter((p) => !drop.includes(p.index));
  const setCount = (prompt.match(/^Set \d+ \(posts /gm) ?? []).length;
  const sets = Array.from({ length: setCount }, (_, i) => ({ set: i + 1, images, reel: { scenes: [{ onScreen: "Greens at school", voice: "Imagine fresh greens grown right in class." }, { onScreen: "40 plants, one tower", voice: "One tower grows forty plants." }, { onScreen: "Ask us today", voice: "Ask us about it today." }], cta: "Message us" } }));
  return { text: JSON.stringify({ posts, sets }), provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } };
}
/** The shared sets' picture visuals the run saved. */
const savedSets = () => prisma.contentVisual.create.mock.calls.map((c) => c[0].data);

beforeEach(() => {
  vi.clearAllMocks();
  prisma.business.findUnique.mockResolvedValue({ id: "b1", name: "Green Kigali", timezone: "Africa/Kigali", contentLanguage: "English", industry: null, industryRef: null, description: null, audience: null, tone: "friendly", website: null, knowledge: null, profile: null, marketingProfile: null, brandColors: [] });
  prisma.business.updateMany.mockResolvedValue({ count: 1 });
  prisma.post.groupBy.mockResolvedValue([]);
  prisma.productPhoto.findMany.mockResolvedValue(album);
  prisma.mediaAsset.findMany.mockResolvedValue([]);
  prisma.contentVisual.findMany.mockResolvedValue([]);
  prisma.contentVisual.create.mockImplementation(async ({ data }: { data: unknown }) => ({ id: "set-visual", ...(data as object) }));
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
  usage.getUsageSummary.mockResolvedValue({ used: { text: 2, image: 0, videos: 0, voiceCharacters: 0 }, limits: { text: 30, image: 10, videos: 120, voiceCharacters: 20000, postsPerAppPerDay: 3 }, videosToday: 0, videosPerDay: 4 });
  visuals.aiPhotosAvailable.mockResolvedValue(true);
  visuals.videoAvailable.mockResolvedValue(true);
  visuals.planVisuals.mockResolvedValue({ image: "v1", video: null });
  ai.generate.mockImplementation(async ({ prompt }: { prompt: string }) => packAnswer(prompt));
  auto.autoSchedule.mockResolvedValue({ scheduled: 0, waiting: 3 });
  draw.value = 0.99;
});

describe("languages (Posts -> Settings, Languages)", () => {
  const rwanda = (languages: unknown) => ({ id: "b1", name: "Green Kigali", timezone: "Africa/Kigali", contentLanguage: "English", country: "Rwanda", dailyPostSettings: languages ? { languages } : null, industry: null, industryRef: null, description: null, audience: null, tone: "friendly", website: null, knowledge: null, profile: null, marketingProfile: null, brandColors: [] });
  const keepLanguage = () => {
    let n = 0;
    prisma.generatedContent.create.mockImplementation(async ({ data }: { data: { caption: string; adHeadlines: string[]; videoScript: string; language: string } }) => ({ id: `content-${++n}`, caption: data.caption, adHeadlines: data.adHeadlines, videoScript: data.videoScript, language: data.language }));
  };

  it("a business in Rwanda that never chose writes in Kinyarwanda", async () => {
    prisma.business.findUnique.mockResolvedValue(rwanda(null));
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook", "linkedin"] }, NOW);
    expect(ai.generate.mock.calls[0][0].prompt).toContain("Write all content in Kinyarwanda.");
    expect(prisma.generatedContent.create.mock.calls.map((c) => c[0].data.language)).toEqual(["Kinyarwanda", "Kinyarwanda"]);
  });

  it("a mix gives each post one language, named on its line; videos follow their own choice down to the video plan", async () => {
    prisma.productPhoto.findMany.mockResolvedValue([album[0]]);
    prisma.business.findUnique.mockResolvedValue(rwanda({ images: { mode: "mix", languages: ["English", "Kinyarwanda"] }, videos: { mode: "one", language: "Kinyarwanda" } }));
    keepLanguage();
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook", "linkedin", "tiktok"] }, NOW);
    const prompt = ai.generate.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("never two languages in one post");
    const contents = prisma.generatedContent.create.mock.calls.map((c) => c[0].data);
    const byNetwork = Object.fromEntries(contents.map((c) => [c.network, c.language]));
    expect(byNetwork.tiktok).toBe("Kinyarwanda");
    expect(new Set([byNetwork.facebook, byNetwork.linkedin])).toEqual(new Set(["English", "Kinyarwanda"]));
    for (const c of contents) expect(prompt).toContain(`only in ${c.language}.`);
    // The day's reel (made from the set's pictures) speaks the videos' language.
    expect(savedSets()[0].plan.daySet.reel).toMatchObject({ kind: "slideshow", language: "Kinyarwanda" });
  });

  it("the owner's brief asking for a language picks it from the mix", async () => {
    prisma.business.findUnique.mockResolvedValue(rwanda({ images: { mode: "mix", languages: ["English", "Kinyarwanda"] } }));
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "describe", brief: "Our weekend offer, in English please", design: "free", networks: ["facebook", "linkedin"] }, NOW);
    expect(prisma.generatedContent.create.mock.calls.map((c) => c[0].data.language)).toEqual(["English", "English"]);
    expect(ai.generate.mock.calls[0][0].prompt).toContain("Write all content in English.");
  });
});

describe("AI makes it for me (a content pack for the day)", () => {
  it("writes every app's caption in one call, one idea and ONE shared set for the day, Instagram and TikTok a reel", async () => {
    // A pictures day (the draw is over the video-day share): the reel is a slideshow made from the day's pictures.
    draw.value = 0.5;
    const result = await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "ai", networks: ["instagram", "tiktok", "facebook"] }, NOW);
    expect(result).toMatchObject({ day: "2026-10-13", posts: 3, failed: [], skipped: [] });
    expect(usage.consumeUsage).toHaveBeenCalledWith("u1", "text", 3);
    expect(usage.refundUsage).not.toHaveBeenCalled();
    expect(ai.generate).toHaveBeenCalledTimes(1);

    // One idea for the day's set, rotated: the subject's last angles (features, price) do not come back first.
    expect(new Set(result.angles).size).toBe(1);
    expect(result.angles).not.toContain("features");
    expect(result.angles).not.toContain("price");
    expect(result.sets).toEqual([{ groupId: result.packId, format: "images", videoKind: "slideshow", videoReason: expect.any(String), reel: true, drawing: true }]);

    const prompt = ai.generate.mock.calls[0][0].prompt as string;
    expect(prompt).not.toContain("Tower demo");
    expect(prompt).toContain("Never mention file names");
    expect(prompt).toContain("<<<RECENT POSTS\n- Yesterday's post about the tower.");
    expect(prompt).toContain("These posts are for 2026-10-13.");
    expect(prompt).toMatch(/Opening: .* Structure: /);
    // The writer plans the set in the same call: 1 to 4 pictures chosen by the idea, and the reel with its voice-over.
    expect(prompt).toContain("Set 1 (posts 1, 2, 3): 1 to 4 pictures");
    expect(prompt).toContain("the voice-over line spoken over it");

    const contents = prisma.generatedContent.create.mock.calls.map((c) => c[0].data);
    expect(contents.map((c) => c.network).sort()).toEqual(["facebook", "instagram", "tiktok"]);
    expect(contents[0]).toMatchObject({ businessId: "b1", productId: "p1", mode: "ai", packId: result.packId, forDate: new Date("2026-10-13T00:00:00Z") });

    const posts = prisma.post.create.mock.calls.map((c) => c[0].data);
    expect(posts.find((p) => p.network === "instagram")).toMatchObject({ format: "SCRIPT", mediaPaths: [], connectionId: "c-ig", status: "PENDING_APPROVAL", source: "STUDIO" });
    expect(posts.find((p) => p.network === "instagram")!.text).toMatch(/^Post \d: fresh greens/);
    expect(posts.find((p) => p.network === "tiktok")).toMatchObject({ format: "SCRIPT", mediaPaths: [], remindOnly: true, connectionId: null });
    expect(posts.find((p) => p.network === "facebook")).toMatchObject({ format: "POST", mediaPaths: [] });
    expect(new Set(posts.map((p) => p.groupId))).toEqual(new Set([result.packId]));

    // One picture visual for the whole day (no art director call per post), AI pictures paid now, drawn on the server.
    expect(director.directVisual).not.toHaveBeenCalled();
    expect(visuals.planVisuals).not.toHaveBeenCalled();
    const [set] = savedSets();
    expect(savedSets()).toHaveLength(1);
    expect(set).toMatchObject({ businessId: "b1", groupId: result.packId, kind: "carousel", status: "pending" });
    expect(set.plan.slides.map((x: { source: string; photoPath: string; scene: string }) => [x.source, x.photoPath, x.scene])).toEqual([
      ["ai", "u1/gallery/p1.jpg", "Pupils holding lettuce by the tower"],
      ["ai", "u1/gallery/p1.jpg", "The tower in a classroom corner"],
    ]);
    expect(set.plan.daySet).toMatchObject({ groupId: result.packId, maxAi: 2, reel: { kind: "slideshow", scenes: [{ onScreen: "Greens at school", voice: "Imagine fresh greens grown right in class." }, expect.anything(), expect.anything()], cta: "Message us" } });
    expect(usage.consumeUsage).toHaveBeenCalledWith("u1", "image", 2);
    expect(worker.startSets).toHaveBeenCalledWith("b1", [result.packId], NOW);
    expect(auto.autoSchedule).toHaveBeenCalledWith("b1", ["post-0", "post-1", "post-2"], NOW);
  });

  it("a video day: Facebook gets two posts (the reel and the pictures), LinkedIn and X the pictures", async () => {
    prisma.productPhoto.findMany.mockResolvedValue([album[0]]);
    draw.value = 0.1;
    const result = await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["instagram", "facebook", "linkedin", "twitter"] }, NOW);
    expect(result.sets[0]).toMatchObject({ format: "video", videoKind: "slideshow", reel: true });
    const posts = prisma.post.create.mock.calls.map((c) => c[0].data);
    expect(posts.map((p) => [p.network, p.format])).toEqual([["instagram", "SCRIPT"], ["facebook", "POST"], ["facebook", "SCRIPT"], ["linkedin", "POST"], ["twitter", "POST"]]);
    // The companion reel post is charged and written like every post.
    expect(usage.consumeUsage).toHaveBeenCalledWith("u1", "text", 5);
    expect(ai.generate.mock.calls[0][0].prompt).toContain("It is the set's reel posted as a video");
  });

  it("a video day with the owner's own new video in the Gallery: the studio uses it as the reel, free", async () => {
    draw.value = 0.1;
    const result = await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["instagram", "facebook"] }, NOW);
    expect(result.sets[0]).toMatchObject({ format: "video", videoKind: "album", reel: true });
    const posts = prisma.post.create.mock.calls.map((c) => c[0].data);
    expect(posts.find((p) => p.network === "instagram")).toMatchObject({ format: "POST", mediaPaths: ["u1/gallery/v1.mp4"] });
    expect(posts.filter((p) => p.network === "facebook").map((p) => p.mediaPaths)).toEqual([[], ["u1/gallery/v1.mp4"]]);
    expect(savedSets()[0].plan.daySet.reel).toBeNull();
  });

  it("every post comes with its 30-second video script and exactly three ad headlines, picture posts too", async () => {
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook", "linkedin"] }, NOW);
    const prompt = ai.generate.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("adHeadlines: exactly 3 different ad headlines");
    expect(prompt).toContain("Every post's videoScript:");
    const contents = prisma.generatedContent.create.mock.calls.map((c) => c[0].data);
    expect(contents).toHaveLength(2);
    for (const c of contents) {
      expect(c.format).toBe("image");
      expect(c.videoScript).toBe("hook");
      expect(c.adHeadlines).toEqual(["Grow at school", "Greens for every class", "Lettuce by Friday"]);
    }
    // A picture post's script is not its text: the post keeps its caption.
    expect(prisma.post.create.mock.calls.every((c) => /^Post \d: fresh greens/.test(c[0].data.text))).toBe(true);
  });

  it("uses the owner's photos as they are with Free templates (no AI picture)", async () => {
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook", "linkedin"] }, NOW);
    expect(director.directVisual).not.toHaveBeenCalled();
    expect(pack.aiImagesLeft).not.toHaveBeenCalled();
    expect(savedSets()[0].plan.slides.map((x: { source: string }) => x.source)).toEqual(["album"]);
    expect(ai.generate.mock.calls[0][0].prompt).toContain("Set 1 (posts 1, 2): exactly 1 picture");
  });

  it("gives AI pictures only while the plan's images last, and says when they are used up", async () => {
    pack.aiImagesLeft.mockResolvedValue({ count: 1, exhausted: null });
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "ai", networks: ["facebook", "linkedin"] }, NOW);
    expect(savedSets()[0].plan.slides.map((x: { source: string }) => x.source)).toEqual(["ai", "album"]);
    prisma.contentVisual.create.mockClear();
    pack.aiImagesLeft.mockResolvedValue({ count: 0, exhausted: { refillAt: "2026-11-01" } });
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "ai", networks: ["facebook", "linkedin"] }, NOW);
    expect(savedSets()[0].plan).toMatchObject({ aiExhausted: { refillAt: "2026-11-01" }, slides: [{ source: "album" }] });
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
    expect(ai.generate.mock.calls[0][0].prompt).not.toContain("Our shop front");
  });
});

describe("picture or video, decided per post", () => {
  const photosOnly = [{ asset: { path: "u1/gallery/p1.jpg", name: "Tower in a classroom.jpg", mimeType: "image/jpeg" } }];

  it("saves each post's format and makes Instagram a Reel BuPulse renders from the day's pictures, keeping its caption", async () => {
    prisma.productPhoto.findMany.mockResolvedValue(photosOnly);
    draw.value = 0.5;
    const result = await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["instagram", "facebook"] }, NOW);
    expect(result).toMatchObject({ videos: 1, notes: [] });
    const contents = prisma.generatedContent.create.mock.calls.map((c) => c[0].data);
    expect(Object.fromEntries(contents.map((c) => [c.network, c.format]))).toEqual({ instagram: "video", facebook: "image" });
    const prompt = ai.generate.mock.calls[0][0].prompt as string;
    expect(prompt).toMatch(/Format: a video post \(write the videoScript\)/);
    const ig = prisma.post.create.mock.calls.map((c) => c[0].data).find((p) => p.network === "instagram")!;
    expect(ig).toMatchObject({ format: "SCRIPT", mediaPaths: [] });
    expect(ig.text).toMatch(/^Post \d: fresh greens/);
    expect(savedSets()[0].plan.daySet.reel).toMatchObject({ kind: "slideshow" });
  });

  it("with no videos left, TikTok gets the script to film and the run says why", async () => {
    prisma.productPhoto.findMany.mockResolvedValue(photosOnly);
    usage.getUsageSummary.mockResolvedValue({ used: { text: 2, image: 0, videos: 120, voiceCharacters: 0 }, limits: { text: 30, image: 10, videos: 120, voiceCharacters: 20000, postsPerAppPerDay: 3 }, videosToday: 0, videosPerDay: 4 });
    const result = await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["tiktok"], format: "video" }, NOW);
    expect(result.notes).toEqual(["TikTok gets a video script to film yourself instead of a reel today: your plan's videos are used up for now."]);
    expect(result.videos).toBe(0);
    const tiktok = prisma.post.create.mock.calls[0][0].data;
    expect(tiktok).toMatchObject({ format: "SCRIPT", mediaPaths: [] });
    expect(tiktok.text).toBe("hook");
    // Nothing to draw: no post shows the pictures and no reel is made from them.
    expect(prisma.contentVisual.create).not.toHaveBeenCalled();
    expect(worker.startSets).not.toHaveBeenCalled();
  });

  it("writes the script of a TikTok reminder the pack writer left without one (one more text generation)", async () => {
    prisma.productPhoto.findMany.mockResolvedValue(photosOnly);
    usage.getUsageSummary.mockResolvedValue({ used: { text: 2, image: 0, videos: 120, voiceCharacters: 0 }, limits: { text: 30, image: 10, videos: 120, voiceCharacters: 20000, postsPerAppPerDay: 3 }, videosToday: 0, videosPerDay: 4 });
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
    expect(prisma.post.create.mock.calls[0][0].data.text).toContain("Grow greens at school.");
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
  it("pays the set's AI pictures when the run starts and marks the slides as paid", async () => {
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "ai", networks: ["facebook", "linkedin"] }, NOW);
    expect(usage.consumeUsage).toHaveBeenCalledWith("u1", "image", 2);
    const slides = savedSets()[0].plan.slides;
    expect(slides.map((x: { source: string; prepaidAi?: string }) => [x.source, x.prepaidAi])).toEqual([
      ["ai", "2026-10-01T00:00:00.000Z"],
      ["ai", "2026-10-01T00:00:00.000Z"],
    ]);
    expect(savedSets()[0].plan.daySet.maxAi).toBe(2);
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
    // One idea per round of posts (each its own shared set): LinkedIn's second post is a second set.
    expect(new Set(result.angles).size).toBe(2);
    expect(result.sets).toHaveLength(2);
    expect(new Set(prisma.post.create.mock.calls.map((c) => c[0].data.groupId)).size).toBe(2);
    // Every post of the subject on the app for the day: by hand, Autopilot or here; going out, gone out, or made today without a time.
    const day = { gte: new Date("2026-10-12T22:00:00Z"), lt: new Date("2026-10-13T22:00:00Z") };
    expect(prisma.post.groupBy.mock.calls[0][0].where).toEqual({ businessId: "b1", productId: "p1", status: { not: "CANCELLED" }, OR: [{ scheduledAt: day }, { publishedAt: day }, { scheduledAt: null, publishedAt: null, createdAt: day }] });
  });

  it("skips an app that already has its posts for today", async () => {
    usage.getUsageSummary.mockResolvedValue({ used: { text: 0, image: 0, videos: 0, voiceCharacters: 0 }, limits: { text: 30, image: 10, videos: 0, voiceCharacters: 0 }, videosToday: 0, videosPerDay: 0 });
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

  it("AI decides with one price set: the shared prompt has no price; only its posts' lines carry it; the others are checked field by field", async () => {
    const { writingSubject } = await import("@/lib/knowledge/service");
    vi.mocked(writingSubject).mockResolvedValueOnce({ subject: { kind: "product", id: "p1" }, type: "product", title: "Hydro tower", context: "Name: Hydro tower\nPrice: 15,000 RWF\nFree installation in Kigali", price: "15,000 RWF", features: ["Grows 40 plants", "20% off this week"], photoPaths: [] } as never);
    pack.recentAngles.mockResolvedValue([]);
    ai.generate.mockImplementation(async ({ prompt }: { prompt: string }) => {
      const answer = packAnswer(prompt);
      const parsed = JSON.parse(answer.text);
      for (const p of parsed.posts) {
        p.caption = `Post ${p.index}: fresh greens at school. Now 10k only! Price on request for schools.`;
        p.videoScript = "0-3s: Only 15,000 RWF!\n3-6s: Grow at school.";
        p.adHeadlines = ["Only 15,000 RWF", "Grow at school", "Free delivery today"];
      }
      return { ...answer, text: JSON.stringify(parsed) };
    });
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["instagram", "facebook", "tiktok", "linkedin"], price: "auto" }, NOW);
    const prompt = ai.generate.mock.calls[0][0].prompt as string;
    // The posts of a set share their pictures, so they share the price rule: all of them, or none.
    expect([0, 4]).toContain(prompt.match(/State the price exactly as given: 15,000 RWF\./g)?.length ?? 0);
    const shared = prompt.split("Write 4 posts")[0];
    expect(shared).not.toMatch(/15,000|20% off|Free installation/);
    const contents = prisma.generatedContent.create.mock.calls.map((c) => c[0].data);
    const unpriced = contents.filter((c) => c.angle !== "price");
    for (const c of unpriced) {
      expect(c.caption).toMatch(/^Post \d: fresh greens at school\.$/);
      expect(c.videoScript).not.toMatch(/15,000/);
      expect(c.adHeadlines).toEqual(["Grow at school"]);
    }
  });

  it("a contest's picture never shows the placeholders", async () => {
    const business = await prisma.business.findUnique();
    prisma.business.findUnique.mockResolvedValue({ ...business, marketingProfile: { voice: "Fun", do: ["Be playful"], dont: ["Be stiff"], samples: ["Hi!"], answers: [{ topic: "tone", answer: "Fun and playful" }], approvedAt: "2026-10-01" } });
    pack.recentAngles.mockResolvedValue(["features", "price", "story", "tips", "how-it-works", "news", "faq", "behind-scenes", "cta", "tip-of-day", "did-you-know", "poll", "playful", "myth-fact", "trivia", "meme"]);
    ai.generate.mockImplementation(async ({ prompt }: { prompt: string }) => packAnswer(prompt, [], [{ headline: "Win [PRIZE]!", idea: "A prize box: ends [END DATE]" }]));
    await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook"] }, NOW);
    expect(prisma.generatedContent.create.mock.calls[0][0].data.angle).toBe("challenge");
    const slide = savedSets()[0].plan.slides[0];
    expect(slide).toMatchObject({ headline: "Win!", chip: "" });
    expect(slide.scene).not.toMatch(/\[/);
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
    await expect(confirmContest(owner, "p", { prize: "x", endsOn: "2026-10-16", howChosen: "y", willPay: true }, NOW)).rejects.toThrow(/could not find/);
    prisma.post.findFirst.mockResolvedValue({ id: "c1", text: "Win [PRIZE]", status: "PENDING_APPROVAL", contest: {}, contentId: null, updatedAt: NOW });
    prisma.post.updateMany.mockResolvedValue({ count: 0 });
    await expect(confirmContest(owner, "c1", { prize: "x", endsOn: "2026-10-16", howChosen: "y", willPay: true }, NOW)).rejects.toThrow(/changed meanwhile/);
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

describe("a daily posts run (lib/daily-posts)", () => {
  const daily = { maxPosts: 2, room: { instagram: 1, facebook: 2 }, maxAiImages: 1, maxVideos: 0, avoidAngles: ["tips", "how-it-works"] };

  it("stays within the day's posts, apps' room, AI photos and videos, leaves out yesterday's ideas, and marks its posts DAILY", async () => {
    const result = await runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "ai", networks: ["instagram", "facebook"], perApp: 2, daily }, NOW);
    expect(result.posts).toBe(2);
    expect(usage.consumeUsage).toHaveBeenCalledWith("u1", "text", 2);
    expect(result.angles).not.toContain("tips");
    expect(result.angles).not.toContain("how-it-works");
    const posts = prisma.post.create.mock.calls.map((c) => c[0].data);
    expect(posts.map((p) => p.network).sort()).toEqual(["facebook", "instagram"]);
    expect(posts.every((p) => p.source === "DAILY" && p.status === "PENDING_APPROVAL")).toBe(true);
    // No reel today (none in today's share): Instagram gets the pictures; and one AI picture at most.
    expect(posts.find((p) => p.network === "instagram")).toMatchObject({ format: "POST", mediaPaths: [] });
    expect(result.notes).toContain("Instagram gets the pictures instead of a reel today: your plan's videos are used up for now.");
    expect(savedSets()[0].plan.slides.filter((x: { source: string }) => x.source === "ai")).toHaveLength(1);
  });
});

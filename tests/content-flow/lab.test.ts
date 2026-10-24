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
const lab = vi.hoisted(() => ({ labFor: vi.fn(), labLanguage: vi.fn() }));
vi.mock("@/lib/training-lab/reader", () => ({ labFor: lab.labFor }));
vi.mock("@/lib/training-lab/language-reader", () => ({ labLanguage: lab.labLanguage }));
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

/** The pack writer's answer: one post per line of the prompt's list. */
function packAnswer(prompt: string, drop: number[] = []) {
  const count = (prompt.match(/^\d+\. Angle "/gm) ?? []).length;
  const posts = Array.from({ length: count }, (_, i) => ({ index: i + 1, caption: `Post ${i + 1}: fresh greens at school.`, hashtags: ["#green", "#school"], videoScript: "0-3s: hook", adHeadlines: ["Grow at school", "Greens for every class", "Lettuce by Friday"] })).filter((p) => !drop.includes(p.index));
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
  usage.getUsageSummary.mockResolvedValue({ used: { text: 2, image: 0, videos: 0, voiceCharacters: 0 }, limits: { text: 30, image: 10, videos: 120, voiceCharacters: 20000, postsPerAppPerDay: 3 }, videosToday: 0, videosPerDay: 4 });
  visuals.aiPhotosAvailable.mockResolvedValue(true);
  visuals.videoAvailable.mockResolvedValue(true);
  visuals.planVisuals.mockResolvedValue({ image: "v1", video: null });
  ai.generate.mockImplementation(async ({ prompt }: { prompt: string }) => packAnswer(prompt));
  auto.autoSchedule.mockResolvedValue({ scheduled: 0, waiting: 3 });
  draw.value = 0.99;
});

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
  usage.getUsageSummary.mockResolvedValue({ used: { text: 2, image: 0, videos: 0, voiceCharacters: 0 }, limits: { text: 30, image: 10, videos: 120, voiceCharacters: 20000, postsPerAppPerDay: 3 }, videosToday: 0, videosPerDay: 4 });
  visuals.aiPhotosAvailable.mockResolvedValue(true);
  visuals.videoAvailable.mockResolvedValue(true);
  visuals.planVisuals.mockResolvedValue({ image: "v1", video: null });
  ai.generate.mockImplementation(async ({ prompt }: { prompt: string }) => packAnswer(prompt));
  auto.autoSchedule.mockResolvedValue({ scheduled: 0, waiting: 3 });
  draw.value = 0.99;
  lab.labFor.mockResolvedValue({ examples: [], avoid: [], phrases: [], exampleIds: [] });
  lab.labLanguage.mockResolvedValue({});
});


const run = () => runDayContent(owner, { scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["facebook", "linkedin"] }, NOW);

describe("daily posts learn from the Training Lab", () => {
  it("reads the Lab once per run, for the post engine and the business's language", async () => {
    await run();
    expect(lab.labFor).toHaveBeenCalledTimes(1);
    expect(lab.labFor).toHaveBeenCalledWith(expect.objectContaining({ engine: "post", kinds: ["image", "voice"], language: "English" }));
    expect(lab.labLanguage).toHaveBeenCalledTimes(1);
    expect(lab.labLanguage).toHaveBeenCalledWith("English");
  });

  it("gives the same prompt with an empty Lab, and when the Lab only has spellings to fix", async () => {
    await run();
    const prompt = ai.generate.mock.calls[0][0].prompt as string;
    expect(prompt).not.toMatch(/THE OWNER'S EXAMPLES|NEVER \(the owner's notes\)/);
    vi.clearAllMocks();
    lab.labFor.mockResolvedValue({ examples: [], avoid: [], phrases: [], exampleIds: [] });
    lab.labLanguage.mockResolvedValue({ wrong: [{ word: "greens", fix: "green leaves" }], words: ["x"] });
    prisma.post.create.mockImplementation(({ data }: { data: unknown }) => data);
    ai.generate.mockImplementation(async ({ prompt: p }: { prompt: string }) => packAnswer(p));
    await run();
    expect(ai.generate.mock.calls[0]?.[0].prompt).toBe(prompt);
  });

  it("prints the examples, the never notes and the other-businesses line as one block, not in the facts", async () => {
    lab.labFor.mockResolvedValue({ examples: ['Image "Price first": made like this: a big price. Good because: it is clear.'], avoid: ['Never (from "A"): stock smiles.'], phrases: [], exampleIds: ["e1"] });
    await run();
    const prompt = ai.generate.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("THE OWNER'S EXAMPLES (follow their style, never copy their words or numbers):\nThese are other businesses' examples: never use their names, products, prices or contact details.\n- Image \"Price first\"");
    expect(prompt).toContain("NEVER (the owner's notes):\n- Never (from \"A\"): stock smiles.");
    expect(prompt.indexOf("THE OWNER'S EXAMPLES")).toBeGreaterThan(prompt.indexOf("These posts are for"));
  });

  it("fixes the owner's marked spellings in the written captions, scripts and headlines, at no cost", async () => {
    lab.labLanguage.mockResolvedValue({ wrong: [{ word: "greens", fix: "green leaves" }, { word: "hook" }] });
    await run();
    const contents = prisma.generatedContent.create.mock.calls.map((c) => c[0].data);
    expect(contents).toHaveLength(2);
    for (const c of contents) {
      expect(c.caption).toMatch(/^Post \d: fresh green leaves at school\./);
      expect(c.adHeadlines).toContain("Green leaves for every class");
    }
    expect(ai.generate).toHaveBeenCalledTimes(1);
    expect(usage.consumeUsage).toHaveBeenCalledWith("u1", "text", 2);
  });

  it("is not stopped by a Lab that cannot be read", async () => {
    lab.labFor.mockResolvedValue({ examples: [], avoid: [], phrases: [], exampleIds: [] });
    lab.labLanguage.mockResolvedValue({});
    const result = await run();
    expect(result.posts).toBe(2);
  });
});

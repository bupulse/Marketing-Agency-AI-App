import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  labViral: { value: { rows: [] as unknown[], avoidIds: [] as string[], avoidHooks: [] as string[] } },
  languageExtra: { value: {} as Record<string, unknown> },
  labViralRows: vi.fn(),
  labLanguage: vi.fn(),
  recipeOpts: [] as Record<string, unknown>[],
  designOpts: [] as Record<string, unknown>[],
  designBriefs: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    videoJob: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: "j1" })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })),
    },
    $transaction: async (list: Promise<unknown>[]) => Promise.all(list),
  },
}));
vi.mock("@/lib/admin/switch", () => ({ assertServiceEnabled: vi.fn(async () => {}), ServiceDisabledError: class extends Error {} }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: vi.fn() }));
vi.mock("@/lib/usage", () => ({ consumeUsage: vi.fn(async () => ({ periodStart: new Date("2026-10-13T00:00:00Z") })), refundUsage: vi.fn(async () => {}) }));
vi.mock("@/lib/video-studio/brief", () => ({
  BriefError: class extends Error {},
  loadBriefFacts: async () => ({ business: { name: "LEAF Rwanda", description: "Hydroponic farming kits", language: "Kinyarwanda", country: "Rwanda" }, product: { name: "LEAF Hydro Tower", summary: "A vertical tower", price: "250,000 RWF", usps: [] }, productId: "p1" }),
  choosePhotos: async () => [],
  readPhotos: async () => [],
}));
vi.mock("@/lib/video-studio/job-view", async (orig) => ({ ...(await orig<typeof import("@/lib/video-studio/job-view")>()), view: (row: unknown) => row }));
vi.mock("@/lib/training-lab/reader", () => ({ labViralRows: h.labViralRows }));
vi.mock("@/lib/training-lab/language-reader", () => ({ labLanguage: h.labLanguage }));
vi.mock("@/lib/video-engine/designer", async (orig) => {
  const real = await orig<typeof import("@/lib/video-engine/designer")>();
  return {
    ...real,
    recipeForBrief: (brief: Parameters<typeof real.recipeForBrief>[0], opts: Parameters<typeof real.recipeForBrief>[1]) => {
      h.recipeOpts.push(opts as Record<string, unknown>);
      return real.recipeForBrief(brief, opts);
    },
    designVideo: async (brief: Record<string, unknown>, opts: Record<string, unknown>) => {
      h.designBriefs.push(brief);
      h.designOpts.push(opts);
      return { spec: { caption: "Reba!", hashtags: ["#LEAF"], scenes: [{ seconds: 10 }] }, warnings: [], score: null, apiEquivalentUsd: 0 };
    },
  };
});

const { designMotionJobs } = await import("@/lib/video-studio/jobs");
const { VIRAL, viralRecipe } = await import("@/lib/video-engine/brain/viral");

const owner = { userId: "u1", actorId: "u1", businessId: "b1" };
const request = (over: Record<string, unknown> = {}) => ({ productId: "p1", templateId: "viral", hookId: "auto", ratio: "9:16" as const, seconds: 15, mode: "text" as const, versions: 2, ...over });
const deps = { env: { ANTHROPIC_API_KEY: "k" }, transport: vi.fn(), model: "m" };
const labRow = { ...VIRAL[0], id: "lab:good", group: "lab:good", strength: 0.5 };

beforeEach(() => {
  h.recipeOpts.length = 0;
  h.designOpts.length = 0;
  h.designBriefs.length = 0;
  h.labViral.value = { rows: [], avoidIds: [], avoidHooks: [] };
  h.languageExtra.value = {};
  h.labViralRows.mockReset().mockImplementation(async () => h.labViral.value);
  h.labLanguage.mockReset().mockImplementation(async () => h.languageExtra.value);
});

describe("Video Studio design jobs read the Training Lab", () => {
  it("reads the Lab once and gives every version's recipe its reels and never-copy list", async () => {
    h.labViral.value = { rows: [labRow], avoidIds: ["lab:bad"], avoidHooks: ["direct-question"] };
    await designMotionJobs(owner, request(), deps);
    expect(h.labViralRows).toHaveBeenCalledTimes(1);
    expect(h.recipeOpts).toHaveLength(2);
    for (const opts of h.recipeOpts) expect(opts).toMatchObject({ lab: [labRow], avoid: ["lab:bad", "direct-question"] });
  });

  it("asks for the recipes exactly as before with an empty Lab", async () => {
    await designMotionJobs(owner, request(), deps);
    for (const opts of h.recipeOpts) {
      expect(opts).not.toHaveProperty("lab");
      expect(opts).not.toHaveProperty("avoid");
    }
  });

  it("leaves the AI clip recipe of version 1 as it was", async () => {
    h.labViral.value = { rows: [labRow], avoidIds: [], avoidHooks: [] };
    const aiClipRecipe = viralRecipe({ sector: "agriculture", product: "LEAF Hydro Tower", seconds: 15, hasPrice: true, hasPhone: true, seed: "ai-clips" });
    await designMotionJobs(owner, request({ aiClipRecipe }), deps);
    // Only version 2 asks for a recipe; version 1 keeps the one its AI clips were made for, as it was.
    expect(h.recipeOpts).toHaveLength(1);
    expect(h.designBriefs[0].recipe).toBe(aiClipRecipe);
  });

  it("does not read the Lab's reels for a template that is not viral", async () => {
    await designMotionJobs(owner, request({ templateId: "classic" }), deps);
    expect(h.labViralRows).not.toHaveBeenCalled();
  });

  it("reads the Lab's words for the business's language once, and gives them to every design", async () => {
    h.languageExtra.value = { words: ["murakaza neza"], wrong: [{ word: "murakaza nez", fix: "murakaza neza" }] };
    await designMotionJobs(owner, request(), deps);
    expect(h.labLanguage).toHaveBeenCalledTimes(1);
    expect(h.labLanguage).toHaveBeenCalledWith("Kinyarwanda");
    expect(h.designOpts).toHaveLength(2);
    for (const opts of h.designOpts) expect(opts.languageExtra).toEqual(h.languageExtra.value);
  });
});

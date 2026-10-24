import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  examples: [] as Record<string, unknown>[],
  findMany: vi.fn(),
  recipeInputs: [] as Record<string, unknown>[],
  jobs: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    trainingExample: { findMany: h.findMany },
    reelPresenter: { findUnique: vi.fn(async () => ({ path: "u1/designs/p.png", description: "a Black Rwandan woman" })), upsert: vi.fn() },
    reelJob: {
      aggregate: vi.fn(async () => ({ _sum: { costUsd: 0 } })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "job1", costUsd: 0, ...data };
        h.jobs.set("job1", row);
        return row;
      }),
      findMany: vi.fn(async () => []),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(h.jobs.get(where.id)!, data)),
    },
  },
}));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: async () => true }));
vi.mock("@/lib/ai", () => ({ getTextProvider: () => { throw new Error("no text provider in this test"); } }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: async (_c: unknown, _m: unknown, call: () => unknown) => call() }));
vi.mock("@/lib/designs/service", () => ({ createEngineDesign: vi.fn(), designUrls: async () => new Map(), DesignError: class DesignError extends Error {} }));
vi.mock("@/lib/image-engine/check", () => ({ checkPicture: vi.fn() }));
vi.mock("@/lib/image-engine/planner", () => ({ claudeJson: async () => null }));
vi.mock("@/lib/image-engine/engine", () => ({
  loadFacts: async () => ({ business: { audience: null }, facts: { name: "LEAF", industry: "Agriculture", description: "Hydroponic towers for farms", audience: null, place: "Kigali", language: "English", voice: null, colors: [] }, subject: { name: "LEAF Hydro Tower", description: null, price: null, sellingPoints: [] }, photos: [], reviews: [], hasPrice: false }),
}));
vi.mock("@/lib/music/service", () => ({ musicUrl: (p: string) => p, trackForVideo: async () => null }));
vi.mock("@/lib/storage", () => ({ createSignedUploadUrl: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/reel-engine/checker", () => ({ checkClip: vi.fn() }));
vi.mock("@/lib/video-engine/brain/viral", async (orig) => {
  const real = await orig<typeof import("@/lib/video-engine/brain/viral")>();
  return {
    ...real,
    viralRecipe: (input: Record<string, unknown>) => {
      h.recipeInputs.push(input);
      return real.viralRecipe(input as never);
    },
  };
});

const viral = await import("@/lib/video-engine/brain/viral");
const { labViralRows } = await import("@/lib/training-lab/reader");
const { startReel } = await import("@/lib/reel-engine/engine");
const { recipeForBrief } = await import("@/lib/video-engine/designer");
const { VIRAL_STYLE_ID } = await import("@/lib/video-engine/templates");
type RecipeInput = import("@/lib/video-engine/brain/viral").RecipeInput;
type ViralVideo = import("@/lib/video-engine/brain/viral").ViralVideo;

const example = (over: Record<string, unknown> = {}) => ({
  id: "good",
  kind: "reel",
  title: "Kigali car seller",
  howMade: "Phone clips cut on the beat.",
  whatIsGood: "The door slam in the first second.",
  neverThis: null,
  notes: null,
  tags: [],
  sector: "agriculture",
  language: "English",
  technique: [],
  rating: 5,
  consentGiven: false,
  engines: ["reel"],
  transcript: null,
  createdAt: new Date("2026-10-20T10:00:00Z"),
  ...over,
});

const input = (over: Partial<RecipeInput> = {}): RecipeInput => ({ sector: "agriculture", product: "Hydro Tower", platform: "instagram", country: "Rwanda", language: "English", purpose: "ad", seconds: 30, hasPrice: true, hasPhone: true, footage: { generated: true }, seed: "job-1", ...over });
const labRow = (i: number, over: Partial<ViralVideo> = {}): ViralVideo => ({ ...viral.VIRAL[0], id: `lab:s${i}`, group: `lab:s${i}`, sector: "agriculture", country: "RW", region: "east-africa", platform: "instagram", strength: 1, hookType: ["question", "pov", "reveal", "demo", "problem", "announcement"][i % 6], needs: ["filmed"], reach: "an example you rated 5 of 5 stars", ...over });
const strong = Array.from({ length: 6 }, (_, i) => labRow(i));

/** A recipe whose opening comes from a Lab reel (seeds tried in order). */
function labOpened(): ReturnType<typeof viral.viralRecipe> {
  for (let i = 0; i < 60; i++) {
    const r = viral.viralRecipe(input({ seed: `open-${i}`, lab: strong }));
    if (r.opening.source?.startsWith("lab:")) return r;
  }
  throw new Error("no Lab opening in 60 seeds");
}

beforeEach(() => {
  h.recipeInputs.length = 0;
  h.examples = [];
  h.findMany.mockReset().mockImplementation(async () => h.examples);
});

describe("the recipe credits the owner's Lab", () => {
  it("names a Lab reel as BuPulse's Training Lab (never 'your', clients read it), never as BuPulse's research", () => {
    const r = labOpened();
    const text = viral.recipeText(r);
    expect(text).toContain(`from ${r.opening.source}, BuPulse's Training Lab)`);
    expect(text).toMatch(/from (\d+ viral videos? BuPulse studied and )?\d+ (videos? )?from BuPulse's Training Lab \(ids in brackets\)/);
    expect(text).not.toContain("BuPulse's research");
    expect(viral.seedanceRecipeText(r, 10)).toContain("BuPulse's Training Lab");
    expect(viral.recipeWhy(r)[0]).toBe(`Opens like a reel from BuPulse's own example library: ${r.opening.idea}.`);
  });

  it("reads as before without a Lab", () => {
    const r = viral.viralRecipe(input());
    expect(r.sources.some((s) => s.id.startsWith("lab:"))).toBe(false);
    expect(viral.recipeText(r)).toContain(`techniques from ${r.sources.length} viral videos BuPulse studied (ids in brackets)`);
    expect(viral.recipeText(r)).not.toContain("Training Lab");
    expect(viral.recipeWhy(r).join(" ")).not.toContain("Training Lab");
  });
});

describe("labViralRows", () => {
  it("reads reel and video examples on the video or reel engine, as rows, and what never to copy", async () => {
    h.examples = [
      example({ tags: ["never:direct-question"] }),
      example({ id: "bad", rating: 1, technique: ["pov-local-find"], notes: { hook_type: "curiosity" } }),
      example({ id: "meh", rating: 2, notes: { never_hook: ["POV-local-find", "not-a-hook"] } }),
      example({ id: "unnamed", rating: 1 }),
      example({ id: "off", engines: ["image"], tags: ["never:result-first"] }),
    ];
    const out = await labViralRows();
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { kind: { in: ["reel", "video"] }, engines: { hasSome: ["video", "reel"] } } }));
    expect(out.rows.map((r) => r.id)).toEqual(["lab:good"]);
    expect(out.avoidIds).toEqual(["lab:bad", "lab:meh", "lab:unnamed"]);
    // Only what the owner says explicitly (never_hook, a never:<hook> tag), on any example; a low-rated reel's own
    // opening type ("curiosity", "pov-local-find" above) is never one.
    expect(out.avoidHooks).toEqual(["direct-question", "pov-local-find"]);
  });

  it("one low-rated curiosity reel penalises only itself, never the curated curiosity openings", async () => {
    h.examples = [example({ id: "bad", rating: 1, notes: { hook_type: "curiosity" }, technique: ["curiosity"] })];
    const out = await labViralRows();
    expect(out.avoidHooks).toEqual([]);
    const avoid = [...out.avoidIds, ...out.avoidHooks];
    const base = viral.scoreViral(input());
    const withAvoid = viral.scoreViral(input({ avoid }));
    const curious = base.filter((s) => s.v.hookType === "curiosity");
    expect(curious.length).toBeGreaterThan(0);
    expect(withAvoid.map((s) => [s.v.id, s.score])).toEqual(base.map((s) => [s.v.id, s.score]));
  });

  it("is empty on an empty Lab or an error", async () => {
    expect(await labViralRows()).toEqual({ rows: [], avoidIds: [], avoidHooks: [] });
    h.findMany.mockRejectedValueOnce(new Error("db down"));
    expect(await labViralRows()).toEqual({ rows: [], avoidIds: [], avoidHooks: [] });
  });
});

describe("startReel passes the Lab to the recipe", () => {
  beforeEach(() => {
    vi.stubEnv("REEL_ENGINE_BUSINESSES", "b1");
    vi.stubEnv("GEMINI_API_KEY", "g");
  });

  it("gives the recipe the Lab rows and the never-copy list", async () => {
    h.examples = [example(), example({ id: "bad", rating: 1, tags: ["never:pov-local-find"] })];
    await startReel({ userId: "u1", businessId: "b1" }, { language: "English", tier: "lite" });
    expect(h.recipeInputs).toHaveLength(1);
    expect((h.recipeInputs[0].lab as ViralVideo[]).map((r) => r.id)).toEqual(["lab:good"]);
    expect(h.recipeInputs[0].avoid).toEqual(["lab:bad", "pov-local-find"]);
  });

  it("asks for the recipe exactly as before with an empty Lab", async () => {
    await startReel({ userId: "u1", businessId: "b1" }, { language: "English", tier: "lite" });
    expect(h.recipeInputs[0]).not.toHaveProperty("lab");
    expect(h.recipeInputs[0]).not.toHaveProperty("avoid");
  });

  it("lets the Director lean towards the shots of the owner's best-rated reels, from the same Lab read", async () => {
    h.examples = [example({ technique: ["question hook"], notes: { shots: "a result shot of the harvest" } })];
    await startReel({ userId: "u1", businessId: "b1" }, { language: "English", tier: "lite" });
    const variants = ((h.jobs.get("job1")!.plan as { clips: { variant: string }[] }).clips ?? []).map((c) => c.variant);
    expect(variants[0]).toBe("hook:question");
    expect(variants).toContain("broll:result");
  });
});

describe("recipeForBrief passes the Lab through", () => {
  const brief = { business: { name: "LEAF Rwanda", description: "Hydroponic farming kits in Kigali", language: "English", phone: "0788 300 400", country: "Rwanda" }, product: { name: "LEAF Hydro Tower", summary: "A vertical tower", price: "250,000 RWF", usps: [] }, photos: [], styleId: VIRAL_STYLE_ID, hookId: "auto", ratio: "9:16", seconds: 15, platform: "instagram" } as unknown as Parameters<typeof recipeForBrief>[0];

  it("hands lab and avoid to viralRecipe, and nothing when none is given", () => {
    recipeForBrief(brief, { seed: "d1" });
    expect(h.recipeInputs[0]).not.toHaveProperty("lab");
    expect(h.recipeInputs[0]).not.toHaveProperty("avoid");
    recipeForBrief(brief, { seed: "d1", lab: strong, avoid: ["lab:bad"] });
    expect(h.recipeInputs[1]).toMatchObject({ lab: strong, avoid: ["lab:bad"] });
  });
});

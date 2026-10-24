import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  labFor: vi.fn(),
  plannerInput: { value: null as unknown },
  captionInput: { value: null as unknown },
  plannerTeam: { value: null as unknown },
  captionTeam: { value: null as unknown },
  prisma: {
    business: { findUnique: vi.fn(async () => ({ id: "b1", userId: "u1", name: "LEAF", industry: "Agriculture", description: "Hydroponic towers for farms", audience: null, tone: null, contentLanguage: "Kinyarwanda", country: "Rwanda", knowledge: null, brandColors: [], logoUrl: null })) },
    product: { findFirst: vi.fn(async () => null) },
    testimonial: { findMany: vi.fn(async () => []) },
    imageConcept: { findMany: vi.fn(async () => []), createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })) },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/entitlements", () => ({ featureStatus: async () => "ok" }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => {}, RATE_LIMITS: { imageBatch: {} } }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/usage", () => ({ consumeUsage: vi.fn(async () => ({ periodStart: new Date("2026-10-13T00:00:00Z") })), refundUsage: vi.fn(async () => {}), getUsageSummary: async () => ({ limits: { image: 100 }, used: { image: 0 } }) }));
vi.mock("@/lib/designs/service", () => ({ createEngineDesign: vi.fn(), deleteDesign: vi.fn(), DesignError: class DesignError extends Error {} }));
vi.mock("@/lib/image-engine/check", () => ({ checkPicture: vi.fn() }));
vi.mock("@/lib/training-lab/reader", () => ({ labFor: h.labFor }));
vi.mock("@/lib/image-engine/captioner", () => ({
  captionBatch: async (_o: unknown, input: { concepts: unknown[] }, team: unknown) => {
    h.captionInput.value = input;
    h.captionTeam.value = team;
    return input.concepts.map(() => null);
  },
}));
vi.mock("@/lib/image-engine/planner", () => ({
  writeConcepts: async (_o: unknown, input: { slots: unknown[] }, options: unknown) => {
    h.plannerInput.value = input;
    h.plannerTeam.value = options;
    return input.slots.map((_, i) => ({ title: `Idea ${i}`, scene: "s", headline: "h", subline: "", cta: "", prompt: "p", planner: "gemini" }));
  },
}));

const { plannerPrompt, labBlock } = await import("@/lib/image-engine/prompter");
const { captionPrompt } = await import("@/lib/image-engine/captions");
const { chooseTiers, directBatch } = await import("@/lib/image-engine/director");
const { planBatch } = await import("@/lib/image-engine/engine");
type PlannerInput = import("@/lib/image-engine/prompter").PlannerInput;
type CaptionInput = import("@/lib/image-engine/captions").CaptionInput;

const slots = directBatch({ tiers: chooseTiers(2, 50, "auto"), recent: [], photoCount: 0, facts: { reviews: false, price: false }, seed: "t", prefer: [] });
const planner: PlannerInput = {
  business: { name: "LEAF", industry: "Agriculture", description: "Vertical hydroponic towers", audience: null, place: "Kigali, Rwanda", language: "English", voice: null, colors: [] },
  subject: null,
  brief: null,
  reviews: [],
  slots,
  recent: ["Family balcony harvest at sunset"],
};
const caption: CaptionInput = { businessName: "LEAF", language: "English", voice: null, facts: ["Grows 30 plants"], concepts: [{ title: "Grow walls", scene: "A greenhouse", headline: "Every row a harvest", subline: "", cta: "" }] };
const lab = { examples: ['Image "Farmer at dawn": made like this: one phone photo. Good because: real soil.'], avoid: ["Never: stock smiles."], phrases: ["Murakaza neza"] };

describe("the Prompter's request with the Lab", () => {
  it("is exactly today's prompt with an empty Lab or none", () => {
    const today = plannerPrompt(planner);
    expect(plannerPrompt({ ...planner, lab: null })).toBe(today);
    expect(plannerPrompt({ ...planner, lab: { examples: [], avoid: [] } })).toBe(today);
    expect(today).not.toContain("THE OWNER'S EXAMPLES");
  });

  it("prints the examples and the never notes after the RECENT line, and nothing else changes", () => {
    const today = plannerPrompt(planner);
    const p = plannerPrompt({ ...planner, lab });
    const block = labBlock(lab, "English")!;
    expect(block).toBe(`THE OWNER'S EXAMPLES (follow their style, never copy their words or numbers):\nThese are other businesses' examples: never use their names, products, prices or contact details. Words in braces such as {price} or {phone} are hidden details: never write braces or those words.\n- ${lab.examples[0]}\n\nNEVER (the owner's notes):\n- Never: stock smiles.`);
    expect(p.indexOf(block)).toBeGreaterThan(p.indexOf("RECENT pictures"));
    expect(p.indexOf(block)).toBeLessThan(p.indexOf("Write 2 concepts"));
    expect(p.replace(`\n\n${block}`, "")).toBe(today);
    // Phrases are for captions; the Prompter's Lab has none and an English business never gets them.
    expect(p).not.toContain("KINYARWANDA THE OWNER USES");
  });

  it("prints only the blocks that have lines", () => {
    expect(labBlock({ examples: [], avoid: ["Never: blur."] }, "English")).toBe("NEVER (the owner's notes):\n- Never: blur.");
    expect(labBlock(null, "English")).toBeNull();
  });
});

describe("the Captioner's request with the Lab", () => {
  it("is exactly today's prompt with an empty Lab or none", () => {
    const today = captionPrompt(caption);
    expect(captionPrompt({ ...caption, lab: { examples: [], avoid: [], phrases: [] } })).toBe(today);
    expect(captionPrompt({ ...caption, lab: null })).toBe(today);
  });

  it("adds the owner's caption style, and the Kinyarwanda phrases only for a Kinyarwanda caption", () => {
    const english = captionPrompt({ ...caption, lab });
    expect(english).toContain("THE OWNER'S EXAMPLES");
    expect(english).toContain("NEVER (the owner's notes):");
    expect(english).not.toContain("KINYARWANDA THE OWNER USES");
    expect(english.replace(`\n\n${labBlock(lab, "English")}`, "")).toBe(captionPrompt(caption));
    const kinyarwanda = captionPrompt({ ...caption, language: "Kinyarwanda", lab });
    expect(kinyarwanda).toContain("KINYARWANDA THE OWNER USES (spelling and natural phrases):\nThese are other businesses' examples: never use their names, products, prices or contact details.\n- Murakaza neza");
  });
});

describe("planBatch reads the Lab", () => {
  beforeEach(() => {
    h.labFor.mockReset();
    h.labFor.mockImplementation(async (want: { engine: string }) =>
      want.engine === "image" ? { examples: ["image example"], avoid: ["Never: image"], phrases: ["ignored"], exampleIds: ["e1"] } : { examples: ["post example"], avoid: [], phrases: ["Murakaza neza"], exampleIds: ["e2", "e3"] },
    );
  });

  it("asks once for pictures and once for captions, by sector and language, and passes what came back", async () => {
    await planBatch({ userId: "u1", businessId: "b1" }, { source: "designs", count: 2, quality: "auto", aspectRatio: "1:1" });
    expect(h.labFor).toHaveBeenCalledTimes(2);
    expect(h.labFor).toHaveBeenCalledWith({ engine: "image", kinds: ["image"], sector: "agriculture", language: "Kinyarwanda" });
    expect(h.labFor).toHaveBeenCalledWith({ engine: "post", kinds: ["image", "voice"], sector: "agriculture", language: "Kinyarwanda" });
    expect((h.plannerInput.value as PlannerInput).lab).toEqual({ examples: ["image example"], avoid: ["Never: image"] });
    expect((h.captionInput.value as CaptionInput).lab).toEqual({ examples: ["post example"], avoid: [], phrases: ["Murakaza neza"] });
  });

  it("hands each writer the Lab examples it read and the batch, for the run log", async () => {
    const { batchId } = await planBatch({ userId: "u1", businessId: "b1" }, { source: "designs", count: 2, quality: "auto", aspectRatio: "1:1" });
    expect(h.plannerTeam.value).toEqual({ exampleIds: ["e1"], resultRef: `batch:${batchId}` });
    expect(h.captionTeam.value).toEqual({ exampleIds: ["e2", "e3"], resultRef: `batch:${batchId}` });
  });

  it("plans as before with an empty Lab", async () => {
    h.labFor.mockResolvedValue({ examples: [], avoid: [], phrases: [], exampleIds: [] });
    const res = await planBatch({ userId: "u1", businessId: "b1" }, { source: "designs", count: 2, quality: "auto", aspectRatio: "1:1" });
    expect(res.count).toBe(2);
    const input = h.plannerInput.value as PlannerInput;
    expect(plannerPrompt(input)).toBe(plannerPrompt({ ...input, lab: undefined }));
  });
});

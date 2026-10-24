import { beforeEach, describe, expect, it, vi } from "vitest";

// "Generate again" and the versions of one post (lib/content-flow/post-writing.ts): one text generation each, given
// back when anything fails; every change kept as a version; restoring adds a version; everything scoped by business.

const prisma = vi.hoisted(() => ({
  post: { findFirst: vi.fn(), updateMany: vi.fn() },
  generatedContent: { findFirst: vi.fn(), updateMany: vi.fn() },
  business: { findUnique: vi.fn() },
  postVersion: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  user: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
const usage = vi.hoisted(() => {
  class UsageLimitError extends Error {
    constructor(
      public reason: string,
      public metric: string,
    ) {
      super("limit");
    }
  }
  return { consumeUsage: vi.fn(), refundUsage: vi.fn(), getUsageSummary: vi.fn(), UsageLimitError };
});
const ai = vi.hoisted(() => ({ generate: vi.fn() }));

const lab = vi.hoisted(() => ({ labFor: vi.fn(), labLanguage: vi.fn() }));
vi.mock("@/lib/training-lab/reader", () => ({ labFor: lab.labFor }));
vi.mock("@/lib/training-lab/language-reader", () => ({ labLanguage: lab.labLanguage }));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/usage", () => usage);
vi.mock("@/lib/ai", () => ({ getTextProvider: () => ({ name: "gemini", generate: ai.generate }) }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: (_a: unknown, _b: unknown, fn: () => unknown) => fn() }));
vi.mock("@/lib/studio/service", () => ({ configuredModel: () => "test-model" }));
vi.mock("@/lib/visuals/service", () => ({ VisualError: class extends Error {} }));
vi.mock("@/lib/knowledge/writer-context", () => ({ writerKnowledge: async () => ({ knowledgeBase: "Customers: schools in Kigali.\nPrice: 15,000 RWF", voiceProfile: null }) }));
vi.mock("@/lib/knowledge/service", async (orig) => ({
  ...(await orig<typeof import("@/lib/knowledge/service")>()),
  writingSubject: vi.fn(async () => ({ subject: { kind: "product", id: "p-tower" }, type: "product", title: "Hydro tower", context: "Name: Hydro tower\nPrice: 15,000 RWF\nGrows 40 plants", price: "15,000 RWF", features: ["Grows 40 plants"], photoPaths: [] })),
}));

import { rewritePost } from "@/lib/content-flow/post-writing";

const actor = { userId: "owner-account", businessId: "b1", actorId: "person-1" };
const CREATED = new Date("2026-10-14T06:00:00Z");
const SCRIPT = "[Tower in a classroom] Grow greens at school.\n[Kids pick lettuce] Fresh every week.\n[Logo] Ask us today.";
const HEADLINES = ["Grow at school", "Greens for every class", "Lettuce by Friday"];
const post = (extra: Record<string, unknown> = {}) => ({ id: "p1", businessId: "b1", network: "instagram", status: "PENDING_APPROVAL", format: "POST", title: null, text: "Fresh greens at school.", hashtags: ["#green"], contest: null, contentId: "c1", createdAt: CREATED, updatedAt: CREATED, ...extra });
const content = (extra: Record<string, unknown> = {}) => ({ id: "c1", caption: "Fresh greens at school.", videoScript: SCRIPT, adHeadlines: HEADLINES, angle: "tips", format: "image", mode: "ai", brief: null, productId: "p-tower", campaignId: null, ...extra });
const reply = (body: unknown) => ({ text: JSON.stringify(body), provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });

beforeEach(() => {
  vi.clearAllMocks();
  prisma.post.findFirst.mockResolvedValue(post());
  prisma.post.updateMany.mockResolvedValue({ count: 1 });
  prisma.generatedContent.findFirst.mockResolvedValue(content());
  prisma.generatedContent.updateMany.mockResolvedValue({ count: 1 });
  prisma.business.findUnique.mockResolvedValue({ id: "b1", name: "Green Kigali", contentLanguage: "Kinyarwanda", industry: null, industryRef: null, description: null, audience: null, tone: "friendly", website: null, knowledge: null, profile: null, marketingProfile: null });
  prisma.postVersion.findFirst.mockResolvedValue(null);
  prisma.postVersion.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "v-new", ...data }));
  prisma.postVersion.findMany.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue([]);
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  usage.consumeUsage.mockResolvedValue({ periodStart: new Date("2026-10-01") });
  usage.refundUsage.mockResolvedValue(undefined);
  usage.getUsageSummary.mockResolvedValue({ used: { text: 27 }, limits: { text: 30 } });
  lab.labFor.mockResolvedValue({ examples: [], avoid: [], phrases: [], exampleIds: [] });
  lab.labLanguage.mockResolvedValue({});
});


const LAB = { examples: ['Image "Price first": made like this: a big price. Good because: it is clear.'], avoid: ['Never (from "A"): stock smiles.'], phrases: ["Murakaza neza"], exampleIds: ["e1"] };
const NOTE = "These are other businesses' examples: never use their names, products, prices or contact details.";
const answers = {
  headlines: { adHeadlines: ["Amashu ku ishuri", "Igiciro kiri hasi", "Twandikire uyu munsi"] },
  script: { scenes: ["[Tower] Igiciro nziza.", "[Kids] Fresh.", "[Logo] Ask us."] },
  caption: { posts: [{ index: 1, caption: "Igiciro nziza ku ishuri.", hashtags: ["#green"], videoScript: "[Tower] Igiciro.\n[Kids] Fresh.\n[Logo] Ask.", adHeadlines: ["Igiciro one", "Two", "Three"] }] },
} as const;
type Part = keyof typeof answers;
const promptOf = async (part: Part) => {
  ai.generate.mockClear();
  ai.generate.mockResolvedValue(reply(answers[part]));
  await rewritePost(actor, "p1", part);
  return ai.generate.mock.calls[0][0].prompt as string;
};

describe("Generate again learns from the Training Lab", () => {
  it("reads the Lab once per call, for the post engine and the brand's language", async () => {
    await promptOf("headlines");
    expect(lab.labFor).toHaveBeenCalledTimes(1);
    expect(lab.labFor).toHaveBeenCalledWith(expect.objectContaining({ engine: "post", kinds: ["image", "voice"], language: "Kinyarwanda" }));
    expect(lab.labLanguage).toHaveBeenCalledTimes(1);
    expect(lab.labLanguage).toHaveBeenCalledWith("Kinyarwanda");
  });

  for (const part of ["headlines", "script", "caption"] as const) {
    it(`${part}: the prompt is the same with an empty Lab, and the Lab block appears only when it has something`, async () => {
      const plain = await promptOf(part);
      expect(plain).not.toMatch(/THE OWNER'S EXAMPLES|NEVER \(the owner's notes\)/);
      // Spellings to fix alone do not touch the prompt.
      lab.labLanguage.mockResolvedValue({ wrong: [{ word: "nothing-here", fix: "x" }] });
      expect(await promptOf(part)).toBe(plain);
      lab.labFor.mockResolvedValue(LAB);
      const withLab = await promptOf(part);
      expect(withLab).toContain(`THE OWNER'S EXAMPLES (follow their style, never copy their words or numbers):\n${NOTE}\n- Image "Price first"`);
      expect(withLab).toContain("NEVER (the owner's notes):\n- Never (from \"A\"): stock smiles.");
      expect(withLab).toContain("KINYARWANDA THE OWNER USES (spelling and natural phrases):\n- Murakaza neza");
      // After the language line, never in the facts.
      expect(withLab.indexOf("THE OWNER'S EXAMPLES")).toBeGreaterThan(withLab.indexOf("Write in Kinyarwanda."));
    });
  }

  it("fixes the owner's marked spellings in the new headlines, for no extra generation", async () => {
    lab.labLanguage.mockResolvedValue({ wrong: [{ word: "igiciro", fix: "igiciro:" }] });
    await promptOf("headlines");
    expect(prisma.generatedContent.updateMany.mock.calls[0][0].data.adHeadlines).toEqual(["Amashu ku ishuri", "Igiciro: kiri hasi", "Twandikire uyu munsi"]);
    expect(ai.generate).toHaveBeenCalledTimes(1);
    expect(usage.consumeUsage).toHaveBeenCalledTimes(1);
  });

  it("fixes them in a new video script", async () => {
    lab.labLanguage.mockResolvedValue({ wrong: [{ word: "igiciro", fix: "igiciro:" }] });
    await promptOf("script");
    expect(prisma.generatedContent.updateMany.mock.calls[0][0].data.videoScript).toContain("Igiciro: nziza.");
  });

  it("fixes them in a new caption, script and headlines", async () => {
    lab.labLanguage.mockResolvedValue({ wrong: [{ word: "igiciro", fix: "igiciro:" }] });
    await promptOf("caption");
    const data = prisma.generatedContent.updateMany.mock.calls[0][0].data;
    expect(data.caption).toMatch(/^Igiciro: nziza/);
  });
});

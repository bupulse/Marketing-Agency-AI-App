import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    generatedContent: { findFirst: vi.fn(), updateMany: vi.fn() },
    business: { findUnique: vi.fn() },
    contentVisual: { findMany: vi.fn() },
  },
  generate: vi.fn(),
  consumeUsage: vi.fn(),
  refundUsage: vi.fn(),
  videoAvailable: vi.fn(),
  planVisuals: vi.fn(),
  removeVisual: vi.fn(),
  writingSubject: vi.fn(),
  ledger: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/ai", () => ({ getTextProvider: () => ({ name: "gemini", generate: mocks.generate }) }));
vi.mock("@/lib/ai/ledger", () => ({
  withLedger: async (context: unknown, _m: unknown, call: () => unknown) => {
    mocks.ledger(context);
    return call();
  },
}));
vi.mock("@/lib/usage", () => ({ consumeUsage: mocks.consumeUsage, refundUsage: mocks.refundUsage, UsageLimitError: class extends Error {} }));
vi.mock("@/lib/studio/service", () => ({ configuredModel: () => "test-model" }));
vi.mock("@/lib/knowledge/service", () => ({ writingSubject: mocks.writingSubject }));
vi.mock("@/lib/knowledge/writer-context", () => ({ writerKnowledge: async () => ({ knowledgeBase: "<<<AUDIENCE\nParents in Kigali\nAUDIENCE>>>", voiceProfile: null }) }));
vi.mock("@/lib/visuals/service", () => ({
  VisualError: class VisualError extends Error {},
  aiPhotosStatus: async () => ({ allowed: false, exhausted: null }),
  audienceFor: async () => undefined,
  carouselNetworks: async () => true,
  planVisuals: mocks.planVisuals,
  releaseContentVisuals: vi.fn(),
  removeVisual: mocks.removeVisual,
  videoAvailable: mocks.videoAvailable,
}));

import { checkScript, fitScript, SCRIPT_RULES } from "@/lib/visuals/script";
import { buildScriptPrompt, writeVideoScript } from "@/lib/visuals/script-writer";
import { remakeContentVisuals, VIDEO_NOT_IN_PLAN } from "@/lib/visuals/content";
import { buildVideoPlan } from "@/lib/visuals/video-plan";

const owner = { userId: "u1", businessId: "b1" };
const content = { id: "c1", caption: "Fresh bread every morning at Kigali Bakes.", adHeadlines: ["Fresh every morning"], videoScript: "", productId: "p1", campaignId: null, angle: "story", network: "tiktok" };
const scenes = ["[Bread coming out of the oven] Fresh every morning.", "[A customer smiling] Still warm when you get it.", "[The shop front] Come by before 9 for the best choice."];
const answer = (list: string[]) => ({ text: JSON.stringify({ scenes: list }), provider: "gemini", model: "m", usage: { inputTokens: 10, outputTokens: 20 } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.generatedContent.findFirst.mockResolvedValue(content);
  mocks.prisma.generatedContent.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.business.findUnique.mockResolvedValue({ name: "Kigali Bakes", tone: "friendly", industry: null, brandColors: [], contentLanguage: "English", marketingProfile: null });
  mocks.prisma.contentVisual.findMany.mockResolvedValue([]);
  mocks.writingSubject.mockResolvedValue({ type: "product", title: "Sourdough loaf", price: "3,000 RWF", context: "<<<PRODUCT DATA\nSourdough loaf\nPRODUCT DATA>>>", features: [], photoPaths: ["u1/p.jpg"] });
  mocks.consumeUsage.mockResolvedValue({ periodStart: new Date("2026-10-01") });
  mocks.refundUsage.mockResolvedValue(undefined);
  mocks.videoAvailable.mockResolvedValue(true);
  mocks.planVisuals.mockResolvedValue({ image: null, video: "v1" });
  mocks.generate.mockResolvedValue(answer(scenes));
});

describe("script rules (voiceover length)", () => {
  it("counts scenes and spoken characters, with the problems to fix", () => {
    const ok = checkScript(scenes.join("\n"));
    expect(ok.scenes).toEqual(["Fresh every morning.", "Still warm when you get it.", "Come by before 9 for the best choice."]);
    expect(ok.problems).toEqual([]);
    expect(ok.spokenChars).toBe(ok.scenes.join("").length);
    const bad = checkScript(["One.", "x".repeat(SCRIPT_RULES.lineChars + 5)].join("\n"));
    expect(bad.problems.join(" ")).toMatch(/at least 3 scenes.*over 80 characters/);
  });

  it("holds an AI script to the rules: scene count, line length and total, keeping the call to action", () => {
    const long = Array.from({ length: 8 }, (_, i) => `[Shot ${i}] ${"word ".repeat(18)}line ${i}.`);
    const fitted = fitScript(long.join("\n"));
    const check = checkScript(fitted);
    expect(check.scenes.length).toBeLessThanOrEqual(SCRIPT_RULES.maxScenes);
    expect(check.scenes.length).toBeGreaterThanOrEqual(SCRIPT_RULES.minScenes);
    expect(check.scenes.every((s) => s.length <= SCRIPT_RULES.lineChars)).toBe(true);
    expect(check.spokenChars).toBeLessThanOrEqual(SCRIPT_RULES.totalChars);
    expect(fitted.split("\n").at(-1)).toMatch(/^\[Shot 7\]/);
    // The video plan reads it scene by scene, inside 10 to 30 seconds.
    const plan = buildVideoPlan({ script: fitted, hook: "Fresh every morning", businessName: "Kigali Bakes", photos: [], pack: "bold" as never });
    expect(plan.totalMs).toBeGreaterThanOrEqual(10_000);
    expect(plan.totalMs).toBeLessThanOrEqual(30_000);
  });
});

describe("the script writer", () => {
  it("writes from the post, its angle, the subject and the voice, with the rules", async () => {
    const out = await writeVideoScript({ name: "gemini", generate: mocks.generate } as never, {
      businessName: "Kigali Bakes",
      tone: "friendly",
      voiceProfile: null,
      knowledgeBase: "Parents in Kigali",
      languageLine: "Write in Kinyarwanda.",
      subject: { title: "Sourdough loaf", context: null },
      angle: { label: "Story", brief: "A short story." },
      caption: "Fresh bread every morning.",
    });
    expect(out.script.split("\n")).toEqual(scenes);
    const prompt = mocks.generate.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("<<<POST\nFresh bread every morning.\nPOST>>>");
    expect(prompt).toContain("Write in Kinyarwanda.");
    expect(prompt).toContain("Sourdough loaf");
    expect(prompt).toContain("Story");
    expect(prompt).toContain(`at most ${SCRIPT_RULES.totalChars} characters`);
    expect(buildScriptPrompt({ businessName: "B", tone: null, voiceProfile: null, knowledgeBase: null, languageLine: "Write in English.", subject: null, angle: null, caption: "x" })).toContain("about the business itself");
  });
});

describe("Make a video", () => {
  it("writes the missing script first (1 text generation, in the ledger), saves it, then plans the video", async () => {
    const made = await remakeContentVisuals(owner, "c1", "video");
    expect(made).toEqual({ image: null, video: "v1" });
    expect(mocks.consumeUsage).toHaveBeenCalledWith("u1", "text");
    expect(mocks.refundUsage).not.toHaveBeenCalled();
    expect(mocks.ledger).toHaveBeenCalledWith({ userId: "u1", businessId: "b1", feature: "content" });
    expect(mocks.prisma.generatedContent.updateMany).toHaveBeenCalledWith({ where: { id: "c1", businessId: "b1" }, data: { videoScript: scenes.join("\n") } });
    expect(mocks.planVisuals.mock.calls[0][0]).toMatchObject({ video: true, image: false, videoScript: scenes.join("\n") });
    expect(mocks.generate.mock.calls[0][0].prompt).toContain("Fresh bread every morning at Kigali Bakes.");
  });

  it("uses the owner's own script as typed: no AI call, no credit", async () => {
    const own = "Our oven starts at 5.\nCome taste it.\nOpen until 8 pm.";
    await remakeContentVisuals(owner, "c1", "video", { script: `  ${own}  ` });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
    expect(mocks.prisma.generatedContent.updateMany).toHaveBeenCalledWith({ where: { id: "c1", businessId: "b1" }, data: { videoScript: own } });
    expect(mocks.planVisuals.mock.calls[0][0]).toMatchObject({ video: true, videoScript: own });
    await expect(remakeContentVisuals(owner, "c1", "video", { script: "   " })).rejects.toThrow("Write your script first");
  });

  it("uses the script the content already has without writing a new one", async () => {
    mocks.prisma.generatedContent.findFirst.mockResolvedValue({ ...content, videoScript: "Hello.\nWorld.\nBye." });
    await remakeContentVisuals(owner, "c1", "video");
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
  });

  it("only stops when videos are not in the plan", async () => {
    mocks.videoAvailable.mockResolvedValue(false);
    await expect(remakeContentVisuals(owner, "c1", "video")).rejects.toThrow(VIDEO_NOT_IN_PLAN);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("gives the credit back and says so when the script cannot be written", async () => {
    mocks.generate.mockResolvedValue({ text: "not json", provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
    await expect(remakeContentVisuals(owner, "c1", "video")).rejects.toThrow("We could not write the video script just now");
    expect(mocks.refundUsage).toHaveBeenCalledWith("u1", "text", new Date("2026-10-01"));
    expect(mocks.planVisuals).not.toHaveBeenCalled();
  });
});

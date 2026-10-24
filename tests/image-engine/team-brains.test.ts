import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  saved: vi.fn<(id: string) => Promise<string | null>>(async () => null),
  runText: vi.fn(),
  recordRun: vi.fn(async () => "run1"),
  providerName: { value: "gemini" },
  generate: vi.fn(),
  claudeGenerate: vi.fn(),
  subscription: vi.fn(),
  subscriptionAllowed: { value: false },
  claudeOn: { value: true },
  ledger: vi.fn(),
}));

vi.mock("@/lib/training-lab/brains", () => ({ savedBrain: h.saved, runText: h.runText }));
vi.mock("@/lib/training-lab/runs", () => ({ recordRun: h.recordRun }));
vi.mock("@/lib/ai", () => ({ getTextProvider: () => ({ name: h.providerName.value, generate: h.generate }) }));
vi.mock("@/lib/ai/claude-text", () => ({
  ClaudeTextProvider: class {
    generate = h.claudeGenerate;
  },
}));
vi.mock("@/lib/ai/ledger", () => ({
  withLedger: async (ctx: unknown, meta: unknown, call: () => unknown) => {
    h.ledger(ctx, meta);
    return call();
  },
}));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: async () => h.claudeOn.value }));
vi.mock("@/lib/image-engine/claude-cli", () => ({ claudeBySubscription: h.subscription, subscriptionAllowed: () => h.subscriptionAllowed.value, SUBSCRIPTION_MODEL: "claude-sonnet-5-5" }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));

const { writeConcepts } = await import("@/lib/image-engine/planner");
const { captionBatch } = await import("@/lib/image-engine/captioner");
const { PLANNER_JSON_SCHEMA, PLANNER_SYSTEM, plannerPrompt } = await import("@/lib/image-engine/prompter");
const { CAPTION_SCHEMA, CAPTION_SYSTEM, captionPrompt } = await import("@/lib/image-engine/captions");
const { chooseTiers, directBatch } = await import("@/lib/image-engine/director");
type PlannerInput = import("@/lib/image-engine/prompter").PlannerInput;
type CaptionInput = import("@/lib/image-engine/captions").CaptionInput;

const owner = { userId: "u1", businessId: "b1" };
const team = { exampleIds: ["e1", "e2"], resultRef: "batch:x" };
const slots = directBatch({ tiers: chooseTiers(2, 50, "auto"), recent: [], photoCount: 0, facts: { reviews: false, price: false }, seed: "t", prefer: [] });
const input: PlannerInput = {
  business: { name: "LEAF", industry: "Agriculture", description: "Vertical hydroponic towers", audience: null, place: "Kigali, Rwanda", language: "English", voice: null, colors: [] },
  subject: null,
  brief: null,
  reviews: [],
  slots,
  recent: [],
};
const longPrompt = "A wide advertising photograph inside a commercial greenhouse in Rwanda with rows of tall cream vertical towers full of lettuce and kale, three workers harvesting into crates, soft morning daylight through the glass roof, calm space at the top for the words.";
/** An answer with a concept for each slot number given (numbered within that request). */
const concepts = (n: number) => JSON.stringify({ concepts: Array.from({ length: n }, (_, i) => ({ slot: i, title: `Idea ${i}`, scene: "A greenhouse", headline: "Every row a harvest", subline: "", cta: "", prompt: longPrompt })) });
const usage = { inputTokens: 1000, outputTokens: 500 };
const caption: CaptionInput = { businessName: "LEAF", language: "English", voice: null, facts: [], concepts: [{ title: "Grow walls", scene: "A greenhouse", headline: "Every row a harvest", subline: "", cta: "" }] };
const captions = JSON.stringify({ captions: [{ index: 0, caption: "Fresh from Kigali. Message us to order.", hashtags: ["LEAF"] }] });

beforeEach(() => {
  for (const f of [h.saved, h.runText, h.recordRun, h.generate, h.claudeGenerate, h.subscription, h.ledger]) f.mockClear();
  h.saved.mockResolvedValue(null);
  h.providerName.value = "gemini";
  h.subscriptionAllowed.value = false;
  h.claudeOn.value = true;
  h.generate.mockResolvedValue({ text: concepts(1), provider: "gemini", model: "gemini-test", usage });
  h.claudeGenerate.mockResolvedValue({ text: concepts(1), provider: "claude", model: "claude-sonnet-5-5", usage });
  vi.stubEnv("ANTHROPIC_API_KEY", "k");
});

describe("the Designer with no brain saved: as before", () => {
  it("splits the batch between Claude and Gemini and logs one run per call, with the Lab examples and the batch", async () => {
    const out = await writeConcepts(owner, input, team);
    expect(out.map((c) => c.planner)).toEqual(["claude", "gemini"]);
    expect(h.runText).not.toHaveBeenCalled();
    expect(h.ledger).toHaveBeenCalledWith({ ...owner, feature: "imageEngine" }, { provider: "claude", model: "claude-sonnet-5-5" });
    expect(h.recordRun).toHaveBeenCalledTimes(2);
    const runs = h.recordRun.mock.calls.map((c) => (c as unknown[])[0] as Record<string, unknown>);
    expect(runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: "designer", brain: "anthropic", model: "claude-sonnet-5-5", feature: "imageEngine", ok: true, exampleIds: ["e1", "e2"], resultRef: "batch:x" }),
        expect.objectContaining({ agentId: "designer", brain: "gemini", model: "gemini-test", ok: true, exampleIds: ["e1", "e2"], resultRef: "batch:x" }),
      ]),
    );
    for (const r of runs) expect(r.costUsd as number).toBeGreaterThanOrEqual(0);
  });

  it("names the subscription when Claude runs on it, at no cost", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    h.subscriptionAllowed.value = true;
    h.subscription.mockResolvedValue({ text: concepts(1) });
    await writeConcepts(owner, input, team);
    expect(h.recordRun).toHaveBeenCalledWith(expect.objectContaining({ brain: "claude-subscription", costUsd: 0, ok: true }));
  });

  it("writes on Gemini alone when Claude is switched off", async () => {
    h.claudeOn.value = false;
    h.generate.mockResolvedValue({ text: concepts(2), provider: "gemini", model: "gemini-test", usage });
    const out = await writeConcepts(owner, input, team);
    expect(out.map((c) => c.planner)).toEqual(["gemini", "gemini"]);
    expect(h.claudeGenerate).not.toHaveBeenCalled();
    expect(h.recordRun).toHaveBeenCalledTimes(1);
  });

  it("logs a failed call and lets the other writer fill the gap", async () => {
    h.claudeGenerate.mockRejectedValueOnce(new Error("Claude is down"));
    const out = await writeConcepts(owner, input, team);
    expect(out.map((c) => c.planner)).toEqual(["gemini", "gemini"]);
    expect(h.recordRun).toHaveBeenCalledWith(expect.objectContaining({ brain: "anthropic", ok: false, error: "Claude is down" }));
  });
});

describe("the Designer with a brain saved: the router", () => {
  it("asks runText once for every slot, with the Prompter's request, and the rules fill a gap", async () => {
    h.saved.mockImplementation(async (id: string) => (id === "designer" ? "gemini" : null));
    h.runText.mockResolvedValueOnce({ text: concepts(1), brain: "gemini", model: "m", costUsd: 0.001 });
    const out = await writeConcepts(owner, input, team);
    expect(h.runText).toHaveBeenCalledWith("designer", { system: PLANNER_SYSTEM, prompt: plannerPrompt(input), jsonSchema: PLANNER_JSON_SCHEMA, maxOutputTokens: 900 * 2 + 500, feature: "imageEngine", owner, exampleIds: ["e1", "e2"], resultRef: "batch:x" });
    expect(out.map((c) => c.planner)).toEqual(["gemini", "rules"]);
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.claudeGenerate).not.toHaveBeenCalled();
    // runText logs its own runs.
    expect(h.recordRun).not.toHaveBeenCalled();
  });

  it("labels a Claude brain as Claude, and the rules write everything when the router has no answer", async () => {
    h.saved.mockImplementation(async (id: string) => (id === "designer" ? "claude-subscription" : null));
    h.runText.mockResolvedValueOnce({ text: concepts(2), brain: "claude-subscription", model: "m", costUsd: 0 });
    expect((await writeConcepts(owner, input, team)).map((c) => c.planner)).toEqual(["claude", "claude"]);
    h.runText.mockResolvedValueOnce(null);
    expect((await writeConcepts(owner, input, team)).map((c) => c.planner)).toEqual(["rules", "rules"]);
    expect(h.recordRun).toHaveBeenCalledWith(expect.objectContaining({ agentId: "designer", brain: "rules", ok: true, resultRef: "batch:x" }));
  });
});

describe("the Caption writer", () => {
  it("with no brain saved: the site's text provider, as before, and one run logged", async () => {
    h.generate.mockResolvedValueOnce({ text: captions, provider: "gemini", model: "gemini-test", usage });
    const out = await captionBatch(owner, caption, team);
    expect(out[0]).toContain("Fresh from Kigali.");
    expect(h.runText).not.toHaveBeenCalled();
    expect(h.ledger).toHaveBeenCalledWith({ ...owner, feature: "imageEngine" }, expect.objectContaining({ provider: "gemini" }));
    expect(h.recordRun).toHaveBeenCalledWith(expect.objectContaining({ agentId: "caption-writer", brain: "gemini", model: "gemini-test", ok: true, exampleIds: ["e1", "e2"], resultRef: "batch:x" }));
  });

  it("logs the brain as Claude when the site's text provider is Claude", async () => {
    h.providerName.value = "claude";
    h.generate.mockResolvedValueOnce({ text: captions, provider: "claude", model: "claude-opus-5-5", usage });
    await captionBatch(owner, caption, team);
    expect(h.recordRun).toHaveBeenCalledWith(expect.objectContaining({ agentId: "caption-writer", brain: "anthropic" }));
  });

  it("with a brain saved: runText with the Captioner's request; no captions when it has no answer", async () => {
    h.saved.mockImplementation(async (id: string) => (id === "caption-writer" ? "anthropic" : null));
    h.runText.mockResolvedValueOnce({ text: captions, brain: "anthropic", model: "m", costUsd: 0.002 });
    expect((await captionBatch(owner, caption, team))[0]).toContain("Fresh from Kigali.");
    expect(h.runText).toHaveBeenCalledWith("caption-writer", { system: CAPTION_SYSTEM, prompt: captionPrompt(caption), jsonSchema: CAPTION_SCHEMA, maxOutputTokens: 700, feature: "imageEngine", owner, exampleIds: ["e1", "e2"], resultRef: "batch:x" });
    expect(h.generate).not.toHaveBeenCalled();
    h.runText.mockResolvedValueOnce(null);
    expect(await captionBatch(owner, caption, team)).toEqual([null]);
    expect(h.recordRun).toHaveBeenCalledWith(expect.objectContaining({ agentId: "caption-writer", brain: "rules" }));
  });

  it("never throws: a failed call gives no captions and is logged", async () => {
    h.generate.mockRejectedValueOnce(new Error("Gemini is down"));
    expect(await captionBatch(owner, caption, team)).toEqual([null]);
    expect(h.recordRun).toHaveBeenCalledWith(expect.objectContaining({ agentId: "caption-writer", ok: false, error: "Gemini is down" }));
  });
});

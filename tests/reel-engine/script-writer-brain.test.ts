import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  saved: vi.fn(async (): Promise<string | null> => null),
  runText: vi.fn(),
  recordRun: vi.fn(async () => "run1"),
  claudeJson: vi.fn(async (): Promise<string | null> => null),
  generate: vi.fn(),
  ledger: vi.fn(),
  provider: { value: "gemini" },
}));

vi.mock("@/lib/training-lab/brains", () => ({ savedBrain: h.saved, runText: h.runText }));
vi.mock("@/lib/training-lab/runs", () => ({ recordRun: h.recordRun }));
vi.mock("@/lib/image-engine/planner", () => ({ claudeJson: h.claudeJson }));
vi.mock("@/lib/ai", () => ({ getTextProvider: () => ({ name: h.provider.value, generate: h.generate }) }));
vi.mock("@/lib/ai/ledger", () => ({
  withLedger: async (ctx: unknown, model: unknown, call: () => unknown) => {
    h.ledger(ctx, model);
    return call();
  },
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: async () => true }));
vi.mock("@/lib/designs/service", () => ({ createEngineDesign: vi.fn(), designUrls: async () => new Map(), DesignError: class DesignError extends Error {} }));
vi.mock("@/lib/image-engine/check", () => ({ checkPicture: vi.fn() }));
vi.mock("@/lib/image-engine/engine", () => ({ loadFacts: vi.fn() }));
vi.mock("@/lib/music/service", () => ({ musicUrl: (p: string) => p, trackForVideo: async () => null }));
vi.mock("@/lib/storage", () => ({ createSignedUploadUrl: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/reel-engine/checker", () => ({ checkClip: vi.fn() }));
vi.mock("@/lib/training-lab/reader", () => ({ labFor: vi.fn() }));

const { writeReel } = await import("@/lib/reel-engine/engine");
const { directReel } = await import("@/lib/reel-engine/story");
const { REEL_SCHEMA, REEL_SYSTEM, reelPrompt } = await import("@/lib/reel-engine/writer");
type ReelInput = import("@/lib/reel-engine/writer").ReelInput;

const owner = { userId: "u1", businessId: "b1" };
const beats = directReel([], "job-1");
const input = (language: "English" | "Kinyarwanda"): ReelInput => ({
  business: { name: "LEAF", industry: "Agriculture", description: "Vertical hydroponic towers", audience: "Farmers", place: "Kigali, Rwanda", language, voice: null, colors: [] },
  subject: { name: "LEAF Hydro Tower", description: "Grows 30 plants in one square metre", price: "250,000 RWF", sellingPoints: [] },
  brief: null,
  language,
  presenter: "a Black Rwandan woman in her early thirties",
  beats,
  recent: [],
  sector: "agriculture",
});
const frame = "The presenter stands in a plastic-covered greenhouse outside Kigali holding a crate of lettuce next to the white LEAF tower, soft morning light through the dusty roof.";
const motion = "She lifts the crate towards the camera and smiles as the camera slowly pushes in.";
const script = JSON.stringify({ title: "AI title", caption: "Reba!", hashtags: ["LEAF"], music: "afro", clips: beats.map((_, i) => ({ index: i, frame, motion, line: "Muraho neza!" })) });
const team = { exampleIds: ["ex1", "ex2"], resultRef: "reel:job1" };

beforeEach(() => {
  for (const f of [h.saved, h.runText, h.recordRun, h.claudeJson, h.generate, h.ledger]) f.mockClear();
  h.saved.mockResolvedValue(null);
  h.claudeJson.mockResolvedValue(null);
  h.generate.mockResolvedValue({ text: script, provider: "gemini", model: "gemini-test", usage: { inputTokens: 10, outputTokens: 10 } });
  h.provider.value = "gemini";
  vi.stubEnv("ANTHROPIC_API_KEY", "k");
});

describe("the script writer with no brain saved: as before", () => {
  it("sends English to Claude, with the reel engine's ledger feature, and logs one run", async () => {
    h.claudeJson.mockResolvedValueOnce(script);
    const plan = await writeReel(owner, input("English"), team);
    expect(plan.title).toBe("AI title");
    expect(h.claudeJson).toHaveBeenCalledWith(owner, REEL_SYSTEM, reelPrompt(input("English")), REEL_SCHEMA, "reelEngine");
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.runText).not.toHaveBeenCalled();
    expect(h.recordRun).toHaveBeenCalledTimes(1);
    expect(h.recordRun).toHaveBeenCalledWith(expect.objectContaining({ agentId: "script-writer", brain: "anthropic", feature: "reelEngine", businessId: "b1", ok: true, exampleIds: ["ex1", "ex2"], resultRef: "reel:job1" }));
  });

  it("names the subscription when Claude answered without an API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    h.claudeJson.mockResolvedValueOnce(script);
    await writeReel(owner, input("English"), team);
    expect(h.recordRun).toHaveBeenCalledWith(expect.objectContaining({ brain: "claude-subscription", ok: true }));
  });

  it("sends Kinyarwanda to the text provider, never to Claude", async () => {
    const plan = await writeReel(owner, input("Kinyarwanda"), team);
    expect(plan.title).toBe("AI title");
    expect(h.claudeJson).not.toHaveBeenCalled();
    expect(h.generate).toHaveBeenCalledWith(expect.objectContaining({ system: REEL_SYSTEM, jsonSchema: REEL_SCHEMA, maxOutputTokens: 4000 }));
    expect(h.ledger).toHaveBeenCalledWith({ ...owner, feature: "reelEngine" }, expect.objectContaining({ provider: "gemini" }));
    expect(h.recordRun).toHaveBeenCalledTimes(1);
    expect(h.recordRun).toHaveBeenCalledWith(expect.objectContaining({ brain: "gemini", model: "gemini-test", ok: true }));
  });

  it("falls back to the text provider when Claude cannot write English", async () => {
    await writeReel(owner, input("English"), team);
    expect(h.claudeJson).toHaveBeenCalled();
    expect(h.generate).toHaveBeenCalled();
    expect(h.recordRun).toHaveBeenCalledWith(expect.objectContaining({ brain: "gemini", ok: true }));
  });

  it("writes by the rules when the AI fails, and logs the failure", async () => {
    h.generate.mockRejectedValueOnce(new Error("Gemini is down"));
    const plan = await writeReel(owner, input("Kinyarwanda"), team);
    expect(plan.title).toBe("LEAF Hydro Tower");
    expect(h.recordRun).toHaveBeenCalledWith(expect.objectContaining({ brain: "gemini", ok: false, error: "Gemini is down" }));
  });

  it("logs an unusable answer as not ok", async () => {
    h.generate.mockResolvedValueOnce({ text: "not json", provider: "gemini", model: "gemini-test", usage: { inputTokens: 1, outputTokens: 1 } });
    const plan = await writeReel(owner, input("Kinyarwanda"), team);
    expect(plan.title).toBe("LEAF Hydro Tower");
    expect(h.recordRun).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });
});

describe("the script writer with a brain saved: the router", () => {
  it("asks runText with the reel's prompt, feature, owner, examples and result", async () => {
    h.saved.mockResolvedValue("gemini");
    h.runText.mockResolvedValueOnce({ text: script, brain: "gemini", model: "m", costUsd: 0.001 });
    const plan = await writeReel(owner, input("English"), team);
    expect(plan.title).toBe("AI title");
    expect(h.runText).toHaveBeenCalledWith("script-writer", { system: REEL_SYSTEM, prompt: reelPrompt(input("English")), jsonSchema: REEL_SCHEMA, maxOutputTokens: 4000, feature: "reelEngine", owner, exampleIds: ["ex1", "ex2"], resultRef: "reel:job1" });
    expect(h.claudeJson).not.toHaveBeenCalled();
    expect(h.generate).not.toHaveBeenCalled();
    // runText logs its own runs.
    expect(h.recordRun).not.toHaveBeenCalled();
  });

  it("writes by the rules when the router has no answer, and logs that run", async () => {
    h.saved.mockResolvedValue("rules");
    h.runText.mockResolvedValueOnce(null);
    const plan = await writeReel(owner, input("Kinyarwanda"), team);
    expect(plan.title).toBe("LEAF Hydro Tower");
    expect(h.recordRun).toHaveBeenCalledWith(expect.objectContaining({ agentId: "script-writer", brain: "rules", ok: true, resultRef: "reel:job1" }));
  });

  it("writes by the rules when the router's answer is unusable", async () => {
    h.saved.mockResolvedValue("anthropic");
    h.runText.mockResolvedValueOnce({ text: "{}", brain: "anthropic", model: "m", costUsd: 0 });
    expect((await writeReel(owner, input("English"), team)).title).toBe("LEAF Hydro Tower");
  });
});

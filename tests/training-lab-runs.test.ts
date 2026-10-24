import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const create = vi.fn();
const updateMany = vi.fn();
const findMany = vi.fn();
const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { agentRun: { create: (...a: unknown[]) => create(...a), updateMany: (...a: unknown[]) => updateMany(...a), findMany: (...a: unknown[]) => findMany(...a) }, agentSetting: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));
const logError = vi.fn();
vi.mock("@/lib/errors", () => ({ logError: (...a: unknown[]) => logError(...a) }));
const subscription = { allowed: false, claudeOn: true };
const claudeBySubscription = vi.fn();
vi.mock("@/lib/image-engine/claude-cli", () => ({ subscriptionAllowed: () => subscription.allowed, claudeBySubscription: (...a: unknown[]) => claudeBySubscription(...a), SUBSCRIPTION_MODEL: "claude-sonnet-5-5" }));
vi.mock("@/lib/admin/switch", async (orig) => ({ ...(await orig<typeof import("@/lib/admin/switch")>()), isServiceEnabled: async (service: string) => (service === "claude" ? subscription.claudeOn : true) }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: (_c: unknown, _m: unknown, call: () => Promise<unknown>) => call() }));
const geminiGenerate = vi.fn();
const claudeGenerate = vi.fn();
vi.mock("@/lib/ai/gemini-text", () => ({ DEFAULT_GEMINI_TEXT_MODEL: "gemini-3.5-flash", DEFAULT_GEMINI_TEXT_FALLBACK: "gemini-2.5-flash", GeminiTextProvider: class { generate = geminiGenerate } }));
vi.mock("@/lib/ai/claude-text", () => ({ ClaudeTextProvider: class { generate = claudeGenerate } }));

import { recordRun, rateResult, teamSummary } from "@/lib/training-lab/runs";
import { runText } from "@/lib/training-lab/brains";

beforeEach(() => {
  for (const m of [create, updateMany, findMany, findUnique, logError, geminiGenerate, claudeGenerate, claudeBySubscription]) m.mockReset();
  subscription.allowed = false;
  subscription.claudeOn = true;
  create.mockResolvedValue({ id: "run1" });
  findUnique.mockResolvedValue(null);
  vi.stubEnv("GEMINI_API_KEY", "g");
  vi.stubEnv("ANTHROPIC_API_KEY", "a");
});

describe("recordRun", () => {
  it("saves a run with clean values", async () => {
    expect(await recordRun({ agentId: "editor", brain: "rules", feature: "reelEngine", ok: true, ms: 12.6, costUsd: -1, error: "x".repeat(900) })).toBe("run1");
    expect(create.mock.calls[0][0].data).toMatchObject({ agentId: "editor", brain: "rules", ms: 13, costUsd: 0, exampleIds: [], resultRef: null, businessId: null });
    expect(create.mock.calls[0][0].data.error).toHaveLength(500);
  });
  it("never throws", async () => {
    create.mockRejectedValue(new Error("db down"));
    expect(await recordRun({ agentId: "editor", brain: "rules", feature: "f", ok: true })).toBeNull();
    expect(logError).toHaveBeenCalled();
  });
});

describe("rateResult", () => {
  it("rates every run of a result", async () => {
    updateMany.mockResolvedValue({ count: 3 });
    expect(await rateResult("reel:abc", 4)).toBe(3);
    expect(updateMany).toHaveBeenCalledWith({ where: { resultRef: "reel:abc" }, data: { rating: 4 } });
    await rateResult("reel:abc", null);
    expect(updateMany).toHaveBeenLastCalledWith({ where: { resultRef: "reel:abc" }, data: { rating: null } });
  });
  it("refuses a bad rating or reference", async () => {
    for (const bad of [0, 6, 2.5, Number.NaN]) expect(await rateResult("reel:abc", bad)).toBe(0);
    expect(await rateResult("", 3)).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("teamSummary", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const row = (agentId: string, over: Record<string, unknown> = {}) => ({ id: `${agentId}-${Math.random()}`, agentId, brain: "gemini", model: "m", feature: "f", ok: true, ms: 100, costUsd: "0.010000", resultRef: null, rating: null, error: null, createdAt: now, ...over });
  it("counts, rates and costs per member, with the last 5 runs, newest first", async () => {
    findMany.mockResolvedValue([row("designer", { rating: 5 }), row("designer", { ok: false, costUsd: "0.02", rating: 2 }), row("designer"), ...Array.from({ length: 5 }, () => row("designer")), row("checker")]);
    const out = await teamSummary(now);
    expect(out).toHaveLength(10);
    const d = out.find((x) => x.agentId === "designer")!;
    expect(d.runs).toBe(8);
    expect(d.okRate).toBeCloseTo(7 / 8);
    expect(d.costUsd).toBeCloseTo(0.09);
    expect(d.avgRating).toBe(3.5);
    expect(d.rated).toBe(2);
    expect(d.last).toHaveLength(5);
    expect(d.last[0].rating).toBe(5);
    const idle = out.find((x) => x.agentId === "scheduler")!;
    expect(idle).toMatchObject({ runs: 0, okRate: null, costUsd: 0, avgRating: null, last: [] });
    expect(findMany.mock.calls[0][0].where.createdAt.gte).toEqual(new Date("2026-09-24T12:00:00Z"));
  });
});

describe("runText records its attempts", () => {
  it("logs a success with cost, examples and result reference", async () => {
    claudeGenerate.mockResolvedValue({ text: "{}", provider: "claude", model: "claude-sonnet-5-5", usage: { inputTokens: 1000, outputTokens: 1000 } });
    const out = await runText("script-writer", { system: "s", prompt: "p", feature: "reelEngine", exampleIds: ["e1"], resultRef: "reel:1" });
    expect(out).toMatchObject({ brain: "anthropic", costUsd: expect.closeTo(0.018, 5) });
    expect(create.mock.calls[0][0].data).toMatchObject({ agentId: "script-writer", brain: "anthropic", ok: true, exampleIds: ["e1"], resultRef: "reel:1", feature: "reelEngine" });
    expect(Number(create.mock.calls[0][0].data.costUsd)).toBeCloseTo(0.018, 5);
  });
  it("logs a paid brain's failure, and then tries no other paid brain (one request is never paid twice)", async () => {
    claudeGenerate.mockRejectedValue(new Error("overloaded"));
    geminiGenerate.mockResolvedValue({ text: "ok", provider: "gemini", model: "gemini-3.5-flash", usage: { inputTokens: 10, outputTokens: 10 } });
    const out = await runText("script-writer", { system: "s", prompt: "p", feature: "reelEngine" });
    expect(out).toBeNull();
    expect(geminiGenerate).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({ brain: "anthropic", ok: false, error: "overloaded" });
  });
  it("after a paid failure, still tries the free subscription when it is allowed and Claude is on", async () => {
    subscription.allowed = true;
    claudeGenerate.mockRejectedValue(new Error("overloaded"));
    claudeBySubscription.mockResolvedValue({ text: "from the subscription" });
    const out = await runText("script-writer", { system: "s", prompt: "p", feature: "reelEngine" });
    expect(out).toMatchObject({ brain: "claude-subscription", costUsd: 0, text: "from the subscription" });
    expect(geminiGenerate).not.toHaveBeenCalled();
  });
  it("never runs the subscription while the admin Claude switch is off", async () => {
    subscription.allowed = true;
    subscription.claudeOn = false;
    findUnique.mockResolvedValue({ agentId: "script-writer", brain: "claude-subscription" });
    claudeGenerate.mockResolvedValue({ text: "ok", provider: "claude", model: "claude-sonnet-5-5", usage: { inputTokens: 1, outputTokens: 1 } });
    const out = await runText("script-writer", { system: "s", prompt: "p", feature: "reelEngine" });
    expect(claudeBySubscription).not.toHaveBeenCalled();
    // It falls on to the next brain in its order as if the subscription were not there (the API key, then Gemini).
    expect(out?.brain).toBe("anthropic");
  });
  it("stops on a budget or a switched-off provider: rethrown, never sent to another provider", async () => {
    const { AIBudgetExceededError, CompanyBudgetExceededError } = await import("@/lib/ai/budget");
    const { ServiceDisabledError } = await import("@/lib/admin/switch");
    findUnique.mockResolvedValue({ agentId: "caption-writer", brain: "gemini" });
    for (const stop of [new AIBudgetExceededError("gemini"), new CompanyBudgetExceededError("gemini"), new ServiceDisabledError("gemini")]) {
      geminiGenerate.mockReset().mockRejectedValue(stop);
      claudeGenerate.mockReset();
      await expect(runText("caption-writer", { system: "s", prompt: "p", feature: "imageEngine" })).rejects.toBe(stop);
      expect(claudeGenerate).not.toHaveBeenCalled();
    }
  });
  it("still answers when the log fails", async () => {
    create.mockRejectedValue(new Error("db down"));
    claudeGenerate.mockResolvedValue({ text: "hi", provider: "claude", model: "claude-sonnet-5-5", usage: { inputTokens: 1, outputTokens: 1 } });
    expect((await runText("script-writer", { system: "s", prompt: "p", feature: "f" }))?.text).toBe("hi");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// Calls Google or ElevenLabs still bill although we saw no usage: timeouts on our side and answers we stopped waiting
// for. The ledger must record them (docs/AI_COSTS.md), or the admin's AI spend reads lower than the provider's bill.

const { aggregate, create, pending } = vi.hoisted(() => ({ aggregate: vi.fn(), create: vi.fn(), pending: [] as Promise<unknown>[] }));
vi.mock("@/lib/db", () => ({ prisma: { aiCall: { aggregate, create }, adminSetting: { findUnique: vi.fn().mockResolvedValue(null) } } }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/admin/switch", () => ({ assertServiceEnabled: vi.fn() }));
vi.mock("@/lib/platform/background", () => ({ waitUntil: (p: Promise<unknown>) => (pending.push(p), true) }));

import { clearAllowanceCache, clearBudgetCache } from "@/lib/ai/budget";
import { GeminiTextProvider } from "@/lib/ai/gemini-text";
import { GeminiImageProvider } from "@/lib/ai/gemini-image";
import { LateCallError, withLateTimeout, withLedger } from "@/lib/ai/ledger";
import { AIProviderError } from "@/lib/ai/types";

const timeout = () => Object.assign(new Error("timed out"), { name: "TimeoutError" });

beforeEach(() => {
  aggregate.mockReset().mockResolvedValue({ _sum: { costUsd: 0 } });
  create.mockReset().mockResolvedValue({});
  pending.length = 0;
  clearBudgetCache();
  clearAllowanceCache();
  vi.unstubAllGlobals();
});

describe("billed failures", () => {
  it("records an estimate for a Gemini text call that timed out on our side", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout()));
    const provider = new GeminiTextProvider("key", "gemini-3.8-flash");
    const call = withLedger({ feature: "content" }, { provider: "gemini", model: "gemini-3.8-flash" }, () => provider.generate({ system: "s".repeat(400), prompt: "p".repeat(3600) }), (r) => r);
    await expect(call).rejects.toBeInstanceOf(AIProviderError);
    const row = create.mock.calls[0][0].data;
    expect(row).toMatchObject({ success: false, estimated: true, inputTokens: 1000, outputTokens: 1000 });
    expect(Number(row.costUsd)).toBeGreaterThan(0);
  });

  it("records one image for a Gemini image call that timed out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout()));
    const provider = new GeminiImageProvider("key", "gemini-2.5-flash-image");
    const call = withLedger({ feature: "image" }, { provider: "gemini", model: "gemini-2.5-flash-image" }, () => provider.generate({ prompt: "a shop front" }), (r) => ({ ...r, images: 1 }));
    await expect(call).rejects.toBeInstanceOf(AIProviderError);
    const row = create.mock.calls[0][0].data;
    expect(row).toMatchObject({ images: 1, estimated: true, success: false });
    expect(Number(row.costUsd)).toBeGreaterThanOrEqual(0.039);
  });

  it("records one estimated call per request, not one per retry or fallback attempt", { timeout: 20_000 }, async () => {
    // Two busy answers (not billed), then the model times out; the fallback model is busy and then times out too.
    const busy = () => new Response("{}", { status: 503 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockRejectedValue(timeout()));
    const provider = new GeminiTextProvider("key", "gemini-3.8-flash", "gemini-3.1-flash-lite");
    await expect(withLedger({ feature: "content" }, { provider: "gemini", model: "gemini-3.8-flash" }, () => provider.generate({ system: "s", prompt: "p".repeat(400) }), (r) => r)).rejects.toBeInstanceOf(AIProviderError);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({ estimated: true, model: "gemini-3.1-flash-lite", inputTokens: 101, outputTokens: 1000 });
  });

  it("records nothing billable for an HTTP error (not billed by Google)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 400 })));
    const provider = new GeminiTextProvider("key", "gemini-3.8-flash");
    await expect(withLedger({ feature: "content" }, { provider: "gemini", model: "gemini-3.8-flash" }, () => provider.generate({ system: "s", prompt: "p" }), (r) => r)).rejects.toBeInstanceOf(AIProviderError);
    expect(create.mock.calls[0][0].data).toMatchObject({ inputTokens: 0, outputTokens: 0, estimated: false });
  });

  it("records the real usage of an answer that arrived after the caller stopped waiting", async () => {
    let finish!: (v: { model: string; usage: { inputTokens: number; outputTokens: number } }) => void;
    const slow = new Promise<{ model: string; usage: { inputTokens: number; outputTokens: number } }>((r) => (finish = r));
    const call = withLedger({ feature: "visuals" }, { provider: "gemini", model: "gemini-3.1-flash-lite" }, () => withLateTimeout(slow, 5, "too slow"), (r) => ({ provider: "gemini", model: r.model, usage: r.usage }));
    await expect(call).rejects.toBeInstanceOf(LateCallError);
    expect(create).not.toHaveBeenCalled();
    finish({ model: "gemini-3.1-flash-lite", usage: { inputTokens: 2000, outputTokens: 800 } });
    await Promise.all(pending);
    const row = create.mock.calls[0][0].data;
    expect(row).toMatchObject({ success: false, inputTokens: 2000, outputTokens: 800 });
    expect(row.error).toContain("answered late");
    expect(Number(row.costUsd)).toBeCloseTo(0.0017, 6);
  });
});

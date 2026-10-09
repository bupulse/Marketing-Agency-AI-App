import { beforeEach, describe, expect, it, vi } from "vitest";

const { aggregate, create, logError } = vi.hoisted(() => ({ aggregate: vi.fn(), create: vi.fn(), logError: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { aiCall: { aggregate, create } } }));
vi.mock("@/lib/errors", () => ({ logError }));

import { AIBudgetExceededError, clearBudgetCache } from "@/lib/ai/budget";
import { withLedger } from "@/lib/ai/ledger";

const run = () =>
  withLedger(
    { feature: "content" },
    { provider: "gemini", model: "gemini-2.5-flash" },
    async () => "ok",
    () => ({ provider: "gemini", model: "gemini-2.5-flash", usage: { inputTokens: 10, outputTokens: 10 } }),
  );

describe("monthly AI budget", () => {
  beforeEach(() => {
    clearBudgetCache(); // the cap is cached for 30 s
    for (const m of [aggregate, create, logError]) m.mockReset();
    delete process.env.AI_MONTHLY_BUDGET_USD;
  });

  it("lets calls through under the cap and records them", async () => {
    aggregate.mockResolvedValue({ _sum: { costUsd: 19.99 } });
    expect(await run()).toBe("ok");
    expect(create).toHaveBeenCalled();
  });

  it("stops calls at the cap ($20 by default) and alerts", async () => {
    aggregate.mockResolvedValue({ _sum: { costUsd: 20 } });
    const call = vi.fn();
    await expect(
      withLedger({ feature: "content" }, { provider: "gemini", model: "m" }, call, () => ({ provider: "gemini", model: "m", usage: { inputTokens: 0, outputTokens: 0 } })),
    ).rejects.toBeInstanceOf(AIBudgetExceededError);
    expect(call).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ source: "ai.budget" }));
  });

  it("uses AI_MONTHLY_BUDGET_USD when set", async () => {
    process.env.AI_MONTHLY_BUDGET_USD = "50";
    aggregate.mockResolvedValue({ _sum: { costUsd: 30 } });
    expect(await run()).toBe("ok");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { aggregate, create, logError } = vi.hoisted(() => ({ aggregate: vi.fn(), create: vi.fn(), logError: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { aiCall: { aggregate, create } } }));
vi.mock("@/lib/errors", () => ({ logError }));

import { AIBudgetExceededError, clearBudgetCache, COMPANY_ALLOWANCE_MESSAGE, CompanyBudgetExceededError } from "@/lib/ai/budget";
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

describe("monthly AI allowance per company", () => {
  // The platform total comes first (no businessId in the filter), then the company's own spend.
  const spend = (platform: number, company: number) =>
    aggregate.mockImplementation(async ({ where }: { where: { businessId?: string } }) => ({ _sum: { costUsd: where.businessId ? company : platform } }));
  const call = vi.fn(async () => "ok");
  const runFor = (businessId: string | null) =>
    withLedger({ feature: "content", businessId }, { provider: "gemini", model: "m" }, call, () => ({ provider: "gemini", model: "m", usage: { inputTokens: 0, outputTokens: 0 } }));

  beforeEach(() => {
    clearBudgetCache();
    for (const m of [aggregate, create, logError, call]) m.mockClear();
    delete process.env.AI_MONTHLY_BUDGET_USD;
    delete process.env.AI_COMPANY_MONTHLY_USD;
  });

  it("lets a company under $3 (the default) through", async () => {
    spend(5, 2.99);
    expect(await runFor("b1")).toBe("ok");
    expect(aggregate).toHaveBeenCalledWith({ where: { businessId: "b1", createdAt: { gte: expect.any(Date) } }, _sum: { costUsd: true } });
  });

  it("stops a company at its allowance with a message the owner can read, without calling or recording", async () => {
    spend(5, 3);
    const error = await runFor("b1").catch((e) => e);
    expect(error).toBeInstanceOf(CompanyBudgetExceededError);
    expect(error).toBeInstanceOf(AIBudgetExceededError); // everything that pauses on the platform cap pauses on this
    expect(error.message).toBe(COMPANY_ALLOWANCE_MESSAGE);
    expect(error.message).toMatch(/monthly AI allowance/);
    expect(call).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("uses AI_COMPANY_MONTHLY_USD, and leaves calls without a company to the platform cap", async () => {
    process.env.AI_COMPANY_MONTHLY_USD = "10";
    spend(5, 9);
    expect(await runFor("b1")).toBe("ok");
    spend(5, 1000);
    expect(await runFor(null)).toBe("ok");
  });
});

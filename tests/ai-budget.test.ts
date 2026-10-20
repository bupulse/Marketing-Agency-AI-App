import { beforeEach, describe, expect, it, vi } from "vitest";

const { aggregate, create, logError } = vi.hoisted(() => ({ aggregate: vi.fn(), create: vi.fn(), logError: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { aiCall: { aggregate, create } } }));
vi.mock("@/lib/errors", () => ({ logError }));

import { AIBudgetExceededError, clearBudgetCache, COMPANY_ALLOWANCE_MESSAGE, CompanyBudgetExceededError, companyCallAllowed, widgetAiShare, WidgetBudgetExceededError, clearAllowanceCache } from "@/lib/ai/budget";
import { withLedger } from "@/lib/ai/ledger";

const run = () =>
  withLedger(
    { feature: "content" },
    { provider: "gemini", model: "gemini-2.5-flash" },
    async () => "ok",
    () => ({ provider: "gemini", model: "gemini-2.5-flash", usage: { inputTokens: 10, outputTokens: 10 } }),
  );

// The plan allowance is cached for 30 s per company.
beforeEach(() => clearAllowanceCache());

describe("monthly AI budget", () => {
  beforeEach(() => {
    clearBudgetCache(); // the cap is cached for 30 s
    for (const m of [aggregate, create, logError]) m.mockReset();
    clearAllowanceCache();
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
  // The platform total comes first (no businessId in the filter), then the company's own spend and its website-chat part.
  const spend = (platform: number, company: number, widget = 0) =>
    aggregate.mockImplementation(async ({ where }: { where: { businessId?: string; feature?: string } }) => ({
      _sum: { costUsd: where.feature === "widget" ? widget : where.businessId ? company : platform },
    }));
  const call = vi.fn(async () => "ok");
  const runFor = (businessId: string | null, feature = "content") =>
    withLedger({ feature, businessId }, { provider: "gemini", model: "m" }, call, () => ({ provider: "gemini", model: "m", usage: { inputTokens: 0, outputTokens: 0 } }));

  beforeEach(() => {
    clearBudgetCache();
    for (const m of [aggregate, create, logError, call]) m.mockClear();
    delete process.env.AI_MONTHLY_BUDGET_USD;
    delete process.env.AI_COMPANY_MONTHLY_USD;
    delete process.env.WIDGET_AI_SHARE;
  });

  it("lets a company under $3 (the default) through", async () => {
    spend(5, 2.99);
    expect(await runFor("b1")).toBe("ok");
    // Video Studio calls are metered in video credits: left out of the allowance (lib/video-engine/ledger-features.ts).
    expect(aggregate).toHaveBeenCalledWith({ where: { businessId: "b1", createdAt: { gte: expect.any(Date) }, NOT: { feature: { startsWith: "video-" } } }, _sum: { costUsd: true } });
  });

  it("lets Video Studio calls through at the company's allowance (video credits meter them), never past the platform cap", async () => {
    spend(5, 3);
    expect(await runFor("b1", "video-design")).toBe("ok");
    spend(1_000_000, 0);
    await expect(runFor("b1", "video-seedance")).rejects.toBeInstanceOf(AIBudgetExceededError);
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

  it("gives the website chat at most half the allowance by default, then falls back to collecting details", async () => {
    spend(5, 1.49, 1.49);
    expect(await runFor("b1", "widget")).toBe("ok");
    spend(5, 1.5, 1.5);
    const error = await runFor("b1", "widget").catch((e) => e);
    expect(error).toBeInstanceOf(WidgetBudgetExceededError);
    expect(error).toBeInstanceOf(CompanyBudgetExceededError);
    // The owner still has their half.
    expect(await runFor("b1", "content")).toBe("ok");
  });

  it("never lets chat spend push the owner below their share, and stops the chat when the owner used the allowance", async () => {
    spend(5, 2.9, 1.6); // the chat ran 10 cents over its share on its last reply: not counted against the owner
    expect(await runFor("b1", "content")).toBe("ok");
    spend(5, 3.1, 1.6); // owner 1.50: that is their whole share
    await expect(runFor("b1", "content")).rejects.toBeInstanceOf(CompanyBudgetExceededError);
    spend(5, 3, 0); // owner used it all: the chat stops too
    await expect(runFor("b1", "widget")).rejects.toBeInstanceOf(WidgetBudgetExceededError);
  });

  it("reads WIDGET_AI_SHARE, clamped between 0 and 1", () => {
    expect(widgetAiShare()).toBe(0.5);
    process.env.WIDGET_AI_SHARE = "0.2";
    expect(widgetAiShare()).toBe(0.2);
    process.env.WIDGET_AI_SHARE = "7";
    expect(widgetAiShare()).toBe(1);
    process.env.WIDGET_AI_SHARE = "-1";
    expect(widgetAiShare()).toBe(0);
    process.env.WIDGET_AI_SHARE = "nope";
    expect(widgetAiShare()).toBe(0.5);
    const spendOf = (totalUsd: number, widgetUsd: number, widgetCapUsd: number) => ({ totalUsd, widgetUsd, ownerUsd: totalUsd - widgetUsd, allowanceUsd: 3, widgetCapUsd });
    expect(companyCallAllowed(spendOf(0, 0, 0), "widget")).toBe(false); // share 0: no chat replies
    expect(companyCallAllowed(spendOf(2.99, 2.99, 3), "widget")).toBe(true); // share 1: the chat may use it all
    expect(companyCallAllowed(spendOf(3, 3, 3), "content")).toBe(false);
  });
});

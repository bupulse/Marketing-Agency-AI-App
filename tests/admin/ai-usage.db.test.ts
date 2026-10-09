import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Real database: RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/admin/ai-usage.db.test.ts
// Writes AiCall rows in January 2026 (a month with no real data) for a throwaway user, and removes them afterwards.
const enabled = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL && process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
const supa = enabled ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

describe.skipIf(!enabled)("AI usage and services against the real database", { timeout: 60_000 }, () => {
  const userId = randomUUID();
  const email = `delivered+ai${userId.slice(0, 8)}@resend.dev`;
  let prisma: typeof import("@/lib/db").prisma;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const { error } = await supa!.auth.admin.createUser({ id: userId, email, email_confirm: true });
    if (error) throw error;
    await prisma.user.create({ data: { id: userId, email } });
    const row = (day: number, over: Record<string, unknown>) => ({ userId, feature: "content", provider: "gemini", model: "gemini-test", inputTokens: 100, outputTokens: 50, costUsd: 1, success: true, createdAt: new Date(Date.UTC(2026, 0, day, 12)), ...over });
    await prisma.aiCall.createMany({
      data: [row(2, {}), row(2, { costUsd: 2 }), row(3, { feature: "image", images: 1, costUsd: 0.5 }), row(5, { success: false, costUsd: 0, error: "Gemini 503 key=AIzaSyABCDEFGHIJKLMNOPQRSTUV" }), row(5, { provider: "claude", model: "claude-test", costUsd: 4 })] as never,
    });
  });

  afterAll(async () => {
    await prisma.aiCall.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await supa!.auth.admin.deleteUser(userId);
    await prisma.$disconnect();
  });

  it("totals, per day, per model, top spenders and failures for a past month", async () => {
    const { getAiUsage } = await import("@/lib/admin/ai-usage");
    const usage = await getAiUsage({ month: "2026-01", now: new Date("2026-10-09T00:00:00Z") });
    expect(usage.isCurrentMonth).toBe(false);
    expect(usage.spentUsd).toBe(7.5);
    expect(usage.calls).toBe(5);
    expect(usage.projectedUsd).toBe(7.5);
    expect(usage.perDay).toEqual([
      { date: "2026-01-02", costUsd: 3, calls: 2, failed: 0 },
      { date: "2026-01-03", costUsd: 0.5, calls: 1, failed: 0 },
      { date: "2026-01-05", costUsd: 4, calls: 2, failed: 1 },
    ]);
    expect(usage.perModel.map((m) => [m.model, m.costUsd, m.calls])).toEqual([["claude-test", 4, 1], ["gemini-test", 3.5, 4]]);
    expect(usage.perFeature.find((f) => f.feature === "image")).toMatchObject({ calls: 1, costUsd: 0.5 });
    expect(usage.topSpenders[0]).toMatchObject({ userId, email, calls: 5, costUsd: 7.5, percentOfSpend: 100 });
    expect(usage.failed.count).toBe(1);
    expect(usage.failed.percentOfCalls).toBe(20);
    expect(JSON.stringify(usage.failed)).not.toContain("AIzaSyABCDEFGHIJKLMNOPQRSTUV");
    expect(usage.cap.usd).toBeGreaterThan(0);
  });

  it("the kill switch, last check, usage counter and budget setting round-trip through the real tables", async () => {
    const svc = await import("@/lib/admin/services");
    const { setAiBudget, budgetInfo } = await import("@/lib/admin/ai-usage");
    const { consoleContext } = await import("@/lib/admin/types");
    const { isServiceEnabled, clearSwitchCache } = await import("@/lib/admin/switch");
    const { recordServiceUse } = await import("@/lib/admin/usage-counter");
    const ctx = consoleContext();
    try {
      await svc.setServiceEnabled(ctx, { service: "dropbox", enabled: false, reason: "db test" });
      clearSwitchCache();
      expect(await isServiceEnabled("dropbox")).toBe(false);
      const row = (await svc.listServices()).find((s) => s.id === "dropbox")!;
      expect(row).toMatchObject({ enabled: false, disabledReason: "db test", health: "off" });
      await recordServiceUse("resend", true, new Date("2026-01-02T00:00:00Z"));
      await recordServiceUse("resend", false, new Date("2026-01-02T00:00:00Z"));
      const usage = await prisma.serviceUsage.findUnique({ where: { service_day: { service: "resend", day: new Date("2026-01-02") } } });
      expect(usage).toMatchObject({ ok: 1, failed: 1 });
      const before = (await budgetInfo()).usd;
      await setAiBudget(ctx, { monthlyUsd: before + 5 });
      expect((await budgetInfo()).usd).toBe(before + 5);
      await setAiBudget(ctx, { monthlyUsd: null });
      expect((await budgetInfo()).usd).toBe(before);
    } finally {
      await svc.setServiceEnabled(ctx, { service: "dropbox", enabled: true });
      await prisma.serviceUsage.deleteMany({ where: { service: "resend", day: new Date("2026-01-02") } });
      await prisma.adminSetting.deleteMany({ where: { key: "ai.monthlyBudgetUsd" } });
      clearSwitchCache();
    }
    expect(await isServiceEnabled("dropbox")).toBe(true);
  });
});

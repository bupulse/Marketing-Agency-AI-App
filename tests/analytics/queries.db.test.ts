import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs the roll-up and the query layer against the real database, so it is skipped unless asked for:
//   RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/analytics/queries.db.test.ts
// It writes one Paddle payment, one refund and one monthly cost into September 2026 and removes them afterwards.
const enabled = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL);
const tag = randomUUID().slice(0, 8);
const day = "2026-09-15";

describe.skipIf(!enabled)("analytics queries against Postgres", { timeout: 120_000 }, () => {
  let prisma: typeof import("@/lib/db").prisma;
  let q: typeof import("@/lib/analytics/queries");
  let costs: typeof import("@/lib/analytics/costs");

  beforeAll(async () => {
    prisma = (await import("@/lib/db")).prisma;
    q = await import("@/lib/analytics/queries");
    costs = await import("@/lib/analytics/costs");
    const at = new Date(`${day}T12:00:00Z`);
    await prisma.billingEvent.createMany({
      data: [
        { provider: "PADDLE", eventId: `evt-${tag}-pay`, type: "transaction.completed", createdAt: at, payload: { event_type: "transaction.completed", data: { id: `txn-${tag}`, currency_code: "USD", details: { totals: { total: "10800", tax: "800" } } } } },
        { provider: "PADDLE", eventId: `evt-${tag}-ref`, type: "adjustment.updated", createdAt: at, payload: { event_type: "adjustment.updated", data: { id: `adj-${tag}`, action: "refund", status: "approved", currency_code: "USD", totals: { total: "2500", tax: "0" } } } },
        // the same refund arriving twice (created + updated) counts once
        { provider: "PADDLE", eventId: `evt-${tag}-ref2`, type: "adjustment.created", createdAt: at, payload: { event_type: "adjustment.created", data: { id: `adj-${tag}`, action: "refund", status: "approved", currency_code: "USD", totals: { total: "2500", tax: "0" } } } },
      ],
    });
    await costs.setMonthlyCost({ month: "2026-09", category: `zz-${tag}`, amountCents: 3000 });
  });

  afterAll(async () => {
    await prisma.billingEvent.deleteMany({ where: { eventId: { startsWith: `evt-${tag}` } } });
    await costs.deleteMonthlyCost("2026-09", `zz-${tag}`);
    await prisma.dailyMetric.deleteMany({ where: { date: new Date(`${day}T00:00:00Z`) } });
  });

  it("rolls a day up and reads revenue, costs and profit back", async () => {
    const { rollupDay } = await import("@/lib/analytics/rollup");
    expect(await rollupDay(day)).toBeGreaterThan(5);
    const range = { from: day, to: day };
    const revenue = await q.getRevenue(range);
    expect(revenue.grossCents).toBeGreaterThanOrEqual(10000);
    expect(revenue.refundsCents).toBeGreaterThanOrEqual(2500);
    const cost = await q.getCosts(range);
    expect(cost.byCategory.find((c) => c.category === `zz-${tag}`)?.cents).toBe(100); // 3000 / 30 days
    const profit = await q.getProfit(range);
    expect(profit.byMonth[0].month).toBe("2026-09");
    expect(profit.profitCents).toBeCloseTo(profit.revenueCents - profit.costCents, 1);
  });

  it("survives the same day being rolled up in parallel", async () => {
    const { rollupDay } = await import("@/lib/analytics/rollup");
    await Promise.all(Array.from({ length: 6 }, () => rollupDay(day)));
    const rows = await prisma.dailyMetric.count({ where: { date: new Date(`${day}T00:00:00Z`), key: "rolled" } });
    expect(rows).toBe(1);
    const [a, b, c] = await Promise.all([q.weeklyReport({ from: "2026-09-10", to: "2026-09-16" }), q.getOverview({ from: day, to: day }), q.getProfit({ from: day, to: day })]);
    expect(a.summary).toBeTruthy();
    expect(b.range.from).toBe(day);
    expect(c.byDay).toHaveLength(1);
  });

  it("answers the rest of the query layer", async () => {
    const range = { from: "2026-09-01", to: "2026-09-30" };
    const m = await q.getMetrics(range, ["visits", "profit_cents", "fixed_cost_cents"]);
    expect(m.profit_cents).toHaveLength(30);
    const funnel = await q.getFunnel(range);
    expect(funnel.steps.map((s) => s.key)).toEqual(["visitors", "signups", "onboarded", "generated", "scheduled", "paid"]);
    expect((await q.getOverview(range)).previous).toBeDefined();
    expect((await q.getTopContent(range)).topPosts).toBeInstanceOf(Array);
    const ww = await q.getWhatsWorking(range);
    expect(ww.featuresPaidVsChurned).toHaveLength(7);
    const report = await q.weeklyReport();
    expect(report.summary).toMatch(/visits/);
  });
});

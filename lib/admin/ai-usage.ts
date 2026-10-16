import "server-only";
import { prisma } from "@/lib/db";
import { isApproximatePrice } from "@/lib/ai/pricing";
import { BUDGET_MAX_USD, BUDGET_MIN_USD, BUDGET_SETTING_KEY, clearBudgetCache, effectiveBudgetUsd, monthlyBudgetUsd } from "@/lib/ai/budget";
import { writeAudit } from "./audit";
import { scrubSecrets } from "./scrub";
import { AdminError, type AdminContext } from "./types";
import { kigaliMonthOf, kigaliMonthRange } from "@/lib/time/kigali";

// AI spend against the monthly cap: per day, model, feature and client, failures and a month-end projection.
// Cost comes from the AiCall ledger (estimated from lib/ai/pricing.ts), the same table the cap itself is checked against.

const DAY_MS = 24 * 60 * 60 * 1000;
const num = (v: unknown) => Number(v ?? 0);
const round = (n: number, digits = 4) => Number(n.toFixed(digits));

export function monthBounds(month: string | undefined, now = new Date()) {
  // Kigali months (lib/time/kigali.ts), the same as the cap in lib/ai/budget.ts and the Money pages.
  const m = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : kigaliMonthOf(now);
  const { start, end } = kigaliMonthRange(m);
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  return { month: m, start, end, days, current: now >= start && now < end };
}

/**
 * Spend so far scaled to the whole month. At least a quarter of a day counts as elapsed, so the first minutes of a
 * month cannot produce a silly number. Past months project to what was actually spent.
 */
export function projectMonthEnd(spentUsd: number, b: { start: Date; days: number; current: boolean }, now = new Date()): number {
  if (!b.current) return spentUsd;
  const elapsedDays = Math.max(0.25, (now.getTime() - b.start.getTime()) / DAY_MS);
  return (spentUsd / elapsedDays) * b.days;
}

export type CapSource = "admin" | "env" | "default";

export async function budgetInfo() {
  const usd = await effectiveBudgetUsd();
  const row = await prisma.adminSetting.findUnique({ where: { key: BUDGET_SETTING_KEY } }).catch(() => null);
  const source: CapSource = row ? "admin" : process.env.AI_MONTHLY_BUDGET_USD ? "env" : "default";
  return { usd, source, envDefaultUsd: monthlyBudgetUsd(), minUsd: BUDGET_MIN_USD, maxUsd: BUDGET_MAX_USD };
}

export async function getAiUsage(opts: { month?: string; topLimit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const b = monthBounds(opts.month, now);
  const where = { createdAt: { gte: b.start, lt: b.end } };
  const top = Math.min(Math.max(Math.trunc(opts.topLimit ?? 10) || 10, 1), 50);

  const [estimatedCalls, cap, total, perDayRows, perModelRows, perFeatureRows, perUserRows, failedCount, failedByError, failedRecent] = await Promise.all([
    prisma.aiCall.count({ where: { ...where, estimated: true } }).catch(() => 0),
    budgetInfo(),
    prisma.aiCall.aggregate({ where, _sum: { costUsd: true }, _count: { _all: true } }),
    prisma.$queryRaw<{ day: Date; cost: unknown; calls: bigint; failed: bigint }[]>`
      SELECT ("createdAt" + interval '2 hours')::date AS day, COALESCE(SUM("costUsd"), 0) AS cost, COUNT(*) AS calls,
             COUNT(*) FILTER (WHERE NOT "success") AS failed
      FROM "AiCall" WHERE "createdAt" >= ${b.start} AND "createdAt" < ${b.end} GROUP BY 1 ORDER BY 1`,
    prisma.aiCall.groupBy({ by: ["provider", "model"], where, _sum: { costUsd: true, inputTokens: true, outputTokens: true, images: true }, _count: { _all: true }, orderBy: { _sum: { costUsd: "desc" } } }),
    prisma.aiCall.groupBy({ by: ["feature"], where, _sum: { costUsd: true }, _count: { _all: true }, orderBy: { _sum: { costUsd: "desc" } } }),
    prisma.aiCall.groupBy({ by: ["userId"], where: { ...where, userId: { not: null } }, _sum: { costUsd: true }, _count: { _all: true }, orderBy: { _sum: { costUsd: "desc" } }, take: top }),
    prisma.aiCall.count({ where: { ...where, success: false } }),
    prisma.aiCall.groupBy({ by: ["error"], where: { ...where, success: false }, _count: { _all: true }, orderBy: { _count: { error: "desc" } }, take: 5 }),
    prisma.aiCall.findMany({ where: { ...where, success: false }, orderBy: { createdAt: "desc" }, take: 10, select: { createdAt: true, provider: true, model: true, feature: true, error: true, userId: true } }),
  ]);

  const userIds = perUserRows.map((r) => r.userId).filter((v): v is string => Boolean(v));
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, business: { select: { name: true } } } }) : [];
  const userOf = new Map(users.map((u) => [u.id, u]));

  const spentUsd = num(total._sum.costUsd);
  const projectedUsd = projectMonthEnd(spentUsd, b, now);
  return {
    month: b.month,
    isCurrentMonth: b.current,
    cap,
    spentUsd: round(spentUsd),
    remainingUsd: round(Math.max(0, cap.usd - spentUsd)),
    percentUsed: round((spentUsd / cap.usd) * 100, 1),
    /** The cap is reached: every AI call is refused until next month or until the cap is raised. */
    paused: b.current && spentUsd >= cap.usd,
    projectedUsd: round(projectedUsd, 2),
    projectedOverCap: projectedUsd > cap.usd,
    calls: total._count._all,
    /** Calls that timed out on our side but were still billed: their usage is our estimate (docs/AI_COSTS.md). */
    estimatedCalls,
    perDay: perDayRows.map((r) => ({ date: new Date(r.day).toISOString().slice(0, 10), costUsd: round(num(r.cost)), calls: Number(r.calls), failed: Number(r.failed) })),
    perModel: perModelRows.map((r) => ({ provider: r.provider, model: r.model, approximatePrice: isApproximatePrice(r.model), calls: r._count._all, costUsd: round(num(r._sum.costUsd)), inputTokens: num(r._sum.inputTokens), outputTokens: num(r._sum.outputTokens), images: num(r._sum.images) })),
    perFeature: perFeatureRows.map((r) => ({ feature: r.feature, calls: r._count._all, costUsd: round(num(r._sum.costUsd)) })),
    topSpenders: perUserRows.map((r) => ({
      userId: r.userId as string,
      email: userOf.get(r.userId as string)?.email ?? null,
      business: userOf.get(r.userId as string)?.business?.name ?? null,
      calls: r._count._all,
      costUsd: round(num(r._sum.costUsd)),
      percentOfSpend: spentUsd > 0 ? round((num(r._sum.costUsd) / spentUsd) * 100, 1) : 0,
    })),
    failed: {
      count: failedCount,
      percentOfCalls: total._count._all > 0 ? round((failedCount / total._count._all) * 100, 1) : 0,
      topErrors: failedByError.map((r) => ({ error: scrubSecrets(r.error ?? "unknown", 160), count: r._count._all })),
      recent: failedRecent.map((r) => ({ at: r.createdAt.toISOString(), provider: r.provider, model: r.model, feature: r.feature, userId: r.userId, error: scrubSecrets(r.error ?? "unknown", 200) })),
    },
  };
}

/**
 * Changes the monthly AI cap (stored in AdminSetting; overrides AI_MONTHLY_BUDGET_USD). It applies within 30 seconds.
 * Lowering it below what is already spent pauses all AI at once. `monthlyUsd: null` goes back to the environment value.
 */
export async function setAiBudget(ctx: AdminContext, input: { monthlyUsd: number | null; confirm?: boolean }) {
  if (ctx.viaApi && input.confirm !== true) throw new AdminError("confirm_required", "Changing the AI budget changes how much BuPulse can spend. Send confirm: true to proceed.");
  const usd = input.monthlyUsd;
  if (usd !== null && (typeof usd !== "number" || !Number.isFinite(usd) || usd < BUDGET_MIN_USD || usd > BUDGET_MAX_USD)) {
    throw new AdminError("invalid", `monthlyUsd must be a number from ${BUDGET_MIN_USD} to ${BUDGET_MAX_USD}, or null to use the environment default.`);
  }
  const before = await budgetInfo();
  await prisma.$transaction(async (tx) => {
    if (usd === null) await tx.adminSetting.deleteMany({ where: { key: BUDGET_SETTING_KEY } });
    else await tx.adminSetting.upsert({ where: { key: BUDGET_SETTING_KEY }, create: { key: BUDGET_SETTING_KEY, value: usd }, update: { value: usd } });
    await writeAudit(tx, ctx, "set_ai_budget", "setting:ai.monthlyBudgetUsd", { monthlyUsd: before.usd, source: before.source }, { monthlyUsd: usd ?? before.envDefaultUsd, source: usd === null ? "env" : "admin" });
  });
  clearBudgetCache();
  const after = await budgetInfo();
  return { monthlyUsd: after.usd, source: after.source };
}

/** Month to date against the cap, in cents, for the Overview and sidebar. One cheap aggregate. */
export async function getAiBudgetStatus(now = new Date()): Promise<{ spentCents: number; capCents: number; pct: number; paused: boolean }> {
  const b = monthBounds(undefined, now);
  const [cap, total] = await Promise.all([effectiveBudgetUsd(), prisma.aiCall.aggregate({ where: { createdAt: { gte: b.start, lt: b.end } }, _sum: { costUsd: true } })]);
  const spent = num(total._sum.costUsd);
  return { spentCents: Math.round(spent * 100), capCents: Math.round(cap * 100), pct: Math.round((spent / cap) * 1000) / 10, paused: spent >= cap };
}

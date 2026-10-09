import "server-only";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { pruneRateLimits } from "@/lib/rate-limit";
import { purgeOldSalts } from "./salt";
import { utcDay } from "./collect";
import { EVENT_NAMES } from "./events";
import { getPriceTable } from "@/lib/plan-catalog";
import { addDays, churnPct, computeMrrCents, eachDay, parseMoneyEvent, round2 } from "./math";

type Row = { key: string; dimension: string; value: number };
const n = (v: unknown) => Number(v ?? 0);
const TOP = 20;

/** Page-view retention. */
export const PAGE_VIEW_DAYS = 90;
/** Product events are kept this many months. */
export const EVENT_MONTHS = 25;
/** How far back the first back-fill reaches. */
const BACKFILL_DAYS = 120;

/** Distinct users active (any product event or AI call) in the `days` days ending with `day`. */
async function activeUsers(end: Date, days: number): Promise<number> {
  const start = new Date(end.getTime() - days * 86_400_000);
  const rows = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(DISTINCT u)::bigint AS c FROM (
      SELECT "userId" AS u FROM "AnalyticsEvent" WHERE "userId" IS NOT NULL AND "createdAt" >= ${start} AND "createdAt" < ${end}
      UNION
      SELECT "userId" FROM "AiCall" WHERE "userId" IS NOT NULL AND "createdAt" >= ${start} AND "createdAt" < ${end}
    ) t`;
  return n(rows[0]?.c);
}

/** Computes every metric for one UTC day ("YYYY-MM-DD") from the raw tables. Safe to repeat: it replaces that day's rows. */
export async function rollupDay(day: string, now = new Date()): Promise<number> {
  const start = new Date(`${day}T00:00:00Z`);
  const end = new Date(start.getTime() + 86_400_000);
  const range = { gte: start, lt: end };
  const rows: Row[] = [];
  const add = (key: string, value: number, dimension = "") => rows.push({ key, dimension, value });

  // --- Traffic ---
  const [traffic] = await prisma.$queryRaw<{ visits: bigint; uv: bigint; sessions: bigint }[]>`
    SELECT COUNT(*)::bigint AS visits, COUNT(DISTINCT "visitorHash")::bigint AS uv,
           COUNT(DISTINCT COALESCE("sessionId", "visitorHash"))::bigint AS sessions
    FROM "PageView" WHERE "createdAt" >= ${start} AND "createdAt" < ${end}`;
  add("visits", n(traffic?.visits));
  add("unique_visitors", n(traffic?.uv));
  add("sessions", n(traffic?.sessions));
  const top = async (by: "path" | "source" | "utmCampaign" | "country" | "device", key: string) => {
    const groups = await prisma.pageView.groupBy({
      by: [by],
      where: { createdAt: range, ...(by === "utmCampaign" || by === "country" ? { [by]: { not: null } } : {}) },
      _count: { _all: true },
      orderBy: { _count: { [by]: "desc" } },
      take: TOP,
    });
    for (const g of groups) add(key, g._count._all, String(g[by] ?? ""));
  };
  await Promise.all([top("path", "top_page"), top("source", "source"), top("utmCampaign", "utm_campaign"), top("country", "country"), top("device", "device")]);

  // --- Sign-ups and onboarding (from the tables, so history back-fills) ---
  add("signups", await prisma.user.count({ where: { createdAt: range } }));
  add("trial_starts", await prisma.subscription.count({ where: { createdAt: range } }));
  add("onboarding_step", await prisma.business.count({ where: { onboardedAt: range } }), "complete");
  const steps = await prisma.$queryRaw<{ step: string | null; c: bigint }[]>`
    SELECT "props"->>'step' AS step, COUNT(DISTINCT "userId")::bigint AS c FROM "AnalyticsEvent"
    WHERE "name" = ${EVENT_NAMES.onboardingStep} AND "createdAt" >= ${start} AND "createdAt" < ${end} GROUP BY 1`;
  for (const s of steps) if (s.step) add("onboarding_step", n(s.c), s.step);

  // --- Paid starts and cancellations (events; the Paddle webhook writes them) ---
  add("paid_starts", await prisma.analyticsEvent.count({ where: { name: EVENT_NAMES.upgrade, createdAt: range } }));
  const cancellations = await prisma.analyticsEvent.count({ where: { name: EVENT_NAMES.cancel, createdAt: range } });
  add("cancellations", cancellations);

  // --- Active users ---
  add("dau", await activeUsers(end, 1));
  add("wau", await activeUsers(end, 7));
  add("mau", await activeUsers(end, 30));

  // --- Feature adoption: distinct businesses/users that used it that day ---
  const feature = async (name: string, sql: Prisma.Sql) => {
    const r = await prisma.$queryRaw<{ c: bigint }[]>(sql);
    add("feature_use", n(r[0]?.c), name);
  };
  await feature(EVENT_NAMES.textGenerated, Prisma.sql`SELECT COUNT(DISTINCT "businessId")::bigint c FROM "AiCall" WHERE "success" AND "feature" IN ('content','regenerate') AND "createdAt" >= ${start} AND "createdAt" < ${end}`);
  await feature(EVENT_NAMES.imageGenerated, Prisma.sql`SELECT COUNT(DISTINCT "businessId")::bigint c FROM "AiCall" WHERE "success" AND "feature" = 'image' AND "createdAt" >= ${start} AND "createdAt" < ${end}`);
  await feature(EVENT_NAMES.designCreated, Prisma.sql`SELECT COUNT(DISTINCT "businessId")::bigint c FROM "Design" WHERE "createdAt" >= ${start} AND "createdAt" < ${end}`);
  await feature(EVENT_NAMES.postScheduled, Prisma.sql`SELECT COUNT(DISTINCT "businessId")::bigint c FROM "Post" WHERE "source" = 'MANUAL' AND "status" <> 'DRAFT' AND "createdAt" >= ${start} AND "createdAt" < ${end}`);
  await feature(EVENT_NAMES.postPublished, Prisma.sql`SELECT COUNT(DISTINCT "businessId")::bigint c FROM "Post" WHERE "publishedAt" >= ${start} AND "publishedAt" < ${end}`);
  await feature(EVENT_NAMES.leadCaptured, Prisma.sql`SELECT COUNT(DISTINCT "businessId")::bigint c FROM "Lead" WHERE "createdAt" >= ${start} AND "createdAt" < ${end}`);

  // --- Revenue (Paddle webhooks, USD cents, tax excluded; one refund counted once per adjustment id) ---
  const billing = await prisma.billingEvent.findMany({
    where: { createdAt: range, type: { in: ["transaction.completed", "adjustment.created", "adjustment.updated"] } },
    select: { type: true, payload: true, createdAt: true, eventId: true },
  });
  let revenue = 0;
  let refunds = 0;
  const seen = new Set<string>();
  for (const e of billing) {
    const m = parseMoneyEvent(e.type, e.payload, e.createdAt);
    if (!m) continue;
    const id = `${m.kind}:${m.id || e.eventId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (m.kind === "payment") revenue += m.cents;
    else refunds += m.cents;
  }
  add("revenue_cents", revenue);
  add("refunds_cents", refunds);

  // --- AI cost (ledger) ---
  const [ai] = await prisma.$queryRaw<{ cost: Prisma.Decimal | null }[]>`
    SELECT COALESCE(SUM("costUsd"), 0) AS cost FROM "AiCall" WHERE "createdAt" >= ${start} AND "createdAt" < ${end}`;
  add("ai_cost_cents", round2(n(ai?.cost) * 100));

  // --- Subscription snapshot: only possible for "now", so only written for yesterday and today ---
  if (day >= utcDay(new Date(now.getTime() - 86_400_000))) {
    const groups = await prisma.subscription.groupBy({
      by: ["plan", "interval"],
      where: { plan: { not: "TRIAL" }, status: { in: ["ACTIVE", "PAST_DUE"] } },
      _count: { _all: true },
    });
    const list = groups.map((g) => ({ plan: g.plan, interval: g.interval, count: g._count._all }));
    const active = list.reduce((s, g) => s + g.count, 0);
    add("mrr_cents", computeMrrCents(list, await getPriceTable()));
    add("active_subscriptions", active);
    const churn = churnPct(cancellations, active);
    if (churn !== null) add("churn_rate", churn);
  }
  add("rolled", 1); // marker: this day has been computed

  // One writer per day: the cron and an admin/Jarvis read can roll the same day at the same moment.
  // Someone else already writing the same day (cron vs a read) is enough: skip instead of queueing behind them.
  await prisma.$transaction(
    async (tx) => {
      const [lock] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`analytics-rollup:${day}`})) AS ok`;
      if (!lock?.ok) return;
      await tx.dailyMetric.deleteMany({ where: { date: start } });
      await tx.dailyMetric.createMany({ data: rows.map((r) => ({ date: start, ...r })), skipDuplicates: true });
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
  return rows.length;
}

export type RollupResult = { days: string[]; rows: number; purgedPageViews: number; purgedEvents: number; nextCursor: string | null };

/** Days from the first data (at most BACKFILL_DAYS back) up to today that have no "rolled" marker. */
export async function missingDays(now = new Date()): Promise<string[]> {
  const today = utcDay(now);
  const floor = addDays(today, -BACKFILL_DAYS);
  const [first] = await prisma.$queryRaw<{ d: Date | null }[]>`
    SELECT LEAST(
      (SELECT MIN("createdAt") FROM "User"), (SELECT MIN("createdAt") FROM "PageView"), (SELECT MIN("createdAt") FROM "AiCall"),
      (SELECT MIN("createdAt") FROM "AnalyticsEvent")) AS d`;
  const from = first?.d ? utcDay(first.d) : today;
  const have = new Set(
    (await prisma.dailyMetric.findMany({ where: { key: "rolled", date: { gte: new Date(`${floor}T00:00:00Z`) } }, select: { date: true } })).map((r) => utcDay(r.date)),
  );
  return eachDay(from < floor ? floor : from, today).filter((d) => !have.has(d));
}

/**
 * The daily job: rolls up yesterday and today (today is partial and gets recomputed), back-fills up to
 * `perCall` missing days per call (call again while nextCursor is set), and purges old page views.
 */
export async function runDailyRollup(opts: { now?: Date; perCall?: number } = {}): Promise<RollupResult> {
  const now = opts.now ?? new Date();
  const perCall = opts.perCall ?? 6;
  const today = utcDay(now);
  const yesterday = addDays(today, -1);
  const missing = (await missingDays(now)).filter((d) => d !== today && d !== yesterday);
  const days = [...new Set([...missing.slice(0, perCall), yesterday, today])].sort();
  let rows = 0;
  for (const d of days) rows += await rollupDay(d, now);
  const cutoff = new Date(now.getTime() - PAGE_VIEW_DAYS * 86_400_000);
  const purged = await prisma.pageView.deleteMany({ where: { createdAt: { lt: cutoff } } });
  const eventCutoff = new Date(now);
  eventCutoff.setUTCMonth(eventCutoff.getUTCMonth() - EVENT_MONTHS);
  const purgedEvents = await prisma.analyticsEvent.deleteMany({ where: { createdAt: { lt: eventCutoff } } });
  await purgeOldSalts(now).catch((error) => console.error("[analytics] purgeOldSalts failed:", error instanceof Error ? error.message : error));
  await pruneRateLimits().catch((error) => console.error("[analytics] pruneRateLimits failed:", error instanceof Error ? error.message : error));
  return { days, rows, purgedPageViews: purged.count, purgedEvents: purgedEvents.count, nextCursor: missing.length > perCall ? "backfill" : null };
}

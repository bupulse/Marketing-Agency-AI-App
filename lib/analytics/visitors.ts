import "server-only";
// Visitor analytics for the support app (app/support/(app)/analytics) and the "old method" notes in Admin
// (docs/SUPPORT_DASHBOARD.md, "Visitor analytics"). One counting method everywhere: visitor and view totals come from the
// daily roll-up (lib/analytics/rollup.ts, the same numbers as Admin), the breakdowns from the raw page views, which are
// kept PAGE_VIEW_DAYS days. Every range is whole UTC days, like the visitor hash.
import { prisma } from "@/lib/db";
import { liveVisitors } from "@/lib/support/live";
import { addDays } from "./math";
import { getMetrics } from "./queries";
import { PAGE_VIEW_DAYS } from "./rollup";
import { dayMethod, funnelSteps, groupSeries, lastOldMethodDay, previousRange, type DayMethod, type DayPoint, type FunnelStepView, type Grouping, type SeriesPoint } from "./visitors-shared";
import type { DateRange } from "./types";

const TOP = 25;
const n = (v: unknown) => Number(v ?? 0);

export type Ranked = { key: string; visitors: number; views: number };
export type CityRow = { city: string; country: string | null; visitors: number; views: number };
export type PageRow = { path: string; views: number; visitors: number; avgMs: number | null; timedViews: number };

export type VisitorAnalytics = {
  range: DateRange;
  by: Grouping;
  totals: { visitors: number; views: number; avgMs: number | null; visitorsWithCity: number; rawVisitors: number };
  series: SeriesPoint[];
  /** The last day counted the old way (one visitor per browser), or null. */
  lastOldDay: string | null;
  /** The first day the breakdowns cover, when the period starts before the raw page views kept; null when they cover it all. */
  breakdownFrom: string | null;
  countries: Ranked[];
  cities: CityRow[];
  sources: Ranked[];
  pages: PageRow[];
  funnel: FunnelStepView[];
  /** Visitors by device ("mobile", "tablet", "desktop"), from the raw page views like the other breakdowns. */
  devices: Ranked[];
  /** The same number of days just before the period (from the roll-up), for the comparisons; null when it could not be read. */
  previous: { from: string; to: string; visitors: number; views: number } | null;
  /** People on the site right now (the Live visitors page's number), or null when it could not be read. */
  liveNow: number | null;
};

/** Daily visitors, views and counting method of each day of the range, from the roll-up. */
export async function visitorDays(range: DateRange): Promise<(DayPoint & { method: DayMethod })[]> {
  const m = await getMetrics(range, ["visits", "unique_visitors", "visits_v2"]);
  const pick = (key: string) => new Map((m[key] ?? []).filter((p) => p.dimension === "").map((p) => [p.date, p.value]));
  const visits = pick("visits");
  const visitors = pick("unique_visitors");
  const v2 = pick("visits_v2");
  return [...visits.keys()].sort().map((date) => ({ date, visitors: visitors.get(date) ?? 0, views: visits.get(date) ?? 0, method: dayMethod(visits.get(date) ?? 0, v2.get(date)) }));
}

/** The last day of the range counted the old way, for the notes in Admin. Null on any trouble (the note is a hint). */
export async function lastOldMethodDayIn(range: DateRange): Promise<string | null> {
  try {
    return lastOldMethodDay(await visitorDays(range));
  } catch {
    return null;
  }
}

export async function getVisitorAnalytics(period: DateRange & { by: Grouping }, now = new Date()): Promise<VisitorAnalytics> {
  const prev = previousRange(period.from, period.to);
  const [days, prevDays] = await Promise.all([
    visitorDays({ from: period.from, to: period.to }),
    visitorDays({ from: prev.from, to: prev.to }).catch(() => null),
  ]);
  const start = new Date(`${period.from}T00:00:00Z`);
  const end = new Date(`${addDays(period.to, 1)}T00:00:00Z`);
  const keptFrom = new Date(now.getTime() - PAGE_VIEW_DAYS * 86_400_000);
  const rawStart = start < keptFrom ? keptFrom : start;
  const range = { gte: start, lt: end };

  const [summary, countries, cities, sources, pages, devices, quotes, chats, signups, paid, live] = await Promise.all([
    prisma.$queryRaw<{ visitors: bigint; with_city: bigint; avg_ms: number | null }[]>`
      SELECT COUNT(DISTINCT "visitorHash")::bigint AS visitors,
             COUNT(DISTINCT "visitorHash") FILTER (WHERE "city" IS NOT NULL)::bigint AS with_city,
             AVG("durationMs")::float8 AS avg_ms
      FROM "PageView" WHERE "createdAt" >= ${rawStart} AND "createdAt" < ${end}`,
    prisma.$queryRaw<{ key: string | null; visitors: bigint; views: bigint }[]>`
      SELECT "country" AS key, COUNT(DISTINCT "visitorHash")::bigint AS visitors, COUNT(*)::bigint AS views
      FROM "PageView" WHERE "createdAt" >= ${rawStart} AND "createdAt" < ${end}
      GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT ${TOP}`,
    prisma.$queryRaw<{ city: string; country: string | null; visitors: bigint; views: bigint }[]>`
      SELECT "city", "country", COUNT(DISTINCT "visitorHash")::bigint AS visitors, COUNT(*)::bigint AS views
      FROM "PageView" WHERE "createdAt" >= ${rawStart} AND "createdAt" < ${end} AND "city" IS NOT NULL
      GROUP BY 1, 2 ORDER BY 3 DESC, 4 DESC LIMIT ${TOP}`,
    // Where each visitor came from: the source of their first page that day. Later pages of a visit mostly look
    // "direct" (the referrer is our own site), so counting every view would hide Google, Facebook and the rest.
    prisma.$queryRaw<{ key: string; visitors: bigint; views: bigint }[]>`
      WITH firsts AS (
        SELECT DISTINCT ON ("visitorHash") "visitorHash", "source"
        FROM "PageView" WHERE "createdAt" >= ${rawStart} AND "createdAt" < ${end}
        ORDER BY "visitorHash", "createdAt" ASC
      ), views AS (
        SELECT "visitorHash", COUNT(*)::bigint AS c FROM "PageView" WHERE "createdAt" >= ${rawStart} AND "createdAt" < ${end} GROUP BY 1
      )
      SELECT f."source" AS key, COUNT(*)::bigint AS visitors, COALESCE(SUM(v.c), 0)::bigint AS views
      FROM firsts f JOIN views v ON v."visitorHash" = f."visitorHash"
      GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT ${TOP}`,
    prisma.$queryRaw<{ path: string; views: bigint; visitors: bigint; avg_ms: number | null; timed: bigint }[]>`
      SELECT "path", COUNT(*)::bigint AS views, COUNT(DISTINCT "visitorHash")::bigint AS visitors,
             AVG("durationMs")::float8 AS avg_ms, COUNT("durationMs")::bigint AS timed
      FROM "PageView" WHERE "createdAt" >= ${rawStart} AND "createdAt" < ${end}
      GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT ${TOP}`,
    prisma.$queryRaw<{ key: string; visitors: bigint; views: bigint }[]>`
      SELECT "device" AS key, COUNT(DISTINCT "visitorHash")::bigint AS visitors, COUNT(*)::bigint AS views
      FROM "PageView" WHERE "createdAt" >= ${rawStart} AND "createdAt" < ${end}
      GROUP BY 1 ORDER BY 2 DESC, 3 DESC`,
    prisma.contactRequest.count({ where: { kind: "quote", createdAt: range } }),
    // Chats started on the public website (not clients chatting from their dashboard).
    prisma.supportConversation.count({ where: { surface: "public", createdAt: range } }),
    prisma.user.count({ where: { createdAt: range } }),
    // Paid starts: the "upgrade" event the Paddle webhook and a confirmed Mobile Money payment both write
    // (lib/analytics/math.ts subscriptionEventsFor), once per company.
    prisma.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(DISTINCT COALESCE("userId"::text, "id"))::bigint AS c FROM "AnalyticsEvent"
      WHERE "name" = 'upgrade' AND "createdAt" >= ${start} AND "createdAt" < ${end}`,
    liveVisitors(now).then((r) => r.items.length).catch(() => null),
  ]);

  const visitors = days.reduce((s, d) => s + d.visitors, 0);
  const views = days.reduce((s, d) => s + d.views, 0);
  const s = summary[0];
  return {
    range: { from: period.from, to: period.to },
    by: period.by,
    totals: { visitors, views, avgMs: s?.avg_ms == null ? null : Number(s.avg_ms), visitorsWithCity: n(s?.with_city), rawVisitors: n(s?.visitors) },
    series: groupSeries(days, period.from, period.to, period.by),
    lastOldDay: lastOldMethodDay(days),
    breakdownFrom: rawStart > start ? rawStart.toISOString().slice(0, 10) : null,
    countries: countries.map((r) => ({ key: r.key ?? "", visitors: n(r.visitors), views: n(r.views) })),
    cities: cities.map((r) => ({ city: r.city, country: r.country, visitors: n(r.visitors), views: n(r.views) })),
    sources: sources.map((r) => ({ key: r.key, visitors: n(r.visitors), views: n(r.views) })),
    pages: pages.map((r) => ({ path: r.path, views: n(r.views), visitors: n(r.visitors), avgMs: r.avg_ms == null ? null : Math.round(Number(r.avg_ms)), timedViews: n(r.timed) })),
    funnel: funnelSteps({ visitors, quotes, chats, signups, paid: n(paid[0]?.c) }),
    devices: devices.map((r) => ({ key: r.key, visitors: n(r.visitors), views: n(r.views) })),
    previous: prevDays && { from: prev.from, to: prev.to, visitors: prevDays.reduce((t, d) => t + d.visitors, 0), views: prevDays.reduce((t, d) => t + d.views, 0) },
    liveNow: live,
  };
}

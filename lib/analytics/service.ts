import "server-only";
import { prisma } from "@/lib/db";
import { signPaths } from "@/lib/publishing/media";
import { NETWORKS } from "@/lib/social/types";
import { createClient } from "@/lib/supabase/server";
import { bestPosts, byNetwork, changePct, computeTips, splitPeriods, startOfLocalDay, topPages, totalsOf, trend, periodKeys, addDays, type PostRow, type RangeDays } from "./compute";

/** Safety cap: two periods of the longest range, for a busy business. */
const MAX_POSTS = 3000;
/** Distinct page addresses read for the "top pages" list; counts themselves come from SQL. */
const MAX_PAGES = 200;

export type ClientAnalytics = Awaited<ReturnType<typeof loadClientAnalytics>>;

/**
 * Everything the Analytics page shows for one business. Every query is filtered by `businessId`.
 * "Previous period" is the same number of days directly before the chosen range.
 * Metrics are counted on the day the post was published, using each post's newest snapshot.
 */
export async function loadClientAnalytics(businessId: string, days: RangeDays, now = new Date()) {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } });
  const timeZone = business?.timezone || "UTC";
  // Periods are whole local calendar days in the business's time zone.
  const firstKey = periodKeys(now, days, timeZone)[0];
  const since = startOfLocalDay(firstKey, timeZone);
  const prevSince = startOfLocalDay(addDays(firstKey, -days), timeZone);
  const leadRange = { gte: since, lte: now };

  const [connections, rows, reminderPosts, chats, chatsPrev, leadsNow, leadsPrev, pageGroups] = await Promise.all([
    prisma.connection.findMany({ where: { businessId, kind: "SOCIAL" }, select: { provider: true, postingMode: true, status: true } }),
    prisma.post.findMany({
      where: { businessId, status: "PUBLISHED", publishedAt: { gte: prevSince, lte: now } },
      orderBy: { publishedAt: "desc" },
      take: MAX_POSTS,
      select: {
        id: true,
        network: true,
        format: true,
        publishedAt: true,
        mediaPaths: true,
        permalink: true,
        text: true,
        connection: { select: { postingMode: true } },
        metrics: { orderBy: { capturedAt: "desc" }, take: 1, select: { views: true, reach: true, likes: true, comments: true, saves: true, shares: true } },
      },
    }),
    prisma.post.count({ where: { businessId, status: { in: ["NEEDS_ACTION", "PUBLISHED"] }, scheduledAt: { gte: since, lte: now }, connection: { postingMode: "NOTIFY" } } }),
    prisma.chatSession.count({ where: { businessId, createdAt: { gte: since, lte: now } } }),
    prisma.chatSession.count({ where: { businessId, createdAt: { gte: prevSince, lt: since } } }),
    prisma.lead.count({ where: { businessId, createdAt: leadRange } }),
    prisma.lead.count({ where: { businessId, createdAt: { gte: prevSince, lt: since } } }),
    prisma.lead.groupBy({ by: ["pageUrl"], where: { businessId, createdAt: leadRange, pageUrl: { not: null } }, _count: { _all: true }, orderBy: { _count: { pageUrl: "desc" } }, take: MAX_PAGES }),
  ]);

  const all: PostRow[] = rows.flatMap((r) =>
    r.publishedAt
      ? [{ id: r.id, network: r.network, format: r.format, publishedAt: r.publishedAt, reminderOnly: r.connection?.postingMode === "NOTIFY", mediaPaths: r.mediaPaths, permalink: r.permalink, text: r.text, metrics: r.metrics[0] ?? null }]
      : [],
  );
  const { current, previous } = splitPeriods(all, days, now, timeZone);

  const cur = totalsOf(current);
  const prev = totalsOf(previous);
  const pages = topPages(pageGroups.map((g) => ({ url: g.pageUrl, count: g._count._all })));

  const best = bestPosts(current, 5);
  let thumbs = new Map<string, string>();
  const firstPaths = best.flatMap((b) => b.post.mediaPaths.slice(0, 1));
  if (firstPaths.length > 0) {
    try {
      thumbs = await signPaths(await createClient(), firstPaths, 2 * 60 * 60);
    } catch {
      // Cards without thumbnails are better than no page.
    }
  }

  const connected = connections.filter((c) => c.status !== "REVOKED");
  return {
    days,
    timeZone,
    hasChannels: connections.length > 0,
    reminderOnlyChannels: connections.length > 0 && connections.every((c) => c.postingMode === "NOTIFY"),
    reminderPosts,
    connectedNetworks: [...new Set(connected.map((c) => c.provider))],
    /** Published posts in range that have not had a metrics snapshot yet (and are not reminder-only). */
    awaitingMetrics: current.filter((p) => !p.metrics && !p.reminderOnly).length,
    cards: {
      posts: { value: cur.posts, change: changePct(cur.posts, prev.posts) },
      reach: { value: cur.reach, change: changePct(cur.reach, prev.reach) },
      engagement: { value: cur.engagement, change: changePct(cur.engagement, prev.engagement) },
      rate: { value: cur.rate, change: cur.rate !== null && prev.rate !== null ? changePct(cur.rate, prev.rate) : null },
      chats: { value: chats, change: changePct(chats, chatsPrev) },
      leads: { value: leadsNow, change: changePct(leadsNow, leadsPrev) },
    },
    measured: cur.measured,
    networks: byNetwork(current, NETWORKS),
    best: best.map((b) => ({
      id: b.post.id,
      network: b.post.network,
      publishedAt: b.post.publishedAt.toISOString(),
      text: b.post.text.slice(0, 120),
      permalink: b.post.permalink,
      thumb: thumbs.get(b.post.mediaPaths[0] ?? "") ?? null,
      reach: b.reach,
      engagement: b.engagement,
      rate: b.rate,
    })),
    trend: trend(current, days, days === 90 ? 7 : 1, now, timeZone),
    trendUnit: (days === 90 ? "week" : "day") as "week" | "day",
    chat: { conversations: chats, leads: leadsNow, conversion: chats > 0 ? leadsNow / chats : null, pages },
    tips: computeTips(current, pages, leadsNow, timeZone),
  };
}

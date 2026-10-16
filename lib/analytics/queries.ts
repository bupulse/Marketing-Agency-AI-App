import "server-only";
// The analytics query layer used by the /admin console and the Jarvis REST/MCP tools. All ranges are inclusive UTC days.
import { prisma } from "@/lib/db";
import { utcDay } from "./collect";
import { getPriceTable } from "@/lib/plan-catalog";
import { addDays, computeMrrCents, conversionPct, eachDay, fixedCostForDay, pct, profitCents, round2 } from "./math";
import { rollupDay } from "./rollup";
import { getMonthCosts } from "@/lib/money/costs";
import { monthAdjustments, type MonthCosts } from "@/lib/money/costs-shared";
import type {
  Costs, DateRange, Funnel, FunnelStep, MetricKey, MetricPoint, Overview, Profit, Ranked, Revenue, TopContent, WeeklyReport, WhatsWorking,
} from "./types";

export { METRIC_KEYS } from "./types";
export type * from "./types";

const MAX_RANGE_DAYS = 400;
const n = (v: unknown) => Number(v ?? 0);

/** Validates and clamps a range: "YYYY-MM-DD" both ends, from <= to, at most 400 days, never in the future. */
export function normalizeRange(range: DateRange, now = new Date()): DateRange {
  const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
  if (!ok(range.from) || !ok(range.to)) throw new Error("Dates must look like 2026-10-08");
  const today = utcDay(now);
  const to = range.to > today ? today : range.to;
  let from = range.from > to ? to : range.from;
  const min = addDays(to, -(MAX_RANGE_DAYS - 1));
  if (from < min) from = min;
  return { from, to };
}

const previousRange = (r: DateRange): DateRange => {
  const len = eachDay(r.from, r.to).length;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
};

/**
 * Reads never back-fill (the daily cron does that). They only keep the newest numbers fresh: today is recomputed when its
 * last roll-up is over a minute old, and yesterday is rolled once if the cron missed it.
 */
async function ensureRolled(range: DateRange, now = new Date()) {
  const today = utcDay(now);
  const yesterday = addDays(today, -1);
  const todo: string[] = [];
  const rows = await prisma.dailyMetric.findMany({
    where: { key: "rolled", date: { in: [new Date(`${yesterday}T00:00:00Z`), new Date(`${today}T00:00:00Z`)] } },
    select: { date: true, updatedAt: true },
  });
  const at = new Map(rows.map((r) => [utcDay(r.date), r.updatedAt]));
  if (range.to >= yesterday && range.from <= yesterday && !at.has(yesterday)) todo.push(yesterday);
  if (range.to === today && (!at.has(today) || now.getTime() - at.get(today)!.getTime() > 60_000)) todo.push(today);
  for (const d of todo) {
    // Best effort: a slow or failing refresh must not break a read; serve what is already rolled up.
    await rollupDay(d, now).catch((error) => console.error(`[analytics] refresh of ${d} failed:`, error instanceof Error ? error.message : error));
  }
}

type KeyedPoint = MetricPoint & { key: string };

async function series(range: DateRange, keys: string[]): Promise<KeyedPoint[]> {
  const rows = await prisma.dailyMetric.findMany({
    where: { key: { in: keys }, date: { gte: new Date(`${range.from}T00:00:00Z`), lte: new Date(`${range.to}T00:00:00Z`) } },
    orderBy: [{ date: "asc" }],
    select: { date: true, key: true, dimension: true, value: true },
  });
  return rows.map((r) => ({ key: r.key, date: utcDay(r.date), dimension: r.dimension, value: r.value }));
}
const sum = (points: KeyedPoint[], key: string) => points.filter((p) => p.key === key).reduce((s, p) => s + p.value, 0);
const byDimension = (points: KeyedPoint[], key: string) => {
  const m = new Map<string, number>();
  for (const p of points) if (p.key === key) m.set(p.dimension, (m.get(p.dimension) ?? 0) + p.value);
  return m;
};

/**
 * Costs besides the AI ledger, spread over the days of their month (fractions of a cent kept): the monthly costs entered
 * by the owner, recurring costs (hosting, the domain...) and, for a provider whose real bill was entered, the bill
 * minus the ledger's estimate (lib/money/costs-shared.ts), so these numbers match Admin -> Money.
 */
async function fixedCosts(range: DateRange) {
  const months = [...new Set(eachDay(range.from, range.to).map((d) => d.slice(0, 7)))].sort();
  const [costs, report] = await Promise.all([
    prisma.monthlyCost.findMany({ where: { month: { in: months } }, select: { month: true, category: true, amountCents: true } }),
    getMonthCosts(months[0], months[months.length - 1]).catch(() => ({ months: [] as MonthCosts[] })),
  ]);
  const adjustments: { month: string; category: string; amountCents: number }[] = [];
  for (const m of report.months) {
    const a = monthAdjustments(m);
    if (a.recurringCents) adjustments.push({ month: m.month, category: "recurring", amountCents: a.recurringCents });
    if (a.billDeltaCents) adjustments.push({ month: m.month, category: "ai bills vs estimate", amountCents: a.billDeltaCents });
  }
  return (day: string) => fixedCostForDay(day, [...costs, ...adjustments]);
}

async function latestSnapshot(key: string, to: string): Promise<number> {
  const row = await prisma.dailyMetric.findFirst({ where: { key, date: { lte: new Date(`${to}T00:00:00Z`) } }, orderBy: { date: "desc" }, select: { value: true } });
  return row?.value ?? 0;
}

// ---------------------------------------------------------------------------------------------------------------------

export async function getMetrics(range: DateRange, keys: MetricKey[]): Promise<Record<string, MetricPoint[]>> {
  const r = normalizeRange(range);
  await ensureRolled(r);
  const out: Record<string, MetricPoint[]> = Object.fromEntries(keys.map((k) => [k, []]));
  const computed = new Set<string>(["fixed_cost_cents", "profit_cents"]);
  for (const p of await series(r, keys.filter((k) => !computed.has(k)))) out[p.key].push({ date: p.date, dimension: p.dimension, value: p.value });
  if (keys.some((k) => computed.has(k))) {
    const fixed = await fixedCosts(r);
    const all = await series(r, ["revenue_cents", "refunds_cents", "ai_cost_cents"]);
    for (const date of eachDay(r.from, r.to)) {
      const day = all.filter((p) => p.date === date);
      const f = fixed(date).total;
      if (keys.includes("fixed_cost_cents")) out.fixed_cost_cents.push({ date, dimension: "", value: round2(f) });
      if (keys.includes("profit_cents")) out.profit_cents.push({ date, dimension: "", value: profitCents(sum(day, "revenue_cents"), sum(day, "refunds_cents"), sum(day, "ai_cost_cents"), f) });
    }
  }
  return out;
}

export async function getProfit(range: DateRange, opts: { rolled?: boolean } = {}): Promise<Profit> {
  const r = normalizeRange(range);
  if (!opts.rolled) await ensureRolled(r);
  const fixed = await fixedCosts(r);
  const pts = await series(r, ["revenue_cents", "refunds_cents", "ai_cost_cents"]);
  const byDay = eachDay(r.from, r.to).map((date) => {
    const day = pts.filter((p) => p.date === date);
    const revenueCents = sum(day, "revenue_cents") - sum(day, "refunds_cents");
    const costCents = sum(day, "ai_cost_cents") + fixed(date).total;
    return { date, revenueCents: round2(revenueCents), costCents: round2(costCents), profitCents: round2(revenueCents - costCents) };
  });
  const months = new Map<string, { revenueCents: number; costCents: number }>();
  for (const d of byDay) {
    const m = months.get(d.date.slice(0, 7)) ?? { revenueCents: 0, costCents: 0 };
    m.revenueCents += d.revenueCents;
    m.costCents += d.costCents;
    months.set(d.date.slice(0, 7), m);
  }
  const revenueCents = round2(byDay.reduce((s, d) => s + d.revenueCents, 0));
  const costCents = round2(byDay.reduce((s, d) => s + d.costCents, 0));
  return {
    range: r,
    revenueCents,
    costCents,
    profitCents: round2(revenueCents - costCents),
    byDay,
    byMonth: [...months].map(([month, m]) => ({ month, revenueCents: round2(m.revenueCents), costCents: round2(m.costCents), profitCents: round2(m.revenueCents - m.costCents) })),
  };
}

export async function getCosts(range: DateRange): Promise<Costs> {
  const r = normalizeRange(range);
  await ensureRolled(r);
  const fixed = await fixedCosts(r);
  const pts = await series(r, ["ai_cost_cents"]);
  const cat = new Map<string, number>();
  const byDay = eachDay(r.from, r.to).map((date) => {
    const aiCents = sum(pts.filter((p) => p.date === date), "ai_cost_cents");
    const f = fixed(date);
    for (const [c, v] of Object.entries(f.byCategory)) cat.set(c, (cat.get(c) ?? 0) + v);
    return { date, aiCents: round2(aiCents), fixedCents: round2(f.total), totalCents: round2(aiCents + f.total) };
  });
  const aiCents = round2(byDay.reduce((s, d) => s + d.aiCents, 0));
  return {
    range: r,
    aiCents,
    totalCents: round2(byDay.reduce((s, d) => s + d.totalCents, 0)),
    byCategory: [{ category: "ai", cents: aiCents }, ...[...cat].map(([category, cents]) => ({ category, cents: round2(cents) }))],
    byDay,
  };
}

export async function getRevenue(range: DateRange): Promise<Revenue> {
  const r = normalizeRange(range);
  await ensureRolled(r);
  const pts = await series(r, ["revenue_cents", "refunds_cents"]);
  const byDay = eachDay(r.from, r.to).map((date) => {
    const day = pts.filter((p) => p.date === date);
    const grossCents = sum(day, "revenue_cents");
    const refundsCents = sum(day, "refunds_cents");
    return { date, grossCents, refundsCents, netCents: grossCents - refundsCents };
  });
  const groups = await prisma.subscription.groupBy({
    by: ["plan", "interval"],
    where: { plan: { not: "TRIAL" }, status: { in: ["ACTIVE", "PAST_DUE"] } },
    _count: { _all: true },
  });
  const prices = await getPriceTable();
  const byPlan = groups.map((g) => ({ plan: g.plan, interval: g.interval, subscribers: g._count._all, mrrCents: computeMrrCents([{ plan: g.plan, interval: g.interval, count: g._count._all }], prices) }));
  const grossCents = byDay.reduce((s, d) => s + d.grossCents, 0);
  const refundsCents = byDay.reduce((s, d) => s + d.refundsCents, 0);
  return { range: r, grossCents, refundsCents, netCents: grossCents - refundsCents, mrrCents: byPlan.reduce((s, p) => s + p.mrrCents, 0), byPlan, byDay };
}

export async function getOverview(range: DateRange): Promise<Overview> {
  const r = normalizeRange(range);
  const prev = previousRange(r);
  await ensureRolled(r);
  await ensureRolled(prev);
  const rolled = { rolled: true };
  const pts = await series(r, ["visits", "unique_visitors", "sessions", "signups", "trial_starts", "paid_starts", "cancellations", "dau", "wau", "mau"]);
  const prevPts = await series(prev, ["visits", "unique_visitors", "signups", "paid_starts"]);
  const [profit, prevProfit] = await Promise.all([getProfit(r, rolled), getProfit(prev, rolled)]);
  const last = (key: string) => pts.filter((p) => p.key === key && p.date === r.to).reduce((s, p) => s + p.value, 0);
  const activeSubscriptions = Math.round(await latestSnapshot("active_subscriptions", r.to));
  const trialStarts = sum(pts, "trial_starts");
  const paidStarts = sum(pts, "paid_starts");
  const cancellations = sum(pts, "cancellations");
  return {
    range: r,
    visits: sum(pts, "visits"),
    uniqueVisitors: sum(pts, "unique_visitors"),
    sessions: sum(pts, "sessions"),
    signups: sum(pts, "signups"),
    trialStarts,
    paidStarts,
    trialToPaidPct: conversionPct(paidStarts, trialStarts),
    mrrCents: await latestSnapshot("mrr_cents", r.to),
    activeSubscriptions,
    cancellations,
    churnPct: pct(cancellations, cancellations + activeSubscriptions),
    dau: last("dau"),
    wau: last("wau"),
    mau: last("mau"),
    revenueCents: profit.revenueCents,
    costCents: profit.costCents,
    profitCents: profit.profitCents,
    previous: {
      visits: sum(prevPts, "visits"),
      uniqueVisitors: sum(prevPts, "unique_visitors"),
      signups: sum(prevPts, "signups"),
      paidStarts: sum(prevPts, "paid_starts"),
      revenueCents: prevProfit.revenueCents,
      costCents: prevProfit.costCents,
      profitCents: prevProfit.profitCents,
    },
  };
}

/** Visit -> sign-up -> onboarded -> first generation -> first scheduled post -> paying, for people who signed up in the range. */
export async function getFunnel(range: DateRange, opts: { rolled?: boolean } = {}): Promise<Funnel> {
  const r = normalizeRange(range);
  if (!opts.rolled) await ensureRolled(r);
  const start = new Date(`${r.from}T00:00:00Z`);
  const end = new Date(`${addDays(r.to, 1)}T00:00:00Z`);
  const visitors = sum(await series(r, ["unique_visitors"]), "unique_visitors");
  const [c] = await prisma.$queryRaw<Record<string, bigint>[]>`
    SELECT COUNT(*)::bigint AS signups,
      COUNT(*) FILTER (WHERE b."onboardedAt" IS NOT NULL)::bigint AS onboarded,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "AiCall" a WHERE a."userId" = u."id" AND a."success" AND a."feature" IN ('content','regenerate','image')))::bigint AS generated,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Post" p WHERE p."businessId" = b."id" AND p."status" <> 'DRAFT'))::bigint AS scheduled,
      COUNT(*) FILTER (WHERE s."plan" <> 'TRIAL')::bigint AS paid
    FROM "User" u LEFT JOIN "Business" b ON b."userId" = u."id" LEFT JOIN "Subscription" s ON s."userId" = u."id"
    WHERE u."createdAt" >= ${start} AND u."createdAt" < ${end}`;
  const raw: [string, string, number][] = [
    ["visitors", "Visitors", visitors],
    ["signups", "Signed up", n(c?.signups)],
    ["onboarded", "Finished onboarding", n(c?.onboarded)],
    ["generated", "Generated content", n(c?.generated)],
    ["scheduled", "Scheduled a post", n(c?.scheduled)],
    ["paid", "Became paying", n(c?.paid)],
  ];
  const steps: FunnelStep[] = raw.map(([key, label, count], i) => ({
    key, label, count,
    fromPreviousPct: i === 0 ? null : pct(count, raw[i - 1][2]),
    fromTopPct: i === 0 ? null : pct(count, raw[0][2]),
  }));
  return { range: r, steps };
}

export async function getTopContent(range: DateRange): Promise<TopContent> {
  const r = normalizeRange(range);
  const start = new Date(`${r.from}T00:00:00Z`);
  const end = new Date(`${addDays(r.to, 1)}T00:00:00Z`);
  // The latest metrics row of each post published in the range. Engagement = likes + comments + saves + shares.
  const rows = await prisma.$queryRaw<{ id: string; businessId: string; network: string; format: string; excerpt: string; reach: number; engagement: number }[]>`
    SELECT p."id", p."businessId", p."network", p."format"::text AS format, LEFT(p."text", 120) AS excerpt,
           COALESCE(m."reach", m."views", 0)::int AS reach,
           (COALESCE(m."likes",0) + COALESCE(m."comments",0) + COALESCE(m."saves",0) + COALESCE(m."shares",0))::int AS engagement
    FROM "Post" p
    JOIN LATERAL (SELECT * FROM "PostMetrics" pm WHERE pm."postId" = p."id" ORDER BY pm."capturedAt" DESC LIMIT 1) m ON TRUE
    WHERE p."status" = 'PUBLISHED' AND p."publishedAt" >= ${start} AND p."publishedAt" < ${end}`;
  const group = (pick: (x: (typeof rows)[number]) => string) => {
    const m = new Map<string, { posts: number; eng: number; reach: number }>();
    for (const x of rows) {
      const g = m.get(pick(x)) ?? { posts: 0, eng: 0, reach: 0 };
      g.posts++; g.eng += x.engagement; g.reach += x.reach;
      m.set(pick(x), g);
    }
    return [...m].map(([k, g]) => ({ k, posts: g.posts, avgEngagement: round2(g.eng / g.posts), avgReach: round2(g.reach / g.posts) })).sort((a, b) => b.avgEngagement - a.avgEngagement);
  };
  return {
    range: r,
    byNetwork: group((x) => x.network).map(({ k, ...v }) => ({ network: k, ...v })),
    byFormat: group((x) => x.format).map(({ k, ...v }) => ({ format: k, ...v })),
    topPosts: [...rows].sort((a, b) => b.engagement - a.engagement).slice(0, 10).map((x) => ({ postId: x.id, businessId: x.businessId, network: x.network, format: x.format, reach: x.reach, engagement: x.engagement, excerpt: x.excerpt })),
  };
}

type Tally = { visits?: number; signups: number; paid: number };
const rank = (items: Map<string, Tally>, limit = 15): Ranked[] =>
  [...items]
    .map(([key, v]) => ({ key, visits: v.visits, signups: v.signups, paid: v.paid, signupPct: v.visits ? pct(v.signups, v.visits) : null, paidPct: pct(v.paid, v.signups) }))
    .sort((a, b) => b.paid - a.paid || b.signups - a.signups || (b.visits ?? 0) - (a.visits ?? 0))
    .slice(0, limit);

export async function getWhatsWorking(range: DateRange, opts: { rolled?: boolean } = {}): Promise<WhatsWorking> {
  const r = normalizeRange(range);
  if (!opts.rolled) await ensureRolled(r);
  const start = new Date(`${r.from}T00:00:00Z`);
  const end = new Date(`${addDays(r.to, 1)}T00:00:00Z`);
  const pts = await series(r, ["source", "top_page"]);

  // Industries: businesses created in the range and how many of those pay now.
  const ind = await prisma.$queryRaw<{ industry: string | null; signups: bigint; paid: bigint }[]>`
    SELECT COALESCE(NULLIF(b."industry", ''), 'Unknown') AS industry, COUNT(*)::bigint AS signups, COUNT(*) FILTER (WHERE s."plan" <> 'TRIAL')::bigint AS paid
    FROM "User" u JOIN "Business" b ON b."userId" = u."id" LEFT JOIN "Subscription" s ON s."userId" = u."id"
    WHERE u."createdAt" >= ${start} AND u."createdAt" < ${end} GROUP BY 1`;
  const industries = new Map<string, Tally>(ind.map((i) => [i.industry ?? "Unknown", { signups: n(i.signups), paid: n(i.paid) }]));

  // Sources and landing pages: link each sign-up to the first page view of its visit session.
  const linked = await prisma.$queryRaw<{ source: string | null; path: string | null; paid: boolean }[]>`
    SELECT f."source", f."path", COALESCE(s."plan" <> 'TRIAL', FALSE) AS paid
    FROM "AnalyticsEvent" e
    LEFT JOIN LATERAL (SELECT pv."source", pv."path" FROM "PageView" pv WHERE pv."sessionId" = e."sessionId" ORDER BY pv."createdAt" ASC LIMIT 1) f ON TRUE
    LEFT JOIN "Subscription" s ON s."userId" = e."userId"
    WHERE e."name" = 'signup' AND e."createdAt" >= ${start} AND e."createdAt" < ${end}`;
  const sources = new Map<string, Tally>();
  const pages = new Map<string, Tally>();
  for (const [dim, visits] of byDimension(pts, "source")) sources.set(dim, { visits, signups: 0, paid: 0 });
  for (const [dim, visits] of byDimension(pts, "top_page")) pages.set(dim, { visits, signups: 0, paid: 0 });
  for (const l of linked) {
    const sk = l.source ?? "unattributed";
    const s = sources.get(sk) ?? { signups: 0, paid: 0 };
    s.signups++;
    if (l.paid) s.paid++;
    sources.set(sk, s);
    if (l.path) {
      const p = pages.get(l.path) ?? { signups: 0, paid: 0 };
      p.signups++;
      if (l.paid) p.paid++;
      pages.set(l.path, p);
    }
  }

  const content = await getTopContent(r);

  // Features used by people who pay vs people who left (cancelled or the trial ran out), over their whole history.
  const [f] = await prisma.$queryRaw<Record<string, bigint>[]>`
    WITH u AS (
      SELECT s."userId", b."id" AS bid,
        CASE WHEN s."plan" <> 'TRIAL' AND s."status" IN ('ACTIVE','PAST_DUE') THEN 'paid' WHEN s."status" IN ('CANCELED','EXPIRED') THEN 'churned' END AS grp
      FROM "Subscription" s LEFT JOIN "Business" b ON b."userId" = s."userId"
    ), x AS (
      SELECT grp,
        EXISTS (SELECT 1 FROM "AiCall" a WHERE a."userId" = u."userId" AND a."success" AND a."feature" IN ('content','regenerate')) AS text,
        EXISTS (SELECT 1 FROM "AiCall" a WHERE a."userId" = u."userId" AND a."success" AND a."feature" = 'image') AS image,
        EXISTS (SELECT 1 FROM "Design" d WHERE d."businessId" = u.bid) AS design,
        EXISTS (SELECT 1 FROM "Post" p WHERE p."businessId" = u.bid AND p."status" <> 'DRAFT') AS scheduled,
        EXISTS (SELECT 1 FROM "Post" p WHERE p."businessId" = u.bid AND p."status" = 'PUBLISHED') AS published,
        EXISTS (SELECT 1 FROM "Lead" l WHERE l."businessId" = u.bid) AS lead,
        EXISTS (SELECT 1 FROM "AutopilotRun" ar WHERE ar."businessId" = u.bid) AS autopilot
      FROM u WHERE grp IS NOT NULL
    )
    SELECT COUNT(*) FILTER (WHERE grp = 'paid')::bigint AS paid_total, COUNT(*) FILTER (WHERE grp = 'churned')::bigint AS churned_total,
      COUNT(*) FILTER (WHERE grp = 'paid' AND text)::bigint AS paid_text, COUNT(*) FILTER (WHERE grp = 'churned' AND text)::bigint AS churned_text,
      COUNT(*) FILTER (WHERE grp = 'paid' AND image)::bigint AS paid_image, COUNT(*) FILTER (WHERE grp = 'churned' AND image)::bigint AS churned_image,
      COUNT(*) FILTER (WHERE grp = 'paid' AND design)::bigint AS paid_design, COUNT(*) FILTER (WHERE grp = 'churned' AND design)::bigint AS churned_design,
      COUNT(*) FILTER (WHERE grp = 'paid' AND scheduled)::bigint AS paid_scheduled, COUNT(*) FILTER (WHERE grp = 'churned' AND scheduled)::bigint AS churned_scheduled,
      COUNT(*) FILTER (WHERE grp = 'paid' AND published)::bigint AS paid_published, COUNT(*) FILTER (WHERE grp = 'churned' AND published)::bigint AS churned_published,
      COUNT(*) FILTER (WHERE grp = 'paid' AND lead)::bigint AS paid_lead, COUNT(*) FILTER (WHERE grp = 'churned' AND lead)::bigint AS churned_lead,
      COUNT(*) FILTER (WHERE grp = 'paid' AND autopilot)::bigint AS paid_autopilot, COUNT(*) FILTER (WHERE grp = 'churned' AND autopilot)::bigint AS churned_autopilot
    FROM x`;
  const paidTotal = n(f?.paid_total);
  const churnedTotal = n(f?.churned_total);
  const featuresPaidVsChurned = ["text", "image", "design", "scheduled", "published", "lead", "autopilot"].map((feature) => ({
    feature,
    paidUsers: n(f?.[`paid_${feature}`]),
    churnedUsers: n(f?.[`churned_${feature}`]),
    paidPct: pct(n(f?.[`paid_${feature}`]), paidTotal) ?? 0,
    churnedPct: pct(n(f?.[`churned_${feature}`]), churnedTotal) ?? 0,
  }));

  return { range: r, industries: rank(industries), sources: rank(sources), landingPages: rank(pages), contentFormats: content.byFormat, networks: content.byNetwork, featuresPaidVsChurned };
}

const usd = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
const change = (now: number, before: number) => (before === 0 ? (now === 0 ? "flat" : "new") : `${now >= before ? "up" : "down"} ${Math.abs(Math.round(((now - before) / before) * 100))}%`);

/** A short plain-English paragraph about the numbers. Pure, so it is tested. */
export function summarize(o: Overview, w: Pick<WhatsWorking, "sources" | "industries" | "networks">): string {
  const parts = [
    `From ${o.range.from} to ${o.range.to}: ${o.visits} visits (${change(o.visits, o.previous.visits)} on the period before), ${o.signups} sign-ups (${change(o.signups, o.previous.signups)}) and ${o.paidStarts} new paying customers.`,
    `MRR is ${usd(o.mrrCents)} from ${o.activeSubscriptions} subscriber${o.activeSubscriptions === 1 ? "" : "s"}; ${o.cancellations} cancelled.`,
    `Revenue ${usd(o.revenueCents)}, costs ${usd(o.costCents)}, so ${o.profitCents >= 0 ? "a profit" : "a loss"} of ${usd(Math.abs(o.profitCents))}.`,
  ];
  const src = w.sources.find((s) => s.signups > 0 && s.key !== "unattributed");
  if (src) parts.push(`Best traffic source for sign-ups: ${src.key} (${src.signups}).`);
  const ind = w.industries.find((i) => i.paid > 0) ?? w.industries.find((i) => i.signups > 0);
  if (ind) parts.push(`Most promising industry: ${ind.key} (${ind.signups} sign-up${ind.signups === 1 ? "" : "s"}, ${ind.paid} paying).`);
  if (w.networks[0]) parts.push(`Best network for engagement: ${w.networks[0].network}.`);
  return parts.join(" ");
}

/** The last 7 full UTC days (ending yesterday) unless a range is given. */
export async function weeklyReport(range?: DateRange): Promise<WeeklyReport> {
  const today = utcDay(new Date());
  const r = normalizeRange(range ?? { from: addDays(today, -7), to: addDays(today, -1) });
  // getOverview rolls up the range and the period before it once; the rest then only read.
  const overview = await getOverview(r);
  const rolled = { rolled: true };
  const [funnel, profit, whatsWorking] = await Promise.all([getFunnel(r, rolled), getProfit(r, rolled), getWhatsWorking(r, rolled)]);
  return { range: r, overview, funnel, profit, whatsWorking, summary: summarize(overview, whatsWorking) };
}

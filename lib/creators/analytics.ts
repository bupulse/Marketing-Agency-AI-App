import "server-only";
import { prisma } from "@/lib/db";
import { addDaysYmd } from "@/lib/demo/slots";
import { CreatorCampaignError, readHandles, type CampaignActor } from "./campaigns";
import { periodPay } from "./ledger";
import { EARNING_STATUSES, type PayoutBreakdown, type PeriodPay } from "./pay";
import { dayIn, ymdOf } from "./periods";
import { askMessage, can } from "@/lib/team/roles";

// What the company sees of a creator campaign (docs/CREATOR_CAMPAIGNS.md): totals, views over time from the snapshots,
// the best creators and posts, the period running now against its goals, every post, and the payouts per period.
// "Earned so far" in an open period is worked out live from the pay rules (lib/creators/ledger.ts), exactly as the
// period close will. Every function is scoped to the acting person's company and needs the `creators` permission.

const EARNING = [...EARNING_STATUSES] as string[];
/** The longest views chart: the last 90 days of the campaign. */
const CHART_DAYS = 90;

function assertManager(actor: CampaignActor) {
  if (!can(actor.role, "creators")) throw new CreatorCampaignError("forbidden", askMessage("creators"));
}

async function campaignOf(actor: CampaignActor, id: string) {
  const c = await prisma.creatorCampaign.findFirst({ where: { id, businessId: actor.businessId }, select: { id: true, startsOn: true, endsOn: true, business: { select: { timezone: true } } } });
  if (!c) throw new CreatorCampaignError("not_found", "That campaign no longer exists.");
  return { id: c.id, startsOn: ymdOf(c.startsOn), endsOn: ymdOf(c.endsOn), timezone: c.business.timezone };
}

type PeriodRow = { id: string; index: number; startsAt: Date; endsAt: Date; status: string; viewTargetPerCreator: number | null; viewTargetCampaign: number | null; budget: number | null };

/** The period running now; before the campaign its first one, after it its last one. */
export function currentPeriod<T extends Pick<PeriodRow, "startsAt" | "endsAt">>(periods: T[], now: Date): T | null {
  const sorted = [...periods].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return sorted.find((p) => p.startsAt <= now && now < p.endsAt) ?? (sorted[0] && now < sorted[0].startsAt ? sorted[0] : (sorted.at(-1) ?? null));
}

/** Pay so far of a period: live from the rules while it is open and started, from its payouts once closed. */
async function payOf(period: PeriodRow, now: Date): Promise<{ pay: PeriodPay | null; byCreator: Map<string, number> }> {
  if (period.status === "CLOSED") {
    const rows = await prisma.creatorPayout.findMany({ where: { periodId: period.id }, select: { campaignCreatorId: true, amount: true } });
    return { pay: null, byCreator: new Map(rows.map((r) => [r.campaignCreatorId, r.amount])) };
  }
  if (period.startsAt > now) return { pay: null, byCreator: new Map() };
  const live = await periodPay(period.id, now);
  return { pay: live?.pay ?? null, byCreator: new Map((live?.pay.creators ?? []).map((c) => [c.creatorId, c.amount])) };
}

const PERIOD_SELECT = { id: true, index: true, startsAt: true, endsAt: true, status: true, viewTargetPerCreator: true, viewTargetCampaign: true, budget: true } as const;

/** Views gained per day (company timezone) from the posts' snapshots. A day without a reading carries the last one. */
export function viewsPerDay(snapshots: { postId: string; capturedAt: Date; views: number }[], from: string, to: string, timeZone: string): { start: string; views: number }[] {
  if (to < from) return [];
  const days: string[] = [];
  for (let d = from; d <= to && days.length < 400; d = addDaysYmd(d, 1)) days.push(d);
  // Each post's latest reading of each day, in time order.
  const byPost = new Map<string, Map<string, number>>();
  for (const s of [...snapshots].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())) {
    const readings = byPost.get(s.postId) ?? new Map<string, number>();
    readings.set(dayIn(s.capturedAt, timeZone), s.views);
    byPost.set(s.postId, readings);
  }
  const totals = days.map(() => 0);
  // Readings before the first day shown are where the chart starts, not views gained on it.
  let before = 0;
  for (const readings of byPost.values()) {
    let carried = 0;
    for (const [key, v] of readings) if (key < from) carried = Math.max(carried, v);
    before += carried;
    days.forEach((d, i) => {
      const v = readings.get(d);
      if (v !== undefined) carried = Math.max(carried, v);
      totals[i] += carried;
    });
  }
  return days.map((start, i) => ({ start, views: Math.max(0, totals[i] - (i === 0 ? before : totals[i - 1])) }));
}

/** The campaign's Overview: totals, views per day, best creators and posts, and the period running now. */
export async function campaignOverview(actor: CampaignActor, campaignId: string, now = new Date()) {
  assertManager(actor);
  const c = await campaignOf(actor, campaignId);
  const [sums, creators, periods, topPosts] = await Promise.all([
    prisma.creatorPost.aggregate({ where: { campaignId, status: { in: EARNING } }, _sum: { views: true, impressions: true, likes: true, comments: true, shares: true }, _count: { _all: true } }),
    prisma.campaignCreator.findMany({ where: { campaignId, status: { in: ["JOINED", "REMOVED"] } }, select: { id: true, name: true, status: true } }),
    prisma.creatorPeriod.findMany({ where: { campaignId }, orderBy: { index: "asc" }, select: PERIOD_SELECT }),
    prisma.creatorPost.findMany({ where: { campaignId, status: { in: EARNING } }, orderBy: { views: "desc" }, take: 5, select: { id: true, network: true, url: true, views: true, likes: true, comments: true, shares: true, postedAt: true, campaignCreator: { select: { name: true } } } }),
  ]);
  const period = currentPeriod(periods, now);
  const pay = period ? await payOf(period, now) : { pay: null, byCreator: new Map<string, number>() };

  // Views per creator over the whole campaign, for the ranking next to this period's pay.
  const viewsByCreator = await prisma.creatorPost.groupBy({ by: ["campaignCreatorId"], where: { campaignId, status: { in: EARNING } }, _sum: { views: true }, _count: { _all: true } });
  const names = new Map(creators.map((r) => [r.id, r.name]));
  const top = viewsByCreator
    .map((g) => ({ id: g.campaignCreatorId, name: names.get(g.campaignCreatorId) ?? "A creator", views: g._sum.views ?? 0, posts: g._count._all, earned: pay.byCreator.get(g.campaignCreatorId) ?? 0 }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);

  const to = [c.endsOn, dayIn(now, c.timezone)].sort()[0];
  const from = [c.startsOn, addDaysYmd(to, -(CHART_DAYS - 1))].sort().at(-1)!;
  const snapshots = to >= c.startsOn
    ? await prisma.creatorPostSnapshot.findMany({ where: { post: { campaignId, status: { notIn: ["INVALID"] } }, capturedAt: { lte: now } }, orderBy: { capturedAt: "desc" }, take: 50_000, select: { postId: true, capturedAt: true, views: true } })
    : [];

  return {
    totals: {
      views: sums._sum.views ?? 0,
      impressions: sums._sum.impressions ?? 0,
      engagement: (sums._sum.likes ?? 0) + (sums._sum.comments ?? 0) + (sums._sum.shares ?? 0),
      posts: sums._count._all,
      creators: creators.filter((r) => r.status === "JOINED").length,
    },
    chart: to >= c.startsOn ? viewsPerDay(snapshots, from, to, c.timezone) : [],
    period: period
      ? {
          id: period.id,
          index: period.index,
          count: periods.length,
          startsOn: dayIn(period.startsAt, c.timezone),
          endsOn: addDaysYmd(dayIn(period.endsAt, c.timezone), -1),
          status: period.status,
          started: period.startsAt <= now,
          goals: { viewTargetPerCreator: period.viewTargetPerCreator, viewTargetCampaign: period.viewTargetCampaign, budget: period.budget },
          views: pay.pay?.views ?? null,
          countedViews: pay.pay?.countedViews ?? null,
          earned: pay.pay ? pay.pay.amount : [...pay.byCreator.values()].reduce((s, n) => s + n, 0),
          limitsHit: pay.pay?.limitsHit ?? [],
        }
      : null,
    topCreators: top,
    topPosts: topPosts.map((p) => ({ id: p.id, network: p.network, url: p.url, views: p.views, engagement: p.likes + p.comments + p.shares, postedAt: p.postedAt?.toISOString() ?? null, creator: p.campaignCreator.name })),
  };
}
export type CampaignOverview = Awaited<ReturnType<typeof campaignOverview>>;

/** The creators in the campaign (and those removed, for their history) with their totals and what they earned. */
export async function creatorTotals(actor: CampaignActor, campaignId: string, now = new Date()) {
  assertManager(actor);
  await campaignOf(actor, campaignId);
  const [rows, posts, payouts, periods] = await Promise.all([
    prisma.campaignCreator.findMany({ where: { campaignId, status: { in: ["JOINED", "REMOVED"] } }, orderBy: [{ status: "asc" }, { joinedAt: "asc" }], select: { id: true, name: true, phone: true, email: true, status: true, handles: true, joinedAt: true, removedAt: true } }),
    prisma.creatorPost.groupBy({ by: ["campaignCreatorId"], where: { campaignId, status: { in: EARNING } }, _sum: { views: true }, _count: { _all: true } }),
    prisma.creatorPayout.groupBy({ by: ["campaignCreatorId", "status"], where: { period: { campaignId } }, _sum: { amount: true } }),
    prisma.creatorPeriod.findMany({ where: { campaignId, status: "OPEN", startsAt: { lte: now } }, select: PERIOD_SELECT }),
  ]);
  const open = new Map<string, number>();
  for (const p of periods) for (const [id, n] of (await payOf(p, now)).byCreator) open.set(id, (open.get(id) ?? 0) + n);
  const paid = (id: string, status: string) => payouts.find((p) => p.campaignCreatorId === id && p.status === status)?._sum.amount ?? 0;
  return rows.map((r) => {
    const own = posts.find((p) => p.campaignCreatorId === r.id);
    return {
      id: r.id,
      name: r.name,
      phone: r.phone,
      email: r.email,
      status: r.status,
      handles: readHandles(r.handles),
      joinedAt: r.joinedAt?.toISOString() ?? null,
      removedAt: r.removedAt?.toISOString() ?? null,
      posts: own?._count._all ?? 0,
      views: own?._sum.views ?? 0,
      /** Earned in the period running now, not written as a payout yet. */
      earningNow: open.get(r.id) ?? 0,
      due: paid(r.id, "DUE"),
      paid: paid(r.id, "PAID"),
    };
  });
}
export type CreatorTotalsRow = Awaited<ReturnType<typeof creatorTotals>>[number];

const POST_SELECT = {
  id: true,
  network: true,
  url: true,
  status: true,
  statusReason: true,
  checks: true,
  views: true,
  impressions: true,
  likes: true,
  comments: true,
  shares: true,
  postedAt: true,
  createdAt: true,
  lastReadAt: true,
  campaignCreatorId: true,
  campaignCreator: { select: { name: true } },
  submission: { select: { id: true, title: true, day: true, status: true, rejectReason: true, task: { select: { title: true } } } },
} as const;

type PostRecord = { id: string; network: string; url: string; status: string; statusReason: string | null; checks: unknown; views: number; impressions: number; likes: number; comments: number; shares: number; postedAt: Date | null; createdAt: Date; lastReadAt: Date | null; campaignCreatorId: string; campaignCreator: { name: string }; submission: { id: string; title: string; day: Date; status: string; rejectReason: string | null; task: { title: string } } };

/** The `checks` of a post as stored: { ownAccount, onTime, mention }, each true, false or null (not checked yet). */
export function readChecks(value: unknown): { ownAccount: boolean | null; onTime: boolean | null; mention: boolean | null } {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const one = (x: unknown) => (typeof x === "boolean" ? x : null);
  return { ownAccount: one(v.ownAccount), onTime: one(v.onTime), mention: one(v.mention) };
}

const postView = (p: PostRecord) => ({
  id: p.id,
  network: p.network,
  url: p.url,
  status: p.status,
  reason: p.statusReason,
  checks: readChecks(p.checks),
  views: p.views,
  impressions: p.impressions,
  likes: p.likes,
  comments: p.comments,
  shares: p.shares,
  postedAt: p.postedAt?.toISOString() ?? null,
  handedInAt: p.createdAt.toISOString(),
  lastReadAt: p.lastReadAt?.toISOString() ?? null,
  creatorId: p.campaignCreatorId,
  creator: p.campaignCreator.name,
  submission: { id: p.submission.id, title: p.submission.title, task: p.submission.task.title, day: ymdOf(p.submission.day), status: p.submission.status, rejectReason: p.submission.rejectReason },
});
export type PostRow = ReturnType<typeof postView>;

/** Every post of the campaign, newest first (at most 500; `status` narrows it). */
export async function listPosts(actor: CampaignActor, campaignId: string, filter: { status?: string; creatorId?: string } = {}) {
  assertManager(actor);
  await campaignOf(actor, campaignId);
  const rows = await prisma.creatorPost.findMany({
    where: { campaignId, ...(filter.status ? { status: filter.status } : {}), ...(filter.creatorId ? { campaignCreatorId: filter.creatorId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: POST_SELECT,
  });
  return rows.map(postView);
}

/** One creator of the campaign: what they sent, their posts with views, what they earned so far, their payouts. */
export async function creatorDetail(actor: CampaignActor, campaignId: string, campaignCreatorId: string, now = new Date()) {
  assertManager(actor);
  await campaignOf(actor, campaignId);
  const row = await prisma.campaignCreator.findFirst({ where: { id: campaignCreatorId, campaignId } });
  if (!row) throw new CreatorCampaignError("not_found", "That creator is not in this campaign.");
  const [posts, payouts, periods] = await Promise.all([
    prisma.creatorPost.findMany({ where: { campaignId, campaignCreatorId }, orderBy: { createdAt: "desc" }, select: POST_SELECT }),
    prisma.creatorPayout.findMany({ where: { campaignCreatorId }, orderBy: { createdAt: "desc" }, select: { id: true, amount: true, deductions: true, status: true, paidAt: true, reference: true, breakdown: true, period: { select: { index: true } } } }),
    prisma.creatorPeriod.findMany({ where: { campaignId, status: "OPEN", startsAt: { lte: now } }, select: PERIOD_SELECT }),
  ]);
  // This period's pay of each post, live.
  const postPay = new Map<string, number>();
  let earningNow = 0;
  for (const p of periods) {
    const live = await periodPay(p.id, now);
    const line = live?.pay.creators.find((c) => c.creatorId === campaignCreatorId);
    if (!line) continue;
    earningNow += line.amount;
    for (const pp of line.posts) postPay.set(pp.postId, (postPay.get(pp.postId) ?? 0) + pp.amount);
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    handles: readHandles(row.handles),
    samples: row.samples,
    joinedAt: row.joinedAt?.toISOString() ?? null,
    earningNow,
    due: payouts.filter((p) => p.status === "DUE").reduce((s, p) => s + p.amount, 0),
    paid: payouts.filter((p) => p.status === "PAID").reduce((s, p) => s + p.amount, 0),
    posts: posts.map((p) => ({ ...postView(p), earningNow: postPay.get(p.id) ?? 0 })),
    payouts: payouts.map((p) => ({ id: p.id, period: p.period.index, amount: p.amount, deductions: p.deductions, status: p.status, paidAt: p.paidAt?.toISOString() ?? null, reference: p.reference, stillOwed: (p.breakdown as unknown as PayoutBreakdown | null)?.stillOwed ?? 0 })),
  };
}
export type CreatorDetail = Awaited<ReturnType<typeof creatorDetail>>;

/**
 * The pay periods with their money: an open period's earnings so far (live, per creator), a closed one's payouts to
 * mark paid, and the periods still to come.
 */
export async function payoutPeriods(actor: CampaignActor, campaignId: string, now = new Date()) {
  assertManager(actor);
  const c = await campaignOf(actor, campaignId);
  const [periods, creators] = await Promise.all([
    prisma.creatorPeriod.findMany({ where: { campaignId }, orderBy: { index: "asc" }, select: { ...PERIOD_SELECT, payouts: { orderBy: { amount: "desc" }, select: { id: true, campaignCreatorId: true, countedViews: true, amount: true, deductions: true, status: true, paidAt: true, reference: true, breakdown: true } } } }),
    prisma.campaignCreator.findMany({ where: { campaignId }, select: { id: true, name: true, phone: true } }),
  ]);
  const who = new Map(creators.map((r) => [r.id, r]));
  const out = [];
  for (const p of periods) {
    const base = { id: p.id, index: p.index, startsOn: dayIn(p.startsAt, c.timezone), endsOn: addDaysYmd(dayIn(p.endsAt, c.timezone), -1), goals: { viewTargetPerCreator: p.viewTargetPerCreator, viewTargetCampaign: p.viewTargetCampaign, budget: p.budget } };
    if (p.status === "CLOSED") {
      out.push({
        ...base,
        state: "closed" as const,
        total: p.payouts.reduce((s, x) => s + x.amount, 0),
        limitsHit: [] as PeriodPay["limitsHit"],
        lines: p.payouts.map((x) => ({ id: x.id, creatorId: x.campaignCreatorId, name: who.get(x.campaignCreatorId)?.name ?? "A creator", phone: who.get(x.campaignCreatorId)?.phone ?? null, views: (x.breakdown as unknown as PayoutBreakdown | null)?.views ?? x.countedViews, countedViews: x.countedViews, amount: x.amount, deductions: x.deductions, stillOwed: (x.breakdown as unknown as PayoutBreakdown | null)?.stillOwed ?? 0, status: x.status, paidAt: x.paidAt?.toISOString() ?? null, reference: x.reference })),
      });
    } else if (p.startsAt > now) {
      out.push({ ...base, state: "upcoming" as const, total: 0, limitsHit: [] as PeriodPay["limitsHit"], lines: [] });
    } else {
      const live = await periodPay(p.id, now);
      const lines = (live?.pay.creators ?? []).filter((x) => x.amount > 0 || x.views > 0).sort((a, b) => b.amount - a.amount);
      out.push({
        ...base,
        state: "open" as const,
        total: live?.pay.amount ?? 0,
        limitsHit: live?.pay.limitsHit ?? [],
        lines: lines.map((x) => ({ id: null, creatorId: x.creatorId, name: who.get(x.creatorId)?.name ?? "A creator", phone: who.get(x.creatorId)?.phone ?? null, views: x.views, countedViews: x.countedViews, amount: x.amount, deductions: 0, stillOwed: 0, status: "EARNING", paidAt: null, reference: null })),
      });
    }
  }
  return out;
}
export type PayoutPeriod = Awaited<ReturnType<typeof payoutPeriods>>[number];

import "server-only";
import { prisma } from "@/lib/db";
import { periodPay } from "./ledger";
import { readPayRules, type PayoutBreakdown, type PostPay } from "./pay";
import { dayIn, ymdOf } from "./periods";
import { handInKey, tasksForDay, type DayTask } from "./tasks";

// What the creator's portal (/creator, docs/CREATOR_CAMPAIGNS.md) shows: their campaigns, the day's tasks across
// campaigns, a campaign's posts and earnings, and their payouts. Every read is scoped to the signed-in creator's
// profile: a CampaignCreator row they joined is the only way in to a campaign.

/** Hand-ins of these creators that still count for their day: at least one link not INVALID. */
export async function handedInCounts(campaignCreatorIds: string[], days?: Date[]): Promise<Map<string, number>> {
  if (!campaignCreatorIds.length) return new Map();
  const rows = await prisma.creatorSubmission.findMany({
    where: { campaignCreatorId: { in: campaignCreatorIds }, status: "ACCEPTED", ...(days ? { day: { in: days } } : {}), posts: { some: { status: { not: "INVALID" } } } },
    select: { campaignCreatorId: true, taskId: true, day: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.campaignCreatorId}|${handInKey(r.taskId, ymdOf(r.day))}`;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

const CAMPAIGN_SELECT = {
  id: true,
  slug: true,
  name: true,
  brief: true,
  rules: true,
  status: true,
  startsOn: true,
  endsOn: true,
  platforms: true,
  mentions: true,
  currency: true,
  payRules: true,
  viewTargetPerCreator: true,
  viewTargetCampaign: true,
  business: { select: { name: true, timezone: true } },
} as const;

/** The creator's campaigns (joined, and those the company removed them from, to keep their history). */
export async function myCampaigns(profileId: string) {
  return prisma.campaignCreator.findMany({
    where: { profileId, status: { in: ["JOINED", "REMOVED"] } },
    orderBy: { joinedAt: "desc" },
    select: { id: true, status: true, joinedAt: true, campaign: { select: CAMPAIGN_SELECT } },
  });
}

export type TodayTask = DayTask<{ id: string; title: string; instructions: string; startsOn: Date; endsOn: Date; postsPerDay: number; platforms: string[]; platformMode: string; mediaKind: string }> & {
  campaign: { id: string; name: string; companyName: string };
};

/** Today's tasks across the creator's live campaigns ("today" in each company's timezone). */
export async function todaysTasks(profileId: string, now = new Date()): Promise<TodayTask[]> {
  const memberships = await prisma.campaignCreator.findMany({
    where: { profileId, status: "JOINED", campaign: { status: "LIVE" } },
    select: { id: true, campaign: { select: { id: true, name: true, business: { select: { name: true, timezone: true } }, tasks: { orderBy: { startsOn: "asc" } } } } },
  });
  const out: TodayTask[] = [];
  for (const m of memberships) {
    const today = dayIn(now, m.campaign.business.timezone || "UTC");
    const counts = await handedInCounts([m.id], [new Date(`${today}T00:00:00Z`)]);
    const mine = new Map([...counts].map(([k, v]) => [k.slice(m.id.length + 1), v]));
    for (const t of tasksForDay(m.campaign.tasks, today, mine)) out.push({ ...t, campaign: { id: m.campaign.id, name: m.campaign.name, companyName: m.campaign.business.name } });
  }
  return out;
}

/** The creator's membership of a campaign, or null when it is not theirs. */
export async function membershipOf(profileId: string, campaignId: string) {
  return prisma.campaignCreator.findFirst({ where: { profileId, campaignId, status: { in: ["JOINED", "REMOVED"] } }, select: { id: true, status: true } });
}

export type PeriodLine = {
  id: string;
  index: number;
  startsAt: Date;
  endsAt: Date;
  status: string;
  /** Open: earned so far; closed: what the payout says. */
  earned: number;
  views: number;
  countedViews: number;
  posts: PostPay[];
  payout: { id: string; amount: number; deductions: number; status: string; reference: string | null; paidAt: Date | null; stillOwed: number } | null;
};

/** A campaign as the creator sees it: the campaign, its tasks, their posts, and each period's pay for them. */
export async function campaignForCreator(profileId: string, campaignId: string, now = new Date()) {
  const membership = await membershipOf(profileId, campaignId);
  if (!membership) return null;
  const [campaign, tasks, posts, periods] = await Promise.all([
    prisma.creatorCampaign.findUnique({ where: { id: campaignId }, select: CAMPAIGN_SELECT }),
    prisma.creatorTask.findMany({ where: { campaignId }, orderBy: { startsOn: "asc" } }),
    prisma.creatorPost.findMany({
      where: { campaignCreatorId: membership.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, network: true, url: true, status: true, statusReason: true, views: true, likes: true, comments: true, shares: true, postedAt: true, createdAt: true, submission: { select: { id: true, title: true, day: true, taskId: true } } },
    }),
    prisma.creatorPeriod.findMany({
      where: { campaignId },
      orderBy: { index: "asc" },
      select: { id: true, index: true, startsAt: true, endsAt: true, status: true, payouts: { where: { campaignCreatorId: membership.id }, select: { id: true, amount: true, deductions: true, status: true, reference: true, paidAt: true, breakdown: true, countedViews: true } } },
    }),
  ]);
  if (!campaign) return null;
  const lines: PeriodLine[] = [];
  for (const p of periods) {
    const payout = p.payouts[0];
    if (p.status === "CLOSED") {
      const b = payout?.breakdown as unknown as PayoutBreakdown | undefined;
      lines.push({
        ...p,
        earned: payout?.amount ?? 0,
        views: b?.views ?? 0,
        countedViews: payout?.countedViews ?? 0,
        posts: b?.posts ?? [],
        payout: payout ? { id: payout.id, amount: payout.amount, deductions: payout.deductions, status: payout.status, reference: payout.reference, paidAt: payout.paidAt, stillOwed: b?.stillOwed ?? 0 } : null,
      });
    } else if (p.startsAt <= now) {
      const pay = await periodPay(p.id, now);
      const mine = pay?.pay.creators.find((c) => c.creatorId === membership.id);
      lines.push({ ...p, earned: mine?.amount ?? 0, views: mine?.views ?? 0, countedViews: mine?.countedViews ?? 0, posts: mine?.posts ?? [], payout: null });
    }
  }
  return { membership, campaign: { ...campaign, payRules: readPayRules(campaign.payRules) }, tasks, posts, periods: lines };
}

/** Every payout of the creator, newest first, with its campaign. */
export async function myPayouts(profileId: string) {
  return prisma.creatorPayout.findMany({
    where: { campaignCreator: { profileId } },
    orderBy: { createdAt: "desc" },
    select: { id: true, amount: true, deductions: true, status: true, reference: true, paidAt: true, countedViews: true, createdAt: true, period: { select: { index: true, startsAt: true, endsAt: true } }, campaignCreator: { select: { campaign: { select: { id: true, name: true, currency: true, business: { select: { name: true } } } } } } },
  });
}

/** Posts of the creator that stopped earning in the last `days` days, for the notice on the portal's home page. */
export async function recentlyStopped(profileId: string, now = new Date(), days = 14) {
  return prisma.creatorPost.findMany({
    where: { campaignCreator: { profileId }, status: { in: ["REMOVED", "REJECTED"] }, updatedAt: { gte: new Date(now.getTime() - days * 86_400_000) } },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { id: true, network: true, status: true, statusReason: true, campaign: { select: { id: true, name: true } } },
  });
}

/** What the creator has earned so far in each campaign's open month (paid when it closes). */
export async function earningsSoFar(profileId: string, now = new Date()) {
  const memberships = await prisma.campaignCreator.findMany({
    where: { profileId, status: { in: ["JOINED", "REMOVED"] }, campaign: { periods: { some: { status: "OPEN", startsAt: { lte: now } } } } },
    select: { id: true, campaign: { select: { id: true, name: true, currency: true, periods: { where: { status: "OPEN", startsAt: { lte: now } }, orderBy: { index: "asc" }, take: 1, select: { id: true, index: true, endsAt: true } } } } },
  });
  const out: { campaignId: string; name: string; currency: string; periodIndex: number; endsAt: Date; amount: number; views: number }[] = [];
  for (const m of memberships) {
    const period = m.campaign.periods[0];
    if (!period) continue;
    const mine = (await periodPay(period.id, now))?.pay.creators.find((c) => c.creatorId === m.id);
    out.push({ campaignId: m.campaign.id, name: m.campaign.name, currency: m.campaign.currency, periodIndex: period.index, endsAt: period.endsAt, amount: mine?.amount ?? 0, views: mine?.views ?? 0 });
  }
  return out;
}

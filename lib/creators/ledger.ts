import "server-only";
import { prisma } from "@/lib/db";
import { computePeriodPay, milestonesPaidFor, readPayRules, type PayoutBreakdown, type PeriodPay, type PostInput } from "./pay";

// Reads what lib/creators/pay.ts needs for one pay period from the database: every post of the campaign that existed
// before the period ended, with its views at the period's start and end (or now, for an open period) from the
// snapshots. The company's dashboard and the creator's portal show "earned so far" with it; the period close writes the
// payouts from it (docs/CREATOR_CAMPAIGNS.md, "Pay").

type PeriodRow = { id: string; campaignId: string; startsAt: Date; endsAt: Date; viewTargetPerCreator: number | null; viewTargetCampaign: number | null; budget: number | null };

/** The latest reading at or before `at`, per post (0 when there is none). */
async function viewsAt(postIds: string[], at: Date): Promise<Map<string, number>> {
  if (postIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ postId: string; views: number }[]>`
    SELECT DISTINCT ON ("postId") "postId", "views"
    FROM "CreatorPostSnapshot"
    WHERE "postId" = ANY(${postIds}) AND "capturedAt" <= ${at}
    ORDER BY "postId", "capturedAt" DESC`;
  return new Map(rows.map((r) => [r.postId, r.views]));
}

/** The PostInput of every post that can earn in the period (`now` caps the end of an open period). */
export async function periodInputs(period: PeriodRow, now = new Date()): Promise<PostInput[]> {
  const end = period.endsAt < now ? period.endsAt : now;
  const posts = await prisma.creatorPost.findMany({
    where: { campaignId: period.campaignId, createdAt: { lt: period.endsAt } },
    select: { id: true, campaignCreatorId: true, status: true, postedAt: true, createdAt: true },
  });
  const ids = posts.map((p) => p.id);
  const [atStart, atEnd, earlier] = await Promise.all([
    viewsAt(ids, period.startsAt),
    viewsAt(ids, end),
    prisma.creatorPayout.findMany({ where: { period: { campaignId: period.campaignId, endsAt: { lte: period.startsAt } } }, select: { breakdown: true } }),
  ]);
  const paidBefore = earlier.map((e) => e.breakdown as unknown as Pick<PayoutBreakdown, "posts">);
  return posts.map((p) => {
    const postedAt = p.postedAt ?? p.createdAt;
    return {
      postId: p.id,
      creatorId: p.campaignCreatorId,
      status: p.status,
      postedInPeriod: postedAt >= period.startsAt && postedAt < period.endsAt,
      viewsAtStart: postedAt >= period.startsAt ? 0 : (atStart.get(p.id) ?? 0),
      viewsAtEnd: atEnd.get(p.id) ?? 0,
      milestonesPaid: milestonesPaidFor(p.id, paidBefore),
    };
  });
}

/** What every creator has earned in a period so far (open) or in all (closed, before the payouts are written). */
export async function periodPay(periodId: string, now = new Date()): Promise<{ period: PeriodRow; pay: PeriodPay } | null> {
  const period = await prisma.creatorPeriod.findUnique({
    where: { id: periodId },
    select: { id: true, campaignId: true, startsAt: true, endsAt: true, viewTargetPerCreator: true, viewTargetCampaign: true, budget: true, campaign: { select: { payRules: true } } },
  });
  if (!period) return null;
  const inputs = await periodInputs(period, now);
  return { period, pay: computePeriodPay(readPayRules(period.campaign.payRules), period, inputs) };
}

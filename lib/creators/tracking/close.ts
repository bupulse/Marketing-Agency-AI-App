import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { periodPay } from "../ledger";
import { deductionsFor, payoutFor, type PayoutBreakdown } from "../pay";

// Closing a pay period (docs/CREATOR_CAMPAIGNS.md, "Pay"): once its end has passed and its final reading is in (job.ts),
// a CreatorPayout is written for every creator who earned, minus pay taken back for posts removed or rejected after a
// PAID payout counted them. Claimed with one conditional update inside the same transaction as the payouts, so two
// runs at once close it once, and a failed write leaves it OPEN for the next run. After the campaign's last period:
// its posts are FINAL and the campaign ENDED.

const STOPPED = ["REMOVED", "REJECTED"];

export type CloseResult = { status: "closed" | "already"; payouts: { campaignCreatorId: string; amount: number }[]; last: boolean };

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function closePeriod(periodId: string, now = new Date()): Promise<CloseResult> {
  const row = await prisma.creatorPeriod.findUnique({ where: { id: periodId }, select: { id: true, campaignId: true, index: true, status: true, endsAt: true } });
  if (!row || row.status !== "OPEN" || row.endsAt > now) return { status: "already", payouts: [], last: false };
  const result = await periodPay(periodId, now);
  if (!result) return { status: "already", payouts: [], last: false };
  const last = !(await prisma.creatorPeriod.findFirst({ where: { campaignId: row.campaignId, index: { gt: row.index } }, select: { id: true } }));

  const creatorIds = result.pay.creators.map((c) => c.creatorId);
  const [earlier, stoppedPosts] = await Promise.all([
    prisma.creatorPayout.findMany({ where: { campaignCreatorId: { in: creatorIds }, periodId: { not: periodId } }, select: { campaignCreatorId: true, status: true, breakdown: true } }),
    prisma.creatorPost.findMany({ where: { campaignCreatorId: { in: creatorIds }, status: { in: STOPPED } }, select: { id: true, campaignCreatorId: true } }),
  ]);

  const rows: Prisma.CreatorPayoutCreateManyInput[] = [];
  for (const line of result.pay.creators) {
    const mine = earlier.filter((p) => p.campaignCreatorId === line.creatorId).map((p) => ({ status: p.status, b: p.breakdown as unknown as PayoutBreakdown }));
    const stopped = new Set(stoppedPosts.filter((p) => p.campaignCreatorId === line.creatorId).map((p) => p.id));
    const already = new Set(mine.flatMap((p) => (p.b.deducted ?? []).map((d) => d.postId)));
    const deducted = deductionsFor(stopped, mine.filter((p) => p.status === "PAID").map((p) => p.b), already);
    // Nothing earned: the deductions wait for a payout that can carry them, except after the last period, when the
    // row records what is still owed for the company to settle.
    if (line.amount <= 0 && !(last && deducted.length)) continue;
    const payout = payoutFor(line, deducted);
    rows.push({ periodId, campaignCreatorId: line.creatorId, countedViews: line.countedViews, amount: payout.amount, deductions: payout.deductions, breakdown: payout.breakdown as unknown as Prisma.InputJsonValue });
  }

  try {
    await prisma.$transaction(async (tx: Tx) => {
      const claimed = await tx.creatorPeriod.updateMany({ where: { id: periodId, status: "OPEN" }, data: { status: "CLOSED", closedAt: now } });
      if (claimed.count !== 1) throw new AlreadyClosed();
      if (rows.length) await tx.creatorPayout.createMany({ data: rows, skipDuplicates: true });
      if (last) {
        await tx.creatorPost.updateMany({ where: { campaignId: row.campaignId, status: "TRACKING" }, data: { status: "FINAL", nextReadAt: null } });
        await tx.creatorPost.updateMany({ where: { campaignId: row.campaignId, status: "CHECKING" }, data: { status: "INVALID", statusReason: "The campaign ended before this post could be checked." } });
        await tx.creatorCampaign.update({ where: { id: row.campaignId }, data: { status: "ENDED", acceptingApplications: false } });
      }
    });
  } catch (error) {
    if (error instanceof AlreadyClosed) return { status: "already", payouts: [], last: false };
    throw error;
  }
  return { status: "closed", payouts: rows.map((r) => ({ campaignCreatorId: r.campaignCreatorId, amount: r.amount })), last };
}

class AlreadyClosed extends Error {}

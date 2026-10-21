import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { withoutPost, type PayoutBreakdown } from "../pay";

// A post that stops earning (docs/CREATOR_CAMPAIGNS.md, check 4, owner decision "lose that post"): REMOVED when it is
// gone from the network, REJECTED when the company rejects it. Its pay in the open period drops to 0 by itself (only
// TRACKING and FINAL posts earn); its pay in a DUE payout drops here (withoutPost); pay in a PAID payout is taken off
// the creator's next payout when the next period closes (deductionsFor, close.ts).

/** Takes the post's pay out of every DUE payout of its creator. Returns how many payouts changed. */
export async function dropFromDuePayouts(postId: string): Promise<number> {
  const post = await prisma.creatorPost.findUnique({ where: { id: postId }, select: { campaignCreatorId: true } });
  if (!post) return 0;
  const due = await prisma.creatorPayout.findMany({ where: { campaignCreatorId: post.campaignCreatorId, status: "DUE" }, select: { id: true } });
  let changed = 0;
  for (const { id } of due) {
    // Written only if nobody changed the payout since it was read; another change (a second removal) means read again.
    // Marked PAID meanwhile: the pay is taken back from the next payout instead (deductionsFor).
    for (let attempt = 0; attempt < 3; attempt++) {
      const p = await prisma.creatorPayout.findFirst({ where: { id, status: "DUE" }, select: { breakdown: true, countedViews: true, updatedAt: true } });
      const breakdown = p?.breakdown as unknown as PayoutBreakdown | undefined;
      const next = breakdown ? withoutPost(breakdown, postId) : null;
      if (!p || !breakdown || !next) break;
      const dropped = breakdown.posts.find((x) => x.postId === postId)?.countedViews ?? 0;
      const r = await prisma.creatorPayout.updateMany({
        where: { id, status: "DUE", updatedAt: p.updatedAt },
        data: { amount: next.amount, deductions: next.deductions, breakdown: next.breakdown as unknown as Prisma.InputJsonValue, countedViews: Math.max(0, p.countedViews - dropped) },
      });
      if (r.count === 1) {
        changed++;
        break;
      }
    }
  }
  return changed;
}

/**
 * Marks a tracked post REMOVED with the reason the creator sees, and takes its pay out of DUE payouts. False when it
 * was not TRACKING any more (another run got there first, or the company rejected it).
 */
export async function removePost(postId: string, reason: string, now = new Date()): Promise<boolean> {
  const r = await prisma.creatorPost.updateMany({ where: { id: postId, status: "TRACKING" }, data: { status: "REMOVED", statusReason: reason, removedAt: now, nextReadAt: null } });
  if (r.count !== 1) return false;
  await dropFromDuePayouts(postId);
  return true;
}

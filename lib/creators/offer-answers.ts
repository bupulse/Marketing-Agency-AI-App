import "server-only";
import { prisma } from "@/lib/db";
import { campaignLimits, lock } from "./campaigns";
import { offerExpired } from "./portal-groups";

// A creator answers a company's invitation (docs/CREATOR_MARKETPLACE.md, "Companies finding creators"): an OFFERED
// row becomes JOINED (Accept) or DECLINED (Decline). An invitation is open for 14 days from offeredAt; after that it
// shows "Expired" and cannot be answered. Accepting takes a place: refused when the campaign's SELECTED and JOINED
// creators already fill the plan's `creatorsPerCampaign`, counted under the same per-campaign lock as the company's
// picks (lib/creators/campaigns.ts).

export type OfferAnswer = "accept" | "decline";
export type OfferErrorCode = "not_found" | "expired" | "conflict" | "limit" | "blocked";

export class OfferError extends Error {
  constructor(
    readonly code: OfferErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OfferError";
  }
}

/** Accepts or declines one of the creator's own invitations. Returns the new status. */
export async function answerOffer(profileId: string, campaignCreatorId: string, answer: OfferAnswer, now = new Date()): Promise<"JOINED" | "DECLINED"> {
  const row = await prisma.campaignCreator.findFirst({
    where: { id: campaignCreatorId, profileId },
    select: { id: true, status: true, offeredAt: true, campaignId: true, profile: { select: { blockedAt: true } }, campaign: { select: { status: true, businessId: true } } },
  });
  if (!row) throw new OfferError("not_found", "That invitation no longer exists.");
  if (row.status !== "OFFERED") throw new OfferError("conflict", row.status === "JOINED" ? "You already joined this campaign." : "This invitation was already answered.");
  if (offerExpired(row.offeredAt, now)) throw new OfferError("expired", "This invitation has expired. The company can invite you again.");

  if (answer === "decline") {
    const done = await prisma.campaignCreator.updateMany({ where: { id: row.id, profileId, status: "OFFERED" }, data: { status: "DECLINED" } });
    if (done.count === 0) throw new OfferError("conflict", "This invitation was already answered.");
    return "DECLINED";
  }

  if (row.profile?.blockedAt) throw new OfferError("blocked", "Your creator account cannot join campaigns right now. Write to BuPulse if you think this is a mistake.");
  if (row.campaign.status === "ENDED") throw new OfferError("conflict", "This campaign has ended.");
  const { creatorsPerCampaign } = await campaignLimits(row.campaign.businessId);
  await prisma.$transaction(async (tx) => {
    // The company's picks take the same lock (lib/creators/campaigns.ts).
    await lock(tx, row.campaignId);
    const picked = await tx.campaignCreator.count({ where: { campaignId: row.campaignId, status: { in: ["SELECTED", "JOINED"] } } });
    if (picked >= creatorsPerCampaign) throw new OfferError("limit", "All places in this campaign are taken, so the invitation cannot be accepted now.");
    const done = await tx.campaignCreator.updateMany({ where: { id: row.id, profileId, status: "OFFERED" }, data: { status: "JOINED", joinedAt: now } });
    if (done.count === 0) throw new OfferError("conflict", "This invitation was already answered.");
  });
  return "JOINED";
}

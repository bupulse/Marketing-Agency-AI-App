import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { linkSiteUrl } from "@/lib/auth/request-site";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { askMessage, can } from "@/lib/team/roles";
import { campaignLimits, creatorOf, CreatorCampaignError, lock, placesFullMessage, placesTaken, readHandles, type CampaignActor } from "./campaigns";
import { offerExpired, offerExpiresAt } from "./company-forms";

// Companies inviting marketplace creators to a campaign (docs/CREATOR_MARKETPLACE.md, "Companies finding creators"). An
// offer is a CampaignCreator row: OFFERED, source OFFER, with who offered it and when, and the creator's name, email,
// WhatsApp, handles and samples copied from their profile. It holds a place under `creatorsPerCampaign` until it is
// answered (the creator's portal, lib/creators/offer-answers.ts), withdrawn, or 14 days pass ("Expired": a new offer
// can then be made on the same row). One open offer per creator per campaign. The feature is checked by the server
// actions (app/dashboard/creators/actions.ts), like lib/creators/campaigns.ts.

/** Campaigns a creator can be invited to: live or draft. */
const OPEN_FOR_OFFERS = ["LIVE", "DRAFT"];

function assertManager(actor: CampaignActor) {
  if (!can(actor.role, "creators")) throw new CreatorCampaignError("forbidden", askMessage("creators"));
}

/** The company's campaigns a creator can be invited to, for the Invite picker. */
export async function offerCampaigns(actor: CampaignActor) {
  assertManager(actor);
  return prisma.creatorCampaign.findMany({ where: { businessId: actor.businessId, status: { in: OPEN_FOR_OFFERS } }, orderBy: [{ status: "desc" }, { createdAt: "desc" }], select: { id: true, name: true, status: true } });
}
export type OfferCampaign = Awaited<ReturnType<typeof offerCampaigns>>[number];

async function sendOfferEmail(to: string, name: string, campaign: string, companyName: string, link: string, expiresAt: Date): Promise<boolean> {
  const until = expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Africa/Kigali" });
  const { html, text } = renderEmail({
    heading: `${companyName} invites you: ${campaign}`,
    intro: `Hi ${name.trim().split(/\s+/)[0] || "there"}, ${companyName} found you on BuPulse and invites you to their creator campaign "${campaign}". Open your creator account to read the brief and the pay, then accept or decline.`,
    button: { label: "See the invitation", url: link },
    footer: `The invitation is open until ${until}. You get this email because you let companies find you on BuPulse; you can turn that off in your creator profile.`,
  });
  return sendEmail({ to, subject: `${companyName} invites you to "${campaign}"`, html, text }).catch(() => false);
}

/**
 * Invites a creator who can be found (`discoverable`, not blocked) to one of the company's live or draft campaigns.
 * Refused when the creator already applied, is invited or in the campaign, has an offer still open, or every place on
 * the plan is taken (under the campaign's lock, like selecting). An expired or declined offer is made again on the
 * same row. The creator is emailed after the change is saved.
 */
export async function offerCreator(actor: CampaignActor, input: { profileId: string; campaignId: string }, now = new Date()) {
  assertManager(actor);
  const campaign = await prisma.creatorCampaign.findFirst({ where: { id: input.campaignId, businessId: actor.businessId }, select: { id: true, name: true, status: true, business: { select: { name: true } } } });
  if (!campaign) throw new CreatorCampaignError("not_found", "That campaign no longer exists.");
  if (!OPEN_FOR_OFFERS.includes(campaign.status)) throw new CreatorCampaignError("conflict", "Invite creators to a live or draft campaign.");
  const profile = await prisma.creatorProfile.findUnique({
    where: { id: input.profileId },
    select: { id: true, name: true, phone: true, handles: true, samples: true, discoverable: true, blockedAt: true, user: { select: { email: true } } },
  });
  if (!profile || !profile.discoverable) throw new CreatorCampaignError("not_found", "This creator is not taking invitations from companies.");
  if (profile.blockedAt) throw new CreatorCampaignError("conflict", "BuPulse blocked this creator from the marketplace, so they cannot be invited.");
  const email = profile.user.email.trim().toLowerCase();
  const { creatorsPerCampaign } = await campaignLimits(actor.businessId);

  const row = await prisma.$transaction(async (tx) => {
    await lock(tx, campaign.id);
    const existing = await tx.campaignCreator.findFirst({ where: { campaignId: campaign.id, OR: [{ profileId: profile.id }, { email }] }, select: { id: true, status: true, source: true, offeredAt: true } });
    if (existing) {
      if (existing.status === "OFFERED" && !offerExpired(existing.offeredAt, now)) throw new CreatorCampaignError("conflict", "You already invited this creator to this campaign. They have until the invitation expires to answer.");
      if (existing.status === "APPLIED") throw new CreatorCampaignError("conflict", "This creator already applied to this campaign: answer them on Applicants.");
      if (existing.status === "SELECTED" || existing.status === "JOINED") throw new CreatorCampaignError("conflict", "This creator is already in this campaign.");
      if (existing.status === "REMOVED") throw new CreatorCampaignError("conflict", "You removed this creator from this campaign.");
      if (existing.status === "DECLINED" && existing.source !== "OFFER") throw new CreatorCampaignError("conflict", "This creator applied before and was declined: pick them on Applicants with Select after all.");
    }
    if ((await placesTaken(tx, campaign.id, now)) >= creatorsPerCampaign) throw new CreatorCampaignError("limit", placesFullMessage(creatorsPerCampaign));
    const data = {
      status: "OFFERED",
      source: "OFFER",
      offeredBy: actor.actorId,
      offeredAt: now,
      profileId: profile.id,
      name: profile.name,
      email,
      phone: profile.phone,
      handles: readHandles(profile.handles) as unknown as Prisma.InputJsonValue,
      samples: profile.samples.slice(0, 3),
      inviteTokenHash: null,
      inviteExpiresAt: null,
    };
    if (existing) {
      // Only an expired or answered offer gets here: it is made again, from the profile as it is now.
      const done = await tx.campaignCreator.updateMany({ where: { id: existing.id, status: existing.status }, data });
      if (done.count === 0) throw new CreatorCampaignError("conflict", "Someone changed this just now. Open the page again.");
      return { id: existing.id };
    }
    return tx.campaignCreator.create({ data: { campaignId: campaign.id, ...data }, select: { id: true } });
  });

  const expiresAt = offerExpiresAt(now);
  const sent = await sendOfferEmail(email, profile.name, campaign.name, campaign.business.name, `${await linkSiteUrl()}/creator`, expiresAt);
  return { id: row.id, name: profile.name, campaignName: campaign.name, expiresAt: expiresAt.toISOString(), sent };
}

/** Takes back an offer the creator has not answered (expired ones too): DECLINED, and its place is free again. */
export async function withdrawOffer(actor: CampaignActor, campaignCreatorId: string) {
  assertManager(actor);
  const row = await creatorOf(actor, campaignCreatorId);
  if (row.status !== "OFFERED") throw new CreatorCampaignError("conflict", "This creator already answered your invitation.");
  const done = await prisma.campaignCreator.updateMany({ where: { id: row.id, status: "OFFERED" }, data: { status: "DECLINED" } });
  if (done.count === 0) throw new CreatorCampaignError("conflict", "This creator answered just now. Open the page again.");
}

/** Every open offer to a creator, withdrawn (an admin blocked them). Returns how many. */
export async function withdrawAllOffers(tx: Pick<typeof prisma, "campaignCreator">, profileId: string): Promise<number> {
  const { count } = await tx.campaignCreator.updateMany({ where: { profileId, status: "OFFERED" }, data: { status: "DECLINED" } });
  return count;
}

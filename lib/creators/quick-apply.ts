import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { rateLimit, RateLimitError, rateLimitMessage } from "@/lib/rate-limit";
import { loadPublicCampaign, takesApplications, type PublicCampaign } from "./apply";
import { readAnswers, type ApplicationErrors } from "./application";
import { placesLeftIn } from "./marketplace";
import { profileGaps, readHandles, type ProfileGap } from "./profile-form";

// Applying in one tap with a creator account (docs/CREATOR_MARKETPLACE.md, "Creator accounts"): the profile fills the
// application (CampaignCreator APPLIED, source MARKETPLACE, profileId set at once) and the creator only answers the
// company's own questions. The same rules as the form on /c/<slug>, plus the account's: one application per email
// (and per profile) per campaign, not blocked, a complete profile, a place left.

export type Viewer =
  | { kind: "guest" }
  /** Signed in without a creator profile: a company person. Creators apply with a creator account. */
  | { kind: "company" }
  | { kind: "creator"; profileId: string; name: string; blocked: boolean; gaps: ProfileGap[]; applied: { status: string } | null };

/** Who is looking at a campaign's page, and what they can do there. */
export async function viewerOf(campaign: Pick<PublicCampaign, "id" | "platforms">, user: { id: string; email?: string | null; email_confirmed_at?: string | null } | null): Promise<Viewer> {
  if (!user?.email_confirmed_at) return { kind: "guest" };
  const profile = await prisma.creatorProfile.findUnique({ where: { userId: user.id }, select: { id: true, name: true, phone: true, handles: true, blockedAt: true } });
  if (!profile) return { kind: "company" };
  const email = (user.email ?? "").trim().toLowerCase();
  const applied = await prisma.campaignCreator.findFirst({ where: { campaignId: campaign.id, OR: [{ profileId: profile.id }, ...(email ? [{ email }] : [])] }, select: { status: true } });
  return { kind: "creator", profileId: profile.id, name: profile.name, blocked: profile.blockedAt !== null, gaps: profileGaps(profile, campaign.platforms), applied };
}

const HOUR = 60 * 60;
/** Per creator: plenty for a person, little for a script. */
export const QUICK_APPLY_LIMIT = { limit: 20, windowSeconds: HOUR };

export type QuickApplyResult = { ok: true } | { ok: false; error?: string; errors?: ApplicationErrors; incomplete?: boolean };

const CLOSED = "This campaign is not taking applications right now.";

/** Applies the signed-in creator to the campaign behind `slug` with their profile and the answers in `form`. */
export async function quickApply(user: { userId: string; email: string }, slug: string, form: { get(name: string): unknown }): Promise<QuickApplyResult> {
  const campaign = await loadPublicCampaign(slug);
  // Hidden by an admin: off the marketplace, and no new applications from accounts either.
  if (!campaign || !takesApplications(campaign) || campaign.hidden) return { ok: false, error: CLOSED };
  const profile = await prisma.creatorProfile.findUnique({ where: { userId: user.userId }, select: { id: true, name: true, phone: true, handles: true, samples: true, blockedAt: true } });
  if (!profile) return { ok: false, error: "Creators apply with a creator account." };
  if (profile.blockedAt) return { ok: false, error: "Your creator account cannot apply to campaigns right now. Write to BuPulse if you think this is a mistake." };
  if (profileGaps(profile, campaign.platforms).length) return { ok: false, incomplete: true, error: "Complete your profile first." };
  try {
    await rateLimit(`creator-quick-apply:${profile.id}`, QUICK_APPLY_LIMIT);
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    throw error;
  }

  const errors: ApplicationErrors = {};
  const answers = readAnswers(form, campaign.questions, errors);
  if (Object.keys(errors).length) return { ok: false, errors };

  const email = user.email.trim().toLowerCase();
  const before = await prisma.campaignCreator.findFirst({ where: { campaignId: campaign.id, OR: [{ profileId: profile.id }, { email }] }, select: { status: true } });
  if (before) return { ok: false, error: before.status === "OFFERED" ? "The company already invited you to this campaign: answer on your Campaigns page." : "You already applied to this campaign." };
  if ((await placesLeftIn({ id: campaign.id, businessId: campaign.company.id })) === 0) return { ok: false, error: "All places in this campaign are taken." };

  const handles = readHandles(profile.handles).filter((h) => campaign.platforms.includes(h.network));
  const saved = await prisma.campaignCreator.createMany({
    data: [
      {
        campaignId: campaign.id,
        profileId: profile.id,
        source: "MARKETPLACE",
        status: "APPLIED",
        name: profile.name,
        email,
        phone: profile.phone,
        handles: handles as unknown as Prisma.InputJsonValue,
        samples: profile.samples.slice(0, 3),
        answers: Object.keys(answers).length ? answers : undefined,
      },
    ],
    skipDuplicates: true,
  });
  if (saved.count === 0) return { ok: false, error: "You already applied to this campaign." };
  return { ok: true };
}

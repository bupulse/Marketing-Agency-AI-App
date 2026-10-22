import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { rateLimit, RateLimitError, rateLimitMessage } from "@/lib/rate-limit";
import { loadPublicCampaign, takesApplications, type PublicCampaign } from "./apply";
import type { ApplicationErrors, FormLike } from "./application";
import { checkApplicationUploads } from "./application-uploads";
import { readApplicationForm, type ApplicationForm } from "./form-fields";
import { placesLeftIn } from "./marketplace";
import { profileGaps, readHandles, type ProfileGap } from "./profile-form";
import { readQuickApplication } from "./quick-apply-form";

// Applying in one tap with a creator account (docs/CREATOR_MARKETPLACE.md, "Creator accounts"): the profile fills the
// application (CampaignCreator APPLIED, source MARKETPLACE, profileId set at once) and the creator only answers what
// the profile cannot (lib/creators/quick-apply-form.ts: the company's required fields, and the basics they changed).
// The same rules as the form on /c/<slug>, plus the account's: one application per email (and per profile) per
// campaign, not blocked, a complete profile, a place left.

/** The gaps that block one tap: the WhatsApp number only when the company's form requires it. */
const gapsFor = (profile: { phone: string | null; handles: unknown }, platforms: string[], form?: ApplicationForm) =>
  profileGaps(profile, platforms).filter((g) => g !== "phone" || (form?.phone ?? "REQUIRED") === "REQUIRED");

export type Viewer =
  | { kind: "guest" }
  /** Signed in without a creator profile: a company person. Creators apply with a creator account. */
  | { kind: "company" }
  | { kind: "creator"; profileId: string; name: string; blocked: boolean; gaps: ProfileGap[]; applied: { status: string } | null };

/** Who is looking at a campaign's page, and what they can do there. */
export async function viewerOf(campaign: Pick<PublicCampaign, "id" | "platforms"> & { form?: ApplicationForm }, user: { id: string; email?: string | null; email_confirmed_at?: string | null } | null): Promise<Viewer> {
  if (!user?.email_confirmed_at) return { kind: "guest" };
  const profile = await prisma.creatorProfile.findUnique({ where: { userId: user.id }, select: { id: true, name: true, phone: true, handles: true, blockedAt: true } });
  if (!profile) return { kind: "company" };
  const email = (user.email ?? "").trim().toLowerCase();
  const applied = await prisma.campaignCreator.findFirst({ where: { campaignId: campaign.id, OR: [{ profileId: profile.id }, ...(email ? [{ email }] : [])] }, select: { status: true } });
  return { kind: "creator", profileId: profile.id, name: profile.name, blocked: profile.blockedAt !== null, gaps: gapsFor(profile, campaign.platforms, campaign.form), applied };
}

const HOUR = 60 * 60;
/** Per creator: plenty for a person, little for a script. */
export const QUICK_APPLY_LIMIT = { limit: 20, windowSeconds: HOUR };

export type QuickApplyResult = { ok: true } | { ok: false; error?: string; errors?: ApplicationErrors; incomplete?: boolean };

const CLOSED = "This campaign is not taking applications right now.";

/** Applies the signed-in creator to the campaign behind `slug` with their profile and the answers in `form`. */
export async function quickApply(user: { userId: string; email: string }, slug: string, posted: FormLike): Promise<QuickApplyResult> {
  const campaign = await loadPublicCampaign(slug);
  // Hidden by an admin: off the marketplace, and no new applications from accounts either.
  if (!campaign || !takesApplications(campaign) || campaign.hidden) return { ok: false, error: CLOSED };
  // Campaigns made before the wizard (and the tests' campaigns) carry their questions only.
  const form = campaign.form ?? readApplicationForm(null, campaign.questions);
  const profile = await prisma.creatorProfile.findUnique({ where: { userId: user.userId }, select: { id: true, name: true, phone: true, location: true, handles: true, samples: true, blockedAt: true } });
  if (!profile) return { ok: false, error: "Creators apply with a creator account." };
  if (profile.blockedAt) return { ok: false, error: "Your creator account cannot apply to campaigns right now. Write to BuPulse if you think this is a mistake." };
  if (gapsFor(profile, campaign.platforms, form).length) return { ok: false, incomplete: true, error: "Complete your profile first." };
  try {
    await rateLimit(`creator-quick-apply:${profile.id}`, QUICK_APPLY_LIMIT);
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    throw error;
  }

  const read = readQuickApplication(posted, form, { name: profile.name, phone: profile.phone, location: profile.location ?? null, samples: profile.samples }, campaign.company.country ?? null);
  if (!read.ok) return { ok: false, errors: read.errors };
  const a = read.value;
  const errors: ApplicationErrors = {};
  await checkApplicationUploads(campaign.id, form.fields, a.answers, errors);
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
        name: a.name,
        email,
        phone: a.phone,
        handles: handles as unknown as Prisma.InputJsonValue,
        samples: a.samples,
        answers: Object.keys(a.answers).length ? (a.answers as Prisma.InputJsonValue) : undefined,
      },
    ],
    skipDuplicates: true,
  });
  if (saved.count === 0) return { ok: false, error: "You already applied to this campaign." };
  return { ok: true };
}

import "server-only";
import { prisma } from "@/lib/db";
import { hasFeature } from "@/lib/entitlements";
import { rateLimit, RateLimitError, rateLimitMessage } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { CREATOR_MEDIA_BUCKET } from "./media";
import { readPayRules } from "./pay";
import { ymdOf } from "./periods";
import { readApplication, type ApplicationErrors } from "./application";
import { applicationFileProblem, checkApplicationUploads, newUploadPath, UPLOAD_LIMIT_CAMPAIGN, UPLOAD_LIMIT_IP } from "./application-uploads";
import { readQuestions, type CampaignQuestion } from "./company-forms";
import { readApplicationForm, type ApplicationForm } from "./form-fields";
import { readRequirements, type CreatorRequirements } from "./requirements";
import { isSlug } from "./slug";
import { readFiles, readLook, type CampaignFiles } from "./wizard";

// The public application page /c/<slug> (docs/CREATOR_CAMPAIGNS.md, "Applying"): what the page shows, and saving an
// application as a CampaignCreator row (APPLIED). One application per email per campaign, limited per address and
// campaign. The form is the one the company built (docs/CREATOR_CAMPAIGN_WIZARD.md), or the default form with the
// questions of a campaign made before the wizard.

export type PublicCampaign = {
  id: string;
  slug: string;
  name: string;
  brief: string;
  rules: string | null;
  status: string;
  acceptingApplications: boolean;
  /** On the marketplace: the company's switch on and not hidden by an admin (docs/CREATOR_MARKETPLACE.md). */
  listed: boolean;
  hidden: boolean;
  startsOn: string;
  endsOn: string;
  platforms: string[];
  mentions: string[];
  currency: string;
  payRules: ReturnType<typeof readPayRules>;
  goals: { viewTargetPerCreator: number | null; viewTargetCampaign: number | null; budget: number | null };
  questions: CampaignQuestion[];
  /** The application form (readApplicationForm: the built one, or the default with `questions`). */
  form: ApplicationForm;
  requirements: CreatorRequirements;
  formats: string[];
  dos: string[];
  donts: string[];
  files: CampaignFiles;
  /** The cover picked on the wizard's Look step (a MediaAsset of the company), signed by the page (campaignCover). */
  coverAssetId: string | null;
  company: { id: string; name: string; country: string | null; timezone: string; logoUrl: string | null; brandColors: string[] };
};

/** The campaign behind a slug, or null when there is none or its company no longer has the feature. */
export async function loadPublicCampaign(slug: string, now = new Date()): Promise<PublicCampaign | null> {
  if (!isSlug(slug)) return null;
  const c = await prisma.creatorCampaign.findUnique({
    where: { slug },
    include: {
      business: { select: { id: true, name: true, country: true, timezone: true, logoUrl: true, brandColors: true } },
      periods: { where: { endsAt: { gt: now } }, orderBy: { index: "asc" }, take: 1, select: { viewTargetPerCreator: true, viewTargetCampaign: true, budget: true } },
    },
  });
  if (!c || !(await hasFeature({ businessId: c.businessId }, "creators"))) return null;
  // The goals of the period that is open now (or the next one); the campaign's defaults before there are periods.
  const period = c.periods[0];
  let logoUrl: string | null = null;
  if (c.business.logoUrl) {
    const signed = await createAdminClient().storage.from("brand").createSignedUrl(c.business.logoUrl, 60 * 60).catch(() => null);
    logoUrl = signed?.data?.signedUrl ?? null;
  }
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    brief: c.brief,
    rules: c.rules,
    status: c.status,
    acceptingApplications: c.acceptingApplications,
    listed: c.listed,
    hidden: c.hiddenAt !== null,
    startsOn: ymdOf(c.startsOn),
    endsOn: ymdOf(c.endsOn),
    platforms: c.platforms,
    mentions: c.mentions,
    currency: c.currency,
    payRules: readPayRules(c.payRules),
    goals: period ?? { viewTargetPerCreator: c.viewTargetPerCreator, viewTargetCampaign: c.viewTargetCampaign, budget: null },
    questions: readQuestions(c.questions),
    form: readApplicationForm(c.applicationForm, readQuestions(c.questions)),
    requirements: readRequirements(c.requirements),
    formats: c.formats,
    dos: c.dos,
    donts: c.donts,
    files: readFiles(c.files),
    coverAssetId: readLook(c.look).coverAssetId ?? null,
    company: { id: c.business.id, name: c.business.name, country: c.business.country, timezone: c.business.timezone || "UTC", logoUrl, brandColors: c.business.brandColors },
  };
}

/** Open for applications: LIVE and switched on. */
export const takesApplications = (c: Pick<PublicCampaign, "status" | "acceptingApplications">) => c.status === "LIVE" && c.acceptingApplications;

/** A member of the campaign's company may look at a campaign that is not live yet (a preview, nothing can be sent). */
export async function canPreview(campaign: Pick<PublicCampaign, "company">, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const m = await prisma.membership.findUnique({ where: { userId }, select: { businessId: true } });
  return m?.businessId === campaign.company.id;
}

const HOUR = 60 * 60;
/** Per address and campaign: a few people can share one phone or office network. */
export const APPLY_LIMIT = { limit: 8, windowSeconds: HOUR };

async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`bupulse-apply:${text}`));
  return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A visitor's address as a rate-limit key: hashed, so the RateLimit table holds no addresses. */
export const ipKey = (ip: string | null) => shortHash(ip ?? "unknown");

export type ApplyResult = { ok: true } | { ok: false; error?: string; errors?: ApplicationErrors };

/** Saves an application from the form. */
export async function submitApplication(slug: string, form: FormData, ip: string | null): Promise<ApplyResult> {
  const campaign = await loadPublicCampaign(slug);
  // Hidden by a BuPulse admin (docs/CREATOR_MARKETPLACE.md, "Safety"): no new applications.
  if (!campaign || !takesApplications(campaign) || campaign.hidden) return { ok: false, error: "This campaign is not taking applications right now." };
  try {
    await rateLimit(`creator-apply:${campaign.id}:${await ipKey(ip)}`, APPLY_LIMIT);
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    throw error;
  }
  const read = readApplication(form, { platforms: campaign.platforms, questions: campaign.questions, country: campaign.company.country, form: campaign.form });
  if (!read.ok) return { ok: false, errors: read.errors };
  const a = read.value;
  const errors: ApplicationErrors = {};
  await checkApplicationUploads(campaign.id, campaign.form.fields, a.answers, errors);
  if (Object.keys(errors).length) return { ok: false, errors };
  const saved = await prisma.campaignCreator.createMany({
    data: [{ campaignId: campaign.id, status: "APPLIED", name: a.name, email: a.email, phone: a.phone, handles: a.handles, samples: a.samples, answers: Object.keys(a.answers).length ? a.answers : undefined }],
    skipDuplicates: true,
  });
  if (saved.count === 0) return { ok: false, errors: { email: "You already applied to this campaign with this email." } };
  return { ok: true };
}

export type ApplicationUpload = { ok: true; path: string; token: string } | { ok: false; error: string };

/** A signed upload URL for one file of an UPLOAD field of the campaign behind `slug` (lib/creators/application-uploads.ts). */
export async function startApplicationUpload(slug: string, fieldId: string, file: { type: string; size: number }, ip: string | null): Promise<ApplicationUpload> {
  const campaign = await loadPublicCampaign(slug);
  if (!campaign || !takesApplications(campaign) || campaign.hidden) return { ok: false, error: "This campaign is not taking applications right now." };
  const field = campaign.form.fields.find((f) => f.id === fieldId && f.type === "UPLOAD");
  if (!field) return { ok: false, error: "This question does not take files." };
  const problem = applicationFileProblem(file, field.accept);
  if (problem) return { ok: false, error: problem };
  try {
    await rateLimit(`creator-apply-upload:${await ipKey(ip)}`, UPLOAD_LIMIT_IP);
    await rateLimit(`creator-apply-upload-campaign:${campaign.id}`, UPLOAD_LIMIT_CAMPAIGN);
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    throw error;
  }
  const path = newUploadPath(campaign.id, file.type);
  const { data, error } = await createAdminClient().storage.from(CREATOR_MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "The upload could not start. Please try again." };
  return { ok: true, path: data.path, token: data.token };
}

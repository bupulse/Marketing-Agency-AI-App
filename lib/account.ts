import { EVENT_NAMES, trackEvent } from "@/lib/analytics/events";
import "server-only";
import type { User as AuthUser } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import type { SignUpMethod } from "@/lib/generated/prisma/client";
import { getIndustries, slugForIndustryName } from "@/lib/industries/server";
import { INDUSTRY_DESCRIPTION_MIN } from "@/lib/industries/shared";
import { phoneCountry, toE164 } from "@/lib/phone";
import { regionFromCountryName } from "@/lib/region";
import { noteRegionMismatch } from "@/lib/region-check";
import { assignReferral, refFromCookie } from "@/lib/sales/referral";
import { timezoneForCountryName } from "@/lib/region-format";

type SignUpDetails = {
  organisationName: string | null;
  ceoName: string | null;
  /** Legacy label: the sector's name, or the owner's own text. */
  industry: string | null;
  /** Sector slug from the form (empty for "Other" and for sign-ups before industries were data). */
  industrySlug: string | null;
  industryOther: string | null;
  industryDescription: string | null;
  country: string | null;
  phone: string | null;
  website: string | null;
};

function text(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().slice(0, max);
  return v || null;
}

// Details collected by the /signup form are stored in Supabase user metadata.
function signUpDetails(meta: AuthUser["user_metadata"] | undefined): SignUpDetails {
  return {
    organisationName: text(meta?.organisation_name, 120),
    ceoName: text(meta?.ceo_name, 100),
    industry: text(meta?.industry, 80),
    industrySlug: text(meta?.industry_slug, 60),
    industryOther: text(meta?.industry_other, 80),
    industryDescription: text(meta?.industry_description, 500),
    country: text(meta?.country, 80),
    phone: text(meta?.phone, 30),
    website: text(meta?.website),
  };
}

/**
 * The Business industry columns from the sign-up metadata: the slug links the sector; an older sign-up that stored
 * only the name is linked by name; anything else is the owner's own text. The phone becomes E.164 for the country.
 */
async function industryColumns(d: SignUpDetails) {
  // The metadata is client-writable: apply the form's rules again. Anything invalid stores nothing for the industry,
  // so /welcome (and Brand) ask again.
  if (!(d.industryDescription && d.industryDescription.length >= INDUSTRY_DESCRIPTION_MIN)) return { industry: null, industryId: null, industryOther: null, industryDescription: null };
  const slug = d.industrySlug ?? slugForIndustryName(d.industry);
  const row = slug ? (await getIndustries()).find((i) => i.slug === slug) ?? null : null;
  if (row?.active) return { industry: row.name, industryId: row.id, industryOther: null, industryDescription: d.industryDescription };
  if (row) return { industry: null, industryId: null, industryOther: null, industryDescription: null };
  const other = d.industryOther ?? (d.industry && d.industry.toLowerCase() !== "other" ? d.industry : null);
  if (!other) return { industry: null, industryId: null, industryOther: null, industryDescription: null };
  return { industry: other, industryId: null, industryOther: other, industryDescription: d.industryDescription };
}

// True when the required sign-up details are all there. Email sign-ups always have
// them; Google sign-ups don't and complete them on /welcome.
// A sector that failed the form's rules counts as missing, so /welcome asks again.
function hasRequiredDetails(d: SignUpDetails, sector: { industry: string | null }) {
  return Boolean(d.organisationName && d.ceoName && sector.industry && d.country);
}

// Google-only accounts have just a "google" identity; anything with an email identity
// was created through the sign-up form.
function signUpMethodOf(authUser: AuthUser): SignUpMethod {
  const providers = authUser.identities?.map((i) => i.provider) ?? authUser.app_metadata?.providers ?? [];
  return providers.includes("google") && !providers.includes("email") ? "GOOGLE" : "PASSWORD";
}

// Called after email confirmation and after Google sign-in. Creates the app's
// User row, the Business (from the sign-up details when there are any, with its
// pricing region from the country) and a subscription that waits for a demo
// (PENDING_DEMO: no trial starts at sign-up, an admin starts it after the demo,
// docs/REGIONS.md) the first time; does nothing for returning users. Returns false
// without creating anything when the email has not been confirmed yet.
export async function ensureAccount(authUser: AuthUser, opts: { visitSession?: string | null } = {}): Promise<boolean> {
  const email = authUser.email;
  if (!email) throw new Error("Signed-in user has no email address");
  if (!authUser.email_confirmed_at) return false;

  // Hot path (every page and action): a returning user only needs a cheap lookup. The upsert
  // below runs a transaction, so it is kept for the first visit and for email changes.
  const existing = await prisma.user.findUnique({ where: { id: authUser.id }, select: { email: true } });
  if (existing && existing.email === email) return true;

  const details = signUpDetails(authUser.user_metadata);
  const name =
    text(authUser.user_metadata?.full_name, 100) ??
    text(authUser.user_metadata?.name, 100) ??
    details.ceoName;

  const now = new Date();
  const pricingRegion = await regionFromCountryName(details.country);
  const sector = await industryColumns(details);
  const phone = details.phone ? (toE164(details.phone, phoneCountry(details.country)) ?? details.phone) : null;

  const created = await prisma.user.upsert({
    where: { id: authUser.id },
    update: { email },
    create: {
      id: authUser.id,
      email,
      name,
      signUpMethod: signUpMethodOf(authUser),
      business: {
        create: {
          name: details.organisationName ?? "My business",
          ...sector,
          website: details.website,
          ceoName: details.ceoName,
          country: details.country,
          phone,
          pricingRegion,
          // Rwanda and the EAC countries have one zone each; elsewhere the browser sets it on the first dashboard visit.
          ...(timezoneForCountryName(details.country) ? { timezone: timezoneForCountryName(details.country) as string } : {}),
          detailsCompletedAt: hasRequiredDetails(details, sector) ? now : null,
          // The person who signs up owns the company; teammates are added from Settings → Team.
          memberships: { create: { userId: authUser.id, role: "OWNER" } },
        },
      },
      subscription: {
        create: {
          plan: "TRIAL",
          status: "PENDING_DEMO",
          trialEndsAt: null,
          currentPeriodStart: now,
          currentPeriodEnd: null,
        },
      },
    },
    include: { business: { select: { id: true } } },
  });
  if (!existing) {
    // The anonymous visit session (tracker) rides along in the sign-up metadata, or the Google redirect.
    const sessionId = opts.visitSession ?? text(authUser.user_metadata?.visit_session, 40);
    const track = { userId: authUser.id, businessId: created.business?.id, sessionId };
    // trial_started is recorded when an admin starts the trial after the demo (lib/admin/demos.ts).
    await trackEvent(EVENT_NAMES.signup, { ...track, props: { method: signUpMethodOf(authUser), industry: sector.industry, region: pricingRegion } });
    // Soft region check: the sign-up's IP country in a dearer region than the declared country is flagged for the
    // admin (docs/REGIONS.md). Google sign-ups pick their country on /welcome, which checks then.
    if (created.business?.id && details.country) await noteRegionMismatch(created.business.id, "signup");
    // A sales agent's link: the code saved at sign-up, else the cookie (Google). Never fails the sign-up.
    if (created.business?.id) await assignReferral({ businessId: created.business.id, userId: authUser.id, code: text(authUser.user_metadata?.ref_code, 8) ?? (await refFromCookie()) });
  }
  return true;
}

export type AccountByEmail = { method: SignUpMethod; hasPassword: boolean };

/** The registered account for an address (any letter case), with whether it has a password. */
export async function findAccountByEmail(email: string): Promise<AccountByEmail | null> {
  const rows = await prisma.$queryRaw<{ method: SignUpMethod; has_password: boolean }[]>`
    SELECT u."signUpMethod" AS method, COALESCE(a.encrypted_password, '') <> '' AS has_password
    FROM public."User" u JOIN auth.users a ON a.id = u.id
    WHERE lower(u.email) = lower(${email})
    LIMIT 1`;
  return rows[0] ? { method: rows[0].method, hasPassword: rows[0].has_password } : null;
}

/**
 * Accounts created with a password sign in with their password only. Supabase links a
 * Google login to an existing account with the same email automatically, so when that
 * happens this removes the Google login again and returns false.
 */
export async function allowGoogleSignIn(authUser: AuthUser): Promise<boolean> {
  const existing = await prisma.user.findUnique({ where: { id: authUser.id }, select: { signUpMethod: true } });
  if (existing?.signUpMethod !== "PASSWORD") return true;
  await prisma.$executeRaw`DELETE FROM auth.identities WHERE user_id = ${authUser.id}::uuid AND provider = 'google'`;
  return false;
}

/**
 * A Google account that sets a password (through "Forgot password?") becomes a password account: from then on it signs
 * in with the password only and Google sign-in is refused, the same as for an account created with a password.
 */
export async function switchToPasswordOnly(userId: string): Promise<void> {
  const updated = await prisma.user.updateMany({
    where: { id: userId, signUpMethod: "GOOGLE" },
    data: { signUpMethod: "PASSWORD" },
  });
  if (updated.count) await prisma.$executeRaw`DELETE FROM auth.identities WHERE user_id = ${userId}::uuid AND provider = 'google'`;
}

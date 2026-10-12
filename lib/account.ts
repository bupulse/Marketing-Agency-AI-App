import { EVENT_NAMES, trackEvent } from "@/lib/analytics/events";
import "server-only";
import type { User as AuthUser } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import type { SignUpMethod } from "@/lib/generated/prisma/client";
import { regionFromCountryName } from "@/lib/region";
import { timezoneForCountryName } from "@/lib/region-format";

type SignUpDetails = {
  organisationName: string | null;
  ceoName: string | null;
  industry: string | null;
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
    country: text(meta?.country, 80),
    phone: text(meta?.phone, 30),
    website: text(meta?.website),
  };
}

// True when the required sign-up details are all there. Email sign-ups always have
// them; Google sign-ups don't and complete them on /welcome.
function hasRequiredDetails(d: SignUpDetails) {
  return Boolean(d.organisationName && d.ceoName && d.industry && d.country);
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
          industry: details.industry,
          website: details.website,
          ceoName: details.ceoName,
          country: details.country,
          phone: details.phone,
          pricingRegion,
          // Rwanda and the EAC countries have one zone each; elsewhere the browser sets it on the first dashboard visit.
          ...(timezoneForCountryName(details.country) ? { timezone: timezoneForCountryName(details.country) as string } : {}),
          detailsCompletedAt: hasRequiredDetails(details) ? now : null,
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
    trackEvent(EVENT_NAMES.signup, { ...track, props: { method: signUpMethodOf(authUser), industry: details.industry ?? null, region: pricingRegion } });
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

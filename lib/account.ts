import "server-only";
import type { User as AuthUser } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import type { SignUpMethod } from "@/lib/generated/prisma/client";
import { TRIAL_DAYS } from "@/lib/plans";

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
// User row, the Business (from the sign-up details when there are any) and the
// 7-day trial the first time; does nothing for returning users. Returns false
// without creating anything when the email has not been confirmed yet, so a
// trial never starts for an unverified address.
export async function ensureAccount(authUser: AuthUser): Promise<boolean> {
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
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.user.upsert({
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
          detailsCompletedAt: hasRequiredDetails(details) ? now : null,
        },
      },
      subscription: {
        create: {
          plan: "TRIAL",
          status: "TRIALING",
          trialEndsAt,
          currentPeriodStart: now,
          currentPeriodEnd: trialEndsAt,
        },
      },
    },
  });
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

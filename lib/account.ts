import "server-only";
import type { User as AuthUser } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
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

// Called after email confirmation and after Google sign-in. Creates the app's
// User row, the Business (from the sign-up details when there are any) and the
// 7-day trial the first time; does nothing for returning users. Returns false
// without creating anything when the email has not been confirmed yet, so a
// trial never starts for an unverified address.
export async function ensureAccount(authUser: AuthUser): Promise<boolean> {
  const email = authUser.email;
  if (!email) throw new Error("Signed-in user has no email address");
  if (!authUser.email_confirmed_at) return false;

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
      business: {
        create: {
          name: details.organisationName ?? "My business",
          industry: details.industry,
          website: details.website,
          ceoName: details.ceoName,
          country: details.country,
          phone: details.phone,
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

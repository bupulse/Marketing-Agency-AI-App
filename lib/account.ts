import "server-only";
import type { User as AuthUser } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import { TRIAL_DAYS } from "@/lib/plans";

// Called after every successful sign-in. Creates the app's User row, a
// placeholder Business (filled in by onboarding later) and the 7-day trial
// the first time; does nothing for returning users.
export async function ensureAccount(authUser: AuthUser) {
  const email = authUser.email;
  if (!email) throw new Error("Signed-in user has no email address");

  const name =
    (authUser.user_metadata?.full_name as string | undefined) ??
    (authUser.user_metadata?.name as string | undefined) ??
    null;

  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.user.upsert({
    where: { id: authUser.id },
    update: { email },
    create: {
      id: authUser.id,
      email,
      name,
      business: { create: { name: "My business" } },
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
}

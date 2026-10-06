import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureAccount } from "@/lib/account";
import { getCurrentUser } from "@/lib/supabase/server";
import { getUsageSummary } from "@/lib/usage";
import { createSignedDownloadUrl } from "@/lib/storage";
import { getVoice } from "@/lib/brand/voices";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Everything the app shell and pages need about the signed-in user, loaded once
 * per request (React `cache` dedupes the layout and page calls).
 */
export const getAppContext = cache(async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Safety net only: sessions are normally created after email confirmation,
  // and ensureAccount never starts a trial for an unconfirmed address.
  if (!(await ensureAccount(user))) redirect("/login?error=confirm");
  const [business, usage] = await Promise.all([
    prisma.business.findUnique({ where: { userId: user.id } }),
    getUsageSummary(user.id),
  ]);
  // Order matters: a pending deletion locks the account, Google sign-ups give their
  // organisation details first, then everyone completes the brand onboarding.
  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { deletionScheduledFor: true, name: true } });
  if (account?.deletionScheduledFor) redirect("/account/deletion");
  if (!business?.detailsCompletedAt) redirect("/welcome");
  if (!business.onboardedAt) redirect("/onboarding");

  const meta = user.user_metadata as { full_name?: string; name?: string } | undefined;
  // The name saved in Settings wins; Google sign-ups start with their Google name.
  const fullName = account?.name?.trim() || meta?.full_name || meta?.name || business.ceoName || null;
  const displayName = fullName ?? user.email?.split("@")[0] ?? "there";
  const firstName = displayName.split(/\s+/)[0];

  const { subscription } = usage;
  const isTrial = subscription.plan === "TRIAL";
  const trialDaysLeft =
    isTrial && subscription.trialEndsAt
      ? Math.max(0, Math.ceil((subscription.trialEndsAt.getTime() - Date.now()) / DAY_MS))
      : null;

  // The logo lives in the private brand bucket; a failed signing just means no logo.
  let logoUrl: string | null = null;
  if (business.logoUrl) {
    try {
      logoUrl = await createSignedDownloadUrl("brand", business.logoUrl);
    } catch {
      logoUrl = null;
    }
  }

  return {
    user,
    email: user.email ?? "",
    displayName,
    firstName,
    business,
    businessName: business?.name ?? "My business",
    usage,
    isTrial,
    trialDaysLeft,
    logoUrl,
    brandColors: business.brandColors,
    voiceLabel: getVoice(business.tone)?.label ?? null,
  };
});

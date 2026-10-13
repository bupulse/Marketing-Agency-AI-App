import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureAccount } from "@/lib/account";
import { getCurrentUser } from "@/lib/supabase/server";
import { companyEntitlements } from "@/lib/entitlements";
import { getUsageSummary } from "@/lib/usage";
import { createSignedDownloadUrl } from "@/lib/storage";
import { getVoice } from "@/lib/brand/voices";
import { resolveCompany } from "@/lib/team/company";
import { can, type Role } from "@/lib/team/roles";
import { heartbeat } from "@/lib/staff/heartbeat";

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
  // The company comes through Membership. `ownerId` (Business.userId) is the company account that owns the plan,
  // the credits and the Storage folder, so a teammate sees and spends the company's, not their own.
  const company = await resolveCompany(user.id);
  const ownerId = company?.ownerId ?? user.id;
  const [business, usage] = await Promise.all([
    prisma.business.findUnique({ where: { userId: ownerId } }),
    getUsageSummary(ownerId),
  ]);
  // Order matters: a pending deletion locks the account, Google sign-ups give their
  // organisation details first, then everyone completes the brand onboarding.
  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { deletionScheduledFor: true, suspendedAt: true, name: true } });
  if (account?.suspendedAt || company?.ownerSuspended) redirect("/suspended");
  heartbeat(user.id); // "active now" on the sales room TV: throttled, after the response, never fails the page
  if (account?.deletionScheduledFor || company?.ownerDeleting) redirect("/account/deletion");
  // First-time setup belongs to the owner or an admin; a teammate who arrives early waits.
  const setupDone = Boolean(business?.detailsCompletedAt && business.onboardedAt);
  if (!setupDone && company && !can(company.role, "settings")) redirect("/account/waiting");
  if (!business?.detailsCompletedAt) redirect("/welcome");
  if (!business.onboardedAt) redirect("/onboarding");
  // Demo first (docs/REGIONS.md): a new company chooses a plan and books a demo before the dashboard opens. Until an
  // admin starts the trial, the dashboard layout shows only the demo (components/app/demo-lock.tsx).
  const pendingDemo = usage.subscription.status === "PENDING_DEMO";
  if (pendingDemo && !usage.subscription.chosenPlan && (!company || can(company.role, "settings"))) redirect("/book-demo");
  // What the plan unlocks (lib/entitlements.ts): the sidebar and featureGate read it; actions and routes check again.
  const entitlements = await companyEntitlements(business.id);

  const meta = user.user_metadata as { full_name?: string; name?: string } | undefined;
  // The name saved in Settings wins; Google sign-ups start with their Google name.
  const fullName = account?.name?.trim() || meta?.full_name || meta?.name || (company?.role === "OWNER" ? business.ceoName : null) || null;
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
    // `user.id` is the company account (see SessionUser in lib/auth/require-user.ts); `actorId` is the signed-in person.
    user: { ...user, id: ownerId },
    actorId: user.id,
    role: (company?.role ?? "OWNER") as Role,
    email: user.email ?? "",
    displayName,
    firstName,
    business,
    businessName: business?.name ?? "My business",
    usage,
    entitlements,
    isTrial,
    trialDaysLeft,
    pendingDemo,
    chosenPlan: usage.subscription.chosenPlan ?? null,
    logoUrl,
    brandColors: business.brandColors,
    voiceLabel: getVoice(business.tone)?.label ?? null,
  };
});

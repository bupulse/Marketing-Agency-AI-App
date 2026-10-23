import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureAccount } from "@/lib/account";
import { getCurrentUser } from "@/lib/supabase/server";
import { companyEntitlements } from "@/lib/entitlements";
import { getUsageSummary } from "@/lib/usage";
import { signedLogoUrl } from "@/lib/storage";
import { getVoice } from "@/lib/brand/voices";
import { resolveCompany } from "@/lib/team/company";
import { can, type Role } from "@/lib/team/roles";
import { heartbeat } from "@/lib/staff/heartbeat";
import { isCreatorOnly } from "@/lib/creators/auth";
import { openInvoiceOf } from "@/lib/invoices/service";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Everything the app shell and pages need about the signed-in user, loaded once
 * per request (React `cache` dedupes the layout and page calls).
 */
export const getAppContext = cache(async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // ensureAccount is a safety net only: sessions are normally created after email confirmation, and it never starts a
  // trial for an unconfirmed address. The company comes through Membership. `ownerId` (Business.userId) is the company account that owns the plan,
  // the credits and the Storage folder, so a teammate sees and spends the company's, not their own. Both lookups run
  // together; a first visit (ensureAccount creates the account and its company) finds nothing yet and looks again.
  const [confirmed, member] = await Promise.all([ensureAccount(user), resolveCompany(user.id)]);
  if (!confirmed) redirect("/login?error=confirm");
  const company = member ?? (await resolveCompany(user.id));
  // A creator (docs/CREATOR_CAMPAIGNS.md) has no company: their side of BuPulse is /creator.
  if (!company && (await isCreatorOnly(user.id))) redirect("/creator");
  const ownerId = company?.ownerId ?? user.id;
  // What the plan unlocks starts loading now when the company is known (cached per request, so the read below reuses
  // it); a failure here is handled where it is read.
  if (company) companyEntitlements(company.businessId).catch(() => null);
  // Loaded together: each database round trip is felt on every page (about 240 ms from the test site's Mac).
  const [business, usage, account] = await Promise.all([
    prisma.business.findUnique({ where: { userId: ownerId } }),
    getUsageSummary(ownerId),
    prisma.user.findUnique({ where: { id: user.id }, select: { deletionScheduledFor: true, suspendedAt: true, name: true } }),
  ]);
  // Order matters: a pending deletion locks the account, Google sign-ups give their
  // organisation details first, then everyone completes the brand onboarding.
  if (account?.suspendedAt || company?.ownerSuspended) redirect("/suspended");
  heartbeat(user.id); // "active now" on the sales room TV: throttled, after the response, never fails the page
  if (account?.deletionScheduledFor || company?.ownerDeleting) redirect("/account/deletion");
  // First-time setup belongs to the owner or an admin; a teammate who arrives early waits.
  const setupDone = Boolean(business?.detailsCompletedAt && business.onboardedAt);
  if (!setupDone && company && !can(company.role, "settings")) redirect("/account/waiting");
  if (!business?.detailsCompletedAt) redirect("/welcome");
  if (!business.onboardedAt) redirect("/onboarding");
  // Trial first (docs/REGIONS.md): until the company starts its free trial (PENDING_DEMO), /start-trial is the one
  // screen, for teammates too (they see who starts it). If an admin sent an invoice instead, the dashboard layout shows
  // only that invoice (components/app/invoice-lock.tsx). A failed invoice lookup counts as none.
  const pendingDemo = usage.subscription.status === "PENDING_DEMO";
  // What the plan unlocks (lib/entitlements.ts): the sidebar and featureGate read it; actions and routes check again.
  // The logo lives in the private brand bucket; a failed signing just means no logo. All three at once.
  const [pendingInvoice, entitlements, logoUrl] = await Promise.all([
    pendingDemo ? openInvoiceOf(business.id).catch(() => null) : null,
    companyEntitlements(business.id),
    business.logoUrl ? signedLogoUrl(business.logoUrl).catch(() => null) : null,
  ]);
  if (pendingDemo && !pendingInvoice) redirect("/start-trial");

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
    pendingInvoice,
    chosenPlan: usage.subscription.chosenPlan ?? null,
    logoUrl,
    brandColors: business.brandColors,
    voiceLabel: getVoice(business.tone)?.label ?? null,
  };
});

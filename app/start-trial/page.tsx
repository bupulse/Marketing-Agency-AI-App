import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { PlanChoice } from "@/components/trial/plan-choice";
import { getSettings } from "@/lib/admin/settings";
import { ensureAccount } from "@/lib/account";
import { prisma } from "@/lib/db";
import { PLAN_PICK_COOKIE, pickedPlanKey } from "@/lib/plan-quiz";
import { companyPlans } from "@/lib/region-prices";
import { getCurrentUser } from "@/lib/supabase/server";
import { resolveCompany } from "@/lib/team/company";
import { can } from "@/lib/team/roles";

export const metadata: Metadata = {
  title: "Start your free trial",
  robots: { index: false, follow: false },
};

// After sign-up and onboarding: the one screen before the dashboard (docs/REGIONS.md, "Trial first"). The company
// picks the plan it wants to try and "Start my free trial" starts it at once. Only while the subscription has not
// started (PENDING_DEMO) and no invoice was sent instead; afterwards the page sends people to the dashboard.
export default async function StartTrialPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/start-trial");
  if (!(await ensureAccount(user))) redirect("/login?error=confirm");

  const company = await resolveCompany(user.id);
  const ownerId = company?.ownerId ?? user.id;
  const [business, account] = await Promise.all([
    prisma.business.findUnique({ where: { userId: ownerId }, select: { id: true, name: true, detailsCompletedAt: true, onboardedAt: true, user: { select: { subscription: { select: { status: true, chosenPlan: true } } } } } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { deletionScheduledFor: true, suspendedAt: true } }),
  ]);
  if (account?.suspendedAt || company?.ownerSuspended) redirect("/suspended");
  if (account?.deletionScheduledFor || company?.ownerDeleting) redirect("/account/deletion");
  const canStart = !company || can(company.role, "settings");
  if (!business?.detailsCompletedAt || !business.onboardedAt) redirect(canStart ? (business?.detailsCompletedAt ? "/onboarding" : "/welcome") : "/account/waiting");
  const sub = business.user.subscription;
  if (!sub || sub.status !== "PENDING_DEMO") redirect("/dashboard");
  // An admin sent an invoice instead of a trial (docs/INVOICES.md): the dashboard shows it and how to pay.
  if (await prisma.invoice.findFirst({ where: { businessId: business.id, status: "sent" }, select: { id: true } })) redirect("/dashboard");

  const settings = await getSettings();
  const days = `${settings.trialDays} ${settings.trialDays === 1 ? "day" : "days"}`;
  if (!canStart) {
    return (
      <OnboardingShell>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-[-0.03em]">Your free trial starts soon</h1>
          <p className="text-[15px] text-muted">
            Your company&apos;s owner or an admin chooses the plan for {business.name} and starts the {days} free trial. The dashboard opens for you as soon as they do.
          </p>
        </div>
      </OnboardingShell>
    );
  }

  const [{ region, plans }, jar] = await Promise.all([companyPlans(business.id), cookies()]);
  // The plan the /pricing quiz suggested (lib/plan-quiz.ts), when the company's region offers it.
  const pick = pickedPlanKey(jar.get(PLAN_PICK_COOKIE)?.value);
  const suggested = plans.some((p) => p.key === pick) ? pick : null;
  // A plan chosen earlier (a company from the demo-first days) is preselected, when the region still offers it.
  const current = sub.chosenPlan && plans.some((p) => p.key === sub.chosenPlan) ? sub.chosenPlan : null;
  return (
    <OnboardingShell>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Choose the plan you want to try</h1>
        <p className="text-[15px] text-muted">
          Prices for {region.name}. Try it free for {days} with this plan&apos;s features, no card needed. Your trial starts as soon as you tap the button; you can change plan later.
        </p>
      </div>
      <PlanChoice plans={plans} current={current} suggested={suggested} />
    </OnboardingShell>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { PlanChoice } from "@/components/demo/plan-choice";
import { SlotPicker } from "@/components/demo/slot-picker";
import { getSettings } from "@/lib/admin/settings";
import { ensureAccount } from "@/lib/account";
import { prisma } from "@/lib/db";
import { availableSlots, currentBooking } from "@/lib/demo/bookings";
import { DEMO_TIME_ZONE, formatSlot, groupSlotsByDay } from "@/lib/demo/slots";
import { PLAN_PICK_COOKIE, pickedPlanKey } from "@/lib/plan-quiz";
import { companyPlans } from "@/lib/region-prices";
import { getCurrentUser } from "@/lib/supabase/server";
import { resolveCompany } from "@/lib/team/company";
import { can } from "@/lib/team/roles";

export const metadata: Metadata = {
  title: "Book your demo",
  robots: { index: false, follow: false },
};

// After sign-up and onboarding: choose a plan (step=plan), then a time for the demo (step=time). Only while the
// subscription waits for its demo; afterwards the page sends people to the dashboard. The same page reschedules.
export default async function BookDemoPage({ searchParams }: { searchParams: Promise<{ step?: string | string[] }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/book-demo");
  if (!(await ensureAccount(user))) redirect("/login?error=confirm");

  const company = await resolveCompany(user.id);
  const ownerId = company?.ownerId ?? user.id;
  const [business, account] = await Promise.all([
    prisma.business.findUnique({ where: { userId: ownerId }, select: { id: true, name: true, detailsCompletedAt: true, onboardedAt: true, user: { select: { subscription: { select: { status: true, chosenPlan: true } } } } } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { deletionScheduledFor: true, suspendedAt: true } }),
  ]);
  if (account?.suspendedAt || company?.ownerSuspended) redirect("/suspended");
  if (account?.deletionScheduledFor || company?.ownerDeleting) redirect("/account/deletion");
  if (company && !can(company.role, "settings")) redirect("/dashboard");
  if (!business?.detailsCompletedAt) redirect("/welcome");
  if (!business.onboardedAt) redirect("/onboarding");
  const sub = business.user.subscription;
  if (!sub || sub.status !== "PENDING_DEMO") redirect("/dashboard");

  const sp = await searchParams;
  const asked = Array.isArray(sp.step) ? sp.step[0] : sp.step;
  const step = asked === "time" && sub.chosenPlan ? "time" : asked === "plan" || !sub.chosenPlan ? "plan" : "time";

  if (step === "plan") {
    const [{ region, plans }, settings, jar] = await Promise.all([companyPlans(business.id), getSettings(), cookies()]);
    // The plan the /pricing quiz suggested (lib/plan-quiz.ts), when the company's region offers it.
    const pick = pickedPlanKey(jar.get(PLAN_PICK_COOKIE)?.value);
    const suggested = plans.some((p) => p.key === pick) ? pick : null;
    return (
      <OnboardingShell>
        <div className="flex flex-col gap-1.5">
          <p className="text-[13px] font-medium text-muted">Step 1 of 2</p>
          <h1 className="text-2xl font-semibold tracking-[-0.03em]">Choose the plan you want to try</h1>
          <p className="text-[15px] text-muted">
            Prices for {region.name}. After your demo you get {settings.trialDays} {settings.trialDays === 1 ? "day" : "days"} free with this plan&apos;s features. No card needed; you can change plan later.
          </p>
        </div>
        <PlanChoice plans={plans} current={sub.chosenPlan} suggested={suggested} />
      </OnboardingShell>
    );
  }

  const booking = await currentBooking(business.id);
  const { slots, slotMinutes } = await availableSlots(new Date(), booking?.id);
  const groups = groupSlotsByDay(slots).map((g) => ({ ...g, slots: g.slots.map((d) => d.toISOString()) }));
  return (
    <OnboardingShell>
      <div className="flex flex-col gap-1.5">
        <p className="text-[13px] font-medium text-muted">Step 2 of 2</p>
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">{booking ? "Pick a new time for your demo" : "Pick a time for your demo"}</h1>
        <p className="text-[15px] text-muted">
          A {slotMinutes}-minute video call. Times are in {DEMO_TIME_ZONE.replace("_", " ")}.
          {booking ? ` Your current time is ${formatSlot(booking.startsAt)}.` : ""}
        </p>
        <Link href="/book-demo?step=plan" className="text-sm font-semibold">
          Change plan
        </Link>
      </div>
      <SlotPicker groups={groups} timeZone={DEMO_TIME_ZONE} rescheduling={Boolean(booking)} />
    </OnboardingShell>
  );
}

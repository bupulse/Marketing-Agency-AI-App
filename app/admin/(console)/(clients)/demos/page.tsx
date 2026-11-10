import { requirePermission } from "@/lib/admin/auth";
import { DemosView } from "@/components/admin/business/demos-view";
import { listDemos } from "@/lib/admin/demos";
import { param } from "@/lib/admin/format";
import { getSettings } from "@/lib/admin/settings";
import { googleCalendarStatus } from "@/lib/google-calendar/calendar";
import { subscriptionSummary } from "@/lib/admin/subscription-summary";
import { prisma } from "@/lib/db";
import { getPlans } from "@/lib/plan-catalog";
import { demoStatusAction, retryDemoCalendarAction } from "./actions";

export const metadata = { title: "Demos" };
export const dynamic = "force-dynamic";

export default async function DemosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("demos"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const when = (["upcoming", "past", "all"] as const).find((w) => w === param(sp.when)) ?? "upcoming";
  const status = param(sp.status);
  const [demos, settings, plans, google] = await Promise.all([listDemos({ when, status: status || undefined }), getSettings(), getPlans(), googleCalendarStatus()]);
  // The subscriptions as they are now (read on their own, by company account): Activate account only while the company
  // still waits for its demo; past that, where it stands and links to Extend trial / Change plan.
  const subs = new Map(
    (await prisma.subscription.findMany({ where: { userId: { in: [...new Set(demos.map((d) => d.userId))] } }, select: { userId: true, status: true, plan: true, provider: true, interval: true, trialEndsAt: true, currentPeriodEnd: true, cancelAtPeriodEnd: true } })).map((s) => [s.userId, s]),
  );
  const planName = (key: string) => plans.find((p) => p.key === key)?.name ?? key;
  const here = `/admin/demos?${new URLSearchParams({ when, ...(status && { status }) })}`;
  return (
    <DemosView
      demos={demos}
      when={when}
      status={status}
      sp={sp}
      trialDays={settings.trialDays}
      meetingLinkSet={Boolean(settings.meetingLink)}
      googleNeedsReconnect={google.needsReconnect}
      account={(userId) => {
        const current = subs.get(userId) ?? null;
        return { status: current?.status ?? null, summary: current ? subscriptionSummary(current, planName) : null };
      }}
      here={here}
      demoStatusAction={demoStatusAction}
      retryDemoCalendarAction={retryDemoCalendarAction}
    />
  );
}

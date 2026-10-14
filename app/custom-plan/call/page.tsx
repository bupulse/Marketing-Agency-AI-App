import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck, CalendarPlus, CheckCircle2, ExternalLink, Video } from "lucide-react";
import { DemoCancelButton } from "@/components/app/demo-cancel";
import { SlotPicker } from "@/components/demo/slot-picker";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { Badge, buttonClasses } from "@/components/ui";
import { bookPlanCallAction } from "./actions";
import { getSettings } from "@/lib/admin/settings";
import { linkSiteUrl } from "@/lib/auth/request-site";
import { checkActiveUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db";
import { availableSlots, canMoveBooking } from "@/lib/demo/bookings";
import { demoGoogleCalendarUrl, managePath } from "@/lib/demo/calendar-links";
import { callRequestId, currentPlanCall } from "@/lib/demo/plan-calls";
import { DEMO_TIME_ZONE, formatSlot, groupSlotsByDay, MIN_LEAD_MINUTES } from "@/lib/demo/slots";
import { askMessage, can } from "@/lib/team/roles";

export const metadata: Metadata = {
  title: "Your custom plan call",
  robots: { index: false, follow: false },
};

// The optional short call after a custom plan request (lib/demo/plan-calls.ts): pick a time (step=time, or when there is
// no call yet), then the booked call with its meeting link, calendar buttons, reschedule and cancel. Existing clients
// only: a company still waiting for its demo talks the request through in the demo (the dashboard).
export default async function PlanCallPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const check = await checkActiveUser();
  if (check.status === "signed_out") redirect(`/login?next=${encodeURIComponent("/custom-plan/call")}`);
  if (check.status === "unconfirmed") redirect("/login?error=confirm");
  if (check.status === "suspended") redirect("/suspended");
  if (check.status === "locked") redirect("/account/deletion");
  const user = check.user;
  const business = user.businessId
    ? await prisma.business.findUnique({ where: { id: user.businessId }, select: { id: true, name: true, detailsCompletedAt: true, onboardedAt: true, user: { select: { email: true, subscription: { select: { status: true } } } } } })
    : null;
  if (!business?.detailsCompletedAt) redirect("/welcome");
  if (!business.onboardedAt) redirect("/onboarding");
  if (business.user.subscription?.status === "PENDING_DEMO") redirect("/dashboard");
  const back = (
    <Link href="/dashboard/billing" className="inline-flex min-h-11 items-center text-sm font-medium underline">
      Back to Billing
    </Link>
  );
  if (!can(user.role, "billing")) {
    return (
      <OnboardingShell>
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Your custom plan call</h1>
        <p className="rounded-2xl bg-soft px-4 py-3 text-[15px]">{askMessage("billing")}</p>
        {back}
      </OnboardingShell>
    );
  }

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const call = await currentPlanCall(business.id);
  const zone = DEMO_TIME_ZONE.replace("_", " ");

  if (call && one(sp.step) !== "time") {
    const settings = await getSettings();
    const meetingLink = call.meetingLink || settings.meetingLink || null;
    const googleUrl = demoGoogleCalendarUrl({ ...call, meetingLink }, business.name, `${await linkSiteUrl()}${managePath(call.kind)}`);
    const minutes = Math.round((call.endsAt.getTime() - call.startsAt.getTime()) / 60_000);
    const movable = canMoveBooking(call, new Date());
    return (
      <OnboardingShell>
        <div className="flex flex-col gap-2">
          <Badge tone="violet" className="self-start">
            {business.name}
          </Badge>
          {(one(sp.booked) || one(sp.moved)) && (
            <p role="status" className="flex items-start gap-2 rounded-2xl bg-success-bg px-4 py-3 text-sm font-medium text-success">
              <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
              {one(sp.moved) ? `Moved. The updated invitation is on its way to ${business.user.email}.` : `Booked. The invitation is on its way to ${business.user.email}.`}
            </p>
          )}
          <h1 className="text-2xl font-semibold tracking-[-0.03em]">Your call is on {formatSlot(call.startsAt)}</h1>
          <p className="text-[15px] text-muted">
            Time in {zone}. About {minutes} minutes{call.meetLink ? " on Google Meet" : ""}: we go through your custom plan request and what BuPulse can do for {business.name}. Your offer follows in Billing.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {meetingLink && (
            <a href={meetingLink} target="_blank" rel="noreferrer noopener" className={buttonClasses({ size: "lg" })}>
              <Video aria-hidden className="size-[18px]" /> Join the meeting
              <ExternalLink aria-hidden className="size-4" />
            </a>
          )}
          <a href={googleUrl} target="_blank" rel="noreferrer noopener" className={buttonClasses({ variant: "outline", size: "lg" })}>
            <CalendarPlus aria-hidden className="size-[18px]" /> Add to Google Calendar
          </a>
          <a href={`/api/demo/ics/${encodeURIComponent(call.icsToken)}`} className={buttonClasses({ variant: "outline", size: "lg" })}>
            <CalendarCheck aria-hidden className="size-[18px]" /> Add to Apple / Outlook (.ics)
          </a>
        </div>
        {meetingLink ? (
          <p className="text-sm text-muted">
            {call.meetLink ? "Google Meet" : "Meeting link"}:{" "}
            <a href={meetingLink} target="_blank" rel="noreferrer noopener" className="break-all font-medium text-text underline">
              {meetingLink}
            </a>
            {call.googleEventId ? ". Google Calendar has also sent the invite to your email." : ""}
          </p>
        ) : (
          <p className="text-sm text-muted">The meeting link arrives by email before the call.</p>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          {movable ? (
            <>
              <Link href="/custom-plan/call?step=time" className={buttonClasses({ variant: "ghost", size: "sm" })}>
                Reschedule
              </Link>
              <DemoCancelButton when={formatSlot(call.startsAt)} kind="call" />
              <span className="text-xs text-muted">You can reschedule or cancel up to {MIN_LEAD_MINUTES / 60} hours before the call.</span>
            </>
          ) : (
            <span className="text-sm text-muted">The call starts in less than {MIN_LEAD_MINUTES / 60} hours, so it can no longer be moved here. Need to change it? Reply to your booking email.</span>
          )}
        </div>
        {back}
      </OnboardingShell>
    );
  }

  // Picking a time: a new call is about a request of this company (the one just sent, else the latest).
  const requestId = await callRequestId(business.id, one(sp.request) || null).catch(() => null);
  if (!call && !requestId) redirect("/custom-plan?from=billing");
  const { slots, slotMinutes } = await availableSlots(new Date(), call?.id);
  const groups = groupSlotsByDay(slots).map((g) => ({ ...g, slots: g.slots.map((d) => d.toISOString()) }));
  return (
    <OnboardingShell>
      <div className="flex flex-col gap-1.5">
        <p className="text-[13px] font-medium text-muted">{business.name}</p>
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">{call ? "Pick a new time for your call" : "Pick a time for a short call"}</h1>
        <p className="text-[15px] text-muted">
          A {slotMinutes}-minute video call about your custom plan request. You get the meeting link and a calendar invitation by email straight away. Times are in {zone}.
          {call ? ` Your current time is ${formatSlot(call.startsAt)}.` : ""}
        </p>
      </div>
      <SlotPicker
        groups={groups}
        timeZone={DEMO_TIME_ZONE}
        rescheduling={Boolean(call)}
        action={bookPlanCallAction}
        hidden={requestId ? { request: requestId } : {}}
        labels={{ book: "Book this time", move: "Move my call to this time", empty: "No free times in the next two weeks. We will answer your request by email; reply to it to find a time together." }}
      />
      <Link href={call ? "/custom-plan/call" : "/dashboard/billing"} className="inline-flex min-h-11 items-center text-sm font-medium underline">
        {call ? "Keep the current time" : "Not now, back to Billing"}
      </Link>
    </OnboardingShell>
  );
}

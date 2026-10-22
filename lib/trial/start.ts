import "server-only";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { getSettings } from "@/lib/admin/settings";
import type { AdminContext } from "@/lib/admin/types";
import { EVENT_NAMES, trackEvent } from "@/lib/analytics/events";
import { linkSiteUrl } from "@/lib/auth/request-site";
import { formatSlot } from "@/lib/demo/slots";
import { logError } from "@/lib/errors";
import { persistDemoSync, syncDemoEvent } from "@/lib/google-calendar/events";
import { getPlan, getTrialPlan } from "@/lib/plan-catalog";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { companyPlans } from "@/lib/region-prices";

// Starting a company's free trial (docs/REGIONS.md, "Trial first"). A new company waits in PENDING_DEMO until it picks
// the plan it wants to try on /start-trial: one tap moves it onto its trial (startOwnTrial). An admin's "Start trial"
// (lib/admin/demos.ts) runs the same steps for any company still pending. Either way: the subscription goes TRIALING
// on the TRIAL plan (its limits) with the chosen plan's features (lib/entitlements.ts) for Admin -> Settings' trial
// days, a live demo booking is closed, the change is audited, trial_started is recorded and the client is emailed.

const DAY_MS = 86_400_000;

export type TrialErrorCode = "not_found" | "no_subscription" | "not_pending" | "invoice_open" | "no_plan" | "plan_gone" | "not_in_region" | "invalid_days" | "changed";

/** Why a trial did not start. `message` is for the client; the admin side words its own from `code` and `detail`. */
export class TrialError extends Error {
  constructor(
    public code: TrialErrorCode,
    message: string,
    public detail: { status?: string; planKey?: string; planName?: string; regionKey?: string; regionName?: string; offered?: string[] } = {},
  ) {
    super(message);
    this.name = "TrialError";
  }
}

export type TrialStarted = {
  businessId: string;
  userId: string;
  status: "TRIALING";
  plan: string;
  chosenPlan: string;
  trialEndsAt: Date;
  days: number;
  /** What happened to a live demo booking: none, marked done, or cancelled (its time had not come yet). */
  demo: "none" | "done" | "cancelled";
};

export type BeginTrialInput = {
  businessId: string;
  /** The plan to try; empty means the client's earlier choice (Subscription.chosenPlan). */
  planKey?: string | null;
  /** Defaults to the trial days in Admin -> Settings. */
  days?: number;
  /**
   * A live demo booking: "done" marks it done (the admin starts the trial after the call); "by_time" marks it done
   * once its time has come and cancels it otherwise (also its Google event), without the booking emails.
   */
  demo: "done" | "by_time";
  /** The client may not start a trial once an admin sent an invoice instead (docs/INVOICES.md); the admin may. */
  refuseOpenInvoice?: boolean;
};

/** The shared steps of a trial start. Throws TrialError; guarded on PENDING_DEMO, so two calls never start two trials. */
export async function beginTrial(ctx: AdminContext, input: BeginTrialInput, now = new Date()): Promise<TrialStarted> {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true, name: true, userId: true, user: { select: { email: true, name: true, subscription: { select: { status: true, plan: true, chosenPlan: true, trialEndsAt: true } } } } },
  });
  if (!business) throw new TrialError("not_found", "We could not find your company.");
  const sub = business.user.subscription;
  if (!sub) throw new TrialError("no_subscription", "Your account has no subscription yet. Email hello@bupulse.com and we will sort it out.");
  if (sub.status !== "PENDING_DEMO") throw new TrialError("not_pending", sub.status === "TRIALING" ? "Your free trial has already started." : "Your account is past this step.", { status: sub.status });
  if (input.refuseOpenInvoice && (await prisma.invoice.findFirst({ where: { businessId: business.id, status: "sent" }, select: { id: true } }))) {
    throw new TrialError("invoice_open", "Your account has an invoice to pay instead of a trial. Open your dashboard to see it.");
  }
  const chosenKey = input.planKey?.trim() || sub.chosenPlan;
  if (!chosenKey) throw new TrialError("no_plan", "Choose one of the plans shown.");
  const chosen = await getPlan(chosenKey);
  if (!chosen) throw new TrialError("plan_gone", "That plan is no longer offered. Choose one of the plans shown.", { planKey: chosenKey });
  // The trial carries the chosen plan's features and leads to paying for it, so it must be a plan the company's region sells.
  const { region, plans } = await companyPlans(business.id);
  if (!plans.some((p) => p.key === chosen.key)) {
    throw new TrialError("not_in_region", "Choose one of the plans shown.", { planKey: chosen.key, planName: chosen.name, regionKey: region.key, regionName: region.name, offered: plans.map((p) => p.name) });
  }
  const settings = await getSettings();
  const days = input.days ?? settings.trialDays;
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new TrialError("invalid_days", "days must be a whole number from 1 to 90.");
  const trialPlan = await getTrialPlan();
  const trialEndsAt = new Date(now.getTime() + days * DAY_MS);
  const before = { status: sub.status, plan: sub.plan, chosenPlan: sub.chosenPlan, trialEndsAt: sub.trialEndsAt };
  const after = { status: "TRIALING" as const, plan: trialPlan.key, chosenPlan: chosen.key, trialEndsAt, currentPeriodStart: now, currentPeriodEnd: trialEndsAt, trialReminder1SentAt: null, trialReminder2SentAt: null };
  const live = await prisma.demoBooking.findMany({ where: { businessId: business.id, kind: "demo", status: "booked" }, select: { id: true, businessId: true, startsAt: true, endsAt: true, googleEventId: true, meetingLink: true, kind: true } });
  const cancel = input.demo === "by_time" ? live.filter((b) => b.startsAt.getTime() > now.getTime()) : [];
  const demo: TrialStarted["demo"] = live.length === 0 ? "none" : cancel.length ? "cancelled" : "done";
  await prisma.$transaction(async (tx) => {
    // Guarded on the status we read, so two clicks cannot start two trials.
    const { count } = await tx.subscription.updateMany({ where: { userId: business.userId, status: "PENDING_DEMO" }, data: after });
    if (count !== 1) throw new TrialError("changed", "Your account changed while starting the trial. Reload the page.");
    // Cancelled first, so the next update only finds the bookings whose time has come (or all of them for "done").
    if (cancel.length) await tx.demoBooking.updateMany({ where: { id: { in: cancel.map((b) => b.id) }, status: "booked" }, data: { status: "cancelled", sequence: { increment: 1 } } });
    await tx.demoBooking.updateMany({ where: { businessId: business.id, kind: "demo", status: "booked" }, data: { status: "done" } });
    await writeAudit(tx, ctx, "start_trial", `business:${business.id}`, before, { ...after, days, demo });
  });
  // A demo that will not happen any more leaves the owner's Google Calendar (Google tells the client). Never fails the start.
  for (const booking of cancel) {
    if (!booking.googleEventId) continue;
    try {
      await persistDemoSync(booking, await syncDemoEvent("cancelled", booking, { name: business.name, email: business.user.email, contact: business.user.name }, null));
    } catch (error) {
      await logError(error, { source: "trial.start.demo-cancel", businessId: business.id, bookingId: booking.id });
    }
  }
  await trackEvent(EVENT_NAMES.trialStarted, { userId: business.userId, businessId: business.id, props: { plan: chosen.key, days } });
  try {
    const first = business.user.name?.split(/\s+/)[0];
    const { html, text } = renderEmail({
      heading: `Your ${days}-day free trial has started`,
      intro: `${first ? `Hi ${first}, ` : ""}${business.name} now has the ${chosen.name} plan's features free until ${formatSlot(trialEndsAt)} (Africa/Kigali). Make a few posts, try the designs, and when you are ready, pay from the Billing page to keep going.`,
      blocks: [
        { label: "Plan", value: chosen.name },
        { label: "Trial ends", value: `${formatSlot(trialEndsAt)} (Africa/Kigali)` },
        { label: "During the trial", value: `${trialPlan.limits.text} AI texts and ${trialPlan.limits.image} designs to try on your own business.` },
        ...(demo === "cancelled" ? [{ label: "Your demo call", value: "No longer needed, so we cancelled it. Reply to this email if you still want a call." }] : []),
      ],
      button: { label: "Open BuPulse", url: `${await linkSiteUrl()}/dashboard` },
      footer: "Nothing is charged automatically. If you do nothing, the trial simply stops and your work stays saved.",
    });
    await sendEmail({ to: business.user.email, subject: `Your BuPulse trial has started: ${chosen.name} until ${formatSlot(trialEndsAt)}`, html, text });
  } catch (error) {
    await logError(error, { source: "trial.start.email", businessId: business.id });
  }
  return { businessId: business.id, userId: business.userId, status: "TRIALING", plan: trialPlan.key, chosenPlan: chosen.key, trialEndsAt, days, demo };
}

/**
 * "Start my free trial" on /start-trial: the client (Owner or Admin role, checked by the action) starts their own
 * company's trial on a plan their region offers. Audited as `client:<their user id>`.
 */
export async function startOwnTrial(input: { businessId: string; actorId: string; planKey: string; ip?: string | null }, now = new Date()): Promise<TrialStarted> {
  const ctx: AdminContext = { actor: `client:${input.actorId}`, ip: input.ip ?? null, viaApi: false };
  return beginTrial(ctx, { businessId: input.businessId, planKey: input.planKey, demo: "by_time", refuseOpenInvoice: true }, now);
}

import "server-only";
import { prisma } from "@/lib/db";
import { EVENT_NAMES, trackEvent } from "@/lib/analytics/events";
import { siteUrl } from "@/lib/auth/site-url";
import { isBookingStatus, type BookingStatus } from "@/lib/demo/bookings";
import { formatSlot } from "@/lib/demo/slots";
import { logError } from "@/lib/errors";
import { getPlan, getTrialPlan } from "@/lib/plan-catalog";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { companyPlans } from "@/lib/region-prices";
import { writeAudit } from "./audit";
import { getSettings } from "./settings";
import { AdminError, type AdminContext } from "./types";

// The admin side of the demo-first trial: the Demos list, marking a demo done or a no-show, and "Start trial", which
// moves a PENDING_DEMO company onto its trial. Every action is audited; the console re-checks AAL2 in adminAction().

const DAY_MS = 86_400_000;

export type DemoListFilter = { when?: "upcoming" | "past" | "all"; status?: string; limit?: number };

export async function listDemos(opts: DemoListFilter = {}, now = new Date()) {
  const when = opts.when ?? "upcoming";
  const status = opts.status && isBookingStatus(opts.status) ? opts.status : undefined;
  const rows = await prisma.demoBooking.findMany({
    where: {
      ...(when === "upcoming" ? { endsAt: { gte: now } } : when === "past" ? { endsAt: { lt: now } } : {}),
      ...(status ? { status } : when === "upcoming" ? { status: "booked" } : {}),
    },
    orderBy: { startsAt: when === "past" ? "desc" : "asc" },
    take: Math.min(Math.max(opts.limit ?? 100, 1), 500),
    select: {
      id: true, businessId: true, planKey: true, startsAt: true, endsAt: true, status: true, notes: true, meetingLink: true, createdAt: true,
      business: { select: { name: true, country: true, pricingRegion: true, user: { select: { id: true, email: true, name: true, subscription: { select: { status: true, chosenPlan: true, trialEndsAt: true } } } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    businessId: r.businessId,
    businessName: r.business.name,
    country: r.business.country,
    region: r.business.pricingRegion,
    contactName: r.business.user.name,
    email: r.business.user.email,
    userId: r.business.user.id,
    planKey: r.planKey,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    when: formatSlot(r.startsAt),
    status: r.status as BookingStatus,
    notes: r.notes,
    meetingLink: r.meetingLink,
    subscriptionStatus: r.business.user.subscription?.status ?? null,
    trialEndsAt: r.business.user.subscription?.trialEndsAt ?? null,
    createdAt: r.createdAt,
  }));
}

/** Marks a demo done, a no-show, or cancelled. Audited on the company. */
export async function setDemoStatus(ctx: AdminContext, input: { id: string; status: string; notes?: string }) {
  if (!isBookingStatus(input.status) || input.status === "booked") throw new AdminError("invalid", "status must be done, no_show or cancelled.");
  const booking = await prisma.demoBooking.findUnique({ where: { id: input.id }, select: { id: true, businessId: true, status: true, notes: true, startsAt: true } });
  if (!booking) throw new AdminError("not_found", "No demo with that id.");
  if (booking.status === input.status && (input.notes ?? booking.notes) === booking.notes) return { id: booking.id, status: booking.status, changed: false };
  const notes = input.notes === undefined ? booking.notes : input.notes.trim().slice(0, 1000) || null;
  await prisma.$transaction(async (tx) => {
    await tx.demoBooking.update({ where: { id: booking.id }, data: { status: input.status, notes } });
    await writeAudit(tx, ctx, "update_demo", `business:${booking.businessId}`, { demoId: booking.id, status: booking.status, notes: booking.notes }, { demoId: booking.id, status: input.status, notes });
  });
  return { id: booking.id, status: input.status, changed: true };
}

/**
 * Starts the trial of a company that is waiting for its demo: the subscription goes TRIALING on the TRIAL plan (its
 * limits) with the chosen plan's features (lib/entitlements.ts), for the number of days in Admin -> Settings.
 * The live demo booking, if any, is marked done. Audited; the client gets an email.
 */
export async function startTrial(ctx: AdminContext, input: { businessId: string; days?: number; planKey?: string }, now = new Date()) {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true, name: true, userId: true, user: { select: { email: true, name: true, subscription: { select: { status: true, plan: true, chosenPlan: true, trialEndsAt: true, providerSubscriptionId: true } } } } },
  });
  if (!business) throw new AdminError("not_found", "No company with that id.");
  const sub = business.user.subscription;
  if (!sub) throw new AdminError("conflict", "This company has no subscription record.");
  if (sub.status !== "PENDING_DEMO") throw new AdminError("conflict", `This company is ${sub.status === "TRIALING" ? "already on its trial" : `${sub.status.toLowerCase().replace("_", " ")}, not waiting for a demo`}. Use "Extend trial" or "Change plan" instead.`);
  // The admin may pick the plan (e.g. after moving the company to another region); otherwise it is the client's choice.
  const chosenKey = input.planKey?.trim() || sub.chosenPlan;
  if (!chosenKey) throw new AdminError("conflict", "The client has not chosen a plan yet. Ask them to choose one in the app first (Book a demo, step 1), or pick one here.");
  const chosen = await getPlan(chosenKey);
  if (!chosen) throw new AdminError("conflict", `The plan "${chosenKey}" no longer exists. Change it in Plans or ask the client to choose again.`);
  // The trial carries the chosen plan's features and leads to paying for it, so it must be a plan the company's region sells.
  const { region, plans } = await companyPlans(business.id);
  if (!plans.some((p) => p.key === chosen.key)) {
    throw new AdminError("conflict", `The ${chosen.name} plan is not offered in ${region.name} (${region.key}), the company's region. Pick one of: ${plans.map((p) => p.name).join(", ") || "none (add a price for this region first)"}, or change the company's region.`);
  }
  const settings = await getSettings();
  const days = input.days ?? settings.trialDays;
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new AdminError("invalid", "days must be a whole number from 1 to 90.");
  const trialPlan = await getTrialPlan();
  const trialEndsAt = new Date(now.getTime() + days * DAY_MS);
  const before = { status: sub.status, plan: sub.plan, chosenPlan: sub.chosenPlan, trialEndsAt: sub.trialEndsAt };
  const after = { status: "TRIALING" as const, plan: trialPlan.key, chosenPlan: chosen.key, trialEndsAt, currentPeriodStart: now, currentPeriodEnd: trialEndsAt, trialReminder1SentAt: null, trialReminder2SentAt: null };
  await prisma.$transaction(async (tx) => {
    // Guarded on the status we read, so two clicks cannot start two trials.
    const { count } = await tx.subscription.updateMany({ where: { userId: business.userId, status: "PENDING_DEMO" }, data: after });
    if (count !== 1) throw new AdminError("conflict", "The subscription changed while starting the trial. Reload and try again.");
    await tx.demoBooking.updateMany({ where: { businessId: business.id, status: "booked" }, data: { status: "done" } });
    await writeAudit(tx, ctx, "start_trial", `business:${business.id}`, before, { ...after, days });
  });
  trackEvent(EVENT_NAMES.trialStarted, { userId: business.userId, businessId: business.id, props: { plan: chosen.key, days } });
  try {
    const first = business.user.name?.split(/\s+/)[0];
    const { html, text } = renderEmail({
      heading: `Your ${days}-day free trial has started`,
      intro: `${first ? `Hi ${first}, ` : ""}thanks for the demo. ${business.name} now has the ${chosen.name} plan's features free until ${formatSlot(trialEndsAt)} (Africa/Kigali). Make a few posts, try the designs, and when you are ready, pay from the Billing page to keep going.`,
      blocks: [
        { label: "Plan", value: chosen.name },
        { label: "Trial ends", value: `${formatSlot(trialEndsAt)} (Africa/Kigali)` },
        { label: "During the trial", value: `${trialPlan.limits.text} AI texts and ${trialPlan.limits.image} designs to try on your own business.` },
      ],
      button: { label: "Open BuPulse", url: `${siteUrl()}/dashboard` },
      footer: "Nothing is charged automatically. If you do nothing, the trial simply stops and your work stays saved.",
    });
    await sendEmail({ to: business.user.email, subject: `Your BuPulse trial has started: ${chosen.name} until ${formatSlot(trialEndsAt)}`, html, text });
  } catch (error) {
    await logError(error, { source: "admin.start-trial.email", businessId: business.id });
  }
  return { businessId: business.id, userId: business.userId, status: "TRIALING" as const, plan: trialPlan.key, chosenPlan: chosen.key, trialEndsAt, days };
}

/** What the company page shows about the demo stage: status, the chosen plan, the live booking and the trial setting. */
export async function demoPanel(businessId: string) {
  const [business, booking, settings] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { pricingRegion: true, user: { select: { subscription: { select: { status: true, plan: true, chosenPlan: true, trialEndsAt: true } } } } } }),
    prisma.demoBooking.findFirst({ where: { businessId }, orderBy: { startsAt: "desc" } }),
    getSettings(),
  ]);
  const sub = business?.user.subscription ?? null;
  const chosen = sub?.chosenPlan ? await getPlan(sub.chosenPlan) : null;
  return {
    region: business?.pricingRegion ?? null,
    subscription: sub,
    chosenPlanName: chosen?.name ?? sub?.chosenPlan ?? null,
    booking: booking ? { id: booking.id, status: booking.status as BookingStatus, startsAt: booking.startsAt, when: formatSlot(booking.startsAt), meetingLink: booking.meetingLink, notes: booking.notes } : null,
    trialDays: settings.trialDays,
  };
}

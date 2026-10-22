import "server-only";
import { prisma } from "@/lib/db";
import { isBookingStatus, type BookingStatus } from "@/lib/demo/bookings";
import { formatSlot } from "@/lib/demo/slots";
import { persistDemoSync, retryDemoSync, syncDemoEvent } from "@/lib/google-calendar/events";
import { getPlan } from "@/lib/plan-catalog";
import { beginTrial, TrialError } from "@/lib/trial/start";
import { writeAudit } from "./audit";
import { getSettings } from "./settings";
import { AdminError, type AdminContext } from "./types";
import { parseMismatch } from "@/lib/region-check";

// The admin side of demos and trial starts: the Demos list (kept for history and companies still pending since the
// demo-first days), marking a demo done or a no-show, and "Start trial", which moves a PENDING_DEMO company onto its
// trial. New companies start their own trial on /start-trial (docs/REGIONS.md, "Trial first"). Every action is
// audited; the console re-checks AAL2 in adminAction().
// The Demos list also shows the custom plan calls (kind "custom_plan", lib/demo/plan-calls.ts); the trial steps
// (startTrial, demoPanel) only ever touch demos.

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
      id: true, businessId: true, kind: true, requestId: true, planKey: true, startsAt: true, endsAt: true, status: true, notes: true, meetingLink: true, createdAt: true, googleSyncPending: true, googleSyncError: true,
      business: { select: { name: true, country: true, pricingRegion: true, user: { select: { id: true, email: true, name: true, subscription: { select: { status: true, chosenPlan: true, trialEndsAt: true } } } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    businessId: r.businessId,
    kind: r.kind === "custom_plan" ? ("custom_plan" as const) : ("demo" as const),
    requestId: r.requestId,
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
    googleSyncPending: r.googleSyncPending,
    googleSyncError: r.googleSyncError,
    subscriptionStatus: r.business.user.subscription?.status ?? null,
    trialEndsAt: r.business.user.subscription?.trialEndsAt ?? null,
    createdAt: r.createdAt,
  }));
}

/** Marks a demo (or custom plan call) done, a no-show, or cancelled. Audited on the company. Cancelling also cancels its Google event (Google emails the client). */
export async function setDemoStatus(ctx: AdminContext, input: { id: string; status: string; notes?: string }) {
  if (!isBookingStatus(input.status) || input.status === "booked") throw new AdminError("invalid", "status must be done, no_show or cancelled.");
  const booking = await prisma.demoBooking.findUnique({ where: { id: input.id }, select: { id: true, businessId: true, status: true, notes: true, startsAt: true, endsAt: true, googleEventId: true, business: { select: { name: true, user: { select: { email: true, name: true } } } } } });
  if (!booking) throw new AdminError("not_found", "No demo with that id.");
  if (booking.status === input.status && (input.notes ?? booking.notes) === booking.notes) return { id: booking.id, status: booking.status, changed: false };
  const notes = input.notes === undefined ? booking.notes : input.notes.trim().slice(0, 1000) || null;
  await prisma.$transaction(async (tx) => {
    await tx.demoBooking.update({ where: { id: booking.id }, data: { status: input.status, notes } });
    await writeAudit(tx, ctx, "update_demo", `business:${booking.businessId}`, { demoId: booking.id, status: booking.status, notes: booking.notes }, { demoId: booking.id, status: input.status, notes });
  });
  if (input.status === "cancelled" && booking.status === "booked" && booking.googleEventId) {
    await persistDemoSync(booking, await syncDemoEvent("cancelled", booking, { name: booking.business.name, email: booking.business.user.email, contact: booking.business.user.name }, null));
  }
  return { id: booking.id, status: input.status, changed: true };
}

/** Admin -> Demos "Retry": pushes a booking's pending change to its Google event now. Audited on the company. */
export async function retryDemoCalendar(ctx: AdminContext, id: string) {
  const booking = await prisma.demoBooking.findUnique({ where: { id }, select: { id: true, businessId: true, googleSyncPending: true, googleSyncError: true } });
  if (!booking) throw new AdminError("not_found", "No demo with that id.");
  if (!booking.googleSyncPending) return { ok: true, already: true };
  const result = await retryDemoSync(booking.id);
  const ok = result.status !== "failed";
  await writeAudit(prisma, ctx, "retry_demo_calendar", `business:${booking.businessId}`, { demoId: booking.id, error: booking.googleSyncError }, { demoId: booking.id, ok, ...(result.status === "failed" ? { error: result.error } : {}) });
  if (result.status === "failed") throw new AdminError("unavailable", `Google Calendar is still not updated: ${result.error}`);
  return { ok: true, already: false };
}

/**
 * "Start trial" for a company that is still pending (PENDING_DEMO): the same steps as the client's own "Start my free
 * trial" (lib/trial/start.ts beginTrial), with the admin's wording. The admin may pick the plan (e.g. after moving the
 * company to another region) and the length; the live demo booking, if any, is marked done.
 */
export async function startTrial(ctx: AdminContext, input: { businessId: string; days?: number; planKey?: string }, now = new Date()) {
  try {
    return await beginTrial(ctx, { businessId: input.businessId, planKey: input.planKey, days: input.days, demo: "done" }, now);
  } catch (error) {
    throw error instanceof TrialError ? adminTrialError(error) : error;
  }
}

function adminTrialError(error: TrialError): AdminError {
  const d = error.detail;
  switch (error.code) {
    case "not_found":
      return new AdminError("not_found", "No company with that id.");
    case "no_subscription":
      return new AdminError("conflict", "This company has no subscription record.");
    case "not_pending":
      return new AdminError("conflict", `This company is ${d.status === "TRIALING" ? "already on its trial" : `${(d.status ?? "").toLowerCase().replace("_", " ")}, not waiting to start its trial`}. Use "Extend trial" or "Change plan" instead.`);
    case "no_plan":
      return new AdminError("conflict", "The client has not chosen a plan yet. Choosing one in the app starts their trial; or pick one here.");
    case "plan_gone":
      return new AdminError("conflict", `The plan "${d.planKey}" no longer exists. Change it in Plans or pick another one here.`);
    case "not_in_region":
      return new AdminError("conflict", `The ${d.planName} plan is not offered in ${d.regionName} (${d.regionKey}), the company's region. Pick one of: ${d.offered?.join(", ") || "none (add a price for this region first)"}, or change the company's region.`);
    case "invalid_days":
      return new AdminError("invalid", error.message);
    default:
      return new AdminError("conflict", "The subscription changed while starting the trial. Reload and try again.");
  }
}

/** What the company page shows about the demo stage: status, the chosen plan, the live booking and the trial setting. */
export async function demoPanel(businessId: string) {
  const [business, booking, settings] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { pricingRegion: true, regionMismatch: true, regionMismatchAt: true, user: { select: { subscription: { select: { status: true, plan: true, chosenPlan: true, trialEndsAt: true } } } } } }),
    prisma.demoBooking.findFirst({ where: { businessId, kind: "demo" }, orderBy: { startsAt: "desc" } }),
    getSettings(),
  ]);
  const sub = business?.user.subscription ?? null;
  const chosen = sub?.chosenPlan ? await getPlan(sub.chosenPlan) : null;
  return {
    region: business?.pricingRegion ?? null,
    // An open soft region check (lib/region-check.ts): the IP country at sign-up or a payment start is in a dearer region.
    regionMismatch: business?.regionMismatchAt ? parseMismatch(business.regionMismatch) : null,
    subscription: sub,
    chosenPlanName: chosen?.name ?? sub?.chosenPlan ?? null,
    booking: booking ? { id: booking.id, status: booking.status as BookingStatus, startsAt: booking.startsAt, when: formatSlot(booking.startsAt), meetingLink: booking.meetingLink, notes: booking.notes } : null,
    trialDays: settings.trialDays,
  };
}

import "server-only";
import { prisma } from "@/lib/db";
import { trackEvent } from "@/lib/analytics/events";
import { getPlan } from "@/lib/plan-catalog";
import { cancelBooking, currentBooking, DemoError, placeBooking, type BookingCompany, type BookingView } from "./bookings";

// The short call an existing client may book right after a custom plan request ("Pick a time for a short call" on
// /custom-plan, then /custom-plan/call). It runs on the demo machinery (lib/demo/bookings.ts placeBooking): the same
// slots, buffers, blocked dates and daily cap, the same Google Calendar event with a Meet link (or the .ics invite and
// reusable link without it), and the same reschedule / cancel lead time. The booking is a DemoBooking of kind
// "custom_plan", linked to the request it was booked from, so Admin -> Requests and Admin -> Demos show it. It never
// touches the PENDING_DEMO -> trial steps: a company still waiting for its demo talks its request through in the demo.

/** The analytics event of a booked (or moved) call. Stored, not part of the funnel (lib/analytics/events.ts). */
export const PLAN_CALL_EVENT = "plan_call_booked";

/** The company's live custom plan call, or null. */
export async function currentPlanCall(businessId: string): Promise<BookingView | null> {
  return currentBooking(businessId, "custom_plan");
}

/** The company and its current plan. Refuses a company still waiting for its demo. */
async function callCompany(businessId: string): Promise<{ company: BookingCompany; planKey: string }> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true, name: true, userId: true, phone: true, industry: true, country: true, website: true, description: true,
      user: { select: { email: true, name: true, subscription: { select: { status: true, plan: true } } } },
    },
  });
  if (!business) throw new DemoError("invalid", "We could not find your company.");
  const sub = business.user.subscription;
  if (!sub || sub.status === "PENDING_DEMO") throw new DemoError("not_allowed", "We talk your request through in your demo, so there is no separate call to book.");
  const event = { name: business.name, email: business.user.email, contact: business.user.name, phone: business.phone, industry: business.industry, country: business.country, website: business.website, description: business.description };
  return { company: { id: business.id, userId: business.userId, name: business.name, email: business.user.email, contact: business.user.name, event }, planKey: sub.plan };
}

/** The request a call is about: the one given (it must be this company's), else the company's latest, else null. */
export async function callRequestId(businessId: string, requestId?: string | null): Promise<string | null> {
  if (requestId) {
    const own = await prisma.customPlanRequest.findFirst({ where: { id: requestId, businessId }, select: { id: true } });
    if (!own) throw new DemoError("invalid", "We could not find that request. Send it again from Billing.");
    return own.id;
  }
  const latest = await prisma.customPlanRequest.findFirst({ where: { businessId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  return latest?.id ?? null;
}

/**
 * Books a free slot for the company's call about its request, or moves its live call there (in place, same invite).
 * A new call needs a request of this company; a moved one keeps the request it was booked from.
 */
export async function bookPlanCall(input: { businessId: string; startsAt: Date; requestId?: string | null; now?: Date }): Promise<{ booking: BookingView; rescheduled: boolean }> {
  const now = input.now ?? new Date();
  const { company, planKey } = await callCompany(input.businessId);
  const requestId = await callRequestId(company.id, input.requestId);
  if (!requestId && !(await currentPlanCall(company.id))) throw new DemoError("not_allowed", "Send your custom plan request first, then pick a time for the call.");
  const plan = await getPlan(planKey);
  const result = await placeBooking({ kind: "custom_plan", company, startsAt: input.startsAt, planKey, planName: plan?.name ?? null, requestId, now });
  // google null: another request of this company made the booking a moment ago (and counted it).
  if (result.google !== null) await trackEvent(PLAN_CALL_EVENT, { userId: company.userId, businessId: company.id, props: { rescheduled: result.rescheduled, google: result.google } });
  return { booking: result.booking, rescheduled: result.rescheduled };
}

/** Cancels the company's live call (at least MIN_LEAD_MINUTES ahead, like a demo). */
export async function cancelPlanCall(input: { businessId: string; now?: Date }): Promise<BookingView> {
  const { company } = await callCompany(input.businessId);
  return cancelBooking({ kind: "custom_plan", company, now: input.now ?? new Date() });
}

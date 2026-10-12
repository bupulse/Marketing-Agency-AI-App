import "server-only";
import { prisma } from "@/lib/db";
import { adminEmails } from "@/lib/admin/auth";
import { getSettings } from "@/lib/admin/settings";
import { isServiceEnabled } from "@/lib/admin/switch";
import { EVENT_NAMES, trackEvent } from "@/lib/analytics/events";
import { siteUrl } from "@/lib/auth/site-url";
import { logError } from "@/lib/errors";
import { getPlan } from "@/lib/plan-catalog";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { companyPlans } from "@/lib/region-prices";
import { buildIcs } from "./ics";
import { DEMO_TIME_ZONE, formatSlot, freeSlots, MIN_LEAD_MINUTES, type AvailabilityWindow, type SlotOptions } from "./slots";

// Booking the demo that comes before the trial (section 12 of docs/RWANDA_LAUNCH_PLAN.md). A new company chooses a
// plan from its region, picks a free slot from the owner's availability, and both sides get an email with the
// meeting link and a calendar invite. Reschedule and cancel are allowed up to MIN_LEAD_MINUTES before the call.

export type DemoErrorCode = "invalid" | "conflict" | "not_allowed";
export class DemoError extends Error {
  constructor(
    public code: DemoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DemoError";
  }
}

const MINUTE = 60_000;
const BOOKING_STATUSES = ["booked", "done", "no_show", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const isBookingStatus = (v: unknown): v is BookingStatus => (BOOKING_STATUSES as readonly string[]).includes(v as string);

export async function availabilityWindows(): Promise<AvailabilityWindow[]> {
  const rows = await prisma.adminAvailability.findMany({ orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] });
  return rows.map((r) => ({ weekday: r.weekday, startMinute: r.startMinute, endMinute: r.endMinute }));
}

/** Everything freeSlots needs, read once. `ignoreBookingId` leaves a booking out of the busy list (rescheduling it). */
export async function slotOptions(now: Date, ignoreBookingId?: string | null): Promise<SlotOptions> {
  const [windows, settings, busy] = await Promise.all([
    availabilityWindows(),
    getSettings(),
    prisma.demoBooking.findMany({ where: { status: "booked", endsAt: { gte: now } }, select: { id: true, startsAt: true, endsAt: true } }),
  ]);
  return {
    windows,
    slotMinutes: settings.slotMinutes,
    bufferMinutes: settings.bufferMinutes,
    blockedDates: settings.blockedDates,
    busy: busy.filter((b) => b.id !== ignoreBookingId),
    from: now,
    timeZone: DEMO_TIME_ZONE,
  };
}

/** The slots a client can pick right now. */
export async function availableSlots(now = new Date(), ignoreBookingId?: string | null): Promise<{ slots: Date[]; slotMinutes: number }> {
  const opts = await slotOptions(now, ignoreBookingId);
  return { slots: freeSlots(opts), slotMinutes: opts.slotMinutes ?? 30 };
}

/** The company's live booking (the newest one still "booked"), or null. */
export async function currentBooking(businessId: string) {
  return prisma.demoBooking.findFirst({ where: { businessId, status: "booked" }, orderBy: { startsAt: "desc" } });
}

async function pendingSubscription(businessId: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, pricingRegion: true, userId: true, user: { select: { email: true, name: true, subscription: { select: { status: true, chosenPlan: true } } } } },
  });
  if (!business) throw new DemoError("invalid", "We could not find your company.");
  const sub = business.user.subscription;
  if (!sub || sub.status !== "PENDING_DEMO") throw new DemoError("not_allowed", "Your account is past the demo stage, so there is nothing to book here.");
  return { business, sub };
}

/** Step 1 of /book-demo: the plan the client wants to try. Only plans offered in the company's region. */
export async function choosePlan(input: { businessId: string; planKey: string }) {
  const { business } = await pendingSubscription(input.businessId);
  const { plans } = await companyPlans(business.id);
  const plan = plans.find((p) => p.key === input.planKey);
  if (!plan) throw new DemoError("invalid", "Choose one of the plans shown.");
  await prisma.$transaction(async (tx) => {
    await tx.subscription.updateMany({ where: { userId: business.userId, status: "PENDING_DEMO" }, data: { chosenPlan: plan.key } });
    await tx.demoBooking.updateMany({ where: { businessId: business.id, status: "booked" }, data: { planKey: plan.key } });
  });
  return { planKey: plan.key, planName: plan.name };
}

export type BookingView = NonNullable<Awaited<ReturnType<typeof currentBooking>>>;

/**
 * Step 2: books a free slot (or moves the live booking to it). The slot is checked against the same rules the page
 * used, and the partial unique index on DemoBooking(startsAt) catches two clients taking the same minute at once.
 */
export async function bookDemo(input: { businessId: string; startsAt: Date; now?: Date }): Promise<{ booking: BookingView; rescheduled: boolean }> {
  const now = input.now ?? new Date();
  const { business, sub } = await pendingSubscription(input.businessId);
  if (!sub.chosenPlan) throw new DemoError("invalid", "Choose a plan first.");
  if (Number.isNaN(input.startsAt.getTime())) throw new DemoError("invalid", "Pick a time from the list.");
  const existing = await currentBooking(business.id);
  if (existing && existing.startsAt.getTime() - now.getTime() < MIN_LEAD_MINUTES * MINUTE) {
    throw new DemoError("not_allowed", `Your demo starts in less than ${MIN_LEAD_MINUTES / 60} hours, so it can no longer be moved. Join the call, or email us.`);
  }
  const opts = await slotOptions(now, existing?.id);
  const slotMinutes = opts.slotMinutes ?? 30;
  if (!freeSlots(opts).some((d) => d.getTime() === input.startsAt.getTime())) throw new DemoError("conflict", "That time is no longer free. Pick another one.");
  const settings = await getSettings();
  const endsAt = new Date(input.startsAt.getTime() + slotMinutes * MINUTE);
  let booking: BookingView;
  try {
    booking = await prisma.$transaction(async (tx) => {
      if (existing) await tx.demoBooking.update({ where: { id: existing.id }, data: { status: "cancelled" } });
      return tx.demoBooking.create({ data: { businessId: business.id, planKey: sub.chosenPlan!, startsAt: input.startsAt, endsAt, meetingLink: settings.meetingLink || null } });
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new DemoError("conflict", "Someone just took that time. Pick another one.");
    throw error;
  }
  trackEvent(EVENT_NAMES.demoBooked, { userId: business.userId, businessId: business.id, props: { plan: sub.chosenPlan, rescheduled: Boolean(existing) } });
  await sendBookingEmails(existing ? "rescheduled" : "booked", booking, { name: business.name, email: business.user.email, contact: business.user.name });
  return { booking, rescheduled: Boolean(existing) };
}

/** Cancels the live booking (at least MIN_LEAD_MINUTES ahead). The client books again from the dashboard. */
export async function cancelDemo(input: { businessId: string; now?: Date }): Promise<BookingView> {
  const now = input.now ?? new Date();
  const { business } = await pendingSubscription(input.businessId);
  const existing = await currentBooking(business.id);
  if (!existing) throw new DemoError("invalid", "There is no demo to cancel.");
  if (existing.startsAt.getTime() - now.getTime() < MIN_LEAD_MINUTES * MINUTE) {
    throw new DemoError("not_allowed", `Your demo starts in less than ${MIN_LEAD_MINUTES / 60} hours, so it can no longer be cancelled here. Email us instead.`);
  }
  const { count } = await prisma.demoBooking.updateMany({ where: { id: existing.id, status: "booked" }, data: { status: "cancelled" } });
  if (count !== 1) throw new DemoError("conflict", "That demo was already changed. Reload the page.");
  const cancelled = { ...existing, status: "cancelled" };
  await sendBookingEmails("cancelled", cancelled, { name: business.name, email: business.user.email, contact: business.user.name });
  return cancelled;
}

// ---- invites and emails ---------------------------------------------------------------------------------------------

export const ORGANIZER_NAME = "BuPulse";
export function organizerEmail(): string {
  return adminEmails()[0] ?? "admin@bupulse.com";
}

export function icsUrl(token: string): string {
  return `${siteUrl()}/api/demo/ics/${encodeURIComponent(token)}`;
}

/** The invite text for a booking (also served by /api/demo/ics/[token]). */
export async function bookingIcs(booking: BookingView, business: { name: string; email: string; contact?: string | null }): Promise<string> {
  const plan = await getPlan(booking.planKey);
  return buildIcs({
    uid: `${booking.id}@bupulse.com`,
    sequence: Math.floor(booking.updatedAt.getTime() / 1000),
    start: booking.startsAt,
    end: booking.endsAt,
    summary: `BuPulse demo: ${business.name}`,
    description: [`A ${Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / MINUTE)}-minute walk through BuPulse for ${business.name}.`, plan ? `Plan chosen: ${plan.name}.` : "", booking.meetingLink ? `Join: ${booking.meetingLink}` : "The meeting link follows by email.", `Reschedule or cancel (up to ${MIN_LEAD_MINUTES / 60} hours before): ${siteUrl()}/dashboard`].filter(Boolean).join("\n"),
    url: booking.meetingLink,
    organizer: { name: ORGANIZER_NAME, email: organizerEmail() },
    attendees: [{ name: business.contact ?? business.name, email: business.email }, ...adminEmails().map((email) => ({ email }))],
    cancelled: booking.status === "cancelled",
    stamp: booking.updatedAt,
  });
}

type EmailKind = "booked" | "rescheduled" | "cancelled";

/** One email to the client and one to every admin address, each with the .ics attached and linked. Never throws. */
export async function sendBookingEmails(kind: EmailKind, booking: BookingView, business: { name: string; email: string; contact?: string | null }): Promise<{ client: boolean; admins: number }> {
  if (!(await isServiceEnabled("resend"))) return { client: false, admins: 0 };
  try {
    const plan = await getPlan(booking.planKey);
    const when = `${formatSlot(booking.startsAt)} (${DEMO_TIME_ZONE.replace("_", " ")})`;
    const ics = await bookingIcs(booking, business);
    const attachment = { filename: kind === "cancelled" ? "bupulse-demo-cancelled.ics" : "bupulse-demo.ics", content: Buffer.from(ics, "utf8").toString("base64") };
    const first = business.contact?.split(/\s+/)[0];
    const headingByKind: Record<EmailKind, string> = { booked: "Your BuPulse demo is booked", rescheduled: "Your BuPulse demo has moved", cancelled: "Your BuPulse demo is cancelled" };
    const blocks = [
      { label: "When", value: when },
      ...(booking.meetingLink && kind !== "cancelled" ? [{ label: "Where", value: booking.meetingLink }] : []),
      ...(plan ? [{ label: "Plan you chose", value: plan.name }] : []),
    ];
    const client = renderEmail({
      heading: headingByKind[kind],
      intro:
        kind === "cancelled"
          ? `${first ? `Hi ${first}, ` : ""}your demo on ${when} is cancelled. Book a new time from your dashboard whenever you are ready.`
          : `${first ? `Hi ${first}, ` : ""}${kind === "rescheduled" ? "your demo has a new time." : "thanks for booking."} In about ${Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / MINUTE)} minutes we will look at ${business.name} together, show you what BuPulse can make for it, and answer your questions. After the demo we start your free trial.`,
      blocks,
      button: kind === "cancelled" ? { label: "Book a new time", url: `${siteUrl()}/book-demo?step=time` } : { label: "Add to your calendar", url: icsUrl(booking.icsToken) },
      footer: kind === "cancelled" ? undefined : `Need another time? Reschedule or cancel from your dashboard up to ${MIN_LEAD_MINUTES / 60} hours before the call: ${siteUrl()}/dashboard`,
    });
    const clientSent = await sendEmail({ to: business.email, subject: `${headingByKind[kind]}: ${when}`, html: client.html, text: client.text, attachments: [attachment] });
    const admin = renderEmail({
      heading: `${kind === "cancelled" ? "Demo cancelled" : kind === "rescheduled" ? "Demo moved" : "New demo booked"}: ${business.name}`,
      intro: `${business.contact ?? business.email} (${business.email}) ${kind === "cancelled" ? "cancelled their demo" : kind === "rescheduled" ? "moved their demo to" : "booked a demo for"} ${when}.`,
      blocks: [...blocks, { label: "Company page", value: `${siteUrl()}/admin/companies/${booking.businessId}` }],
      button: kind === "cancelled" ? undefined : { label: "Add to your calendar", url: icsUrl(booking.icsToken) },
    });
    let admins = 0;
    for (const to of adminEmails()) {
      if (await sendEmail({ to, subject: `${kind === "cancelled" ? "Demo cancelled" : kind === "rescheduled" ? "Demo moved" : "New demo"}: ${business.name}, ${when}`, html: admin.html, text: admin.text, attachments: [attachment] })) admins++;
    }
    return { client: clientSent, admins };
  } catch (error) {
    await logError(error, { source: "demo.email", bookingId: booking.id });
    return { client: false, admins: 0 };
  }
}

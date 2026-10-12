import "server-only";
import { prisma } from "@/lib/db";
import { adminEmails } from "@/lib/admin/auth";
import { getSetting } from "@/lib/admin/settings";
import { getSettings } from "@/lib/admin/settings";
import { isServiceEnabled } from "@/lib/admin/switch";
import { EVENT_NAMES, trackEvent } from "@/lib/analytics/events";
import { siteUrl } from "@/lib/auth/site-url";
import { logError } from "@/lib/errors";
import { getPlan } from "@/lib/plan-catalog";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { companyPlans } from "@/lib/region-prices";
import { calendarBusy } from "@/lib/google-calendar/calendar";
import { syncDemoEvent, type DemoEventBusiness } from "@/lib/google-calendar/events";
import { demoGoogleCalendarUrl } from "./calendar-links";
import { buildIcs } from "./ics";
import { BOOKING_WINDOW_DAYS, DEMO_TIME_ZONE, formatSlot, freeSlots, MIN_LEAD_MINUTES, ymdInZone, zonedToUtc, type AvailabilityWindow, type SlotOptions } from "./slots";

// Booking the demo that comes before the trial (section 12 of docs/RWANDA_LAUNCH_PLAN.md). A new company chooses a
// plan from its region, picks a free slot from the owner's availability, and both sides get an email with the
// meeting link and a calendar invite. Reschedule and cancel are allowed up to MIN_LEAD_MINUTES before the call; a
// reschedule moves the one booking in place (same calendar UID, SEQUENCE + 1), so calendars move the event. Once a
// booked slot has passed without the admin marking it, the client may book again (the same row moves).
// When the owner has connected Google Calendar (lib/google-calendar), its busy times are taken out of the free slots
// and each booking is also an event there with a Meet link; without it (or when Google fails) the .ics flow above runs alone.

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

/**
 * Everything freeSlots needs, read once: availability, live bookings and the owner's Google Calendar busy times
 * (cached two minutes; none when not connected or Google fails). `ignoreBookingId` leaves a booking out of the busy
 * list (rescheduling it), and its own Google event with it.
 */
export async function slotOptions(now: Date, ignoreBookingId?: string | null): Promise<SlotOptions> {
  const [windows, settings, busy, google] = await Promise.all([
    availabilityWindows(),
    getSettings(),
    prisma.demoBooking.findMany({ where: { status: "booked", endsAt: { gte: now } }, select: { id: true, startsAt: true, endsAt: true } }),
    calendarBusy(now, new Date(now.getTime() + (BOOKING_WINDOW_DAYS + 1) * 86_400_000)),
  ]);
  const ignored = busy.find((b) => b.id === ignoreBookingId);
  const sameTimes = (a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) => a.startsAt.getTime() === b.startsAt.getTime() && a.endsAt.getTime() === b.endsAt.getTime();
  return {
    windows,
    slotMinutes: settings.slotMinutes,
    bufferMinutes: settings.bufferMinutes,
    blockedDates: settings.blockedDates,
    busy: [...busy.filter((b) => b.id !== ignoreBookingId), ...(ignored ? google.filter((g) => !sameTimes(g, ignored)) : google)],
    from: now,
    timeZone: DEMO_TIME_ZONE,
  };
}

/** The slots a client can pick right now. */
export async function availableSlots(now = new Date(), ignoreBookingId?: string | null): Promise<{ slots: Date[]; slotMinutes: number }> {
  const opts = await slotOptions(now, ignoreBookingId);
  return { slots: freeSlots(opts), slotMinutes: opts.slotMinutes ?? 30 };
}

/** The company's live booking (the one still "booked"; the partial unique index allows one), or null. */
export async function currentBooking(businessId: string) {
  return prisma.demoBooking.findFirst({ where: { businessId, status: "booked" }, orderBy: { startsAt: "desc" } });
}

/** The secret of the .ics route: 32 random bytes, base64url (43 characters). */
export function newIcsToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("base64url");
}

/** Midnight of `now`'s day in the demo time zone (Africa/Kigali), as a UTC instant. */
export function startOfDemoDay(now: Date): Date {
  return zonedToUtc(ymdInZone(now), 0);
}

/** A live booking may still be moved or cancelled by the client until MIN_LEAD_MINUTES before it starts. */
export function canMoveBooking(booking: { startsAt: Date }, now: Date): boolean {
  return booking.startsAt.getTime() - now.getTime() >= MIN_LEAD_MINUTES * MINUTE;
}

/** A booked slot whose end has passed without the admin marking it done or a no-show: the client may book again. */
export function slotPassed(booking: { endsAt: Date }, now: Date): boolean {
  return booking.endsAt.getTime() <= now.getTime();
}

async function pendingSubscription(businessId: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true, name: true, pricingRegion: true, userId: true, phone: true, industry: true, country: true, website: true, description: true,
      user: { select: { email: true, name: true, subscription: { select: { status: true, chosenPlan: true } } } },
    },
  });
  if (!business) throw new DemoError("invalid", "We could not find your company.");
  const sub = business.user.subscription;
  if (!sub || sub.status !== "PENDING_DEMO") throw new DemoError("not_allowed", "Your account is past the demo stage, so there is nothing to book here.");
  return { business, sub };
}

/** What the invite and the Google event say about the company. */
function eventBusiness(business: Awaited<ReturnType<typeof pendingSubscription>>["business"]): DemoEventBusiness {
  return { name: business.name, email: business.user.email, contact: business.user.name, phone: business.phone, industry: business.industry, country: business.country, website: business.website, description: business.description };
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
 * Step 2: books a free slot, or moves the live booking to it (in place: same row and calendar UID, SEQUENCE + 1). The
 * slot is checked against the same rules the page used; two partial unique indexes back it up: one live booking per
 * start time, one per company. The slot check and the write are not one transaction: a second client taking a
 * neighbouring slot in the same instant can land inside the buffer (accepted: the owner sees both in Demos).
 */
export async function bookDemo(input: { businessId: string; startsAt: Date; now?: Date }): Promise<{ booking: BookingView; rescheduled: boolean }> {
  const now = input.now ?? new Date();
  const { business, sub } = await pendingSubscription(input.businessId);
  if (!sub.chosenPlan) throw new DemoError("invalid", "Choose a plan first.");
  if (Number.isNaN(input.startsAt.getTime())) throw new DemoError("invalid", "Pick a time from the list.");
  const existing = await currentBooking(business.id);
  // A booking that is about to start cannot be moved; one whose slot has passed can (the client books again).
  if (existing && !slotPassed(existing, now) && !canMoveBooking(existing, now)) {
    throw new DemoError("not_allowed", `Your demo starts in less than ${MIN_LEAD_MINUTES / 60} hours, so it can no longer be moved. Join the call, or email us.`);
  }
  // A global cap on new bookings per day (Admin -> Settings): each one emails every admin, so a flood of sign-ups
  // cannot fill the calendar or the inbox. Moving the company's own booking does not count.
  if (!existing) {
    const cap = await getSetting("demoDailyCap");
    const today = await prisma.demoBooking.count({ where: { status: "booked", createdAt: { gte: startOfDemoDay(now) } } });
    if (today >= cap) throw new DemoError("not_allowed", "We have reached today's limit for new demo bookings. Please try again tomorrow, or email hello@bupulse.com.");
  }
  const opts = await slotOptions(now, existing?.id);
  const slotMinutes = opts.slotMinutes ?? 30;
  if (!freeSlots(opts).some((d) => d.getTime() === input.startsAt.getTime())) throw new DemoError("conflict", "That time is no longer free. Pick another one.");
  const settings = await getSettings();
  const endsAt = new Date(input.startsAt.getTime() + slotMinutes * MINUTE);
  // A moved booking keeps the Meet link of its Google event (the event moves too); otherwise the reusable link.
  const data = { planKey: sub.chosenPlan, startsAt: input.startsAt, endsAt, meetingLink: existing?.meetLink || settings.meetingLink || null };
  let booking: BookingView;
  try {
    if (existing) {
      const { count } = await prisma.demoBooking.updateMany({ where: { id: existing.id, status: "booked" }, data: { ...data, sequence: { increment: 1 } } });
      if (count !== 1) throw new DemoError("conflict", "That demo was just changed. Reload the page.");
      booking = (await prisma.demoBooking.findUnique({ where: { id: existing.id } })) as BookingView;
    } else {
      booking = await prisma.demoBooking.create({ data: { businessId: business.id, ...data, icsToken: newIcsToken() } });
    }
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    // Either this company got its booking from another request (return it) or the start time was taken meanwhile.
    const current = await currentBooking(business.id);
    if (current && !existing) return { booking: current, rescheduled: false };
    throw new DemoError("conflict", "Someone just took that time. Pick another one.");
  }
  // The Google event (Meet link, Google's invite to the client). On failure or without a connection, nothing changes.
  const plan = await getPlan(booking.planKey);
  const synced = await syncDemoEvent(existing ? "rescheduled" : "booked", booking, eventBusiness(business), plan?.name ?? null);
  if (synced) {
    booking = await prisma.demoBooking.update({
      where: { id: booking.id },
      data: { googleEventId: synced.googleEventId, meetLink: synced.meetLink ?? booking.meetLink, ...(synced.meetLink ? { meetingLink: synced.meetLink } : {}) },
    });
  }
  trackEvent(EVENT_NAMES.demoBooked, { userId: business.userId, businessId: business.id, props: { plan: sub.chosenPlan, rescheduled: Boolean(existing), google: Boolean(synced) } });
  await sendBookingEmails(existing ? "rescheduled" : "booked", booking, { name: business.name, email: business.user.email, contact: business.user.name });
  return { booking, rescheduled: Boolean(existing) };
}

/** Cancels the live booking (at least MIN_LEAD_MINUTES ahead). The invite goes out as METHOD:CANCEL for the same UID. */
export async function cancelDemo(input: { businessId: string; now?: Date }): Promise<BookingView> {
  const now = input.now ?? new Date();
  const { business } = await pendingSubscription(input.businessId);
  const existing = await currentBooking(business.id);
  if (!existing) throw new DemoError("invalid", "There is no demo to cancel.");
  if (!slotPassed(existing, now) && !canMoveBooking(existing, now)) {
    throw new DemoError("not_allowed", `Your demo starts in less than ${MIN_LEAD_MINUTES / 60} hours, so it can no longer be cancelled here. Email us instead.`);
  }
  const { count } = await prisma.demoBooking.updateMany({ where: { id: existing.id, status: "booked" }, data: { status: "cancelled", sequence: { increment: 1 } } });
  if (count !== 1) throw new DemoError("conflict", "That demo was already changed. Reload the page.");
  const cancelled = { ...existing, status: "cancelled", sequence: existing.sequence + 1 };
  // Google tells the client too (sendUpdates=all); the event id stays on the row as a record.
  await syncDemoEvent("cancelled", cancelled, eventBusiness(business), null);
  await sendBookingEmails("cancelled", cancelled, { name: business.name, email: business.user.email, contact: business.user.name });
  return cancelled;
}

// ---- invites and emails ---------------------------------------------------------------------------------------------

export const ORGANIZER_NAME = "BuPulse";
/** The organizer of every invite: a dedicated address (Admin -> Settings), never one of ADMIN_EMAILS. */
export async function organizerEmail(): Promise<string> {
  return getSetting("organizerEmail");
}

export function icsUrl(token: string): string {
  return `${siteUrl()}/api/demo/ics/${encodeURIComponent(token)}`;
}

/**
 * The invite text for a booking. The client's copy (also served by /api/demo/ics/[token]) lists only the client as
 * attendee; the admins' copy adds the admin addresses, so they never reach a client's calendar.
 */
export async function bookingIcs(booking: BookingView, business: { name: string; email: string; contact?: string | null }, audience: "client" | "admin" = "client"): Promise<string> {
  const [plan, organizer] = await Promise.all([getPlan(booking.planKey), organizerEmail()]);
  return buildIcs({
    uid: `${booking.id}@bupulse.com`,
    sequence: booking.sequence,
    start: booking.startsAt,
    end: booking.endsAt,
    summary: `BuPulse demo: ${business.name}`,
    description: [`A ${Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / MINUTE)}-minute walk through BuPulse for ${business.name}.`, plan ? `Plan chosen: ${plan.name}.` : "", booking.meetingLink ? `Join: ${booking.meetingLink}` : "The meeting link follows by email.", `Reschedule or cancel (up to ${MIN_LEAD_MINUTES / 60} hours before): ${siteUrl()}/dashboard`].filter(Boolean).join("\n"),
    url: booking.meetingLink,
    organizer: { name: ORGANIZER_NAME, email: organizer },
    attendees: [{ name: business.contact ?? business.name, email: business.email }, ...(audience === "admin" ? adminEmails().map((email) => ({ email })) : [])],
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
    const filename = kind === "cancelled" ? "bupulse-demo-cancelled.ics" : "bupulse-demo.ics";
    const attachment = { filename, content: Buffer.from(await bookingIcs(booking, business, "client"), "utf8").toString("base64") };
    const adminAttachment = { filename, content: Buffer.from(await bookingIcs(booking, business, "admin"), "utf8").toString("base64") };
    const first = business.contact?.split(/\s+/)[0];
    const headingByKind: Record<EmailKind, string> = { booked: "Your BuPulse demo is booked", rescheduled: "Your BuPulse demo has moved", cancelled: "Your BuPulse demo is cancelled" };
    const blocks = [
      { label: "When", value: when },
      ...(booking.meetingLink && kind !== "cancelled" ? [{ label: booking.meetLink ? "Google Meet" : "Where", value: booking.meetingLink }] : []),
      ...(plan ? [{ label: "Plan you chose", value: plan.name }] : []),
    ];
    const google = demoGoogleCalendarUrl(booking, business.name, `${siteUrl()}/dashboard`);
    const calendarBlock = { label: "Add to your calendar", value: `Google Calendar: ${google}\nApple or Outlook (.ics): ${icsUrl(booking.icsToken)}` };
    const client = renderEmail({
      heading: headingByKind[kind],
      intro:
        kind === "cancelled"
          ? `${first ? `Hi ${first}, ` : ""}your demo on ${when} is cancelled. Book a new time from your dashboard whenever you are ready.`
          : `${first ? `Hi ${first}, ` : ""}${kind === "rescheduled" ? "your demo has a new time." : "thanks for booking."} In about ${Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / MINUTE)} minutes we will look at ${business.name} together, show you what BuPulse can make for it, and answer your questions. After the demo we start your free trial.`,
      blocks: kind === "cancelled" ? blocks : [...blocks, calendarBlock],
      button: kind === "cancelled" ? { label: "Book a new time", url: `${siteUrl()}/book-demo?step=time` } : booking.meetingLink ? { label: "Join the meeting", url: booking.meetingLink } : { label: "Add to Google Calendar", url: google },
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
      if (await sendEmail({ to, subject: `${kind === "cancelled" ? "Demo cancelled" : kind === "rescheduled" ? "Demo moved" : "New demo"}: ${business.name}, ${when}`, html: admin.html, text: admin.text, attachments: [adminAttachment] })) admins++;
    }
    return { client: clientSent, admins };
  } catch (error) {
    await logError(error, { source: "demo.email", bookingId: booking.id });
    return { client: false, admins: 0 };
  }
}

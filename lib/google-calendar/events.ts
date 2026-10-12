import "server-only";
import { siteUrl } from "@/lib/auth/site-url";
import { prisma } from "@/lib/db";
import { getPlan } from "@/lib/plan-catalog";
import { demoTitle } from "@/lib/demo/calendar-links";
import { DEMO_TIME_ZONE, MIN_LEAD_MINUTES } from "@/lib/demo/slots";
import { logError } from "@/lib/errors";
import { deleteEvent, eventConnection, GoogleApiError, insertEvent, meetLinkOf, patchEvent, resetGoogleCalendarCache, type GoogleEvent } from "./calendar";

// The demo booking's event in the owner's Google Calendar: created with a Meet link on booking, moved in place on
// reschedule, deleted on cancel, each time with sendUpdates=all so the client gets Google's own invite or update.
// Never in the way of a booking: when Google is not connected or fails, the caller keeps the .ics + meeting-link flow.
// A change that did not reach Google (failure, timeout, login to reconnect) is marked on the booking
// (googleSyncPending) and retried from the booking's current state: on the next booking request, by the hourly
// trial-reminders cron, and with Retry on Admin -> Demos.

export type DemoEventBooking = { id: string; businessId: string; startsAt: Date; endsAt: Date; googleEventId?: string | null; meetingLink?: string | null };
export type DemoEventBusiness = {
  name: string;
  email: string;
  contact?: string | null;
  phone?: string | null;
  industry?: string | null;
  country?: string | null;
  website?: string | null;
  description?: string | null;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The event description: what the call is for and what the owner needs during it. The client sees it too. */
export function demoEventDescription(business: DemoEventBusiness, planName: string | null): string {
  const sections = [
    [`A walk through BuPulse for ${business.name}.`, planName ? `Plan chosen: ${planName}` : ""],
    [
      `Contact: ${business.contact ?? business.name} <${business.email}>`,
      business.phone ? `Phone: ${business.phone}` : "",
      business.industry ? `Industry: ${business.industry}` : "",
      business.country ? `Country: ${business.country}` : "",
      business.website ? `Website: ${business.website}` : "",
      business.description ? `About: ${clip(business.description.replace(/\s+/g, " ").trim(), 400)}` : "",
    ],
    [`Reschedule or cancel (up to ${MIN_LEAD_MINUTES / 60} hours before): ${siteUrl()}/dashboard`],
  ];
  return sections.map((lines) => lines.filter(Boolean).join("\n")).join("\n\n");
}

/** The admin-only line kept out of the shared description: the Client 360 link, in the event's private properties. */
export const client360Url = (businessId: string) => `${siteUrl()}/admin/companies/${encodeURIComponent(businessId)}`;

/**
 * The Calendar API body of a new demo event (Africa/Kigali, reminders, the client as attendee). With `conference` (the
 * default) Google makes a Meet link; a late retry makes none and points at the link the client already has.
 */
export function demoEventBody(booking: DemoEventBooking, business: DemoEventBusiness, planName: string | null, opts: { withUid?: boolean; conference?: boolean } = {}): Record<string, unknown> {
  const conference = opts.conference !== false;
  return {
    summary: demoTitle(business.name),
    description: demoEventDescription(business, planName),
    start: { dateTime: booking.startsAt.toISOString(), timeZone: DEMO_TIME_ZONE },
    end: { dateTime: booking.endsAt.toISOString(), timeZone: DEMO_TIME_ZONE },
    attendees: [{ email: business.email, displayName: business.contact ?? business.name }],
    // The same UID as the .ics the emails attach, so calendar apps keep one event when the client adds both.
    ...(opts.withUid === false ? {} : { iCalUID: `${booking.id}@bupulse.com` }),
    ...(conference
      ? { conferenceData: { createRequest: { requestId: `bupulse-${booking.id}-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } } }
      : booking.meetingLink
        ? { location: booking.meetingLink }
        : {}),
    reminders: { useDefault: false, overrides: [{ method: "email", minutes: 24 * 60 }, { method: "popup", minutes: 15 }] },
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    extendedProperties: { private: { bupulseBookingId: booking.id, client360: client360Url(booking.businessId) } },
  };
}

export type SyncKind = "booked" | "rescheduled" | "cancelled";
/** skipped: Google is not set up or not connected (nothing to retry). failed: to retry (marked on the booking). */
export type DemoSyncResult = { status: "skipped" } | { status: "ok"; googleEventId: string | null; meetLink: string | null } | { status: "failed"; error: string };

type Connection = NonNullable<Awaited<ReturnType<typeof eventConnection>>>;

async function create(c: Connection, booking: DemoEventBooking, business: DemoEventBusiness, planName: string | null, conference: boolean): Promise<GoogleEvent> {
  try {
    return await insertEvent(c, demoEventBody(booking, business, planName, { conference }));
  } catch (error) {
    // 409: an event with this UID existed in the calendar before (deleted, then the booking came back). A new UID then.
    if (error instanceof GoogleApiError && error.status === 409) return insertEvent(c, demoEventBody(booking, business, planName, { withUid: false, conference }));
    throw error;
  }
}

/**
 * Brings the Google event in line with the booking: "booked" creates it (with a Meet link unless `conference` is
 * false), "rescheduled" moves it (or creates it when there is none or Google lost it), "cancelled" deletes it.
 * Never throws; a failure is logged and returned as "failed" for the caller to mark (persistDemoSync).
 */
export async function syncDemoEvent(kind: SyncKind, booking: DemoEventBooking, business: DemoEventBusiness, planName: string | null, opts: { conference?: boolean } = {}): Promise<DemoSyncResult> {
  let c: Connection | null;
  try {
    c = await eventConnection();
  } catch {
    c = null;
  }
  if (!c) return { status: "skipped" };
  if (kind === "cancelled" && !booking.googleEventId) return { status: "ok", googleEventId: null, meetLink: null };
  if (c.needsReconnect) return { status: "failed", error: "Google Calendar needs reconnecting (Settings)." };
  const conference = opts.conference !== false;
  try {
    let event: GoogleEvent;
    if (kind === "cancelled") {
      await deleteEvent(c, booking.googleEventId!);
      return { status: "ok", googleEventId: booking.googleEventId!, meetLink: null };
    }
    if (booking.googleEventId) {
      try {
        event = await patchEvent(c, booking.googleEventId, {
          summary: demoTitle(business.name),
          description: demoEventDescription(business, planName),
          start: { dateTime: booking.startsAt.toISOString(), timeZone: DEMO_TIME_ZONE },
          end: { dateTime: booking.endsAt.toISOString(), timeZone: DEMO_TIME_ZONE },
          status: "confirmed",
        });
      } catch (error) {
        // The owner deleted the event in Google meanwhile (or it lives in a previously connected account): make a new one.
        if (!(error instanceof GoogleApiError && (error.status === 404 || error.status === 410))) throw error;
        event = await create(c, booking, business, planName, conference);
      }
    } else {
      event = await create(c, booking, business, planName, conference);
    }
    return { status: "ok", googleEventId: event.id, meetLink: meetLinkOf(event) };
  } catch (error) {
    await logError(error, { source: `google-calendar.${kind}`, businessId: booking.businessId, bookingId: booking.id });
    return { status: "failed", error: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
  } finally {
    // The calendar just changed: the next slot list reads busy times again.
    resetGoogleCalendarCache("busy");
  }
}

/**
 * Writes a sync result to the booking: ok stores the event (and its Meet link when Google made one, keeping the old
 * one otherwise) and clears the pending mark; failed sets it with the reason; skipped changes nothing.
 */
export async function persistDemoSync(booking: { id: string; meetLink?: string | null }, result: DemoSyncResult, now = new Date()) {
  if (result.status === "skipped") return null;
  if (result.status === "failed") {
    return prisma.demoBooking.update({ where: { id: booking.id }, data: { googleSyncPending: true, googleSyncError: result.error, googleSyncAttemptAt: now } });
  }
  return prisma.demoBooking.update({
    where: { id: booking.id },
    data: {
      googleSyncPending: false,
      googleSyncError: null,
      googleSyncAttemptAt: now,
      ...(result.googleEventId ? { googleEventId: result.googleEventId } : {}),
      ...(result.meetLink ? { meetLink: result.meetLink, meetingLink: result.meetLink } : {}),
    },
  });
}

/** Retries are at least this far apart per booking (the negative cache spaces out Google calls as well). */
export const RETRY_SPACING_MS = 60 * 1000;

/**
 * Retries one booking's pending sync from its current state: cancelled -> delete the event; with an event -> move it
 * to the booking's time; without one and still ahead -> create it without a new Meet link (the client already has the
 * reusable link). A past booking without an event, or a cancelled one without an event, needs nothing.
 */
export async function retryDemoSync(id: string, now = new Date()): Promise<DemoSyncResult | { status: "not_pending" }> {
  const booking = await prisma.demoBooking.findUnique({
    where: { id },
    include: { business: { select: { name: true, phone: true, industry: true, country: true, website: true, description: true, user: { select: { email: true, name: true } } } } },
  });
  if (!booking || !booking.googleSyncPending) return { status: "not_pending" };
  const b = booking.business;
  const business: DemoEventBusiness = { name: b.name, email: b.user.email, contact: b.user.name, phone: b.phone, industry: b.industry, country: b.country, website: b.website, description: b.description };
  let result: DemoSyncResult;
  if (booking.status === "cancelled") {
    result = await syncDemoEvent("cancelled", booking, business, null);
  } else if (booking.googleEventId) {
    result = await syncDemoEvent("rescheduled", booking, business, (await getPlan(booking.planKey))?.name ?? null, { conference: false });
  } else if (booking.status === "booked" && booking.endsAt.getTime() > now.getTime()) {
    result = await syncDemoEvent("booked", booking, business, (await getPlan(booking.planKey))?.name ?? null, { conference: false });
  } else {
    result = { status: "ok", googleEventId: null, meetLink: null };
  }
  // Disconnected meanwhile: nothing will ever sync it, so the mark goes.
  if (result.status === "skipped") result = { status: "ok", googleEventId: null, meetLink: null };
  await persistDemoSync(booking, result, now);
  return result;
}

/** Retries a few pending syncs (oldest attempt first). Called after booking requests and by the hourly cron. Never throws. */
export async function retryPendingDemoSyncs(opts: { limit?: number; now?: Date } = {}): Promise<{ tried: number; fixed: number; failed: number }> {
  const now = opts.now ?? new Date();
  const out = { tried: 0, fixed: 0, failed: 0 };
  try {
    const rows = await prisma.demoBooking.findMany({
      where: { googleSyncPending: true, OR: [{ googleSyncAttemptAt: null }, { googleSyncAttemptAt: { lt: new Date(now.getTime() - RETRY_SPACING_MS) } }] },
      orderBy: { googleSyncAttemptAt: "asc" },
      take: opts.limit ?? 20,
      select: { id: true },
    });
    for (const row of rows) {
      out.tried++;
      const r = await retryDemoSync(row.id, now);
      if (r.status === "failed") out.failed++;
      else if (r.status === "ok") out.fixed++;
    }
  } catch (error) {
    await logError(error, { source: "google-calendar.retry" });
  }
  return out;
}

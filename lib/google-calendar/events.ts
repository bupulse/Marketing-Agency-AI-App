import "server-only";
import { siteUrl } from "@/lib/auth/site-url";
import { demoTitle } from "@/lib/demo/calendar-links";
import { DEMO_TIME_ZONE, MIN_LEAD_MINUTES } from "@/lib/demo/slots";
import { logError } from "@/lib/errors";
import { deleteEvent, eventConnection, GoogleApiError, insertEvent, meetLinkOf, patchEvent, resetGoogleCalendarCache, type GoogleEvent } from "./calendar";

// The demo booking's event in the owner's Google Calendar: created with a Meet link on booking, moved in place on
// reschedule, deleted on cancel, each time with sendUpdates=all so the client gets Google's own invite or update.
// Never in the way of a booking: when Google is not connected or fails, the caller keeps the .ics + meeting-link flow.

export type DemoEventBooking = { id: string; businessId: string; startsAt: Date; endsAt: Date; googleEventId?: string | null };
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

/** The Calendar API body of a new demo event (Africa/Kigali, Meet requested, reminders, the client as attendee). */
export function demoEventBody(booking: DemoEventBooking, business: DemoEventBusiness, planName: string | null, opts: { withUid?: boolean } = {}): Record<string, unknown> {
  return {
    summary: demoTitle(business.name),
    description: demoEventDescription(business, planName),
    start: { dateTime: booking.startsAt.toISOString(), timeZone: DEMO_TIME_ZONE },
    end: { dateTime: booking.endsAt.toISOString(), timeZone: DEMO_TIME_ZONE },
    attendees: [{ email: business.email, displayName: business.contact ?? business.name }],
    // The same UID as the .ics the emails attach, so calendar apps keep one event when the client adds both.
    ...(opts.withUid === false ? {} : { iCalUID: `${booking.id}@bupulse.com` }),
    conferenceData: { createRequest: { requestId: `bupulse-${booking.id}-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } },
    reminders: { useDefault: false, overrides: [{ method: "email", minutes: 24 * 60 }, { method: "popup", minutes: 15 }] },
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    extendedProperties: { private: { bupulseBookingId: booking.id, client360: client360Url(booking.businessId) } },
  };
}

export type DemoEventResult = { googleEventId: string | null; meetLink: string | null };

async function create(c: NonNullable<Awaited<ReturnType<typeof eventConnection>>>, booking: DemoEventBooking, business: DemoEventBusiness, planName: string | null): Promise<GoogleEvent> {
  try {
    return await insertEvent(c, demoEventBody(booking, business, planName));
  } catch (error) {
    // 409: an event with this UID existed in the calendar before (deleted, then the booking came back). A new UID then.
    if (error instanceof GoogleApiError && error.status === 409) return insertEvent(c, demoEventBody(booking, business, planName, { withUid: false }));
    throw error;
  }
}

/**
 * Brings the Google event in line with the booking. Returns the event id and Meet link to store, or null when Google
 * is not connected or the call failed (logged; the booking goes on with the .ics flow). Cancel returns ids cleared.
 */
export async function syncDemoEvent(kind: "booked" | "rescheduled" | "cancelled", booking: DemoEventBooking, business: DemoEventBusiness, planName: string | null): Promise<DemoEventResult | null> {
  let c: Awaited<ReturnType<typeof eventConnection>>;
  try {
    c = await eventConnection();
  } catch {
    c = null;
  }
  if (!c) return null;
  try {
    let event: GoogleEvent;
    if (kind === "cancelled") {
      if (!booking.googleEventId) return null;
      await deleteEvent(c, booking.googleEventId);
      return { googleEventId: booking.googleEventId, meetLink: null };
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
        // The owner deleted the event in Google meanwhile: make a new one.
        if (!(error instanceof GoogleApiError && (error.status === 404 || error.status === 410))) throw error;
        event = await create(c, booking, business, planName);
      }
    } else {
      event = await create(c, booking, business, planName);
    }
    return { googleEventId: event.id, meetLink: meetLinkOf(event) };
  } catch (error) {
    await logError(error, { source: `google-calendar.${kind}`, businessId: booking.businessId, bookingId: booking.id });
    return null;
  } finally {
    // The calendar just changed: the next slot list reads busy times again.
    resetGoogleCalendarCache("busy");
  }
}

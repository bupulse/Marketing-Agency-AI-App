// "Add to Google Calendar" for a demo booking: Google's event template link, which works without any connection on our
// side (the client's own Google account adds the event). Pure, so the dashboard, the emails and the tests agree.

import { DEMO_TIME_ZONE } from "./slots";

const GOOGLE_TEMPLATE_URL = "https://calendar.google.com/calendar/render";

/** 2026-10-13T08:00:00.000Z -> 20261013T080000Z, the form Google's `dates` wants. */
export const googleDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function googleCalendarUrl(e: { title: string; start: Date; end: Date; details: string; location?: string | null; timeZone?: string }): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${googleDate(e.start)}/${googleDate(e.end)}`,
    details: e.details,
    ...(e.location ? { location: e.location } : {}),
    ctz: e.timeZone ?? DEMO_TIME_ZONE,
  });
  return `${GOOGLE_TEMPLATE_URL}?${params.toString()}`;
}

/** The title every copy of the demo event carries (Google event, template link). */
export const demoTitle = (businessName: string) => `BuPulse demo — ${businessName}`;

/** The template link for a booking, with the join link as the location. */
export function demoGoogleCalendarUrl(booking: { startsAt: Date; endsAt: Date; meetingLink?: string | null }, businessName: string, dashboardUrl: string): string {
  const details = [booking.meetingLink ? `Join: ${booking.meetingLink}` : "The meeting link follows by email.", `Reschedule or cancel: ${dashboardUrl}`].join("\n");
  return googleCalendarUrl({ title: demoTitle(businessName), start: booking.startsAt, end: booking.endsAt, details, location: booking.meetingLink });
}

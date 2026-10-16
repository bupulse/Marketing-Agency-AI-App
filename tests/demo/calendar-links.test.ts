import { describe, expect, it } from "vitest";
import { demoGoogleCalendarUrl, googleCalendarUrl, googleDate } from "@/lib/demo/calendar-links";

// "Add to Google Calendar": Google's template link, UTC dates, shown in Africa/Kigali, the join link as location.

describe("add to Google Calendar", () => {
  it("builds Google's template link with UTC dates and the Kigali zone", () => {
    const url = new URL(googleCalendarUrl({ title: "BuPulse demo — Inzu & Co", start: new Date("2026-10-13T08:00:00Z"), end: new Date("2026-10-13T08:30:00Z"), details: "Join: https://meet.google.com/abc-defg-hij\nSee you", location: "https://meet.google.com/abc-defg-hij" }));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: "TEMPLATE",
      text: "BuPulse demo — Inzu & Co",
      dates: "20261013T080000Z/20261013T083000Z",
      details: "Join: https://meet.google.com/abc-defg-hij\nSee you",
      location: "https://meet.google.com/abc-defg-hij",
      ctz: "Africa/Kigali",
    });
    expect(googleDate(new Date("2026-01-02T03:04:05.678Z"))).toBe("20260102T030405Z");
  });

  it("for a booking: the meeting link as location, or a note when there is none yet", () => {
    const booking = { startsAt: new Date("2026-10-13T08:00:00Z"), endsAt: new Date("2026-10-13T08:30:00Z") };
    const withLink = new URL(demoGoogleCalendarUrl({ ...booking, meetingLink: "https://meet.google.com/abc-defg-hij" }, "Inzu", "https://bupulse.com/dashboard"));
    expect(withLink.searchParams.get("text")).toBe("BuPulse demo — Inzu");
    expect(withLink.searchParams.get("location")).toBe("https://meet.google.com/abc-defg-hij");
    expect(withLink.searchParams.get("details")).toBe("Join: https://meet.google.com/abc-defg-hij\nReschedule or cancel: https://bupulse.com/dashboard");
    const without = new URL(demoGoogleCalendarUrl({ ...booking, meetingLink: null }, "Inzu", "https://bupulse.com/dashboard"));
    expect(without.searchParams.has("location")).toBe(false);
    expect(without.searchParams.get("details")).toMatch(/^The meeting link follows by email\./);
  });
});

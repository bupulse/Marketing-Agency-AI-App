import { describe, expect, it } from "vitest";
import { cleanWindows, freeSlots, groupSlotsByDay, isSlotFree, parseHm, ymdInZone, zoneOffsetMinutes, zonedToUtc, type AvailabilityWindow } from "@/lib/demo/slots";
import { buildIcs } from "@/lib/demo/ics";

// Free demo slots from weekly windows in Africa/Kigali (UTC+2, no daylight saving), and the calendar invite text.

const WEEK: AvailabilityWindow[] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 9 * 60, endMinute: 17 * 60 }));
// Monday 12 October 2026, 06:00 UTC = 08:00 in Kigali.
const MONDAY = new Date("2026-10-12T06:00:00Z");
const base = { windows: WEEK, slotMinutes: 30, bufferMinutes: 15, from: MONDAY, days: 7, minLeadMinutes: 120 };

describe("time zones", () => {
  it("converts Kigali wall-clock times to instants and back", () => {
    expect(zoneOffsetMinutes(MONDAY)).toBe(120);
    expect(zonedToUtc("2026-10-12", 10 * 60).toISOString()).toBe("2026-10-12T08:00:00.000Z");
    expect(ymdInZone(new Date("2026-10-12T22:30:00Z"))).toBe("2026-10-13"); // 00:30 next day in Kigali
    // A zone with daylight saving comes out right too.
    expect(zonedToUtc("2026-07-01", 9 * 60, "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedToUtc("2026-01-15", 9 * 60, "America/New_York").toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("parses HH:MM", () => {
    expect(parseHm("09:00")).toBe(540);
    expect(parseHm("17:30")).toBe(1050);
    expect(parseHm("25:00")).toBeNull();
    expect(parseHm("nine")).toBeNull();
    expect(() => cleanWindows([{ weekday: 1, startMinute: 600, endMinute: 540 }])).toThrow(/after the start/);
    expect(() => cleanWindows([{ weekday: 7, startMinute: 0, endMinute: 60 }])).toThrow(/weekday/);
  });
});

describe("free slots", () => {
  it("starts after the lead time, follows the windows, and skips weekends", () => {
    const slots = freeSlots(base);
    // Monday: 08:00 + 2 h lead = 10:00 Kigali, then every 30 minutes until 16:30; no slots on Saturday or Sunday.
    expect(slots[0].toISOString()).toBe("2026-10-12T08:00:00.000Z");
    expect(slots[1].toISOString()).toBe("2026-10-12T08:30:00.000Z");
    const monday = slots.filter((s) => ymdInZone(s) === "2026-10-12");
    expect(monday).toHaveLength(14);
    expect(monday.at(-1)!.toISOString()).toBe("2026-10-12T14:30:00.000Z");
    expect(slots.some((s) => ["2026-10-17", "2026-10-18"].includes(ymdInZone(s)))).toBe(false);
    expect(slots.filter((s) => ymdInZone(s) === "2026-10-13")).toHaveLength(16);
  });

  it("leaves blocked dates out", () => {
    const slots = freeSlots({ ...base, blockedDates: ["2026-10-13"] });
    expect(slots.some((s) => ymdInZone(s) === "2026-10-13")).toBe(false);
    expect(slots.some((s) => ymdInZone(s) === "2026-10-14")).toBe(true);
  });

  it("keeps a buffer around live bookings, so neither the slot nor its neighbours are offered", () => {
    const busy = [{ startsAt: new Date("2026-10-13T09:00:00Z"), endsAt: new Date("2026-10-13T09:30:00Z") }]; // Tuesday 11:00-11:30 Kigali
    const slots = freeSlots({ ...base, busy }).filter((s) => ymdInZone(s) === "2026-10-13").map((s) => s.toISOString().slice(11, 16));
    expect(slots).not.toContain("09:00");
    expect(slots).not.toContain("08:30"); // ends 09:00, inside the 15-minute buffer
    expect(slots).not.toContain("09:30"); // starts 09:30, inside the buffer after
    expect(slots).toContain("08:00");
    expect(slots).toContain("10:00");
    expect(isSlotFree(new Date("2026-10-13T09:00:00Z"), { ...base, busy })).toBe(false);
    expect(isSlotFree(new Date("2026-10-13T09:00:00Z"), base)).toBe(true);
    expect(isSlotFree(new Date("2026-10-13T09:10:00Z"), base)).toBe(false); // not on the grid
  });

  it("respects the slot length and groups by day", () => {
    const hourly = freeSlots({ ...base, slotMinutes: 60, windows: [{ weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60 }] });
    expect(hourly.map((s) => s.toISOString().slice(11, 16))).toEqual(["08:00", "09:00"]); // 10:00 and 11:00 Kigali; 09:00 is before the lead time
    const groups = groupSlotsByDay(freeSlots(base));
    // Seven days from Monday 12 October: the working days up to Friday 16; the next Monday is outside the window.
    expect(groups.map((g) => g.ymd)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(groups[0].label).toMatch(/Monday 12 October/);
  });
});

describe("calendar invite", () => {
  it("builds a REQUEST with the meeting link, and a CANCEL when cancelled", () => {
    const ics = buildIcs({
      uid: "bk1@bupulse.com",
      sequence: 3,
      start: new Date("2026-10-13T09:00:00Z"),
      end: new Date("2026-10-13T09:30:00Z"),
      summary: "BuPulse demo: Inzu Fashion",
      description: "Line one; with, commas\nLine two",
      url: "https://meet.google.com/abc-defg-hij",
      organizer: { name: "BuPulse", email: "admin@bupulse.com" },
      attendees: [{ name: "Aline", email: "aline@example.com" }],
      stamp: new Date("2026-10-09T10:00:00Z"),
    });
    expect(ics).toContain("METHOD:REQUEST\r\n");
    expect(ics).toContain("DTSTART:20261013T090000Z\r\n");
    expect(ics).toContain("DTEND:20261013T093000Z\r\n");
    expect(ics).toContain("SEQUENCE:3\r\n");
    expect(ics).toContain("DESCRIPTION:Line one\\; with\\, commas\\nLine two\r\n");
    expect(ics).toContain("URL:https://meet.google.com/abc-defg-hij\r\n");
    // Long lines are folded (CRLF + space) at 75 octets; unfolding gives the attendee line back whole.
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
    expect(ics.replace(/\r\n /g, "")).toContain("ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Aline:mailto:aline@example.com");
    const cancelled = buildIcs({ uid: "x", sequence: 1, start: new Date(), end: new Date(), summary: "s", description: "d", organizer: { name: "B", email: "a@b.c" }, attendees: [], cancelled: true });
    expect(cancelled).toContain("METHOD:CANCEL");
    expect(cancelled).toContain("STATUS:CANCELLED");
  });
});

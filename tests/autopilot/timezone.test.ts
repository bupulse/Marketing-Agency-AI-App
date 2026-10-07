import { describe, expect, it } from "vitest";
import { addDaysISO, localDateISO, localParts, nextWeekStart, weekDates, weekStartFor, weekdayOfISO, zonedToUtc } from "@/lib/autopilot/timezone";

describe("time zones", () => {
  it("converts local times to UTC", () => {
    expect(zonedToUtc("2026-10-12", "09:00", "Africa/Kigali").toISOString()).toBe("2026-10-12T07:00:00.000Z"); // UTC+2
    expect(zonedToUtc("2026-10-12", "18:30", "America/New_York").toISOString()).toBe("2026-10-12T22:30:00.000Z"); // EDT, UTC-4
    expect(zonedToUtc("2026-12-12", "18:30", "America/New_York").toISOString()).toBe("2026-12-12T23:30:00.000Z"); // EST, UTC-5
    expect(zonedToUtc("2026-10-12", "09:00", "Asia/Kolkata").toISOString()).toBe("2026-10-12T03:30:00.000Z");
  });

  it("handles daylight saving changes", () => {
    // Europe/Paris springs forward on 29 March 2026.
    expect(zonedToUtc("2026-03-28", "09:00", "Europe/Paris").toISOString()).toBe("2026-03-28T08:00:00.000Z");
    expect(zonedToUtc("2026-03-30", "09:00", "Europe/Paris").toISOString()).toBe("2026-03-30T07:00:00.000Z");
  });

  it("finds Monday 00:00 of a week in the business zone", () => {
    // Sunday 11 Oct 2026 23:30 in Kigali is still the week of Monday 5 Oct.
    const sundayNight = new Date("2026-10-11T21:30:00Z");
    expect(weekStartFor(sundayNight, "Africa/Kigali").toISOString()).toBe("2026-10-04T22:00:00.000Z");
    // The same instant is already Monday in Auckland.
    expect(localDateISO(weekStartFor(sundayNight, "Pacific/Auckland"), "Pacific/Auckland")).toBe("2026-10-12");
  });

  it("returns the next week's Monday", () => {
    const friday = new Date("2026-10-09T10:00:00Z");
    expect(localDateISO(nextWeekStart(friday, "Africa/Kigali"), "Africa/Kigali")).toBe("2026-10-12");
    expect(nextWeekStart(friday, "UTC").toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });

  it("lists the seven dates of a week", () => {
    const start = nextWeekStart(new Date("2026-10-09T10:00:00Z"), "Africa/Kigali");
    const dates = weekDates(start, "Africa/Kigali");
    expect(dates[0]).toBe("2026-10-12");
    expect(dates[6]).toBe("2026-10-18");
    expect(weekdayOfISO(dates[0])).toBe(0);
    expect(weekdayOfISO(dates[6])).toBe(6);
  });

  it("does calendar arithmetic and reads parts", () => {
    expect(addDaysISO("2026-12-30", 3)).toBe("2027-01-02");
    expect(localParts(new Date("2026-10-12T07:00:00Z"), "Africa/Kigali")).toMatchObject({ hour: 9, minute: 0, weekday: 0, day: 12 });
  });
});

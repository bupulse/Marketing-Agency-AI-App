import { describe, expect, it } from "vitest";
import {
  describeOpenStatus,
  openStatus,
  parseLegacyHours,
  scheduleErrors,
  SLIDER_STOPS,
  stopOf,
  summarizeHours,
  timeOfStop,
  type Schedule,
} from "@/lib/business-info/hours";

const weekdays: Schedule = { days: ["mon", "tue", "wed", "thu", "fri"], open: "08:00", close: "18:00" };
const saturday: Schedule = { days: ["sat"], open: "09:00", close: "14:00" };

describe("slider stops", () => {
  it("runs from 00:00 to 23:59 in 15 minute steps", () => {
    expect(timeOfStop(0)).toBe("00:00");
    expect(timeOfStop(32)).toBe("08:00");
    expect(timeOfStop(33)).toBe("08:15");
    expect(timeOfStop(SLIDER_STOPS)).toBe("23:59");
    expect(stopOf("18:00")).toBe(72);
    expect(stopOf("23:59")).toBe(SLIDER_STOPS);
    expect(timeOfStop(999)).toBe("23:59");
  });
});

describe("summarizeHours", () => {
  it("groups days and lists the closed ones", () => {
    expect(summarizeHours([saturday, weekdays])).toBe("Mon–Fri 08:00–18:00 · Sat 09:00–14:00 · Sun closed");
    expect(summarizeHours([{ days: ["mon", "wed", "fri"], open: "10:00", close: "16:00" }])).toBe("Mon, Wed, Fri 10:00–16:00 · Tue, Thu, Sat, Sun closed");
    expect(summarizeHours([{ days: ["fri", "sat"], open: "22:00", close: "02:00", overnight: true }])).toContain("Fri, Sat 22:00–02:00 (next day)");
    expect(summarizeHours([{ days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], open: "00:00", close: "23:59", allDay: true }])).toBe("Mon–Sun open 24 hours");
    expect(summarizeHours([])).toBe("");
  });
});

describe("scheduleErrors", () => {
  it("accepts valid hours", () => {
    expect(scheduleErrors([weekdays, saturday])).toEqual({});
  });
  it("needs a day, and the end after the start unless marked overnight", () => {
    expect(scheduleErrors([{ days: [], open: "08:00", close: "18:00" }])["0.days"]).toMatch(/at least one day/);
    expect(scheduleErrors([{ days: ["mon"], open: "18:00", close: "08:00" }])["0.close"]).toMatch(/after the opening time/);
    expect(scheduleErrors([{ days: ["mon"], open: "08:00", close: "08:00" }])["0.close"]).toBeTruthy();
    expect(scheduleErrors([{ days: ["fri"], open: "22:00", close: "02:00", overnight: true }])).toEqual({});
    expect(scheduleErrors([{ days: ["fri"], open: "08:00", close: "18:00", overnight: true }])["0.close"]).toMatch(/earlier than the opening/);
  });
  it("rejects a day in two sets of hours", () => {
    expect(scheduleErrors([weekdays, { days: ["fri", "sat"], open: "09:00", close: "12:00" }])["1.days"]).toMatch(/Friday is already in other hours/);
  });
  it("rejects late hours that run into the next day's opening", () => {
    const late: Schedule = { days: ["fri"], open: "20:00", close: "10:00", overnight: true };
    expect(scheduleErrors([late, saturday])["0.close"]).toMatch(/Saturday morning/);
    expect(scheduleErrors([{ ...late, close: "02:00" }, saturday])).toEqual({});
  });
  it("rejects malformed times", () => {
    expect(scheduleErrors([{ days: ["mon"], open: "8am", close: "18:00" }])["0.open"]).toBeTruthy();
  });
});

describe("openStatus in Africa/Kigali (UTC+2, no daylight saving)", () => {
  const kigali = "Africa/Kigali";
  const hours = [weekdays, saturday];
  it("is open during the day and says until when", () => {
    // Monday 12 Oct 2026, 10:00 UTC = 12:00 in Kigali
    const s = openStatus(hours, kigali, new Date("2026-10-12T10:00:00Z"));
    expect(s).toMatchObject({ known: true, open: true, change: { dayOffset: 0, time: "18:00" } });
    expect(describeOpenStatus(s)).toBe("We're open now until 18:00.");
  });
  it("is closed in the evening and opens tomorrow", () => {
    const s = openStatus(hours, kigali, new Date("2026-10-12T17:30:00Z")); // 19:30 Monday
    expect(describeOpenStatus(s)).toBe("We're closed now. We open tomorrow at 08:00.");
  });
  it("is closed early in the morning and opens later today", () => {
    expect(describeOpenStatus(openStatus(hours, kigali, new Date("2026-10-13T04:00:00Z")))).toBe("We're closed now. We open today at 08:00."); // 06:00 Tue
  });
  it("skips closed days: Saturday afternoon opens on Monday", () => {
    expect(describeOpenStatus(openStatus(hours, kigali, new Date("2026-10-17T13:00:00Z")))).toBe("We're closed now. We open on Monday at 08:00."); // Sat 15:00
  });
  it("uses the business zone, not UTC: 16:30 UTC Monday is 18:30 in Kigali", () => {
    expect(openStatus(hours, kigali, new Date("2026-10-12T16:30:00Z"))).toMatchObject({ open: false });
    expect(openStatus(hours, "UTC", new Date("2026-10-12T16:30:00Z"))).toMatchObject({ open: true });
  });
  it("handles hours past midnight, including Sunday into Monday", () => {
    const night: Schedule[] = [{ days: ["sun"], open: "20:00", close: "02:00", overnight: true }];
    const s = openStatus(night, kigali, new Date("2026-10-11T23:00:00Z")); // Mon 01:00 local
    expect(s).toMatchObject({ open: true, change: { time: "02:00", dayOffset: 0 } });
    expect(describeOpenStatus(openStatus(night, kigali, new Date("2026-10-11T19:00:00Z")))).toBe("We're open now until 02:00 tomorrow."); // Sun 21:00
  });
  it("knows 24-hour businesses and unknown hours", () => {
    const always: Schedule[] = [{ days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], open: "00:00", close: "23:59", allDay: true }];
    expect(describeOpenStatus(openStatus(always, kigali))).toBe("We're open 24 hours, every day.");
    expect(openStatus([], kigali)).toEqual({ known: false });
    expect(describeOpenStatus({ known: false })).toBe("");
  });
  it("falls back to UTC for an unknown zone", () => {
    expect(openStatus(hours, "Mars/Olympus", new Date("2026-10-12T17:30:00Z"))).toMatchObject({ open: true });
  });
});

describe("openStatus in a daylight-saving zone (Europe/London)", () => {
  const london = "Europe/London";
  const hours = [weekdays];
  it("follows the local clock in summer (UTC+1) and in winter (UTC+0)", () => {
    // 07:30 UTC on Wed 15 Jul 2026 is 08:30 BST: open. The same UTC time on Wed 14 Jan 2026 is 07:30 GMT: closed.
    expect(openStatus(hours, london, new Date("2026-07-15T07:30:00Z"))).toMatchObject({ open: true });
    expect(describeOpenStatus(openStatus(hours, london, new Date("2026-01-14T07:30:00Z")))).toBe("We're closed now. We open today at 08:00.");
  });
  it("is right on the day the clocks change (Sun 25 Oct 2026, 02:00 BST -> 01:00 GMT)", () => {
    const sunday: Schedule[] = [{ days: ["sun"], open: "10:00", close: "16:00" }];
    expect(openStatus(sunday, london, new Date("2026-10-25T09:30:00Z"))).toMatchObject({ open: false }); // 09:30 GMT
    expect(openStatus(sunday, london, new Date("2026-10-25T10:30:00Z"))).toMatchObject({ open: true, change: { time: "16:00" } });
  });
});

describe("parseLegacyHours", () => {
  it("reads common free-text formats", () => {
    expect(parseLegacyHours("Mon to Sat, 9am to 6pm")).toEqual([{ days: ["mon", "tue", "wed", "thu", "fri", "sat"], open: "09:00", close: "18:00" }]);
    expect(parseLegacyHours("Mon-Fri 08:00-18:00; Sat 9-14")).toEqual([weekdays, saturday]);
    expect(parseLegacyHours("Mon-Sat 9-6")).toEqual([{ days: ["mon", "tue", "wed", "thu", "fri", "sat"], open: "09:00", close: "18:00" }]);
    expect(parseLegacyHours("Fri-Sat 22:00-02:00")).toEqual([{ days: ["fri", "sat"], open: "22:00", close: "02:00", overnight: true }]);
    expect(parseLegacyHours("Mon-Fri 8-17, Sun closed")).toEqual([{ days: ["mon", "tue", "wed", "thu", "fri"], open: "08:00", close: "17:00" }]);
  });
  it("gives up on anything unclear so the text stays a note", () => {
    expect(parseLegacyHours("Weekdays, call ahead on holidays")).toBeNull();
    expect(parseLegacyHours("")).toBeNull();
    expect(parseLegacyHours("Mon-Fri 8-18, Fri 9-12")).toBeNull(); // Friday twice
  });
});

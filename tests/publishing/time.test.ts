import { describe, expect, it } from "vitest";
import { cleanSlotTimes, nextFreeSlots } from "@/lib/publishing/slots";
import { addDays, dayKey, moveToDay, parseLocalInput, startOfWeek, toLocalInput, weekdayIndex, zonedTimeToUtc } from "@/lib/publishing/time";

describe("time zone conversion", () => {
  it("converts local wall-clock time to UTC", () => {
    expect(zonedTimeToUtc(2026, 10, 8, 9, 0, "Africa/Kigali").toISOString()).toBe("2026-10-08T07:00:00.000Z");
    expect(zonedTimeToUtc(2026, 10, 8, 9, 0, "UTC").toISOString()).toBe("2026-10-08T09:00:00.000Z");
    expect(zonedTimeToUtc(2026, 10, 8, 9, 0, "Asia/Kolkata").toISOString()).toBe("2026-10-08T03:30:00.000Z");
  });

  it("handles daylight saving on both sides of the change", () => {
    // New York leaves daylight saving on 2026-11-01.
    expect(zonedTimeToUtc(2026, 10, 31, 9, 0, "America/New_York").toISOString()).toBe("2026-10-31T13:00:00.000Z");
    expect(zonedTimeToUtc(2026, 11, 2, 9, 0, "America/New_York").toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });

  it("reads datetime-local values in the business zone and back", () => {
    const date = parseLocalInput("2026-10-08T09:30", "Africa/Kigali");
    expect(date?.toISOString()).toBe("2026-10-08T07:30:00.000Z");
    expect(toLocalInput(date as Date, "Africa/Kigali")).toBe("2026-10-08T09:30");
    expect(parseLocalInput("2026-02-31T09:30", "UTC")).toBeNull();
    expect(parseLocalInput("not a date", "UTC")).toBeNull();
  });

  it("finds the calendar day in the zone, not in UTC", () => {
    const lateUtc = new Date("2026-10-08T23:30:00Z");
    expect(dayKey(lateUtc, "UTC")).toBe("2026-10-08");
    expect(dayKey(lateUtc, "Africa/Kigali")).toBe("2026-10-09");
    expect(dayKey(lateUtc, "America/Los_Angeles")).toBe("2026-10-08");
  });

  it("does day arithmetic and weeks start on Monday", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(weekdayIndex("2026-10-05")).toBe(0);
    expect(startOfWeek("2026-10-11")).toBe("2026-10-05");
    expect(startOfWeek("2026-10-05")).toBe("2026-10-05");
  });

  it("moves a post to another day keeping its local time", () => {
    const at = new Date("2026-10-08T07:00:00Z"); // 09:00 in Kigali
    expect(moveToDay(at, "2026-10-10", "Africa/Kigali").toISOString()).toBe("2026-10-10T07:00:00.000Z");
    // Across the New York change the UTC time shifts but 09:00 local stays.
    const ny = zonedTimeToUtc(2026, 10, 30, 9, 0, "America/New_York");
    expect(moveToDay(ny, "2026-11-03", "America/New_York").toISOString()).toBe("2026-11-03T14:00:00.000Z");
  });
});

describe("Add to queue slots", () => {
  const zone = "Africa/Kigali";

  it("picks the next posting time of the business, in its own zone", () => {
    // 10:00 in Kigali: the 09:00 slot has passed, so 18:00 (16:00 UTC) is next.
    const now = new Date("2026-10-07T08:00:00Z");
    const [slot] = nextFreeSlots({ times: ["09:00", "18:00"], zone, now, taken: [] });
    expect(slot.toISOString()).toBe("2026-10-07T16:00:00.000Z");
  });

  it("rolls over to the next day after the last slot", () => {
    const now = new Date("2026-10-07T17:00:00Z"); // 19:00 in Kigali
    const [slot] = nextFreeSlots({ times: ["09:00", "18:00"], zone, now, taken: [] });
    expect(slot.toISOString()).toBe("2026-10-08T07:00:00.000Z");
  });

  it("uses the zone's day, not UTC's, when UTC is already tomorrow", () => {
    // 23:30 UTC on the 7th is 01:30 on the 8th in Kigali: 09:00 on the 8th (07:00 UTC) is next.
    const [slot] = nextFreeSlots({ times: ["09:00"], zone, now: new Date("2026-10-07T23:30:00Z"), taken: [] });
    expect(slot.toISOString()).toBe("2026-10-08T07:00:00.000Z");
  });

  it("skips taken slots and returns several in order", () => {
    const now = new Date("2026-10-07T05:00:00Z");
    const taken = [new Date("2026-10-07T07:00:00Z")]; // 09:00 Kigali is taken
    const slots = nextFreeSlots({ times: ["09:00", "18:00"], zone, now, taken, count: 3 });
    expect(slots.map((s) => s.toISOString())).toEqual(["2026-10-07T16:00:00.000Z", "2026-10-08T07:00:00.000Z", "2026-10-08T16:00:00.000Z"]);
  });

  it("does not use a slot that is about to pass", () => {
    const now = new Date("2026-10-07T06:58:00Z"); // 2 minutes before 09:00 Kigali
    const [slot] = nextFreeSlots({ times: ["09:00", "18:00"], zone, now, taken: [], leadMinutes: 5 });
    expect(slot.toISOString()).toBe("2026-10-07T16:00:00.000Z");
  });

  it("keeps local times across daylight saving", () => {
    const now = new Date("2026-10-31T20:00:00Z");
    const slots = nextFreeSlots({ times: ["09:00"], zone: "America/New_York", now, taken: [], count: 2 });
    expect(slots.map((s) => s.toISOString())).toEqual(["2026-11-01T14:00:00.000Z", "2026-11-02T14:00:00.000Z"]);
  });

  it("falls back to default times when the saved ones are unusable", () => {
    expect(cleanSlotTimes([])).toEqual(["09:00", "18:00"]);
    expect(cleanSlotTimes(["25:00", "nine"])).toEqual(["09:00", "18:00"]);
    expect(cleanSlotTimes(["18:00", "09:00", "09:00"])).toEqual(["09:00", "18:00"]);
  });
});

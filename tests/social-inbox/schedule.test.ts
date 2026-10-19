import { describe, expect, it } from "vitest";
import { isNight, localMinutes, minutesUntilMorning, nextCheckAt, pacedMinutes } from "@/lib/social/inbox/schedule";

// Kigali is UTC+2 all year.
const kigali = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 20, h - 2, m));
const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);

describe("night pause", () => {
  it("reads the local time of the business's zone", () => {
    expect(localMinutes(kigali(9, 30), "Africa/Kigali")).toBe(9 * 60 + 30);
    expect(localMinutes(kigali(9, 30), "Not/AZone")).toBe(7 * 60 + 30); // unknown zone counts as UTC
  });

  it("is night from 22:00 to 07:00", () => {
    expect(isNight(kigali(21, 59), "Africa/Kigali")).toBe(false);
    expect(isNight(kigali(22, 0), "Africa/Kigali")).toBe(true);
    expect(isNight(kigali(3), "Africa/Kigali")).toBe(true);
    expect(isNight(kigali(7), "Africa/Kigali")).toBe(false);
    expect(minutesUntilMorning(kigali(23), "Africa/Kigali")).toBe(8 * 60);
    expect(minutesUntilMorning(kigali(12), "Africa/Kigali")).toBe(0);
  });

  it("moves a check that would fall in the night to 07:00", () => {
    const now = kigali(21, 50);
    const next = nextCheckAt({ now, timeZone: "Africa/Kigali", lastActivityAt: null, paced: 0 });
    expect(localMinutes(next, "Africa/Kigali")).toBe(7 * 60);
    expect(minutesBetween(now, next)).toBe(30 + 8 * 60 + 40);
  });
});

describe("check pace", () => {
  const now = kigali(10);
  it("checks every 5 minutes after activity, 10 when warm, 30 when quiet", () => {
    expect(minutesBetween(now, nextCheckAt({ now, timeZone: "Africa/Kigali", lastActivityAt: new Date(now.getTime() - 10 * 60_000), paced: 0 }))).toBe(5);
    expect(minutesBetween(now, nextCheckAt({ now, timeZone: "Africa/Kigali", lastActivityAt: new Date(now.getTime() - 60 * 60_000), paced: 0 }))).toBe(10);
    expect(minutesBetween(now, nextCheckAt({ now, timeZone: "Africa/Kigali", lastActivityAt: null, paced: 0 }))).toBe(30);
  });

  it("slows down when the month's calls must be spread over many accounts", () => {
    expect(pacedMinutes({ now, callsLeft: 100_000, accounts: 1 })).toBeLessThan(20);
    const paced = pacedMinutes({ now, callsLeft: 2_000, accounts: 10 });
    expect(paced).toBeGreaterThan(30);
    expect(minutesBetween(now, nextCheckAt({ now, timeZone: "Africa/Kigali", lastActivityAt: null, paced }))).toBe(Math.min(240, paced));
    expect(pacedMinutes({ now, callsLeft: 0, accounts: 3 })).toBe(240);
  });

  it("backs off after repeated errors", () => {
    const next = nextCheckAt({ now, timeZone: "Africa/Kigali", lastActivityAt: null, paced: 0, errors: 4 });
    expect(minutesBetween(now, next)).toBe(240);
  });
});

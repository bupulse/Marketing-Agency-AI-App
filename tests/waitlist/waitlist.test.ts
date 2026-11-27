import { describe, expect, it } from "vitest";
import { countdown, DEFAULT_LAUNCH_DATE, formatCountdown, isLaunchDate, launchInstant, waitlistInfo } from "@/lib/waitlist";

describe("waiting list dates", () => {
  it("launches at 00:00 Kigali time (22:00 UTC the day before)", () => {
    expect(launchInstant("2026-12-15").toISOString()).toBe("2026-12-14T22:00:00.000Z");
  });

  it("is null while off, and names the day while on", () => {
    expect(waitlistInfo(false, "2026-12-15")).toBeNull();
    expect(waitlistInfo(true, "2026-12-15")).toEqual({ launchAt: "2026-12-14T22:00:00.000Z", dateLabel: "15 December", shortLabel: "15 Dec" });
  });

  it("falls back to the default day for a bad stored date", () => {
    expect(waitlistInfo(true, "2026-02-30")?.launchAt).toBe(launchInstant(DEFAULT_LAUNCH_DATE).toISOString());
  });

  it("accepts only real calendar days", () => {
    expect(isLaunchDate("2026-12-15")).toBe(true);
    expect(isLaunchDate("2026-13-01")).toBe(false);
    expect(isLaunchDate("2026-02-29")).toBe(false);
    expect(isLaunchDate("15/12/2026")).toBe(false);
    expect(isLaunchDate(20261215)).toBe(false);
  });
});

describe("countdown", () => {
  const launch = "2026-12-14T22:00:00.000Z";

  it("counts days, hours, minutes and seconds", () => {
    const now = new Date(launch).getTime() - ((18 * 24 + 6) * 3600 + 12 * 60 + 40) * 1000;
    const c = countdown(launch, now);
    expect(c).toEqual({ days: 18, hours: 6, minutes: 12, seconds: 40, done: false });
    expect(formatCountdown(c)).toBe("18d 06h 12m");
    expect(formatCountdown(c, true)).toBe("18d 06h 12m 40s");
  });

  it("shows seconds and no days on the last day", () => {
    const now = new Date(launch).getTime() - (5 * 60 + 9) * 1000;
    expect(formatCountdown(countdown(launch, now))).toBe("00h 05m 09s");
  });

  it("stops at zero and says it is done", () => {
    const c = countdown(launch, new Date(launch).getTime() + 60_000);
    expect(c).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0, done: true });
  });
});

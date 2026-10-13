import { describe, expect, it } from "vitest";
import { bestTime, orderTimes } from "@/lib/publishing/best-time";

const zone = "Africa/Kigali"; // UTC+2
// Tuesday 13 October 2026, 10:00 in Kigali.
const now = new Date("2026-10-13T08:00:00Z");
const base = { zone, now, postingTimes: ["09:00", "18:00"], taken: [] as Date[] };

describe("orderTimes", () => {
  it("tries the posting time nearest a preferred hour first", () => {
    expect(orderTimes(["09:00", "18:00"], [12, 19])).toEqual(["18:00", "09:00"]);
    expect(orderTimes(["09:00", "18:00"], [8, 12])).toEqual(["09:00", "18:00"]);
    expect(orderTimes(["bad"], [])).toEqual(["09:00", "18:00"]);
  });
});

describe("bestTime", () => {
  it("picks today's best posting time when today is a good day and it is still ahead", () => {
    // Instagram defaults: hours 12 and 19, Monday, Wednesday, Friday, Saturday. Tuesday is not one, so Wednesday.
    expect(bestTime({ ...base, hours: [12, 19], weekdays: [0, 2, 4, 5] })?.toISOString()).toBe("2026-10-14T16:00:00.000Z");
    // A network that likes Tuesdays gets today at 18:00.
    expect(bestTime({ ...base, hours: [13, 18], weekdays: [1, 2] })?.toISOString()).toBe("2026-10-13T16:00:00.000Z");
  });

  it("never picks a time in the past or too soon", () => {
    const late = new Date("2026-10-13T15:50:00Z"); // 17:50 local: 18:00 is within the 15-minute lead
    expect(bestTime({ ...base, now: late, hours: [18], weekdays: [1, 2] })?.toISOString()).toBe("2026-10-14T16:00:00.000Z");
  });

  it("keeps 2.5 hours from other posts on the account", () => {
    const taken = [new Date("2026-10-13T16:30:00Z")];
    expect(bestTime({ ...base, taken, hours: [18], weekdays: [1, 2] })?.toISOString()).toBe("2026-10-14T16:00:00.000Z");
  });

  it("falls back to any day when the preferred ones are all taken", () => {
    const taken = [new Date("2026-10-19T07:00:00Z"), new Date("2026-10-19T16:00:00Z")];
    const at = bestTime({ ...base, taken, hours: [9], weekdays: [0] });
    expect(at?.toISOString()).toBe("2026-10-13T16:00:00.000Z");
  });

  it("uses the business's own posting times only", () => {
    const at = bestTime({ ...base, postingTimes: ["07:30"], hours: [19], weekdays: [] });
    expect(at?.toISOString()).toBe("2026-10-14T05:30:00.000Z");
  });
});

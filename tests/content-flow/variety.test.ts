import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/publishing/time";
import { dayVariety } from "@/lib/content-flow/variety";

describe("day-to-day variety", () => {
  it("never opens or flows the same way two days in a row, for any subject", () => {
    for (const key of ["product:p1", "campaign:c9", "general"]) {
      let day = "2026-10-01";
      for (let i = 0; i < 60; i++) {
        const next = addDays(day, 1);
        expect(dayVariety(key, next).hook).not.toBe(dayVariety(key, day).hook);
        expect(dayVariety(key, next).structure).not.toBe(dayVariety(key, day).structure);
        day = next;
      }
    }
  });

  it("gives the posts of one day different openings, and is stable for the same day", () => {
    expect(dayVariety("product:p1", "2026-10-13", 0).hook).not.toBe(dayVariety("product:p1", "2026-10-13", 1).hook);
    expect(dayVariety("product:p1", "2026-10-13", 2)).toEqual(dayVariety("product:p1", "2026-10-13", 2));
  });
});

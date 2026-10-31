import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS } from "@/lib/content-board/filters";
import { dayBounds, dayDate, dayLabel, daySection, dayWhere, groupDay, parseDay, todayIn } from "@/lib/content-flow/day";

const KIGALI = "Africa/Kigali";

describe("days in the business's time zone", () => {
  it("today in Kigali starts at 22:00 UTC the day before", () => {
    const now = new Date("2026-10-12T22:30:00Z"); // 00:30 on 13 October in Kigali
    expect(todayIn(KIGALI, now)).toBe("2026-10-13");
    expect(dayBounds("2026-10-13", KIGALI)).toEqual({ gte: new Date("2026-10-12T22:00:00Z"), lt: new Date("2026-10-13T22:00:00Z") });
    expect(todayIn("UTC", now)).toBe("2026-10-12");
  });

  it("reads ?day= only when it is a real date within the range, else today", () => {
    const now = new Date("2026-10-13T08:00:00Z");
    expect(parseDay("2026-10-01", KIGALI, now)).toBe("2026-10-01");
    expect(parseDay("2026-10-20", KIGALI, now)).toBe("2026-10-20");
    for (const bad of [undefined, "", "2026-02-30", "13-10-2026", "2020-01-01", "2030-01-01", ["x"]]) expect(parseDay(bad, KIGALI, now)).toBe("2026-10-13");
  });

  it("stores the day as a DATE at midnight UTC and reads it back", () => {
    expect(dayDate("2026-10-13").toISOString()).toBe("2026-10-13T00:00:00.000Z");
  });

  it("queries the posts made that day, going out that day, or moved to it by a missed day, scoped to the business and the subject", () => {
    const where = dayWhere("b1", { kind: "product", id: "p1" }, "2026-10-13", KIGALI, { ...EMPTY_FILTERS, apps: ["instagram"], range: "30d" }, new Date("2026-10-13T08:00:00Z"));
    const window = { gte: new Date("2026-10-12T22:00:00Z"), lt: new Date("2026-10-13T22:00:00Z") };
    expect(where).toMatchObject({ businessId: "b1", productId: "p1", network: { in: ["instagram"] } });
    // The board's date range does not apply on a day.
    expect(where.createdAt).toBeUndefined();
    const planned = { gte: new Date("2026-10-13T00:00:00Z"), lt: new Date("2026-10-14T00:00:00Z") };
    expect(where.AND).toEqual([{ OR: [{ createdAt: window }, { publishedAt: window }, { publishedAt: null, scheduledAt: window }, { publishedAt: null, scheduledAt: null, plannedDay: planned }] }]);
    const general = dayWhere("b1", { kind: "general" }, "2026-10-13", KIGALI, EMPTY_FILTERS, new Date());
    expect(general).toMatchObject({ productId: null, campaignId: null });
  });

  it("puts each post in its section: waiting for OK, going out that day, or made that day for another day", () => {
    const at = (iso: string) => iso;
    expect(daySection({ status: "PENDING_APPROVAL", scheduledAt: null, publishedAt: null }, "2026-10-13", KIGALI)).toBe("review");
    expect(daySection({ status: "SCHEDULED", scheduledAt: at("2026-10-13T16:00:00Z"), publishedAt: null }, "2026-10-13", KIGALI)).toBe("goes");
    // 23:30 UTC on the 13th is already the 14th in Kigali.
    expect(daySection({ status: "SCHEDULED", scheduledAt: at("2026-10-13T23:30:00Z"), publishedAt: null }, "2026-10-13", KIGALI)).toBe("made");
    expect(daySection({ status: "PUBLISHED", scheduledAt: at("2026-10-12T09:00:00Z"), publishedAt: at("2026-10-13T07:00:00Z") }, "2026-10-13", KIGALI)).toBe("goes");
    const g = groupDay(
      [
        { id: "a", status: "SCHEDULED", scheduledAt: "2026-10-13T15:00:00Z", publishedAt: null },
        { id: "b", status: "SCHEDULED", scheduledAt: "2026-10-13T07:00:00Z", publishedAt: null },
        { id: "c", status: "DRAFT", scheduledAt: null, publishedAt: null },
      ],
      "2026-10-13",
      KIGALI,
    );
    expect(g.goes.map((p) => p.id)).toEqual(["b", "a"]);
    expect(g.review.map((p) => p.id)).toEqual(["c"]);
  });

  it("a post a missed day moved waits on its new day; on the day it was made it shows as made; expired posts have their own section", () => {
    const moved = { status: "PENDING_APPROVAL", scheduledAt: null, publishedAt: null, plannedDay: "2026-10-14" };
    expect(daySection(moved, "2026-10-14", KIGALI)).toBe("review");
    expect(daySection(moved, "2026-10-13", KIGALI)).toBe("made");
    expect(daySection({ status: "EXPIRED", scheduledAt: "2026-10-13T08:00:00Z", publishedAt: null, plannedDay: "2026-10-13" }, "2026-10-13", KIGALI)).toBe("expired");
    const g = groupDay([{ id: "x", status: "EXPIRED", scheduledAt: null, publishedAt: null }, { id: "m", ...moved }], "2026-10-14", KIGALI);
    expect(g.expired.map((p) => p.id)).toEqual(["x"]);
    expect(g.review.map((p) => p.id)).toEqual(["m"]);
  });

  it("labels today, yesterday and tomorrow", () => {
    expect(dayLabel("2026-10-13", "2026-10-13")).toBe("Today, Tuesday 13 October");
    expect(dayLabel("2026-10-12", "2026-10-13")).toMatch(/^Yesterday/);
    expect(dayLabel("2026-10-14", "2026-10-13")).toMatch(/^Tomorrow/);
    expect(dayLabel("2025-12-31", "2026-10-13")).toContain("2025");
  });
});

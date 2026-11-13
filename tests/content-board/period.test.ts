import { describe, expect, it } from "vitest";
import { buildSubjectCards } from "@/lib/content-board/grouping";
import { contentQuery, contentWhere, EMPTY_FILTERS, parseContentFilters } from "@/lib/content-board/filters";
import { dayHeading, emptyPeriodAction, groupByDay, periodBounds, periodContains, periodDays, periodLabel, periodOf, periodPostWhere, plannedDayOf, shiftPeriod } from "@/lib/content-board/period";

// The Day / Week / Month switch (lib/content-board/period.ts): business-local days, weeks from Monday.
const KIGALI = "Africa/Kigali"; // UTC+2, no daylight saving
const LONDON = "Europe/London"; // daylight saving ends on Sunday 25 October 2026
const today = "2026-10-31"; // a Saturday

describe("periods", () => {
  it("a day is that day; a week runs Monday to Sunday; a month is the calendar month", () => {
    expect(periodOf("day", today)).toEqual({ view: "day", anchor: today, start: today, end: today });
    expect(periodOf("week", today)).toMatchObject({ start: "2026-10-26", end: "2026-11-01" });
    // A Sunday belongs to the week that started the Monday before; a Monday starts its own week.
    expect(periodOf("week", "2026-11-01")).toMatchObject({ start: "2026-10-26", end: "2026-11-01" });
    expect(periodOf("week", "2026-11-02")).toMatchObject({ start: "2026-11-02", end: "2026-11-08" });
    expect(periodOf("month", today)).toMatchObject({ start: "2026-10-01", end: "2026-10-31" });
  });

  it("gets month edges right: 28, 29, 30 and 31 days, and a week across the new year", () => {
    expect(periodOf("month", "2027-02-14")).toMatchObject({ start: "2027-02-01", end: "2027-02-28" });
    expect(periodOf("month", "2028-02-14")).toMatchObject({ start: "2028-02-01", end: "2028-02-29" });
    expect(periodOf("month", "2026-11-30")).toMatchObject({ start: "2026-11-01", end: "2026-11-30" });
    expect(periodOf("month", "2026-12-01")).toMatchObject({ start: "2026-12-01", end: "2026-12-31" });
    expect(periodOf("week", "2027-01-01")).toMatchObject({ start: "2026-12-28", end: "2027-01-03" });
    expect(periodDays(periodOf("month", "2028-02-01"))).toHaveLength(29);
    expect(periodDays(periodOf("week", today))).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  });

  it("the arrows move a day, a week or a month (a month moves to its 1st, so 31 January never skips February)", () => {
    expect(shiftPeriod("day", today, -1)).toBe("2026-10-30");
    expect(shiftPeriod("day", today, 1)).toBe("2026-11-01");
    expect(shiftPeriod("week", today, 1)).toBe("2026-11-07");
    expect(periodOf("week", shiftPeriod("week", today, -1))).toMatchObject({ start: "2026-10-19", end: "2026-10-25" });
    expect(shiftPeriod("month", "2027-01-31", 1)).toBe("2027-02-01");
    expect(shiftPeriod("month", "2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftPeriod("month", "2026-01-10", -1)).toBe("2025-12-01");
  });

  it("labels: 'Sat 31 Oct', '26 Oct – 1 Nov', '2 – 8 Nov', 'October 2026', with the year when it is not this year", () => {
    expect(periodLabel(periodOf("day", today), today)).toBe("Sat 31 Oct");
    expect(periodLabel(periodOf("week", today), today)).toBe("26 Oct – 1 Nov");
    expect(periodLabel(periodOf("week", "2026-11-04"), today)).toBe("2 – 8 Nov");
    expect(periodLabel(periodOf("month", today), today)).toBe("October 2026");
    expect(periodLabel(periodOf("day", "2027-01-02"), today)).toBe("Sat 2 Jan 2027");
    expect(periodLabel(periodOf("week", "2027-01-01"), today)).toBe("28 Dec 2026 – 3 Jan 2027");
    expect(dayHeading("2026-10-31", today)).toBe("Saturday 31 October");
  });

  it("bounds are local midnights in the business's zone, daylight saving included", () => {
    expect(periodBounds(periodOf("day", today), KIGALI)).toEqual({ gte: new Date("2026-10-30T22:00:00Z"), lt: new Date("2026-10-31T22:00:00Z") });
    expect(periodBounds(periodOf("month", today), KIGALI)).toEqual({ gte: new Date("2026-09-30T22:00:00Z"), lt: new Date("2026-10-31T22:00:00Z") });
    // London's week of 19 to 25 October starts in summer time (UTC+1) and ends after the clocks went back (UTC+0).
    expect(periodBounds(periodOf("week", "2026-10-21"), LONDON)).toEqual({ gte: new Date("2026-10-18T23:00:00Z"), lt: new Date("2026-10-26T00:00:00Z") });
    expect(periodContains(periodOf("week", today), "2026-11-01")).toBe(true);
    expect(periodContains(periodOf("week", today), "2026-11-02")).toBe(false);
  });

  it("a period's posts: made, posted or scheduled in it, or moved to one of its days by a missed day", () => {
    const where = periodPostWhere(periodOf("week", today), KIGALI);
    const window = { gte: new Date("2026-10-25T22:00:00Z"), lt: new Date("2026-11-01T22:00:00Z") };
    expect(where).toEqual({
      OR: [
        { createdAt: window },
        { publishedAt: window },
        { publishedAt: null, scheduledAt: window },
        { publishedAt: null, scheduledAt: null, plannedDay: { gte: new Date("2026-10-26T00:00:00Z"), lt: new Date("2026-11-02T00:00:00Z") } },
      ],
    });
  });
});

describe("the period in the URL", () => {
  it("reads ?view=week&day=…, ignores anything else, and writes it back", () => {
    const f = parseContentFilters({ view: "week", day: "2026-10-28", app: "instagram" });
    expect(f).toMatchObject({ view: "week", day: "2026-10-28", apps: ["instagram"] });
    expect(contentQuery(f)).toBe("?app=instagram&view=week&day=2026-10-28");
    expect(parseContentFilters({ view: "year", day: "2026-02-30" })).not.toHaveProperty("view");
    expect(parseContentFilters({ view: "year", day: "2026-02-30" })).not.toHaveProperty("day");
  });

  it("a custom date range wins over the period (picking one clears the other)", () => {
    const f = parseContentFilters({ view: "month", range: "custom", from: "2026-10-01", to: "2026-10-15" });
    expect(f.view).toBeUndefined();
    expect(contentQuery({ ...EMPTY_FILTERS, view: "month", range: "custom", from: "2026-10-01" })).toBe("?range=custom&from=2026-10-01");
  });

  it("the board counts follow the period, in the business's zone", () => {
    const now = new Date("2026-10-31T08:00:00Z");
    const where = contentWhere("b1", parseContentFilters({ view: "day" }), { zone: KIGALI, now });
    expect(where.AND).toEqual([periodPostWhere(periodOf("day", today), KIGALI)]);
    const next = contentWhere("b1", parseContentFilters({ view: "month", day: "2026-11-05" }), { zone: KIGALI, now });
    expect(next.AND).toEqual([periodPostWhere(periodOf("month", "2026-11-05"), KIGALI)]);
    // With a period on, only subjects with posts in it show (like any other filter).
    const general = buildSubjectCards({ products: [], campaigns: [], counts: [], filters: { ...EMPTY_FILTERS, view: "week" } });
    expect(general).toEqual([]);
  });
});

describe("a week or a month listed by day", () => {
  const post = (id: string, extra: Partial<{ status: string; scheduledAt: string | null; publishedAt: string | null; createdAt: string; plannedDay: string | null }> = {}) => ({
    id,
    status: "PENDING_APPROVAL",
    scheduledAt: null,
    publishedAt: null,
    createdAt: "2026-10-27T06:00:00Z",
    plannedDay: null,
    ...extra,
  });

  it("puts each post under the day it belongs to: posted, else scheduled, else moved to, else made", () => {
    expect(plannedDayOf(post("a", { publishedAt: "2026-10-28T23:30:00Z", scheduledAt: "2026-10-28T10:00:00Z" }), KIGALI)).toBe("2026-10-29");
    expect(plannedDayOf(post("b", { scheduledAt: "2026-10-30T08:00:00Z" }), KIGALI)).toBe("2026-10-30");
    expect(plannedDayOf(post("c", { plannedDay: "2026-10-31" }), KIGALI)).toBe("2026-10-31");
    expect(plannedDayOf(post("d"), KIGALI)).toBe("2026-10-27");
  });

  it("orders days and the posts in them by time, and keeps a post planned outside the period on the day it was made", () => {
    const week = periodOf("week", today);
    const groups = groupByDay(
      [
        post("late", { scheduledAt: "2026-10-30T15:00:00Z" }),
        post("early", { scheduledAt: "2026-10-30T07:00:00Z" }),
        post("moved", { plannedDay: "2026-10-31" }),
        post("next-week", { scheduledAt: "2026-11-04T08:00:00Z", createdAt: "2026-10-29T05:00:00Z" }),
      ],
      week,
      KIGALI,
    );
    expect(groups.map((g) => [g.day, g.posts.map((p) => p.id)])).toEqual([
      ["2026-10-29", ["next-week"]],
      ["2026-10-30", ["early", "late"]],
      ["2026-10-31", ["moved"]],
    ]);
  });
});

describe("empty week or month button", () => {
  it("goes back to the current period, or to today when this is the current one", () => {
    expect(emptyPeriodAction(periodOf("month", "2026-11-14"), "2026-11-14", "month")).toEqual({ label: "See today", today: true });
    expect(emptyPeriodAction(periodOf("month", "2026-10-03"), "2026-11-14", "month")).toEqual({ label: "Back to this month", today: false });
    expect(emptyPeriodAction(periodOf("week", "2026-11-30"), "2026-11-14", "week")).toEqual({ label: "Back to this week", today: false });
  });
});

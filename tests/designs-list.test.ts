import { describe, expect, it } from "vitest";
import { dayKey, designsDateBounds, designsHref, groupByDay, pageList, parseDesignsQuery } from "@/lib/designs/list";

const KGL = "Africa/Kigali"; // UTC+2, no daylight saving
const NOW = new Date("2026-10-13T20:30:00Z"); // 22:30 in Kigali on 13 Oct

describe("parseDesignsQuery", () => {
  it("defaults to page 1, all dates", () => {
    expect(parseDesignsQuery({})).toEqual({ page: 1, range: "all", from: null, to: null });
  });
  it("ignores bad pages and ranges", () => {
    expect(parseDesignsQuery({ page: "-3", range: "forever" })).toEqual({ page: 1, range: "all", from: null, to: null });
    expect(parseDesignsQuery({ page: "abc" }).page).toBe(1);
    expect(parseDesignsQuery({ page: "99999999" }).page).toBe(1);
  });
  it("keeps valid custom days, swaps a reversed range, drops impossible dates", () => {
    expect(parseDesignsQuery({ range: "custom", from: "2026-10-12", to: "2026-10-01" })).toMatchObject({ range: "custom", from: "2026-10-01", to: "2026-10-12" });
    expect(parseDesignsQuery({ range: "custom", from: "2026-02-30" })).toMatchObject({ range: "all", from: null, to: null });
    expect(parseDesignsQuery({ range: "custom", to: "2026-10-05" })).toMatchObject({ range: "custom", from: null, to: "2026-10-05" });
  });
});

describe("designsDateBounds (Kigali)", () => {
  it("last 7 days start at local midnight six days ago", () => {
    const b = designsDateBounds({ page: 1, range: "7d", from: null, to: null }, NOW, KGL);
    expect(b.gte?.toISOString()).toBe("2026-10-06T22:00:00.000Z"); // 7 Oct 00:00 Kigali
    expect(b.lt).toBeNull();
  });
  it("this month starts on the 1st local", () => {
    expect(designsDateBounds({ page: 1, range: "month", from: null, to: null }, NOW, KGL).gte?.toISOString()).toBe("2026-09-30T22:00:00.000Z");
  });
  it("a custom range includes the whole last day", () => {
    const b = designsDateBounds({ page: 1, range: "custom", from: "2026-10-01", to: "2026-10-12" }, NOW, KGL);
    expect(b.gte?.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(b.lt?.toISOString()).toBe("2026-10-12T22:00:00.000Z");
  });
  it("all dates has no bounds", () => {
    expect(designsDateBounds({ page: 1, range: "all", from: null, to: null }, NOW, KGL)).toEqual({ gte: null, lt: null });
  });
});

describe("groupByDay", () => {
  it("groups by the local day with Today and Yesterday labels, keeping order", () => {
    const items = [
      { id: "a", createdAt: "2026-10-13T21:00:00Z" }, // 23:00 13 Oct Kigali → but that's after NOW; still 13 Oct
      { id: "b", createdAt: "2026-10-13T08:00:00Z" },
      { id: "c", createdAt: "2026-10-12T21:59:00Z" }, // 23:59 12 Oct Kigali
      { id: "d", createdAt: "2026-10-01T10:00:00Z" },
    ];
    const g = groupByDay(items, NOW, KGL);
    expect(g.map((x) => [x.label, x.items.map((i) => i.id)])).toEqual([
      ["Today", ["a", "b"]],
      ["Yesterday", ["c"]],
      [expect.stringContaining("1 October"), ["d"]],
    ]);
  });
  it("uses the time zone for the day key", () => {
    expect(dayKey(new Date("2026-10-12T22:30:00Z"), KGL)).toBe("2026-10-13");
    expect(dayKey(new Date("2026-10-12T22:30:00Z"), "UTC")).toBe("2026-10-12");
  });
});

describe("pageList and designsHref", () => {
  it("shows first, last and neighbours with gaps", () => {
    expect(pageList(1, 1)).toEqual([1]);
    expect(pageList(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageList(2, 3)).toEqual([1, 2, 3]);
  });
  it("builds links that keep the filter and other params", () => {
    const q = { page: 1, range: "custom" as const, from: "2026-10-01", to: "2026-10-12" };
    expect(designsHref("/dashboard/designs", q, { page: 2 }, { for: "p1" })).toBe("/dashboard/designs?for=p1&range=custom&from=2026-10-01&to=2026-10-12&page=2");
    expect(designsHref("/dashboard/designs", { page: 3, range: "all", from: null, to: null }, { page: 1 })).toBe("/dashboard/designs");
  });
});

import { describe, expect, it } from "vitest";
import { pointLabel } from "@/components/support-app/analytics/visitors-chart";
import { sourceSlices } from "@/components/support-app/analytics/source-slices";
import {
  areaPath, changePct, compactNumber, donutArcs, flagEmoji, layoutPoints, linePath, nearestIndex, niceTicks, pointsChange, sharesOf,
} from "@/components/support-app/charts/chart-math";
import { formatValue } from "@/components/support-app/charts/stat-tile";

// The support app's chart maths (components/support-app/charts/chart-math.ts) and the small display helpers around it.

describe("niceTicks", () => {
  it("steps in 1, 2, 2.5 or 5 × a power of ten, wasting the least room above the highest value", () => {
    expect(niceTicks(82)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(2025)).toEqual([0, 500, 1000, 1500, 2000, 2500]);
    expect(niceTicks(43)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(niceTicks(100)).toEqual([0, 25, 50, 75, 100]);
  });
  it("keeps whole steps for small counts and copes with nothing", () => {
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(1)).toEqual([0, 1]);
    expect(niceTicks(2)).toEqual([0, 1, 2]);
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(Number.NaN)).toEqual([0, 1]);
    for (const v of [7, 13, 99, 451, 12_345]) {
      const t = niceTicks(v);
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(v);
      expect(t.every(Number.isInteger)).toBe(true);
    }
  });
});

describe("points and paths", () => {
  it("spreads points across the box with 0 on the baseline and the top value at the top", () => {
    const pts = layoutPoints([0, 50, 100], 220, 120, 100, { left: 10, right: 10, top: 10, bottom: 10 });
    expect(pts).toEqual([{ x: 10, y: 110 }, { x: 110, y: 60 }, { x: 210, y: 10 }]);
    expect(layoutPoints([5], 100, 50, 10)).toEqual([{ x: 50, y: 25 }]);
  });

  it("draws a smooth line that never overshoots the points (a 0 never dips under the axis)", () => {
    const pts = layoutPoints([10, 0, 0, 40, 40, 5], 500, 100, 40);
    const d = linePath(pts);
    expect(d.startsWith("M0,75")).toBe(true);
    const ys = [...d.matchAll(/-?\d+(?:\.\d+)?,(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(linePath([])).toBe("");
    expect(linePath([{ x: 1, y: 2 }])).toBe("M1,2");
  });

  it("closes the area down to the baseline", () => {
    const pts = [{ x: 0, y: 10 }, { x: 100, y: 20 }];
    expect(areaPath(pts, 50).endsWith("L100,50L0,50Z")).toBe(true);
  });

  it("snaps the crosshair to the nearest point", () => {
    const pts = layoutPoints([1, 2, 3, 4], 300, 100, 4);
    expect(nearestIndex(pts, 0)).toBe(0);
    expect(nearestIndex(pts, 140)).toBe(1);
    expect(nearestIndex(pts, 160)).toBe(2);
    expect(nearestIndex(pts, 999)).toBe(3);
  });
});

describe("shares and the donut", () => {
  it("gives whole shares that always add up to 100", () => {
    expect(sharesOf([1, 1, 1])).toEqual([34, 33, 33]);
    expect(sharesOf([138, 98, 71, 53, 36, 48]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(sharesOf([0, 0])).toEqual([0, 0]);
    expect(sharesOf([5, 0])).toEqual([100, 0]);
  });

  it("lays segments end to end with a gap after each, and one segment fills the ring", () => {
    const arcs = donutArcs([3, 1], 100, 2);
    expect(arcs[0]).toEqual({ start: 0, end: 75, length: 73, offset: 0 });
    expect(arcs[1]).toEqual({ start: 75, end: 100, length: 23, offset: 75 });
    expect(donutArcs([5, 0], 100, 2)[0].length).toBe(100);
    expect(donutArcs([0, 0], 100)[0].length).toBe(0);
  });
});

describe("comparisons and labels", () => {
  it("says how much a count changed, and how many points a rate moved", () => {
    expect(changePct(112, 100)).toBe(12);
    expect(changePct(80, 100)).toBe(-20);
    expect(changePct(5, 0)).toBeNull();
    expect(changePct(5, null)).toBeNull();
    expect(pointsChange(75, 71)).toBe(4);
    expect(pointsChange(null, 71)).toBeNull();
  });

  it("writes short axis numbers and country flags", () => {
    expect([compactNumber(625), compactNumber(1284), compactNumber(12_900), compactNumber(4_200_000)]).toEqual(["625", "1.3K", "13K", "4.2M"]);
    expect(flagEmoji("RW")).toBe("🇷🇼");
    expect(flagEmoji("")).toBe("🌍");
    expect(flagEmoji(null)).toBe("🌍");
  });

  it("formats tile values", () => {
    expect(formatValue(1381, "int")).toBe("1,381");
    expect(formatValue(71.6, "pct")).toBe("72%");
    expect(formatValue(100, "seconds")).toBe("1 min 40 s");
    expect(formatValue(52_400, "ms")).toBe("52 s");
    expect(formatValue(3 * 3600 + 600, "seconds")).toBe("3 h 10 min");
    expect(formatValue(null, "int")).toBe("–");
  });

  it("says when a week or month is only partly in the period", () => {
    const base = { key: "k", visitors: 1, views: 1, oldMethod: false };
    expect(pointLabel({ ...base, label: "Nov 2026", from: "2026-11-01", to: "2026-11-10" }, "month")).toBe("Nov 2026, 10 days only");
    expect(pointLabel({ ...base, label: "Oct 2026", from: "2026-10-01", to: "2026-10-31" }, "month")).toBe("Oct 2026");
    expect(pointLabel({ ...base, label: "Week of 9 Nov", from: "2026-11-09", to: "2026-11-09" }, "week")).toBe("Week of 9 Nov, 1 day only");
    expect(pointLabel({ ...base, label: "9 Nov", from: "2026-11-09", to: "2026-11-09" }, "day")).toBe("9 Nov");
  });
});

describe("sourceSlices", () => {
  it("keeps the five biggest sources, adds up the rest, and gives each known source its own colour", () => {
    const s = sourceSlices([
      { key: "google", visitors: 30 },
      { key: "direct", visitors: 50 },
      { key: "kigalitoday.com", visitors: 20 },
      { key: "whatsapp", visitors: 10 },
      { key: "instagram", visitors: 8 },
      { key: "facebook", visitors: 5 },
      { key: "tiktok", visitors: 2 },
      { key: "zero", visitors: 0 },
    ]);
    expect(s.map((x) => [x.key, x.value, x.slot])).toEqual([
      ["direct", 50, 0],
      ["google", 30, 1],
      ["kigalitoday.com", 20, 7],
      ["whatsapp", 10, 2],
      ["instagram", 8, 4],
      ["__other", 7, null],
    ]);
  });

  it("never repaints a known source when the period changes", () => {
    const a = sourceSlices([{ key: "google", visitors: 9 }, { key: "direct", visitors: 3 }]);
    const b = sourceSlices([{ key: "direct", visitors: 9 }, { key: "google", visitors: 3 }]);
    expect(a.find((x) => x.key === "google")?.slot).toBe(b.find((x) => x.key === "google")?.slot);
    expect(sourceSlices([])).toEqual([]);
  });
});

// Pure maths for the support app's hand-made SVG charts (components/support-app/charts): axis ticks, the
// line and area paths, donut arcs, shares, period-over-period change and compact numbers. No DOM, no React: unit-tested
// in tests/support-app/chart-math.test.ts.

/**
 * Round axis ticks from 0 up past the highest value: 3 to 5 steps of 1, 2, 2.5 or 5 × a power of ten, the one that wastes
 * the least room at the top (82 → 0, 25 … 100; 2,025 → 0, 500 … 2,500). Counts are whole, so a step is never under 1.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  if (max < 3) return Array.from({ length: Math.ceil(max) + 1 }, (_, i) => i);
  const p = 10 ** Math.floor(Math.log10(max / count));
  let best: { step: number; n: number } | null = null;
  for (const scale of [p / 10, p, p * 10])
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * scale;
      if (step < 1 || !Number.isInteger(step)) continue;
      const n = Math.ceil(max / step - 1e-9);
      if (n < 3 || n > 5) continue;
      if (!best || n * step < best.n * best.step || (n * step === best.n * best.step && Math.abs(n - count) < Math.abs(best.n - count))) best = { step, n };
    }
  const { step, n } = best ?? { step: Math.ceil(max / count), n: count };
  return Array.from({ length: n + 1 }, (_, i) => i * step);
}

export type XY = { x: number; y: number };

/** Points of a series laid out in a w × h box (x evenly spread, y from 0 at the bottom to `max` at the top). */
export function layoutPoints(values: number[], w: number, h: number, max: number, pad = { left: 0, right: 0, top: 0, bottom: 0 }): XY[] {
  const innerW = Math.max(0, w - pad.left - pad.right);
  const innerH = Math.max(0, h - pad.top - pad.bottom);
  const top = max > 0 ? max : 1;
  return values.map((v, i) => ({
    x: pad.left + (values.length === 1 ? innerW / 2 : (innerW * i) / (values.length - 1)),
    y: pad.top + innerH - (Math.max(0, v) / top) * innerH,
  }));
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A smooth line through the points (monotone cubic: it never overshoots, so a day with 0 never dips below the axis and a
 * peak is never drawn higher than it was). Straight segments when there are only two points.
 */
export function linePath(pts: XY[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${r1(pts[0].x)},${r1(pts[0].y)}`;
  const n = pts.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    m.push(dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i]);
  }
  // Tangents (Fritsch–Carlson).
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  let d = `M${r1(pts[0].x)},${r1(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${r1(pts[i].x + h)},${r1(pts[i].y + t[i] * h)} ${r1(pts[i + 1].x - h)},${r1(pts[i + 1].y - t[i + 1] * h)} ${r1(pts[i + 1].x)},${r1(pts[i + 1].y)}`;
  }
  return d;
}

/** The line closed down to the baseline: the area under it. */
export function areaPath(pts: XY[], baseline: number): string {
  if (pts.length === 0) return "";
  const line = linePath(pts);
  return `${line}L${r1(pts[pts.length - 1].x)},${r1(baseline)}L${r1(pts[0].x)},${r1(baseline)}Z`;
}

/** The index of the point nearest to x (the crosshair snaps to it). */
export function nearestIndex(pts: XY[], x: number): number {
  let best = 0;
  for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].x - x) < Math.abs(pts[best].x - x)) best = i;
  return best;
}

/** Whole-number shares that add up to exactly 100 (largest remainder), so a donut's legend never says 99% or 101%. */
export function sharesOf(values: number[]): number[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (Math.max(0, v) / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => ({ i, rest: v - Math.floor(v) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    floors[o.i]++;
    left--;
  }
  return floors;
}

export type Arc = { start: number; end: number; length: number; offset: number };

/**
 * Donut segments on a circle of circumference `c`: each one's length and where it starts, with `gap` left empty after
 * every segment (the 2px surface gap between fills). A single segment fills the whole ring with no gap.
 */
export function donutArcs(values: number[], c: number, gap = 2): Arc[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  const parts = values.filter((v) => v > 0).length;
  let at = 0;
  return values.map((v) => {
    const share = total > 0 ? Math.max(0, v) / total : 0;
    const full = share * c;
    const length = parts > 1 && full > 0 ? Math.max(0.5, full - gap) : full;
    const arc = { start: at, end: at + full, length, offset: at };
    at += full;
    return arc;
  });
}

/** The change from `before` to `now` in whole percent, or null when there is nothing to compare with. */
export function changePct(now: number | null | undefined, before: number | null | undefined): number | null {
  if (now == null || before == null || !Number.isFinite(now) || !Number.isFinite(before) || before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

/** The difference between two percentages in points (71% → 75% is +4), or null. */
export function pointsChange(now: number | null | undefined, before: number | null | undefined): number | null {
  if (now == null || before == null || !Number.isFinite(now) || !Number.isFinite(before)) return null;
  return Math.round(now - before);
}

/** 1,284 / 12.9K / 4.2M: short numbers for axis ticks. */
export function compactNumber(v: number): string {
  const a = Math.abs(v);
  if (a < 1000) return String(Math.round(v * 10) / 10);
  if (a < 10_000) return `${(Math.round(v / 100) / 10).toString()}K`;
  if (a < 1_000_000) return `${Math.round(v / 1000)}K`;
  return `${Math.round(v / 100_000) / 10}M`;
}

/** A country's flag emoji from its two-letter code ("RW" → 🇷🇼), or a globe for an unknown one. */
export function flagEmoji(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return "🌍";
  return String.fromCodePoint(...[...code.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

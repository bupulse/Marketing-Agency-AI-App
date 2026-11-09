import { cn } from "@/lib/cn";
import type { SeriesPoint } from "@/lib/analytics/visitors-shared";

// Visitors per day, week or month: one series, so no legend; the section's title names it. Plain HTML columns (they
// stay crisp at any width), each with a hover/focus tooltip, and the same numbers as a table under "Show as a table".
// Old-method columns are striped and say so in the tooltip and the table, never by colour alone.

const STRIPES = "repeating-linear-gradient(135deg, var(--color-pulse-blue) 0 3px, transparent 3px 6px)";
const num = (v: number) => v.toLocaleString("en-GB");

/** A round top for the axis: 1, 2, 5 × a power of ten at or above the highest value. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function VisitorsChart({ points, unit }: { points: SeriesPoint[]; unit: "day" | "week" | "month" }) {
  const max = niceMax(Math.max(0, ...points.map((p) => p.visitors)));
  const anyOld = points.some((p) => p.oldMethod && p.visitors > 0);
  const many = points.length > 16;
  // A few dates under the chart: first, middle and last when there are many columns, each one otherwise.
  const labelAt = new Set(many ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : points.map((_, i) => i));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div aria-hidden className="flex w-8 shrink-0 flex-col justify-between pb-6 text-right text-[11px] tabular-nums text-muted">
          <span>{num(max)}</span>
          <span>{num(max / 2)}</span>
          <span>0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between">
            <span className="border-t border-line" />
            <span className="border-t border-dashed border-line" />
            <span className="border-t border-line" />
          </div>
          <ol aria-label={`Visitors per ${unit}`} className={cn("relative flex h-48 items-end sm:h-56", many ? "gap-px sm:gap-0.5" : "gap-0.5 sm:gap-1")}>
            {points.map((p, i) => {
              const h = p.visitors > 0 ? Math.max(2, (p.visitors / max) * 100) : 0;
              const text = `${p.label}: ${num(p.visitors)} visitor${p.visitors === 1 ? "" : "s"}, ${num(p.views)} page view${p.views === 1 ? "" : "s"}${p.oldMethod && p.visitors > 0 ? " (old method)" : ""}`;
              return (
                <li key={p.key} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end pb-6">
                  <span tabIndex={0} aria-label={text} className="flex h-full w-full cursor-default items-end justify-center rounded-t outline-offset-2 focus-visible:outline-2 focus-visible:outline-[#2f6bff]">
                    <span
                      className={cn("w-full max-w-9 rounded-t-[4px]", p.oldMethod ? "border border-b-0 border-[var(--color-pulse-blue)]" : "bg-[var(--color-pulse-blue)]", "group-hover:opacity-85")}
                      style={{ height: `${h}%`, ...(p.oldMethod ? { backgroundImage: STRIPES } : {}) }}
                    />
                  </span>
                  <span
                    role="presentation"
                    className={cn(
                      "pointer-events-none absolute bottom-full z-10 mb-1 hidden w-max max-w-[220px] rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg group-focus-within:block group-hover:block",
                      i < points.length / 3 ? "left-0" : i > (points.length * 2) / 3 ? "right-0" : "left-1/2 -translate-x-1/2",
                    )}
                  >
                    <strong className="block">{p.label}</strong>
                    <span className="tabular-nums">{num(p.visitors)} visitors · {num(p.views)} page views</span>
                    {p.oldMethod && p.visitors > 0 && <span className="block text-muted">Old method</span>}
                  </span>
                  {labelAt.has(i) && (
                    <span aria-hidden className={cn("absolute bottom-0 truncate text-[11px] text-muted", many && i === 0 ? "left-0" : many && i === points.length - 1 ? "right-0" : "")}>
                      {unit === "week" ? p.label.replace("Week of ", "") : p.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      {anyOld && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <span aria-hidden className="inline-block size-3 rounded-[3px] border border-[var(--color-pulse-blue)]" style={{ backgroundImage: STRIPES }} />
          Striped: old method (each browser counted as a visitor)
        </p>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-ok">Show as a table</summary>
        <div className="mt-2 max-h-80 overflow-auto">
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="text-left text-xs tracking-[0.03em] text-muted">
                <th scope="col" className="border-b border-line py-2 pr-3 font-semibold">{unit === "day" ? "DAY" : unit === "week" ? "WEEK" : "MONTH"}</th>
                <th scope="col" className="border-b border-line py-2 pr-3 text-right font-semibold">VISITORS</th>
                <th scope="col" className="border-b border-line py-2 pr-3 text-right font-semibold">PAGE VIEWS</th>
                {anyOld && <th scope="col" className="border-b border-line py-2 font-semibold">COUNTED</th>}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.key}>
                  <td className="border-b border-line/60 py-2 pr-3">{p.label}</td>
                  <td className="border-b border-line/60 py-2 pr-3 text-right tabular-nums">{num(p.visitors)}</td>
                  <td className="border-b border-line/60 py-2 pr-3 text-right tabular-nums">{num(p.views)}</td>
                  {anyOld && <td className="border-b border-line/60 py-2 text-muted">{p.oldMethod && p.visitors > 0 ? "Old method" : "New method"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

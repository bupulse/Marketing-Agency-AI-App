"use client";

import { useEffect, useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Check, TrendingUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { areaPath, compactNumber, layoutPoints, linePath, nearestIndex, niceTicks } from "./chart-math";
import { useReveal } from "./use-reveal";

// One measure over time as a smooth line over a soft wash. The line draws itself in, the wash fades up and the best
// point pops a label when the chart scrolls into view. A crosshair follows the pointer (or the arrow keys) and snaps to
// the nearest point, with a tooltip of every measure at that point. Two measures of different sizes never share an axis:
// chips switch between them. "Show the numbers" opens the same data as a table.

export type AreaMetric = { key: string; name: string; one: string; many: string; values: number[] };

const num = (v: number) => v.toLocaleString("en-GB");
const PAD = { left: 38, right: 14, top: 26, bottom: 30 };

export function AreaChart({
  labels,
  axisLabels,
  metrics,
  flags,
  flagNote,
  caption,
  firstColumn,
}: {
  /** Full label of each point ("9 Nov", "Week of 3 Nov"). */
  labels: string[];
  /** Shorter labels for under the axis (defaults to `labels`). */
  axisLabels?: string[];
  metrics: AreaMetric[];
  /** Points drawn in a shaded band with `flagNote` (the old counting method). */
  flags?: boolean[];
  flagNote?: string;
  caption: string;
  firstColumn: string;
}) {
  const [metricKey, setMetricKey] = useState(metrics[0]?.key ?? "");
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const ids = { tip: useId(), live: useId(), grad: useId().replace(/:/g, "") };
  // One element: the chart box is measured for its width and animates in when it scrolls into view.
  const boxRef = useReveal<HTMLDivElement>(undefined, metric?.key);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [boxRef]);

  const values = useMemo(() => metric?.values ?? [], [metric]);
  const height = width < 520 ? 210 : 260;
  const pad = PAD;
  const ticks = niceTicks(Math.max(0, ...values));
  const top = ticks[ticks.length - 1];
  const pts = useMemo(() => layoutPoints(values, width, height, top, PAD), [values, width, height, top]);
  const baseline = height - pad.bottom;
  const yOf = (v: number) => pad.top + (height - pad.top - pad.bottom) * (1 - v / top);
  const peak = values.length ? values.indexOf(Math.max(...values)) : -1;
  const short = axisLabels ?? labels;

  // A few dates under the axis: as many as fit (about one per 78 px), always the first and the last.
  const fit = Math.max(2, Math.floor((width - pad.left - pad.right) / 78));
  const step = Math.max(1, Math.ceil((labels.length - 1) / (fit - 1)));
  const axisAt = new Set<number>();
  for (let i = 0; i < labels.length; i += step) axisAt.add(i);
  if (labels.length) {
    const last = labels.length - 1;
    // Drop the label before the last when they would touch.
    for (const i of axisAt) if (i !== last && last - i < step * 0.6) axisAt.delete(i);
    axisAt.add(last);
  }

  // Shaded bands for flagged runs (the old counting method).
  const bands: { from: number; to: number }[] = [];
  if (flags && pts.length) {
    let start: number | null = null;
    flags.forEach((f, i) => {
      if (f && start === null) start = i;
      if ((!f || i === flags.length - 1) && start !== null) {
        const end = f ? i : i - 1;
        const half = pts.length > 1 ? (pts[1].x - pts[0].x) / 2 : 20;
        bands.push({ from: Math.max(pad.left, pts[start].x - half), to: Math.min(width - pad.right, pts[end].x + half) });
        start = null;
      }
    });
  }

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect();
    setActive(nearestIndex(pts, ((e.clientX - r.left) / r.width) * width));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!pts.length) return;
    const last = pts.length - 1;
    const next = e.key === "ArrowRight" ? Math.min(last, (active ?? -1) + 1) : e.key === "ArrowLeft" ? Math.max(0, (active ?? last + 1) - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (e.key === "Escape") setActive(null);
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };

  const a = active != null && pts[active] ? active : null;
  const tipLeft = a != null ? Math.min(Math.max(pts[a].x, 90), width - 90) : 0;
  const total = values.reduce((s, v) => s + v, 0);
  const summary = metric
    ? `${caption}. ${values.length} points, ${num(total)} ${metric.many} in all${peak >= 0 ? `; the highest was ${labels[peak]} with ${num(values[peak])}` : ""}. Use the left and right arrow keys to read each point.`
    : caption;

  return (
    <div className="flex flex-col gap-3">
      {metrics.length > 1 && (
        <div role="radiogroup" aria-label="What the chart shows" className="flex flex-wrap gap-2">
          {metrics.map((m) => {
            const on = m.key === metric?.key;
            return (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setMetricKey(m.key)}
                className={cn(
                  "inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-4 focus-visible:ring-pulse-blue/30",
                  on ? "border-transparent bg-graphite text-white dark:bg-white dark:text-graphite" : "border-line bg-surface hover:border-pulse-blue/50 hover:bg-pulse-blue/5",
                )}
              >
                {on && <Check aria-hidden className="size-3.5" strokeWidth={3} />}
                {m.name}
              </button>
            );
          })}
        </div>
      )}

      <div
        ref={boxRef}
        tabIndex={0}
        role="group"
        aria-label={summary}
        aria-describedby={a != null ? ids.tip : undefined}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        className="relative rounded-2xl outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/25"
      >
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden className="block overflow-visible select-none">
          <defs>
            <linearGradient id={ids.grad} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--viz-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--viz-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {bands.map((b, i) => (
            <g key={i}>
              <rect x={b.from} y={pad.top - 14} width={Math.max(0, b.to - b.from)} height={baseline - pad.top + 14} fill="var(--viz-grid)" opacity={0.75} rx={6} />
              {b.to - b.from > 70 && (
                <text x={b.from + 6} y={pad.top - 3} fontSize={10.5} fill="currentColor" className="fill-muted">
                  Old counting
                </text>
              )}
            </g>
          ))}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={yOf(t)} y2={yOf(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={pad.left - 8} y={yOf(t) + 3.5} textAnchor="end" fontSize={11} className="fill-muted tabular-nums">
                {compactNumber(t)}
              </text>
            </g>
          ))}
          {short.map((l, i) =>
            axisAt.has(i) && pts[i] ? (
              <text
                key={i}
                x={pts[i].x}
                y={height - 8}
                textAnchor={labels.length > 1 && i === 0 ? "start" : labels.length > 1 && i === labels.length - 1 ? "end" : "middle"}
                fontSize={11}
                className="fill-muted"
              >
                {l}
              </text>
            ) : null,
          )}
          {pts.length > 1 && <path d={areaPath(pts, baseline)} fill={`url(#${ids.grad})`} className="bp-fade" />}
          {pts.length > 1 && (
            <path d={linePath(pts)} pathLength={1} fill="none" stroke="var(--viz-1)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="bp-line" />
          )}
          {pts.length === 1 && <circle cx={pts[0].x} cy={pts[0].y} r={6} fill="var(--viz-1)" stroke="var(--viz-surface)" strokeWidth={2} className="bp-pop" />}
          {peak >= 0 && pts[peak] && values[peak] > 0 && a == null && (
            <g className="bp-pop" style={{ transformOrigin: `${pts[peak].x}px ${pts[peak].y}px` }}>
              <circle cx={pts[peak].x} cy={pts[peak].y} r={5} fill="var(--viz-1)" stroke="var(--viz-surface)" strokeWidth={2} />
              <text
                x={Math.min(Math.max(pts[peak].x, pad.left + 30), width - pad.right - 30)}
                y={pts[peak].y - 11}
                textAnchor="middle"
                fontSize={11.5}
                fontWeight={700}
                className="fill-current"
              >
                {num(values[peak])}
              </text>
            </g>
          )}
          {a != null && (
            <g>
              <line x1={pts[a].x} x2={pts[a].x} y1={pad.top - 6} y2={baseline} stroke="var(--viz-axis)" strokeWidth={1} />
              <circle cx={pts[a].x} cy={pts[a].y} r={5.5} fill="var(--viz-1)" stroke="var(--viz-surface)" strokeWidth={2.5} />
            </g>
          )}
          <rect
            x={pad.left - 6}
            y={0}
            width={Math.max(0, width - pad.left - pad.right + 12)}
            height={height}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setActive(null)}
            style={{ touchAction: "pan-y" }}
          />
        </svg>
        {a != null && metric && (
          <div
            id={ids.tip}
            className="pointer-events-none absolute top-0 z-10 w-max min-w-[150px] max-w-[220px] -translate-x-1/2 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-[0_12px_30px_-12px_rgba(17,24,39,0.35)]"
            style={{ left: tipLeft }}
          >
            <p className="font-semibold text-muted">{labels[a]}</p>
            {metrics.map((m) => (
              <p key={m.key} className={cn("mt-0.5 flex items-center gap-2", m.key !== metric.key && "text-muted")}>
                <span aria-hidden className={cn("inline-block h-0.5 w-3 rounded-full", m.key === metric.key ? "bg-[var(--viz-1)]" : "bg-[var(--viz-axis)]")} />
                <strong className={cn("tabular-nums", m.key === metric.key ? "text-[15px]" : "text-[13px]")}>{num(m.values[a] ?? 0)}</strong>
                <span>{(m.values[a] ?? 0) === 1 ? m.one : m.many}</span>
              </p>
            ))}
            {flags?.[a] && flagNote && <p className="mt-1 text-muted">{flagNote}</p>}
          </div>
        )}
        <p id={ids.live} aria-live="polite" className="sr-only">
          {a != null && metric ? `${labels[a]}: ${metrics.map((m) => `${num(m.values[a] ?? 0)} ${m.many}`).join(", ")}${flags?.[a] && flagNote ? `, ${flagNote}` : ""}` : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <TrendingUp aria-hidden className="size-3.5" />
          Touch or hover the chart to read any {firstColumn.toLowerCase()}.
        </p>
        {bands.length > 0 && flagNote && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <span aria-hidden className="inline-block size-3 rounded-[3px] bg-[var(--viz-grid)]" />
            Shaded: {flagNote.toLowerCase()}
          </p>
        )}
      </div>

      <details className="group/t text-sm">
        <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-full border border-line px-3.5 font-semibold hover:bg-pulse-blue/5 [&::-webkit-details-marker]:hidden">
          Show the numbers
        </summary>
        <div className="mt-2 max-h-80 overflow-auto">
          <table className="w-full border-collapse text-[13.5px]">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="text-left text-xs tracking-[0.03em] text-muted">
                <th scope="col" className="border-b border-line py-2 pr-3 font-semibold">{firstColumn.toUpperCase()}</th>
                {metrics.map((m) => (
                  <th key={m.key} scope="col" className="border-b border-line py-2 pr-3 text-right font-semibold">{m.name.toUpperCase()}</th>
                ))}
                {flags?.some(Boolean) && <th scope="col" className="border-b border-line py-2 font-semibold">COUNTED</th>}
              </tr>
            </thead>
            <tbody>
              {labels.map((l, i) => (
                <tr key={`${l}-${i}`}>
                  <td className="border-b border-line/60 py-2 pr-3">{l}</td>
                  {metrics.map((m) => (
                    <td key={m.key} className="border-b border-line/60 py-2 pr-3 text-right tabular-nums">{num(m.values[i] ?? 0)}</td>
                  ))}
                  {flags?.some(Boolean) && <td className="border-b border-line/60 py-2 text-muted">{flags[i] ? "Old method" : "New method"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

"use client";

import { useReveal } from "./use-reveal";

// Before → now for a few rates on one 0–100% scale: a grey dot for the period before, a blue dot for this period, and a
// line between them. The two numbers are printed beside each row, so the dots never carry the meaning alone.

export type DumbbellRow = { key: string; label: string; before: number | null; now: number | null; upIsGood: boolean };

const fmt = (v: number | null) => (v == null ? "–" : `${Math.round(v)}%`);

export function Dumbbell({ rows, beforeLabel, nowLabel, ariaLabel }: { rows: DumbbellRow[]; beforeLabel: string; nowLabel: string; ariaLabel: string }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-[12.5px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-3 rounded-full border-2 border-[var(--viz-other)] bg-surface" />
          {beforeLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-3 rounded-full bg-[var(--viz-1)]" />
          {nowLabel}
        </span>
      </div>
      <ul aria-label={ariaLabel} className="flex flex-col gap-3.5">
        {rows.map((r, i) => {
          const lo = Math.min(r.before ?? r.now ?? 0, r.now ?? r.before ?? 0);
          const hi = Math.max(r.before ?? r.now ?? 0, r.now ?? r.before ?? 0);
          return (
            <li key={r.key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                <span className="font-semibold">{r.label}</span>
                <span className="tabular-nums text-muted">
                  <span className="sr-only">{beforeLabel}: </span>
                  {fmt(r.before)} <span aria-hidden>→</span>
                  <span className="sr-only">, {nowLabel}: </span> <strong className="text-text">{fmt(r.now)}</strong>
                </span>
              </div>
              <div aria-hidden className="relative h-5">
                <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--viz-grid)]" />
                {[0, 25, 50, 75, 100].map((t) => (
                  <span key={t} className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-[var(--viz-axis)]" style={{ left: `${t}%` }} />
                ))}
                {r.before != null && r.now != null && (
                  <span className="bp-grow-x absolute top-[calc(50%-2px)] h-1 rounded-full bg-[var(--viz-1)]/35" style={{ left: `${lo}%`, width: `${hi - lo}%`, ["--i" as string]: i }} />
                )}
                {r.before != null && (
                  <span className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--viz-other)] bg-surface" style={{ left: `${r.before}%` }} />
                )}
                {r.now != null && (
                  <span
                    className="bp-pop absolute top-1/2 -ml-2 -mt-2 size-4 rounded-full bg-[var(--viz-1)] ring-2 ring-[var(--viz-surface)]"
                    style={{ left: `${r.now}%`, ["--i" as string]: i }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div aria-hidden className="relative h-4 text-[11px] text-muted">
        {[0, 50, 100].map((t) => (
          <span key={t} className="absolute -translate-x-1/2 tabular-nums first:translate-x-0 last:-translate-x-full" style={{ left: `${t}%` }}>
            {t}%
          </span>
        ))}
      </div>
    </div>
  );
}

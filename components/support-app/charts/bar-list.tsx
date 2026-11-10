"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { sharesOf } from "./chart-math";
import { useReveal } from "./use-reveal";

// Ranked horizontal bars, largest first, one colour: a name (with a flag, logo or icon), its number and share printed
// as text, and a bar that grows in from the left when the list scrolls into view. The first rows show; "Show all"
// opens the rest. The numbers are text, so nothing hides behind a hover.

export type BarRow = { key: string; name: ReactNode; label: string; icon?: ReactNode; value: number; detail?: ReactNode };

const num = (v: number) => v.toLocaleString("en-GB");

export function BarList({
  rows,
  one,
  many,
  first = 6,
  empty,
  color = "var(--viz-1)",
  showShare = true,
  ariaLabel,
}: {
  rows: BarRow[];
  one: string;
  many: string;
  first?: number;
  empty: string;
  color?: string;
  showShare?: boolean;
  ariaLabel: string;
}) {
  const [all, setAll] = useState(false);
  const ref = useReveal<HTMLDivElement>();
  if (rows.length === 0) return <p className="rounded-2xl bg-soft px-4 py-5 text-center text-sm text-muted">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const shares = sharesOf(rows.map((r) => r.value));
  const shown = all ? rows : rows.slice(0, first);
  return (
    <div ref={ref} className="flex flex-col gap-1">
      <ol aria-label={ariaLabel} className="flex flex-col">
        {shown.map((r, i) => (
          <li key={r.key} style={{ ["--i" as string]: i }} className="bp-rise group rounded-xl px-1.5 py-2 transition-colors hover:bg-pulse-blue/[0.05] motion-reduce:transition-none">
            <div className="flex items-center gap-2.5">
              {r.icon && <span className="inline-flex size-8 shrink-0 items-center justify-center text-[22px] leading-none">{r.icon}</span>}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[14px] font-semibold" title={r.label}>
                    {r.name}
                  </span>
                  <span className="shrink-0 text-[14px] tabular-nums">
                    <strong>{num(r.value)}</strong>
                    <span className="sr-only"> {r.value === 1 ? one : many}</span>
                    {showShare && <span className="ml-1.5 text-[12.5px] text-muted">{shares[i]}%</span>}
                  </span>
                </div>
                <span aria-hidden className="mt-1.5 block h-2.5 overflow-hidden rounded-full bg-[var(--viz-grid)]">
                  <span
                    className="bp-grow-x block h-full rounded-r-full transition-[filter] group-hover:brightness-110"
                    style={{ width: `${r.value > 0 ? Math.max(2, (r.value / max) * 100) : 0}%`, background: color, ["--i" as string]: i }}
                  />
                </span>
                {r.detail && <div className="mt-1 text-[12.5px] text-muted">{r.detail}</div>}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {rows.length > first && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className="mt-1 inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 self-start rounded-full border border-line px-3.5 text-sm font-semibold outline-none hover:bg-pulse-blue/5 focus-visible:ring-4 focus-visible:ring-pulse-blue/30"
        >
          {all ? "Show fewer" : `Show all ${rows.length}`}
          <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", all && "rotate-180")} />
        </button>
      )}
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { useReveal } from "./use-reveal";
import { RAMP } from "./chart-styles";

// Steps from the first contact to paying: one centred bar per step, as wide as its count against the first step (never
// thinner than a sliver, so a small step still shows), in an ordered blue ramp. Between two steps, a pill says what share
// of the step before reached it. The numbers sit beside the bars as text. Bars grow out from the centre in turn.

export type FunnelStep = { key: string; label: string; hint: string; icon?: ReactNode; count: number; ofPreviousPct: number | null };

const num = (v: number) => v.toLocaleString("en-GB");
const pct = (v: number) => `${v % 1 === 0 ? v : v.toFixed(1)}%`;

export function FunnelChart({ steps, ariaLabel }: { steps: FunnelStep[]; ariaLabel: string }) {
  const ref = useReveal<HTMLDivElement>();
  const top = Math.max(1, steps[0]?.count ?? 0);
  return (
    <div ref={ref}>
      <ol aria-label={ariaLabel} className="flex flex-col">
        {steps.map((s, i) => {
          const width = s.count > 0 ? Math.max(6, Math.min(100, (s.count / top) * 100)) : 0;
          return (
            <li key={s.key} className="flex flex-col items-stretch">
              {i > 0 && (
                <div className="flex items-center justify-center py-1.5" style={{ ["--i" as string]: i }}>
                  <span className="bp-rise inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] font-semibold text-muted shadow-sm" style={{ ["--i" as string]: i * 2 }}>
                    <ArrowDown aria-hidden className="size-3.5" />
                    {s.ofPreviousPct == null ? "Nothing to compare" : <><strong className="text-text">{pct(s.ofPreviousPct)}</strong> of the step before</>}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_5.5rem]">
                <div className="flex min-w-0 items-center gap-2.5">
                  {s.icon && (
                    <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-soft text-pulse-blue dark:text-[#8db0ff] [&>svg]:size-[18px]">
                      {s.icon}
                    </span>
                  )}
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[14.5px] font-semibold leading-tight">{s.label}</span>
                    <span className="text-[12px] leading-snug text-muted">{s.hint}</span>
                  </span>
                  <strong className="ml-auto text-[18px] tabular-nums sm:hidden">{num(s.count)}</strong>
                </div>
                <div aria-hidden className="flex h-9 items-center justify-center rounded-xl bg-[var(--viz-grid)]/60">
                  {width > 0 && (
                    <span
                      className="bp-center-x block h-full rounded-xl"
                      style={{ width: `${width}%`, background: RAMP[Math.min(i, RAMP.length - 1)], ["--i" as string]: i }}
                    />
                  )}
                </div>
                <strong className="hidden text-right text-[20px] tabular-nums sm:block">{num(s.count)}</strong>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

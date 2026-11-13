"use client";

import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

export type BStep = { id: string; title: string; hint?: string; icon?: LucideIcon };

/**
 * A long form cut into small steps (owner, 12 November 2026: "don't put too much information on one page"): the step
 * pills with a progress bar on top, one step's card at a time, Back / Next under it and the form's own save button on
 * the last step (`finish`). Every step stays mounted (only hidden), so nothing typed is lost when moving between them,
 * and the form still submits every field. `at` / `onAt` let the form jump to the step with an error.
 */
export function BSteps({
  label,
  steps,
  children,
  finish,
  at: atProp,
  onAt,
  className,
}: {
  /** What the steps are for, for screen readers ("Company profile steps"). */
  label: string;
  steps: readonly BStep[];
  /** One panel per step, in the same order. */
  children: ReactNode[];
  /** Shown instead of Next on the last step (and next to Back): the save button and its status. */
  finish: ReactNode;
  at?: number;
  onAt?: (index: number) => void;
  className?: string;
}) {
  const [own, setOwn] = useState(0);
  const at = atProp ?? own;
  const go = (i: number) => {
    const next = Math.max(0, Math.min(steps.length - 1, i));
    if (onAt) onAt(next);
    else setOwn(next);
  };
  const last = at === steps.length - 1;
  const pct = Math.round(((at + 1) / steps.length) * 100);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <nav aria-label={label} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 px-1 text-[13px] font-semibold text-muted">
          <span>
            Step {at + 1} of {steps.length}
          </span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-line">
          <span className="block h-full rounded-full bg-brand-gradient transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
        </div>
        <ol className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {steps.map((s, i) => {
            const on = i === at;
            const done = i < at;
            const Icon = s.icon;
            return (
              <li key={s.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={on ? "step" : undefined}
                  className={cn(
                    "inline-flex min-h-10 items-center gap-1.5 rounded-full border-2 px-3.5 text-[13px] font-semibold transition-[border-color,background-color,transform] duration-200 hover:-translate-y-px motion-reduce:transform-none motion-reduce:transition-none",
                    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30",
                    on ? "border-pulse-blue bg-pulse-blue/[0.08] text-text dark:bg-pulse-blue/15" : "border-line bg-surface text-muted hover:border-pulse-blue/40 hover:text-text dark:bg-white/[0.03]",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "inline-flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums",
                      on ? "bg-brand-gradient text-white" : done ? "bg-pulse-blue/15 text-pulse-blue" : "bg-soft text-muted",
                    )}
                  >
                    {done ? <Check className="size-3" strokeWidth={3} /> : Icon ? <Icon className="size-3" /> : i + 1}
                  </span>
                  {s.title}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {children.map((panel, i) => (
        <div key={steps[i]?.id ?? i} hidden={i !== at} className="kit-rise">
          <div>{panel}</div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        {at > 0 && (
          <Button type="button" variant="outline" onClick={() => go(at - 1)} leading={<ArrowLeft aria-hidden className="size-4" />}>
            Back
          </Button>
        )}
        {last ? (
          finish
        ) : (
          <Button type="button" onClick={() => go(at + 1)} trailing={<ArrowRight aria-hidden className="size-4" />}>
            Next: {steps[at + 1]?.title}
          </Button>
        )}
      </div>
    </div>
  );
}

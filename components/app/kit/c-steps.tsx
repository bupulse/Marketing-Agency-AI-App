"use client";

// Short steps instead of one long page (owner, 12 November 2026: "don't put too much information on one page ... make
// pages not long"). StepFrame shows one small question card at a time with a progress bar and Back / Next kept at the
// bottom of the screen; SectionTabs splits a settings page into a few cards you pick from. Both only change what is on
// screen: the page's own state and its save button stay where they were. No movement under prefers-reduced-motion.

import { ArrowLeft, ArrowRight, Check, LoaderCircle, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { KitStyles } from "@/components/admin/kit/kit-styles";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

export type CStep = { id: string; label: string };

const FOCUS = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30";

/**
 * One step at a time: the step pills (a step already seen can be opened again), a progress bar, the step's card (it
 * rises in when the step changes) and the buttons at the bottom. `next.label` names the last step's button ("Create").
 */
export function StepFrame({
  steps,
  index,
  onIndex,
  reached,
  next,
  aside,
  children,
}: {
  steps: readonly CStep[];
  index: number;
  onIndex: (i: number) => void;
  /** The furthest step opened so far: pills up to it can be tapped. */
  reached: number;
  next: { label?: string; onClick: () => void; busy?: boolean; busyLabel?: string; disabled?: boolean; icon?: ReactNode };
  /** A line above the buttons (a live summary, a problem). */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const top = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = top.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [index]);
  const pct = Math.round(((index + 1) / steps.length) * 100);
  return (
    <div ref={top} className="flex w-full scroll-mt-4 flex-col gap-4">
      <KitStyles />
      <nav aria-label="Steps" className="-mx-1 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]">
        <ol className="flex w-max gap-1.5">
          {steps.map((s, i) => {
            const here = i === index;
            const done = i < index || (i <= reached && i !== index);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={i > reached}
                  aria-current={here ? "step" : undefined}
                  onClick={() => onIndex(i)}
                  className={cn(
                    "inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors duration-200 disabled:cursor-default motion-reduce:transition-none",
                    FOCUS,
                    here ? "bg-brand-gradient text-white shadow-[0_8px_18px_-10px_rgba(85,99,255,0.9)]" : done ? "bg-pulse-blue/10 text-text dark:bg-pulse-blue/20" : "bg-soft text-muted",
                  )}
                >
                  <span aria-hidden className={cn("inline-flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums", here ? "bg-white/25" : done ? "bg-pulse-blue text-white" : "bg-line")}>
                    {done && !here ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className={cn(!here && "max-sm:hidden")}>{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <div role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 w-full overflow-hidden rounded-full bg-line">
        <span className="block h-full rounded-full bg-brand-gradient transition-[width] duration-500 ease-out-soft motion-reduce:transition-none" style={{ width: `${pct}%` }} />
      </div>
      <div className="kit-rise">
        <section
          key={steps[index]?.id}
          aria-label={`Step ${index + 1} of ${steps.length}: ${steps[index]?.label ?? ""}`}
          className="flex min-h-[320px] flex-col gap-5 rounded-[22px] border border-line bg-surface p-5 shadow-[0_18px_40px_-34px_rgba(17,24,39,0.5)] dark:bg-white/[0.035] dark:shadow-none sm:p-7"
        >
          {children}
        </section>
      </div>
      <div className="sticky bottom-0 z-20 -mx-1 flex flex-col gap-2 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1">
        {aside}
        <div className="flex items-center gap-2 rounded-[26px] border border-line bg-surface/90 p-1.5 shadow-[0_18px_40px_-30px_rgba(17,24,39,0.6)] backdrop-blur-md dark:bg-[#1b1b22]/90">
          <Button variant="ghost" onClick={() => onIndex(Math.max(0, index - 1))} disabled={index === 0 || next.busy} aria-label="Back" className="px-4">
            <ArrowLeft aria-hidden className="size-4" />
          </Button>
          <span className="hidden px-1 text-[13px] text-muted tabular-nums sm:inline">
            Step {index + 1} of {steps.length}
          </span>
          <Button
            className="flex-1 sm:ml-auto sm:flex-none sm:px-7"
            onClick={next.onClick}
            disabled={next.disabled || next.busy}
            leading={next.busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : next.icon}
            trailing={next.busy || next.icon ? undefined : <ArrowRight aria-hidden className="size-4" />}
          >
            {next.busy ? (next.busyLabel ?? "Working…") : (next.label ?? "Next")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The question at the top of a step: a big title and one plain line. */
export function StepHead({ title, hint, kicker }: { title: ReactNode; hint?: ReactNode; kicker?: ReactNode }) {
  return (
    <header className="flex flex-col gap-1.5">
      {kicker && <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted">{kicker}</p>}
      <h2 className="text-[22px] font-bold leading-tight tracking-[-0.025em] sm:text-[26px]">{title}</h2>
      {hint && <p className="max-w-xl text-[15px] leading-snug text-muted">{hint}</p>}
    </header>
  );
}

export type CTab<T extends string> = { id: T; label: string; hint?: string; icon: LucideIcon; badge?: ReactNode };

/**
 * A settings page split into a few parts: one tile per part (icon, name, a short line), the chosen one ringed. Only the
 * chosen part's card is shown under it. Real tabs for screen readers (role="tablist"), arrow keys move between them.
 */
export function SectionTabs<T extends string>({ label, tabs, current, onChange, idPrefix }: { label: string; tabs: readonly CTab<T>[]; current: T; onChange: (t: T) => void; idPrefix: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = tabs.findIndex((t) => t.id === current);
    const next = tabs[(at + step + tabs.length) % tabs.length];
    onChange(next.id);
    ref.current?.querySelector<HTMLButtonElement>(`#${idPrefix}-tab-${next.id}`)?.focus();
  };
  return (
    <div ref={ref} role="tablist" aria-label={label} onKeyDown={onKeyDown} className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none] sm:grid sm:overflow-visible" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      <KitStyles />
      {tabs.map((t) => {
        const on = t.id === current;
        const I = t.icon;
        return (
          <button
            key={t.id}
            id={`${idPrefix}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              "group relative flex min-w-[9.5rem] shrink-0 snap-start cursor-pointer items-center gap-2.5 rounded-[18px] border-2 p-2.5 text-left transition-[transform,border-color,background-color] duration-200 hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:transition-none sm:min-w-0 sm:p-3",
              FOCUS,
              on ? "border-pulse-blue bg-pulse-blue/[0.07] dark:bg-pulse-blue/15" : "border-line bg-surface hover:border-pulse-blue/40 dark:bg-white/[0.03]",
            )}
          >
            <span aria-hidden className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors duration-200", on ? "bg-brand-gradient text-white" : "bg-soft text-muted group-hover:text-text")}>
              <I className="size-[18px]" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[14px] font-semibold text-text">{t.label}</span>
              {t.hint && <span className="truncate text-[12px] text-muted">{t.hint}</span>}
            </span>
            {t.badge && <span className="ml-auto shrink-0">{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The card under SectionTabs: it rises in when the tab changes. */
export function TabPanel({ idPrefix, current, title, hint, action, children }: { idPrefix: string; current: string; title: ReactNode; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="kit-rise">
      <section
        key={current}
        id={`${idPrefix}-panel`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${current}`}
        className="flex flex-col gap-5 rounded-[22px] border border-line bg-surface p-5 shadow-[0_18px_40px_-34px_rgba(17,24,39,0.5)] dark:bg-white/[0.035] dark:shadow-none sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-[18px] font-bold tracking-[-0.02em]">{title}</h2>
            {hint && <p className="max-w-xl text-[14px] leading-snug text-muted">{hint}</p>}
          </div>
          {action}
        </div>
        {children}
      </section>
    </div>
  );
}

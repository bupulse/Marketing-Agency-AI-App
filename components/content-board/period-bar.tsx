"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { DAY_RANGE } from "@/lib/content-flow/day";
import { PERIOD_VIEW_LABEL, PERIOD_VIEWS, periodContains, periodOf, shiftPeriod, type PeriodView } from "@/lib/content-board/period";
import { addDays } from "@/lib/publishing/time";

/**
 * The Day / Week / Month switch with the previous and next period, a date picker and "Today" (docs/CONTENT.md). Every
 * choice is a link (?view=week&day=2026-10-31), so the back button and shared links work. `query` is the rest of the
 * view's filters ("" or "?app=instagram"), kept when the period changes. On the Posts page `allowAll` adds "All" (no
 * period, the default there); inside a card the default is Day. `custom` is a custom date range picked in Filters,
 * shown instead of a period.
 */
export function PeriodBar({
  path,
  view,
  anchor,
  today,
  label,
  query,
  allowAll = false,
  custom = null,
}: {
  path: string;
  view: PeriodView | null;
  anchor: string;
  today: string;
  label: string;
  query: string;
  allowAll?: boolean;
  custom?: string | null;
}) {
  const router = useRouter();
  const defaultView: PeriodView | null = allowAll ? null : "day";
  const href = (v: PeriodView | null, d: string) => {
    const p = new URLSearchParams(query.replace(/^\?/, ""));
    for (const key of ["limit", "view", "day", "range", "from", "to", "date"]) p.delete(key);
    if (v && v !== defaultView) p.set("view", v);
    if (v && d !== today) p.set("day", d);
    const s = p.toString();
    return `${path}${s ? `?${s}` : ""}`;
  };
  const min = addDays(today, -DAY_RANGE.back);
  const max = addDays(today, DAY_RANGE.ahead);
  const period = view ? periodOf(view, anchor) : null;
  const prev = view ? shiftPeriod(view, anchor, -1) : anchor;
  const next = view ? shiftPeriod(view, anchor, 1) : anchor;
  const prevOff = view ? periodOf(view, prev).end < min : true;
  const nextOff = view ? periodOf(view, next).start > max : true;
  const unit = view === "week" ? "week" : view === "month" ? "month" : "day";
  const choices: (PeriodView | null)[] = allowAll ? [null, ...PERIOD_VIEWS] : [...PERIOD_VIEWS];
  const selected = custom ? undefined : view;
  const arrow = "glass inline-flex size-11 shrink-0 items-center justify-center rounded-full text-text hover:bg-soft aria-disabled:pointer-events-none aria-disabled:opacity-40";

  return (
    <nav aria-label="Choose the dates" className="glass flex flex-col gap-2 rounded-glass p-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div role="group" aria-label="Show posts by" className="flex w-full rounded-full bg-soft p-1 sm:w-auto">
        {choices.map((v) => {
          const on = selected === v;
          return (
            <Link
              key={v ?? "all"}
              href={href(v, v ? anchor : today)}
              scroll={false}
              aria-current={on ? "page" : undefined}
              className={cn("inline-flex min-h-11 flex-1 items-center justify-center rounded-full px-4 text-[14px] font-semibold no-underline sm:flex-none", on ? "bg-bg text-text shadow-glass" : "text-muted hover:text-text")}
            >
              {v ? PERIOD_VIEW_LABEL[v] : "All"}
            </Link>
          );
        })}
      </div>

      {period && !custom && (
        <>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Link href={href(view, prev)} aria-label={`Previous ${unit}`} aria-disabled={prevOff} className={arrow} scroll={false}>
              <ChevronLeft aria-hidden className="size-5" />
            </Link>
            <h2 className="min-w-0 flex-1 truncate text-center text-[16px] font-semibold tracking-[-0.01em]" aria-live="polite">
              {label}
            </h2>
            <Link href={href(view, next)} aria-label={`Next ${unit}`} aria-disabled={nextOff} className={arrow} scroll={false}>
              <ChevronRight aria-hidden className="size-5" />
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <label className="glass relative inline-flex min-h-11 flex-1 items-center gap-2 rounded-full px-4 text-[14px] font-medium sm:flex-none">
              <CalendarDays aria-hidden className="size-4 shrink-0 text-muted" />
              <span className="sr-only">Pick a day</span>
              <input
                type="date"
                value={anchor}
                min={min}
                max={max}
                onChange={(e) => e.target.value && router.push(href(view, e.target.value), { scroll: false })}
                className="min-h-11 w-full min-w-0 bg-transparent text-[14px] text-text outline-none"
              />
            </label>
            {!periodContains(period, today) && (
              <Link href={href(view, today)} className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-brand-gradient px-5 text-[14px] font-semibold text-white no-underline" scroll={false}>
                Today
              </Link>
            )}
          </div>
        </>
      )}
      {custom && <p className="px-2 text-[14px] text-muted">Your dates: {custom}. Pick Day, Week or Month to go back.</p>}
    </nav>
  );
}

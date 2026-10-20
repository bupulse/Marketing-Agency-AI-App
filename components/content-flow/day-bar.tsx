"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { addDays } from "@/lib/publishing/time";
import { DAY_RANGE } from "@/lib/content-flow/day";

/**
 * The day view's date bar: the previous and next day, a calendar picker and "Today". `query` is the rest of the view's
 * filters ("" or "?app=instagram"), kept when the day changes.
 */
export function DayBar({ path, day, today, label, query }: { path: string; day: string; today: string; label: string; query: string }) {
  const router = useRouter();
  const href = (d: string) => {
    const p = new URLSearchParams(query.replace(/^\?/, ""));
    p.delete("limit");
    if (d === today) p.delete("day");
    else p.set("day", d);
    const s = p.toString();
    return `${path}${s ? `?${s}` : ""}`;
  };
  const min = addDays(today, -DAY_RANGE.back);
  const max = addDays(today, DAY_RANGE.ahead);
  const prev = addDays(day, -1);
  const next = addDays(day, 1);
  const arrow = "glass inline-flex size-11 shrink-0 items-center justify-center rounded-full text-text hover:bg-soft aria-disabled:pointer-events-none aria-disabled:opacity-40";

  return (
    <nav aria-label="Choose a day" className="glass @container flex flex-wrap items-center gap-2 rounded-glass p-2">
      <Link href={href(prev)} aria-label="Previous day" aria-disabled={prev < min} className={arrow} scroll={false}>
        <ChevronLeft aria-hidden className="size-5" />
      </Link>
      <h2 className="min-w-0 flex-[1_1_10rem] truncate text-center text-[16px] font-semibold tracking-[-0.01em]" aria-live="polite">
        {label}
      </h2>
      <Link href={href(next)} aria-label="Next day" aria-disabled={next > max} className={arrow} scroll={false}>
        <ChevronRight aria-hidden className="size-5" />
      </Link>
      <label className="glass relative inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[14px] font-medium">
        <CalendarDays aria-hidden className="size-4 text-muted" />
        <span className="sr-only">Pick a day</span>
        <input
          type="date"
          value={day}
          min={min}
          max={max}
          onChange={(e) => e.target.value && router.push(href(e.target.value), { scroll: false })}
          className="min-h-11 bg-transparent text-[14px] text-text outline-none"
        />
      </label>
      {day !== today && (
        <Link href={href(today)} className="inline-flex min-h-11 items-center rounded-full bg-brand-gradient px-5 text-[14px] font-semibold text-white no-underline" scroll={false}>
          Today
        </Link>
      )}
    </nav>
  );
}

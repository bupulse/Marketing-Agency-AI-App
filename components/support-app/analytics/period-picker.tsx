import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarDays, CalendarRange, Check, Clock, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { PRESETS, monthLabel, type Grouping, type PresetKey, type VisitorPeriod } from "@/lib/analytics/visitors-shared";

// The period controls of the Analytics page, every choice a tile or chip (plain links and a GET form, so they work
// before the page's scripts load and every view has its own address to share): the quick periods, a whole month, your
// own dates, and how the chart groups the days. The addresses are the same "?p= / ?m= / ?from=&to= / &by=" as before.

const GROUPINGS: { value: Grouping; label: string; hint: string }[] = [
  { value: "day", label: "By day", hint: "One point a day" },
  { value: "week", label: "By week", hint: "Monday to Sunday" },
  { value: "month", label: "By month", hint: "One point a month" },
];

const PRESET_INFO: Record<Exclude<PresetKey, "by-month" | "custom">, { hint: string; icon: ReactNode }> = {
  today: { hint: "Since midnight UTC", icon: <Sun className="size-[18px]" /> },
  "7d": { hint: "Today and the 6 days before", icon: <Clock className="size-[18px]" /> },
  "30d": { hint: "About a month back", icon: <CalendarDays className="size-[18px]" /> },
  month: { hint: "From the 1st to today", icon: <CalendarRange className="size-[18px]" /> },
};

const tile = (on: boolean) =>
  cn(
    "group relative flex items-center gap-2.5 rounded-2xl border-2 p-3 text-left outline-none transition-[transform,border-color,background-color,box-shadow] duration-200",
    "focus-visible:ring-4 focus-visible:ring-pulse-blue/30 hover:-translate-y-0.5 active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none",
    on
      ? "border-pulse-blue bg-pulse-blue/[0.07] shadow-[0_8px_24px_-12px_rgba(47,107,255,0.55)] dark:bg-pulse-blue/15"
      : "border-line bg-surface hover:border-pulse-blue/40 hover:shadow-[0_8px_20px_-14px_rgba(17,24,39,0.35)]",
  );

const chip = (on: boolean) =>
  cn(
    "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-4 focus-visible:ring-pulse-blue/30 motion-reduce:transition-none",
    on ? "border-transparent bg-graphite text-white dark:bg-white dark:text-graphite" : "border-line bg-surface hover:border-pulse-blue/50 hover:bg-pulse-blue/5",
  );

function Tick() {
  return (
    <span aria-hidden className="absolute -right-1.5 -top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-pulse-blue text-white shadow">
      <Check className="size-3" strokeWidth={3.5} />
    </span>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="text-[12px] font-bold tracking-[0.06em] text-muted">{children}</p>;
}

/** The page's address for a period: the same "?p=… / ?m=… / ?from=&to=" the page reads, plus "by". */
export function periodQuery(p: Pick<VisitorPeriod, "key" | "from" | "to" | "month">, by?: Grouping): string {
  const q = new URLSearchParams();
  if (p.key === "by-month" && p.month) q.set("m", p.month);
  else if (p.key === "custom") {
    q.set("from", p.from);
    q.set("to", p.to);
  } else q.set("p", p.key);
  if (by) q.set("by", by);
  return `?${q.toString()}`;
}

const shortMonth = (m: string) => {
  const [name, year] = monthLabel(m).split(" ");
  return `${name.slice(0, 3)} ${year}`;
};

export function PeriodPicker({ href, period, months, today }: { href: string; period: VisitorPeriod; months: string[]; today: string }) {
  const input = "min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-[15px] outline-none focus:border-pulse-blue focus:ring-4 focus:ring-pulse-blue/15 dark:[color-scheme:dark]";
  return (
    <div className="relative flex flex-col gap-4 overflow-hidden rounded-[24px] border border-line bg-surface p-4 shadow-[0_24px_60px_-44px_rgba(17,24,39,0.45)] sm:p-5">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 rounded-t-[24px] bg-brand-gradient" />

      <nav aria-label="Period" className="flex flex-col gap-2">
        <Label>QUICK PERIODS</Label>
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {PRESETS.map((p) => {
            const on = period.key === p.key;
            const info = PRESET_INFO[p.key];
            return (
              <Link key={p.key} href={`${href}?p=${p.key}`} aria-current={on ? "page" : undefined} className={tile(on)}>
                <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors", on ? "bg-brand-gradient text-white" : "bg-soft text-text")}>{info.icon}</span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[14.5px] font-semibold leading-tight">{p.label}</span>
                  <span className="text-[12px] leading-snug text-muted">{info.hint}</span>
                </span>
                {on && <Tick />}
              </Link>
            );
          })}
        </div>
      </nav>

      <nav aria-label="A whole month" className="flex flex-col gap-2">
        <Label>A WHOLE MONTH</Label>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
          {months.map((m) => {
            const on = period.key === "by-month" && period.month === m;
            return (
              <Link key={m} href={`${href}?m=${m}`} aria-current={on ? "page" : undefined} aria-label={monthLabel(m)} className={chip(on)}>
                {on && <Check aria-hidden className="size-3.5" strokeWidth={3} />}
                {shortMonth(m)}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <form action={href} method="get" className="flex flex-col gap-2" aria-label="Your own dates">
          <Label>YOUR OWN DATES {period.key === "custom" && <span className="ml-1 rounded-full bg-pulse-blue px-2 py-0.5 text-[10.5px] text-white">SHOWING</span>}</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,10rem)_auto]">
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold">
              From
              <input type="date" name="from" defaultValue={period.from} max={today} required className={input} />
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold">
              To
              <input type="date" name="to" defaultValue={period.to} max={today} required className={input} />
            </label>
            <button
              type="submit"
              className="col-span-2 inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 self-end rounded-xl bg-brand-gradient px-4 text-sm font-bold text-white shadow-[0_10px_24px_-14px_rgba(47,107,255,0.9)] outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-4 focus-visible:ring-pulse-blue/30 motion-reduce:transform-none sm:col-span-1"
            >
              Show these dates
            </button>
          </div>
        </form>

        <nav aria-label="Group the chart" className="flex flex-col gap-2">
          <Label>GROUP THE CHART</Label>
          <div className="grid grid-cols-3 gap-1 rounded-2xl bg-soft p-1">
            {GROUPINGS.map((g) => {
              const on = period.by === g.value;
              return (
                <Link
                  key={g.value}
                  href={`${href}${periodQuery(period, g.value)}`}
                  aria-current={on ? "page" : undefined}
                  title={g.hint}
                  className={cn(
                    "inline-flex min-h-10 items-center justify-center rounded-xl px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-4 focus-visible:ring-pulse-blue/30 motion-reduce:transition-none",
                    on ? "bg-brand-gradient text-white shadow-sm" : "text-muted hover:bg-surface hover:text-text",
                  )}
                >
                  {g.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}

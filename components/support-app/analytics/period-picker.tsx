import Link from "next/link";
import { cn } from "@/lib/cn";
import { PRESETS, monthLabel, type Grouping, type VisitorPeriod } from "@/lib/analytics/visitors-shared";

// The period controls of the Analytics page: preset links, a month list and a from/to date picker (plain GET forms, so
// they work before the page's scripts load), and day/week/month grouping. All in one row above the charts.

const GROUPINGS: { value: Grouping; label: string }[] = [
  { value: "day", label: "By day" },
  { value: "week", label: "By week" },
  { value: "month", label: "By month" },
];

const pill = (on: boolean) =>
  cn(
    "inline-flex min-h-10 shrink-0 items-center rounded-full border px-3.5 text-sm font-semibold",
    on ? "border-transparent bg-graphite text-white dark:bg-white dark:text-graphite" : "border-line bg-surface hover:bg-ok-bg",
  );
const input = "min-h-10 rounded-xl border border-line bg-surface px-3 text-sm";

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

export function PeriodPicker({ href, period, months, today }: { href: string; period: VisitorPeriod; months: string[]; today: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-3.5 sm:p-4">
      <nav aria-label="Period" className="flex gap-2 overflow-x-auto pb-0.5">
        {PRESETS.map((p) => (
          <Link key={p.key} href={`${href}?p=${p.key}`} aria-current={period.key === p.key ? "page" : undefined} className={pill(period.key === p.key)}>
            {p.label}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <form action={href} method="get" className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[13px] text-muted">
            Month
            <select name="m" defaultValue={period.month ?? ""} className={input} aria-describedby="month-hint">
              <option value="" disabled>Pick a month</option>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </label>
          <button type="submit" className={cn(input, "cursor-pointer font-semibold hover:bg-ok-bg")}>Show month</button>
          <span id="month-hint" className="sr-only">Shows the whole month you pick</span>
        </form>
        <form action={href} method="get" className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[13px] text-muted">
            From
            <input type="date" name="from" defaultValue={period.from} max={today} required className={input} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-muted">
            To
            <input type="date" name="to" defaultValue={period.to} max={today} required className={input} />
          </label>
          <button type="submit" className={cn(input, "cursor-pointer font-semibold hover:bg-ok-bg")}>Show dates</button>
        </form>
      </div>
      <nav aria-label="Group the chart" className="flex gap-2 overflow-x-auto pb-0.5">
        {GROUPINGS.map((g) => (
          <Link key={g.value} href={`${href}${periodQuery(period, g.value)}`} aria-current={period.by === g.value ? "page" : undefined} className={pill(period.by === g.value)}>
            {g.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { barState, type BarState, type DayBar, type HourBar } from "@/lib/monitor/timeline";
import { downMinutes, seconds } from "./server-math";

// The uptime timeline: one coloured bar per hour (last 24 hours) or per day (last 30 days). Hover, tap or focus a bar
// to read it in words below the strip; a table with the same numbers is there for screen readers.

const COLOR: Record<BarState, string> = { good: "#0ca30c", partial: "#fab219", down: "#d03b3b", none: "var(--bp-line)" };
const WORD: Record<BarState, string> = { good: "Up all the time", partial: "Some trouble", down: "Mostly down", none: "No checks yet" };
const HEIGHT: Record<BarState, string> = { good: "100%", partial: "100%", down: "100%", none: "38%" };

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kigali", hourCycle: "h23", ...opts });
const hourFmt = fmt({ hour: "2-digit", minute: "2-digit" });
const dayFmt = fmt({ weekday: "short", day: "numeric", month: "short" });
const shortDay = fmt({ day: "numeric", month: "short" });

const pctText = (v: number | null) => (v === null ? "–" : v >= 100 ? "100%" : `${v.toFixed(1)}%`);

type Item = { key: string; label: string; state: BarState; detail: string; uptime: number | null };

function hourItems(hours: HourBar[], nowMs: number): Item[] {
  return hours.map((h, i) => {
    const start = new Date(h.start);
    const end = i === hours.length - 1 ? "now" : hourFmt.format(new Date(start.getTime() + 3_600_000));
    const state = barState(h);
    const minutes = i === hours.length - 1 ? Math.max(1, Math.round((nowMs - start.getTime()) / 60_000)) : 60;
    const down = downMinutes(h.uptime, minutes);
    const parts = [
      h.checks === 0 ? "no checks arrived" : `${h.checks} check${h.checks === 1 ? "" : "s"}${h.failed ? `, ${h.failed} failed` : ", all fine"}`,
      h.avgMs !== null ? `pages opened in ${seconds(h.avgMs)} on average` : null,
      h.uptime !== null ? `up ${pctText(h.uptime)}${down ? ` (about ${down} min down)` : ""}` : null,
    ].filter(Boolean);
    return { key: h.start, label: `${hourFmt.format(start)}–${end}`, state, detail: parts.join(" · "), uptime: h.uptime };
  });
}

function dayItems(days: DayBar[], nowMs: number): Item[] {
  return days.map((d, i) => {
    const start = new Date(d.day);
    const state = barState(d);
    const minutes = i === days.length - 1 ? Math.max(1, Math.round((nowMs - start.getTime()) / 60_000)) : 1440;
    const down = downMinutes(d.uptime, minutes);
    const detail = d.uptime === null ? "Monitoring had not started yet" : `Up ${pctText(d.uptime)}${down ? `, about ${down} minutes down` : ", no time down"}`;
    return { key: d.day, label: i === days.length - 1 ? `Today, ${dayFmt.format(start)}` : dayFmt.format(start), state, detail, uptime: d.uptime };
  });
}

export function UptimeTimeline({ hours, days, generatedAt }: { hours: HourBar[]; days: DayBar[]; generatedAt: string }) {
  const [range, setRange] = useState<"hours" | "days">("hours");
  const [active, setActive] = useState<number | null>(null);
  const nowMs = new Date(generatedAt).getTime();
  const items = range === "hours" ? hourItems(hours, nowMs) : dayItems(days, nowMs);
  const shown = items[active ?? items.length - 1];
  const counts = items.reduce<Record<BarState, number>>((a, it) => ({ ...a, [it.state]: a[it.state] + 1 }), { good: 0, partial: 0, down: 0, none: 0 });
  const unit = range === "hours" ? "hours" : "days";
  const summary = `Uptime timeline, last ${range === "hours" ? "24 hours" : "30 days"}: ${counts.good} ${unit} up all the time, ${counts.partial} with some trouble, ${counts.down} mostly down, ${counts.none} without checks.`;
  const first = items[0];
  const ends = range === "hours" ? [first ? hourFmt.format(new Date(first.key)) : "", "12 hours ago", "Now"] : [first ? shortDay.format(new Date(first.key)) : "", "15 days ago", "Today"];

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Timeline length" className="flex flex-wrap gap-2">
        {(
          [
            ["hours", "Last 24 hours", "one bar per hour"],
            ["days", "Last 30 days", "one bar per day"],
          ] as const
        ).map(([value, label, hint]) => {
          const on = range === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                setRange(value);
                setActive(null);
              }}
              className={cn(
                "inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border-2 px-3.5 text-[13px] font-semibold transition-[border-color,background-color,transform] duration-200 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30 motion-reduce:transform-none motion-reduce:transition-none",
                on ? "border-pulse-blue bg-pulse-blue/[0.08] text-text dark:bg-pulse-blue/15" : "border-line bg-surface text-muted hover:border-pulse-blue/40",
              )}
            >
              {label}
              <span className="hidden font-normal text-muted sm:inline">· {hint}</span>
            </button>
          );
        })}
      </div>

      <div role="group" aria-label={summary} className="flex flex-col gap-1.5">
        <div key={range} className="flex h-14 items-end gap-[2px] sm:gap-[3px]" onMouseLeave={() => setActive(null)}>
          {items.map((it, i) => {
            const on = shown?.key === it.key;
            return (
              <button
                key={it.key}
                type="button"
                aria-label={`${it.label}: ${WORD[it.state]}. ${it.detail}`}
                aria-pressed={on}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onClick={() => setActive(i)}
                className="group flex h-full min-w-0 flex-1 cursor-pointer items-end rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse-blue"
              >
                <span
                  className={cn("srv-grow-y block w-full rounded-[4px] transition-[filter,box-shadow] duration-150 group-hover:brightness-110", on && "shadow-[0_0_0_2px_var(--bp-bg-solid),0_0_0_4px_rgba(47,107,255,0.55)]")}
                  style={{ height: HEIGHT[it.state], backgroundColor: COLOR[it.state], animationDelay: `${Math.min(i * 0.018, 0.5)}s` }}
                />
              </button>
            );
          })}
        </div>
        <div aria-hidden className="flex justify-between text-[11.5px] text-muted">
          {ends.map((e) => (
            <span key={e}>{e}</span>
          ))}
        </div>
      </div>

      {shown && (
        <div aria-live="polite" className="flex items-start gap-2.5 rounded-2xl bg-soft px-3.5 py-2.5 text-[13px]">
          <span aria-hidden className="mt-1 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLOR[shown.state] }} />
          <span className="min-w-0">
            <strong className="font-semibold">{shown.label}</strong> · {WORD[shown.state]}
            <span className="block text-muted">{shown.detail}</span>
          </span>
        </div>
      )}

      <ul aria-label="What the colours mean" className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {(["good", "partial", "down", "none"] as const).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[3px]" style={{ backgroundColor: COLOR[s] }} />
            {WORD[s]} ({counts[s]})
          </li>
        ))}
      </ul>

      <div className="sr-only">
      <table>
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">{range === "hours" ? "Hour" : "Day"}</th>
            <th scope="col">State</th>
            <th scope="col">Details</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.key}>
              <td>{it.label}</td>
              <td>{WORD[it.state]}</td>
              <td>{it.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

"use client";

import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Chip } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  DAY_LONG,
  DAY_SHORT,
  DAYS,
  DEFAULT_SCHEDULE,
  MAX_SCHEDULES,
  SLIDER_STOPS,
  closedDays,
  dayRanges,
  sortDays,
  stopOf,
  summarizeHours,
  timeOfStop,
  type DayKey,
  type Schedule,
} from "@/lib/business-info/hours";
import { TimeRangeSlider } from "./time-range-slider";

function Check({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px] text-text">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-5 shrink-0 cursor-pointer accent-pulse-blue" />
      {children}
    </label>
  );
}

function ErrorText({ id, children }: { id?: string; children?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-[13px] font-medium text-danger">
      {children}
    </p>
  );
}

/**
 * Opening hours: sets of days that share one time range (or 24 hours). A day can only be in one set; days in no set
 * are shown as closed. Errors use the keys of validateKnowledge ("openingHours.0.days").
 */
export function HoursEditor({
  schedules,
  errors,
  timezone,
  onChange,
}: {
  schedules: Schedule[];
  errors: Record<string, string>;
  timezone: string;
  onChange: (schedules: Schedule[]) => void;
}) {
  const uid = useId().replace(/:/g, "");
  const summary = summarizeHours(schedules);
  const free = closedDays(schedules);

  function update(i: number, patch: Partial<Schedule>) {
    onChange(schedules.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  function toggleDay(i: number, day: DayKey) {
    const s = schedules[i];
    update(i, { days: s.days.includes(day) ? s.days.filter((d) => d !== day) : sortDays([...s.days, day]) });
  }

  function add() {
    if (!schedules.length) return onChange([{ ...DEFAULT_SCHEDULE, days: [...DEFAULT_SCHEDULE.days] }]);
    onChange([...schedules, { days: free.slice(0, 1), open: "09:00", close: "14:00" }]);
  }

  function setOvernight(i: number, on: boolean) {
    const s = schedules[i];
    const open = stopOf(s.open);
    const close = stopOf(s.close);
    // Keep the pair valid for the new mode: past midnight closes before it opens, a normal day after.
    if (on && close >= open) update(i, { overnight: true, close: timeOfStop(Math.min(open - 1, 8)) });
    else if (!on && close <= open) update(i, { overnight: false, close: timeOfStop(SLIDER_STOPS) });
    else update(i, { overnight: on });
  }

  return (
    <div className="flex flex-col gap-3">
      {schedules.map((s, i) => {
        const taken = new Set(schedules.flatMap((o, j) => (j === i ? [] : o.days)));
        const dayError = errors[`openingHours.${i}.days`];
        const timeError = errors[`openingHours.${i}.close`] ?? errors[`openingHours.${i}.open`];
        const name = s.days.length ? dayRanges(s.days) : `hours ${i + 1}`;
        return (
          <fieldset key={i} className="glass flex flex-col gap-3 rounded-2xl p-4">
            <legend className="sr-only">Opening hours {i + 1}</legend>
            <div className="flex flex-col gap-2">
              <span id={`${uid}-days-${i}`} className="text-[13px] font-medium text-muted">
                Days
              </span>
              <div role="group" aria-labelledby={`${uid}-days-${i}`} aria-describedby={dayError ? `${uid}-days-err-${i}` : undefined} className="flex flex-wrap gap-2">
                {DAYS.map((d) => {
                  const used = taken.has(d);
                  return (
                    <Chip
                      key={d}
                      selected={s.days.includes(d)}
                      disabled={used}
                      aria-label={used ? `${DAY_LONG[d]} (already in other hours)` : DAY_LONG[d]}
                      title={used ? `${DAY_LONG[d]} is already in other hours` : undefined}
                      onClick={() => toggleDay(i, d)}
                      className={cn("min-w-11 justify-center px-3 py-2.5 text-[14px]", used && "cursor-not-allowed opacity-45 hover:translate-y-0")}
                    >
                      {DAY_SHORT[d]}
                    </Chip>
                  );
                })}
              </div>
              {taken.size > 0 && !dayError && <p className="text-[13px] text-muted">Greyed-out days are already in other hours. Each day can be in one set only.</p>}
              <ErrorText id={`${uid}-days-err-${i}`}>{dayError}</ErrorText>
            </div>

            <Check checked={!!s.allDay} onChange={(allDay) => update(i, { allDay, overnight: false, ...(allDay ? {} : { open: "08:00", close: "18:00" }) })}>
              Open 24 hours
            </Check>

            {!s.allDay && (
              <div className="flex flex-col gap-2">
                <p className="text-[15px] font-semibold tabular-nums" aria-live="polite">
                  {s.open} – {s.close}
                  {s.overnight && <span className="ml-1 text-[13px] font-normal text-muted">(next day)</span>}
                </p>
                <TimeRangeSlider
                  start={stopOf(s.open)}
                  end={stopOf(s.close)}
                  allowCross={!!s.overnight}
                  label={`Opening hours for ${name}`}
                  invalid={!!timeError}
                  describedBy={timeError ? `${uid}-time-err-${i}` : undefined}
                  onChange={(a, b) => update(i, { open: timeOfStop(a), close: timeOfStop(b) })}
                />
                <Check checked={!!s.overnight} onChange={(on) => setOvernight(i, on)}>
                  Closes after midnight
                </Check>
                <ErrorText id={`${uid}-time-err-${i}`}>{timeError}</ErrorText>
              </div>
            )}

            <Button variant="outline" size="sm" className="self-start" leading={<Trash2 aria-hidden className="size-4" />} onClick={() => onChange(schedules.filter((_, j) => j !== i))}>
              Remove these hours
            </Button>
          </fieldset>
        );
      })}

      <ErrorText>{errors["openingHours.form"]}</ErrorText>

      {schedules.length > 0 && free.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[14px]">
          <span className="text-muted">Closed:</span>
          {free.map((d) => (
            <span key={d} className="rounded-full bg-soft px-3 py-1 text-[13px] font-medium">
              {DAY_SHORT[d]}
            </span>
          ))}
        </div>
      )}

      {summary && (
        <p className="rounded-xl bg-soft px-3 py-2 text-[14px]">
          <span className="text-muted">Customers see: </span>
          {summary}
          <span className="block text-[13px] text-muted">Times are in your business time zone ({timezone}).</span>
        </p>
      )}

      {schedules.length === 0 ? (
        // Nothing yet: one obvious button that fills in Monday to Friday, 08:00 to 18:00, ready to adjust.
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line p-4">
          <p className="text-[14px] text-muted">No opening hours yet. Add them, then change the days and times to yours.</p>
          <Button size="sm" leading={<Plus aria-hidden className="size-4" />} onClick={add}>
            Add hours
          </Button>
        </div>
      ) : (
        schedules.length < MAX_SCHEDULES &&
        free.length > 0 && (
          <Button variant="ghost" size="sm" className="self-start" leading={<Plus aria-hidden className="size-4" />} onClick={add}>
            Add hours
          </Button>
        )
      )}
    </div>
  );
}

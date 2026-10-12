"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/cn";
import { SLIDER_STOPS, timeOfStop } from "@/lib/business-info/hours";

type Thumb = "start" | "end";

/**
 * Two-handle time slider from 00:00 to 23:59 in 15 minute steps. Each handle is a focusable `role="slider"`:
 * arrows move 15 minutes, Page Up/Down an hour, Home/End to the ends. With `allowCross` (hours past midnight)
 * the closing handle may sit before the opening one.
 */
export function TimeRangeSlider({
  start,
  end,
  onChange,
  allowCross = false,
  label,
  invalid,
  describedBy,
}: {
  /** Slider stops, 0..SLIDER_STOPS (lib/business-info/hours.ts stopOf/timeOfStop). */
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  allowCross?: boolean;
  /** Names the pair for screen readers: "Opening hours for Mon–Fri". */
  label: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Thumb | null>(null);
  const pct = (stop: number) => (stop / SLIDER_STOPS) * 100;

  function set(thumb: Thumb, stop: number) {
    const s = Math.max(0, Math.min(SLIDER_STOPS, Math.round(stop)));
    if (thumb === "start") onChange(allowCross ? s : Math.min(s, end - 1), end);
    else onChange(start, allowCross ? s : Math.max(s, start + 1));
  }

  function stopAt(clientX: number): number {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return ((clientX - rect.left) / rect.width) * SLIDER_STOPS;
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const stop = stopAt(e.clientX);
    const thumb: Thumb = Math.abs(stop - start) <= Math.abs(stop - end) ? "start" : "end";
    setActive(thumb);
    e.currentTarget.setPointerCapture(e.pointerId);
    set(thumb, stop);
    (e.currentTarget.querySelector(`[data-thumb="${thumb}"]`) as HTMLElement | null)?.focus();
    e.preventDefault();
  }

  function onKeyDown(thumb: Thumb, e: KeyboardEvent<HTMLDivElement>) {
    const value = thumb === "start" ? start : end;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -4, PageUp: 4 };
    if (e.key in step) set(thumb, value + step[e.key]);
    else if (e.key === "Home") set(thumb, 0);
    else if (e.key === "End") set(thumb, SLIDER_STOPS);
    else return;
    e.preventDefault();
  }

  const crossed = start > end;
  const bars = crossed ? [[start, SLIDER_STOPS], [0, end]] : [[start, end]];

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={track}
        role="group"
        aria-label={label}
        className="relative h-11 cursor-pointer touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={(e) => active && set(active, stopAt(e.clientX))}
        onPointerUp={() => setActive(null)}
        onPointerCancel={() => setActive(null)}
      >
        <div aria-hidden className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-soft" />
        {bars.map(([a, b]) => (
          <div key={a} aria-hidden className={cn("absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full", invalid ? "bg-danger" : "bg-brand-gradient")} style={{ left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%` }} />
        ))}
        {(["start", "end"] as const).map((thumb) => {
          const value = thumb === "start" ? start : end;
          return (
            <div
              key={thumb}
              data-thumb={thumb}
              role="slider"
              tabIndex={0}
              aria-label={thumb === "start" ? "Opens at" : "Closes at"}
              aria-valuemin={0}
              aria-valuemax={SLIDER_STOPS}
              aria-valuenow={value}
              aria-valuetext={timeOfStop(value)}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              onKeyDown={(e) => onKeyDown(thumb, e)}
              className="group absolute top-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none"
              style={{ left: `${pct(value)}%` }}
            >
              <span
                aria-hidden
                className="size-6 rounded-full border-2 border-pulse-blue bg-surface shadow-glass transition-transform duration-150 group-focus-visible:ring-4 group-focus-visible:ring-pulse-blue/30 group-active:scale-110 motion-reduce:transition-none"
              />
            </div>
          );
        })}
      </div>
      <div aria-hidden className="flex justify-between text-[12px] text-muted">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23:59</span>
      </div>
    </div>
  );
}

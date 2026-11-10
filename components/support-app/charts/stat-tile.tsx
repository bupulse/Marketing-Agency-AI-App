"use client";

import { useRef, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { linePath, layoutPoints } from "./chart-math";
import { useReveal } from "./use-reveal";

// A big number with its plain-English meaning: the label, the value (counting up when it comes into view), a change
// against the period before (an arrow and words, never colour alone; green when the change is good news), a one-line
// explanation, and an optional sparkline of the trend.

export type NumberFormat = "int" | "pct" | "seconds" | "ms" | "text";

const fmtDuration = (sec: number) => {
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
};

/** The value as text in a format (a client component cannot be handed a formatting function). */
export function formatValue(v: number | null, format: NumberFormat): string {
  if (v == null || !Number.isFinite(v)) return "–";
  switch (format) {
    case "pct":
      return `${Math.round(v)}%`;
    case "seconds":
      return fmtDuration(v);
    case "ms":
      return fmtDuration(v / 1000);
    default:
      return Math.round(v).toLocaleString("en-GB");
  }
}

/** A number that counts up from 0 when it scrolls into view (just the number for reduced motion and before scripts). */
export function CountUp({ value, format = "int", className }: { value: number | null; format?: NumberFormat; className?: string }) {
  const [shown, setShown] = useState<number | null>(null);
  const frame = useRef(0);
  const ref = useReveal<HTMLSpanElement>(() => {
    if (value == null || value <= 0) return;
    const start = performance.now();
    const dur = 900;
    cancelAnimationFrame(frame.current);
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      const eased = 1 - (1 - k) ** 3;
      if (k < 1) {
        setShown(value * eased);
        frame.current = requestAnimationFrame(tick);
      } else setShown(null);
    };
    frame.current = requestAnimationFrame(tick);
  }, String(value));
  return (
    <span ref={ref} className={className}>
      {/* Screen readers get the final value at once, not every step. */}
      <span aria-hidden>{formatValue(shown ?? value, format)}</span>
      <span className="sr-only">{formatValue(value, format)}</span>
    </span>
  );
}

/** A tiny trend line in the tile: the period in a soft blue, the last point marked. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 34;
  const max = Math.max(1, ...values);
  const pts = layoutPoints(values, w, h, max, { left: 2, right: 4, top: 4, bottom: 3 });
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[34px] w-[120px] overflow-visible" role="img" aria-label={label}>
      <path d={`${linePath(pts)}L${last.x},${h}L${pts[0].x},${h}Z`} fill="var(--viz-1)" fillOpacity={0.14} className="bp-fade" />
      <path d={linePath(pts)} pathLength={1} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="bp-line" />
      <circle cx={last.x} cy={last.y} r={3.5} fill="var(--viz-1)" stroke="var(--viz-surface)" strokeWidth={2} className="bp-pop" />
    </svg>
  );
}

export type Delta = {
  /** The change: percent for counts, percentage points for rates. */
  value: number;
  unit: "%" | "pts";
  /** Whether a rise is good news (more visitors) or bad (a slower reply). */
  upIsGood: boolean;
  /** "vs the 7 days before". */
  against: string;
};

export function DeltaChip({ delta }: { delta: Delta }) {
  const flat = delta.value === 0;
  const up = delta.value > 0;
  const good = flat ? null : up === delta.upIsGood;
  const Icon = flat ? ArrowRight : up ? ArrowUpRight : ArrowDownRight;
  const amount = delta.unit === "%" ? `${Math.abs(delta.value)}%` : `${Math.abs(delta.value)} point${Math.abs(delta.value) === 1 ? "" : "s"}`;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[12.5px]">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-bold",
          good === null ? "bg-soft text-muted" : good ? "bg-[#0f7a4a]/10 text-[#0f7a4a] dark:bg-[#5fd9a0]/12 dark:text-[#5fd9a0]" : "bg-[#c81e3a]/10 text-[#c81e3a] dark:bg-[#ff7a8f]/12 dark:text-[#ff7a8f]",
        )}
      >
        <Icon aria-hidden className="size-3.5" strokeWidth={2.6} />
        {flat ? "Same" : `${up ? "Up" : "Down"} ${amount}`}
      </span>
      <span className="text-muted">{delta.against}</span>
    </span>
  );
}

export function StatTile({
  label,
  value,
  format = "int",
  text,
  icon,
  tone = "blue",
  explain,
  delta,
  trend,
  footer,
  index = 0,
}: {
  label: string;
  value: number | null;
  format?: NumberFormat;
  /** Shown instead of the number (for values that are not numbers). */
  text?: string;
  icon: ReactNode;
  tone?: "blue" | "violet" | "green" | "orange" | "pink";
  explain: ReactNode;
  delta?: Delta | null;
  trend?: { values: number[]; label: string } | null;
  footer?: ReactNode;
  index?: number;
}) {
  const badge = {
    blue: "bg-[linear-gradient(135deg,#2f6bff,#5b8cff)]",
    violet: "bg-[linear-gradient(135deg,#5b4dff,#9b5cff)]",
    green: "bg-[linear-gradient(135deg,#0f9f6e,#34d399)]",
    orange: "bg-[linear-gradient(135deg,#f97316,#fbbf24)]",
    pink: "bg-[linear-gradient(135deg,#db2777,#f472b6)]",
  }[tone];
  const ref = useReveal();
  return (
    <div ref={ref} className="flex min-w-0">
    <div
      style={{ ["--i" as string]: index }}
      className="bp-rise group relative flex w-full min-w-0 flex-col gap-2 overflow-hidden rounded-[22px] border border-line bg-surface p-4 shadow-[0_18px_40px_-34px_rgba(17,24,39,0.5)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_44px_-30px_rgba(47,107,255,0.45)] motion-reduce:transform-none motion-reduce:transition-none sm:p-5"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-white shadow-[0_8px_18px_-10px_rgba(47,107,255,0.8)] [&>svg]:size-[18px]", badge)}>
            {icon}
          </span>
          <span className="text-[13.5px] font-semibold leading-tight">{label}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <span className="text-[30px] font-bold leading-none tracking-[-0.02em] sm:text-[34px]">{text ?? <CountUp value={value} format={format} />}</span>
        {trend && <Sparkline values={trend.values} label={trend.label} />}
      </div>
      {delta && <DeltaChip delta={delta} />}
      <p className="text-[12.5px] leading-snug text-muted">{explain}</p>
      {footer}
    </div>
    </div>
  );
}

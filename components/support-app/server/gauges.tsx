import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { LEVEL_COLOR, LEVEL_WORD, type Level } from "./server-math";

// Hand-made SVG gauges for the Server page: a ring that fills, a thin bar, and the status pill (icon + word, so colour
// never carries the meaning alone).

const ICON = { good: CheckCircle2, warn: AlertTriangle, bad: XCircle, none: CircleDashed } as const;

/** The status as an icon and a word on a soft tint of its colour. */
export function LevelPill({ level, children, className }: { level: Level; children?: ReactNode; className?: string }) {
  const Icon = ICON[level];
  return (
    <span
      className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold sm:text-[12px]", className)}
      style={{ backgroundColor: `color-mix(in srgb, ${LEVEL_COLOR[level]} 15%, transparent)` }}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" style={{ color: LEVEL_COLOR[level] }} />
      <span>{children ?? LEVEL_WORD[level]}</span>
    </span>
  );
}

/** A ring that fills to `value` (0-1), the reading in the middle. The label and hint sit under it as text. */
export function Ring({
  value,
  level,
  center,
  unit,
  label,
  hint,
  ariaLabel,
  delay = 0,
}: {
  value: number | null;
  level: Level;
  center: string;
  unit?: string;
  label: string;
  hint?: ReactNode;
  ariaLabel: string;
  delay?: number;
}) {
  const v = value === null ? 0 : Math.min(1, Math.max(0, value));
  const color = LEVEL_COLOR[level];
  return (
    <figure className="flex min-w-0 flex-col items-center gap-2 text-center">
      <div className="relative size-[104px] sm:size-[116px]">
        <svg viewBox="0 0 120 120" role="img" aria-label={ariaLabel} className="size-full -rotate-90">
          <circle cx="60" cy="60" r="50" fill="none" strokeWidth="11" stroke={color} strokeOpacity={0.16} />
          {value !== null && v > 0 && (
            <circle
              cx="60"
              cy="60"
              r="50"
              fill="none"
              strokeWidth="11"
              strokeLinecap="round"
              stroke={color}
              pathLength={100}
              strokeDasharray={`${Math.max(1.5, v * 100)} 100`}
              className="srv-ring"
              style={{ animationDelay: `${delay}s` }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[20px] font-bold leading-none tabular-nums tracking-[-0.02em] sm:text-[22px]">{center}</span>
          {unit && <span className="mt-1 text-[11px] font-medium text-muted">{unit}</span>}
        </div>
      </div>
      <figcaption className="flex flex-col items-center gap-1">
        <span className="text-[13.5px] font-semibold">{label}</span>
        <LevelPill level={level} />
        {hint && <span className="max-w-[220px] text-[12px] leading-snug text-muted">{hint}</span>}
      </figcaption>
    </figure>
  );
}

/** A thin horizontal bar (0-1) in the status colour, on a tint of the same colour. */
export function Bar({ value, level, label, delay = 0, className }: { value: number | null; level: Level; label: string; delay?: number; className?: string }) {
  const v = value === null ? 0 : Math.min(1, Math.max(0, value));
  return (
    <div
      className={cn("h-2.5 overflow-hidden rounded-full", className)}
      style={{ backgroundColor: `color-mix(in srgb, ${LEVEL_COLOR[level]} 16%, transparent)` }}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(v * 100)}
    >
      {value !== null && <div className="srv-grow-x h-full rounded-full" style={{ width: `${Math.max(2, v * 100)}%`, backgroundColor: LEVEL_COLOR[level], animationDelay: `${delay}s` }} />}
    </div>
  );
}

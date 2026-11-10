"use client";

import { useReveal } from "./use-reveal";

// A share out of 100 as a ring that fills when it scrolls into view, the percentage in the middle. The unfilled track is
// a faint step of the same colour, so the whole ring reads as one measure. "–" when there is nothing to measure yet.

export function RingGauge({ value, color = "var(--viz-1)", label, size = 132 }: { value: number | null; color?: string; label: string; size?: number }) {
  const ref = useReveal<HTMLDivElement>();
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const len = (v / 100) * c;
  return (
    <div ref={ref} className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${value == null ? "not measured yet" : `${Math.round(v)}%`}`}>
      <svg viewBox={`0 0 ${size} ${size}`} className="size-full -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeOpacity={0.14} strokeWidth={stroke} />
        {v > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${len} ${c}`}
            className="bp-sweep"
            style={{ ["--len" as string]: len, ["--c" as string]: c }}
          />
        )}
      </svg>
      <span aria-hidden className="absolute inset-0 flex items-center justify-center text-[26px] font-bold tracking-[-0.02em]">
        {value == null ? "–" : `${Math.round(v)}%`}
      </span>
    </div>
  );
}

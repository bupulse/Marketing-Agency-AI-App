"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { sharesOf } from "./chart-math";
import { useReveal } from "./use-reveal";

// One whole split into a few parts, read at a glance: a tall bar of blocks (each block's share printed on it when it
// fits), and a legend under it with each part's icon, name, number and share. Blocks grow in from the left in turn.

export type Segment = { key: string; label: string; icon?: ReactNode; value: number; color: string; dark?: boolean };

const num = (v: number) => v.toLocaleString("en-GB");

export function SegmentBar({ parts, one, many, ariaLabel }: { parts: Segment[]; one: string; many: string; ariaLabel: string }) {
  const [active, setActive] = useState<string | null>(null);
  const ref = useReveal<HTMLDivElement>();
  const shares = sharesOf(parts.map((p) => p.value));
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total === 0) return <p className="rounded-2xl bg-soft px-4 py-5 text-center text-sm text-muted">No visits in this period yet.</p>;
  return (
    <div ref={ref} className="flex flex-col gap-4">
      <div role="img" aria-label={`${ariaLabel}: ${parts.map((p, i) => `${p.label} ${shares[i]}% (${num(p.value)})`).join(", ")}`} className="flex h-11 gap-[3px] overflow-hidden rounded-xl">
        {parts.map((p, i) =>
          p.value > 0 ? (
            <span
              key={p.key}
              onPointerEnter={() => setActive(p.key)}
              onPointerLeave={() => setActive(null)}
              className={cn("bp-grow-x flex h-full min-w-[6px] items-center overflow-hidden rounded-[6px] transition-opacity", shares[i] >= 12 && "px-2.5", " motion-reduce:transition-none", active && active !== p.key && "opacity-40")}
              style={{ flexGrow: p.value, flexBasis: 0, background: p.color, ["--i" as string]: i }}
            >
              {shares[i] >= 12 && <span className={cn("text-[13px] font-bold", p.dark ? "text-[#0b0b0b]" : "text-white")}>{shares[i]}%</span>}
            </span>
          ) : null,
        )}
      </div>
      <ul className="grid grid-cols-3 gap-2">
        {parts.map((p, i) => (
          <li
            key={p.key}
            onPointerEnter={() => setActive(p.key)}
            onPointerLeave={() => setActive(null)}
            className={cn("flex min-w-0 flex-col items-start gap-2 rounded-2xl border border-line p-2.5 transition-colors sm:p-3 motion-reduce:transition-none", active === p.key && "border-pulse-blue/50 bg-pulse-blue/[0.05]")}
          >
            <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-white [&>svg]:size-5" style={{ background: p.color }}>
              {p.icon}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[14px] font-semibold">{p.label}</span>
              <strong className="text-[20px] leading-tight">{shares[i]}%</strong>
              <span className="text-[12px] text-muted tabular-nums">
                {num(p.value)} {p.value === 1 ? one : many}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

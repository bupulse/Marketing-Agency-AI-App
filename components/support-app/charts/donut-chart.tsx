"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { donutArcs, sharesOf } from "./chart-math";
import { useReveal } from "./use-reveal";

// One whole split into a few parts (at most six plus "Other"): a ring whose segments sweep round in turn when it
// scrolls into view, the total in the middle, and a legend that lists every part with its logo, number and share (the
// legend carries the numbers, so the colours never have to). Hovering or focusing a part, on the ring or in the legend,
// lights it up and puts its numbers in the middle.

export type DonutPart = { key: string; label: string; icon?: ReactNode; value: number; color: string; hint?: string };

const num = (v: number) => v.toLocaleString("en-GB");

export function DonutChart({ parts, total, one, many, centerLabel, ariaLabel }: { parts: DonutPart[]; total?: number; one: string; many: string; centerLabel: string; ariaLabel: string }) {
  const [active, setActive] = useState<string | null>(null);
  const ref = useReveal<HTMLDivElement>();
  const titleId = useId();
  const size = 200;
  const stroke = 26;
  const r = (size - stroke) / 2 - 4;
  const c = 2 * Math.PI * r;
  const values = parts.map((p) => p.value);
  const sum = total ?? values.reduce((s, v) => s + v, 0);
  const arcs = donutArcs(values, c, 3);
  const shares = sharesOf(values);
  const on = parts.find((p) => p.key === active) ?? null;
  const onShare = on ? shares[parts.indexOf(on)] : null;

  return (
    <div ref={ref} className="grid items-center gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
      <figure className="relative mx-auto size-[200px] shrink-0" aria-labelledby={titleId}>
        <figcaption id={titleId} className="sr-only">
          {ariaLabel}: {parts.map((p, i) => `${p.label} ${num(p.value)} (${shares[i]}%)`).join(", ")}
        </figcaption>
        <svg viewBox={`0 0 ${size} ${size}`} className="size-full -rotate-90" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--viz-grid)" strokeWidth={stroke} />
          {parts.map((p, i) =>
            p.value > 0 ? (
              <circle
                key={p.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={p.color}
                strokeWidth={active === p.key ? stroke + 6 : stroke}
                strokeDasharray={`${arcs[i].length} ${c}`}
                strokeDashoffset={-arcs[i].offset}
                opacity={active && active !== p.key ? 0.35 : 1}
                className="bp-sweep cursor-pointer transition-[stroke-width,opacity] duration-200 motion-reduce:transition-none"
                style={{ ["--len" as string]: arcs[i].length, ["--c" as string]: c, ["--i" as string]: i }}
                onPointerEnter={() => setActive(p.key)}
                onPointerLeave={() => setActive(null)}
              />
            ) : null,
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center" aria-hidden>
          {on ? (
            <>
              <span className="text-[28px] font-bold leading-none tracking-[-0.02em]">{onShare}%</span>
              <span className="mt-1 line-clamp-2 text-[12px] font-semibold">{on.label}</span>
              <span className="text-[11.5px] text-muted">
                {num(on.value)} {on.value === 1 ? one : many}
              </span>
            </>
          ) : (
            <>
              <span className="text-[30px] font-bold leading-none tracking-[-0.02em]">{num(sum)}</span>
              <span className="mt-1 text-[12px] text-muted">{centerLabel}</span>
            </>
          )}
        </div>
      </figure>

      <ul className="flex min-w-0 flex-col gap-1" aria-label={`${ariaLabel}, as a list`}>
        {parts.map((p, i) => (
          <li key={p.key}>
            <button
              type="button"
              onPointerEnter={() => setActive(p.key)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(p.key)}
              onBlur={() => setActive(null)}
              aria-label={`${p.label}: ${num(p.value)} ${p.value === 1 ? one : many}, ${shares[i]}%`}
              className={cn(
                "flex w-full cursor-default items-center gap-2.5 rounded-xl px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-4 focus-visible:ring-pulse-blue/30 motion-reduce:transition-none",
                active === p.key ? "bg-pulse-blue/[0.07]" : "hover:bg-pulse-blue/[0.04]",
              )}
            >
              <span aria-hidden className="h-7 w-1.5 shrink-0 rounded-full" style={{ background: p.color }} />
              {p.icon && <span className="inline-flex size-7 shrink-0 items-center justify-center">{p.icon}</span>}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14px] font-semibold">{p.label}</span>
                {p.hint && <span className="text-[12px] leading-snug text-muted">{p.hint}</span>}
              </span>
              <span className="shrink-0 text-right tabular-nums">
                <strong className="text-[14px]">{shares[i]}%</strong>
                <span className="block text-[12px] text-muted">{num(p.value)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

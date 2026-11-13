"use client";

import { useRef, type ReactNode } from "react";
import { Check, type LucideIcon } from "lucide-react";
import { IconBadge } from "@/components/admin/kit/icon-badge";
import type { KitTone } from "@/components/admin/kit/tones";
import { cn } from "@/lib/cn";

export type BChoiceOption<V extends string = string> = { value: V; label: string; hint?: ReactNode; icon?: LucideIcon; tone?: KitTone; disabled?: boolean };

/**
 * Multiple choice for a form kept in React state (the client dashboard's forms): tap a chip (or a bigger `tiles` card
 * with a hint) instead of opening a select. A real radio group for screen readers: the arrow keys move and choose, Tab
 * enters and leaves. The chosen one has a ring and a tick that pops in (still under reduced motion).
 * `allowNone` lets a second tap on the chosen one clear it (an optional answer).
 */
export function BChoice<V extends string>({
  legend,
  options,
  value,
  onChange,
  tiles = false,
  allowNone = false,
  hint,
  error,
  hideLegend = false,
  required = false,
  className,
}: {
  legend: string;
  options: readonly BChoiceOption<V>[];
  value: V | "";
  onChange: (value: V | "") => void;
  tiles?: boolean;
  allowNone?: boolean;
  hint?: ReactNode;
  error?: string;
  hideLegend?: boolean;
  required?: boolean;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const chosenIndex = options.findIndex((o) => o.value === value);
  const id = `bchoice-${legend.replace(/\W+/g, "-").toLowerCase()}`;

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const move = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (move === undefined || enabled.length === 0) return;
    e.preventDefault();
    const at = enabled.indexOf(index);
    const next = enabled[(at + move + enabled.length) % enabled.length];
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <span id={`${id}-label`} className={cn("text-[14px] font-semibold", hideLegend && "sr-only")}>
        {legend}
        {required && (
          <span aria-hidden className="ml-0.5 text-pulse-violet">
            *
          </span>
        )}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        aria-invalid={error ? true : undefined}
        className={cn(tiles ? "grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-3" : "flex flex-wrap gap-2")}
      >
        {options.map((o, i) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={o.disabled}
              tabIndex={on || (chosenIndex === -1 && i === enabled[0]) ? 0 : -1}
              onClick={() => onChange(on && allowNone ? "" : o.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "group relative cursor-pointer select-none border-2 text-left transition-[border-color,background-color,transform,box-shadow] duration-200 motion-reduce:transform-none motion-reduce:transition-none",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30 disabled:cursor-not-allowed disabled:opacity-55",
                on ? "border-pulse-blue bg-pulse-blue/[0.07] shadow-[0_10px_24px_-18px_rgba(47,107,255,0.8)] dark:bg-pulse-blue/15" : "border-line bg-surface hover:border-pulse-blue/40 dark:bg-white/[0.03]",
                tiles ? "flex min-h-11 min-w-0 items-start gap-2.5 rounded-2xl p-3 hover:-translate-y-0.5" : "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold",
              )}
            >
              {tiles ? (
                <>
                  {o.icon && <IconBadge icon={o.icon} tone={o.tone ?? "blue"} size="sm" />}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 pr-6">
                    <span className="text-[14px] font-semibold leading-snug">{o.label}</span>
                    {o.hint && <span className="text-[12.5px] leading-snug text-muted">{o.hint}</span>}
                  </span>
                  {on && (
                    <span aria-hidden className="kit-pop absolute right-2.5 top-2.5 inline-flex size-5 items-center justify-center rounded-full bg-pulse-blue text-white">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  )}
                </>
              ) : (
                <>
                  {on ? <Check aria-hidden className="kit-pop size-3.5 text-pulse-blue" strokeWidth={3} /> : o.icon ? <o.icon aria-hidden className="size-3.5 text-muted" /> : null}
                  {o.label}
                </>
              )}
            </button>
          );
        })}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-[13px] text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

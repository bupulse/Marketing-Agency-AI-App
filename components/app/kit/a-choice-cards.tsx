"use client";

/**
 * Choice cards and chips for client-side forms (state kept in React, not posted by a <form>): the client dashboard's
 * "tap to choose" pieces, in the look of the admin kit (components/admin/kit). A real radio group (role="radiogroup",
 * arrow keys move and choose), the chosen card has a ring and a tick that pops in; hover lifts a card. Every animation
 * is off under prefers-reduced-motion (the tick's pop uses KitStyles' `kit-pop`, which the app shell renders).
 *
 *   ChoiceCards  bigger cards with an icon and a plain line each (how to make a post, which design)
 *   ChoiceChips  small round chips for short answers (1 / 2 / 3, Auto / With price / No price)
 */

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Check, type LucideIcon } from "lucide-react";
import { IconBadge } from "@/components/admin/kit/icon-badge";
import type { KitTone } from "@/components/admin/kit/tones";
import { cn } from "@/lib/cn";

export type ChoiceItem<T extends string> = { value: T; label: ReactNode; hint?: ReactNode; icon?: LucideIcon; tone?: KitTone; disabled?: boolean };

const RING = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30";

/** Arrow keys move to the next enabled option and choose it, like native radio buttons. */
function useRadioKeys<T extends string>(items: ChoiceItem<T>[], value: T, onChange: (v: T) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const enabled = items.filter((i) => !i.disabled);
    if (!enabled.length) return;
    const at = Math.max(0, enabled.findIndex((i) => i.value === value));
    const next = enabled[(at + step + enabled.length) % enabled.length];
    onChange(next.value);
    ref.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
  };
  return { ref, onKeyDown };
}

export function ChoiceCards<T extends string>({
  label,
  items,
  value,
  onChange,
  columns = 2,
  className,
}: {
  /** What is being chosen, read out to screen readers ("How to make it"). */
  label: string;
  items: ChoiceItem<T>[];
  value: T;
  onChange: (v: T) => void;
  /** Cards a row from a medium width up (one a row on a narrow phone). */
  columns?: 2 | 3;
  className?: string;
}) {
  const keys = useRadioKeys(items, value, onChange);
  return (
    <div ref={keys.ref} role="radiogroup" aria-label={label} onKeyDown={keys.onKeyDown} className={cn("grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2", columns === 3 && "lg:grid-cols-3", className)}>
      {items.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-value={o.value}
            tabIndex={on || (!items.some((i) => i.value === value) && o === items[0]) ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative flex min-h-11 w-full min-w-0 items-start gap-3 rounded-2xl border-2 p-3.5 text-left text-text transition-[border-color,background-color,transform,box-shadow] duration-200 motion-reduce:transform-none motion-reduce:transition-none",
              "disabled:cursor-not-allowed disabled:opacity-50",
              RING,
              on
                ? "border-pulse-blue bg-pulse-blue/[0.07] shadow-[0_14px_30px_-24px_rgba(47,107,255,0.8)] dark:bg-pulse-blue/15"
                : "border-line bg-surface hover:-translate-y-0.5 hover:border-pulse-blue/40 dark:bg-white/[0.03]",
            )}
          >
            {o.icon && <IconBadge icon={o.icon} tone={o.tone ?? "blue"} size="sm" />}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 pr-6">
              <span className="text-[15px] font-semibold leading-snug">{o.label}</span>
              {o.hint && <span className="text-[13px] leading-snug text-muted">{o.hint}</span>}
            </span>
            {on && (
              <span aria-hidden className="kit-pop absolute right-3 top-3 inline-flex size-5 items-center justify-center rounded-full bg-pulse-blue text-white">
                <Check className="size-3" strokeWidth={3} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ChoiceChips<T extends string>({
  label,
  items,
  value,
  onChange,
  hint,
  showLabel = true,
  className,
}: {
  /** What is being chosen ("Posts per app"); shown above the chips unless `showLabel` is false. */
  label: string;
  items: ChoiceItem<T>[];
  value: T;
  onChange: (v: T) => void;
  /** One plain line under the chips. */
  hint?: ReactNode;
  showLabel?: boolean;
  className?: string;
}) {
  const keys = useRadioKeys(items, value, onChange);
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      {showLabel && <p className="text-[14px] font-medium">{label}</p>}
      <div ref={keys.ref} role="radiogroup" aria-label={label} onKeyDown={keys.onKeyDown} className="flex flex-wrap gap-2">
        {items.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              data-value={o.value}
              tabIndex={on || (!items.some((i) => i.value === value) && o === items[0]) ? 0 : -1}
              disabled={o.disabled}
              onClick={() => onChange(o.value)}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 px-3.5 text-[14px] font-semibold transition-[border-color,background-color,color,transform] duration-200 motion-reduce:transform-none motion-reduce:transition-none",
                "disabled:cursor-not-allowed disabled:opacity-50",
                RING,
                on ? "border-pulse-blue bg-pulse-blue/[0.08] text-text dark:bg-pulse-blue/15" : "border-line bg-surface text-muted hover:-translate-y-px hover:border-pulse-blue/40 hover:text-text dark:bg-white/[0.03]",
              )}
            >
              {on ? <Check aria-hidden className="kit-pop size-3.5 text-pulse-blue" strokeWidth={3} /> : o.icon ? <o.icon aria-hidden className="size-3.5" /> : null}
              {o.label}
            </button>
          );
        })}
      </div>
      {hint && <p className="text-[13px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

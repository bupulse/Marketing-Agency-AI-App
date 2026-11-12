"use client";

// Choices as cards and chips for the client dashboard's own (browser) forms: the "multiple choice" look the owner asked
// for (12 November 2026: "use cards to choose, like multiple choice ... have fewer places to write things"). They are
// controlled (value + onChange), so a page's existing state and server action stay as they are. Server forms use the
// admin kit's FormChips / RadioChips instead. The chosen one has a ring, a tick that pops in and (cards) a gradient icon;
// every movement is off under prefers-reduced-motion.

import { Check, type LucideIcon } from "lucide-react";
import { isValidElement, type KeyboardEvent, type ReactNode } from "react";
import { KitStyles } from "@/components/admin/kit/kit-styles";
import { cn } from "@/lib/cn";

export type CChoice<T extends string> = {
  value: T;
  label: ReactNode;
  /** One short line under the label (cards only). */
  hint?: ReactNode;
  icon?: LucideIcon | ReactNode;
  /** A small number after the label (chips). */
  count?: number;
  disabled?: boolean;
};

const MOTION = "transition-[transform,border-color,background-color,box-shadow] duration-200 motion-reduce:transform-none motion-reduce:transition-none";
const FOCUS = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30";

function Icon({ icon, className }: { icon: CChoice<string>["icon"]; className?: string }) {
  if (!icon) return null;
  if (isValidElement(icon)) return <>{icon}</>;
  const I = icon as LucideIcon;
  return <I aria-hidden className={className} />;
}

/** Arrow keys move the choice inside a radio group, like real radio buttons. */
function arrowKeys<T extends string>(options: readonly CChoice<T>[], value: T | null, onChange: (v: T) => void) {
  return (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    const usable = options.filter((o) => !o.disabled);
    if (!usable.length) return;
    e.preventDefault();
    const at = usable.findIndex((o) => o.value === value);
    const next = usable[(at + step + usable.length) % usable.length];
    onChange(next.value);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
  };
}

/** A row of chips, one answer. Scrolls sideways on a phone (`wrap` lets them wrap instead). */
export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
  wrap = false,
  className,
}: {
  /** What the choice is about, for screen readers. */
  label: string;
  options: readonly CChoice<T>[];
  value: T | null;
  onChange: (v: T) => void;
  wrap?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={arrowKeys(options, value, onChange)}
      className={cn(wrap ? "flex flex-wrap gap-2" : "-mx-1 flex gap-2 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]", className)}
    >
      <KitStyles />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-value={o.value}
            tabIndex={on || (value === null && o === options[0]) ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(chip(on), MOTION, FOCUS)}
          >
            {on ? <Check aria-hidden className="kit-pop size-3.5 text-pulse-blue" strokeWidth={3} /> : <Icon icon={o.icon} className="size-3.5" />}
            {o.label}
            {o.count != null && <span className={cn("rounded-full px-1.5 text-[11.5px] tabular-nums", on ? "bg-pulse-blue text-white" : "bg-soft")}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Chips, several answers (tick boxes drawn as chips). */
export function MultiChips<T extends string>({
  label,
  options,
  values,
  onChange,
  className,
}: {
  label: string;
  options: readonly CChoice<T>[];
  values: readonly T[];
  onChange: (v: T[]) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      <KitStyles />
      {options.map((o) => {
        const on = values.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={o.disabled}
            onClick={() => onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])}
            className={cn(chip(on), MOTION, FOCUS)}
          >
            {on ? <Check aria-hidden className="kit-pop size-3.5 text-pulse-blue" strokeWidth={3} /> : <Icon icon={o.icon} className="size-3.5" />}
            {o.label}
            {o.count != null && <span className={cn("rounded-full px-1.5 text-[11.5px] tabular-nums", on ? "bg-pulse-blue text-white" : "bg-soft")}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

const chip = (on: boolean) =>
  cn(
    "inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border-2 px-3.5 text-[13.5px] font-semibold hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0",
    on ? "border-pulse-blue bg-pulse-blue/[0.08] text-text dark:bg-pulse-blue/15" : "border-line bg-surface text-muted hover:border-pulse-blue/40 hover:text-text dark:bg-white/[0.03]",
  );

const COLS = { 1: "grid-cols-1", 2: "grid-cols-1 min-[420px]:grid-cols-2", 3: "grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3", 4: "grid-cols-2 lg:grid-cols-4" } as const;

function Card<T extends string>({ o, on, role, onClick, tabIndex }: { o: CChoice<T>; on: boolean; role: "radio" | "checkbox"; onClick: () => void; tabIndex?: number }) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      data-value={o.value}
      tabIndex={tabIndex}
      disabled={o.disabled}
      onClick={onClick}
      className={cn(
        "group relative flex min-h-16 w-full min-w-0 cursor-pointer items-center gap-3 rounded-[18px] border-2 p-3.5 text-left text-text hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0",
        MOTION,
        FOCUS,
        on
          ? "border-pulse-blue bg-pulse-blue/[0.07] shadow-[0_14px_30px_-24px_rgba(47,107,255,0.9)] dark:bg-pulse-blue/15"
          : "border-line bg-surface hover:border-pulse-blue/40 hover:shadow-[0_18px_36px_-30px_rgba(47,107,255,0.55)] dark:bg-white/[0.03]",
      )}
    >
      {o.icon != null && (
        <span
          aria-hidden
          className={cn(
            "inline-flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors duration-200 [&>svg]:size-5",
            on ? "bg-brand-gradient text-white" : "bg-soft text-muted group-hover:text-text",
          )}
        >
          <Icon icon={o.icon} />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 pr-5">
        <span className="text-[15px] font-semibold leading-snug">{o.label}</span>
        {o.hint && <span className="text-[13px] leading-snug text-muted">{o.hint}</span>}
      </span>
      <span
        aria-hidden
        className={cn(
          "absolute right-3 top-3 inline-flex size-5 items-center justify-center rounded-full border-2",
          on ? "kit-pop border-transparent bg-pulse-blue text-white" : "border-line bg-surface",
        )}
      >
        {on && <Check className="size-3" strokeWidth={3.2} />}
      </span>
    </button>
  );
}

/** Big cards, one answer: an icon, the label and a hint each. The everyday "multiple choice". */
export function ChoiceCards<T extends string>({
  label,
  options,
  value,
  onChange,
  columns = 2,
  className,
}: {
  label: string;
  options: readonly CChoice<T>[];
  value: T | null;
  onChange: (v: T) => void;
  columns?: keyof typeof COLS;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={arrowKeys(options, value, onChange)} className={cn("kit-rise grid gap-2.5", COLS[columns], className)}>
      <KitStyles />
      {options.map((o) => (
        <Card key={o.value} o={o} on={o.value === value} role="radio" onClick={() => onChange(o.value)} tabIndex={o.value === value || (value === null && o === options[0]) ? 0 : -1} />
      ))}
    </div>
  );
}

/** Big cards, several answers. */
export function MultiCards<T extends string>({
  label,
  options,
  values,
  onChange,
  columns = 2,
  className,
}: {
  label: string;
  options: readonly CChoice<T>[];
  values: readonly T[];
  onChange: (v: T[]) => void;
  columns?: keyof typeof COLS;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("kit-rise grid gap-2.5", COLS[columns], className)}>
      <KitStyles />
      {options.map((o) => {
        const on = values.includes(o.value);
        return <Card key={o.value} o={o} on={on} role="checkbox" onClick={() => onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])} />;
      })}
    </div>
  );
}

/** Ready answers under a text field: a tap fills the field ("tap to pick"). */
export function SuggestionChips({ label = "Suggestions", items, onPick, className }: { label?: string; items: readonly string[]; onPick: (text: string) => void; className?: string }) {
  if (!items.length) return null;
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      {items.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className={cn(
            "inline-flex min-h-10 max-w-full cursor-pointer items-center rounded-full border border-dashed border-line px-3.5 py-1.5 text-left text-[13.5px] text-muted hover:-translate-y-px hover:border-pulse-blue/50 hover:bg-pulse-blue/[0.05] hover:text-text",
            MOTION,
            FOCUS,
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

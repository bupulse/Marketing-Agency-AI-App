"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type TabItem = { value: string; label: ReactNode; content: ReactNode };

type TabsProps = {
  items: TabItem[];
  /** Uncontrolled initial tab (defaults to the first). */
  defaultValue?: string;
  /** Controlled mode. */
  value?: string;
  onValueChange?: (value: string) => void;
  /** Accessible name for the tablist. */
  label: string;
  className?: string;
};

/** Accessible tabs: roving tabindex, Arrow/Home/End keys, automatic activation. */
export function Tabs({ items, defaultValue, value, onValueChange, label, className }: TabsProps) {
  const uid = useId();
  const [inner, setInner] = useState(defaultValue ?? items[0]?.value);
  const active = value ?? inner;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function select(v: string) {
    if (value === undefined) setInner(v);
    onValueChange?.(v);
  }

  function onKeyDown(e: KeyboardEvent, index: number) {
    const last = items.length - 1;
    const next =
      e.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : e.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    select(items[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className="flex max-w-full gap-1 overflow-x-auto p-1">
        {items.map((item, i) => {
          const on = item.value === active;
          return (
            <button
              key={item.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="tab"
              type="button"
              id={`${uid}-tab-${item.value}`}
              aria-selected={on}
              aria-controls={`${uid}-panel-${item.value}`}
              tabIndex={on ? 0 : -1}
              onClick={() => select(item.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "min-h-11 shrink-0 cursor-pointer rounded-full border px-4 text-sm font-medium transition-colors duration-300",
                on ? "border-line bg-glass-strong text-text" : "border-transparent bg-transparent text-muted hover:text-text",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.value}
          role="tabpanel"
          id={`${uid}-panel-${item.value}`}
          aria-labelledby={`${uid}-tab-${item.value}`}
          hidden={item.value !== active}
          tabIndex={0}
          className="mt-4 rounded-card outline-offset-4"
        >
          {item.value === active ? item.content : null}
        </div>
      ))}
    </div>
  );
}

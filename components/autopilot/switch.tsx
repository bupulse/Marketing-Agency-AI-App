"use client";

import { cn } from "@/lib/cn";

/** On/off switch. A native button, so it works with touch, keyboard and screen readers. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group inline-flex min-h-11 min-w-14 shrink-0 cursor-pointer items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden
        className={cn(
          "relative inline-block h-8 w-14 rounded-full border transition-colors duration-300",
          checked ? "border-transparent bg-brand-gradient" : "border-line bg-soft",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-7 rounded-full bg-white shadow-md transition-transform duration-300 motion-reduce:transition-none",
            checked && "translate-x-6",
          )}
        />
      </span>
    </button>
  );
}

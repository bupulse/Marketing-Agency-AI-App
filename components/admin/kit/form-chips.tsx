import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export type FormChipOption = { value: string; label: ReactNode; hint?: ReactNode };

const CHIP =
  "inline-flex min-h-11 cursor-pointer select-none items-center gap-1.5 rounded-full border-2 border-line bg-surface px-3.5 text-[13.5px] font-semibold text-muted transition-[border-color,background-color,color] duration-200 hover:border-pulse-blue/40 hover:text-text motion-reduce:transition-none dark:bg-white/[0.03] peer-checked:border-pulse-blue peer-checked:bg-pulse-blue/[0.08] peer-checked:text-text dark:peer-checked:bg-pulse-blue/15 peer-focus-visible:ring-4 peer-focus-visible:ring-pulse-blue/30 peer-disabled:cursor-not-allowed peer-disabled:opacity-50";
const TILE =
  "flex h-full min-h-11 w-full cursor-pointer select-none flex-col gap-0.5 rounded-2xl border-2 border-line bg-surface p-3 pr-8 text-left text-text transition-[border-color,background-color] duration-200 hover:border-pulse-blue/40 motion-reduce:transition-none dark:bg-white/[0.03] peer-checked:border-pulse-blue peer-checked:bg-pulse-blue/[0.07] dark:peer-checked:bg-pulse-blue/15 peer-focus-visible:ring-4 peer-focus-visible:ring-pulse-blue/30";

/**
 * Chips that are form fields: real radio buttons (one choice) or checkboxes (`multiple`), drawn as chips with a ring
 * and a tick when chosen. Use them inside a <form> in place of a <select> or a row of tick boxes; no script, so they
 * work in server components. `tiles` draws bigger tiles with a hint under each label.
 */
export function FormChips({
  name,
  legend,
  hint,
  options,
  defaultValue,
  multiple = false,
  required = false,
  tiles = false,
  hideLegend = false,
  className,
}: {
  name: string;
  /** What the choice is (shown above the chips, and read out). */
  legend: ReactNode;
  hint?: ReactNode;
  options: FormChipOption[];
  /** The chosen value, or values with `multiple`. */
  defaultValue?: string | readonly string[];
  multiple?: boolean;
  required?: boolean;
  tiles?: boolean;
  hideLegend?: boolean;
  className?: string;
}) {
  const chosen = new Set(typeof defaultValue === "string" ? [defaultValue] : (defaultValue ?? []));
  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-2", className)}>
      <legend className={cn("mb-2 text-sm font-medium", hideLegend && "sr-only")}>
        {legend}
        {required && <span aria-hidden className="text-danger"> *</span>}
      </legend>
      <div className={cn(tiles ? "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" : "flex flex-wrap gap-2")}>
        {options.map((o) => (
          <label key={o.value} className={cn("relative min-w-0", tiles && "flex")}>
            <input type={multiple ? "checkbox" : "radio"} name={name} value={o.value} defaultChecked={chosen.has(o.value)} required={required && !multiple} className="peer sr-only" />
            {tiles ? (
              <span className={TILE}>
                <span className="text-[14px] font-semibold leading-snug">{o.label}</span>
                {o.hint && <span className="text-[12px] leading-snug text-muted">{o.hint}</span>}
              </span>
            ) : (
              <span className={CHIP}>{o.label}</span>
            )}
            <span aria-hidden className={cn("pointer-events-none absolute hidden size-5 items-center justify-center rounded-full bg-pulse-blue text-white peer-checked:inline-flex", tiles ? "right-2.5 top-2.5" : "-right-1 -top-1 size-4")}>
              <Check className={tiles ? "size-3" : "size-2.5"} strokeWidth={3.2} />
            </span>
          </label>
        ))}
      </div>
      {hint && <p className="text-[12.5px] leading-snug text-muted">{hint}</p>}
    </fieldset>
  );
}

/** One on/off switch that is a form checkbox (sends "on" when on), with a title and a plain line under it. */
export function FormSwitch({ name, label, hint, defaultChecked, className }: { name: string; label: ReactNode; hint?: ReactNode; defaultChecked?: boolean; className?: string }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-start gap-3", className)}>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="peer sr-only" />
      <span
        aria-hidden
        className="relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full bg-line transition-colors duration-200 after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform after:duration-200 peer-checked:bg-pulse-blue peer-checked:after:translate-x-5 peer-focus-visible:ring-4 peer-focus-visible:ring-pulse-blue/30 motion-reduce:transition-none motion-reduce:after:transition-none dark:bg-white/20"
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-[14px] font-semibold">{label}</span>
        {hint && <span className="text-[13px] leading-snug text-muted">{hint}</span>}
      </span>
    </label>
  );
}

import type { ReactNode } from "react";
import { Check, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconBadge } from "./icon-badge";
import type { KitTone } from "./tones";

export type RadioOption = { value: string; label: string; hint?: ReactNode; icon?: LucideIcon; tone?: KitTone; disabled?: boolean };

/**
 * A choice inside a form, as chips (or bigger `tiles` with a hint each) instead of a select. Real radio buttons under
 * the look, so it posts `name=value` like a select did, works without JavaScript, and the arrow keys move between the
 * options. The chosen one has a ring and a tick; the keyboard focus shows a ring.
 */
export function RadioChips({
  name,
  legend,
  options,
  defaultValue,
  required,
  tiles = false,
  hint,
  hideLegend = false,
  className,
}: {
  name: string;
  /** What is being chosen ("Environment"): the group's label. */
  legend: string;
  options: RadioOption[];
  defaultValue?: string;
  required?: boolean;
  /** Bigger tiles with the option's icon and hint (two a row on a phone). */
  tiles?: boolean;
  /** One plain line under the choices. */
  hint?: ReactNode;
  /** Keeps the legend for screen readers only (when a heading above already says it). */
  hideLegend?: boolean;
  className?: string;
}) {
  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-2", className)}>
      <legend className={cn("mb-2 text-[14px] font-semibold", hideLegend && "sr-only")}>
        {legend}
        {required && (
          <span aria-hidden className="ml-0.5 text-pulse-violet">
            *
          </span>
        )}
      </legend>
      <div className={cn(tiles ? "grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-3" : "flex flex-wrap gap-2")}>
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "group relative cursor-pointer select-none border-2 transition-[border-color,background-color,transform] duration-200 motion-reduce:transform-none motion-reduce:transition-none",
              "border-line bg-surface text-text hover:border-pulse-blue/40 dark:bg-white/[0.03]",
              "has-[:checked]:border-pulse-blue has-[:checked]:bg-pulse-blue/[0.07] dark:has-[:checked]:bg-pulse-blue/15",
              "has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-pulse-blue/30 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55",
              tiles ? "flex min-w-0 items-start gap-2.5 rounded-2xl p-3 hover:-translate-y-0.5" : "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold",
            )}
          >
            <input type="radio" name={name} value={o.value} defaultChecked={o.value === defaultValue} required={required} disabled={o.disabled} className="peer sr-only" />
            {tiles ? (
              <>
                {o.icon && <IconBadge icon={o.icon} tone={o.tone ?? "blue"} size="sm" />}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 pr-6">
                  <span className="text-[14px] font-semibold leading-snug">{o.label}</span>
                  {o.hint && <span className="text-[12.5px] leading-snug text-muted">{o.hint}</span>}
                </span>
                <span aria-hidden className="absolute right-2.5 top-2.5 hidden size-5 items-center justify-center rounded-full bg-pulse-blue text-white peer-checked:inline-flex">
                  <Check className="size-3" strokeWidth={3} />
                </span>
              </>
            ) : (
              <>
                <Check aria-hidden className="hidden size-3.5 text-pulse-blue peer-checked:inline" strokeWidth={3} />
                {o.icon && <o.icon aria-hidden className="size-3.5 text-muted peer-checked:hidden" />}
                {o.label}
              </>
            )}
          </label>
        ))}
      </div>
      {hint && <p className="text-[13px] text-muted">{hint}</p>}
    </fieldset>
  );
}

/**
 * An on/off switch inside a form: a real checkbox (posts `name=on` when on, nothing when off, like before) drawn as a
 * switch, with its label and a plain line under it. The whole row is the click target.
 */
export function SwitchRow({ name, label, hint, defaultChecked, disabled, className }: { name: string; label: ReactNode; hint?: ReactNode; defaultChecked?: boolean; disabled?: boolean; className?: string }) {
  return (
    <label className={cn("group flex min-h-11 cursor-pointer items-start justify-between gap-4 rounded-2xl has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55", className)}>
      <span className="flex min-w-0 flex-col gap-0.5 pt-1">
        <span className="text-[15px] font-semibold leading-snug">{label}</span>
        {hint && <span className="text-[13px] leading-snug text-muted">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" name={name} defaultChecked={defaultChecked} disabled={disabled} className="peer sr-only" />
      <span
        aria-hidden
        className={cn(
          "relative mt-0.5 inline-flex h-8 w-14 shrink-0 items-center rounded-full border border-line bg-soft p-1 transition-colors duration-200 motion-reduce:transition-none",
          "peer-checked:border-transparent peer-checked:bg-brand-gradient peer-focus-visible:ring-4 peer-focus-visible:ring-pulse-blue/30",
          "[&>span]:transition-transform [&>span]:duration-200 peer-checked:[&>span]:translate-x-6 motion-reduce:[&>span]:transition-none",
        )}
      >
        <span className="size-6 rounded-full bg-white shadow-[0_2px_6px_rgba(17,24,39,0.25)]" />
      </span>
    </label>
  );
}

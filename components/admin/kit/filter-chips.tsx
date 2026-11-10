import Link from "next/link";
import type { ReactNode } from "react";
import { Check, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconBadge } from "./icon-badge";
import { hrefWith, type SearchParamsLike } from "./url";
import { FOCUS, type KitTone } from "./tones";

export type ChoiceOption = { value: string; label: string; count?: number; hint?: ReactNode; icon?: LucideIcon; tone?: KitTone };

type Common = {
  /** What the choice is about, for screen readers ("Show payments"). */
  label: string;
  /** The URL parameter (?status=). */
  param: string;
  options: ChoiceOption[];
  /** The value chosen now (read it with chosen() from ./url). */
  current: string;
  /** The page's path ("/admin/payments"). */
  base: string;
  /** The page's current searchParams, so other filters are kept. */
  params?: SearchParamsLike;
  /** The value meaning "no filter": its link removes the parameter. Default "". */
  allValue?: string;
  className?: string;
};

/**
 * A row of chips that filter a list by a URL parameter. Each chip is a link (the page stays a server component); the
 * chosen one has a ring, a tick and aria-current. Scrolls sideways on a phone instead of wrapping into a wall.
 */
export function FilterChips({ label, param, options, current, base, params, allValue = "", className }: Common) {
  return (
    <nav aria-label={label} className={cn("-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]", className)}>
      <ul className="flex w-max gap-2">
        {options.map((o) => {
          const on = o.value === current;
          return (
            <li key={o.value}>
              <Link
                href={hrefWith(base, params, param, o.value, allValue)}
                scroll={false}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border-2 px-3.5 text-[13px] font-semibold no-underline transition-[border-color,background-color,transform] duration-200 hover:-translate-y-px motion-reduce:transform-none motion-reduce:transition-none",
                  FOCUS,
                  on ? "border-pulse-blue bg-pulse-blue/[0.08] text-text dark:bg-pulse-blue/15" : "border-line bg-surface text-muted hover:border-pulse-blue/40 hover:text-text dark:bg-white/[0.03]",
                )}
              >
                {on ? <Check aria-hidden className="size-3.5 text-pulse-blue" strokeWidth={3} /> : o.icon ? <o.icon aria-hidden className="size-3.5" /> : null}
                {o.label}
                {o.count != null && <span className={cn("rounded-full px-1.5 text-[11.5px] tabular-nums", on ? "bg-pulse-blue text-white" : "bg-soft")}>{o.count}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Bigger tiles for a choice that deserves a hint per option (a period, a view, a kind). Same URL behaviour as
 * FilterChips. Two tiles a row on a phone, up to four on a computer.
 */
export function ChoiceTiles({ label, param, options, current, base, params, allValue = "", className }: Common) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {options.map((o) => {
          const on = o.value === current;
          return (
            <li key={o.value} className="flex">
              <Link
                href={hrefWith(base, params, param, o.value, allValue)}
                scroll={false}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "relative flex w-full min-w-0 items-start gap-2.5 rounded-2xl border-2 p-3 text-text no-underline transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:transition-none",
                  FOCUS,
                  on ? "border-pulse-blue bg-pulse-blue/[0.07] dark:bg-pulse-blue/15" : "border-line bg-surface hover:border-pulse-blue/40 dark:bg-white/[0.03]",
                )}
              >
                {o.icon && <IconBadge icon={o.icon} tone={o.tone ?? "blue"} size="sm" />}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 pr-5">
                  <span className="text-[14px] font-semibold leading-snug">
                    {o.label}
                    {o.count != null && <span className="ml-1.5 text-[12px] font-bold tabular-nums text-muted">{o.count}</span>}
                  </span>
                  {o.hint && <span className="text-[12px] leading-snug text-muted">{o.hint}</span>}
                </span>
                {on && (
                  <span aria-hidden className="kit-pop absolute right-2.5 top-2.5 inline-flex size-5 items-center justify-center rounded-full bg-pulse-blue text-white">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

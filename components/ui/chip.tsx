import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type ChipBase = { icon?: ReactNode; className?: string };
type StaticChip = ChipBase & HTMLAttributes<HTMLSpanElement> & { selected?: undefined; onClick?: undefined };
type ToggleChip = ChipBase &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & { selected?: boolean };

export type ChipProps = StaticChip | ToggleChip;

const base = "inline-flex items-center gap-2.5 rounded-full px-[18px] py-3 text-[15px] font-medium whitespace-nowrap";

/**
 * Pill. Static `<span>` by default (marquees, tags); becomes a toggle `<button aria-pressed>`
 * when `onClick` or `selected` is given (industry pickers, filters). 44px min target.
 */
export function Chip(props: ChipProps) {
  const { icon, className, children, selected, ...rest } = props;
  if (selected !== undefined || props.onClick) {
    return (
      <button
        type="button"
        aria-pressed={selected ?? false}
        className={cn(
          base,
          "min-h-11 cursor-pointer border transition-[transform,background-color,color] duration-300 hover:-translate-y-0.5 motion-reduce:hover:translate-y-0",
          selected ? "border-transparent bg-brand-gradient text-white" : "glass text-text",
          className,
        )}
        {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {icon}
        {children}
      </button>
    );
  }
  return (
    <span className={cn(base, "glass text-text", className)} {...(rest as HTMLAttributes<HTMLSpanElement>)}>
      {icon}
      {children}
    </span>
  );
}

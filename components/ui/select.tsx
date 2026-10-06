import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { fieldBorder, fieldClasses } from "./field-styles";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

/** Native <select> (best mobile + a11y behaviour), styled to match. Pass <option> children. */
export function Select({ invalid, className, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        aria-invalid={invalid || undefined}
        className={cn(fieldClasses, fieldBorder, "min-h-12 cursor-pointer appearance-none py-3 pr-10", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted"
      />
    </div>
  );
}

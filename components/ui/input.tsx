import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { fieldBorder, fieldClasses } from "./field-styles";

// ComponentProps (not InputHTMLAttributes) so a parent can pass `ref` (React 19 passes it as a prop).
export type InputProps = ComponentProps<"input"> & { invalid?: boolean };

export function Input({ invalid, className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(fieldClasses, fieldBorder, "min-h-12 py-3", className)}
      {...props}
    />
  );
}

import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { fieldBorder, fieldClasses } from "./field-styles";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export function Input({ invalid, className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(fieldClasses, fieldBorder, "min-h-12 py-3", className)}
      {...props}
    />
  );
}

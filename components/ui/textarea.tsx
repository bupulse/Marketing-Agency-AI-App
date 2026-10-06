import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { fieldBorder, fieldClasses } from "./field-styles";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export function Textarea({ invalid, className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(fieldClasses, fieldBorder, "min-h-24 resize-y py-3", className)}
      {...props}
    />
  );
}

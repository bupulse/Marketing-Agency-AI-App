import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Label } from "./label";

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  /** A single control: Input, Textarea or Select. id, aria-describedby and invalid are wired for you. */
  children: ReactNode;
};

/** Label + control + hint + error with correct ARIA wiring. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const uid = useId();
  const id = `f${uid.replace(/:/g, "")}`;
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;

  const control = Children.only(children);
  const wired = isValidElement(control)
    ? cloneElement(control as ReactElement<Record<string, unknown>>, {
        id,
        required: required || undefined,
        invalid: error ? true : undefined,
        "aria-describedby": describedBy,
      })
    : control;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden className="ml-0.5 text-pulse-violet">
            *
          </span>
        )}
      </Label>
      {wired}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[13px] text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-[13px] font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

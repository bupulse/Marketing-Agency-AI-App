"use client";

import { useState, type ReactNode } from "react";
import { Button, Dialog, type ButtonVariant } from "@/components/ui";

/**
 * A button that opens a confirm Dialog and then submits a server action. `fields` become hidden inputs,
 * so the action receives them in its FormData. The action runs requireAdmin itself.
 */
export function ConfirmButton({
  action,
  fields,
  label,
  title,
  description,
  confirmLabel,
  variant = "outline",
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  label: string;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: ButtonVariant;
  /** Extra inputs inside the dialog (a reason, an amount). */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={title} description={description}>
        <form action={action} className="flex flex-col gap-4">
          {Object.entries(fields).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {children}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">{confirmLabel ?? label}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

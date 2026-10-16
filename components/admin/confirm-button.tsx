"use client";

import { Loader2 } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Button, Dialog, useToast, type ButtonVariant } from "@/components/ui";

/** What an action may answer instead of redirecting: the dialog closes, the message shows and the page refreshes. */
export type ConfirmResult = { ok: true; message: string } | { ok: false; error: string };

const FAILED = "Something went wrong. Nothing was changed; please try again.";

/**
 * A button that opens a confirm Dialog and then runs a server action. `fields` become hidden inputs, so the action
 * receives them in its FormData. The action runs requireAdmin itself.
 *
 * While it runs, both buttons say so (`pendingLabel`) and cannot be pressed twice. An action that answers a
 * ConfirmResult closes the dialog and shows its message; it refreshes the page itself (next/cache refresh(), so lists
 * and sidebar badges update together). One that redirects (lib/admin/console.ts finish(): back with ?notice=) closes
 * it and navigates. A refusal keeps it open with the reason.
 */
export function ConfirmButton({
  action,
  fields,
  label,
  title,
  description,
  confirmLabel,
  pendingLabel = "Working…",
  variant = "outline",
  children,
}: {
  action: (formData: FormData) => void | Promise<void | ConfirmResult>;
  fields: Record<string, string>;
  label: string;
  title: string;
  description: string;
  confirmLabel?: string;
  /** What the buttons say while the action runs ("Confirming…"). */
  pendingLabel?: string;
  variant?: ButtonVariant;
  /** Extra inputs inside the dialog (a reason, an amount). */
  children?: ReactNode;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      let result: void | ConfirmResult;
      try {
        result = await action(data);
      } catch (err) {
        setOpen(false);
        // A redirect (finish() back to the page with its notice) is Next's to carry out.
        unstable_rethrow(err);
        setOpen(true);
        setError(FAILED);
        return;
      }
      if (result && !result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      if (result) toast(result.message, "success");
    });
  }

  const busy = (
    <>
      <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> {pendingLabel}
    </>
  );

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={variant}
        disabled={pending}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {pending ? busy : label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={title} description={description}>
        <form onSubmit={submit} className="flex flex-col gap-4" aria-busy={pending}>
          {Object.entries(fields).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {children}
          {error && (
            <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? busy : (confirmLabel ?? label)}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

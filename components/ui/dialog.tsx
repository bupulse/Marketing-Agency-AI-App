"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
};

/**
 * Modal built on native <dialog>: focus trap, Esc to close and inert background come from the browser.
 * Click on the backdrop also closes. Controlled via `open`.
 */
export function Dialog({ open, onOpenChange, title, description, children, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // Focus the panel itself, not the close button, so mouse users do not get a focus ring on it.
      // Keyboard users still reach the close button first with Tab.
      el.focus({ preventScroll: true });
    }
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby={`${uid}-t`}
      aria-describedby={description ? `${uid}-d` : undefined}
      onClose={() => onOpenChange(false)}
      onClick={(e) => {
        if (e.target === ref.current) onOpenChange(false);
      }}
      className={cn(
        "bp-dialog glass-strong w-[calc(100%-2rem)] max-w-lg rounded-panel p-0 text-text",
        className,
      )}
    >
      <div className="flex max-h-[inherit] flex-col p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-8">
        <div className="mb-1 flex shrink-0 items-start justify-between gap-4">
          <div>
            <h2 id={`${uid}-t`} className="text-xl font-bold tracking-tight">
              {title}
            </h2>
            {description && (
              <p id={`${uid}-d`} className="mt-1 text-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="-mt-2 -mr-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        {/* The header and close button stay put; long content scrolls inside the sheet. */}
        <div className="bp-dialog-scroll -mx-4 -mb-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-6">{children}</div>
      </div>
    </dialog>
  );
}

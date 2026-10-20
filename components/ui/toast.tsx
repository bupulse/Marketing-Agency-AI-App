"use client";

import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ToastTone = "info" | "success" | "error";
type ToastItem = { id: number; message: string; tone: ToastTone };
type ToastApi = { toast: (message: string, tone?: ToastTone) => void };

const ToastContext = createContext<ToastApi | null>(null);

const icons = { info: Info, success: CheckCircle2, error: XCircle } as const;
const iconColor = { info: "text-pulse-blue", success: "text-success", error: "text-danger" } as const;

/** Mount once near the root. Toasts auto-dismiss after 5s; the region is an aria-live announcer. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = ++nextId.current;
      setItems((cur) => [...cur.slice(-3), { id, message, tone }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-[calc(1rem+var(--bp-bottom-bar,0px))] left-4 z-[100] flex flex-col items-end gap-2 sm:left-auto"
      >
        {items.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div
              key={t.id}
              className={cn(
                "glass-strong pointer-events-auto flex w-full max-w-sm animate-pop items-start gap-3 rounded-2xl py-3 pr-2 pl-4 text-sm text-text",
              )}
            >
              <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", iconColor[t.tone])} />
              <p className="flex-1 py-0.5">{t.message}</p>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismiss(t.id)}
                className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

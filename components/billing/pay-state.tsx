"use client";

import { Loader2 } from "lucide-react";
import { useSyncExternalStore } from "react";
import { checkingText } from "@/lib/billing/momo-shared";

// What this tab knows before the server has re-rendered: a Mobile Money payment was just reported ("I have paid"), or a
// card checkout just completed. Every other pay button on the page hides at once, so nobody pays twice while the page
// refreshes (the server then hides them for good: Billing, the demo lock, the offer banner). Cleared once the payment
// is decided or the plan is on.

export type PayState = { kind: "momo"; reference: string } | { kind: "card" } | null;

let state: PayState = null;
const listeners = new Set<() => void>();

export function setPayState(next: PayState) {
  state = next;
  listeners.forEach((l) => l());
}

/** Clears a Mobile Money "being checked" state of this payment only (a card state, or another payment's, stays). */
export function clearMomoPayState(reference: string) {
  if (state?.kind === "momo" && state.reference === reference) setPayState(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const usePayState = (): PayState => useSyncExternalStore(subscribe, () => state, () => null);

/** Shown in place of pay buttons while a payment is being checked or a card payment is switching the plan on. */
export function PayStateNote({ state: s }: { state: Exclude<PayState, null> }) {
  return (
    <p role="status" className="flex items-start gap-2 text-sm text-muted">
      <Loader2 aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin text-pulse-blue motion-reduce:animate-none" />
      {s.kind === "momo" ? checkingText(s.reference) : "Payment received, your plan is switching on."}
    </p>
  );
}

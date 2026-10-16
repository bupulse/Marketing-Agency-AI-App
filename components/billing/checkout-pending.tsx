"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GlassCard, useToast } from "@/components/ui";
import { checkoutActivated } from "@/app/dashboard/billing/actions";
import { CHECKOUT_PENDING_COOKIE, CHECKOUT_PENDING_MS, checkoutPendingSince } from "@/lib/billing/checkout-pending";
import { setPayState } from "./pay-state";

const POLL_MS = 3000;
const MAX_POLLS = 100; // 5 minutes of asking; the provider usually confirms within 30 seconds

/** A card checkout just completed: remember it (lib/billing/checkout-pending.ts) and hide the pay buttons at once. */
export function markCheckoutPending(since: number) {
  document.cookie = `${CHECKOUT_PENDING_COOKIE}=${since}; path=/; max-age=${CHECKOUT_PENDING_MS / 1000}; samesite=lax`;
  setPayState({ kind: "card" });
}

function clearCheckoutPending() {
  document.cookie = `${CHECKOUT_PENDING_COOKIE}=; path=/; max-age=0; samesite=lax`;
  setPayState(null);
}

/**
 * On the demo lock (where Billing's own return message never shows): after a card payment, "Payment received, your
 * plan is switching on" instead of the pay buttons, while the webhook switches the plan on. `pendingSince` comes from
 * the server (the cookie, or a recent Paddle payment event); the return URL (?checkout=success&since=…) also counts.
 * It asks every few seconds whether the plan is on and then reloads into the dashboard. It never activates anything.
 */
export function CheckoutPendingWatch({ pendingSince }: { pendingSince: number | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const params = useSearchParams();
  const returned = params.get("checkout") === "success" ? params.get("since") : null;
  // When this page was opened: an old success URL (outside the window) is ignored.
  const [openedAt] = useState(() => Date.now());
  const fromUrl = pendingSince === null ? checkoutPendingSince(returned, openedAt) : null;
  const [timedOut, setTimedOut] = useState(false);
  const [done, setDone] = useState(false);
  const polls = useRef(0);
  const since = pendingSince ?? fromUrl;

  // Back from the checkout: keep it for the server (so a reload or another page still hides the buttons) and re-render.
  useEffect(() => {
    if (fromUrl === null) return;
    markCheckoutPending(fromUrl);
    router.refresh();
  }, [fromUrl, router]);

  useEffect(() => {
    if (since === null) return;
    setPayState({ kind: "card" });
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      polls.current += 1;
      if (polls.current > MAX_POLLS) {
        clearInterval(timer);
        setTimedOut(true);
        return;
      }
      busy = true;
      try {
        if (await checkoutActivated(since)) {
          clearInterval(timer);
          clearCheckoutPending();
          setDone(true);
          toast("Payment confirmed. Your plan is on.", "success");
          router.replace("/dashboard");
          router.refresh();
        }
      } catch {
        // Network hiccup: try again on the next tick.
      } finally {
        busy = false;
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [since, router, toast]);

  if (since === null) return null;
  return (
    <GlassCard role="status" className="flex items-start gap-3 border border-pulse-blue/30 p-5">
      {done ? (
        <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
      ) : !timedOut ? (
        <Loader2 aria-hidden className="mt-0.5 size-5 shrink-0 animate-spin text-pulse-blue motion-reduce:animate-none" />
      ) : null}
      <div className="flex flex-col gap-1">
        <strong>{done ? "Your plan is on" : "Payment received, your plan is switching on"}</strong>
        <p className="text-sm text-muted">
          {done
            ? "Opening your dashboard…"
            : timedOut
              ? "Your card payment went through, but switching your plan on is taking longer than usual. Do not pay again: refresh this page in a few minutes. Your receipt is in your email; if your plan is still not on within an hour, reply to it."
              : "Your card payment went through. We switch your plan on as soon as the card company confirms it, usually within a minute. You do not need to pay again or do anything."}
        </p>
      </div>
    </GlassCard>
  );
}

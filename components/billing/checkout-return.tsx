"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GlassCard, useToast } from "@/components/ui";
import { checkoutActivated } from "@/app/dashboard/billing/actions";

const POLL_MS = 2000;
const MAX_POLLS = 60; // about 2 minutes; the provider usually confirms within 30 seconds

/**
 * Shown after checkout (?checkout=success). The payment provider confirms the purchase by webhook,
 * so refresh the page every 2 seconds until the page says this purchase is active (`waiting` false).
 */
export function CheckoutReturn({ waiting, since }: { waiting: boolean; since: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [timedOut, setTimedOut] = useState(false);
  const polls = useRef(0);
  const announced = useRef(false);

  useEffect(() => {
    if (!waiting) {
      if (!announced.current) {
        announced.current = true;
        toast("You are all set. Your plan is active.", "success");
        router.replace("/dashboard/billing");
      }
      return;
    }
    // Poll a small status check (not the whole page) and refresh once the plan is active.
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      polls.current += 1;
      if (polls.current >= MAX_POLLS) {
        clearInterval(timer);
        setTimedOut(true);
        return;
      }
      busy = true;
      try {
        if (await checkoutActivated(since)) {
          clearInterval(timer);
          router.refresh();
        }
      } catch {
        // Network hiccup: try again on the next tick.
      } finally {
        busy = false;
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, since, router, toast]);

  if (!waiting) return null;

  return (
    <GlassCard role="status" className="flex items-start gap-3 border border-pulse-blue/30 p-5">
      {!timedOut && <Loader2 aria-hidden className="mt-0.5 size-5 shrink-0 animate-spin text-pulse-blue motion-reduce:animate-none" />}
      <div className="flex flex-col gap-1">
        <strong>{timedOut ? "Your payment went through" : "Finishing your upgrade…"}</strong>
        <p className="text-sm text-muted">
          {timedOut
            ? "Activating your plan can take a minute. Refresh this page shortly. Your receipt is on its way to your email."
            : "This only takes a moment. You do not need to do anything."}
        </p>
      </div>
    </GlassCard>
  );
}

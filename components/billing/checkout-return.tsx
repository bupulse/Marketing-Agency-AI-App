"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GlassCard, useToast } from "@/components/ui";

const POLL_MS = 2000;
const MAX_POLLS = 15; // about 30 seconds

/**
 * Shown after checkout (?checkout=success). The payment provider confirms the purchase by webhook,
 * so refresh the page every 2 seconds until the plan is no longer the trial.
 */
export function CheckoutReturn({ stillTrial }: { stillTrial: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [timedOut, setTimedOut] = useState(false);
  const polls = useRef(0);
  const announced = useRef(false);

  useEffect(() => {
    if (!stillTrial) {
      if (!announced.current) {
        announced.current = true;
        toast("You are all set. Your plan is active.", "success");
        router.replace("/dashboard/billing");
      }
      return;
    }
    const timer = setInterval(() => {
      polls.current += 1;
      if (polls.current >= MAX_POLLS) {
        clearInterval(timer);
        setTimedOut(true);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [stillTrial, router, toast]);

  if (!stillTrial) return null;

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

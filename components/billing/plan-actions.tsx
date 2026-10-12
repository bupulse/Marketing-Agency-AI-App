"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, useToast } from "@/components/ui";
import { cancelSubscription, openPortal, resumeSubscription, startMomoPayment } from "@/app/dashboard/billing/actions";
import type { BillingInterval } from "@/lib/generated/prisma/client";

type Props = {
  cancelAtPeriodEnd: boolean;
  pastDue: boolean;
  /** Formatted end of the paid period. */
  periodEnd: string | null;
  /** "momo": paid by hand each period, so the only action is to pay the next one (docs/MOMO.md). */
  method?: "card" | "momo";
  /** For Mobile Money: the plan and period to renew. */
  renew?: { plan: string; interval: BillingInterval };
};

/** Buttons on the current plan card: update payment method, resume, cancel. */
export function PlanActions({ cancelAtPeriodEnd, pastDue, periodEnd, method = "card", renew }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);

  if (method === "momo") {
    const pay = () =>
      start(async () => {
        const result = renew ? await startMomoPayment(renew) : { ok: false as const, error: "Choose a plan below." };
        if (result.ok) router.refresh();
        else toast(result.error, "error");
      });
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={pay} disabled={pending || !renew}>
          {pending ? "One moment…" : pastDue ? "Pay by Mobile Money" : "Renew by Mobile Money"}
        </Button>
        <span className="text-sm text-muted">Paid by hand each period. We email you before it ends; nothing is ever deleted.</span>
      </div>
    );
  }

  function run(action: () => ReturnType<typeof cancelSubscription>, done: string, close = false) {
    start(async () => {
      const result = await action();
      if (close) setConfirm(false);
      if (result.ok) {
        toast(done, "success");
        router.refresh();
      } else {
        toast(result.error, "error");
      }
    });
  }

  function portal() {
    start(async () => {
      const result = await openPortal();
      if (result.ok) window.location.assign(result.url);
      else toast(result.error, "error");
    });
  }

  return (
    <div className="flex flex-wrap gap-3">
      {pastDue && (
        <Button onClick={portal} disabled={pending}>
          Update payment method
        </Button>
      )}
      {!pastDue && (
        <Button variant="ghost" onClick={portal} disabled={pending}>
          Payment method
        </Button>
      )}
      {cancelAtPeriodEnd ? (
        <Button onClick={() => run(resumeSubscription, "Your plan will keep renewing.")} disabled={pending}>
          Resume plan
        </Button>
      ) : (
        <Button variant="outline" onClick={() => setConfirm(true)} disabled={pending}>
          Cancel plan
        </Button>
      )}

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Cancel your plan?"
        description={
          periodEnd
            ? `Your plan stays active until ${periodEnd}. You will not be charged again, and nothing you have made is deleted.`
            : "Your plan stays active until the end of the period you paid for. Nothing you have made is deleted."
        }
      >
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Keep my plan
          </Button>
          <Button
            disabled={pending}
            onClick={() => run(cancelSubscription, periodEnd ? `Cancelled. Your plan stays active until ${periodEnd}.` : "Cancelled.", true)}
            className="bg-danger bg-none text-white shadow-none"
          >
            {pending ? "Cancelling…" : "Cancel plan"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

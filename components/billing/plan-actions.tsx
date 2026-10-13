"use client";

import { CreditCard, Smartphone } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, useToast } from "@/components/ui";
import { useTheme } from "@/components/theme";
import { cancelSubscription, openPortal, resumeSubscription, startCheckout, startMomoPayment } from "@/app/dashboard/billing/actions";
import { CARD_SOON, MOMO_SOON, type MethodState } from "@/lib/billing/pay-methods";
import type { BillingInterval } from "@/lib/generated/prisma/client";
import { openCheckout } from "./checkout";

/**
 * Renewing the current plan, shown only in the last days of the paid period (lib/billing/renewal.ts): Mobile Money and
 * card side by side, a method that cannot be used yet visible but disabled with the reason. Card is the checkout (a
 * Mobile Money plan moving to card; the paid days are kept) or, for a card plan cancelled at its end, resuming it.
 */
export type Renewal = { plan: string; interval: BillingInterval; momo: MethodState; card: MethodState; cardVia: "checkout" | "resume"; cardReason?: string | null };

type Props = {
  cancelAtPeriodEnd: boolean;
  pastDue: boolean;
  /** Formatted end of the paid period. */
  periodEnd: string | null;
  /** "momo": paid by hand each period, so the only action is to pay the next one (docs/MOMO.md). */
  method?: "card" | "momo";
  /** The renewal buttons, when renewing is open (the last 7 days of the paid period, or after it ended). */
  renew?: Renewal;
};

/** Buttons on the current plan card: update payment method, resume, cancel. */
export function PlanActions({ cancelAtPeriodEnd, pastDue, periodEnd, method = "card", renew }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<"momo" | "card" | null>(null);
  const { resolvedTheme } = useTheme();

  const renewByMomo = (r: Renewal) => {
    setBusy("momo");
    start(async () => {
      const result = await startMomoPayment({ plan: r.plan, interval: r.interval });
      setBusy(null);
      if (result.ok) router.refresh();
      else toast(result.error, "error");
    });
  };
  const renewByCard = (r: Renewal) => {
    setBusy("card");
    start(async () => {
      if (r.cardVia === "resume") {
        const result = await resumeSubscription();
        setBusy(null);
        if (result.ok) {
          toast("Your card plan will renew by itself.", "success");
          router.refresh();
        } else toast(result.error, "error");
        return;
      }
      const result = await startCheckout({ plan: r.plan, interval: r.interval });
      if (!result.ok) {
        toast(result.error, "error");
        setBusy(null);
        return;
      }
      try {
        await openCheckout(result.config, resolvedTheme, {
          onClosed: () => setBusy(null),
          onError: (message) => {
            toast(message, "error");
            setBusy(null);
          },
        });
      } catch (error) {
        toast(error instanceof Error ? error.message : "Checkout could not open. Please try again.", "error");
        setBusy(null);
      }
    });
  };
  const renewal = renew ? (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3">
        {renew.momo !== "off" && (
          <Button onClick={() => renewByMomo(renew)} disabled={pending || renew.momo !== "ready"} leading={<Smartphone aria-hidden className="size-4" />}>
            {busy === "momo" ? "One moment…" : "Renew with Mobile Money"}
          </Button>
        )}
        {renew.card !== "off" && (
          <Button variant={renew.momo === "ready" ? "outline" : "primary"} onClick={() => renewByCard(renew)} disabled={pending || renew.card !== "ready" || Boolean(renew.cardReason)} leading={<CreditCard aria-hidden className="size-4" />}>
            {busy === "card" ? "Opening…" : "Renew with card"}
          </Button>
        )}
      </div>
      {[renew.momo === "soon" ? MOMO_SOON : null, renew.card === "soon" ? (renew.cardReason ?? CARD_SOON) : renew.card === "ready" ? (renew.cardReason ?? null) : null]
        .filter(Boolean)
        .map((reason) => (
          <span key={reason} className="text-sm text-muted">
            {reason}
          </span>
        ))}
      <span className="text-sm text-muted">The new period starts when the current one ends, so you lose no days.{renew.card === "ready" && renew.cardVia === "checkout" ? " Card renews by itself every period, charged in USD." : ""}</span>
    </div>
  ) : null;

  if (method === "momo") {
    return renewal ?? <span className="text-sm text-muted">Paid by hand each period. We email you before it ends; nothing is ever deleted.</span>;
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
    <div className="flex flex-col gap-4">
      {renewal}
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
    </div>
  );
}

"use client";

import { CreditCard, Smartphone } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, useToast } from "@/components/ui";
import { useTheme } from "@/components/theme";
import { startCheckout, startMomoPayment } from "@/app/dashboard/billing/actions";
import { openCheckout } from "@/components/billing/checkout";
import { PayChoice } from "@/components/billing/pay-choice";
import { offersChoice, soleMethod, type PayMethods } from "@/lib/billing/pay-methods";
import { sinceOfSuccessUrl } from "@/lib/billing/checkout-pending";
import { markCheckoutPending } from "@/components/billing/checkout-pending";
import { PayStateNote, usePayState } from "@/components/billing/pay-state";

/**
 * "Pay now" on the demo lock screen: a company that does not want to wait for its demo pays for the plan it chose
 * (monthly), by Mobile Money or card where the region takes both (a choice, like Billing). Mobile Money starts a
 * payment and the pay screen (components/billing/momo-payment.tsx) takes over; card opens the Paddle checkout. The
 * dashboard opens once the payment is confirmed (docs/MOMO.md, docs/BILLING.md).
 */
export function DemoPayButton({ plan, planName, methods, momoNote, cardNote }: { plan: string; planName: string; methods: PayMethods; momoNote: string; cardNote: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const [pending, start] = useTransition();
  const [choosing, setChoosing] = useState(false);
  // Paid a moment ago (card completed, or Mobile Money reported): no second payment while the page catches up.
  const payState = usePayState();

  const payByMomo = () =>
    start(async () => {
      setChoosing(false);
      const result = await startMomoPayment({ plan, interval: "MONTH" });
      if (result.ok) router.refresh();
      else toast(result.error, "error");
    });

  const payByCard = () =>
    start(async () => {
      setChoosing(false);
      const result = await startCheckout({ plan, interval: "MONTH" });
      if (!result.ok) return toast(result.error, "error");
      const since = sinceOfSuccessUrl(result.config.successUrl);
      try {
        // Paid: "switching on" at once and the buttons hidden until the webhook has done it (lib/billing/checkout-pending.ts).
        await openCheckout(result.config, resolvedTheme, { onError: (message) => toast(message, "error"), onCompleted: () => since !== null && markCheckoutPending(since) });
      } catch (error) {
        toast(error instanceof Error ? error.message : "Checkout could not open. Please try again.", "error");
      }
    });

  if (payState) return <PayStateNote state={payState} />;
  const only = soleMethod(methods);
  const click = offersChoice(methods) ? () => setChoosing(true) : only === "momo" ? payByMomo : payByCard;
  const label = offersChoice(methods) ? `Pay for ${planName}` : only === "momo" ? `Pay for ${planName} by Mobile Money` : `Pay for ${planName} by card`;
  return (
    <>
      <Button variant="outline" onClick={click} disabled={pending} leading={only === "card" ? <CreditCard aria-hidden className="size-4" /> : <Smartphone aria-hidden className="size-4" />}>
        {pending ? "One moment…" : label}
      </Button>
      <Dialog open={choosing} onOpenChange={setChoosing} title={`How would you like to pay for ${planName}?`} description="Card renews by itself every month. Mobile Money is paid by hand each month; we remind you before it ends.">
        <PayChoice methods={methods} momoNote={momoNote} cardNote={cardNote} onMomo={payByMomo} onCard={payByCard} disabled={pending} />
      </Dialog>
    </>
  );
}

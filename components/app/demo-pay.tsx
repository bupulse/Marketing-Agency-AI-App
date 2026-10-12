"use client";

import { Smartphone } from "lucide-react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, useToast } from "@/components/ui";
import { startMomoPayment } from "@/app/dashboard/billing/actions";

/**
 * "Pay now" on the demo lock screen: a company that does not want to wait for its demo starts a Mobile Money payment
 * for the plan it chose; the pay screen (components/billing/momo-payment.tsx) then takes over, and the dashboard
 * opens as soon as the owner confirms (docs/MOMO.md).
 */
export function DemoPayButton({ plan, planName }: { plan: string; planName: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const pay = () =>
    start(async () => {
      const result = await startMomoPayment({ plan, interval: "MONTH" });
      if (result.ok) router.refresh();
      else toast(result.error, "error");
    });
  return (
    <Button variant="outline" onClick={pay} disabled={pending} leading={<Smartphone aria-hidden className="size-4" />}>
      {pending ? "One moment…" : `Pay for ${planName} by Mobile Money`}
    </Button>
  );
}

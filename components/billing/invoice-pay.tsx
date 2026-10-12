"use client";

import { CreditCard, FileDown, Smartphone } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, GlassCard, useToast } from "@/components/ui";
import { useTheme } from "@/components/theme";
import { startCheckout, startMomoPayment } from "@/app/dashboard/billing/actions";
import { openCheckout } from "./checkout";

export type PayableInvoice = {
  id: string;
  number: string;
  total: string;
  dueDate: string;
  overdue: boolean;
  planLabel: string | null;
  planKey: string | null;
  interval: "MONTH" | "YEAR" | null;
};

/**
 * An invoice waiting to be paid (Billing page, and the lock screen while the account waits): the amount, the due date,
 * the PDF, and the two ways to pay. Mobile Money opens the usual pay screen with the invoice number as the reference
 * and the invoice total as the amount; card opens the checkout for the invoice's plan and interval (charged at the
 * card price of the plan).
 */
export function InvoicePay({ invoice, momo, card, highlight }: { invoice: PayableInvoice; momo: boolean; card: boolean; highlight?: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"momo" | "card" | null>(null);

  function payByMomo() {
    setBusy("momo");
    start(async () => {
      const result = await startMomoPayment({ invoiceId: invoice.id });
      setBusy(null);
      if (result.ok) router.refresh();
      else toast(result.error, "error");
    });
  }

  function payByCard() {
    if (!invoice.planKey || !invoice.interval) return;
    setBusy("card");
    start(async () => {
      const result = await startCheckout({ plan: invoice.planKey as string, interval: invoice.interval as string });
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
  }

  return (
    <GlassCard as="section" id={`invoice-${invoice.number}`} aria-labelledby="invoice-pay-heading" className={`flex flex-col gap-5 p-5 sm:p-6 ${highlight ? "ring-2 ring-pulse-blue" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-muted">Invoice {invoice.number}</span>
          <strong id="invoice-pay-heading" className="text-2xl tracking-[-0.02em]">
            {invoice.total}
          </strong>
          <span className="text-sm text-muted">
            {invoice.planLabel ? `${invoice.planLabel}. ` : ""}Due {invoice.dueDate}. Your plan switches on as soon as the payment is confirmed.
          </span>
        </div>
        <Badge tone={invoice.overdue ? "danger" : "blue"}>{invoice.overdue ? "Overdue" : "To pay"}</Badge>
      </div>
      <div className="flex flex-wrap gap-3">
        {momo && (
          <Button onClick={payByMomo} disabled={pending} leading={<Smartphone aria-hidden className="size-4" />}>
            {busy === "momo" ? "One moment…" : "Pay by Mobile Money"}
          </Button>
        )}
        {card && invoice.planKey && (
          <Button variant={momo ? "outline" : "primary"} onClick={payByCard} disabled={pending} leading={<CreditCard aria-hidden className="size-4" />}>
            {busy === "card" ? "Opening checkout…" : "Pay by card"}
          </Button>
        )}
        <a href={`/api/invoices/${encodeURIComponent(invoice.id)}/pdf`} className="glass inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium no-underline">
          <FileDown aria-hidden className="size-4" /> Download PDF
        </a>
      </div>
      {momo && <p className="text-xs text-muted">Mobile Money: use {invoice.number} as the reference. Card: charged in US dollars at the plan&apos;s card price, and renews by itself.</p>}
      {!momo && !card && <p className="text-sm text-muted">Online payment is not available for this invoice yet. Pay with the details on the PDF, using {invoice.number} as the reference.</p>}
    </GlassCard>
  );
}

"use client";

import { CreditCard, FileText, Smartphone } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, useToast } from "@/components/ui";
import { acceptOfferAction, payOfferByCardAction } from "@/app/dashboard/billing/actions";
import { methodReason, type MethodState } from "@/lib/billing/pay-methods";
import { useTheme } from "@/components/theme";
import { cardQuoteText, payByCard, type CardQuoteView } from "./card-checkout";

/**
 * Accept and pay buttons under the offer card. Mobile Money (where the region takes it) opens the pay screen for the
 * offer's price; invoice issues one from the offer; card opens a checkout for the price converted to US dollars (the
 * card rule of RWF plans, shown before paying). `card` is null when card cannot be used (not offered where the company
 * is, or card payments are not set up or switched off): the button is then not shown (docs/OFFERS.md, "Card").
 */
export function OfferActions({ offerId, momo: momoState, card, accepted, method }: { offerId: string; momo: MethodState; card: CardQuoteView | null; accepted: boolean; method: "momo" | "invoice" | "card" | null; contactEmail?: string }) {
  const momo = momoState === "ready";
  const router = useRouter();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"momo" | "invoice" | "card" | null>(null);
  const [quote, setQuote] = useState<CardQuoteView | null>(card);

  function cardPay() {
    if (!quote) return;
    setBusy("card");
    start(async () => {
      await payByCard(() => payOfferByCardAction({ offerId, expectedUsdCents: quote.usdCents }), resolvedTheme, {
        onRequote: (usdCents, message) => {
          setQuote({ ...quote, usdCents });
          setBusy(null);
          toast(message, "error");
        },
        onError: (message) => {
          setBusy(null);
          toast(message, "error");
        },
        onClosed: () => {
          setBusy(null);
          router.refresh();
        },
      });
    });
  }

  function accept(m: "momo" | "invoice") {
    setBusy(m);
    start(async () => {
      const result = await acceptOfferAction({ offerId, method: m });
      setBusy(null);
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      toast(m === "momo" ? "Offer accepted. Pay by Mobile Money below." : "Offer accepted. Your invoice is below and in your email.", "success");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-5">
      <div className="flex flex-wrap gap-2">
        {(accepted ? method !== "momo" : true) && (
          <Button onClick={() => accept("momo")} disabled={pending || !momo} leading={<Smartphone aria-hidden className="size-5" />}>
            {!momo ? methodReason("momo", momoState) : busy === "momo" ? "Opening…" : accepted ? "Pay by Mobile Money instead" : "Accept and pay by Mobile Money"}
          </Button>
        )}
        {(accepted ? method !== "invoice" : true) && (
          <Button variant={momo ? "outline" : "primary"} onClick={() => accept("invoice")} disabled={pending} leading={<FileText aria-hidden className="size-5" />}>
            {busy === "invoice" ? "Preparing…" : accepted ? "Get an invoice instead" : "Accept and get an invoice"}
          </Button>
        )}
        {quote && (
          <Button variant="outline" onClick={cardPay} disabled={pending} leading={<CreditCard aria-hidden className="size-5" />}>
            {busy === "card" ? "Opening checkout…" : "Pay by card"}
          </Button>
        )}
      </div>
      {quote && <p className="text-[13px] text-muted">{cardQuoteText(quote)}, charged in US dollars once (no subscription). Your custom plan switches on as soon as the payment goes through.</p>}
      {!accepted && <p className="text-[13px] text-muted">Nothing changes until your payment is confirmed. Your current plan and everything you have made stay as they are.</p>}
    </div>
  );
}

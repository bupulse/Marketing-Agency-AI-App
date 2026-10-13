"use client";

import { CreditCard, FileText, Smartphone } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, useToast } from "@/components/ui";
import { acceptOfferAction } from "@/app/dashboard/billing/actions";
import { methodReason, type MethodState } from "@/lib/billing/pay-methods";

/**
 * Accept and pay buttons under the offer card. Mobile Money (where the region takes it) opens the pay screen for the
 * offer's price; invoice issues one from the offer. Card cannot take a custom price yet, so it says how to get a card
 * link from the team instead (docs/OFFERS.md, "Card").
 */
export function OfferActions({ offerId, momo: momoState, card, accepted, method, contactEmail }: { offerId: string; momo: MethodState; card: boolean; accepted: boolean; method: "momo" | "invoice" | null; contactEmail: string }) {
  const momo = momoState === "ready";
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"momo" | "invoice" | null>(null);
  const [cardHelp, setCardHelp] = useState(false);

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
        <Button variant="outline" onClick={() => setCardHelp((v) => !v)} disabled={!card} aria-expanded={cardHelp} leading={<CreditCard aria-hidden className="size-5" />}>
          {card ? "Pay by card" : methodReason("card", "off")}
        </Button>
      </div>
      {cardHelp && (
        <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm">
          Card payment for a custom plan is set up by our team. Ask us for a card link at{" "}
          <a href={`mailto:${contactEmail}?subject=${encodeURIComponent("Card link for my custom plan")}`} className="font-semibold underline">
            {contactEmail}
          </a>{" "}
          and we will send it to you.
        </p>
      )}
      {!accepted && <p className="text-[13px] text-muted">Nothing changes until your payment is confirmed. Your current plan and everything you have made stay as they are.</p>}
    </div>
  );
}

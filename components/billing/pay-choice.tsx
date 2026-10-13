"use client";

import { CreditCard, Smartphone } from "lucide-react";
import { CARD_SOON, MOMO_SOON, type PayMethods } from "@/lib/billing/pay-methods";

type Props = {
  methods: PayMethods;
  /** One line under each option when it is ready: the amount and how it renews. */
  momoNote: string;
  cardNote: string;
  /** Overrides the card line and disables it (e.g. "Available at your next renewal."). */
  cardBlocked?: string | null;
  onMomo: () => void;
  onCard: () => void;
  disabled?: boolean;
};

/**
 * "How would you like to pay?": Mobile Money (MTN / Airtel) and Card side by side, wherever the company's region takes
 * both (lib/billing/pay-methods.ts). A method that is not set up yet stays visible, disabled, as "coming soon".
 */
export function PayChoice({ methods, momoNote, cardNote, cardBlocked, onMomo, onCard, disabled }: Props) {
  const tile =
    "glass flex min-h-11 cursor-pointer flex-col items-start gap-2 rounded-2xl p-4 text-left transition-colors hover:bg-soft disabled:cursor-not-allowed disabled:opacity-60";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {methods.momo !== "off" && (
        <button type="button" onClick={onMomo} disabled={disabled || methods.momo !== "ready"} className={tile}>
          <Smartphone aria-hidden className="size-5 text-pulse-blue" />
          <strong>Mobile Money (MTN / Airtel)</strong>
          <span className="text-sm text-muted">{methods.momo === "ready" ? momoNote : MOMO_SOON}</span>
        </button>
      )}
      {methods.card !== "off" && (
        <button type="button" onClick={onCard} disabled={disabled || methods.card !== "ready" || Boolean(cardBlocked)} className={tile}>
          <CreditCard aria-hidden className="size-5 text-pulse-violet" />
          <strong>Card</strong>
          <span className="text-sm text-muted">{methods.card !== "ready" ? CARD_SOON : (cardBlocked ?? cardNote)}</span>
        </button>
      )}
    </div>
  );
}

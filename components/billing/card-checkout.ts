"use client";

import { formatMinor } from "@/lib/region-format";
import type { CheckoutConfig } from "@/lib/billing/types";
import { openCheckout } from "./checkout";

/** What an offer or added features cost by card, as the client sees it before paying (lib/offers/shared.ts offerCardQuote). */
export type CardQuoteView = { usdCents: number; quoteMinor: number; currency: string };

/** "≈ $24 by card (RWF 32,000)"; a USD price (GLOBAL) is just "$49 by card". */
export function cardQuoteText(q: CardQuoteView): string {
  const usd = formatMinor(q.usdCents, "USD");
  return q.currency.toUpperCase() === "USD" ? `${usd} by card` : `≈ ${usd} by card (${formatMinor(q.quoteMinor, q.currency)})`;
}

type CardStart = () => Promise<({ ok: true; config?: CheckoutConfig } | { ok: false; error: string }) & { requoteUsdCents?: number }>;

/**
 * Runs a card payment: asks the server for the checkout (which re-quotes; a new amount comes back as `requoteUsdCents`
 * for the client to confirm), then opens it. Calls `onRequote` with the new amount, `onError` with a message.
 */
export async function payByCard(startOnServer: CardStart, theme: "light" | "dark", h: { onRequote: (usdCents: number, message: string) => void; onError: (message: string) => void; onClosed: () => void }) {
  const result = await startOnServer();
  if (!result.ok) {
    if (result.requoteUsdCents) h.onRequote(result.requoteUsdCents, result.error);
    else h.onError(result.error);
    return;
  }
  if (!result.config) return h.onError("Card payments are not available right now. Please try again.");
  try {
    await openCheckout(result.config, theme, { onClosed: h.onClosed, onError: h.onError });
  } catch (error) {
    h.onError(error instanceof Error ? error.message : "Checkout could not open. Please try again.");
  }
}

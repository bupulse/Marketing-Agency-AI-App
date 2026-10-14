// A card checkout that went through but whose webhook has not switched the plan on yet (docs/BILLING.md). The provider
// confirms by webhook, which can take a moment; meanwhile the client must see "payment received" and no pay buttons,
// or they pay twice. The browser keeps the checkout's start time in a cookie (set when the checkout completes or on the
// return URL ?checkout=success&since=…) so the server can hide the buttons on any page; it only hides and waits, it
// never switches anything on (the webhook stays the source of truth). Pure: the server and the browser share it.

export const CHECKOUT_PENDING_COOKIE = "bp-checkout-pending";

/** How long after a completed checkout the pay buttons stay hidden while the plan is not on yet. */
export const CHECKOUT_PENDING_MS = 30 * 60_000;

/** Paddle events that say money arrived or a subscription started: a recent one means "switching on", not "pay". */
export const CARD_PAID_EVENTS = ["transaction.completed", "transaction.paid", "subscription.created", "subscription.activated"] as const;

/** The checkout's start time (ms) when `value` is one from the last CHECKOUT_PENDING_MS, else null. */
export function checkoutPendingSince(value: string | null | undefined, now: number): number | null {
  if (!value || !/^\d{10,15}$/.test(value)) return null;
  const since = Number(value);
  // A little clock drift is fine; a time far in the future or older than the window is ignored.
  if (since > now + 5 * 60_000 || now - since > CHECKOUT_PENDING_MS) return null;
  return since;
}

/** `since` from a checkout success URL (…/dashboard/billing?checkout=success&since=1760000000000), or null. */
export function sinceOfSuccessUrl(url: string): number | null {
  try {
    const value = new URL(url, "http://x").searchParams.get("since");
    return value && /^\d{10,15}$/.test(value) ? Number(value) : null;
  } catch {
    return null;
  }
}

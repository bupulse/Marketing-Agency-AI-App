// How a client can pay, at every pay entry point (Billing plans, the lock screens, offers, invoices, renewals). Pure,
// so the client components and the tests share it (docs/BILLING.md, "Choosing how to pay").
//
// A method the company's region lists (PricingRegion.paymentMethods) is always shown: "ready" when it can be used now,
// "soon" (shown disabled, "coming soon") when it is not set up yet. A method the region does not list is "off" (hidden).
// Mobile Money is ready once the owner has said where to pay (Admin -> Payments). Card is ready once the card provider
// is configured and switched on AND the plan has a provider price for the company's region and interval (GLOBAL: the
// plan's own Paddle ids; Rwanda and the other regions: PlanRegionPrice.paddle*PriceId, written by
// `npm run paddle:setup -- --regions`).

export type MethodState = "ready" | "soon" | "off";
export type PayMethods = { momo: MethodState; card: MethodState };

export function methodState(listed: boolean, ready: boolean): MethodState {
  return !listed ? "off" : ready ? "ready" : "soon";
}

/** The two methods for one thing to pay. `cardPriced` is whether that plan and interval has a card price in the region. */
export function payMethods(input: { regionMethods: readonly string[]; momoConfigured: boolean; cardConfigured: boolean; cardPriced: boolean; momoPriced?: boolean }): PayMethods {
  return {
    momo: methodState(input.regionMethods.includes("momo"), input.momoConfigured && input.momoPriced !== false),
    card: methodState(input.regionMethods.includes("card"), input.cardConfigured && input.cardPriced),
  };
}

/** The client is asked "Mobile Money or Card?" whenever the region lists both, even when one of them is not ready yet. */
export function offersChoice(m: PayMethods): boolean {
  return m.momo !== "off" && m.card !== "off";
}

/** What one click pays with when there is no choice to make: the only ready method, or null (nothing can be paid yet). */
export function soleMethod(m: PayMethods): "momo" | "card" | null {
  if (offersChoice(m)) return null;
  if (m.momo === "ready") return "momo";
  if (m.card === "ready") return "card";
  return null;
}

export const CARD_SOON = "Card payments coming soon";
export const MOMO_SOON = "Mobile Money coming soon";

/** Card prices per plan and interval, as the server computed them for the company's region. */
export type CardPriced = Record<string, { MONTH: boolean; YEAR: boolean }>;

import type { BillingInterval, BillingProvider, SubscriptionStatus } from "@/lib/generated/prisma/client";
import type { PaidPlan } from "./catalog";

/** A subscription as the provider reports it, translated to our terms. */
export type ProviderSubscription = {
  providerSubscriptionId: string;
  providerCustomerId: string;
  providerPriceId: string;
  /** Our user id from the checkout custom data. Not trusted until `userIdSignature` verifies. */
  userId: string | null;
  userIdSignature: string | null;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** When the provider last changed it; older updates arriving late are ignored. */
  updatedAt: Date | null;
  /**
   * Features added to a card plan (docs/OFFERS.md): the subscription's recurring items marked as added features, read
   * from their price's custom data. Not trusted until the signature verifies (lib/offers/card-plan.ts).
   */
  addons?: ProviderAddonItem[];
};

/** An added feature's recurring item on a card subscription, as the provider reports it. */
export type ProviderAddonItem = { priceId: string; key: string | null; offerId: string | null; userId: string | null; sig: string | null; amountCents: number | null };

/** A recurring item to add to a card subscription: a price that exists only on it (not in the provider's catalog). */
export type NewRecurringItem = { name: string; description: string; amountCents: number; currency: "USD"; interval: "MONTH" | "YEAR"; customData: Record<string, string | number> };

/** A verified webhook, translated to what BuPulse needs to do. */
export type BillingWebhook = {
  eventId: string;
  type: string;
  userId: string | null;
  payload: unknown;
  /** Present when the event changes a subscription. */
  subscription?: ProviderSubscription;
};

/** What the browser needs to open the provider's checkout. */
export type CheckoutConfig = {
  provider: BillingProvider;
  environment: "sandbox" | "production";
  clientToken: string;
  priceId: string;
  customerEmail: string;
  /** The provider's customer when they bought before, so a second customer isn't created. */
  customerId: string | null;
  /** `sig` is the server's signature of userId (lib/billing/signing.ts). */
  customData: { userId: string; sig: string; plan: PaidPlan; interval: BillingInterval } | Record<string, string | number>;
  /** A one-off payment (a custom plan offer or added features, lib/offers/card.ts): open this transaction, not a price. */
  transactionId?: string | null;
  successUrl: string;
};

export type Invoice = {
  id: string;
  date: Date;
  amount: string; // formatted, e.g. "$49.00"
  status: string;
  /** Opens a PDF receipt/invoice, when the provider has one. */
  url: string | null;
};

/** Everything a payment provider must do. Paddle is the first; Stripe/PayPal add their own. */
export interface BillingAdapter {
  provider: BillingProvider;
  /** Whether the keys for this provider are configured. */
  isConfigured(): Promise<boolean>;
  checkoutConfig(input: {
    userId: string;
    email: string;
    plan: PaidPlan;
    interval: BillingInterval;
    /** Existing customer at this provider, so they are not created twice. */
    providerCustomerId?: string | null;
    /** The price to charge when it is not the plan's own (a region's price, lib/region-prices.ts). */
    priceId?: string | null;
  }): Promise<CheckoutConfig>;
  /** A link to the provider's page where the customer updates their card or cancels. */
  portalUrl(input: { providerCustomerId: string; providerSubscriptionId?: string | null }): Promise<string>;
  cancelAtPeriodEnd(providerSubscriptionId: string): Promise<ProviderSubscription>;
  /** Ends a subscription straight away (used for an accidental second subscription). */
  cancelNow(providerSubscriptionId: string): Promise<ProviderSubscription>;
  resume(providerSubscriptionId: string): Promise<ProviderSubscription>;
  /** Switch plan or interval; charges/credits the difference now. Added features (recurring items) end with it. */
  changePlan(providerSubscriptionId: string, priceId: string): Promise<ProviderSubscription>;
  /**
   * Adds recurring items (features added to a card plan) to the subscription, keeping its items, and charges them now
   * prorated for the rest of the period; nothing changes when that payment fails. Optional: without it, features are
   * not added to card plans here.
   */
  addRecurringItems?(providerSubscriptionId: string, items: NewRecurringItem[]): Promise<ProviderSubscription>;
  /** The subscription as the provider has it now (to settle a change whose answer was lost). */
  getSubscription?(providerSubscriptionId: string): Promise<ProviderSubscription>;
  /**
   * Moves the next charge to `at` without billing for the extra days (a card renewal of a plan still paid by Mobile
   * Money keeps the paid days, docs/BILLING.md "Renewing"). Optional: a provider without it simply starts billing now.
   */
  deferNextBilling?(providerSubscriptionId: string, at: Date): Promise<ProviderSubscription>;
  /**
   * A one-off charge of an amount set by the server (not a catalog price): the custom plan offers and added features
   * paid by card (lib/offers/card.ts). Returns the provider's transaction id for the checkout to open.
   */
  createOneOffTransaction?(input: { amountCents: number; currency: "USD"; name: string; description: string; customData: Record<string, string | number>; providerCustomerId?: string | null }): Promise<{ transactionId: string }>;
  listInvoices(providerCustomerId: string): Promise<Invoice[]>;
  /** Verifies the signature; returns null when the request is not genuine. */
  parseWebhook(rawBody: string, headers: Headers): Promise<BillingWebhook | null>;
}

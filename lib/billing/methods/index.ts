import "server-only";
import { manualMomo } from "./manual-momo";
import type { PaymentMethodAdapter, PaymentMethodKey } from "./types";

// The registry of payment methods beside the card checkout. An automatic Mobile Money provider is added here with
// its adapter and the URL slug its webhooks use (docs/MOMO.md, "Adding an automatic provider"):
//   const ADAPTERS = { MANUAL_MOMO: manualMomo, PAYPACK: paypack };
//   const WEBHOOK_SLUGS = { paypack: "PAYPACK" };
const ADAPTERS: Record<PaymentMethodKey, PaymentMethodAdapter> = { MANUAL_MOMO: manualMomo };

/** URL slug of /api/billing/webhooks/[provider] -> method. Empty until an automatic provider exists. */
const WEBHOOK_SLUGS: Partial<Record<string, PaymentMethodKey>> = {};

export function paymentMethod(method: PaymentMethodKey = "MANUAL_MOMO"): PaymentMethodAdapter {
  return ADAPTERS[method];
}

/** The adapter whose webhooks arrive at /api/billing/webhooks/<slug>, or null (the route answers 404). */
export function webhookAdapterFor(slug: string): PaymentMethodAdapter | null {
  const key = WEBHOOK_SLUGS[slug.toLowerCase()];
  const adapter = key ? ADAPTERS[key] : null;
  return adapter?.parseWebhook ? adapter : null;
}

export type { PaymentMethodAdapter, PaymentMethodKey, PaymentWebhook } from "./types";

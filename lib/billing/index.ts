import "server-only";
import type { BillingProvider } from "@/lib/generated/prisma/client";
import { paddle } from "./paddle";
import type { BillingAdapter } from "./types";

const ADAPTERS: Partial<Record<BillingProvider, BillingAdapter>> = { PADDLE: paddle };

/** The provider new customers check out with (BILLING_PROVIDER, default Paddle). */
export function activeProvider(): BillingProvider {
  const value = (process.env.BILLING_PROVIDER ?? "PADDLE").toUpperCase();
  return value === "STRIPE" || value === "PAYPAL" ? value : "PADDLE";
}

/** The adapter for a provider (an existing subscription keeps the provider it was bought with). */
export function billingAdapter(provider: BillingProvider = activeProvider()): BillingAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`Billing provider ${provider} is not available yet`);
  return adapter;
}

export * from "./catalog";
export type * from "./types";

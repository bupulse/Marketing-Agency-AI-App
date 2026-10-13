import "server-only";
import { paddleApi } from "./paddle";
import { getPaddleConfig } from "./paddle-config";

// Paddle Billing calls the plan builder needs: products and prices (created, never edited in place; old prices are
// archived), and a subscription's item swap that bills nothing now (the new price starts with the next renewal).

/** True when a Paddle API key is set (Admin -> Settings, or PADDLE_API_KEY). Without one, plans can still be drafted; they are synced later. */
export async function paddleConnected(): Promise<boolean> {
  return Boolean((await getPaddleConfig()).apiKey);
}

export async function createPaddleProduct(input: { name: string; description: string; planKey: string }): Promise<string> {
  const product = await paddleApi<{ id: string }>("/products", {
    method: "POST",
    body: {
      name: input.name,
      description: input.description || undefined,
      tax_category: "saas",
      custom_data: { planKey: input.planKey },
    },
  });
  return product.id;
}

export async function updatePaddleProduct(productId: string, input: { name: string; description: string }): Promise<void> {
  await paddleApi(`/products/${encodeURIComponent(productId)}`, { method: "PATCH", body: { name: input.name, description: input.description || null } });
}

export async function createPaddlePrice(input: { productId: string; planKey: string; planName: string; interval: "MONTH" | "YEAR"; amountCents: number; currency: string }): Promise<string> {
  const price = await paddleApi<{ id: string }>("/prices", {
    method: "POST",
    body: {
      product_id: input.productId,
      description: `${input.planName} (${input.interval === "YEAR" ? "yearly" : "monthly"})`,
      unit_price: { amount: String(input.amountCents), currency_code: input.currency },
      billing_cycle: { interval: input.interval === "YEAR" ? "year" : "month", frequency: 1 },
      tax_mode: "account_setting",
      custom_data: { planKey: input.planKey },
    },
  });
  return price.id;
}

export async function archivePaddlePrice(priceId: string): Promise<void> {
  await paddleApi(`/prices/${encodeURIComponent(priceId)}`, { method: "PATCH", body: { status: "archived" } });
}

export type PaddleSubscriptionInfo = {
  status: string;
  priceId: string | null;
  nextBilledAt: Date | null;
  periodEnd: Date | null;
  cancelScheduled: boolean;
};

const toDate = (v: unknown) => (typeof v === "string" && !Number.isNaN(new Date(v).getTime()) ? new Date(v) : null);

export async function getPaddleSubscription(subscriptionId: string): Promise<PaddleSubscriptionInfo> {
  const s = await paddleApi<{
    status?: string;
    next_billed_at?: string | null;
    items?: { price?: { id?: string } | null }[] | null;
    current_billing_period?: { ends_at?: string } | null;
    scheduled_change?: { action?: string } | null;
  }>(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
  return {
    status: String(s.status ?? ""),
    priceId: s.items?.[0]?.price?.id ?? null,
    nextBilledAt: toDate(s.next_billed_at),
    periodEnd: toDate(s.current_billing_period?.ends_at),
    cancelScheduled: s.scheduled_change?.action === "cancel" || s.scheduled_change?.action === "pause",
  };
}

/**
 * Swaps the subscription's price without billing anything now or crediting anything (proration "do_not_bill").
 * Paddle has no price change that waits for a future date, so this is called shortly before the renewal; the
 * renewal then bills the new price. Returns the updated subscription entity (for applyProviderSubscription).
 */
export async function swapSubscriptionPrice(subscriptionId: string, priceId: string): Promise<unknown> {
  return paddleApi(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "PATCH",
    body: { items: [{ price_id: priceId, quantity: 1 }], proration_billing_mode: "do_not_bill", on_payment_failure: "prevent_change" },
  });
}

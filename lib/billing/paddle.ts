import "server-only";
import { siteUrl } from "@/lib/auth/site-url";
import { priceIdFor } from "@/lib/plan-catalog";
import { formatMoney, isUuid, mapSubscription, verifySignature } from "./paddle-map";
import { signCheckoutUser } from "./signing";
import type { BillingAdapter, BillingWebhook, Invoice, ProviderSubscription } from "./types";

function environment(): "sandbox" | "production" {
  return process.env.PADDLE_ENVIRONMENT === "production" ? "production" : "sandbox";
}

function baseUrl() {
  return environment() === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
}

function requireEnv(name: "PADDLE_API_KEY" | "PADDLE_CLIENT_TOKEN" | "PADDLE_WEBHOOK_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new Error(`Paddle is not configured: ${name} is missing`);
  return value;
}

// Calls the Paddle Billing API. Errors carry Paddle's error code and detail, never the key.
export async function paddleApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${requireEnv("PADDLE_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = (await response.json().catch(() => null)) as { data?: T; error?: { code?: string; detail?: string } } | null;
  if (!response.ok || !json || json.data === undefined) {
    throw new Error(`Paddle API ${response.status} on ${path}: ${json?.error?.code ?? "unknown"} ${json?.error?.detail ?? ""}`.trim());
  }
  return json.data;
}

function subscriptionOrThrow(data: unknown): ProviderSubscription {
  const sub = mapSubscription(data);
  if (!sub) throw new Error("Paddle returned a subscription BuPulse could not read");
  return sub;
}

type Transaction = {
  id: string;
  status: string;
  billed_at: string | null;
  created_at: string;
  currency_code: string;
  details?: { totals?: { grand_total?: string; total?: string } };
};

/** A fresh link to the PDF invoice. Paddle's links expire after an hour, so fetch on click. */
export async function invoiceUrl(transactionId: string): Promise<string> {
  const data = await paddleApi<{ url: string }>(`/transactions/${encodeURIComponent(transactionId)}/invoice`);
  return data.url;
}

export const paddle: BillingAdapter = {
  provider: "PADDLE",

  isConfigured() {
    return Boolean(process.env.PADDLE_API_KEY && process.env.PADDLE_CLIENT_TOKEN && process.env.PADDLE_WEBHOOK_SECRET);
  },

  async checkoutConfig({ userId, email, plan, interval, providerCustomerId }) {
    const priceId = await priceIdFor("PADDLE", plan, interval);
    if (!priceId) throw new Error(`Paddle price id missing for plan ${plan} (${interval}): sync the plan with Paddle in /admin/plans`);
    return {
      provider: "PADDLE",
      environment: environment(),
      clientToken: requireEnv("PADDLE_CLIENT_TOKEN"),
      priceId,
      customerEmail: email,
      customerId: providerCustomerId ?? null,
      customData: { userId, sig: await signCheckoutUser(userId), plan, interval },
      // `since` lets the billing page wait for this purchase, not an older plan change.
      successUrl: `${siteUrl()}/dashboard/billing?checkout=success&since=${Date.now()}`,
    };
  },

  async portalUrl({ providerCustomerId, providerSubscriptionId }) {
    const data = await paddleApi<{ urls: { general: { overview: string } } }>(
      `/customers/${encodeURIComponent(providerCustomerId)}/portal-sessions`,
      { method: "POST", body: providerSubscriptionId ? { subscription_ids: [providerSubscriptionId] } : {} },
    );
    return data.urls.general.overview;
  },

  async cancelAtPeriodEnd(id) {
    const data = await paddleApi(`/subscriptions/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: { effective_from: "next_billing_period" },
    });
    return subscriptionOrThrow(data);
  },

  async cancelNow(id) {
    const data = await paddleApi(`/subscriptions/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: { effective_from: "immediately" },
    });
    return subscriptionOrThrow(data);
  },

  async resume(id) {
    // Clearing the scheduled change undoes a pending cancellation.
    const data = await paddleApi(`/subscriptions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { scheduled_change: null },
    });
    return subscriptionOrThrow(data);
  },

  async changePlan(id, priceId) {
    const data = await paddleApi(`/subscriptions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: {
        items: [{ price_id: priceId, quantity: 1 }],
        proration_billing_mode: "prorated_immediately",
        on_payment_failure: "prevent_change",
      },
    });
    return subscriptionOrThrow(data);
  },

  /** Invoice `url` is null here (links expire); resolve one on demand with invoiceUrl(id). */
  async listInvoices(customerId): Promise<Invoice[]> {
    const query = new URLSearchParams({
      customer_id: customerId,
      status: "billed,completed",
      order_by: "billed_at[DESC]",
      per_page: "30",
    });
    const transactions = await paddleApi<Transaction[]>(`/transactions?${query}`);
    return transactions.map((t) => ({
      id: t.id,
      date: new Date(t.billed_at ?? t.created_at),
      amount: formatMoney(t.details?.totals?.grand_total ?? t.details?.totals?.total ?? "0", t.currency_code),
      status: t.status,
      url: null,
    }));
  },

  async parseWebhook(rawBody, headers): Promise<BillingWebhook | null> {
    const secret = requireEnv("PADDLE_WEBHOOK_SECRET");
    if (!(await verifySignature(rawBody, headers.get("paddle-signature"), secret))) return null;

    let event: { event_id?: unknown; event_type?: unknown; data?: unknown };
    try {
      event = JSON.parse(rawBody);
    } catch {
      return null;
    }
    if (typeof event.event_id !== "string" || typeof event.event_type !== "string") return null;

    const isSubscriptionEvent = event.event_type.startsWith("subscription.");
    const subscription = isSubscriptionEvent ? (mapSubscription(event.data) ?? undefined) : undefined;
    const customUserId = (event.data as { custom_data?: { userId?: unknown } } | null)?.custom_data?.userId;
    return {
      eventId: event.event_id,
      type: event.event_type,
      userId: subscription?.userId ?? (isUuid(customUserId) ? customUserId : null),
      payload: event,
      subscription,
    };
  },
};

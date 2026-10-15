import "server-only";
import { priceIdFor } from "@/lib/plan-catalog";
import { formatMoney, isUuid, mapSubscription, subscriptionItemsOf, verifySignature } from "./paddle-map";
import { signCheckoutUser } from "./signing";
import type { BillingAdapter, BillingWebhook, Invoice, ProviderSubscription } from "./types";
import { getPaddleConfig, paddleApiBase, paddleCredentialsComplete, SECRET_LABEL, type PaddleEnvironment } from "./paddle-config";
import { linkSiteUrl } from "@/lib/auth/request-site";

// Credentials: Admin -> Settings -> Card payments (Paddle), else the PADDLE_* environment variables (lib/billing/paddle-config.ts).
async function required(name: "apiKey" | "clientToken" | "webhookSecret"): Promise<string> {
  const value = (await getPaddleConfig())[name];
  if (!value) throw new Error(`Paddle is not configured: ${SECRET_LABEL[name].toLowerCase()} is missing`);
  return value;
}

// Calls the Paddle Billing API. Errors carry Paddle's error code and detail, never the key. `credentials` overrides the
// saved ones (the settings page's "Test connection" of values being typed).
export async function paddleApi<T>(path: string, init: { method?: string; body?: unknown; credentials?: { apiKey: string; environment: PaddleEnvironment } } = {}): Promise<T> {
  const config = init.credentials ? null : await getPaddleConfig();
  const environment = init.credentials?.environment ?? config!.environment;
  const apiKey = init.credentials?.apiKey ?? (await required("apiKey"));
  const response = await fetch(`${paddleApiBase(environment)}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
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

/** A stored or verified Paddle event, translated to what BuPulse needs to do (also used to reprocess a stored event). */
export function webhookFromEvent(event: { event_id: string; event_type: string; data?: unknown }): BillingWebhook {
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
}

export const paddle: BillingAdapter = {
  provider: "PADDLE",

  async isConfigured() {
    return paddleCredentialsComplete(await getPaddleConfig());
  },

  async checkoutConfig({ userId, email, plan, interval, providerCustomerId, priceId: given }) {
    const priceId = given ?? (await priceIdFor("PADDLE", plan, interval));
    if (!priceId) throw new Error(`Paddle price id missing for plan ${plan} (${interval}): sync the plan with Paddle in /admin/plans`);
    return {
      provider: "PADDLE",
      environment: (await getPaddleConfig()).environment,
      clientToken: await required("clientToken"),
      priceId,
      customerEmail: email,
      customerId: providerCustomerId ?? null,
      customData: { userId, sig: await signCheckoutUser(userId), plan, interval },
      // `since` lets the billing page wait for this purchase, not an older plan change.
      successUrl: `${await linkSiteUrl()}/dashboard/billing?checkout=success&since=${Date.now()}`,
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

  // Features added to a card plan (docs/OFFERS.md): Paddle replaces the whole item list, so every current item is sent
  // back by its price id, plus one price per added feature that exists only on this subscription (nothing is added to
  // the catalog), marked in its custom data. Charged now, prorated; with prevent_change nothing changes when that
  // payment fails (Paddle answers with an error instead).
  async addRecurringItems(id, items) {
    const current = await paddleApi<{ currency_code?: string }>(`/subscriptions/${encodeURIComponent(id)}`);
    const keep = subscriptionItemsOf(current).map((i) => ({ price_id: i.priceId, quantity: i.quantity }));
    if (keep.length === 0) throw new Error("Paddle returned a subscription without items");
    if (items.some((i) => i.currency !== current.currency_code)) throw new Error(`The subscription is billed in ${current.currency_code ?? "another currency"}, not ${items[0]?.currency}`);
    const data = await paddleApi(`/subscriptions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: {
        items: [
          ...keep,
          ...items.map((i) => ({
            quantity: 1,
            price: {
              name: i.name,
              description: i.description,
              billing_cycle: { interval: i.interval === "YEAR" ? "year" : "month", frequency: 1 },
              unit_price: { amount: String(i.amountCents), currency_code: i.currency },
              quantity: { minimum: 1, maximum: 1 },
              product: { name: i.name, tax_category: "saas" },
              custom_data: i.customData,
            },
          })),
        ],
        proration_billing_mode: "prorated_immediately",
        on_payment_failure: "prevent_change",
      },
    });
    return subscriptionOrThrow(data);
  },

  // A feature removed from a card plan: every other item is sent back by its price id. prorated_immediately credits the
  // removed item's unused part at once (Paddle puts it on the customer's credit balance, which pays the next bills).
  async removeRecurringItems(id, priceIds) {
    const all = subscriptionItemsOf(await paddleApi(`/subscriptions/${encodeURIComponent(id)}`));
    const keep = all.filter((i) => !priceIds.includes(i.priceId)).map((i) => ({ price_id: i.priceId, quantity: i.quantity }));
    if (keep.length === all.length) throw new Error("Those items are not on the subscription any more");
    if (keep.length === 0) throw new Error("A subscription keeps at least its plan");
    const data = await paddleApi(`/subscriptions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { items: keep, proration_billing_mode: "prorated_immediately", on_payment_failure: "prevent_change" },
    });
    return subscriptionOrThrow(data);
  },

  async getSubscription(id) {
    return subscriptionOrThrow(await paddleApi(`/subscriptions/${encodeURIComponent(id)}`));
  },

  async deferNextBilling(id, at) {
    const data = await paddleApi(`/subscriptions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { next_billed_at: at.toISOString(), proration_billing_mode: "do_not_bill" },
    });
    return subscriptionOrThrow(data);
  },

  // A non-catalog item: the price (and its product) live only on this transaction, nothing is added to the catalog.
  // Paddle.js opens it by id; the amount cannot be changed in the browser.
  async createOneOffTransaction({ amountCents, currency, name, description, customData, providerCustomerId }) {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("The card amount must be a whole number of cents above zero.");
    const data = await paddleApi<{ id: string }>("/transactions", {
      method: "POST",
      body: {
        items: [
          {
            quantity: 1,
            price: {
              description,
              name,
              unit_price: { amount: String(amountCents), currency_code: currency },
              // Exactly one: without this Paddle's checkout shows a quantity picker (1 to 100 by default).
              quantity: { minimum: 1, maximum: 1 },
              product: { name, tax_category: "standard" },
            },
          },
        ],
        ...(providerCustomerId ? { customer_id: providerCustomerId } : {}),
        custom_data: customData,
        collection_mode: "automatic",
      },
    });
    if (!data?.id) throw new Error("Paddle returned no transaction id");
    return { transactionId: data.id };
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
    const secret = await required("webhookSecret");
    if (!(await verifySignature(rawBody, headers.get("paddle-signature"), secret))) return null;

    let event: { event_id?: unknown; event_type?: unknown; data?: unknown };
    try {
      event = JSON.parse(rawBody);
    } catch {
      return null;
    }
    if (typeof event.event_id !== "string" || typeof event.event_type !== "string") return null;

    return webhookFromEvent(event as { event_id: string; event_type: string; data?: unknown });
  },
};

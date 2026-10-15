import type { SubscriptionStatus } from "@/lib/generated/prisma/client";
import { CARD_ADDON_KIND } from "@/lib/offers/shared";
import type { ProviderAddonItem, ProviderSubscription } from "./types";

// Pure helpers for Paddle Billing (v2): status mapping, subscription translation, money
// formatting and webhook signature checks. No network or database access here.

/** Webhook events that change a subscription. The setup script subscribes to the same list. */
export const SUBSCRIPTION_EVENTS = [
  "subscription.created",
  "subscription.updated",
  "subscription.activated",
  "subscription.canceled",
  "subscription.past_due",
  "subscription.paused",
  "subscription.resumed",
] as const;

/** Webhooks older than this are rejected, which stops replays of captured requests. */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * Paddle status -> ours. "paused" maps to PAST_DUE: the customer stopped paying (or we paused
 * billing), so the account is limited like a failed payment - nothing is deleted, no new
 * generations - and it recovers when the subscription resumes. "canceled" is final.
 */
export function mapStatus(status: unknown): SubscriptionStatus | null {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
    case "paused":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    default:
      return null;
  }
}

type PaddleSubscription = {
  id?: unknown;
  status?: unknown;
  customer_id?: unknown;
  started_at?: unknown;
  canceled_at?: unknown;
  updated_at?: unknown;
  items?: PaddleItem[] | null;
  custom_data?: { userId?: unknown; sig?: unknown } | null;
  current_billing_period?: { starts_at?: unknown; ends_at?: unknown } | null;
  scheduled_change?: { action?: unknown; effective_at?: unknown } | null;
};

type PaddleItem = { quantity?: unknown; price?: { id?: unknown; custom_data?: Record<string, unknown> | null; unit_price?: { amount?: unknown } | null } | null };

const isAddonItem = (item: PaddleItem | null | undefined) => item?.price?.custom_data?.kind === CARD_ADDON_KIND;
const text = (v: unknown) => (typeof v === "string" && v ? v : null);

/** An added feature's item (docs/OFFERS.md, "Adding features to a card plan"), read from its price's custom data. */
function addonOf(item: PaddleItem): ProviderAddonItem | null {
  const id = item.price?.id;
  if (typeof id !== "string") return null;
  const c = item.price?.custom_data ?? {};
  const amount = Number(item.price?.unit_price?.amount);
  return { priceId: id, key: text(c.key), offerId: text(c.offerId), userId: text(c.userId), sig: text(c.sig), amountCents: Number.isSafeInteger(amount) ? amount : null };
}

function addonsOf(items: PaddleItem[]): { addons?: ProviderAddonItem[] } {
  const addons = items.filter(isAddonItem).map(addonOf).filter((a): a is ProviderAddonItem => a !== null);
  return addons.length > 0 ? { addons } : {};
}

/**
 * The items of a Paddle subscription as they must be sent back when it is updated (Paddle replaces the whole list):
 * each price id with its quantity, the plan first.
 */
export function subscriptionItemsOf(data: unknown): { priceId: string; quantity: number; addon: boolean }[] {
  const items = (data && typeof data === "object" ? (data as PaddleSubscription).items : null) ?? [];
  return items
    .filter((i): i is PaddleItem & { price: { id: string } } => typeof i?.price?.id === "string")
    .map((i) => ({ priceId: i.price.id, quantity: typeof i.quantity === "number" && Number.isInteger(i.quantity) && i.quantity > 0 ? i.quantity : 1, addon: isAddonItem(i) }))
    .sort((a, b) => Number(a.addon) - Number(b.addon));
}

function toDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Translates a Paddle subscription entity; null when it lacks what we need. */
export function mapSubscription(data: unknown, now: Date = new Date()): ProviderSubscription | null {
  if (!data || typeof data !== "object") return null;
  const sub = data as PaddleSubscription;
  const status = mapStatus(sub.status);
  // The plan's own price: the first item that is not a feature added to the card plan (those can come in any order).
  const items = sub.items ?? [];
  const priceId = (items.find((i) => !isAddonItem(i)) ?? items[0])?.price?.id;
  if (!status || typeof sub.id !== "string" || typeof sub.customer_id !== "string" || typeof priceId !== "string") {
    return null;
  }
  const scheduled = sub.scheduled_change;
  // A canceled subscription has no billing period; fall back to the cancellation dates.
  const start =
    toDate(sub.current_billing_period?.starts_at) ?? toDate(sub.started_at) ?? now;
  const end =
    toDate(sub.current_billing_period?.ends_at) ??
    toDate(scheduled?.effective_at) ??
    toDate(sub.canceled_at);
  return {
    providerSubscriptionId: sub.id,
    providerCustomerId: sub.customer_id,
    providerPriceId: priceId,
    userId: isUuid(sub.custom_data?.userId) ? sub.custom_data.userId : null,
    userIdSignature: typeof sub.custom_data?.sig === "string" ? sub.custom_data.sig : null,
    status,
    currentPeriodStart: start,
    currentPeriodEnd: end,
    cancelAtPeriodEnd: scheduled?.action === "cancel",
    updatedAt: toDate(sub.updated_at),
    ...addonsOf(items),
  };
}

/** Formats Paddle's lowest-denomination string ("4900", "USD") as "$49.00". */
export function formatMoney(amount: string, currency: string): string {
  try {
    const format = new Intl.NumberFormat("en-US", { style: "currency", currency });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    return format.format(Number(amount) / 10 ** digits);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Parses `ts=1671552777;h1=abc;h1=def` (several h1 values appear while a secret rotates). */
export function parseSignatureHeader(header: string | null): { ts: number; signatures: string[] } | null {
  if (!header) return null;
  let ts: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(";")) {
    const [key, value] = part.split("=");
    if (key === "ts" && value && /^\d+$/.test(value)) ts = Number(value);
    else if (key === "h1" && value) signatures.push(value.toLowerCase());
  }
  return ts === null || signatures.length === 0 ? null : { ts, signatures };
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Checks HMAC-SHA256 of `${ts}:${rawBody}` against the Paddle-Signature header. */
export async function verifySignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  if (Math.abs(nowMs / 1000 - parsed.ts) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${parsed.ts}:${rawBody}`)));
  let ok = false;
  for (const signature of parsed.signatures) {
    const bytes = hexToBytes(signature);
    if (bytes && timingSafeEqual(bytes, expected)) ok = true;
  }
  return ok;
}

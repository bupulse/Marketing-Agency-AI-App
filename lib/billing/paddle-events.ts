import "server-only";
import { applyProviderSubscription } from "@/lib/billing/apply";
import { paddle, webhookFromEvent } from "@/lib/billing/paddle";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { trackEvent } from "@/lib/analytics/events";
import { subscriptionEventsFor } from "@/lib/analytics/math";
import { prisma } from "@/lib/db";
import { settleInvoiceFromCardPayment } from "@/lib/invoices/service";
import { cardPaymentOf } from "@/lib/invoices/shared";
import { logError } from "@/lib/errors";
import { applyOfferCardPayment } from "@/lib/offers/card";
import type { BillingWebhook } from "./types";

// What a stored Paddle event does. Shared by the webhook route (first delivery and Paddle's retries) and the admin's
// "Reprocess" action. It throws on a real failure (the route answers 500 so Paddle retries) and returns "unmapped" for
// a subscription whose price no plan or region price knows (the route answers 200 and leaves the event unprocessed).

export type PaddleEventResult = { status: "processed"; note: string | null } | { status: "unmapped"; priceId: string };

export async function processPaddleEvent(webhook: BillingWebhook): Promise<PaddleEventResult> {
  let note: string | null = null;
  if (webhook.subscription) {
    const before = await subscriptionState(webhook.subscription.providerSubscriptionId);
    const outcome = await applyProviderSubscription("PADDLE", webhook.subscription);
    if (outcome === "applied") await trackSubscriptionChange(webhook.subscription.providerSubscriptionId, before, webhook.subscription);
    if (outcome === "unknown_price") return { status: "unmapped", priceId: webhook.subscription.providerPriceId };
    if (outcome === "duplicate") {
      // A second live subscription for an account that already pays: stop it charging again
      // and flag it so the payment is refunded by hand.
      await paddle.cancelNow(webhook.subscription.providerSubscriptionId).catch((error) =>
        logError(error, { source: "billing.webhook.paddle.duplicate-cancel", subscriptionId: webhook.subscription?.providerSubscriptionId }),
      );
      await logError(new Error("Duplicate subscription cancelled; refund the payment in Paddle"), {
        source: "billing.duplicate",
        level: "error",
        userId: webhook.userId ?? undefined,
        subscriptionId: webhook.subscription.providerSubscriptionId,
      });
      note = "duplicate subscription: cancelled, refund needed";
    }
    if (outcome === "unknown_user") note = "ignored: no matching account";
    if (outcome === "stale") note = "ignored: older than the stored state";
  }
  if (webhook.type === "transaction.completed") {
    // A custom plan offer or added features paid by card (lib/offers/card.ts): switched on here; never an invoice match.
    const offerNote = await applyOfferCardPayment((webhook.payload as { data?: unknown } | null)?.data);
    if (offerNote) note = note ? `${note}; ${offerNote}` : offerNote;
    else await settleInvoice(webhook.payload);
  }
  return { status: "processed", note };
}

type SubState = { userId: string; plan: string; status: string; cancelAtPeriodEnd: boolean } | null;

// Analytics only: the subscription as it was before this webhook, to tell an upgrade from a plain renewal.
async function subscriptionState(providerSubscriptionId: string): Promise<SubState> {
  try {
    return await prisma.subscription.findFirst({
      where: { providerSubscriptionId },
      select: { userId: true, plan: true, status: true, cancelAtPeriodEnd: true },
    });
  } catch {
    return null;
  }
}

async function trackSubscriptionChange(
  providerSubscriptionId: string,
  before: SubState,
  sub: { status: string; cancelAtPeriodEnd: boolean },
) {
  try {
    const after = await prisma.subscription.findFirst({
      where: { providerSubscriptionId },
      select: { userId: true, plan: true, interval: true, status: true, user: { select: { business: { select: { id: true } } } } },
    });
    if (!after) return;
    const track = { userId: after.userId, businessId: after.user.business?.id };
    for (const name of subscriptionEventsFor(before, after, sub.cancelAtPeriodEnd)) {
      await trackEvent(name, { ...track, props: { plan: after.plan, interval: after.interval, from: before?.plan ?? "TRIAL" } });
    }
  } catch {
    // analytics must never fail a webhook
  }
}

// A completed card payment (transaction.completed) may pay the company's open invoice (docs/INVOICES.md). Only that
// event records money; subscription events (renewals, edits) never settle an invoice. Best effort: an invoice left open
// can still be marked paid by hand.
async function settleInvoice(payload: unknown) {
  const pay = cardPaymentOf(payload as Parameters<typeof cardPaymentOf>[0]);
  if (!pay) return;
  try {
    await settleInvoiceFromCardPayment(pay);
  } catch (error) {
    await logError(error, { source: "billing.webhook.paddle.invoices", transactionId: pay.transactionId });
  }
}

// ---- the admin's Reprocess ---------------------------------------------------------------------------------------

/** Paddle events stored but not processed (an unmapped price, or a failure that is still being retried), newest first. */
export async function listUnprocessedPaddleEvents(limit = 50) {
  const rows = await prisma.billingEvent.findMany({ where: { provider: "PADDLE", processedAt: null }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((r) => ({ id: r.id, eventId: r.eventId, type: r.type, userId: r.userId, error: r.error, createdAt: r.createdAt }));
}

/**
 * Runs a stored, unprocessed Paddle event again, once the missing mapping exists (a plan or region price synced with
 * Paddle). Console only, audited. An event that is still unmapped stays as it was and the admin is told why.
 */
export async function reprocessBillingEvent(ctx: AdminContext, id: string) {
  if (ctx.viaApi || ctx.actor !== "admin") throw new AdminError("forbidden", "Card events are reprocessed by the owner, in the admin console.");
  const event = await prisma.billingEvent.findUnique({ where: { id } });
  if (!event || event.provider !== "PADDLE") throw new AdminError("not_found", "No stored Paddle event with that id.");
  if (event.processedAt) throw new AdminError("conflict", "This event was already processed.");
  const payload = event.payload as { event_id?: unknown; event_type?: unknown; data?: unknown } | null;
  if (!payload || typeof payload.event_id !== "string" || typeof payload.event_type !== "string") throw new AdminError("invalid", "The stored event cannot be read.");
  const webhook = webhookFromEvent({ event_id: payload.event_id, event_type: payload.event_type, data: payload.data });
  const result = await processPaddleEvent(webhook);
  if (result.status === "unmapped") throw new AdminError("conflict", `Price ${result.priceId} is still not one of our plans or region prices. Sync the plan or region price with Paddle first, then try again.`);
  const { count } = await prisma.billingEvent.updateMany({ where: { id, processedAt: null }, data: { processedAt: new Date(), error: result.note } });
  if (count !== 1) throw new AdminError("conflict", "This event was processed a moment ago.");
  await writeAudit(prisma, ctx, "reprocess_billing_event", `billing_event:${id}`, { processedAt: null, error: event.error }, { type: event.type, eventId: event.eventId, note: result.note });
  return { id, type: event.type, note: result.note };
}

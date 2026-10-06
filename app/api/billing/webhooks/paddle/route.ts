import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/lib/generated/prisma/client";
import { applyProviderSubscription } from "@/lib/billing/apply";
import { paddle } from "@/lib/billing/paddle";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";

// Paddle posts here (https://bupulse.com/api/billing/webhooks/paddle). The body must be read as
// raw text: the signature covers the exact bytes.
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let webhook;
  try {
    webhook = await paddle.parseWebhook(rawBody, request.headers);
  } catch (error) {
    await logError(error, { source: "billing.webhook.paddle" });
    return NextResponse.json({ error: "Webhook is not configured" }, { status: 500 });
  }
  if (!webhook) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  // Paddle retries, so each event is stored once and processed once.
  const event = await prisma.billingEvent.upsert({
    where: { provider_eventId: { provider: "PADDLE", eventId: webhook.eventId } },
    create: {
      provider: "PADDLE",
      eventId: webhook.eventId,
      type: webhook.type,
      userId: webhook.userId,
      payload: webhook.payload as Prisma.InputJsonValue,
    },
    update: {},
  });
  if (event.processedAt) return NextResponse.json({ ok: true, duplicate: true });

  try {
    let note: string | null = null;
    if (webhook.subscription) {
      const outcome = await applyProviderSubscription("PADDLE", webhook.subscription);
      if (outcome === "unknown_price") {
        // Probably a missing or wrong PADDLE_PRICE_* setting. Don't mark it processed: Paddle
        // retries, and once the setting is fixed the customer gets their plan.
        throw new Error(`Unknown Paddle price ${webhook.subscription.providerPriceId}`);
      }
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
    await prisma.billingEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: note } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    await prisma.billingEvent
      .update({ where: { id: event.id }, data: { error: error instanceof Error ? error.message : String(error) } })
      .catch(() => undefined);
    await logError(error, { source: "billing.webhook.paddle", eventId: webhook.eventId, type: webhook.type });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}

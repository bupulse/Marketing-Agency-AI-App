import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/lib/generated/prisma/client";
import { paddle } from "@/lib/billing/paddle";
import { processPaddleEvent } from "@/lib/billing/paddle-events";
import { sendUnmappedPriceAlertEmail } from "@/lib/billing/momo-emails";
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
    const result = await processPaddleEvent(webhook);
    if (result.status === "unmapped") {
      // A price no plan or region price knows (a plan not synced with Paddle yet). Retrying cannot help until an admin
      // maps it, so answer 200 (Paddle stops) but keep the event UNPROCESSED with a note: it shows in Admin -> Payments
      // for "Reprocess" once the mapping exists, and a replay from Paddle processes it too. Alert once.
      const first = !event.error?.startsWith("unmapped");
      await prisma.billingEvent.update({ where: { id: event.id }, data: { error: `unmapped: price ${result.priceId} is not one of our plans or region prices; nothing applied` } });
      if (first) {
        await logError(new Error(`Unknown Paddle price ${result.priceId}`), { source: "billing.webhook.paddle.unmapped", level: "error", userId: webhook.userId ?? undefined, eventId: webhook.eventId, priceId: result.priceId });
        await sendUnmappedPriceAlertEmail({ priceId: result.priceId, subscriptionId: webhook.subscription?.providerSubscriptionId ?? "", eventId: webhook.eventId, userId: webhook.userId }).catch(() => false);
      }
      return NextResponse.json({ ok: true, unmapped: true });
    }
    await prisma.billingEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: result.note } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    await prisma.billingEvent
      .update({ where: { id: event.id }, data: { error: error instanceof Error ? error.message : String(error) } })
      .catch(() => undefined);
    await logError(error, { source: "billing.webhook.paddle", eventId: webhook.eventId, type: webhook.type });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}

import "server-only";
import { prisma } from "@/lib/db";
import { runInBackground } from "@/lib/leads/background";
import { attemptDelivery, toJson } from "./delivery";
import { buildPayload, type WebhookEvent } from "./events";

/**
 * Writes one delivery row per subscribed endpoint, then sends them. A row is saved with a first retry time an hour
 * ahead, so a delivery that never got sent (the Worker stopped early) is still picked up by the hourly cron.
 * Never throws.
 */
export async function emitWebhookEvent(businessId: string, event: WebhookEvent, data: unknown): Promise<number> {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { businessId, enabled: true, pausedByAdminAt: null, events: { has: event } },
      select: { id: true, url: true, secretEncrypted: true, business: { select: { id: true, name: true } } },
    });
    if (endpoints.length === 0) return 0;
    const now = new Date();
    const payload = toJson(buildPayload(event, data, endpoints[0].business, now));
    const rows = await Promise.all(
      endpoints.map((endpoint) =>
        prisma.webhookDelivery.create({
          data: { endpointId: endpoint.id, event, payload, status: "pending", nextAttemptAt: new Date(now.getTime() + 60 * 60 * 1000) },
          select: { id: true, event: true, payload: true, attempts: true, createdAt: true },
        }),
      ),
    );
    await Promise.all(rows.map((row, i) => attemptDelivery(row, endpoints[i], "quick")));
    return rows.length;
  } catch (error) {
    console.error(`[webhooks] could not emit ${event}:`, error instanceof Error ? error.message : error);
    return 0;
  }
}

/**
 * The call for hooks in existing code: returns at once and does the work after the response. `build` makes the
 * event data from what the caller already has; if it throws, the event is dropped and logged, so a hook can
 * never break the action it sits in.
 */
export function queueWebhookEvent(businessId: string, event: WebhookEvent, build: () => unknown): void {
  try {
    const data = build();
    runInBackground(() => emitWebhookEvent(businessId, event, data), `webhook ${event}`);
  } catch (error) {
    console.error(`[webhooks] could not queue ${event}:`, error instanceof Error ? error.message : error);
  }
}

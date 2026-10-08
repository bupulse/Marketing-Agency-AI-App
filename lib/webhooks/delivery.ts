import "server-only";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { Prisma } from "@/lib/generated/prisma/client";
import { deliverWebhook } from "./core";

export const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** The first run in the background makes up to 3 attempts (core.ts). Later hourly runs make one each. */
export const QUICK_ATTEMPTS = 3;

/** Wait before cron retry number `round` (0 = the first): 1 h, 2 h, 4 h, then 8 h. */
export function retryDelayMs(round: number): number {
  return Math.min(8, 2 ** Math.max(0, round)) * 60 * 60 * 1000;
}

export type DeliveryRow = { id: string; event: string; payload: unknown; attempts: number; createdAt: Date };
export type EndpointRow = { id: string; url: string; secretEncrypted: string };
export type AttemptMode = "quick" | "once" | "final";
// quick: first run, 3 tries with short waits, then scheduled for hourly retries.
// once:  one try, scheduled for another hourly retry if it failed in a way that can recover (cron).
// final: one try that is never rescheduled (Send test, manual Retry): the owner is watching.

/**
 * One delivery run for one delivery row; writes the outcome to the row and the endpoint. Never throws.
 * Returns whether the receiver accepted it.
 */
export async function attemptDelivery(delivery: DeliveryRow, endpoint: EndpointRow, mode: AttemptMode, now = new Date()): Promise<boolean> {
  let result: Awaited<ReturnType<typeof deliverWebhook>>;
  try {
    result = await deliverWebhook({
      url: endpoint.url,
      secret: await decrypt(endpoint.secretEncrypted),
      event: delivery.event,
      body: JSON.stringify(delivery.payload),
      retryDelaysMs: mode === "quick" ? undefined : [],
    });
  } catch (error) {
    result = { ok: false, attempts: 1, retryable: false, error: error instanceof Error ? error.message : "Delivery failed." };
  }
  const attempts = delivery.attempts + result.attempts;
  const done = new Date();
  try {
    if (result.ok) {
      await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: "success", attempts, responseStatus: result.status ?? null, error: null, nextAttemptAt: null } });
      await prisma.webhookEndpoint.updateMany({ where: { id: endpoint.id }, data: { lastSuccessAt: done, failureCount: 0 } });
      return true;
    }
    const nextAt = new Date(now.getTime() + retryDelayMs(Math.max(0, attempts - QUICK_ATTEMPTS)));
    const canRetry = mode !== "final" && result.retryable && nextAt.getTime() < delivery.createdAt.getTime() + GIVE_UP_AFTER_MS;
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: canRetry ? "pending" : "failed",
        attempts,
        responseStatus: result.status ?? null,
        error: !canRetry && mode !== "final" && result.retryable ? `${result.error ?? "Failed"} Gave up after 24 hours.` : (result.error ?? "Delivery failed."),
        nextAttemptAt: canRetry ? nextAt : null,
      },
    });
    await prisma.webhookEndpoint.updateMany({ where: { id: endpoint.id }, data: { lastFailureAt: done, failureCount: { increment: 1 } } });
  } catch (error) {
    console.error("[webhooks] could not record a delivery:", error instanceof Error ? error.message : error);
  }
  return false;
}

export function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

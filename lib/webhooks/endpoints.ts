import "server-only";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { attemptDelivery, toJson } from "./delivery";
import { checkWebhookUrl, generateWebhookSecret } from "./core";
import { buildPayload, isWebhookEvent, type WebhookEvent } from "./events";

export const MAX_ENDPOINTS = 5;

export class WebhookError extends Error {
  constructor(
    public code: "not_found" | "invalid" | "limit",
    message: string,
  ) {
    super(message);
  }
}

export type EndpointInput = { url: string; events: string[] };

/** Cleans and checks what the form sent. Throws WebhookError with a message the owner can read. */
export function validateEndpointInput(input: { url?: unknown; events?: unknown }): { url: string; events: WebhookEvent[] } {
  if (typeof input.url !== "string") throw new WebhookError("invalid", "Enter a web address.");
  const check = checkWebhookUrl(input.url, { allowLocalTest: true });
  if (!check.ok) throw new WebhookError("invalid", check.error);
  const events = Array.isArray(input.events) ? [...new Set(input.events.filter(isWebhookEvent))] : [];
  if (events.length === 0) throw new WebhookError("invalid", "Choose at least one event.");
  return { url: check.url.toString(), events };
}

const endpointSelect = { id: true, url: true, events: true, enabled: true, createdAt: true, lastSuccessAt: true, lastFailureAt: true, failureCount: true } as const;

export async function listEndpoints(businessId: string) {
  return prisma.webhookEndpoint.findMany({ where: { businessId }, orderBy: { createdAt: "asc" }, select: endpointSelect });
}

/** Creates an endpoint. The secret is returned once and stored encrypted. */
export async function createEndpoint(businessId: string, input: { url?: unknown; events?: unknown }) {
  const data = validateEndpointInput(input);
  if ((await prisma.webhookEndpoint.count({ where: { businessId } })) >= MAX_ENDPOINTS) {
    throw new WebhookError("limit", `You can have up to ${MAX_ENDPOINTS} webhooks. Remove one first.`);
  }
  const secret = generateWebhookSecret();
  const endpoint = await prisma.webhookEndpoint.create({ data: { businessId, ...data, secretEncrypted: await encrypt(secret) }, select: endpointSelect });
  return { endpoint, secret };
}

export async function updateEndpoint(businessId: string, id: string, input: { url?: unknown; events?: unknown; enabled?: unknown }) {
  const data = validateEndpointInput(input);
  const enabled = typeof input.enabled === "boolean" ? input.enabled : undefined;
  const result = await prisma.webhookEndpoint.updateMany({ where: { id, businessId }, data: { ...data, ...(enabled === undefined ? {} : { enabled }) } });
  if (result.count !== 1) throw new WebhookError("not_found", "That webhook no longer exists.");
}

export async function setEndpointEnabled(businessId: string, id: string, enabled: boolean) {
  const result = await prisma.webhookEndpoint.updateMany({ where: { id, businessId }, data: { enabled, ...(enabled ? { failureCount: 0 } : {}) } });
  if (result.count !== 1) throw new WebhookError("not_found", "That webhook no longer exists.");
}

export async function deleteEndpoint(businessId: string, id: string) {
  const result = await prisma.webhookEndpoint.deleteMany({ where: { id, businessId } });
  if (result.count !== 1) throw new WebhookError("not_found", "That webhook no longer exists.");
}

/** A new secret; the old one stops working at once. Returned once. */
export async function rotateEndpointSecret(businessId: string, id: string): Promise<{ secret: string }> {
  const secret = generateWebhookSecret();
  const result = await prisma.webhookEndpoint.updateMany({ where: { id, businessId }, data: { secretEncrypted: await encrypt(secret) } });
  if (result.count !== 1) throw new WebhookError("not_found", "That webhook no longer exists.");
  return { secret };
}

/** "Send test event": one webhook.test delivery, a single attempt, logged like any other. */
export async function sendTestEvent(businessId: string, id: string): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id, businessId }, include: { business: { select: { id: true, name: true } } } });
  if (!endpoint) throw new WebhookError("not_found", "That webhook no longer exists.");
  const payload = buildPayload("webhook.test", { message: "This is a test event from BuPulse." }, endpoint.business);
  const row = await prisma.webhookDelivery.create({
    data: { endpointId: endpoint.id, event: "webhook.test", payload: toJson(payload), status: "pending" },
    select: { id: true, event: true, payload: true, attempts: true, createdAt: true },
  });
  const ok = await attemptDelivery(row, endpoint, "final");
  const after = await prisma.webhookDelivery.findUnique({ where: { id: row.id }, select: { responseStatus: true, error: true } });
  return { ok, status: after?.responseStatus ?? null, error: after?.error ?? null };
}

const deliverySelect = { id: true, endpointId: true, event: true, status: true, attempts: true, responseStatus: true, error: true, nextAttemptAt: true, createdAt: true } as const;

export async function listDeliveries(businessId: string, limit = 50) {
  return prisma.webhookDelivery.findMany({
    where: { endpoint: { businessId } },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
    select: { ...deliverySelect, endpoint: { select: { url: true } } },
  });
}

/**
 * Manual "Retry": one attempt now. A delivery that is still waiting for its automatic retries is claimed the way the
 * hourly job claims it (so the two cannot send it twice) and goes back to waiting if it fails again; a failed one gets a
 * single attempt that is not rescheduled.
 */
export async function retryDelivery(businessId: string, deliveryId: string): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const delivery = await prisma.webhookDelivery.findFirst({ where: { id: deliveryId, endpoint: { businessId } }, include: { endpoint: true } });
  if (!delivery) throw new WebhookError("not_found", "That delivery no longer exists.");
  if (delivery.status === "success") throw new WebhookError("invalid", "That delivery already went through.");
  const pending = delivery.status === "pending";
  if (pending) {
    const claimed = await prisma.webhookDelivery.updateMany({
      where: { id: delivery.id, status: "pending", nextAttemptAt: delivery.nextAttemptAt },
      data: { nextAttemptAt: new Date(Date.now() + 30 * 60 * 1000) },
    });
    if (claimed.count !== 1) throw new WebhookError("invalid", "That delivery is being retried right now. Check the log in a moment.");
  }
  const ok = await attemptDelivery(delivery, delivery.endpoint, pending ? "once" : "final");
  const after = await prisma.webhookDelivery.findUnique({ where: { id: delivery.id }, select: { responseStatus: true, error: true } });
  return { ok, status: after?.responseStatus ?? null, error: after?.error ?? null };
}

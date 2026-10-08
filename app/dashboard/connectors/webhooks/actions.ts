"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db";
import { RateLimitError, rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { WebhookError, createEndpoint, deleteEndpoint, retryDelivery, rotateEndpointSecret, sendTestEvent, setEndpointEnabled, updateEndpoint } from "@/lib/webhooks/endpoints";

export type WebhookActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC = "Something went wrong. Nothing was changed. Please try again.";

async function owner() {
  const user = await requireActiveUser();
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) throw new WebhookError("not_found", "Finish setting up your business first.");
  return { userId: user.id, businessId: business.id };
}

async function guarded<T extends object>(run: () => Promise<T>): Promise<WebhookActionResult<T>> {
  try {
    const value = await run();
    revalidatePath("/dashboard/connectors/webhooks");
    return { ok: true, ...value };
  } catch (error) {
    if (error instanceof WebhookError) return { ok: false, error: error.message };
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    // requireActiveUser redirects by throwing; let Next handle that.
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error("[webhooks] action failed:", error instanceof Error ? error.message : error);
    return { ok: false, error: GENERIC };
  }
}

export async function createWebhook(input: { url: string; events: string[] }) {
  return guarded(async () => {
    const { businessId, userId } = await owner();
    await rateLimit(`webhook-edit:${userId}`, { limit: 60, windowSeconds: 3600 });
    const { endpoint, secret } = await createEndpoint(businessId, input);
    return { id: endpoint.id, secret };
  });
}

export async function updateWebhook(id: string, input: { url: string; events: string[] }) {
  return guarded(async () => {
    const { businessId, userId } = await owner();
    await rateLimit(`webhook-edit:${userId}`, { limit: 60, windowSeconds: 3600 });
    await updateEndpoint(businessId, id, input);
    return {};
  });
}

export async function toggleWebhook(id: string, enabled: boolean) {
  return guarded(async () => {
    await setEndpointEnabled((await owner()).businessId, id, Boolean(enabled));
    return {};
  });
}

export async function deleteWebhook(id: string) {
  return guarded(async () => {
    await deleteEndpoint((await owner()).businessId, id);
    return {};
  });
}

export async function rotateWebhookSecret(id: string) {
  return guarded(async () => ({ secret: (await rotateEndpointSecret((await owner()).businessId, id)).secret }));
}

export async function sendWebhookTest(id: string) {
  return guarded(async () => {
    const { businessId, userId } = await owner();
    await rateLimit(`webhook-test:${userId}`, { limit: 30, windowSeconds: 3600 });
    const result = await sendTestEvent(businessId, id);
    return { delivered: result.ok, status: result.status, detail: result.error };
  });
}

export async function retryWebhookDelivery(deliveryId: string) {
  return guarded(async () => {
    const { businessId, userId } = await owner();
    await rateLimit(`webhook-retry:${userId}`, { limit: 60, windowSeconds: 3600 });
    const result = await retryDelivery(businessId, deliveryId);
    return { delivered: result.ok, status: result.status, detail: result.error };
  });
}

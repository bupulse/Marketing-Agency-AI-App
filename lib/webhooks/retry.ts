import "server-only";
import { prisma } from "@/lib/db";
import { attemptDelivery, GIVE_UP_AFTER_MS, RETENTION_MS, toJson } from "./delivery";
import { buildPayload, leadData } from "./events";

export type WebhookRetryResult = { checked: number; delivered: number; stillFailing: number; gaveUp: number; deleted: number; adopted: number };

const BATCH = 100;
const PARALLEL = 10;
const CLAIM_MS = 30 * 60 * 1000;

/**
 * Leads the OLD system (the per-widget webhook, before Phase 7) left waiting: the migration copied the ones that were
 * pending at deploy time, but an old Worker still running during the deploy window can mark more. Each becomes a
 * pending delivery for every endpoint that listens to lead.created, then leaves the old queue. The claim is atomic, so
 * two runs never adopt the same lead. Nothing in the new code reads or writes ChatWidget.webhookUrl.
 */
export async function adoptLegacyPendingLeads(now = new Date()): Promise<number> {
  const leads = await prisma.lead.findMany({
    where: { webhookPendingAt: { not: null } },
    include: { business: { select: { id: true, name: true, webhookEndpoints: { where: { enabled: true, events: { has: "lead.created" } }, select: { id: true } } } } },
    orderBy: { webhookPendingAt: "asc" },
    take: BATCH,
  });
  let adopted = 0;
  for (const lead of leads) {
    const since = lead.webhookPendingAt as Date;
    const claimed = await prisma.lead.updateMany({ where: { id: lead.id, webhookPendingAt: { not: null } }, data: { webhookPendingAt: null } });
    if (claimed.count !== 1) continue;
    const payload = toJson(buildPayload("lead.created", leadData(lead), lead.business, since));
    for (const endpoint of lead.business.webhookEndpoints) {
      await prisma.webhookDelivery.create({ data: { endpointId: endpoint.id, event: "lead.created", payload, status: "pending", attempts: 3, nextAttemptAt: now, createdAt: since } });
      adopted++;
    }
  }
  return adopted;
}

/**
 * Hourly: one more attempt for each pending delivery that is due (back-off 1 h, 2 h, 4 h, 8 h), giving up
 * 24 hours after the event. Also deletes deliveries older than 30 days. Safe to run twice at once: a delivery is
 * claimed by moving its next attempt time ahead before it is sent.
 */
export async function retryDueWebhooks(now = new Date()): Promise<WebhookRetryResult> {
  const result: WebhookRetryResult = { checked: 0, delivered: 0, stillFailing: 0, gaveUp: 0, deleted: 0, adopted: 0 };
  result.adopted = await adoptLegacyPendingLeads(now).catch((error) => {
    console.error("[webhooks] could not adopt old pending leads:", error instanceof Error ? error.message : error);
    return 0;
  });
  const due = await prisma.webhookDelivery.findMany({
    where: { status: "pending", nextAttemptAt: { lte: now } },
    include: { endpoint: { select: { id: true, url: true, secretEncrypted: true, enabled: true } } },
    orderBy: { nextAttemptAt: "asc" },
    take: BATCH,
  });
  const expired = new Date(now.getTime() - GIVE_UP_AFTER_MS);

  async function handle(delivery: (typeof due)[number]) {
    result.checked++;
    if (!delivery.endpoint.enabled || delivery.createdAt <= expired) {
      const why = delivery.endpoint.enabled ? `${delivery.error ?? "Failed."} Gave up after 24 hours.` : "The endpoint was switched off.";
      await prisma.webhookDelivery.updateMany({ where: { id: delivery.id, status: "pending" }, data: { status: "failed", nextAttemptAt: null, error: why } });
      result.gaveUp++;
      return;
    }
    const claimed = await prisma.webhookDelivery.updateMany({
      where: { id: delivery.id, status: "pending", nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: new Date(now.getTime() + CLAIM_MS) },
    });
    if (claimed.count !== 1) return; // another run has it
    const ok = await attemptDelivery(delivery, delivery.endpoint, "once", now);
    if (ok) result.delivered++;
    else result.stillFailing++;
  }

  for (let i = 0; i < due.length; i += PARALLEL) await Promise.all(due.slice(i, i + PARALLEL).map(handle));

  const old = await prisma.webhookDelivery.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - RETENTION_MS) } } });
  result.deleted = old.count;
  return result;
}

import "server-only";
import { prisma } from "@/lib/db";
import { ingestInbound } from "@/lib/inbox/ingest";
import type { WebhookItem } from "./meta-webhook";

// Hands what Meta's webhook reported to the engine, for every business that switched that account on and connected
// it with BuPulse's own app (method DIRECT). Returns how many messages were new.
export async function deliverWebhookItems(items: WebhookItem[]): Promise<{ stored: number; skipped: number }> {
  let stored = 0;
  let skipped = 0;
  const cache = new Map<string, { id: string; businessId: string }[]>();
  for (const item of items) {
    const key = `${item.network}:${item.accountId}`;
    let accounts = cache.get(key);
    if (!accounts) {
      accounts = await prisma.connection.findMany({
        where: { provider: item.network, externalAccountId: item.accountId, inboxEnabled: true, method: "DIRECT" },
        select: { id: true, businessId: true },
      });
      cache.set(key, accounts);
    }
    if (!accounts.length) skipped++;
    for (const account of accounts) {
      const result = await ingestInbound({ ...item.event, businessId: account.businessId, connectionId: account.id });
      if (!result.duplicate) stored++;
    }
  }
  return { stored, skipped };
}

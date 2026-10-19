import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import type { AdminContext } from "@/lib/admin/types";
import { composioCallsThisMonth, pollLimit, replyReserve } from "./budget";
import { subscribeToWebhooks } from "./meta-subscribe";
import { ensureSweep, POLL_KIND, sweep } from "./poll";
import { getInboxSettings, setInboxSetting, type InboxSettings } from "./settings";
import { composioReady, metaReady } from "./transport";

// Admin -> Services, "Instagram and Facebook replies": the route switch, the monthly limit with this month's use, and
// the private-reply flag. docs/SOCIAL_INBOX.md.

export type InboxAdminView = {
  settings: InboxSettings;
  used: number;
  pollLimit: number;
  replyReserve: number;
  composioReady: boolean;
  metaReady: boolean;
  /** Switched-on accounts per route (COMPOSIO = BuPulse-Socials, DIRECT = BuPulse's own Meta app). */
  accounts: { composio: number; direct: number };
  /** Inbox checks waiting to run. */
  pendingChecks: number;
  webhookTokenSet: boolean;
};

export async function inboxAdminView(now = new Date()): Promise<InboxAdminView> {
  const settings = await getInboxSettings();
  const [used, cReady, mReady, rows, pendingChecks] = await Promise.all([
    composioCallsThisMonth(now),
    composioReady(),
    metaReady(),
    prisma.connection.groupBy({ by: ["method"], where: { inboxEnabled: true, provider: { in: ["instagram", "facebook"] } }, _count: { _all: true } }).catch(() => []),
    prisma.dueJob.count({ where: { kind: POLL_KIND, status: "PENDING" } }).catch(() => 0),
  ]);
  const count = (method: string) => rows.find((r) => r.method === method)?._count._all ?? 0;
  return {
    settings,
    used,
    pollLimit: pollLimit(settings.monthlyCap),
    replyReserve: replyReserve(settings.monthlyCap),
    composioReady: cReady,
    metaReady: mReady,
    accounts: { composio: count("COMPOSIO"), direct: count("DIRECT") },
    pendingChecks,
    webhookTokenSet: !!process.env.META_WEBHOOK_VERIFY_TOKEN,
  };
}

/**
 * Changes the route. To BuPulse-Socials: the checks of switched-on accounts start again. To Meta direct: each
 * switched-on account connected with BuPulse's own app is subscribed to the webhook (best effort).
 */
export async function setInboxTransport(ctx: AdminContext, value: unknown): Promise<{ transport: InboxSettings["transport"]; restarted: number; subscribed: number; failed: number }> {
  const transport = await setInboxSetting(ctx, "transport", value);
  if (transport === "composio") {
    const restarted = await sweep();
    await ensureSweep();
    return { transport, restarted, subscribed: 0, failed: 0 };
  }
  const rows = await prisma.connection.findMany({ where: { inboxEnabled: true, method: "DIRECT", provider: { in: ["instagram", "facebook"] } }, select: { id: true, provider: true } });
  let subscribed = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await subscribeToWebhooks(r.id, r.provider as "instagram" | "facebook");
      subscribed++;
    } catch (error) {
      failed++;
      await logError(error, { source: "social.inbox.subscribe", level: "warn" });
    }
  }
  return { transport, restarted: 0, subscribed, failed };
}

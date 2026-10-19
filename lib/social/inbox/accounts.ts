import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { newCursor, parseCursor } from "./cursor";
import { subscribeToWebhooks } from "./meta-subscribe";
import { startPolling, stopPolling } from "./poll";
import { getInboxSettings } from "./settings";
import { routeFor } from "./transport";

// The "Answer comments and messages" switch on the Channels page, per Instagram or Facebook account.

export const INBOX_NETWORKS = ["instagram", "facebook"] as const;

export type InboxState = {
  enabled: boolean;
  /** False when the account was connected another way than the current route: it must be reconnected first. */
  usable: boolean;
  /** One plain line under the switch, or null. */
  note: string | null;
};

const ago = (iso: string, now: Date) => {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};

/** The switch's state for each of the business's Instagram and Facebook accounts, by connection id. */
export async function inboxStates(businessId: string, now = new Date()): Promise<Record<string, InboxState>> {
  const [rows, settings] = await Promise.all([
    prisma.connection.findMany({ where: { businessId, kind: "SOCIAL", provider: { in: [...INBOX_NETWORKS] } }, select: { id: true, method: true, inboxEnabled: true, inboxCursor: true } }),
    getInboxSettings(),
  ]);
  const out: Record<string, InboxState> = {};
  for (const r of rows) {
    const usable = routeFor(r.method, settings.transport).ok;
    const cursor = r.inboxCursor ? parseCursor(r.inboxCursor, now) : null;
    let note: string | null = null;
    if (!usable) note = "Reconnect this account to answer its comments and messages in BuPulse.";
    else if (r.inboxEnabled && settings.transport === "composio") {
      note = cursor?.lastError ? `Last check had a problem: ${cursor.lastError}` : cursor?.checkedAt ? `New comments and messages are checked every few minutes. Last check ${ago(cursor.checkedAt, now)}.` : "The first check runs within a few minutes.";
    } else if (r.inboxEnabled) note = "New comments and messages arrive as they happen.";
    out[r.id] = { enabled: r.inboxEnabled, usable, note };
  }
  return out;
}

/**
 * Switches answering on or off for one account of the business. On: comments and messages from now on come into the
 * inbox (never older ones), checked by BuPulse-Socials or told by Meta. Returns a plain message for the page.
 */
export async function setInboxEnabled(businessId: string, connectionId: string, enabled: boolean): Promise<{ ok: boolean; message: string }> {
  const row = await prisma.connection.findUnique({ where: { id: connectionId }, select: { id: true, businessId: true, provider: true, method: true, status: true } });
  if (!row || row.businessId !== businessId || !(INBOX_NETWORKS as readonly string[]).includes(row.provider)) return { ok: false, message: "That account is not connected." };
  if (!enabled) {
    await prisma.connection.update({ where: { id: row.id }, data: { inboxEnabled: false } });
    await stopPolling(row.id);
    return { ok: true, message: "BuPulse no longer answers this account's comments and messages." };
  }
  const { transport } = await getInboxSettings();
  if (!routeFor(row.method, transport).ok) return { ok: false, message: "Reconnect this account first, then switch this on." };
  if (row.status !== "ACTIVE" && row.status !== "EXPIRING") return { ok: false, message: "Reconnect this account first, then switch this on." };
  await prisma.connection.update({ where: { id: row.id }, data: { inboxEnabled: true, inboxCursor: newCursor() as unknown as Prisma.InputJsonValue } });
  if (transport === "composio") {
    await startPolling(row.id, businessId);
    return { ok: true, message: "Switched on. New comments and messages will appear in your inbox within a few minutes." };
  }
  try {
    await subscribeToWebhooks(row.id, row.provider as (typeof INBOX_NETWORKS)[number]);
  } catch (error) {
    await logError(error, { source: "social.inbox.subscribe", businessId, level: "warn" });
    return { ok: true, message: "Switched on, but Meta did not confirm yet. If no messages arrive, reconnect this account." };
  }
  return { ok: true, message: "Switched on. New comments and messages will appear in your inbox as they arrive." };
}

import "server-only";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { ENTRIES } from "@/lib/connectors/catalog";
import type { ConnectorId } from "@/lib/connectors/types";
import { getProvider, isNetwork } from "@/lib/social/registry";
import { NEEDS_RECONNECT_PREFIX } from "@/lib/social/connections";
import { deleteConnectedAccount, scopeAccount } from "@/lib/social/composio/client";
import { hostOnly as hostOf } from "../connections";
import { writeAudit } from "../audit";
import { AdminError, type AdminContext } from "../types";

// Actions on clients' connections. Each one is a single transaction with its audit row (before and after), refuses
// a missing target, and over the API (Jarvis) needs `confirm: true`. The console form dialog is the confirm there.
// Callers check the admin first (`adminAction()` in the console, the API key for Jarvis).

function requireConfirm(ctx: AdminContext, confirm: boolean | undefined, what: string) {
  if (ctx.viaApi && confirm !== true) throw new AdminError("confirm_required", `${what} is destructive. Send confirm: true to proceed.`);
}

const reasonOf = (value: string | undefined, required: boolean, what: string) => {
  const reason = value?.trim().slice(0, 300) || null;
  if (required && !reason) throw new AdminError("invalid", `Give a reason for ${what}; it is saved in the audit log and shown to the owner.`);
  return reason;
};

export const RECONNECT_NOTE = "Disconnected by BuPulse support. Reconnect this account to publish.";

// ---- social channels ----------------------------------------------------------------------------------------

/**
 * Removes a social account's tokens the way the owner's own disconnect does (best-effort revoke at the network, tokens
 * erased), but keeps the row and every post: the account becomes REVOKED ("needs reconnect") and its scheduled and
 * awaiting-approval posts stay where they are, marked "needs reconnect". Nothing is deleted. When the owner
 * reconnects the same account, the row is updated in place and the posts carry on.
 */
export async function forceDisconnectChannel(ctx: AdminContext, input: { connectionId: string; reason?: string; confirm?: boolean }) {
  requireConfirm(ctx, input.confirm, "Force-disconnecting an account");
  const row = await prisma.connection.findUnique({
    where: { id: input.connectionId },
    select: { id: true, kind: true, provider: true, businessId: true, displayName: true, externalAccountId: true, status: true, postingMode: true, accessTokenEncrypted: true, refreshTokenEncrypted: true, expiresAt: true, method: true, scopes: true },
  });
  if (!row || row.kind !== "SOCIAL" || !isNetwork(row.provider)) throw new AdminError("not_found", "No social account with that id.");
  if (row.status === "REVOKED" && !row.accessTokenEncrypted && !row.refreshTokenEncrypted) throw new AdminError("conflict", "That account is already disconnected.");
  const reason = reasonOf(input.reason, false, "force-disconnecting");

  // The token is read (decrypted) first, but nothing is sent to the network until the database change and its audit row
  // have committed: a failed transaction must never leave a revoked token behind with no audit record.
  const plain = row.accessTokenEncrypted ? await decrypt(row.accessTokenEncrypted).catch(() => null) : null;

  const result = await prisma.$transaction(async (tx) => {
    const queued = await tx.post.count({ where: { connectionId: row.id, status: { in: ["SCHEDULED", "PENDING_APPROVAL"] } } });
    const { count } = await tx.connection.updateMany({
      where: { id: row.id },
      data: { accessTokenEncrypted: null, refreshTokenEncrypted: null, status: "REVOKED", expiresAt: null, lastError: RECONNECT_NOTE, lastCheckedAt: new Date() },
    });
    if (count !== 1) throw new AdminError("not_found", "That account no longer exists.");
    const marked = await tx.post.updateMany({
      where: { connectionId: row.id, status: { in: ["SCHEDULED", "PENDING_APPROVAL"] } },
      data: { lastError: `${NEEDS_RECONNECT_PREFIX} ${RECONNECT_NOTE}` },
    });
    await writeAudit(
      tx, ctx, "force_disconnect_channel", `connection:${row.id}`,
      { network: row.provider, account: row.displayName ?? row.externalAccountId, businessId: row.businessId, status: row.status, hadTokens: Boolean(row.accessTokenEncrypted), expiresAt: row.expiresAt, queuedPosts: queued },
      { status: "REVOKED", tokensRemoved: true, postsMarkedNeedsReconnect: marked.count, postsDeleted: 0, reason },
    );
    return { connectionId: row.id, status: "REVOKED" as const, postsMarkedNeedsReconnect: marked.count };
  });

  // After the commit: tell the network to revoke, best effort (a failed revoke never undoes the disconnect). The outcome
  // is a second audit row and part of the result.
  const provider = getProvider(row.provider);
  let networkRevoke: "revoked" | "failed" | "not_supported" = "not_supported";
  const composioAccount = row.method === "COMPOSIO" ? scopeAccount(row.scopes) : null;
  if (plain && composioAccount) {
    // BuPulse-Socials: Composio holds the tokens. Its sign-in goes once no other account of that sign-in still uses it.
    const others = await prisma.connection.count({ where: { id: { not: row.id }, method: "COMPOSIO", scopes: { has: `composio_account:${composioAccount}` }, accessTokenEncrypted: { not: null } } });
    if (!others) await deleteConnectedAccount(row.provider, composioAccount);
    networkRevoke = others ? "not_supported" : "revoked";
  } else if (plain && provider.revoke) {
    try {
      await provider.revoke({ connectionId: row.id, externalAccountId: row.externalAccountId, accountType: null, accessToken: plain, method: row.method });
      networkRevoke = "revoked";
    } catch {
      networkRevoke = "failed";
    }
  }
  await prisma
    .$transaction(async (tx) => writeAudit(tx, ctx, "force_disconnect_channel_revoke", `connection:${row.id}`, null, { networkRevoke }))
    .catch(() => {});
  return { ...result, networkRevoke };
}

// ---- connectors ---------------------------------------------------------------------------------------------

export const CONNECTOR_DISCONNECT_KINDS = ["store", "cloudflare", "canva"] as const;
export type ConnectorDisconnectKind = (typeof CONNECTOR_DISCONNECT_KINDS)[number];

/**
 * Disconnects a store (Shopify, WooCommerce), a Cloudflare connection or a Canva account by calling that connector's
 * own `disconnect()` (imported products and files stay, as for the owner). `id` is the StoreConnection id, the
 * business id (Cloudflare) or the CanvaConnection id. The connector removes its own rows outside any transaction, so the
 * request is audited before it runs and the outcome (done or failed) after.
 */
export async function disconnectConnector(ctx: AdminContext, input: { kind: string; id: string; reason?: string; confirm?: boolean }) {
  requireConfirm(ctx, input.confirm, "Disconnecting a connector");
  const reason = reasonOf(input.reason, false, "disconnecting");
  let entryId: ConnectorId;
  let userId: string;
  let businessId: string;
  let before: Record<string, unknown>;
  let target: string;
  if (input.kind === "store") {
    const s = await prisma.storeConnection.findUnique({ where: { id: input.id }, select: { id: true, provider: true, storeUrl: true, status: true, businessId: true, business: { select: { userId: true } }, _count: { select: { products: true } } } });
    if (!s || (s.provider !== "shopify" && s.provider !== "woocommerce")) throw new AdminError("not_found", "No store connection with that id.");
    entryId = s.provider;
    userId = s.business.userId;
    businessId = s.businessId;
    before = { provider: s.provider, store: s.storeUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, ""), status: s.status, products: s._count.products, businessId };
    target = `store:${s.id}`;
  } else if (input.kind === "cloudflare") {
    const c = await prisma.cloudflareConnection.findUnique({ where: { businessId: input.id }, select: { businessId: true, status: true, business: { select: { userId: true } }, _count: { select: { installs: true } } } });
    if (!c) throw new AdminError("not_found", "No Cloudflare connection for that business.");
    entryId = "cloudflare";
    userId = c.business.userId;
    businessId = c.businessId;
    before = { provider: "cloudflare", status: c.status, installs: c._count.installs, businessId };
    target = `cloudflare:${c.businessId}`;
  } else if (input.kind === "canva") {
    const c = await prisma.canvaConnection.findUnique({ where: { id: input.id }, select: { id: true, userId: true, expiresAt: true, user: { select: { business: { select: { id: true } } } } } });
    if (!c) throw new AdminError("not_found", "No Canva connection with that id.");
    entryId = "canva";
    userId = c.userId;
    businessId = c.user.business?.id ?? "";
    before = { provider: "canva", tokenExpiresAt: c.expiresAt, businessId: businessId || null };
    target = `canva:${c.id}`;
  } else {
    throw new AdminError("invalid", `kind must be one of: ${CONNECTOR_DISCONNECT_KINDS.join(", ")}.`);
  }
  const entry = ENTRIES.find((e) => e.id === entryId);
  if (!entry) throw new AdminError("unavailable", "That connector is not available.");
  // The connector's own disconnect() uses the shared database client, so it cannot join a transaction. The request is
  // therefore audited first (committed), then the connector runs, then the outcome is audited: a change never happens unrecorded.
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, ctx, "disconnect_connector", target, before, { requested: true, reason });
  });
  try {
    await entry.disconnect({ userId, businessId });
  } catch (e) {
    await prisma.$transaction(async (tx) => writeAudit(tx, ctx, "disconnect_connector_failed", target, null, { connected: "unknown", error: e instanceof Error ? e.message.slice(0, 200) : "failed" })).catch(() => {});
    throw e;
  }
  await prisma.$transaction(async (tx) => writeAudit(tx, ctx, "disconnect_connector_done", target, null, { connected: false }));
  return { target, connector: entryId };
}

// ---- webhooks and API keys ----------------------------------------------------------------------------------

/**
 * Pauses a client's webhook until support resumes it: no events or retries are sent, and the owner's own switch cannot
 * turn it back on. The owner's own on/off value is not touched. A reason is required; it is audited.
 */
export async function pauseWebhook(ctx: AdminContext, input: { endpointId: string; reason: string; confirm?: boolean }) {
  requireConfirm(ctx, input.confirm, "Pausing a webhook");
  const reason = reasonOf(input.reason, true, "pausing a webhook");
  const e = await prisma.webhookEndpoint.findUnique({ where: { id: input.endpointId }, select: { id: true, businessId: true, url: true, enabled: true, failureCount: true, pausedByAdminAt: true } });
  if (!e) throw new AdminError("not_found", "No webhook endpoint with that id.");
  if (e.pausedByAdminAt) throw new AdminError("conflict", "That endpoint is already paused by support.");
  const at = new Date();
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.webhookEndpoint.updateMany({ where: { id: e.id, pausedByAdminAt: null }, data: { pausedByAdminAt: at, pausedByAdminReason: reason } });
    if (count !== 1) throw new AdminError("conflict", "That endpoint was just changed. Reload and try again.");
    await writeAudit(tx, ctx, "pause_webhook", `webhook:${e.id}`, { host: hostOf(e.url), enabled: e.enabled, failureCount: e.failureCount, pausedByAdminAt: null, businessId: e.businessId }, { pausedByAdminAt: at, reason });
    return { endpointId: e.id, pausedByAdminAt: at };
  });
}

/** Lifts a support pause and clears the failure streak. If the owner had switched the webhook off themselves it stays off. */
export async function resumeWebhook(ctx: AdminContext, input: { endpointId: string; reason?: string }) {
  const reason = reasonOf(input.reason, false, "resuming a webhook");
  const e = await prisma.webhookEndpoint.findUnique({ where: { id: input.endpointId }, select: { id: true, businessId: true, url: true, enabled: true, failureCount: true, pausedByAdminAt: true, pausedByAdminReason: true } });
  if (!e) throw new AdminError("not_found", "No webhook endpoint with that id.");
  if (!e.pausedByAdminAt) throw new AdminError("conflict", "That endpoint is not paused by support.");
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.webhookEndpoint.updateMany({ where: { id: e.id, pausedByAdminAt: { not: null } }, data: { pausedByAdminAt: null, pausedByAdminReason: null, failureCount: 0 } });
    if (count !== 1) throw new AdminError("conflict", "That endpoint was just changed. Reload and try again.");
    await writeAudit(tx, ctx, "resume_webhook", `webhook:${e.id}`, { host: hostOf(e.url), pausedByAdminAt: e.pausedByAdminAt, pausedReason: e.pausedByAdminReason, failureCount: e.failureCount, businessId: e.businessId }, { pausedByAdminAt: null, ownerEnabled: e.enabled, reason });
    return { endpointId: e.id, ownerEnabled: e.enabled };
  });
}

/** Revokes a client's REST API key. The key stops working at once; the row stays so the audit trail and history remain. */
export async function revokeClientApiKey(ctx: AdminContext, input: { keyId: string; reason?: string; confirm?: boolean }) {
  requireConfirm(ctx, input.confirm, "Revoking an API key");
  const reason = reasonOf(input.reason, false, "revoking");
  const k = await prisma.apiKey.findUnique({ where: { id: input.keyId }, select: { id: true, businessId: true, name: true, prefix: true, scopes: true, revokedAt: true } });
  if (!k) throw new AdminError("not_found", "No API key with that id.");
  if (k.revokedAt) throw new AdminError("conflict", "That key is already revoked.");
  const revokedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.apiKey.updateMany({ where: { id: k.id, revokedAt: null }, data: { revokedAt } });
    if (count !== 1) throw new AdminError("conflict", "That key is already revoked.");
    await writeAudit(tx, ctx, "revoke_client_api_key", `api_key:${k.id}`, { name: k.name, prefix: k.prefix, scopes: k.scopes, businessId: k.businessId, revokedAt: null }, { revokedAt, reason });
    return { keyId: k.id, revokedAt };
  });
}

// ---- website chat widgets -----------------------------------------------------------------------------------

/** Switches a client's website chat off. The owner sees it switched off, with "Contact support", and cannot turn it back on. */
export async function switchOffWidget(ctx: AdminContext, input: { businessId: string; reason: string; confirm?: boolean }) {
  requireConfirm(ctx, input.confirm, "Switching off a website chat");
  const reason = reasonOf(input.reason, true, "switching off a website chat");
  const w = await prisma.chatWidget.findUnique({ where: { businessId: input.businessId }, select: { businessId: true, enabled: true, disabledByAdminAt: true } });
  if (!w) throw new AdminError("not_found", "That business has no website chat.");
  if (w.disabledByAdminAt) throw new AdminError("conflict", "That chat is already switched off by support.");
  const at = new Date();
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.chatWidget.updateMany({ where: { businessId: w.businessId, disabledByAdminAt: null }, data: { disabledByAdminAt: at, disabledByAdminReason: reason } });
    if (count !== 1) throw new AdminError("conflict", "That chat is already switched off by support.");
    await writeAudit(tx, ctx, "switch_off_widget", `widget:${w.businessId}`, { enabled: w.enabled, disabledByAdminAt: null }, { enabled: w.enabled, disabledByAdminAt: at, reason });
    return { businessId: w.businessId, disabledByAdminAt: at };
  });
}

/** Lifts a support switch-off. The owner's own switch keeps the value it had. */
export async function switchOnWidget(ctx: AdminContext, input: { businessId: string }) {
  const w = await prisma.chatWidget.findUnique({ where: { businessId: input.businessId }, select: { businessId: true, disabledByAdminAt: true, disabledByAdminReason: true } });
  if (!w) throw new AdminError("not_found", "That business has no website chat.");
  if (!w.disabledByAdminAt) throw new AdminError("conflict", "That chat was not switched off by support.");
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.chatWidget.updateMany({ where: { businessId: w.businessId, disabledByAdminAt: { not: null } }, data: { disabledByAdminAt: null, disabledByAdminReason: null } });
    if (count !== 1) throw new AdminError("conflict", "That chat was just changed. Reload and try again.");
    await writeAudit(tx, ctx, "switch_on_widget", `widget:${w.businessId}`, { disabledByAdminAt: w.disabledByAdminAt, reason: w.disabledByAdminReason }, { disabledByAdminAt: null });
    return { businessId: w.businessId };
  });
}

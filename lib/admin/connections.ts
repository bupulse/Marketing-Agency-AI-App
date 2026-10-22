import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hostAllowed } from "@/lib/widget/origin";
import { WIDGET_LIMITS } from "@/lib/widget/limits";
import { PLANS } from "@/lib/plans";
import { getPlanLimits } from "./plan-limits";
import { AdminError, type Page } from "./types";

// Admin views of every client's connections (social channels, connectors, webhooks and API keys, chat widgets).
// Reads only. Every query uses an explicit `select` that leaves out token, secret and hash columns, so nothing
// secret can reach a page, an API response or an MCP tool. Actions are in ./actions/connections.ts.

const DAY_MS = 24 * 60 * 60 * 1000;
const SOCIAL = ["instagram", "facebook", "linkedin", "tiktok", "youtube", "twitter"] as const;
export const SOCIAL_NETWORKS: readonly string[] = SOCIAL;
export const CHANNEL_STATUSES = ["healthy", "expiring", "expired", "needs_reconnect"] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];
/** A token that runs out within this long counts as "expiring" even when the status says ACTIVE. */
export const EXPIRING_WITHIN_MS = 2 * DAY_MS;

// ---- helpers ------------------------------------------------------------------------------------------------

function limitOf(value: number | undefined, def = 25) {
  return Math.min(Math.max(Math.trunc(value ?? def) || def, 1), 100);
}

function page<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  return { items, nextCursor: more ? items[items.length - 1].id : null };
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new AdminError("invalid", `${field} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

/** Search by business name or owner email. */
function businessMatch(q: string | undefined): Prisma.BusinessWhereInput | undefined {
  const text = q?.trim().slice(0, 100);
  if (!text) return undefined;
  return { OR: [{ name: { contains: text, mode: "insensitive" } }, { user: { email: { contains: text, mode: "insensitive" } } }] };
}

/** An error message from a provider, shortened, with anything that looks like a token or key hidden. */
export function safeError(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.replace(/[A-Za-z0-9_\-.~+/=]{28,}/g, "[hidden]").slice(0, 200);
}

/** "shop.example.com" from a URL; never the path or query (they may carry ids or keys). */
export function hostOnly(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid address";
  }
}

const businessSelect = { id: true, name: true, user: { select: { id: true, email: true } } } satisfies Prisma.BusinessSelect;
type BusinessRef = { id: string; name: string; userId: string; ownerEmail: string };
const ref = (b: Prisma.BusinessGetPayload<{ select: typeof businessSelect }>): BusinessRef => ({ id: b.id, name: b.name, userId: b.user.id, ownerEmail: b.user.email });

// ---- 1. social channels -------------------------------------------------------------------------------------

/** Derived health of a social account. A token-less automatic account can only be reconnected. */
export function channelStatus(c: { status: string; postingMode: string; accessTokenEncrypted: string | null; expiresAt: Date | null }, now = Date.now()): ChannelStatus {
  if (c.status === "REVOKED" || c.status === "ERROR" || (c.postingMode !== "NOTIFY" && !c.accessTokenEncrypted)) return "needs_reconnect";
  if (c.status === "EXPIRED" || (c.expiresAt && c.expiresAt.getTime() <= now)) return "expired";
  if (c.status === "EXPIRING" || (c.expiresAt && c.expiresAt.getTime() - now <= EXPIRING_WITHIN_MS)) return "expiring";
  return "healthy";
}

/** The same four states as a database filter (mirrors channelStatus; reminder accounts hold no token). */
function channelWhere(status: ChannelStatus, now: Date): Prisma.ConnectionWhereInput {
  const needs: Prisma.ConnectionWhereInput = { OR: [{ status: { in: ["REVOKED", "ERROR"] } }, { postingMode: "AUTO", accessTokenEncrypted: null }] };
  const expired: Prisma.ConnectionWhereInput = { OR: [{ status: "EXPIRED" }, { expiresAt: { lte: now } }] };
  const expiring: Prisma.ConnectionWhereInput = { OR: [{ status: "EXPIRING" }, { expiresAt: { lte: new Date(now.getTime() + EXPIRING_WITHIN_MS) } }] };
  if (status === "needs_reconnect") return needs;
  if (status === "expired") return { AND: [{ NOT: needs }, expired] };
  if (status === "expiring") return { AND: [{ NOT: needs }, { NOT: expired }, expiring] };
  return { AND: [{ NOT: needs }, { NOT: expired }, { NOT: expiring }] };
}

const channelSelect = {
  id: true,
  provider: true,
  displayName: true,
  externalAccountId: true,
  accountType: true,
  postingMode: true,
  status: true,
  expiresAt: true,
  lastCheckedAt: true,
  lastError: true,
  createdAt: true,
  // Only whether a token exists is read, never its value.
  accessTokenEncrypted: true,
  business: { select: businessSelect },
} satisfies Prisma.ConnectionSelect;

export async function listChannels(
  opts: { q?: string; businessId?: string; network?: string; status?: string; cursor?: string; limit?: number; now?: Date } = {},
) {
  const limit = limitOf(opts.limit);
  const now = opts.now ?? new Date();
  const network = oneOf(opts.network, SOCIAL, "network");
  const status = oneOf(opts.status, CHANNEL_STATUSES, "status");
  const match = businessMatch(opts.q);
  const where: Prisma.ConnectionWhereInput = {
    kind: "SOCIAL",
    provider: network ?? { in: [...SOCIAL] },
    ...(opts.businessId ? { businessId: opts.businessId } : {}),
    ...(match ? { business: match } : {}),
    ...(status ? channelWhere(status, now) : {}),
  };
  const rows = await prisma.connection.findMany({
    where,
    select: channelSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const p = page(rows, limit);
  const ids = p.items.map((r) => r.id);
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const [published, failed, queued] = ids.length
    ? await Promise.all([
        prisma.post.groupBy({ by: ["connectionId"], where: { connectionId: { in: ids }, status: "PUBLISHED" }, _max: { publishedAt: true } }),
        prisma.post.groupBy({ by: ["connectionId"], where: { connectionId: { in: ids }, status: "FAILED", updatedAt: { gte: since } }, _count: { _all: true } }),
        prisma.post.groupBy({ by: ["connectionId"], where: { connectionId: { in: ids }, status: { in: ["SCHEDULED", "PENDING_APPROVAL"] } }, _count: { _all: true } }),
      ])
    : [[], [], []];
  const lastOk = new Map(published.map((g) => [g.connectionId, g._max.publishedAt ?? null]));
  const failedBy = new Map(failed.map((g) => [g.connectionId, g._count._all]));
  const queuedBy = new Map(queued.map((g) => [g.connectionId, g._count._all]));
  return {
    items: p.items.map((c) => ({
      id: c.id,
      business: ref(c.business),
      network: c.provider,
      accountName: c.displayName ?? c.externalAccountId,
      accountType: c.accountType,
      postingMode: c.postingMode,
      rawStatus: c.status,
      status: channelStatus(c, now.getTime()),
      expiresAt: c.expiresAt,
      lastCheckedAt: c.lastCheckedAt,
      lastError: safeError(c.lastError),
      lastPublishOkAt: lastOk.get(c.id) ?? null,
      failedPosts7d: failedBy.get(c.id) ?? 0,
      queuedPosts: queuedBy.get(c.id) ?? 0,
      connectedAt: c.createdAt,
    })),
    nextCursor: p.nextCursor,
  };
}
export type ChannelRow = Awaited<ReturnType<typeof listChannels>>["items"][number];

// ---- 2. connectors ------------------------------------------------------------------------------------------

export const CONNECTOR_KINDS = ["store", "cloudflare", "canva", "files"] as const;
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

export async function listStoreConnections(opts: { q?: string; provider?: string; status?: string; cursor?: string; limit?: number } = {}) {
  const limit = limitOf(opts.limit);
  const provider = oneOf(opts.provider, ["shopify", "woocommerce"] as const, "provider");
  const status = oneOf(opts.status, ["ACTIVE", "NEEDS_ATTENTION"] as const, "status");
  const match = businessMatch(opts.q);
  const rows = await prisma.storeConnection.findMany({
    where: { ...(provider ? { provider } : {}), ...(status ? { status } : {}), ...(match ? { business: match } : {}) },
    select: {
      id: true, provider: true, storeUrl: true, status: true, lastSyncAt: true, lastSyncError: true, lastAttemptAt: true, createdAt: true,
      business: { select: businessSelect },
      _count: { select: { products: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const p = page(rows, limit);
  return {
    items: p.items.map((s) => ({
      id: s.id,
      business: ref(s.business),
      provider: s.provider,
      store: s.storeUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
      status: s.status,
      lastSyncAt: s.lastSyncAt,
      lastAttemptAt: s.lastAttemptAt,
      lastError: safeError(s.lastSyncError),
      products: s._count.products,
      connectedAt: s.createdAt,
    })),
    nextCursor: p.nextCursor,
  };
}

export async function listCloudflareConnections(opts: { q?: string; status?: string; cursor?: string; limit?: number } = {}) {
  const limit = limitOf(opts.limit);
  const status = oneOf(opts.status, ["ACTIVE", "NEEDS_ATTENTION"] as const, "status");
  const match = businessMatch(opts.q);
  const rows = await prisma.cloudflareConnection.findMany({
    where: { ...(status ? { status } : {}), ...(match ? { business: match } : {}) },
    select: {
      businessId: true, status: true, createdAt: true, updatedAt: true,
      business: { select: businessSelect },
      installs: { select: { zoneName: true, installedAt: true }, orderBy: { installedAt: "desc" }, take: 10 },
      _count: { select: { installs: true } },
    },
    orderBy: [{ createdAt: "desc" }, { businessId: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { businessId: opts.cursor }, skip: 1 } : {}),
  });
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  return {
    items: items.map((c) => ({
      id: c.businessId,
      business: ref(c.business),
      status: c.status,
      installCount: c._count.installs,
      zones: c.installs.map((i) => i.zoneName),
      connectedAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
    nextCursor: more ? items[items.length - 1].businessId : null,
  };
}

export async function listCanvaConnections(opts: { q?: string; cursor?: string; limit?: number; now?: Date } = {}) {
  const limit = limitOf(opts.limit);
  const now = opts.now ?? new Date();
  const text = opts.q?.trim().slice(0, 100);
  const rows = await prisma.canvaConnection.findMany({
    where: text ? { user: { OR: [{ email: { contains: text, mode: "insensitive" } }, { business: { name: { contains: text, mode: "insensitive" } } }] } } : {},
    select: { id: true, expiresAt: true, createdAt: true, updatedAt: true, user: { select: { id: true, email: true, business: { select: { id: true, name: true } } } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const p = page(rows, limit);
  const businessIds = p.items.flatMap((r) => (r.user.business ? [r.user.business.id] : []));
  const imports = businessIds.length ? await prisma.mediaAsset.groupBy({ by: ["businessId"], where: { businessId: { in: businessIds }, source: "canva" }, _count: { _all: true } }) : [];
  const importsBy = new Map(imports.map((g) => [g.businessId, g._count._all]));
  return {
    items: p.items.map((c) => ({
      id: c.id,
      business: c.user.business ? { id: c.user.business.id, name: c.user.business.name, userId: c.user.id, ownerEmail: c.user.email } : { id: "", name: "Not set up", userId: c.user.id, ownerEmail: c.user.email },
      // The access token is short-lived and refreshed on use, so an old expiry alone is not a fault.
      tokenExpiresAt: c.expiresAt,
      tokenExpired: c.expiresAt.getTime() <= now.getTime(),
      imports: c.user.business ? (importsBy.get(c.user.business.id) ?? 0) : 0,
      connectedAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
    nextCursor: p.nextCursor,
  };
}

const FILE_SOURCES = ["google_drive", "dropbox"] as const;

/** Drive and Dropbox keep no token (file picker only), so this is usage: imported files per business. */
export async function listFileImportUsage(opts: { q?: string; cursor?: string; limit?: number } = {}) {
  const limit = limitOf(opts.limit);
  const match = businessMatch(opts.q);
  const rows = await prisma.business.findMany({
    where: { mediaAssets: { some: { source: { in: [...FILE_SOURCES] } } }, ...(match ?? {}) },
    select: businessSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const p = page(rows, limit);
  const ids = p.items.map((b) => b.id);
  const groups = ids.length
    ? await prisma.mediaAsset.groupBy({ by: ["businessId", "source"], where: { businessId: { in: ids }, source: { in: [...FILE_SOURCES] } }, _count: { _all: true }, _sum: { bytes: true }, _max: { createdAt: true } })
    : [];
  const get = (businessId: string, source: string) => groups.find((g) => g.businessId === businessId && g.source === source);
  return {
    items: p.items.map((b) => ({
      id: b.id,
      business: ref(b),
      googleDrive: { files: get(b.id, "google_drive")?._count._all ?? 0, bytes: get(b.id, "google_drive")?._sum.bytes ?? 0, lastAt: get(b.id, "google_drive")?._max.createdAt ?? null },
      dropbox: { files: get(b.id, "dropbox")?._count._all ?? 0, bytes: get(b.id, "dropbox")?._sum.bytes ?? 0, lastAt: get(b.id, "dropbox")?._max.createdAt ?? null },
    })),
    nextCursor: p.nextCursor,
  };
}

// ---- 3. webhooks and API keys -------------------------------------------------------------------------------

export async function listWebhookEndpoints(opts: { q?: string; state?: string; cursor?: string; limit?: number; now?: Date } = {}) {
  const limit = limitOf(opts.limit);
  const now = opts.now ?? new Date();
  const state = oneOf(opts.state, ["active", "paused", "failing"] as const, "state");
  const match = businessMatch(opts.q);
  const rows = await prisma.webhookEndpoint.findMany({
    where: {
      ...(state === "active" ? { enabled: true, pausedByAdminAt: null } : state === "paused" ? { OR: [{ enabled: false }, { pausedByAdminAt: { not: null } }] } : state === "failing" ? { failureCount: { gt: 0 } } : {}),
      ...(match ? { business: match } : {}),
    },
    // `secretEncrypted` is deliberately not selected.
    select: { id: true, url: true, events: true, enabled: true, createdAt: true, lastSuccessAt: true, lastFailureAt: true, failureCount: true, pausedByAdminAt: true, pausedByAdminReason: true, business: { select: businessSelect } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const p = page(rows, limit);
  const ids = p.items.map((r) => r.id);
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const [stats, errors] = ids.length
    ? await Promise.all([
        prisma.webhookDelivery.groupBy({ by: ["endpointId", "status"], where: { endpointId: { in: ids }, createdAt: { gte: since } }, _count: { _all: true } }),
        prisma.webhookDelivery.findMany({ where: { endpointId: { in: ids }, status: "failed", error: { not: null }, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, distinct: ["endpointId"], select: { endpointId: true, error: true } }),
      ])
    : [[], []];
  const lastError = new Map(errors.map((e) => [e.endpointId, e.error]));
  return {
    items: p.items.map((e) => {
      const mine = stats.filter((s) => s.endpointId === e.id);
      const ok = mine.find((s) => s.status === "success")?._count._all ?? 0;
      const bad = mine.find((s) => s.status === "failed")?._count._all ?? 0;
      return {
        id: e.id,
        business: ref(e.business),
        host: hostOnly(e.url),
        events: e.events,
        enabled: e.enabled && !e.pausedByAdminAt,
        ownerOff: !e.enabled,
        pausedBySupport: Boolean(e.pausedByAdminAt),
        pauseReason: safeError(e.pausedByAdminReason),
        deliveries7d: ok + bad,
        successRate7d: ok + bad > 0 ? Math.round((ok / (ok + bad)) * 1000) / 10 : null,
        failureStreak: e.failureCount,
        lastSuccessAt: e.lastSuccessAt,
        lastFailureAt: e.lastFailureAt,
        lastError: safeError(lastError.get(e.id)),
        createdAt: e.createdAt,
      };
    }),
    nextCursor: p.nextCursor,
  };
}

export async function listApiKeys(opts: { q?: string; includeRevoked?: boolean; cursor?: string; limit?: number; now?: Date } = {}) {
  const limit = limitOf(opts.limit);
  const match = businessMatch(opts.q);
  const rows = await prisma.apiKey.findMany({
    where: { ...(opts.includeRevoked ? {} : { revokedAt: null }), ...(match ? { business: match } : {}) },
    // The hash is not selected: only the visible prefix ever leaves the database.
    select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, revokedAt: true, createdAt: true, business: { select: { ...businessSelect, user: { select: { id: true, email: true, subscription: { select: { plan: true } } } } } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const p = page(rows, limit);
  // Each call is counted in the per-key rate-limit windows, which are kept for two days.
  const ids = p.items.map((k) => `api-key:${k.id}`);
  const since = new Date((opts.now ?? new Date()).getTime() - 2 * DAY_MS);
  const calls = ids.length ? await prisma.rateLimit.groupBy({ by: ["key"], where: { key: { in: ids }, windowStart: { gte: since } }, _sum: { count: true } }) : [];
  const callsBy = new Map(calls.map((c) => [c.key, c._sum.count ?? 0]));
  return {
    items: p.items.map((k) => ({
      id: k.id,
      business: ref(k.business),
      plan: k.business.user.subscription?.plan ?? null,
      name: k.name,
      prefix: k.prefix,
      scopes: k.scopes,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
      calls2d: callsBy.get(`api-key:${k.id}`) ?? 0,
      createdAt: k.createdAt,
    })),
    nextCursor: p.nextCursor,
  };
}

// ---- 4. website chat widgets --------------------------------------------------------------------------------

type Counts = { c1: number; c7: number; c30: number };

async function sessionCounts(ids: string[], now: Date): Promise<Map<string, Counts>> {
  if (!ids.length) return new Map();
  const d1 = new Date(now.getTime() - DAY_MS);
  const d7 = new Date(now.getTime() - 7 * DAY_MS);
  const d30 = new Date(now.getTime() - 30 * DAY_MS);
  const rows = await prisma.$queryRaw<{ id: string; c1: bigint; c7: bigint; c30: bigint }[]>`
    SELECT "businessId" AS id, COUNT(*) FILTER (WHERE "createdAt" >= ${d1}) AS c1, COUNT(*) FILTER (WHERE "createdAt" >= ${d7}) AS c7, COUNT(*) AS c30
    FROM "ChatSession" WHERE "businessId" = ANY(${ids}::text[]) AND "createdAt" >= ${d30} GROUP BY "businessId"`;
  return new Map(rows.map((r) => [r.id, { c1: Number(r.c1), c7: Number(r.c7), c30: Number(r.c30) }]));
}

async function leadCounts(ids: string[], now: Date): Promise<Map<string, Counts>> {
  if (!ids.length) return new Map();
  const d7 = new Date(now.getTime() - 7 * DAY_MS);
  const d30 = new Date(now.getTime() - 30 * DAY_MS);
  const rows = await prisma.$queryRaw<{ id: string; c7: bigint; c30: bigint }[]>`
    SELECT "businessId" AS id, COUNT(*) FILTER (WHERE "createdAt" >= ${d7}) AS c7, COUNT(*) AS c30
    FROM "Lead" WHERE "businessId" = ANY(${ids}::text[]) AND "source" = 'website_chat' AND "createdAt" >= ${d30} GROUP BY "businessId"`;
  return new Map(rows.map((r) => [r.id, { c1: 0, c7: Number(r.c7), c30: Number(r.c30) }]));
}

/**
 * Rate-limit windows from the last two days in which a visitor, address or business went over the widget limit.
 * `refused` is how many requests past the limit were turned away.
 */
async function throttleCounts(ids: string[], now: Date): Promise<Map<string, { windows: number; refused: number }>> {
  if (!ids.length) return new Map();
  const since = new Date(now.getTime() - 2 * DAY_MS);
  const L = WIDGET_LIMITS;
  const rows = await prisma.$queryRaw<{ id: string; windows: bigint; refused: bigint }[]>`
    SELECT split_part("key", ':', 3) AS id, COUNT(*) AS windows,
      SUM("count" - CASE split_part("key", ':', 2) WHEN 'ip' THEN ${L.ip.limit}::int WHEN 'visitor' THEN ${L.visitor.limit}::int WHEN 'biz' THEN ${L.business.limit}::int WHEN 'aiday' THEN ${L.aiPerIpDay.limit}::int ELSE ${L.lead.limit}::int END) AS refused
    FROM "RateLimit"
    WHERE "windowStart" >= ${since} AND split_part("key", ':', 1) = 'widget' AND split_part("key", ':', 2) IN ('ip', 'visitor', 'biz', 'aiday', 'lead')
      AND split_part("key", ':', 3) = ANY(${ids}::text[])
      AND "count" > CASE split_part("key", ':', 2) WHEN 'ip' THEN ${L.ip.limit}::int WHEN 'visitor' THEN ${L.visitor.limit}::int WHEN 'biz' THEN ${L.business.limit}::int WHEN 'aiday' THEN ${L.aiPerIpDay.limit}::int ELSE ${L.lead.limit}::int END
    GROUP BY 1`;
  return new Map(rows.map((r) => [r.id, { windows: Number(r.windows), refused: Number(r.refused) }]));
}

/** "spike": the last 24 hours had at least 20 chats and three times the daily average of the six days before. */
export function chatSpike(c: Counts): boolean {
  const before = Math.max(c.c7 - c.c1, 0) / 6;
  return c.c1 >= 20 && c.c1 >= 3 * Math.max(before, 1);
}

export type AbuseSignal = "ok" | "watch" | "high";

export async function listWidgets(opts: { q?: string; state?: string; cursor?: string; limit?: number; now?: Date } = {}) {
  const limit = limitOf(opts.limit);
  const now = opts.now ?? new Date();
  const state = oneOf(opts.state, ["on", "off", "support_off"] as const, "state");
  const match = businessMatch(opts.q);
  const rows = await prisma.chatWidget.findMany({
    where: {
      ...(state === "on" ? { enabled: true, disabledByAdminAt: null } : state === "off" ? { enabled: false, disabledByAdminAt: null } : state === "support_off" ? { disabledByAdminAt: { not: null } } : {}),
      ...(match ? { business: match } : {}),
    },
    // Not selected: webhookUrl and webhookSecretEncrypted (the owner's own lead webhook).
    select: {
      businessId: true, enabled: true, allowedDomains: true, lastSeenAt: true, lastSeenHost: true, disabledByAdminAt: true, disabledByAdminReason: true, updatedAt: true,
      business: { select: businessSelect },
    },
    orderBy: [{ updatedAt: "desc" }, { businessId: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { businessId: opts.cursor }, skip: 1 } : {}),
  });
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  const ids = items.map((w) => w.businessId);
  const userIds = items.map((w) => w.business.user.id);
  const [chats, leads, throttled, usage, subs] = await Promise.all([
    sessionCounts(ids, now),
    leadCounts(ids, now),
    throttleCounts(ids, now),
    userIds.length ? prisma.usageRecord.findMany({ where: { userId: { in: userIds }, periodStart: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) } }, orderBy: { periodStart: "desc" }, distinct: ["userId"], select: { userId: true, periodStart: true, chatMessages: true } }) : [],
    userIds.length ? prisma.subscription.findMany({ where: { userId: { in: userIds } }, select: { userId: true, plan: true } }) : [],
  ]);
  const planBy = new Map(subs.map((s) => [s.userId, s.plan]));
  const usageBy = new Map(usage.map((u) => [u.userId, u]));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const out = [];
  for (const w of items) {
    const userId = w.business.user.id;
    const plan = planBy.get(userId) ?? "TRIAL";
    const limits = await getPlanLimits(plan).catch(() => (PLANS[plan] ?? PLANS.TRIAL).limits);
    const u = usageBy.get(userId);
    const c = chats.get(w.businessId) ?? { c1: 0, c7: 0, c30: 0 };
    const l = leads.get(w.businessId) ?? { c1: 0, c7: 0, c30: 0 };
    const t = throttled.get(w.businessId) ?? { windows: 0, refused: 0 };
    const spike = chatSpike(c);
    const host = w.lastSeenHost;
    const hostMismatch = Boolean(host && w.allowedDomains.length > 0 && !hostAllowed(host.replace(/^www\./, ""), w.allowedDomains));
    out.push({
      id: w.businessId,
      business: ref(w.business),
      enabled: w.enabled,
      switchedOffBySupport: Boolean(w.disabledByAdminAt),
      switchedOffAt: w.disabledByAdminAt,
      switchOffReason: w.disabledByAdminReason,
      allowedDomains: w.allowedDomains,
      openToAnySite: w.allowedDomains.length === 0,
      lastSeenAt: w.lastSeenAt,
      lastSeenHost: host,
      hostMismatch,
      chats7d: c.c7, chats30d: c.c30, leads7d: l.c7, leads30d: l.c30,
      credits: { used: u && u.periodStart >= monthStart ? u.chatMessages : 0, limit: limits.chat },
      throttledWindows: t.windows,
      refusedRequests: t.refused,
      spike,
      // high: heavy traffic that was being refused; watch: either alone, or a site that is not on the allowed list.
      signal: (spike && t.refused > 0 ? "high" : spike || t.refused > 0 || hostMismatch ? "watch" : "ok") as AbuseSignal,
    });
  }
  return { items: out, nextCursor: more ? items[items.length - 1].businessId : null };
}
export type WidgetRow = Awaited<ReturnType<typeof listWidgets>>["items"][number];

// ---- counts for the tab badges and Client 360 ---------------------------------------------------------------

/** One client's connections in one call, for Client 360 and Jarvis's `list_connections` tool. */
export async function getClientConnections(businessId: string) {
  const [channels, stores, cloudflare, widget, webhooks, keys, files] = await Promise.all([
    listChannels({ businessId, limit: 50 }).then((r) => r.items),
    prisma.storeConnection.count({ where: { businessId } }),
    prisma.cloudflareConnection.count({ where: { businessId } }),
    prisma.chatWidget.count({ where: { businessId } }),
    prisma.webhookEndpoint.count({ where: { businessId } }),
    prisma.apiKey.count({ where: { businessId, revokedAt: null } }),
    prisma.mediaAsset.count({ where: { businessId, source: { in: [...FILE_SOURCES] } } }),
  ]);
  return { channels, stores, cloudflare, widget, webhooks, apiKeys: keys, importedFiles: files };
}

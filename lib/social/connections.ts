import "server-only";
import type { PostingMode } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { logError } from "@/lib/errors";
import { getProvider } from "./registry";
import { deleteConnectedAccount, isComposioResult, scopeAccount } from "./composio/client";
import { SocialError, type ConnectionCredentials, type Network, type OAuthResult } from "./types";

// Everything that touches stored connections: saving after OAuth, handing the publisher decrypted
// credentials (refreshing first), recording errors and disconnecting. Tokens are always encrypted at rest.

/** Refresh when the token expires within this long, so it does not die in the middle of a publish. */
export const REFRESH_MARGIN_MS = 10 * 60 * 1000;

/** What the UI may see: never tokens. */
export type ConnectionSummary = {
  id: string;
  network: Network;
  displayName: string | null;
  externalAccountId: string;
  accountType: string | null;
  avatarUrl: string | null;
  status: "ACTIVE" | "EXPIRING" | "EXPIRED" | "REVOKED" | "ERROR";
  postingMode: PostingMode;
  expiresAt: Date | null;
  lastError: string | null;
};

/** Start of the note the admin console puts on queued posts when it force-disconnects an account. */
export const NEEDS_RECONNECT_PREFIX = "Needs reconnect:";
export const PICK_NEW_TIME = "Pick a new time: this post's time passed while the account was disconnected.";

/**
 * After an account is reconnected: queued posts the admin console marked "Needs reconnect" go back to normal. A post
 * still in the future keeps its time and just loses the note. One whose time already passed would publish the moment
 * the publisher next runs, so it becomes NEEDS_ACTION ("Pick a new time") for the owner to reschedule or mark posted.
 */
export async function restoreQueuedPosts(connectionIds: string[], now = new Date()): Promise<{ restored: number; needsNewTime: number }> {
  if (!connectionIds.length) return { restored: 0, needsNewTime: 0 };
  const marked = { connectionId: { in: connectionIds }, status: { in: ["SCHEDULED", "PENDING_APPROVAL"] as ("SCHEDULED" | "PENDING_APPROVAL")[] }, lastError: { startsWith: NEEDS_RECONNECT_PREFIX } };
  // One batch: the stale ones leave SCHEDULED first, so the second statement only clears the note on the rest.
  const [stale, rest] = await prisma.$transaction([
    prisma.post.updateMany({ where: { ...marked, status: "SCHEDULED", scheduledAt: { lte: now } }, data: { status: "NEEDS_ACTION", lastError: PICK_NEW_TIME, nextAttemptAt: null } }),
    prisma.post.updateMany({ where: marked, data: { lastError: null } }),
  ]);
  return { restored: rest?.count ?? 0, needsNewTime: stale?.count ?? 0 };
}

const SOCIAL_NETWORKS = new Set<string>(["instagram", "facebook", "linkedin", "tiktok", "youtube"]);

export async function listConnections(businessId: string): Promise<ConnectionSummary[]> {
  const rows = await prisma.connection.findMany({
    where: { businessId, kind: "SOCIAL" },
    orderBy: { createdAt: "asc" },
  });
  return rows
    .filter((r) => SOCIAL_NETWORKS.has(r.provider))
    .map((r) => ({
      id: r.id,
      network: r.provider as Network,
      displayName: r.displayName,
      externalAccountId: r.externalAccountId,
      accountType: r.accountType,
      avatarUrl: r.avatarUrl,
      status: r.status,
      postingMode: r.postingMode,
      expiresAt: r.expiresAt,
      lastError: r.lastError,
    }));
}

/**
 * Stores the accounts the user picked after OAuth (one row per account, tokens encrypted). Reconnecting an
 * account updates its row in place, so scheduled posts keep pointing at it. Returns the connection ids.
 */
export async function saveConnections(
  businessId: string,
  network: Network,
  oauth: OAuthResult,
  selectedAccountIds: string[],
  postingMode: PostingMode = "AUTO",
): Promise<string[]> {
  const chosen = oauth.accounts.filter((a) => selectedAccountIds.includes(a.externalAccountId));
  const method = isComposioResult(oauth.scopes) ? ("COMPOSIO" as const) : ("DIRECT" as const);
  // Reconnecting through BuPulse-Socials makes a new Composio sign-in; the one it replaces is removed afterwards.
  const replaced = method === "COMPOSIO" ? await composioAccountsOf({ businessId, provider: network, externalAccountId: { in: chosen.map((a) => a.externalAccountId) } }) : [];
  const ids: string[] = [];
  for (const account of chosen) {
    const own = oauth.accountTokens?.[account.externalAccountId];
    const accessToken = own?.accessToken ?? oauth.accessToken;
    const expiresAt = own ? own.expiresAt : oauth.expiresAt;
    const data = {
      kind: "SOCIAL" as const,
      method,
      displayName: account.displayName,
      accountType: account.accountType,
      avatarUrl: account.avatarUrl ?? null,
      accessTokenEncrypted: await encrypt(accessToken),
      refreshTokenEncrypted: oauth.refreshToken ? await encrypt(oauth.refreshToken) : null,
      scopes: oauth.scopes,
      expiresAt: expiresAt ?? null,
      status: "ACTIVE" as const,
      lastError: null,
      lastCheckedAt: new Date(),
      postingMode,
    };
    const row = await prisma.connection.upsert({
      where: { businessId_provider_externalAccountId: { businessId, provider: network, externalAccountId: account.externalAccountId } },
      create: { businessId, provider: network, externalAccountId: account.externalAccountId, ...data },
      update: data,
    });
    ids.push(row.id);
  }
  const shared = await shareLinkedInToken(businessId, network, oauth, ids);
  await restoreQueuedPosts([...ids, ...shared]);
  await forgetUnusedComposioAccounts(network, replaced.filter((id) => id !== scopeAccount(oauth.scopes)));
  return ids;
}

/** The Composio sign-ins (connected-account ids) used by the matching connections. */
async function composioAccountsOf(where: Parameters<typeof prisma.connection.findMany>[0] extends infer A ? (A extends { where?: infer W } ? W : never) : never): Promise<string[]> {
  const rows = await prisma.connection.findMany({ where: { ...where, method: "COMPOSIO" }, select: { scopes: true } });
  return [...new Set(rows.map((r) => scopeAccount(r.scopes)).filter((id): id is string => !!id))];
}

/** Removes Composio sign-ins no connection uses any more (best effort), so Composio forgets their tokens. */
async function forgetUnusedComposioAccounts(network: Network, accountIds: string[]): Promise<void> {
  for (const id of accountIds) {
    const still = await prisma.connection.count({ where: { method: "COMPOSIO", scopes: { has: `composio_account:${id}` } } });
    if (!still) await deleteConnectedAccount(network, id);
  }
}

/**
 * LinkedIn may invalidate a member's earlier tokens when they authorize the app again, so every other LinkedIn
 * connection of this business made by the same member (the "li_member:<id>" scope entry) gets the new token.
 */
async function shareLinkedInToken(businessId: string, network: Network, oauth: OAuthResult, savedIds: string[]): Promise<string[]> {
  const member = oauth.scopes.find((scope) => scope.startsWith("li_member:"));
  if (network !== "linkedin" || !member) return [];
  const where = { businessId, provider: "linkedin", scopes: { has: member }, id: { notIn: savedIds } };
  const others = (await prisma.connection.findMany({ where, select: { id: true } })).map((c) => c.id);
  await prisma.connection.updateMany({
    where,
    data: {
      accessTokenEncrypted: await encrypt(oauth.accessToken),
      refreshTokenEncrypted: oauth.refreshToken ? await encrypt(oauth.refreshToken) : null,
      scopes: oauth.scopes,
      expiresAt: oauth.expiresAt ?? null,
      status: "ACTIVE",
      lastError: null,
      lastCheckedAt: new Date(),
    },
  });
  return others;
}

/**
 * A reminder-only account (e.g. a personal Instagram profile, which the API cannot post to). No OAuth and no tokens:
 * the publisher sends the owner a reminder instead of posting.
 */
export async function saveReminderConnection(businessId: string, network: Network, handle: string, displayName: string, accountType = "personal") {
  const clean = handle.replace(/^@/, "").trim().toLowerCase();
  const data = { kind: "SOCIAL" as const, method: "DIRECT" as const, displayName: displayName.trim() || `@${clean}`, accountType, postingMode: "NOTIFY" as const, status: "ACTIVE" as const, accessTokenEncrypted: null, refreshTokenEncrypted: null, scopes: [] as string[], expiresAt: null, lastError: null };
  const row = await prisma.connection.upsert({
    where: { businessId_provider_externalAccountId: { businessId, provider: network, externalAccountId: clean } },
    create: { businessId, provider: network, externalAccountId: clean, ...data },
    update: data,
  });
  return row.id;
}

type Row = NonNullable<Awaited<ReturnType<typeof prisma.connection.findUnique>>>;

function credentialsOf(row: Row, accessToken: string): ConnectionCredentials {
  return { connectionId: row.id, externalAccountId: row.externalAccountId, accountType: row.accountType, accessToken, method: row.method };
}

const inflight = new Map<string, Promise<string>>();

/**
 * Refreshes one connection's tokens. Safe to call concurrently, in this process (calls share one promise) and
 * across processes: the new tokens are stored only if the row still holds the token we started from, and a
 * request that lost the race (or whose single-use refresh token was spent by the winner) reads the winner's tokens.
 */
function refreshConnection(row: Row): Promise<string> {
  const running = inflight.get(row.id);
  if (running) return running;
  const promise = doRefresh(row).finally(() => inflight.delete(row.id));
  inflight.set(row.id, promise);
  return promise;
}

async function doRefresh(row: Row): Promise<string> {
  const network = row.provider as Network;
  const provider = getProvider(network);
  const current = await decrypt(row.accessTokenEncrypted!);
  const refreshToken = row.refreshTokenEncrypted ? await decrypt(row.refreshTokenEncrypted) : undefined;

  const readWinner = async () => {
    const latest = await prisma.connection.findUnique({ where: { id: row.id } });
    if (latest?.accessTokenEncrypted && latest.accessTokenEncrypted !== row.accessTokenEncrypted && (!latest.expiresAt || latest.expiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS)) {
      return decrypt(latest.accessTokenEncrypted);
    }
    return null;
  };

  try {
    const fresh = await provider.refresh!({ refreshToken, accessToken: current });
    const stored = await prisma.connection.updateMany({
      where: { id: row.id, accessTokenEncrypted: row.accessTokenEncrypted },
      data: {
        accessTokenEncrypted: await encrypt(fresh.accessToken),
        ...(fresh.refreshToken ? { refreshTokenEncrypted: await encrypt(fresh.refreshToken) } : {}),
        expiresAt: fresh.expiresAt ?? null,
        status: "ACTIVE",
        lastError: null,
        lastCheckedAt: new Date(),
      },
    });
    if (stored.count === 0) return (await readWinner()) ?? fresh.accessToken;
    return fresh.accessToken;
  } catch (error) {
    const winner = await readWinner();
    if (winner) return winner;
    throw error;
  }
}

/**
 * Decrypted credentials for the publisher. Refreshes first when the token expires within 10 minutes. An auth
 * failure marks the connection EXPIRED and throws SocialError("auth"); a temporary failure keeps using the
 * old token while it is still valid.
 */
export async function loadCredentials(connectionId: string): Promise<ConnectionCredentials> {
  const row = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!row || !SOCIAL_NETWORKS.has(row.provider)) throw new SocialError("This account is no longer connected", "auth", "instagram");
  const network = row.provider as Network;
  if (row.postingMode === "NOTIFY") throw new SocialError("This account uses reminder posting, not automatic posting", "invalid", network);
  if (row.status === "EXPIRED" || row.status === "REVOKED" || !row.accessTokenEncrypted) {
    throw new SocialError("This account needs to be reconnected", "auth", network);
  }

  const now = Date.now();
  const due = row.expiresAt && row.expiresAt.getTime() - now < REFRESH_MARGIN_MS;
  const provider = getProvider(network);
  if (!due || !provider.refresh) return credentialsOf(row, await decrypt(row.accessTokenEncrypted));

  try {
    return credentialsOf(row, await refreshConnection(row));
  } catch (error) {
    if (error instanceof SocialError && error.kind === "auth") {
      // No refresh token (e.g. LinkedIn): the token still works until it expires, so only warn the owner.
      if (await markExpiringIfStillValid(row)) return credentialsOf(row, await decrypt(row.accessTokenEncrypted));
      await markConnectionError(connectionId, error);
      throw error;
    }
    if (row.expiresAt!.getTime() > now) return credentialsOf(row, await decrypt(row.accessTokenEncrypted));
    await logError(error, { source: "social.refresh", network, connectionId, level: "warn" });
    throw error instanceof SocialError ? error : new SocialError("Could not refresh the connection", "temporary", network);
  }
}

/** A connection that cannot be refreshed (no refresh token) but whose token has not expired yet becomes EXPIRING, not EXPIRED. */
async function markExpiringIfStillValid(row: Row): Promise<boolean> {
  if (row.refreshTokenEncrypted || !row.expiresAt || row.expiresAt.getTime() <= Date.now()) return false;
  await prisma.connection.updateMany({ where: { id: row.id }, data: { status: "EXPIRING", lastError: "Reconnect before this login expires", lastCheckedAt: new Date() } });
  return true;
}

/** Cron: refresh a connection ahead of expiry. Returns false (and records why) when it failed. */
export async function refreshConnectionById(connectionId: string): Promise<boolean> {
  const row = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!row?.accessTokenEncrypted || row.postingMode === "NOTIFY") return true;
  const network = row.provider as Network;
  if (!getProvider(network).refresh) return true;
  try {
    await refreshConnection(row);
    return true;
  } catch (error) {
    if (error instanceof SocialError && error.kind === "auth" && (await markExpiringIfStillValid(row))) return false;
    if (error instanceof SocialError) await markConnectionError(connectionId, error);
    else await markConnectionError(connectionId, new SocialError(error instanceof Error ? error.message : "Refresh failed", "temporary", network));
    return false;
  }
}

/** Records a provider error. An auth error means the owner must reconnect, so the connection becomes EXPIRED. */
export async function markConnectionError(connectionId: string, error: SocialError): Promise<void> {
  // A force-disconnected account (REVOKED, tokens erased) keeps its "Disconnected by BuPulse support" note and status.
  const current = await prisma.connection.findUnique({ where: { id: connectionId }, select: { status: true, accessTokenEncrypted: true } });
  if (current?.status === "REVOKED" && !current.accessTokenEncrypted) return;
  await prisma.connection.updateMany({
    where: { id: connectionId },
    data: { lastError: error.message.slice(0, 300), lastCheckedAt: new Date(), ...(error.kind === "auth" ? { status: "EXPIRED" as const } : {}) },
  });
}

/**
 * Removes a connection: tells the network to revoke (best effort), deletes the stored tokens by deleting the row,
 * and detaches its posts. Scheduled, awaiting-approval and reminder posts go back to DRAFT so nothing is published to a forgotten account.
 * Pass `businessId` from any user-facing path: a connection of another business is left alone (returns false).
 */
export async function disconnect(connectionId: string, scope: { businessId?: string } = {}): Promise<boolean> {
  const row = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!row || (scope.businessId && row.businessId !== scope.businessId)) return false;

  if (row.accessTokenEncrypted && SOCIAL_NETWORKS.has(row.provider)) {
    const provider = getProvider(row.provider as Network);
    if (provider.revoke) {
      try {
        await provider.revoke(credentialsOf(row, await decrypt(row.accessTokenEncrypted)));
      } catch {
        // Best effort: the owner asked to disconnect, so a failed revoke never blocks it.
      }
    }
  }
  await deleteConnections([connectionId]);
  // Several Pages can share one BuPulse-Socials sign-in: Composio forgets it once the last of them is gone.
  const composioAccount = row.method === "COMPOSIO" ? scopeAccount(row.scopes) : null;
  if (composioAccount) await forgetUnusedComposioAccounts(row.provider as Network, [composioAccount]).catch(() => {});
  return true;
}

/** Deletes connection rows (and so their tokens) and returns their posts to a safe state. No network calls. */
export async function deleteConnections(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await prisma.$transaction([
    prisma.post.updateMany({ where: { connectionId: { in: ids }, status: { in: ["SCHEDULED", "PENDING_APPROVAL", "NEEDS_ACTION"] } }, data: { status: "DRAFT", connectionId: null } }),
    prisma.post.updateMany({ where: { connectionId: { in: ids } }, data: { connectionId: null } }),
    prisma.connection.deleteMany({ where: { id: { in: ids } } }),
  ]);
}

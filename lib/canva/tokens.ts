import "server-only";
import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { logError } from "@/lib/errors";
import { CanvaApiError, refreshTokens, revokeToken, type CanvaTokens } from "./client";

/** The user has not linked Canva. */
export class CanvaNotConnectedError extends Error {}
/** Canva no longer accepts the stored tokens (access revoked); the user must connect again. */
export class CanvaReconnectError extends Error {}

// Long enough that a token does not expire in the middle of an upload or export.
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export async function saveTokens(userId: string, tokens: CanvaTokens, canvaUserId?: string | null, now = Date.now()) {
  const data = {
    accessTokenEncrypted: await encrypt(tokens.accessToken),
    refreshTokenEncrypted: await encrypt(tokens.refreshToken),
    expiresAt: new Date(now + tokens.expiresInSeconds * 1000),
  };
  await prisma.canvaConnection.upsert({
    where: { userId },
    create: { userId, ...data, canvaUserId: canvaUserId ?? null },
    update: { ...data, ...(canvaUserId ? { canvaUserId } : {}) },
  });
}

/** Forgets the stored tokens (used when Canva has already rejected them). */
async function forgetConnection(userId: string) {
  await prisma.canvaConnection.deleteMany({ where: { userId } });
}

/** The user unlinks Canva: tokens are deleted, then Canva is told to revoke consent (best effort). */
export async function disconnectCanva(userId: string) {
  const row = await prisma.canvaConnection.findUnique({ where: { userId } });
  await forgetConnection(userId);
  const token = row ? await decrypt(row.refreshTokenEncrypted).catch(() => null) : null;
  if (token) await revokeToken(token);
}

export async function isCanvaConnected(userId: string): Promise<boolean> {
  return (await prisma.canvaConnection.count({ where: { userId } })) > 0;
}

type Row = { accessTokenEncrypted: string; refreshTokenEncrypted: string; expiresAt: Date };

/**
 * Refresh tokens are single use. If two requests refresh at once the loser is rejected, so on a
 * rejection we look again: when another request already stored newer tokens, use those.
 */
async function refresh(userId: string, row: Row): Promise<string> {
  const current = await decrypt(row.refreshTokenEncrypted);
  try {
    const tokens = await refreshTokens(current);
    await saveTokens(userId, tokens);
    return tokens.accessToken;
  } catch (error) {
    // Only "invalid_grant" means the user's consent is gone. Rate limits, wrong client credentials and
    // outages say nothing about the user's tokens, so the connection is kept.
    if (error instanceof CanvaApiError && error.status === 400 && error.code === "invalid_grant") {
      const latest = await prisma.canvaConnection.findUnique({ where: { userId } });
      if (latest && latest.refreshTokenEncrypted !== row.refreshTokenEncrypted && latest.expiresAt.getTime() > Date.now() + EXPIRY_MARGIN_MS) {
        return decrypt(latest.accessTokenEncrypted);
      }
      await forgetConnection(userId);
      await logError(error, { source: "canva.refresh", userId, level: "warn" });
      throw new CanvaReconnectError("Canva access was removed");
    }
    if (!(error instanceof CanvaApiError && error.status === 429)) await logError(error, { source: "canva.refresh", userId });
    throw error;
  }
}

/** A valid access token for the user, refreshed when it is about to expire. */
export async function getAccessToken(userId: string, options: { forceRefresh?: boolean } = {}, now = Date.now()): Promise<string> {
  const row = await prisma.canvaConnection.findUnique({ where: { userId } });
  if (!row) throw new CanvaNotConnectedError("Canva is not connected");
  if (!options.forceRefresh && row.expiresAt.getTime() - now > EXPIRY_MARGIN_MS) return decrypt(row.accessTokenEncrypted);
  return refresh(userId, row);
}

/** Runs `fn` with the user's token; one 401 triggers a refresh and a single retry. */
export async function withCanva<T>(userId: string, fn: (token: string) => Promise<T>): Promise<T> {
  const token = await getAccessToken(userId);
  try {
    return await fn(token);
  } catch (error) {
    if (!(error instanceof CanvaApiError) || error.status !== 401) throw error;
    return fn(await getAccessToken(userId, { forceRefresh: true }));
  }
}

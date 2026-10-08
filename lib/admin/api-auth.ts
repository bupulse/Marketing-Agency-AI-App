import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashApiKey } from "@/lib/api/keys";
import { RateLimitError, rateLimit, type RateLimitRule } from "@/lib/rate-limit";
import { ADMIN_KEY_PREFIX, ipAllowed } from "./keys";
import { apiContext, type AdminContext } from "./types";

export const ADMIN_API_RATE_LIMIT: RateLimitRule = { limit: 120, windowSeconds: 60 }; // per key
const LAST_USED_EVERY_MS = 60_000;

export function adminError(status: number, code: string, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store", ...headers } });
}

export type AdminAuth = { ok: true; ctx: AdminContext; keyId: string } | { ok: false; response: NextResponse };

/** The caller's address as Cloudflare saw it. Only meaningful behind Cloudflare, which always sets it. */
export function clientIp(request: Request): string | null {
  return request.headers.get("cf-connecting-ip")?.trim() || null;
}

/**
 * Bearer key check for the admin REST API and the MCP server: known and not revoked, the caller's address on the
 * key's allow-list (when it has one), then the per-key rate limit.
 */
export async function authenticateAdminRequest(request: Request): Promise<AdminAuth> {
  const challenge = { "www-authenticate": "Bearer" };
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match || !match[1].startsWith(ADMIN_KEY_PREFIX) || match[1].length > 200) {
    return { ok: false, response: adminError(401, "unauthorized", "Send your admin key as: Authorization: Bearer bpj_live_...", challenge) };
  }
  const key = await prisma.adminApiKey.findUnique({
    where: { hash: await hashApiKey(match[1]) },
    select: { id: true, ipAllowList: true, revokedAt: true, lastUsedAt: true },
  });
  if (!key || key.revokedAt) return { ok: false, response: adminError(401, "unauthorized", "This key is not valid or was revoked.", challenge) };
  const ip = clientIp(request);
  if (!ipAllowed(ip, key.ipAllowList)) {
    return { ok: false, response: adminError(403, "ip_not_allowed", "This key cannot be used from your address.") };
  }
  try {
    await rateLimit(`admin-key:${key.id}`, ADMIN_API_RATE_LIMIT);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return {
        ok: false,
        response: adminError(429, "rate_limited", `Too many requests. Limit: ${ADMIN_API_RATE_LIMIT.limit} per minute per key.`, { "retry-after": String(error.retryAfterSeconds) }),
      };
    }
    throw error;
  }
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > LAST_USED_EVERY_MS) {
    await prisma.adminApiKey.updateMany({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return { ok: true, ctx: apiContext(key.id, ip), keyId: key.id };
}

import "server-only";
import { builtInRole, permissionsOf, type Permission } from "@/lib/staff/permissions";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findByKeyHash } from "@/lib/api/keys";
import { trustedClientIp } from "@/lib/platform/headers";
import { RateLimitError, rateLimit, type RateLimitRule } from "@/lib/rate-limit";
import { ADMIN_KEY_PREFIX, ipAllowed } from "./keys";
import { apiContext, type AdminContext } from "./types";

export const ADMIN_API_RATE_LIMIT: RateLimitRule = { limit: 120, windowSeconds: 60 }; // per key
const LAST_USED_EVERY_MS = 60_000;

export function adminError(status: number, code: string, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store", ...headers } });
}

export type AdminAuth = { ok: true; ctx: AdminContext; keyId: string } | { ok: false; response: NextResponse };

/**
 * The caller's address as the host saw it (Cloudflare's cf-connecting-ip, Netlify's x-nf-client-connection-ip), never
 * x-forwarded-for: the IP allow-list must not trust anything the caller can choose.
 */
export function clientIp(request: Request): string | null {
  return trustedClientIp(request.headers);
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
  const key = await findByKeyHash(
    match[1],
    (hash) => prisma.adminApiKey.findUnique({ where: { hash }, select: { id: true, ipAllowList: true, revokedAt: true, lastUsedAt: true, scoped: true, permissions: true, createdByStaffId: true } }),
    (id, from, to) => prisma.adminApiKey.updateMany({ where: { id, hash: from }, data: { hash: to } }),
  );
  if (!key || key.revokedAt) return { ok: false, response: adminError(401, "unauthorized", "This key is not valid or was revoked.", challenge) };
  const permissions = await keyPermissions(key);
  if (!permissions) return { ok: false, response: adminError(401, "unauthorized", "The person who made this key no longer has access. Make a new key.", challenge) };
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
  return { ok: true, ctx: apiContext(key.id, ip, permissions), keyId: key.id };
}

/**
 * What a key may do: everything for the owner's key; for a staff member's key, the permissions saved with it that the
 * person still holds today. Null when that person is gone or disabled (the key stops working with them).
 */
export async function keyPermissions(key: { scoped: boolean; permissions: string[]; createdByStaffId: string | null }): Promise<readonly string[] | "all" | null> {
  if (!key.scoped) return "all";
  if (!key.createdByStaffId) return null;
  const staff = await prisma.staffMember.findUnique({ where: { id: key.createdByStaffId }, select: { roleKey: true, status: true } });
  if (!staff || staff.status === "disabled") return null;
  const custom = builtInRole(staff.roleKey) ? [] : await prisma.staffRole.findMany({ where: { key: staff.roleKey }, select: { key: true, permissions: true } });
  const now = permissionsOf(staff.roleKey, custom);
  return key.permissions.filter((p) => now.includes(p as Permission));
}

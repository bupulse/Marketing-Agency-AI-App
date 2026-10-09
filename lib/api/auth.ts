import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { RateLimitError, rateLimit, type RateLimitRule } from "@/lib/rate-limit";
import { featureStatus, type FeatureBlockReason } from "@/lib/entitlements";
import { featureLabel, type FeatureKey } from "@/lib/features";
import { hashApiKey, KEY_PREFIX, type ApiScope } from "./keys";

export const API_RATE_LIMIT: RateLimitRule = { limit: 60, windowSeconds: 60 }; // per key
const LAST_USED_EVERY_MS = 60_000;

export type ApiContext = { keyId: string; businessId: string; scopes: string[] };

/** Every error is JSON: { "error": { "code": "...", "message": "..." } }. */
export function apiError(status: number, code: string, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store", ...headers } });
}

export function apiJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** "ok" while the business is on an active plan with the apiAccess feature; "inactive" (suspended, lapsed) or the feature's block reason otherwise. */
async function apiAccessStatus(businessId: string): Promise<"ok" | "inactive" | FeatureBlockReason> {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { user: { select: { suspendedAt: true, subscription: { select: { status: true } } } } } });
  if (business?.user.suspendedAt) return "inactive";
  const sub = business?.user.subscription;
  if (!sub || (sub.status !== "ACTIVE" && sub.status !== "TRIALING")) return "inactive";
  return featureStatus(businessId, "apiAccess");
}

/** True while the business is on an active plan with the apiAccess feature (Pro today). A downgrade, cancellation or failed payment switches the keys off without deleting them. */
export async function businessHasApiAccess(businessId: string): Promise<boolean> {
  return (await apiAccessStatus(businessId)) === "ok";
}

/**
 * For writes that belong to a plan feature beyond `apiAccess` (PATCH /leads/:id needs websiteChat, POST /posts needs
 * calendar): null when the business may, else the JSON error to send. Reading existing data is never gated this way.
 */
export async function apiFeatureDenied(businessId: string, key: FeatureKey): Promise<NextResponse | null> {
  const status = await featureStatus(businessId, key);
  if (status === "ok") return null;
  if (status === "not_in_plan") return apiError(403, "feature_required", `${featureLabel(key)} is not part of your plan. You can still read existing data; add it to your plan in BuPulse to change it through the API.`);
  return apiError(503, "feature_unavailable", `${featureLabel(key)} is temporarily unavailable. Please try again later.`);
}

/**
 * Checks the bearer key, the Pro plan, the scope and the per-key rate limit, in that order. Returns the context
 * to query with (always scoped by businessId) or the error response to send.
 */
export async function authenticate(request: Request, scope: ApiScope): Promise<{ ok: true; ctx: ApiContext } | { ok: false; response: NextResponse }> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match || !match[1].startsWith(KEY_PREFIX) || match[1].length > 200) {
    return { ok: false, response: apiError(401, "unauthorized", "Send your API key as: Authorization: Bearer bp_live_...", { "www-authenticate": "Bearer" }) };
  }
  const key = await prisma.apiKey.findUnique({ where: { hash: await hashApiKey(match[1]) }, select: { id: true, businessId: true, scopes: true, revokedAt: true, lastUsedAt: true } });
  if (!key || key.revokedAt) return { ok: false, response: apiError(401, "unauthorized", "This API key is not valid or was revoked.", { "www-authenticate": "Bearer" }) };
  const access = await apiAccessStatus(key.businessId);
  // While the plan cannot be checked (or the API's service is paused) the key is not "not in your plan": answer a temporary 503.
  if (access === "plan_unknown" || access === "service_off") return { ok: false, response: apiError(503, "feature_unavailable", "Your plan could not be checked right now. Please try again in a moment.") };
  if (access !== "ok") {
    return { ok: false, response: apiError(403, "plan_required", "API access is not part of your plan. Add it to your plan in BuPulse to use this key again.") };
  }
  if (!key.scopes.includes(scope)) return { ok: false, response: apiError(403, "insufficient_scope", `This key does not have the "${scope}" permission.`) };
  try {
    await rateLimit(`api-key:${key.id}`, API_RATE_LIMIT);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { ok: false, response: apiError(429, "rate_limited", `Too many requests. Limit: ${API_RATE_LIMIT.limit} per minute per key.`, { "retry-after": String(error.retryAfterSeconds) }) };
    }
    throw error;
  }
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > LAST_USED_EVERY_MS) {
    await prisma.apiKey.updateMany({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return { ok: true, ctx: { keyId: key.id, businessId: key.businessId, scopes: key.scopes } };
}

/** Wraps a handler: authentication, then the handler, with any unexpected error turned into a JSON 500. */
export function apiRoute<A extends unknown[]>(scope: ApiScope, handler: (ctx: ApiContext, request: Request, ...args: A) => Promise<NextResponse>) {
  return async (request: Request, ...args: A): Promise<NextResponse> => {
    try {
      const auth = await authenticate(request, scope);
      if (!auth.ok) return auth.response;
      return await handler(auth.ctx, request, ...args);
    } catch (error) {
      console.error("[api/v1] failed:", error instanceof Error ? error.message : error);
      return apiError(500, "server_error", "Something went wrong on our side. Please try again.");
    }
  };
}

// The screen robot's pass (docs/AD_BRAIN.md, section 7): a short-lived, signed, read-only pass for the BuPulse company
// account only, used only by the server's own headless Chrome to capture real dashboard pages (no password typed).
//
// - Signed with HMAC-SHA256 (Web Crypto, so the proxy and the server share this file) by a key derived from
//   SCREEN_PASS_SECRET, else from the server's Supabase secret key: nobody outside the server can make one.
// - Lives 5 minutes; carries the company account's user id and business id; never stored.
// - The proxy (proxy.ts) accepts it only from this computer (host 127.0.0.1 / localhost, no Cloudflare or forwarding
//   headers), only for GET and HEAD, and only on dashboard pages and the read API: no server action (a POST), no admin
//   page, nothing that writes. lib/supabase/server.ts getCurrentUser checks it again and that it names the company
//   account (AD_BRAIN_COMPANY_EMAIL, else office@bupulse.com).
// Pure: no server imports.

export const SCREEN_PASS_COOKIE = "bp_screen_pass";
export const SCREEN_PASS_TTL_MS = 5 * 60_000;

/** The BuPulse company account the Ad Brain works for (and the only account a pass may name). */
export const adBrainCompanyEmail = (env: Record<string, string | undefined> = process.env) => (env.AD_BRAIN_COMPANY_EMAIL?.trim() || "office@bupulse.com").toLowerCase();

/** The signing secret, or "" (then no pass is ever made or accepted). */
export const screenPassSecret = (env: Record<string, string | undefined> = process.env) => env.SCREEN_PASS_SECRET?.trim() || env.SUPABASE_SECRET_KEY?.trim() || "";

export type ScreenPass = { userId: string; businessId: string; exp: number };

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  // A key of its own, derived from the secret, so this signature can never be confused with anything else signed by it.
  const key = await crypto.subtle.importKey("raw", enc.encode(`bupulse-screen-pass\u0000${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Constant-time comparison of two byte strings. */
function same(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** A pass for the company account, valid for `ttlMs` (5 minutes by default). Throws without a secret. */
export async function signScreenPass(input: { userId: string; businessId: string; now?: number; ttlMs?: number }, secret: string): Promise<string> {
  if (!secret) throw new Error("No secret to sign the screen robot's pass (SUPABASE_SECRET_KEY or SCREEN_PASS_SECRET).");
  const body: ScreenPass = { userId: input.userId, businessId: input.businessId, exp: (input.now ?? Date.now()) + Math.min(input.ttlMs ?? SCREEN_PASS_TTL_MS, SCREEN_PASS_TTL_MS) };
  const payload = b64url(enc.encode(JSON.stringify(body)));
  return `${payload}.${b64url(await hmac(secret, payload))}`;
}

/** The pass's contents when it is genuine and not expired, else null. */
export async function readScreenPass(token: string | null | undefined, secret: string, now = Date.now()): Promise<ScreenPass | null> {
  if (!token || !secret || token.length > 600) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  try {
    if (!same(fromB64url(sig), await hmac(secret, payload))) return null;
    const body = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Partial<ScreenPass>;
    if (typeof body.userId !== "string" || typeof body.businessId !== "string" || typeof body.exp !== "number") return null;
    // Expired, or claiming more than the longest life a pass is ever given.
    if (body.exp <= now || body.exp > now + SCREEN_PASS_TTL_MS + 5_000) return null;
    return { userId: body.userId, businessId: body.businessId, exp: body.exp };
  } catch {
    return null;
  }
}

/**
 * True for a request made on this computer itself: a local host name and none of the headers a tunnel or proxy adds.
 * A self-fetch (`next start` fetching a host rewrite from localhost, lib/platform/app-hosts.ts requestHost) carries the
 * visitor's host in X-Forwarded-Host: it is a visitor's request, never the robot's, so any forwarding header refuses.
 */
export type RequestOrigin = { host: string | null; cfConnectingIp?: string | null; forwardedFor?: string | null; realIp?: string | null; forwardedHost?: string | null; forwarded?: string | null };
export function isLocalRequest(input: RequestOrigin): boolean {
  if (input.cfConnectingIp || input.forwardedFor || input.realIp || input.forwardedHost || input.forwarded) return false;
  const host = (input.host ?? "").toLowerCase().replace(/:\d+$/, "");
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

/** The pages a pass may open: the dashboard and its read API (never admin, cron, auth or anything else). */
export function isScreenPassPath(path: string): boolean {
  if (path === "/dashboard" || path.startsWith("/dashboard/")) return true;
  return path.startsWith("/api/") && !path.startsWith("/api/admin") && !path.startsWith("/api/cron") && !path.startsWith("/api/auth");
}

/** Whether the proxy may let a request carrying a pass through (before checking the pass itself). */
export function screenPassAllowed(input: RequestOrigin & { method: string; path: string }): boolean {
  return (input.method === "GET" || input.method === "HEAD") && isScreenPassPath(input.path) && isLocalRequest(input);
}

// The studio's client session (docs/STUDIO_DEPLOY.md, section 2): a client arrives from BuPulse with a one-use ticket
// (/auth/bupulse), gets a cookie signed with STUDIO_SESSION_SECRET that lasts 12 hours and names their business, and
// every request is scoped to it. There is no session table: signing out clears the cookie, and a plan or permission
// change is caught because the paid routes check them when they act. The owner door (gate.ts: STUDIO_PASSWORD) is a
// separate cookie and is not handled here.
import { createHmac, timingSafeEqual } from "node:crypto";
import type http from "node:http";
import { cookieValue, isHttps } from "./gate";

export const SESSION_COOKIE = "bp_studio_session";
export const SESSION_SECONDS = 12 * 3600;

/** Who the ticket was made for. `userId` is the person; `companyUserId` is the company's owner (whose credits are spent). */
export type StudioIdentity = { userId: string; businessId: string; companyUserId: string; role: string };
type Payload = StudioIdentity & { v: 1; iat: number; exp: number };

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(`studio-session:${body}`).digest("base64url");

/** The cookie value for an identity: base64url(payload).base64url(HMAC). */
export function signSession(identity: StudioIdentity, secret: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const payload: Payload = { v: 1, userId: identity.userId, businessId: identity.businessId, companyUserId: identity.companyUserId, role: identity.role, iat, exp: iat + SESSION_SECONDS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** The identity in a cookie value, or null when it is missing, forged, from another secret, malformed or expired. */
export function verifySession(token: string | null | undefined, secret: string | null | undefined, now = Date.now()): (StudioIdentity & { exp: number }) | null {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(body, secret));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<Payload>;
    const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length < 200;
    if (p.v !== 1 || !text(p.userId) || !text(p.businessId) || !text(p.companyUserId) || !text(p.role)) return null;
    if (typeof p.exp !== "number" || typeof p.iat !== "number" || p.exp * 1000 <= now || p.iat * 1000 > now + 60_000) return null;
    return { userId: p.userId, businessId: p.businessId, companyUserId: p.companyUserId, role: p.role, exp: p.exp };
  } catch {
    return null;
  }
}

export const clientSession = (headers: http.IncomingHttpHeaders, secret: string | null | undefined, now = Date.now()) => verifySession(cookieValue(headers, SESSION_COOKIE), secret, now);

export const sessionCookieHeader = (token: string, headers: http.IncomingHttpHeaders) => `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; SameSite=Lax${isHttps(headers) ? "; Secure" : ""}`;
export const clearSessionCookieHeader = (headers: http.IncomingHttpHeaders) => `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${isHttps(headers) ? "; Secure" : ""}`;

/**
 * Where a sign-in goes next, from `?next=`: only a studio page path. A single leading "/", no "//" or backslash, no
 * control characters or spaces, at most 300 characters, and a first segment the studio serves (`isPage` is told the
 * path without its query). Anything else is /create. Sign-in and sign-out paths never count.
 */
export function safeStudioNext(next: unknown, isPage: (firstSegment: string) => boolean): string {
  const fallback = "/create";
  if (typeof next !== "string" || next.length > 300) return fallback;
  if (!/^\/(?![/\\])[^\s\\\u0000-\u001f\u007f]*$/.test(next)) return fallback;
  const first = next.slice(1).split(/[/?#]/)[0];
  if (["login", "logout", "auth"].includes(first)) return fallback;
  return first !== "" && isPage(first) ? next : fallback;
}

/** The secret, or null when it is missing or too short (no session can then be made or read). */
export const sessionSecret = (env: Record<string, string | undefined> = process.env): string | null => {
  const s = (env.STUDIO_SESSION_SECRET ?? "").trim();
  return s.length >= 32 ? s : null;
};

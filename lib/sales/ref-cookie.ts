// The referral cookie (proxy.ts): the first valid ?ref=CODE a visitor arrives with, kept 30 days. Functional only: it
// holds the code and nothing else, and is read once, at sign-up. Pure, safe for the proxy.
import { normalizeRef } from "@/lib/staff/permissions";

export const REF_COOKIE = "bp-ref";
export const REF_MAX_AGE = 30 * 24 * 60 * 60;

export type RefCookie = { name: string; value: string; options: { path: string; maxAge: number; httpOnly: true; sameSite: "lax"; secure: boolean } };

/**
 * The cookie to set for this request, or null: only for a valid ?ref= and only when the visitor has no valid code yet
 * (the first link wins; a later link never replaces it).
 */
export function refCookieFor(refParam: string | null, existing: string | undefined, production = process.env.NODE_ENV === "production"): RefCookie | null {
  const code = normalizeRef(refParam);
  if (!code || normalizeRef(existing)) return null;
  return { name: REF_COOKIE, value: code, options: { path: "/", maxAge: REF_MAX_AGE, httpOnly: true, sameSite: "lax", secure: production } };
}

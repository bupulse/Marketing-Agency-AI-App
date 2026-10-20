import "server-only";
import { headers } from "next/headers";
import { clientIp } from "@/lib/platform/headers";
import { rateLimit, rateLimitMessage, RateLimitError, type RateLimitRule } from "@/lib/rate-limit";

// Limits for the public, signed-out entry points (sign-up, sign-in, password reset, contact form, demo booking).
// Server actions are public POST endpoints, so each is counted per client address and, where the request names an
// email address, per address too: a spread of IPs cannot hammer one account, and one IP cannot walk many addresses.
// Supabase Auth has its own limits on top; these keep our own lookups (and the emails we trigger) in check.

const HOUR = 60 * 60;

export const PUBLIC_LIMITS = {
  checkEmail: { ip: { limit: 20, windowSeconds: HOUR }, email: { limit: 10, windowSeconds: HOUR } },
  signUp: { ip: { limit: 10, windowSeconds: HOUR }, email: { limit: 5, windowSeconds: HOUR } },
  resendConfirmation: { ip: { limit: 10, windowSeconds: HOUR }, email: { limit: 5, windowSeconds: HOUR } },
  login: { ip: { limit: 30, windowSeconds: 15 * 60 }, email: { limit: 10, windowSeconds: 15 * 60 } },
  // Counted per address AND per (address + email): a stranger elsewhere cannot use up the owner's own sends.
  adminCode: { ip: { limit: 20, windowSeconds: HOUR }, email: { limit: 5, windowSeconds: HOUR }, emailPerIp: true },
  adminVerify: { ip: { limit: 30, windowSeconds: 15 * 60 }, email: { limit: 10, windowSeconds: 15 * 60 }, emailPerIp: true },
  forgotPassword: { ip: { limit: 10, windowSeconds: HOUR }, email: { limit: 5, windowSeconds: HOUR } },
  contact: { ip: { limit: 10, windowSeconds: HOUR } },
  demoBook: { ip: { limit: 10, windowSeconds: HOUR } },
  // The partner application on /partners (stored for the admin; nothing is emailed).
  partnerApply: { ip: { limit: 5, windowSeconds: HOUR }, email: { limit: 3, windowSeconds: 24 * HOUR } },
  // The sales room TV (/screen/<token>): it polls every 10 s, so 30 a minute leaves room for a few screens per office.
  screen: { ip: { limit: 30, windowSeconds: 60 } },
} satisfies Record<string, { ip: RateLimitRule; email?: RateLimitRule; emailPerIp?: boolean }>;
export type PublicLimit = keyof typeof PUBLIC_LIMITS;

/** The caller's address: the host's own header (lib/platform/headers.ts), else (plain Node only, local dev) the first x-forwarded-for hop, else null. */
export function clientIpFrom(h: Headers): string | null {
  return clientIp(h);
}

/** The address of the request behind the current server action or route. */
export async function requestIp(): Promise<string | null> {
  return clientIpFrom(await headers());
}

/**
 * One address per mailbox: trimmed, lower case, without a +tag (so a+1@x and a+2@x count as one). Hashed before it
 * becomes a rate-limit key, so the RateLimit table holds no email addresses.
 */
export function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at <= 0) return value;
  return `${value.slice(0, at).replace(/\+.*$/, "")}${value.slice(at)}`;
}

async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`bupulse-limit:${text}`));
  return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Counts one hit for this request's address (and the email, when given) on `kind`. Returns the friendly message when
 * a limit is exceeded, or null to go on. Both counters always count, so switching addresses does not reset either.
 */
export async function publicLimited(kind: PublicLimit, email?: string | null, ip?: string | null): Promise<string | null> {
  const rules: { ip: RateLimitRule; email?: RateLimitRule; emailPerIp?: boolean } = PUBLIC_LIMITS[kind];
  const address = ip === undefined ? await requestIp() : ip;
  const checks = [rateLimit(`public:${kind}:ip:${await shortHash(address ?? "unknown")}`, rules.ip)];
  if (rules.email && email) {
    const who = rules.emailPerIp ? `${address ?? "unknown"}|${normalizeEmail(email)}` : normalizeEmail(email);
    checks.push(rateLimit(`public:${kind}:email:${await shortHash(who)}`, rules.email));
  }
  const results = await Promise.allSettled(checks);
  for (const r of results) {
    if (r.status === "rejected") {
      if (r.reason instanceof RateLimitError) return rateLimitMessage(r.reason);
      throw r.reason;
    }
  }
  return null;
}

/** Waits until at least `ms` have passed since `started`, so a fast "no" and a slow "yes" take the same time. */
export async function padTo(started: number, ms: number): Promise<void> {
  const left = started + ms - Date.now();
  if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
}

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// The "✅ Called" button under a Telegram quote alert (format.ts telegramButtons) opens /called/<id>?t=<token>, which
// marks the request as called and stops the reminders (reminders.ts). The token is a signature of the request's id, so
// only the alert's own link works and nobody can mark other requests by guessing ids. Signed with LEAD_LINK_SECRET, or
// CRON_SECRET when that is not set (both server-only).

function secret(): string | null {
  return process.env.LEAD_LINK_SECRET || process.env.CRON_SECRET || null;
}

/** The signature for one request id, or null when the server has no secret (then no button is shown). */
export function calledToken(id: string): string | null {
  const key = secret();
  return key ? createHmac("sha256", key).update(`quote-called:${id}`).digest("base64url").slice(0, 32) : null;
}

/** "https://bupulse.com/called/<id>?t=<token>", or null without a secret. */
export function calledUrl(site: string, id: string): string | null {
  const token = calledToken(id);
  return token ? `${site.replace(/\/$/, "")}/called/${encodeURIComponent(id)}?t=${token}` : null;
}

/** True when `token` is this id's signature. */
export function verifyCalledToken(id: string, token: string | null): boolean {
  const expected = calledToken(id);
  if (!expected || !token) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

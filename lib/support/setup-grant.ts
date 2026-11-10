// The one-time "add your authenticator" permission for support staff whose account the admin made with a password
// (the owner, 10 November 2026: create a user, give them a password, ask them to add an authenticator app; email was
// down, so the usual emailed code could not reach them). Pure: the actions and the setup page share it.
//
// Normally adding an authenticator needs an emailed code (so a stolen password alone cannot add one). An account the
// admin made, or whose authenticator the admin removed, carries `support_setup_until` in its Supabase app_metadata
// (only the server's secret key can write it, never the person): until then, and only while the account has no
// verified authenticator, it may add one without the emailed code. Adding one clears it.

export const SETUP_GRANT_KEY = "support_setup_until";
export const SETUP_GRANT_DAYS = 7;

export function setupGrantUntil(now = new Date()): string {
  return new Date(now.getTime() + SETUP_GRANT_DAYS * 86_400_000).toISOString();
}

/** True while the account's grant is in the future. Anything missing or unreadable is no grant. */
export function hasSetupGrant(appMetadata: unknown, now = new Date()): boolean {
  if (!appMetadata || typeof appMetadata !== "object") return false;
  const raw = (appMetadata as Record<string, unknown>)[SETUP_GRANT_KEY];
  if (typeof raw !== "string") return false;
  const until = Date.parse(raw);
  return Number.isFinite(until) && until > now.getTime();
}

const LOWER = "abcdefghjkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";

/** A password to hand over: 14 characters, letters and digits that are not easy to mix up (no 0/O, 1/l/I). */
export function suggestPassword(random: (n: number) => number): string {
  const all = LOWER + UPPER + DIGITS;
  const pick = (set: string) => set[random(set.length)];
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), ...Array.from({ length: 11 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

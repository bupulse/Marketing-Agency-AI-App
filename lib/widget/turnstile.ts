// Cloudflare Turnstile: stops bots from starting chats. Active only when both keys are set.

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileSiteKey(): string | null {
  const siteKey = process.env.TURNSTILE_SITE_KEY;
  return siteKey && process.env.TURNSTILE_SECRET_KEY ? siteKey : null;
}

export function turnstileEnabled(): boolean {
  return turnstileSiteKey() !== null;
}

/** Verifies a token on the server. Any network or response problem counts as a failure. */
export async function verifyTurnstile(token: string, ip?: string | null, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const response = await fetchImpl(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}

/** New chats, every 10th message and bot-fast messages must pass Turnstile. */
export function needsChallenge(session: { messageCount: number; lastMessageAt: Date } | null, now: Date, every: number, botSpeedMs: number): boolean {
  if (!session) return true;
  if (session.messageCount > 0 && session.messageCount % every === 0) return true;
  return now.getTime() - session.lastMessageAt.getTime() < botSpeedMs;
}

let warned = false;

/** In production, says once per isolate that the bot check is off (the keys are not set). */
export function warnTurnstileOff() {
  if (warned || turnstileEnabled() || process.env.NODE_ENV !== "production") return;
  warned = true;
  console.error("[widget] TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY are not set: the chat widget has no bot check, only rate limits.");
}

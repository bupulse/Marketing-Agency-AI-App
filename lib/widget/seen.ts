import { hostAllowed, hostOf } from "./origin";

/** The widget loader writes "seen" at most this often, so the config endpoint stays a cheap read. */
export const SEEN_THROTTLE_MS = 10 * 60 * 1000;
/** "Recently" for the installation check. */
export const SEEN_RECENT_MS = 24 * 60 * 60 * 1000;

/** Whether this config request should be recorded: a real site that is not BuPulse, and not recorded within the throttle. */
export function shouldRecordSeen(input: { host: string | null; ownHosts: string[]; lastSeenAt: Date | null; now: Date }): boolean {
  const host = hostOf(input.host);
  if (!host || host === "local-file" || input.ownHosts.includes(host)) return false;
  return !input.lastSeenAt || input.now.getTime() - input.lastSeenAt.getTime() >= SEEN_THROTTLE_MS;
}

export type SeenResult =
  | { status: "never" }
  | { status: "seen"; host: string; ago: string; matches: boolean | null; recent: boolean };

export function formatAgo(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}

/** Turns the stored lastSeen into what the owner sees. `url` is the page they typed (optional). */
export function describeSeen(input: { lastSeenAt: Date | null; lastSeenHost: string | null; url?: string | null; now: Date }): SeenResult {
  if (!input.lastSeenAt || !input.lastSeenHost) return { status: "never" };
  const age = input.now.getTime() - input.lastSeenAt.getTime();
  const typed = input.url ? hostOf(input.url) : null;
  const matches = typed ? typed === input.lastSeenHost || hostAllowed(typed, [input.lastSeenHost]) || hostAllowed(input.lastSeenHost, [typed]) : null;
  return { status: "seen", host: input.lastSeenHost, ago: formatAgo(age), matches, recent: age <= SEEN_RECENT_MS };
}

/**
 * "Install the chat widget" on the dashboard checklist is done once the widget has loaded on a website it is allowed
 * on (the config endpoint records only those, and never BuPulse's own pages), or BuPulse added it to a site through
 * Cloudflare. A site seen before the allowed list was narrowed no longer counts.
 */
export function widgetInstalled(input: {
  widget: { lastSeenAt: Date | null; lastSeenHost: string | null; allowedDomains: string[] } | null;
  cloudflareInstalls: number;
}): boolean {
  if (input.cloudflareInstalls > 0) return true;
  const w = input.widget;
  if (!w?.lastSeenAt || !w.lastSeenHost) return false;
  return w.allowedDomains.length === 0 || hostAllowed(w.lastSeenHost.replace(/^www\./, ""), w.allowedDomains);
}

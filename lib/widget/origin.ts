// Which sites may run a business's chat widget. Pure helpers, no I/O.

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
export const MAX_ALLOWED_DOMAINS = 20;

/**
 * "https://www.Example.com/shop?x=1", "example.com:8080" -> "example.com". The leading "www." is
 * dropped because a domain also covers its subdomains. Returns null when it is not a hostname.
 */
export function normalizeDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.replace(/^\*\./, "");
  value = value.split(/[/?#]/)[0] ?? "";
  value = value.replace(/^[^@]*@/, "").replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, "");
  return value && HOST.test(value) ? value : null;
}

/** Cleans a list from the settings form: normalised, unique, at most MAX_ALLOWED_DOMAINS. */
export function normalizeDomains(inputs: string[]): { domains: string[]; invalid: string[] } {
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const input of inputs) {
    if (!input.trim()) continue;
    const domain = normalizeDomain(input);
    if (!domain) invalid.push(input.trim());
    else if (!domains.includes(domain)) domains.push(domain);
  }
  return { domains: domains.slice(0, MAX_ALLOWED_DOMAINS), invalid };
}

/** Hostname of a URL or bare host; null when unreadable. */
export function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** True when `host` is one of the allowed domains or a subdomain of one. */
export function hostAllowed(host: string, allowed: string[]): boolean {
  return allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export interface OriginCheckInput {
  allowedDomains: string[];
  /** The `origin` value widget.js passes (location.hostname). */
  claimedHost?: string | null;
  /** Origin header of the request (browsers set it on fetch POSTs). */
  originHeader?: string | null;
  referer?: string | null;
  /** Hostnames of BuPulse itself (dashboard preview, local testing). */
  ownHosts: string[];
}

/** What widget.js sends for a page opened as a file (file://), which has no hostname. */
export const LOCAL_FILE_HOST = "local-file";

/** True when this BuPulse server runs on the owner's own computer (local development). */
export function isLocalBuPulse(ownHosts: string[]): boolean {
  return ownHosts.some((h) => h === "localhost" || h === "127.0.0.1");
}

export type OriginCheck = { ok: true } | { ok: false; reason: "cross_origin" | "not_allowed" | "mismatch" };

/**
 * Checks a chat API request against the business's allowed domains. Browsers cannot forge the
 * Origin and Referer headers, but a script outside a browser can send anything, so this stops a
 * key being used from other websites, not a determined spammer (the rate limits and Turnstile do
 * that). See docs/WIDGET.md.
 */
export function checkOrigin(input: OriginCheckInput): OriginCheck {
  const own = input.ownHosts.map((h) => h.toLowerCase());
  // The chat page calls its own server, so a browser request from another site is not ours.
  const origin = hostOf(input.originHeader);
  if (origin && !own.includes(origin)) return { ok: false, reason: "cross_origin" };

  // A Referer on our own chat page carries the origin it was opened with; the two must agree.
  let refererClaim: string | null = null;
  if (input.referer) {
    try {
      const url = new URL(input.referer);
      if (own.includes(url.hostname.toLowerCase().replace(/^www\./, ""))) refererClaim = hostOf(url.searchParams.get("origin"));
    } catch {
      // unreadable Referer: ignore it
    }
  }
  const claimed = hostOf(input.claimedHost);
  if (refererClaim && claimed && refererClaim !== claimed) return { ok: false, reason: "mismatch" };

  const host = claimed ?? refererClaim;
  // A page opened as a file: only for testing against BuPulse on this computer, never on the live service.
  if (host === LOCAL_FILE_HOST) return isLocalBuPulse(own) ? { ok: true } : { ok: false, reason: "not_allowed" };
  if (input.allowedDomains.length === 0) return { ok: true };
  if (!host) return { ok: false, reason: "not_allowed" };
  if (own.includes(host) || hostAllowed(host, input.allowedDomains)) return { ok: true };
  return { ok: false, reason: "not_allowed" };
}

/**
 * CSP frame-ancestors for the chat page: only the business's own sites (and BuPulse, for the
 * preview) may frame it. With no allowed domains any site may, so installing is easy.
 */
export function frameAncestors(allowedDomains: string[], ownHosts: string[] = []): string {
  if (allowedDomains.length === 0) return "frame-ancestors *";
  const sources = new Set<string>(["'self'"]);
  // BuPulse running on this computer: test pages on any local port may frame the chat, as the
  // config and chat APIs already allow them.
  const local = ownHosts.filter((h) => h === "localhost" || h === "127.0.0.1");
  for (const domain of [...allowedDomains, ...local]) {
    sources.add(`https://${domain}`);
    sources.add(`https://*.${domain}`);
    if (domain === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) {
      sources.add(`http://${domain}:*`);
      sources.add(`https://${domain}:*`);
      sources.add(`http://${domain}`);
    }
  }
  return `frame-ancestors ${[...sources].join(" ")}`;
}

/**
 * Allowed domains a new widget starts with: the business's own website. A domain also covers its
 * subdomains, so "example.com" includes "www.example.com". Empty when the website is unknown.
 */
export function defaultAllowedDomains(website: string | null | undefined): string[] {
  const domain = website ? normalizeDomain(website) : null;
  return domain ? [domain] : [];
}

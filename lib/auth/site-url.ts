export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * The address for links people open on another device (the sales TV link, referral links, staff invitations).
 * PUBLIC_LINK_URL when set (on the test machine: the https://test.bupulse.com tunnel), else siteUrl(): in production
 * both are https://bupulse.com.
 */
export function publicSiteUrl() {
  return (process.env.PUBLIC_LINK_URL || siteUrl()).replace(/\/$/, "");
}

/** Addresses the site may send people back to: siteUrl() plus AUTH_EXTRA_ORIGINS (comma-separated, e.g. a test tunnel). */
function servedOrigins(): string[] {
  const extra = (process.env.AUTH_EXTRA_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return [siteUrl(), ...extra];
}

/**
 * The address the visitor is actually on, so a Google sign-in started on https://test.bupulse.com comes back there and
 * not to localhost. Only an origin from servedOrigins() is trusted; any other Host header gets siteUrl().
 */
export function originFor(headers: Headers): string {
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim();
  if (!host) return siteUrl();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = (headers.get("x-forwarded-proto") ?? (local ? "http" : "https")).split(",")[0].trim();
  const origin = `${proto}://${host}`;
  return servedOrigins().includes(origin) ? origin : siteUrl();
}

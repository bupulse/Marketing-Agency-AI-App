export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
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

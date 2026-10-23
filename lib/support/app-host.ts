// The support app's address (docs/SUPPORT_CHAT.md "Support app and Admin"). support.bupulse.com serves only the support
// app: proxy.ts rewrites its paths under /support, so support.bupulse.com/visitors is app/support/(app)/visitors. On any
// other host (local testing, test.bupulse.com) the same app opens at /support. Pure: the proxy and the browser use it.

export const SUPPORT_PREFIX = "/support";

/**
 * Hosts that are the support app itself. support-test.bupulse.com is the test copy (the Mac behind test.bupulse.com, the
 * TEST database); support.localhost works in local testing with no DNS change.
 */
export const SUPPORT_HOSTS = ["support.bupulse.com", "support-test.bupulse.com", "support.localhost"];

/** Files and routes the support host serves as they are (the app's own assets, its API, the support service worker). */
const PASS_THROUGH = ["/_next/", "/api/support/", "/icons/", "/fonts/", "/brand/"];
const PASS_FILES = ["/support-sw.js", "/icon.png", "/favicon.ico"];

export function isSupportHost(host: string | null | undefined): boolean {
  const name = (host ?? "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  return SUPPORT_HOSTS.includes(name);
}

/** True for /support and everything under it. */
export const isSupportPath = (path: string) => path === SUPPORT_PREFIX || path.startsWith(`${SUPPORT_PREFIX}/`);

/**
 * What the proxy does with a request on the support host: serve it as it is (assets, the support API, a path already
 * under /support), or rewrite it under /support. Null for every other host. Anything else of the site (the dashboard,
 * the admin console, other APIs) is rewritten too, so it is not found there.
 */
export function supportRoute(path: string, host: string | null | undefined): { action: "pass" } | { action: "rewrite"; path: string } | null {
  if (!isSupportHost(host)) return null;
  if (isSupportPath(path) || PASS_FILES.includes(path) || PASS_THROUGH.some((p) => path.startsWith(p))) return { action: "pass" };
  return { action: "rewrite", path: path === "/" ? SUPPORT_PREFIX : `${SUPPORT_PREFIX}${path}` };
}

/** "" on the support host (clean paths), "/support" anywhere else. Links and redirects inside the app start with it. */
export const supportBaseFor = (host: string | null | undefined): "" | typeof SUPPORT_PREFIX => (isSupportHost(host) ? "" : SUPPORT_PREFIX);

/** A path inside the support app for a base: ("", "/chats") → "/chats"; ("/support", "/") → "/support". */
export function supportHref(base: string, path: string): string {
  if (path === "/" || path === "") return base || "/";
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

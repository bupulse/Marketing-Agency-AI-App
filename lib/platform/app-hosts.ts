// Which BuPulse host serves what (docs/HOSTS.md). Pure: the proxy, the server and the browser all use it.
//
// - bupulse.com (the "front" host, siteUrl()): the public site, the ONE client sign-in (/login, /signup, /auth/*,
//   forgot and reset password), the service chooser (/apps), the creator portal, account pages, and every
//   connection flow (social, Canva, Shopify, WooCommerce, Composio...), so channels can later be shared by every service.
// - marketing.bupulse.com (MARKETING_APP_URL): the Marketing dashboard with clean addresses (app/dashboard/* is served
//   at /*: "/" is /dashboard, "/posts" is /dashboard/posts) and its signed-in onboarding pages (/welcome, /start-trial...).
// - admin.bupulse.com (ADMIN_APP_URL): the admin console with clean addresses (app/admin/* at /*) and its own sign-in.
// - agency.bupulse.com: Agency OS, phase 2. Only reserved here (SERVICES), never routed yet.
// - support.bupulse.com: lib/support/app-host.ts, unchanged.
//
// Switched off unless set in the SERVER environment (never Admin -> Services: the proxy cannot load those keys). The
// Marketing host also needs CLIENT_COOKIE_DOMAIN (one client session shared by bupulse.com and its service hosts):
// without it a sign-in on bupulse.com would not reach marketing.bupulse.com, so the Marketing host stays off. When
// nothing is set, everything is served on one host exactly as before.

import { isSupportHost } from "@/lib/support/app-host";

// ---- configuration ---------------------------------------------------------------------------------------------

type Env = Record<string, string | undefined>;

/** The front host's origin: NEXT_PUBLIC_SITE_URL (https://bupulse.com in production). */
export function frontOrigin(env: Env = process.env): string {
  return originOf(env.NEXT_PUBLIC_SITE_URL) ?? "http://localhost:3000";
}

/** An http(s) origin from a configured address, or null when it is not a bare origin (a path, query or login in it). */
function originOf(value: string | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

const hostnameOf = (origin: string) => new URL(origin).hostname;

/**
 * The client session's cookie domain without its leading dot ("bupulse.com"), or null. CLIENT_COOKIE_DOMAIN is
 * ".bupulse.com" in production; the front host must be inside it, or it is ignored.
 */
export function clientCookieDomain(env: Env = process.env): string | null {
  const raw = (env.CLIENT_COOKIE_DOMAIN ?? "").trim().toLowerCase().replace(/^\./, "");
  if (!raw || !/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(raw)) return null;
  return withinDomain(hostnameOf(frontOrigin(env)), raw) ? raw : null;
}

const withinDomain = (hostname: string, domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);

/** The Marketing host's origin when the split is on (MARKETING_APP_URL and CLIENT_COOKIE_DOMAIN both valid), else null. */
export function marketingOrigin(env: Env = process.env): string | null {
  const origin = originOf(env.MARKETING_APP_URL);
  const domain = clientCookieDomain(env);
  if (!origin || !domain || origin === frontOrigin(env) || !withinDomain(hostnameOf(origin), domain)) return null;
  return origin;
}

/** The admin host's origin (ADMIN_APP_URL), else null. Never the front or the Marketing host. */
export function adminOrigin(env: Env = process.env): string | null {
  const origin = originOf(env.ADMIN_APP_URL);
  if (!origin || origin === frontOrigin(env) || origin === marketingOrigin(env)) return null;
  return origin;
}

// ---- services --------------------------------------------------------------------------------------------------

export type ServiceId = "marketing" | "agency";
export type Service = { id: ServiceId; name: string; tagline: string; ready: boolean };

/** Every BuPulse service a client can have. Agency OS is phase 2: listed (Coming soon), never routed. */
export const SERVICES: readonly Service[] = [
  { id: "marketing", name: "BuPulse Marketing", tagline: "Posts, videos, a calendar and the leads they bring, made for your business.", ready: true },
  { id: "agency", name: "BuPulse Agency", tagline: "Run your agency's clients, projects and reports in one place.", ready: false },
];

export const serviceOf = (id: ServiceId): Service => SERVICES.find((s) => s.id === id)!;

/** The service's home: its own host's "/" when that host is set, else its path on this site. Null when not routed. */
export function serviceHome(id: ServiceId, env: Env = process.env): string | null {
  if (id === "marketing") {
    const m = marketingOrigin(env);
    return m ? `${m}/` : "/dashboard";
  }
  return null;
}

// ---- hosts -----------------------------------------------------------------------------------------------------

export type HostKind = "front" | "marketing" | "admin" | "support";

const cleanHost = (host: string | null | undefined) => (host ?? "").split(",")[0].trim().toLowerCase();

/** Which host a request's Host header names. Anything not configured is the front host (bupulse.com, localhost...). */
export function hostKind(host: string | null | undefined, env: Env = process.env): HostKind {
  if (isSupportHost(host)) return "support";
  const name = cleanHost(host);
  if (!name) return "front";
  const m = marketingOrigin(env);
  if (m && sameHost(name, m)) return "marketing";
  const a = adminOrigin(env);
  if (a && sameHost(name, a)) return "admin";
  return "front";
}

/** A Host header against a configured origin; the default port may be left out on either side. */
function sameHost(host: string, origin: string): boolean {
  const url = new URL(origin);
  const bare = host.replace(/:(80|443)$/, "");
  return bare === url.host || (url.port === "" && bare === url.hostname);
}

// ---- paths -----------------------------------------------------------------------------------------------------

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** The signed-in Marketing pages outside /dashboard, served as they are on the Marketing host. */
export const MARKETING_PAGES = ["/welcome", "/onboarding", "/start-trial", "/book-demo", "/custom-plan"] as const;

/** True for a path the Marketing host serves (app paths: /dashboard/... and the onboarding pages). */
export const isMarketingPath = (path: string) => under(path, "/dashboard") || MARKETING_PAGES.some((p) => under(path, p));
export const isAdminPath = (path: string) => under(path, "/admin");

/**
 * Front-host pages a visitor may reach from the Marketing host (sign-in, the chooser, account and public pages): there
 * they go back to bupulse.com. Never the name of a dashboard page (tests/platform/app-hosts.test.ts reads app/dashboard):
 * /creators stays the dashboard's Creator campaigns on the Marketing host.
 */
export const FRONT_PAGES = [
  "/login", "/signup", "/forgot-password", "/reset-password", "/apps", "/suspended", "/account", "/invite", "/creator",
  "/about", "/blog", "/contact", "/data-deletion", "/done-for-you", "/industries", "/partners", "/pricing", "/privacy",
  "/quote", "/refund-policy", "/terms", "/c", "/call", "/called", "/screen", "/help-chat", "/posted", "/support",
] as const;

/** Assets, APIs, auth routes and files every app host serves as they are. */
const PASS_PREFIXES = ["/_next/", "/api/", "/auth/", "/.well-known/", "/icons/", "/fonts/", "/brand/"];
const isPassThrough = (path: string) => PASS_PREFIXES.some((p) => path.startsWith(p)) || /\/[^/]*\.[a-z0-9]+$/i.test(path);

/**
 * Connection flows start on bupulse.com, where their registered callbacks are, so the state and PKCE cookies live on
 * the host that receives the callback. A start reached on the Marketing host (an old link) is sent there.
 */
const CONNECT_STARTS = [/^\/api\/social\/[a-z0-9_-]+\/connect$/, /^\/api\/creator\/[a-z0-9_-]+\/connect$/, /^\/api\/canva\/connect$/, /^\/api\/stores\/shopify\/connect$/];
export const isConnectStart = (path: string) => CONNECT_STARTS.some((r) => r.test(path));

/** The admin Google Calendar callback: registered on bupulse.com, finished on the admin host (its session and state). */
export const ADMIN_CALLBACKS = ["/api/admin/google-calendar/callback"] as const;

/** An app path as its host shows it: /dashboard/posts -> /posts, /dashboard -> /, /admin/companies -> /companies. */
export function cleanPath(path: string): string {
  for (const prefix of ["/dashboard", "/admin"]) {
    if (path === prefix) return "/";
    if (path.startsWith(`${prefix}/`)) return path.slice(prefix.length);
  }
  return path;
}

/** A clean Marketing-host path back to the app path: / -> /dashboard, /posts -> /dashboard/posts, /welcome stays. */
export function marketingAppPath(clean: string): string {
  if (MARKETING_PAGES.some((p) => under(clean, p)) || under(clean, "/dashboard")) return clean;
  return clean === "/" ? "/dashboard" : `/dashboard${clean}`;
}

/** A clean admin-host path back to the app path: / -> /admin, /companies -> /admin/companies. */
export const adminAppPath = (clean: string) => (under(clean, "/admin") ? clean : clean === "/" ? "/admin" : `/admin${clean}`);

/** The app path behind what the browser shows on a host (for active menu items and path rules). */
export function appPathOn(kind: HostKind, shown: string): string {
  if (kind === "marketing") return marketingAppPath(shown);
  if (kind === "admin") return adminAppPath(shown);
  return shown;
}

// ---- absolute links --------------------------------------------------------------------------------------------

/** Splits "/a/b?x#y" into its path and the rest. */
function splitPath(path: string): { pathname: string; rest: string } {
  const i = path.search(/[?#]/);
  return i === -1 ? { pathname: path, rest: "" } : { pathname: path.slice(0, i), rest: path.slice(i) };
}

/**
 * The absolute address of an app path for emails, notifications, Telegram buttons and return URLs: on the Marketing
 * or admin host (clean) when that host is set, else `fallback` + path, exactly as before.
 */
export function appUrl(path: string, fallback: string = frontOrigin(), env: Env = process.env): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const { pathname, rest } = splitPath(p);
  const m = marketingOrigin(env);
  if (m && isMarketingPath(pathname)) return `${m}${cleanPath(pathname)}${rest}`;
  const a = adminOrigin(env);
  if (a && isAdminPath(pathname)) return `${a}${cleanPath(pathname)}${rest}`;
  return `${fallback.replace(/\/$/, "")}${p}`;
}

/** Same as appUrl, named for admin links (/admin/...). */
export const adminUrl = appUrl;

/**
 * An href for a page from the host the visitor is on: a clean relative path on its own host, an absolute address on
 * another host (render it as <a>, not a Next Link), the path unchanged when nothing is split.
 */
export function hrefOn(kind: HostKind, path: string, hosts: { marketing: string | null; admin: string | null; front: string }): string {
  const { pathname, rest } = splitPath(path);
  const target: HostKind = hosts.marketing && isMarketingPath(pathname) ? "marketing" : hosts.admin && isAdminPath(pathname) ? "admin" : "front";
  const here: HostKind = kind === "support" ? "front" : kind;
  const shown = target === "front" ? path : `${cleanPath(pathname)}${rest}`;
  if (target === here) return shown;
  const origin = target === "marketing" ? hosts.marketing : target === "admin" ? hosts.admin : hosts.front;
  return `${origin}${shown}`;
}

/** The configured hosts for hrefOn (server side; pass it to the browser). */
export const hostsConfig = (env: Env = process.env) => ({ marketing: marketingOrigin(env), admin: adminOrigin(env), front: frontOrigin(env) });
export type HostsConfig = ReturnType<typeof hostsConfig>;

// ---- safe next ---------------------------------------------------------------------------------------------------

/**
 * A `next` given as an absolute address on one of our client hosts (the Marketing host's sign-in gate sends
 * https://marketing.bupulse.com/posts?x) as the app path it stands for (/dashboard/posts?x). Null for anything else:
 * another site, the admin host, a login in the URL, a non-http scheme.
 */
export function nextFromUrl(value: string, env: Env = process.env): string | null {
  if (!/^https?:\/\//i.test(value) || /[\x00-\x1f\x7f\\]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const rest = `${url.search}${url.hash}`;
  const m = marketingOrigin(env);
  if (m && url.origin === m) return `${marketingAppPath(url.pathname)}${rest}`;
  if (url.origin === frontOrigin(env) && clientCookieDomain(env)) return `${url.pathname}${rest}`;
  return null;
}

/** Where a sign-in goes when nothing asked for a page: the service chooser once the Marketing host is on. */
export const afterSignInPath = (env: Env = process.env) => (marketingOrigin(env) ? "/apps" : "/dashboard");

// ---- the proxy's routing -----------------------------------------------------------------------------------------

export type HostRoute =
  | { action: "pass" }
  | { action: "rewrite"; path: string }
  | { action: "redirect"; url: string };

/**
 * What the proxy does with a request on a host (support excluded: lib/support/app-host.ts). Redirects are only for
 * GET and HEAD (a POST is never bounced: WooCommerce's server-to-server callback, forms, server actions), go only to a
 * configured origin, and keep the query.
 */
export function hostRoute(method: string, path: string, search: string, host: string | null | undefined, env: Env = process.env): HostRoute {
  const kind = hostKind(host, env);
  const read = method === "GET" || method === "HEAD";
  const m = marketingOrigin(env);
  const a = adminOrigin(env);
  const front = frontOrigin(env);
  const to = (origin: string, p: string): HostRoute => ({ action: "redirect", url: `${origin}${p}${search}` });

  if (kind === "front") {
    if (!read) return { action: "pass" };
    if (m && isMarketingPath(path)) return to(m, cleanPath(path));
    if (a && isAdminPath(path)) return to(a, cleanPath(path));
    if (a && (ADMIN_CALLBACKS as readonly string[]).includes(path)) return to(a, path);
    return { action: "pass" };
  }

  if (kind === "marketing") {
    if (read && isConnectStart(path)) return to(front, path);
    if (isPassThrough(path) || MARKETING_PAGES.some((p) => under(path, p))) return { action: "pass" };
    // Only reads move; a POST (a server action from a page shown at its clean address) is served where it is.
    if (under(path, "/dashboard")) return read ? to(m!, cleanPath(path)) : { action: "pass" };
    if (isAdminPath(path)) return read ? to(a ?? front, a ? cleanPath(path) : path) : { action: "pass" };
    if (FRONT_PAGES.some((p) => under(path, p))) return read ? to(front, path) : { action: "pass" };
    return { action: "rewrite", path: marketingAppPath(path) };
  }

  if (kind === "admin") {
    if (isPassThrough(path)) return { action: "pass" };
    if (read && isAdminPath(path)) return to(a!, cleanPath(path));
    if (read && isMarketingPath(path)) return to(m ?? front, m ? cleanPath(path) : path);
    // Everything else is the admin console (it has its own /login, and /industries is an admin page here).
    return isAdminPath(path) ? { action: "pass" } : { action: "rewrite", path: adminAppPath(path) };
  }

  return { action: "pass" };
}

/**
 * The absolute URL a host rewrite goes to. As supportRewriteUrl: a request served locally (the PC behind the tunnel
 * sees https://localhost:3002) rewrites to http, or Next.js would proxy it to itself over TLS and fail.
 */
export function hostRewriteUrl(path: string, search: string, requestUrl: string): URL {
  const target = new URL(`${path}${search}`, requestUrl);
  if (target.hostname === "localhost" || target.hostname === "127.0.0.1" || target.hostname === "[::1]" || target.hostname.endsWith(".localhost")) target.protocol = "http:";
  return target;
}

// ---- session cookies -------------------------------------------------------------------------------------------

export const CLIENT_AUTH_COOKIE = "bp-client-auth";
export const ADMIN_AUTH_COOKIE = "bp-admin-auth";
/** Tells the browser's Supabase client which session cookie this host uses ("client:.bupulse.com" or "admin"). */
export const AUTH_SCOPE_COOKIE = "bp-auth-scope";

export type AuthCookie = { name: string; domain?: string } | null;

/**
 * The Supabase session cookie for a host: the admin host's own host-only cookie; the client hosts' shared cookie
 * (Domain=.bupulse.com) when CLIENT_COOKIE_DOMAIN is set; null (Supabase's default name, host-only) for the support
 * host and whenever nothing is set, exactly as before.
 */
export function authCookieFor(host: string | null | undefined, env: Env = process.env): AuthCookie {
  const kind = hostKind(host, env);
  if (kind === "support") return null;
  if (kind === "admin") return { name: ADMIN_AUTH_COOKIE };
  const domain = clientCookieDomain(env);
  const hostname = cleanHost(host).replace(/:\d+$/, "");
  if (domain && hostname && withinDomain(hostname, domain)) return { name: CLIENT_AUTH_COOKIE, domain: `.${domain}` };
  return null;
}

/** The value of AUTH_SCOPE_COOKIE for a host, or null (no cookie: the default). */
export const authScopeValue = (cookie: AuthCookie): string | null => (!cookie ? null : cookie.name === ADMIN_AUTH_COOKIE ? "admin" : `client:${cookie.domain ?? ""}`);

/** The browser side: AUTH_SCOPE_COOKIE's value back to the cookie options, or null for the default. */
export function authCookieFromScope(value: string | null | undefined): AuthCookie {
  if (value === "admin") return { name: ADMIN_AUTH_COOKIE };
  const m = /^client:(\.[a-z0-9-]+(?:\.[a-z0-9-]+)*)$/.exec(value ?? "");
  return m ? { name: CLIENT_AUTH_COOKIE, domain: m[1] } : null;
}

export type SessionCookieOptions = { name: string; domain?: string; path: "/"; sameSite: "lax"; secure: boolean };

/**
 * Supabase SSR `cookieOptions` for a host (the server client, the proxy): undefined keeps Supabase's default. Secure
 * when the host's configured address is https, so the server, the proxy and the browser write the same cookie.
 */
export function sessionCookieOptions(host: string | null | undefined, env: Env = process.env): SessionCookieOptions | undefined {
  const cookie = authCookieFor(host, env);
  if (!cookie) return undefined;
  const origin = cookie.name === ADMIN_AUTH_COOKIE ? adminOrigin(env) : frontOrigin(env);
  return { name: cookie.name, ...(cookie.domain ? { domain: cookie.domain } : {}), path: "/", sameSite: "lax", secure: (origin ?? "").startsWith("https://") };
}

/**
 * In the browser: the client cookie domain (".bupulse.com") from AUTH_SCOPE_COOKIE, for cookies written on bupulse.com
 * that the Marketing host reads (the plan picked in the pricing quiz, read by /start-trial). Null while the split is off.
 */
export function browserClientCookieDomain(cookieHeader: string): string | null {
  const raw = cookieHeader.split("; ").find((c) => c.startsWith(`${AUTH_SCOPE_COOKIE}=`))?.slice(AUTH_SCOPE_COOKIE.length + 1);
  let value: string | null = null;
  try {
    value = raw ? decodeURIComponent(raw) : null;
  } catch {
    value = null;
  }
  return authCookieFromScope(value)?.domain ?? null;
}

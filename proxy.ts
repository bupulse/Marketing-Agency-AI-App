import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { REF_COOKIE, refCookieFor } from "@/lib/sales/ref-cookie";
import { isSupportPath, supportRewriteUrl, supportRoute } from "@/lib/support/app-host";
import { AUTH_SCOPE_COOKIE, authCookieFor, authScopeValue, frontOrigin, hostKind, hostRewriteUrl, hostRoute, isSelfFetch, marketingOrigin, requestHost, sameHostRedirect, sessionCookieOptions } from "@/lib/platform/app-hosts";

const PROTECTED = ["/dashboard", "/welcome", "/onboarding", "/start-trial", "/book-demo", "/custom-plan", "/account", "/apps"];

/** Local development only (REGION_OVERRIDE=1): ?region=RW is kept in a cookie lib/region.ts reads. Otherwise nothing sets it. */
const REGION_COOKIE = "bp-region";
const REGION_KEY = /^[A-Z][A-Z0-9_]{1,15}$/;

/**
 * Host redirects are 307 (never 308): browsers keep a 308 for ever, so switching MARKETING_APP_URL or ADMIN_APP_URL
 * off would not reach people who had been redirected once (docs/HOSTS.md).
 */
const HOST_REDIRECT = 307;

// Routes each host (lib/platform/app-hosts.ts, lib/support/app-host.ts), refreshes the Supabase session cookie on
// every request and keeps signed-out visitors out of the dashboard.
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // support.bupulse.com serves only the support app: its paths are rewritten under /support (lib/support/app-host.ts).
  const support = supportRoute(path, request.headers.get("host"));
  // bupulse.com, marketing.bupulse.com and admin.bupulse.com (switched off until their addresses are set). Next.js's own
  // fetch of a server action's redirect target comes from localhost: its host is in X-Forwarded-Host (requestHost).
  const host = requestHost(request.headers);
  const selfFetch = isSelfFetch(request.headers);
  const route = support ? null : hostRoute(request.method, path, request.nextUrl.search, host);
  // On the self-hosted PC (`next start` behind the tunnel) a host rewrite (admin.bupulse.com/ → /admin) is fetched by the
  // server itself from localhost, with the visitor's host in X-Forwarded-Host, and comes back through this proxy as a
  // self-fetch of the app path. Its "clean the address" redirect (/admin → /) must not answer it: that gave every admin
  // page, and every Marketing page for a signed-in client, an empty 204 (11 November 2026). A same-host clean-path
  // redirect on a self-fetch is served as it is (the path is already the app's own); any other host redirect is left to
  // the browser.
  if (route?.action === "redirect") {
    if (!selfFetch) return noindexOnApp(NextResponse.redirect(route.url, HOST_REDIRECT), host);
    if (!sameHostRedirect(route.url, host)) return leaveToBrowser();
  }
  const rewrite = support?.action === "rewrite" ? supportRewriteUrl(support.path, request.nextUrl.search, request.url) : route?.action === "rewrite" ? hostRewriteUrl(route.path, request.nextUrl.search, request.url) : null;
  const pass = () => (rewrite ? NextResponse.rewrite(rewrite, { request }) : NextResponse.next({ request }));
  let response = pass();

  // The session cookie this host uses: one client cookie shared by bupulse.com and the service hosts, the admin host's
  // own, or Supabase's default (the support host, and everything while CLIENT_COOKIE_DOMAIN is unset).
  const cookie = authCookieFor(host);
  const cookieOptions = sessionCookieOptions(host);
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      ...(cookieOptions ? { cookieOptions } : {}),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = pass();
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // The gate reads the signed session token here, without a round trip to Supabase Auth: getClaims checks its signature
  // with the project's published key (ES256, cached 10 minutes for every request) and refreshes an expired session
  // like getUser did. A token signed the legacy way (HS256) falls back to the network check by itself. Pages still
  // verify the person with Supabase Auth (getCurrentUser), so a revoked session cannot reach any data.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const kind = support ? "support" : hostKind(host);
  // The support app is never indexed, on its own host or at /support; nor are the Marketing and admin hosts.
  if (support || isSupportPath(path) || kind === "marketing" || kind === "admin") response.headers.set("X-Robots-Tag", "noindex, nofollow");

  if (kind === "marketing" && !signedIn) {
    // Signed out on the Marketing host: the one client sign-in on bupulse.com, back to this clean address afterwards
    // (lib/auth/safe-next.ts turns it back into the app path). Assets, APIs and auth routes are not gated.
    const appPath = route?.action === "rewrite" ? route.path : path;
    if (PROTECTED.some((p) => appPath === p || appPath.startsWith(`${p}/`))) {
      if (selfFetch) return leaveToBrowser();
      const url = new URL("/login", frontOrigin());
      url.searchParams.set("next", `${marketingOrigin()}${path}${request.nextUrl.search}`);
      return noindexOnApp(NextResponse.redirect(url, HOST_REDIRECT), host);
    }
  } else if (kind === "front" && !signedIn && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Keep the query too: a Shopify install arrives as /dashboard/stores/shopify?shop=…&hmac=… and must survive sign-in.
    url.search = "";
    url.searchParams.set("next", `${path}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  // The browser's Supabase client (lib/supabase/client.ts) cannot read the server's environment: this small cookie says
  // which session cookie this host uses. Removed again when the split is switched off.
  const scope = authScopeValue(cookie);
  if (scope && request.cookies.get(AUTH_SCOPE_COOKIE)?.value !== scope) response.cookies.set(AUTH_SCOPE_COOKIE, scope, { path: "/", sameSite: "lax", maxAge: 365 * 24 * 60 * 60 });
  else if (!scope && request.cookies.has(AUTH_SCOPE_COOKIE)) response.cookies.delete(AUTH_SCOPE_COOKIE);

  // Once the client hosts share bp-client-auth, the old default-named session cookies (sb-<project>-auth-token, host-only)
  // are dead weight sent with every request: removed. Everyone signs in again once after the switch (docs/HOSTS.md).
  if (cookie?.domain) for (const { name } of request.cookies.getAll()) if (/^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(name)) response.cookies.delete(name);

  const region = request.nextUrl.searchParams.get("region")?.toUpperCase();
  if (process.env.REGION_OVERRIDE === "1" && region && REGION_KEY.test(region)) response.cookies.set(REGION_COOKIE, region, { path: "/", maxAge: 30 * 24 * 60 * 60, sameSite: "lax" });

  // A sales agent's link (?ref=CODE on any page): the first valid code is kept 30 days for sign-up (lib/sales/ref-cookie.ts).
  const ref = refCookieFor(request.nextUrl.searchParams.get("ref"), request.cookies.get(REF_COOKIE)?.value);
  if (ref) response.cookies.set(ref.name, ref.value, ref.options);

  return response;
}

/**
 * A host redirect asked for by Next.js's own fetch of a server action's redirect target: answered with an empty, non-RSC
 * response, so Next.js does not stream that fetch's result (its server-side fetch would follow the redirect to another
 * host without the visitor's cookies) and lets the browser follow the action's redirect itself, through this proxy.
 */
function leaveToBrowser() {
  return new NextResponse(null, { status: 204 });
}

function noindexOnApp(response: NextResponse, host: string | null) {
  const kind = hostKind(host);
  if (kind === "marketing" || kind === "admin") response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: [
    // Everything except static files, images and the public machine-to-machine routes
    // (chat widget and its page, the support chat API with its own visit token or bearer token, the link-in-bio pages, the tracked links (go/), the REST API with its own bearer keys, payment webhooks, scheduled jobs, the video robot, the status check), which never use a browser session.
    "/((?!_next/static|_next/image|favicon.ico|api/widget|api/support|api/v1|api/admin/v1|api/mcp|api/collect|t\\.js|sw\\.js|manifest\\.webmanifest|widget\\.js|widget-chat\\.js|widget/|b/|go/|bio\\.js|api/billing/webhooks|api/meta/webhook|api/cron|api/robot|api/status|api/ui|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)",
  ],
};

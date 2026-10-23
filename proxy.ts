import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { REF_COOKIE, refCookieFor } from "@/lib/sales/ref-cookie";
import { isSupportPath, supportRoute } from "@/lib/support/app-host";

const PROTECTED = ["/dashboard", "/welcome", "/onboarding", "/start-trial", "/book-demo", "/custom-plan", "/account"];

/** Local development only (REGION_OVERRIDE=1): ?region=RW is kept in a cookie lib/region.ts reads. Otherwise nothing sets it. */
const REGION_COOKIE = "bp-region";
const REGION_KEY = /^[A-Z][A-Z0-9_]{1,15}$/;

// Refreshes the Supabase session cookie on every request and keeps
// signed-out visitors out of the dashboard.
export async function proxy(request: NextRequest) {
  // support.bupulse.com serves only the support app: its paths are rewritten under /support (lib/support/app-host.ts).
  const support = supportRoute(request.nextUrl.pathname, request.headers.get("host"));
  const pass = () =>
    support?.action === "rewrite" ? NextResponse.rewrite(new URL(`${support.path}${request.nextUrl.search}`, request.url), { request }) : NextResponse.next({ request });
  let response = pass();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // The support app is never indexed, on its own host or at /support.
  if (support || isSupportPath(path)) response.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (!support && !user && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Keep the query too: a Shopify install arrives as /dashboard/stores/shopify?shop=…&hmac=… and must survive sign-in.
    url.search = "";
    url.searchParams.set("next", `${path}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  const region = request.nextUrl.searchParams.get("region")?.toUpperCase();
  if (process.env.REGION_OVERRIDE === "1" && region && REGION_KEY.test(region)) response.cookies.set(REGION_COOKIE, region, { path: "/", maxAge: 30 * 24 * 60 * 60, sameSite: "lax" });

  // A sales agent's link (?ref=CODE on any page): the first valid code is kept 30 days for sign-up (lib/sales/ref-cookie.ts).
  const ref = refCookieFor(request.nextUrl.searchParams.get("ref"), request.cookies.get(REF_COOKIE)?.value);
  if (ref) response.cookies.set(ref.name, ref.value, ref.options);

  return response;
}

export const config = {
  matcher: [
    // Everything except static files, images and the public machine-to-machine routes
    // (chat widget and its page, the support chat API with its own visit token or bearer token, the link-in-bio pages, the REST API with its own bearer keys, payment webhooks, scheduled jobs, the video robot, the status check), which never use a browser session.
    "/((?!_next/static|_next/image|favicon.ico|api/widget|api/support|api/v1|api/admin/v1|api/mcp|api/collect|t\\.js|sw\\.js|manifest\\.webmanifest|widget\\.js|widget-chat\\.js|widget/|b/|bio\\.js|api/billing/webhooks|api/meta/webhook|api/cron|api/robot|api/status|api/ui|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)",
  ],
};

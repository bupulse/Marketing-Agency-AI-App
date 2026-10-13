import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/dashboard", "/welcome", "/onboarding", "/book-demo", "/custom-plan", "/account"];

/** Local development only (REGION_OVERRIDE=1): ?region=RW is kept in a cookie lib/region.ts reads. Otherwise nothing sets it. */
const REGION_COOKIE = "bp-region";
const REGION_KEY = /^[A-Z][A-Z0-9_]{1,15}$/;

// Refreshes the Supabase session cookie on every request and keeps
// signed-out visitors out of the dashboard.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

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
          response = NextResponse.next({ request });
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
  if (!user && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Keep the query too: a Shopify install arrives as /dashboard/stores/shopify?shop=…&hmac=… and must survive sign-in.
    url.search = "";
    url.searchParams.set("next", `${path}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  const region = request.nextUrl.searchParams.get("region")?.toUpperCase();
  if (process.env.REGION_OVERRIDE === "1" && region && REGION_KEY.test(region)) response.cookies.set(REGION_COOKIE, region, { path: "/", maxAge: 30 * 24 * 60 * 60, sameSite: "lax" });

  return response;
}

export const config = {
  matcher: [
    // Everything except static files, images and the public machine-to-machine routes
    // (chat widget and its page, the REST API with its own bearer keys, payment webhooks, scheduled jobs, the video robot, the status check), which never use a browser session.
    "/((?!_next/static|_next/image|favicon.ico|api/widget|api/v1|api/admin/v1|api/mcp|api/collect|t\\.js|widget\\.js|widget-chat\\.js|widget/|api/billing/webhooks|api/cron|api/robot|api/status|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { siteUrl } from "@/lib/auth/site-url";
import { googleAuthorizeUrl, googleCalendarConfig, googleSettingsUrl, newCodeVerifier, newState, sealGoogleState, STATE_COOKIE, STATE_COOKIE_PATH } from "@/lib/google-calendar/oauth";

// Admin -> Settings -> Connect Google Calendar. Admins only (allow-listed email, AAL2: requireAdmin answers 404 or sends
// to the code page otherwise). Redirects to Google's consent page with PKCE; the sealed state cookie ties the callback
// to this admin for 10 minutes. Setup: docs/GOOGLE_CALENDAR.md.

export async function GET() {
  const admin = await requireAdmin();
  const config = googleCalendarConfig();
  if (!config) return NextResponse.redirect(googleSettingsUrl("error", "Google Calendar is not set up: add GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET (docs/GOOGLE_CALENDAR.md)."));
  const state = newState();
  const verifier = newCodeVerifier();
  const response = NextResponse.redirect(await googleAuthorizeUrl(config, state, verifier));
  // sameSite lax so the cookie comes back on Google's top-level redirect to the callback.
  response.cookies.set(STATE_COOKIE, await sealGoogleState({ state, verifier, adminId: admin.id }), {
    httpOnly: true,
    secure: siteUrl().startsWith("https://"),
    sameSite: "lax",
    path: STATE_COOKIE_PATH,
    maxAge: 600,
  });
  response.headers.set("cache-control", "no-store");
  return response;
}

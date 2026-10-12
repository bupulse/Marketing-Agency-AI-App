import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { consoleContext } from "@/lib/admin/types";
import { logError } from "@/lib/errors";
import { clientIp } from "@/lib/platform/headers";
import { saveGoogleConnection } from "@/lib/google-calendar/calendar";
import { exchangeGoogleCode, googleCalendarConfig, googleSettingsUrl, GoogleOAuthError, openGoogleState, sameString, STATE_COOKIE, STATE_COOKIE_PATH } from "@/lib/google-calendar/oauth";

// Google sends the admin back here. Checks the admin again (AAL2), the sealed state and its PKCE verifier, swaps the
// code for tokens, and saves the encrypted refresh token (audited as connect_google_calendar). Always back to Settings.

const MESSAGES: Record<string, string> = {
  state: "The Google sign-in could not be matched to this session. Try Connect Google Calendar again.",
  expired: "The Google sign-in took too long. Try Connect Google Calendar again.",
  denied: "Google Calendar was not connected: access was declined on Google's page.",
  scopes: "Google Calendar was not connected: tick both calendar permissions on Google's page (see and edit events, see free/busy).",
  no_refresh_token: "Google sent no refresh token. Remove BuPulse from your Google account's third-party access, then connect again.",
  failed: "Google Calendar could not be connected. Try again; if it keeps failing, check docs/GOOGLE_CALENDAR.md.",
};

function done(key: "notice" | "error", message: string) {
  const response = NextResponse.redirect(googleSettingsUrl(key, message));
  response.cookies.delete({ name: STATE_COOKIE, path: STATE_COOKIE_PATH });
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  const config = googleCalendarConfig();
  if (!config) return done("error", "Google Calendar is not set up: add GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET (docs/GOOGLE_CALENDAR.md).");
  const query = request.nextUrl.searchParams;
  const opened = await openGoogleState(request.cookies.get(STATE_COOKIE)?.value, admin.id);
  if (!opened.ok) return done("error", MESSAGES[opened.reason === "expired" ? "expired" : "state"]);
  if (!sameString(opened.data.state, query.get("state") ?? "")) return done("error", MESSAGES.state);
  if (query.get("error")) return done("error", MESSAGES[query.get("error") === "access_denied" ? "denied" : "failed"]);
  const code = query.get("code");
  if (!code) return done("error", MESSAGES.failed);
  try {
    const grant = await exchangeGoogleCode(config, code, opened.data.verifier);
    const ip = clientIp(request.headers);
    const saved = await saveGoogleConnection(consoleContext(ip), grant);
    const moved = saved.accountChanged ? " This is a different Google account, so the calendar is back to \"primary\"; events made in the old account stay there." : "";
    return done("notice", `Google Calendar connected${saved.email ? ` (${saved.email})` : ""}. New demo bookings get a Google Meet link and an event in calendar "${saved.calendarId}".${moved}`);
  } catch (error) {
    if (error instanceof GoogleOAuthError && (error.code === "scopes" || error.code === "no_refresh_token")) return done("error", MESSAGES[error.code]);
    await logError(error, { source: "google-calendar.callback" });
    return done("error", MESSAGES.failed);
  }
}

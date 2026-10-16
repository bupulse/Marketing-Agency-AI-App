import { NextResponse } from "next/server";
import { requestSiteUrl } from "@/lib/auth/request-site";
import { cookieOptions, PENDING_PATH, pendingCookieNames, STATE_COOKIE, type ConnectErrorCode } from "./oauth";

// Shared by the two places a sign-in comes back to: the network's own callback and BuPulse-Socials' (Composio).

export type Outcome = { error: ConnectErrorCode } | { connected: string } | { pick: string };

export async function done(next: string, outcome: Outcome, setCookies: Record<string, string> = {}) {
  const url = new URL(next, await requestSiteUrl());
  for (const [key, value] of Object.entries(outcome)) url.searchParams.set(key, value);
  const response = NextResponse.redirect(url);
  response.cookies.delete({ name: STATE_COOKIE, path: "/api/social" });
  for (const [name, value] of Object.entries(setCookies)) response.cookies.set(name, value, await cookieOptions(PENDING_PATH));
  // A finished or failed connect leaves no half-open account picker behind.
  if (!("pick" in outcome)) for (const name of pendingCookieNames()) response.cookies.delete({ name, path: PENDING_PATH });
  return response;
}

export function readCookie(request: Request, name: string) {
  const raw = request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
  return raw ? decodeURIComponent(raw) : undefined;
}

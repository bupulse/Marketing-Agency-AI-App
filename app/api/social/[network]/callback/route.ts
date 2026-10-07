import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/require-user";
import { safeNext } from "@/lib/auth/safe-next";
import { siteUrl } from "@/lib/auth/site-url";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { saveConnections } from "@/lib/social/connections";
import { cookieOptions, openState, PENDING_PATH, pendingCookieNames, redirectUri, sameString, sealPending, STATE_COOKIE, type ConnectErrorCode } from "@/lib/social/oauth";
import { getProvider, isNetwork } from "@/lib/social/registry";
import { SocialError } from "@/lib/social/types";

type Outcome = { error: ConnectErrorCode } | { connected: string } | { pick: string };

function done(next: string, outcome: Outcome, setCookies: Record<string, string> = {}) {
  const url = new URL(next, siteUrl());
  for (const [key, value] of Object.entries(outcome)) url.searchParams.set(key, value);
  const response = NextResponse.redirect(url);
  response.cookies.delete({ name: STATE_COOKIE, path: "/api/social" });
  for (const [name, value] of Object.entries(setCookies)) response.cookies.set(name, value, cookieOptions(PENDING_PATH));
  // A finished or failed connect leaves no half-open account picker behind.
  if (!("pick" in outcome)) for (const name of pendingCookieNames()) response.cookies.delete({ name, path: PENDING_PATH });
  return response;
}

function readCookie(request: Request, name: string) {
  const raw = request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
  return raw ? decodeURIComponent(raw) : undefined;
}

/** The network sends the user back here. Checks state, swaps the code for tokens, then saves the account or asks which one to connect. */
export async function GET(request: Request, { params }: { params: Promise<{ network: string }> }) {
  const { network } = await params;
  if (!isNetwork(network)) return new Response("Not found", { status: 404 });
  const user = await requireActiveUser();
  const query = new URL(request.url).searchParams;
  const fallback = "/dashboard/connections";

  const opened = await openState(readCookie(request, STATE_COOKIE), user.id, network);
  if (!opened.ok) return done(fallback, { error: opened.reason === "expired" ? "expired" : "state" });
  const pending = opened.data;
  const next = safeNext(pending.next, fallback);

  if (!sameString(pending.state, query.get("state") ?? "")) return done(next, { error: "state" });
  if (query.get("error")) {
    const denied = query.get("error") === "access_denied" || query.get("error_reason") === "user_denied";
    return done(next, { error: denied ? "denied" : "failed" });
  }
  const code = query.get("code");
  if (!code) return done(next, { error: "failed" });

  try {
    const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!business) return done(next, { error: "failed" });
    const result = await getProvider(network).finishOAuth({ code, codeVerifier: pending.verifier, redirectUri: redirectUri(network), variant: pending.variant });
    if (!result.accounts.length) return done(next, { error: "no_accounts" });

    if (result.accounts.length === 1) {
      await saveConnections(business.id, network, result, [result.accounts[0].externalAccountId], "AUTO");
      return done(next, { connected: network });
    }
    return done(next, { pick: network }, await sealPending(user.id, network, pending.variant, result));
  } catch (error) {
    // "No <account> found" messages are the provider's way of saying the login has nothing to connect.
    if (error instanceof SocialError && error.kind === "invalid" && /^No /.test(error.message)) return done(next, { error: "no_accounts" });
    await logError(error, { source: "social.callback", userId: user.id, network });
    return done(next, { error: "failed" });
  }
}

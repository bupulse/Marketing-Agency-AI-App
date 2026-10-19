import { NextResponse } from "next/server";
import { ForbiddenError } from "@/lib/team/roles";
import { requireActiveUser } from "@/lib/auth/require-user";
import { safeNext } from "@/lib/auth/safe-next";
import { requestSiteUrl } from "@/lib/auth/request-site";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { RATE_LIMITS, rateLimit, RateLimitError } from "@/lib/rate-limit";
import { codeChallenge, cookieOptions, isValidVariant, newCodeVerifier, newState, redirectUri, sealState, STATE_COOKIE, VARIANTS, type ConnectErrorCode } from "@/lib/social/oauth";
import { getProvider, isNetwork } from "@/lib/social/registry";
import { SocialError } from "@/lib/social/types";
import { NETWORK_SERVICE } from "@/lib/admin/service-catalog";
import { isServiceEnabled } from "@/lib/admin/switch";
import { hasFeature, upgradeHref } from "@/lib/entitlements";
import { createConnectLink, viaComposio } from "@/lib/social/composio/client";
import { inboxScopesFor } from "@/lib/social/inbox/scopes";
import { getInboxSettings } from "@/lib/social/inbox/settings";

async function back(next: string, error: ConnectErrorCode) {
  const url = new URL(next, await requestSiteUrl());
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

/** Starts connecting a social account: /api/social/<network>/connect?variant=...&next=... redirects to the network's consent page. */
export async function GET(request: Request, { params }: { params: Promise<{ network: string }> }) {
  const { network } = await params;
  if (!isNetwork(network)) return new Response("Not found", { status: 404 });
  let user: Awaited<ReturnType<typeof requireActiveUser>>;
  try {
    user = await requireActiveUser("channels", "throw");
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response(error.message, { status: 403 });
    throw error;
  }
  const query = new URL(request.url).searchParams;
  const next = safeNext(query.get("next"), "/dashboard/connections");
  const requested = query.get("variant") ?? undefined;

  if (!isValidVariant(network, requested)) return back(next, "unavailable");
  // Channels are part of the calendar feature: "Add to your plan" instead of the network's consent page.
  if (!(await hasFeature(user, "calendar"))) return NextResponse.redirect(new URL(upgradeHref("calendar"), await requestSiteUrl()));
  // Switched off in the admin console: a friendly "unavailable" instead of starting the sign-in.
  if (NETWORK_SERVICE[network] && !(await isServiceEnabled(NETWORK_SERVICE[network]))) return back(next, "unavailable");
  const variant = requested ?? VARIANTS[network]?.[0];
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) return back(next, "failed");

  try {
    await rateLimit(`social-connect:${user.id}`, RATE_LIMITS.socialConnect);
  } catch (error) {
    if (error instanceof RateLimitError) return back(next, "rate_limit");
    throw error;
  }

  // BuPulse-Socials: while BuPulse's own apps wait for the networks' approval, sign-in goes through BuPulse's Composio
  // account (lib/social/composio). The person signs in on the network through Composio's page and comes back to
  // /api/social/<network>/composio, which checks this sealed cookie the same way as the direct callback.
  // Composio switched off in Admin -> Services: the network's own app is used if it is set up.
  if (viaComposio(network) && (await isServiceEnabled("composio"))) {
    try {
      const state = newState();
      const callback = `${await requestSiteUrl()}/api/social/${network}/composio?state=${state}`;
      const link = await createConnectLink(network, business.id, callback);
      const response = NextResponse.redirect(link.url);
      response.cookies.set(STATE_COOKIE, await sealState({ state, verifier: "", userId: user.id, network, variant, next, composioAccount: link.connectedAccountId }), await cookieOptions("/api/social"));
      return response;
    } catch (error) {
      await logError(error, { source: "social.connect.composio", userId: user.id, network });
      return back(next, "failed");
    }
  }

  try {
    const state = newState();
    const verifier = newCodeVerifier();
    // The social inbox's permissions only once its Admin switch says "Meta direct" (lib/social/inbox/scopes.ts).
    const extraScopes = inboxScopesFor(network, variant, (await getInboxSettings()).transport);
    const url = getProvider(network).authorizeUrl({ state, codeChallenge: await codeChallenge(verifier), redirectUri: redirectUri(network), variant, extraScopes });
    const response = NextResponse.redirect(url);
    // sameSite lax so the cookie comes back on the network's redirect to the callback.
    response.cookies.set(STATE_COOKIE, await sealState({ state, verifier, userId: user.id, network, variant, next }), await cookieOptions("/api/social"));
    return response;
  } catch (error) {
    if (error instanceof SocialError && error.kind === "invalid") return back(next, "unavailable");
    await logError(error, { source: "social.connect", userId: user.id, network });
    return back(next, "failed");
  }
}

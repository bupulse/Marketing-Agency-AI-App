import { NextResponse } from "next/server";
import { ForbiddenError } from "@/lib/team/roles";
import { requireActiveUser } from "@/lib/auth/require-user";
import { safeNext } from "@/lib/auth/safe-next";
import { siteUrl } from "@/lib/auth/site-url";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { RATE_LIMITS, rateLimit, RateLimitError } from "@/lib/rate-limit";
import { codeChallenge, cookieOptions, isValidVariant, newCodeVerifier, newState, redirectUri, sealState, STATE_COOKIE, VARIANTS, type ConnectErrorCode } from "@/lib/social/oauth";
import { getProvider, isNetwork } from "@/lib/social/registry";
import { SocialError } from "@/lib/social/types";
import { NETWORK_SERVICE } from "@/lib/admin/service-catalog";
import { isServiceEnabled } from "@/lib/admin/switch";
import { hasFeature, upgradeHref } from "@/lib/entitlements";

function back(next: string, error: ConnectErrorCode) {
  const url = new URL(next, siteUrl());
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
  if (!(await hasFeature(user, "calendar"))) return NextResponse.redirect(new URL(upgradeHref("calendar"), siteUrl()));
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

  try {
    const state = newState();
    const verifier = newCodeVerifier();
    const url = getProvider(network).authorizeUrl({ state, codeChallenge: await codeChallenge(verifier), redirectUri: redirectUri(network), variant });
    const response = NextResponse.redirect(url);
    // sameSite lax so the cookie comes back on the network's redirect to the callback.
    response.cookies.set(STATE_COOKIE, await sealState({ state, verifier, userId: user.id, network, variant, next }), cookieOptions("/api/social"));
    return response;
  } catch (error) {
    if (error instanceof SocialError && error.kind === "invalid") return back(next, "unavailable");
    await logError(error, { source: "social.connect", userId: user.id, network });
    return back(next, "failed");
  }
}

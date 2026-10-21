import { NextResponse } from "next/server";
import { ensureAccount } from "@/lib/account";
import { requestSiteUrl } from "@/lib/auth/request-site";
import { NETWORK_SERVICE } from "@/lib/admin/service-catalog";
import { isServiceEnabled } from "@/lib/admin/switch";
import { composioCreatorId } from "@/lib/creators/auth";
import { CREATOR_CONNECT_PATH, creatorConnectBack, creatorConnectLink, creatorNetworkReady } from "@/lib/creators/connect-flow";
import { isCreatorNetwork } from "@/lib/creators/describe";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { RATE_LIMITS, rateLimit, RateLimitError } from "@/lib/rate-limit";
import { cookieOptions, newState, sealState, STATE_COOKIE } from "@/lib/social/oauth";
import { getCurrentUser } from "@/lib/supabase/server";

/**
 * A creator connects Instagram, a Facebook Page or TikTok through BuPulse-Socials (Composio, docs/CREATOR_CAMPAIGNS.md):
 * /api/creator/<network>/connect sends them to Composio's sign-in, which comes back to /api/creator/<network>/callback.
 * Their Composio user is "creator_<profileId>", never a business id. Same sealed state cookie as the company side.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/creator/[network]/connect">) {
  const { network } = await params;
  if (!isCreatorNetwork(network)) return new Response("Not found", { status: 404 });
  const user = await getCurrentUser();
  if (!user || !(await ensureAccount(user))) return NextResponse.redirect(new URL("/login?next=/creator/connections", await requestSiteUrl()));
  const profile = await prisma.creatorProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!profile) return NextResponse.redirect(new URL("/dashboard", await requestSiteUrl()));

  if (!process.env.COMPOSIO_API_KEY || !(await isServiceEnabled("composio"))) return creatorConnectBack({ error: "unavailable" });
  if (!creatorNetworkReady(network) || (NETWORK_SERVICE[network] && !(await isServiceEnabled(NETWORK_SERVICE[network])))) return creatorConnectBack({ error: "unavailable" });
  try {
    await rateLimit(`creator-connect:${user.id}`, RATE_LIMITS.socialConnect);
  } catch (error) {
    if (error instanceof RateLimitError) return creatorConnectBack({ error: "rate_limit" });
    throw error;
  }

  try {
    const state = newState();
    const callback = `${await requestSiteUrl()}/api/creator/${network}/callback?state=${state}`;
    const link = await creatorConnectLink(network, composioCreatorId(profile.id), callback);
    const response = NextResponse.redirect(link.url);
    response.cookies.set(STATE_COOKIE, await sealState({ state, verifier: "", userId: user.id, network, next: "/creator/connections", composioAccount: link.connectedAccountId }), await cookieOptions(CREATOR_CONNECT_PATH));
    return response;
  } catch (error) {
    await logError(error, { source: "creators.connect", userId: user.id, network });
    return creatorConnectBack({ error: "failed" });
  }
}

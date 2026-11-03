import { ForbiddenError } from "@/lib/team/roles";
import { requireActiveUser } from "@/lib/auth/require-user";
import { safeNext } from "@/lib/auth/safe-next";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { forgetUnusedZernio, saveConnections } from "@/lib/social/connections";
import { done, readCookie, type Outcome } from "@/lib/social/callback-response";
import { openState, sameString, STATE_COOKIE } from "@/lib/social/oauth";
import { isNetwork } from "@/lib/social/registry";
import { zernioAccount } from "@/lib/social/zernio/client";
import { ZERNIO_NETWORKS, ZERNIO_SCOPE, zernioProfileScope } from "@/lib/social/zernio/ways";
import type { OAuthResult } from "@/lib/social/types";
import { NETWORK_SERVICE } from "@/lib/admin/service-catalog";
import { isServiceEnabled } from "@/lib/admin/switch";
import { hasFeature } from "@/lib/entitlements";

/** Zernio's billing and plan gates on a sign-in (docs: /connect/get-connect-url, "Error values"): BuPulse's to fix. */
const FULL = new Set(["payment_required", "account_limit_exceeded", "profile_limit_exceeded", "platform_account_limit"]);

/**
 * Zernio sends the person back here after the TikTok sign-in, with connected, profileId, accountId and username (or
 * error and platform) added to BuPulse's own return address (docs.zernio.com/guides/connecting-accounts). The sealed
 * cookie names the business's Zernio profile; the state and the profile must match it. The account is then read back
 * from that profile (an accountId that is not in it is never saved) and saved straight away: one TikTok account, no
 * picker.
 */
export async function GET(request: Request, { params }: { params: Promise<{ network: string }> }) {
  const { network } = await params;
  if (!isNetwork(network) || !ZERNIO_NETWORKS.includes(network)) return new Response("Not found", { status: 404 });
  let user: Awaited<ReturnType<typeof requireActiveUser>>;
  try {
    user = await requireActiveUser("channels", "throw");
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response(error.message, { status: 403 });
    throw error;
  }
  const query = new URL(request.url).searchParams;
  const fallback = "/dashboard/connections";

  const opened = await openState(readCookie(request, STATE_COOKIE), user.id, network);
  if (!opened.ok) return done(fallback, { error: opened.reason === "expired" ? "expired" : "state" });
  const pending = opened.data;
  const next = safeNext(pending.next, fallback);
  const profileId = pending.zernioProfile;
  if (!profileId || !sameString(pending.state, query.get("state") ?? "")) return done(next, { error: "state" });
  const returned = query.get("profileId");
  if (returned && returned !== profileId) return done(next, { error: "state" });

  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) return done(next, { error: "failed" });

  // The sign-in failed or was cancelled on TikTok's or Zernio's side. Unknown values are generic failures (the docs say
  // new ones appear without notice). Only the code is logged: error_message can name the TikTok account.
  const zernioError = query.get("error");
  if (zernioError) {
    if (zernioError === "oauth_denied" || zernioError === "missing_tiktok_permissions") return done(next, { error: "denied" });
    await logError(new Error(`Zernio sign-in ended with ${zernioError.slice(0, 60)}`), { source: FULL.has(zernioError) ? "social.zernio" : "social.callback.zernio", userId: user.id, network, level: "warn" });
    return done(next, { error: FULL.has(zernioError) ? "full" : "failed" });
  }
  const accountId = query.get("accountId");
  // Back without connecting an account.
  if (!accountId) return done(next, { error: "denied" });

  try {
    const account = await zernioAccount(network, profileId, accountId);
    if (!account) return done(next, { error: "failed" });
    // From here the account is this business's: anything but a saved connection disconnects it from Zernio again, so
    // no TikTok sign-in stays there (and counts as a connected account) without a connection using it.
    const drop = async (outcome: Outcome) => {
      await forgetUnusedZernio(network, account.externalAccountId).catch(() => {});
      return done(next, outcome);
    };
    if (NETWORK_SERVICE[network] && !(await isServiceEnabled(NETWORK_SERVICE[network]))) return drop({ error: "unavailable" });
    if (!(await isServiceEnabled("zernio")) || !(await hasFeature(user, "calendar"))) return drop({ error: "unavailable" });
    try {
      const result: OAuthResult = { accessToken: profileId, scopes: [ZERNIO_SCOPE, zernioProfileScope(profileId)], accounts: [account] };
      await saveConnections(business.id, network, result, [account.externalAccountId], "AUTO");
      return done(next, { connected: network });
    } catch (error) {
      await logError(error, { source: "social.callback.zernio", userId: user.id, network });
      return drop({ error: "failed" });
    }
  } catch (error) {
    await logError(error, { source: "social.callback.zernio", userId: user.id, network });
    return done(next, { error: "failed" });
  }
}

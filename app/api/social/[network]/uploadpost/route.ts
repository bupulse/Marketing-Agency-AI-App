import { ForbiddenError } from "@/lib/team/roles";
import { requireActiveUser } from "@/lib/auth/require-user";
import { safeNext } from "@/lib/auth/safe-next";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { askWhereToPost } from "@/lib/social/choices";
import { forgetUnusedUploadPost, saveConnections } from "@/lib/social/connections";
import { done, readCookie } from "@/lib/social/callback-response";
import { openState, sameString, sealPending, STATE_COOKIE } from "@/lib/social/oauth";
import { isNetwork } from "@/lib/social/registry";
import { profileScope, profileUsername, UPLOAD_POST_SCOPE, UPLOAD_POST_NETWORKS } from "@/lib/social/uploadpost/ways";
import { linkedinAccounts } from "@/lib/social/uploadpost/linkedin";
import { tiktokAccounts } from "@/lib/social/uploadpost/tiktok";
import type { OAuthResult } from "@/lib/social/types";
import { NETWORK_SERVICE } from "@/lib/admin/service-catalog";
import { isServiceEnabled } from "@/lib/admin/switch";
import { hasFeature } from "@/lib/entitlements";

/**
 * Upload-Post's connect page sends the person back here ("Back to BuPulse") after they connected LinkedIn or TikTok
 * there. The sealed cookie names the business's Upload-Post profile; it must be this business's. Then the profile's
 * LinkedIn member and the Pages they administer are listed and offered in "Where should BuPulse post?", Pages first;
 * the profile's one TikTok account is saved straight away.
 */
export async function GET(request: Request, { params }: { params: Promise<{ network: string }> }) {
  const { network } = await params;
  if (!isNetwork(network) || !UPLOAD_POST_NETWORKS.includes(network)) return new Response("Not found", { status: 404 });
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
  const username = pending.uploadPostProfile;
  if (!username || !sameString(pending.state, query.get("state") ?? "")) return done(next, { error: "state" });

  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) return done(next, { error: "failed" });
  if (username !== profileUsername(business.id)) return done(next, { error: "state" });
  // Anything but a saved connection leaves no LinkedIn or TikTok sign-in at Upload-Post that no connection uses.
  const drop = async (outcome: Parameters<typeof done>[1]) => {
    await forgetUnusedUploadPost(network, username).catch(() => {});
    return done(next, outcome);
  };

  if (NETWORK_SERVICE[network] && !(await isServiceEnabled(NETWORK_SERVICE[network]))) return drop({ error: "unavailable" });
  if (!(await isServiceEnabled("uploadpost")) || !(await hasFeature(user, "calendar"))) return drop({ error: "unavailable" });

  try {
    const accounts = network === "tiktok" ? await tiktokAccounts(username) : await linkedinAccounts(username);
    // Back without connecting the network on Upload-Post's page.
    if (!accounts) return done(next, { error: "denied" });
    const result: OAuthResult = { accessToken: username, scopes: [UPLOAD_POST_SCOPE, profileScope(username)], accounts };
    if (!askWhereToPost(network, accounts)) {
      await saveConnections(business.id, network, result, [accounts[0].externalAccountId], "AUTO");
      return done(next, { connected: network });
    }
    return done(next, { pick: network }, await sealPending(user.id, network, pending.variant, result));
  } catch (error) {
    await logError(error, { source: "social.callback.uploadpost", userId: user.id, network });
    return drop({ error: "failed" });
  }
}

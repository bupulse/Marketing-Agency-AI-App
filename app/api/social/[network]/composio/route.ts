import { ForbiddenError } from "@/lib/team/roles";
import { requireActiveUser } from "@/lib/auth/require-user";
import { safeNext } from "@/lib/auth/safe-next";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { saveConnections } from "@/lib/social/connections";
import { done, readCookie } from "@/lib/social/callback-response";
import { openState, sameString, sealPending, STATE_COOKIE } from "@/lib/social/oauth";
import { isNetwork } from "@/lib/social/registry";
import { accountScope, COMPOSIO_SCOPE, deleteConnectedAccount, getConnectedAccount } from "@/lib/social/composio/client";
import { composioNetwork } from "@/lib/social/composio/networks";
import { SocialError, type OAuthResult } from "@/lib/social/types";
import { NETWORK_SERVICE } from "@/lib/admin/service-catalog";
import { isServiceEnabled } from "@/lib/admin/switch";
import { hasFeature } from "@/lib/entitlements";

/**
 * BuPulse-Socials (Composio) sends the person back here after they signed in on the network. The sealed cookie names
 * the Composio connected account this sign-in was for; it must now be ACTIVE and belong to this business. Then the
 * accounts it may post to are listed and saved (or offered in the picker), exactly like the direct callback.
 */
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
  const fallback = "/dashboard/connections";

  const opened = await openState(readCookie(request, STATE_COOKIE), user.id, network);
  if (!opened.ok) return done(fallback, { error: opened.reason === "expired" ? "expired" : "state" });
  const pending = opened.data;
  const next = safeNext(pending.next, fallback);
  const accountId = pending.composioAccount;
  if (!accountId || !sameString(pending.state, query.get("state") ?? "")) return done(next, { error: "state" });

  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) return done(next, { error: "failed" });
  // Anything but a saved connection leaves no half-made sign-in at Composio.
  const drop = async (outcome: Parameters<typeof done>[1]) => {
    await deleteConnectedAccount(network, accountId);
    return done(next, outcome);
  };

  if (NETWORK_SERVICE[network] && !(await isServiceEnabled(NETWORK_SERVICE[network]))) return drop({ error: "unavailable" });
  if (!(await isServiceEnabled("composio")) || !(await hasFeature(user, "calendar"))) return drop({ error: "unavailable" });

  try {
    const account = await getConnectedAccount(network, accountId);
    if (account.userId && account.userId !== business.id) return drop({ error: "state" });
    if (account.status !== "ACTIVE") {
      const cancelled = /fail|denied|cancel|error/i.test(query.get("status") ?? "") || account.status === "FAILED";
      return drop({ error: cancelled ? "denied" : "failed" });
    }
    const accounts = await composioNetwork(network).accounts(accountId, business.id);
    if (!accounts.length) return drop({ error: "no_accounts" });
    const result: OAuthResult = { accessToken: accountId, scopes: [COMPOSIO_SCOPE, accountScope(accountId)], accounts };

    if (accounts.length === 1) {
      await saveConnections(business.id, network, result, [accounts[0].externalAccountId], "AUTO");
      return done(next, { connected: network });
    }
    return done(next, { pick: network }, await sealPending(user.id, network, pending.variant, result));
  } catch (error) {
    if (error instanceof SocialError && error.kind === "invalid" && /^No /.test(error.message)) return drop({ error: "no_accounts" });
    await logError(error, { source: "social.callback.composio", userId: user.id, network });
    return drop({ error: "failed" });
  }
}

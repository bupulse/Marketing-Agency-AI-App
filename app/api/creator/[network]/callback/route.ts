import { ensureAccount } from "@/lib/account";
import { NETWORK_SERVICE } from "@/lib/admin/service-catalog";
import { isServiceEnabled } from "@/lib/admin/switch";
import { composioCreatorId } from "@/lib/creators/auth";
import { creatorConnectBack, type CreatorOutcome } from "@/lib/creators/connect-flow";
import { saveCreatorConnection } from "@/lib/creators/connections";
import { isCreatorNetwork } from "@/lib/creators/describe";
import { CreatorAccountError, creatorAdapter } from "@/lib/creators/tracking/adapters";
import { countedCaller } from "@/lib/creators/tracking/caller";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { readCookie } from "@/lib/social/callback-response";
import { deleteConnectedAccount, getConnectedAccount } from "@/lib/social/composio/client";
import { openState, sameString, sealPending, STATE_COOKIE } from "@/lib/social/oauth";
import { SocialError } from "@/lib/social/types";
import { getCurrentUser } from "@/lib/supabase/server";

/**
 * BuPulse-Socials sends the creator back here after they signed in on the network. The sealed cookie names the
 * Composio connected account this sign-in was for: it must be ACTIVE and belong to this creator's Composio user. Then
 * the account is checked (Instagram: a professional account; Facebook: a Page, picked when there are several) and saved
 * as a CreatorConnection. Anything but a saved connection deletes the half-made sign-in at Composio.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/creator/[network]/callback">) {
  const { network } = await params;
  if (!isCreatorNetwork(network)) return new Response("Not found", { status: 404 });
  const user = await getCurrentUser();
  if (!user || !(await ensureAccount(user))) return creatorConnectBack({ error: "state" });
  const profile = await prisma.creatorProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!profile) return creatorConnectBack({ error: "state" });

  const opened = await openState(readCookie(request, STATE_COOKIE), user.id, network);
  if (!opened.ok) return creatorConnectBack({ error: opened.reason === "expired" ? "expired" : "state" });
  const accountId = opened.data.composioAccount;
  const query = new URL(request.url).searchParams;
  if (!accountId || !sameString(opened.data.state, query.get("state") ?? "")) return creatorConnectBack({ error: "state" });
  const drop = async (outcome: CreatorOutcome) => {
    await deleteConnectedAccount(network, accountId);
    return creatorConnectBack(outcome);
  };
  if (!(await isServiceEnabled("composio")) || (NETWORK_SERVICE[network] && !(await isServiceEnabled(NETWORK_SERVICE[network])))) return drop({ error: "unavailable" });

  try {
    const composioUser = composioCreatorId(profile.id);
    const account = await getConnectedAccount(network, accountId);
    if (account.userId && account.userId !== composioUser) return drop({ error: "state" });
    if (account.status !== "ACTIVE") {
      const cancelled = /fail|denied|cancel|error/i.test(query.get("status") ?? "") || account.status === "FAILED";
      return drop({ error: cancelled ? "denied" : "failed" });
    }
    const accounts = await creatorAdapter(network).accounts(countedCaller(network, accountId, composioUser));
    // One account belongs to one creator: a second creator cannot count their posts on someone else's account.
    const others = await prisma.creatorConnection.findMany({ where: { network, externalAccountId: { in: accounts.map((a) => a.externalAccountId) }, profileId: { not: profile.id } }, select: { externalAccountId: true } });
    const free = accounts.filter((a) => !others.some((o) => o.externalAccountId === a.externalAccountId));
    if (!free.length) return drop({ error: accounts.length ? "taken" : "no_accounts" });
    if (free.length === 1) {
      await saveCreatorConnection(profile.id, network, accountId, free[0]);
      return creatorConnectBack({ connected: network });
    }
    return creatorConnectBack({ pick: network }, await sealPending(user.id, network, undefined, { accessToken: accountId, scopes: [], accounts: free }));
  } catch (error) {
    if (error instanceof CreatorAccountError) return drop({ error: error.code });
    if (!(error instanceof SocialError)) await logError(error, { source: "creators.connect.callback", userId: user.id, network });
    return drop({ error: "failed" });
  }
}

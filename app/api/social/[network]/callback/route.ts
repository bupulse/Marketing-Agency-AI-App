import { ForbiddenError } from "@/lib/team/roles";
import { requireActiveUser } from "@/lib/auth/require-user";
import { safeNext } from "@/lib/auth/safe-next";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { askWhereToPost } from "@/lib/social/choices";
import { saveConnections } from "@/lib/social/connections";
import { done, readCookie } from "@/lib/social/callback-response";
import { openState, redirectUri, sameString, sealPending, STATE_COOKIE } from "@/lib/social/oauth";
import { getProvider, isNetwork } from "@/lib/social/registry";
import { SocialError } from "@/lib/social/types";
import { NETWORK_SERVICE } from "@/lib/admin/service-catalog";
import { isServiceEnabled } from "@/lib/admin/switch";
import { hasFeature } from "@/lib/entitlements";

/** The network sends the user back here. Checks state, swaps the code for tokens, then saves the account or asks which one to connect. */
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
  // Switched off (or the plan lost the calendar) while the person was on the network's consent page: show "unavailable" and keep nothing.
  if (NETWORK_SERVICE[network] && !(await isServiceEnabled(NETWORK_SERVICE[network]))) return done(next, { error: "unavailable" });
  if (!(await hasFeature(user, "calendar"))) return done(next, { error: "unavailable" });

  if (!sameString(pending.state, query.get("state") ?? "")) return done(next, { error: "state" });
  if (query.get("error")) {
    const denied = query.get("error") === "access_denied" || query.get("error_reason") === "user_denied";
    // The network's own reason (TikTok: error_type, e.g. "code_challenge"), so a refused sign-in can be told apart in Admin -> Errors.
    if (!denied) {
      const reason = ["error", "error_type", "error_reason", "error_description"].map((k) => query.get(k) && `${k}=${query.get(k)}`).filter(Boolean).join(" ");
      await logError(new Error(`${network} sign-in refused: ${reason}`.slice(0, 500)), { source: "social.callback", level: "warn", userId: user.id, network });
    }
    return done(next, { error: denied ? "denied" : "failed" });
  }
  const code = query.get("code");
  if (!code) return done(next, { error: "failed" });

  try {
    const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!business) return done(next, { error: "failed" });
    const result = await getProvider(network).finishOAuth({ code, codeVerifier: pending.verifier, redirectUri: redirectUri(network), variant: pending.variant });
    if (!result.accounts.length) return done(next, { error: "no_accounts" });

    // One account is saved at once, except LinkedIn: its sign-in always ends on "Where should BuPulse post?".
    if (!askWhereToPost(network, result.accounts)) {
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

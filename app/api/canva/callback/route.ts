import { NextResponse } from "next/server";
import { requirePersonalUser } from "@/lib/auth/require-user";
import { safeNext } from "@/lib/auth/safe-next";
import { requestSiteUrl } from "@/lib/auth/request-site";
import { CanvaApiError, exchangeCode, getCanvaUserId } from "@/lib/canva/client";
import { isCanvaEnabled } from "@/lib/canva/config";
import { isServiceEnabled, UNAVAILABLE_MESSAGE } from "@/lib/admin/switch";
import { openOAuthState, OAUTH_COOKIE, sameString } from "@/lib/canva/pkce";
import { saveTokens } from "@/lib/canva/tokens";
import { hasFeature } from "@/lib/entitlements";
import { logError } from "@/lib/errors";

async function back(next: string, result: "connected" | "denied" | "error") {
  const url = new URL(next, await requestSiteUrl());
  url.searchParams.set("canva", result);
  const response = NextResponse.redirect(url);
  response.cookies.delete({ name: OAUTH_COOKIE, path: "/api/canva" });
  return response;
}

/** Canva sends the user here after they allow (or refuse) access. Checks state, swaps the code for tokens and stores them encrypted. */
export async function GET(request: Request) {
  if (!isCanvaEnabled()) return new Response("Not found", { status: 404 });
  if (!(await isServiceEnabled("canva"))) return new Response(UNAVAILABLE_MESSAGE, { status: 503 });
  const user = await requirePersonalUser();
  const params = new URL(request.url).searchParams;
  const cookie = request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${OAUTH_COOKIE}=`))?.slice(OAUTH_COOKIE.length + 1);
  const pending = await openOAuthState(cookie ? decodeURIComponent(cookie) : undefined, user.id);
  const next = safeNext(pending?.next, "/dashboard/designs");

  if (!pending || !sameString(pending.state, params.get("state") ?? "")) return back(next, "error");
  // Canva editing is a plan feature: a company without it keeps no Canva tokens.
  if (!(await hasFeature(user, "canva"))) return back(next, "error");
  if (params.get("error")) return back(next, params.get("error") === "access_denied" ? "denied" : "error");
  const code = params.get("code");
  if (!code) return back(next, "error");

  try {
    const tokens = await exchangeCode(code, pending.verifier);
    await saveTokens(user.id, tokens, await getCanvaUserId(tokens.accessToken));
    return back(next, "connected");
  } catch (error) {
    await logError(error, { source: "canva.callback", userId: user.id, status: error instanceof CanvaApiError ? error.status : undefined });
    return back(next, "error");
  }
}

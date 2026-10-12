import { NextResponse } from "next/server";
import { requirePersonalUser } from "@/lib/auth/require-user";
import { safeNext } from "@/lib/auth/safe-next";
import { buildAuthorizeUrl, newCodeVerifier, OAUTH_COOKIE, randomToken, sealOAuthState } from "@/lib/canva/pkce";
import { isCanvaEnabled } from "@/lib/canva/config";
import { isServiceEnabled } from "@/lib/admin/switch";
import { featureStatus, upgradeHref } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { siteUrl } from "@/lib/auth/site-url";

/** Starts linking the user's Canva account: OAuth 2.0 code flow with PKCE. `?next=` is where to return to. */
export async function GET(request: Request) {
  if (!isCanvaEnabled()) return new Response("Not found", { status: 404 });
  const user = await requirePersonalUser();
  const next = safeNext(new URL(request.url).searchParams.get("next"), "/dashboard/designs");
  // Canva editing is a plan feature (and its service may be off): "Add to your plan", or back with an error.
  const status = await featureStatus(user, "canva");
  if (status === "not_in_plan") return NextResponse.redirect(new URL(upgradeHref("canva"), siteUrl()));
  if (status !== "ok" || !(await isServiceEnabled("canva"))) return NextResponse.redirect(new URL(`${next}${next.includes("?") ? "&" : "?"}canva=error`, siteUrl()));

  try {
    const state = randomToken(24);
    const verifier = newCodeVerifier();
    const response = NextResponse.redirect(await buildAuthorizeUrl(state, verifier));
    response.cookies.set(OAUTH_COOKIE, await sealOAuthState({ state, verifier, userId: user.id, next }), {
      httpOnly: true,
      secure: siteUrl().startsWith("https://"),
      sameSite: "lax", // the cookie must come back on Canva's redirect to /api/canva/callback
      path: "/api/canva",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    await logError(error, { source: "canva.connect", userId: user.id });
    return NextResponse.redirect(new URL(`${next}${next.includes("?") ? "&" : "?"}canva=error`, siteUrl()));
  }
}

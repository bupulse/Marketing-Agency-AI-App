import { isServiceEnabled, UNAVAILABLE_MESSAGE } from "@/lib/admin/switch";
import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/auth/site-url";
import { ForbiddenError } from "@/lib/team/roles";
import { requireActiveUser } from "@/lib/auth/require-user";
import { randomToken } from "@/lib/canva/pkce";
import { prisma } from "@/lib/db";
import { hasFeature, upgradeHref } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { RATE_LIMITS, rateLimit, RateLimitError } from "@/lib/rate-limit";
import { buildAuthorizeUrl, isShopifyEnabled, normalizeShopDomain, shopifyConfig, verifyOAuthHmac } from "@/lib/stores/shopify";
import { SHOPIFY_COOKIE, sealShopifyState } from "@/lib/stores/state";

const back = (error: string) => NextResponse.redirect(new URL(`/dashboard/stores/shopify?error=${error}`, siteUrl()), 303);
const INSTALL_MAX_AGE_S = 15 * 60;

async function start(shopInput: string | null) {
  let user: Awaited<ReturnType<typeof requireActiveUser>>;
  try {
    user = await requireActiveUser("connectors", "throw");
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response(error.message, { status: 403 });
    throw error;
  }
  const shop = normalizeShopDomain(shopInput);
  if (!shop) return back("invalid_shop");
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) return back("no_business");
  // Store import is a plan feature: "Add to your plan" instead of Shopify's consent page.
  if (!(await hasFeature(business.id, "storeImport"))) return NextResponse.redirect(new URL(upgradeHref("storeImport"), siteUrl()), 303);
  try {
    await rateLimit(`store-connect:${user.id}`, RATE_LIMITS.storeConnect);
    const state = randomToken(24);
    const response = NextResponse.redirect(buildAuthorizeUrl(shop, state), 303);
    response.cookies.set(SHOPIFY_COOKIE, await sealShopifyState({ state, shop, userId: user.id }), {
      httpOnly: true,
      secure: siteUrl().startsWith("https://"),
      sameSite: "lax", // must come back on Shopify's redirect
      path: "/api/stores/shopify",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    if (error instanceof RateLimitError) return back("rate_limited");
    await logError(error, { source: "stores.shopify.connect", userId: user.id });
    return back("error");
  }
}

/**
 * Install started from Shopify (the App URL is opened with ?shop, ?hmac, ?host, ?timestamp). Only a request whose HMAC
 * Shopify signed with our app secret, and that is fresh, starts the flow, so a link made by anyone else does nothing.
 * (Choosing a shop by typing it uses POST below.) The connection itself is only created by the callback, after Shopify's
 * own approval screen and the HMAC, state and shop checks.
 */
export async function GET(request: Request) {
  const config = shopifyConfig();
  if (!config) return new Response("Not found", { status: 404 });
  if (!(await isServiceEnabled("shopify"))) return new Response(UNAVAILABLE_MESSAGE, { status: 503 });
  const params = new URL(request.url).searchParams;
  // Next's client router adds ?_rsc=… when it follows a redirect made during a soft navigation (after sign-in). It is not
  // part of what Shopify signed.
  params.delete("_rsc");
  const age = Math.abs(Date.now() / 1000 - Number(params.get("timestamp")));
  if (!(await verifyOAuthHmac(params, config.apiSecret)) || !(age <= INSTALL_MAX_AGE_S)) return back("invalid_request");
  return start(params.get("shop"));
}

/** The "Connect" form on our own page: a POST from our origin (a link or image on another site cannot trigger it). */
export async function POST(request: Request) {
  if (!isShopifyEnabled()) return new Response("Not found", { status: 404 });
  if (!(await isServiceEnabled("shopify"))) return new Response(UNAVAILABLE_MESSAGE, { status: 503 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(siteUrl()).origin) return back("invalid_request");
  const form = await request.formData().catch(() => null);
  const shop = form?.get("shop");
  return start(typeof shop === "string" ? shop : null);
}

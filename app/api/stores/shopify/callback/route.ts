import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/auth/site-url";
import { ForbiddenError } from "@/lib/team/roles";
import { requireActiveUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { sameString } from "@/lib/canva/pkce";
import { saveConnection } from "@/lib/stores/connection";
import { exchangeCode, normalizeShopDomain, shopifyConfig, subscribeUninstall, verifyOAuthHmac } from "@/lib/stores/shopify";
import { openShopifyState, SHOPIFY_COOKIE } from "@/lib/stores/state";

function back(result: string) {
  const response = NextResponse.redirect(new URL(`/dashboard/stores/shopify?${result === "connected" ? "connected=1" : `error=${result}`}`, siteUrl()));
  response.cookies.delete({ name: SHOPIFY_COOKIE, path: "/api/stores/shopify" });
  return response;
}

/**
 * Shopify sends the merchant back here with ?code, ?hmac, ?shop, ?state and ?timestamp. In order: the HMAC of every
 * parameter, the shop domain, the state against the sealed cookie of this user, then the code is exchanged for a token.
 */
export async function GET(request: Request) {
  const config = shopifyConfig();
  if (!config) return new Response("Not found", { status: 404 });
  const params = new URL(request.url).searchParams;
  if (!(await verifyOAuthHmac(params, config.apiSecret))) return back("invalid_request");
  const shop = normalizeShopDomain(params.get("shop"));
  if (!shop) return back("invalid_shop");

  let user: Awaited<ReturnType<typeof requireActiveUser>>;
  try {
    user = await requireActiveUser("connectors", "throw");
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response(error.message, { status: 403 });
    throw error;
  }
  const cookie = request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${SHOPIFY_COOKIE}=`))?.slice(SHOPIFY_COOKIE.length + 1);
  const pending = await openShopifyState(cookie ? decodeURIComponent(cookie) : undefined, user.id);
  if (!pending || pending.shop !== shop || !sameString(pending.state, params.get("state") ?? "")) return back("invalid_request");
  const code = params.get("code");
  if (!code) return back(params.get("error") === "access_denied" ? "denied" : "error");

  try {
    const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!business) return back("no_business");
    const { accessToken, scope } = await exchangeCode(shop, code);
    await saveConnection({ businessId: business.id, provider: "shopify", storeUrl: shop, secret: accessToken, scopes: scope });
    await subscribeUninstall({ provider: "shopify", storeUrl: shop, secret: accessToken });
    return back("connected");
  } catch (error) {
    await logError(error, { source: "stores.shopify.callback", userId: user.id });
    return back("error");
  }
}

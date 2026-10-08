import { NextResponse } from "next/server";
import { logError } from "@/lib/errors";
import { shopifyConfig, verifyWebhookHmac } from "@/lib/stores/shopify";
import { handleShopifyWebhook } from "@/lib/stores/shopify-webhooks";

/**
 * Shopify's mandatory compliance webhooks (customers/data_request, customers/redact, shop/redact) and app/uninstalled.
 * Every request is verified with the app secret (X-Shopify-Hmac-Sha256 over the raw body) before anything is read.
 */
export async function POST(request: Request) {
  const config = shopifyConfig();
  if (!config) return new Response("Not found", { status: 404 });
  const body = await request.text();
  if (!(await verifyWebhookHmac(body, request.headers.get("x-shopify-hmac-sha256"), config.apiSecret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const topic = request.headers.get("x-shopify-topic") ?? "";
    await handleShopifyWebhook(topic, request.headers.get("x-shopify-shop-domain"));
    return NextResponse.json({ ok: true });
  } catch (error) {
    await logError(error, { source: "stores.shopify.webhook" });
    return new Response("Error", { status: 500 }); // Shopify retries
  }
}

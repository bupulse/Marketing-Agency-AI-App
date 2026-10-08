import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { savePending } from "@/lib/stores/connection";
import { CONSUMER_KEY_RE, CONSUMER_SECRET_RE, openWooState, packKeys, verifyWooKeys } from "@/lib/stores/woocommerce";

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) return (await request.json()) as Record<string, unknown>;
    return Object.fromEntries(await (await request.formData()).entries());
  } catch {
    return {};
  }
}

/**
 * WooCommerce POSTs the new consumer key and secret here, from the store's server (no browser session). `user_id` is
 * the sealed state we sent out: it proves which BuPulse user started the flow and for which store. The store address
 * comes from that state, never from the request, and the keys are tried against the store and then saved as PENDING: they become the connection only when the signed-in owner confirms.
 */
export async function POST(request: Request) {
  const body = await readBody(request);
  const state = await openWooState(typeof body.user_id === "string" ? body.user_id : null);
  if (!state) return NextResponse.json({ error: "Invalid or expired state" }, { status: 401 });
  const key = typeof body.consumer_key === "string" ? body.consumer_key : "";
  const secret = typeof body.consumer_secret === "string" ? body.consumer_secret : "";
  if (!CONSUMER_KEY_RE.test(key) || !CONSUMER_SECRET_RE.test(secret)) return NextResponse.json({ error: "Invalid keys" }, { status: 400 });

  try {
    const business = await prisma.business.findFirst({ where: { id: state.businessId, userId: state.userId }, select: { id: true } });
    if (!business) return NextResponse.json({ error: "Unknown business" }, { status: 401 });
    const packed = packKeys(key, secret);
    const { currency } = await verifyWooKeys(state.storeUrl, packed);
    // Pending only: the owner confirms on return, so a forged callback cannot replace a working connection.
    await savePending({ businessId: business.id, provider: "woocommerce", storeUrl: state.storeUrl, secret: packed, currency });
    return NextResponse.json({ ok: true });
  } catch (error) {
    await logError(error, { source: "stores.woocommerce.callback", userId: state.userId });
    return NextResponse.json({ error: "The keys could not be verified" }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { logError } from "@/lib/errors";
import { readWebhook, safeEqual, verifySignature } from "@/lib/social/inbox/meta-webhook";
import { deliverWebhookItems } from "@/lib/social/inbox/meta-inbound";
import { getInboxSettings } from "@/lib/social/inbox/settings";
import { metaSecrets } from "../data-deletion/signed-request";

// Meta's webhooks for Instagram and Facebook comments and DMs: the direct route (docs/SOCIAL_INBOX.md). Built but off:
// until an admin switches "Instagram and Facebook replies" to Meta direct (Admin -> Services), deliveries are answered
// 200 and dropped, and BuPulse-Socials' checks bring the comments and DMs in instead.
//
// Callback URL for the Meta app: https://bupulse.com/api/meta/webhook, verify token = META_WEBHOOK_VERIFY_TOKEN.

/** Meta's subscription check: echo hub.challenge when the verify token matches. */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  const token = query.get("hub.verify_token") ?? "";
  if (!expected || query.get("hub.mode") !== "subscribe" || !safeEqual(token, expected)) return new Response("Forbidden", { status: 403 });
  return new Response(query.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
}

/** A delivery: checked against the app secret (X-Hub-Signature-256), read, and handed to the inbox. */
export async function POST(request: Request) {
  const { transport } = await getInboxSettings();
  if (transport !== "meta") return NextResponse.json({ ok: true, dropped: true });

  const raw = await request.text();
  const secrets = metaSecrets();
  if (!secrets.length) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  if (!(await verifySignature(raw, request.headers.get("x-hub-signature-256"), secrets))) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const result = await deliverWebhookItems(readWebhook(payload));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    // Meta retries a failed delivery; the inbox stores each message once, so a retry is harmless.
    await logError(error, { source: "meta.webhook" });
    return NextResponse.json({ error: "Could not store the event" }, { status: 500 });
  }
}

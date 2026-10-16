import { NextResponse, type NextRequest } from "next/server";
import { webhookAdapterFor } from "@/lib/billing/methods";
import { logError } from "@/lib/errors";

// Webhooks of automatic payment providers (Paypack, Flutterwave, MTN) land here, one slug per provider. Paddle has its
// own route beside this one (webhooks/paddle). A slug with no adapter answers 404, so nothing can be posted at a
// provider that is not wired up yet. The body is read as raw text: signatures cover the exact bytes.
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const adapter = webhookAdapterFor(provider);
  if (!adapter?.parseWebhook) return NextResponse.json({ error: "Unknown payment provider" }, { status: 404 });

  const rawBody = await request.text();
  let webhook;
  try {
    webhook = await adapter.parseWebhook(rawBody, request.headers);
  } catch (error) {
    await logError(error, { source: `billing.webhook.${provider}` });
    return NextResponse.json({ error: "Webhook is not configured" }, { status: 500 });
  }
  if (!webhook) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  // Plug-in point: an automatic provider confirms or rejects the payment named by `webhook.reference` through its
  // adapter (confirm/reject with a system context), storing the event in BillingEvent first so retries run once.
  return NextResponse.json({ ok: true, ignored: true });
}

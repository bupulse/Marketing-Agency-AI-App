import { recordCron } from "@/lib/admin/cron-run";
import { NextResponse, type NextRequest } from "next/server";
import { runLeadsDigest } from "@/lib/leads/digest";
import { retryDueWebhooks } from "@/lib/webhooks/retry";

// Compares without stopping at the first different character.
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Called hourly by the Cloudflare Cron Trigger (worker.ts) and by .github/workflows/leads-digest.yml as a
// fallback. Each run also retries pending outgoing webhook deliveries (up to 24 h old) and deletes delivery logs older than 30 days. The digest part only handles the businesses for which it is 08:00 local time. Safe to run twice at once.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    await recordCron("leads-digest", async () => {
      const digest = await runLeadsDigest();
      const webhooks = await retryDueWebhooks().catch((error) => {
        console.error("[webhooks.cron] retry failed:", error instanceof Error ? error.message : error);
        return null;
      });
      return { ...digest, webhooks };
    }),
  );
}

import { recordCron } from "@/lib/admin/cron-run";
import { NextResponse, type NextRequest } from "next/server";
import { collectMetrics } from "@/lib/publishing/metrics";
import { fillOutcomeStats } from "@/lib/video-studio/outcomes";

// Compares without stopping at the first different character.
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Called daily by the Cloudflare Cron Trigger (worker.ts).
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Then the numbers of posted Video Studio videos after 24 hours and 7 days, from the metrics just read (the Brain's outcomes).
  return NextResponse.json(await recordCron("metrics", async () => ({ ...(await collectMetrics()), videoOutcomes: await fillOutcomeStats() })));
}

import { recordCron } from "@/lib/admin/cron-run";
import { NextResponse, type NextRequest } from "next/server";
import { processMomoRenewals } from "@/lib/billing/momo-renewals";

export const maxDuration = 300;

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Daily: renewal reminders for Mobile Money subscriptions (5 days and 1 day before the end), PAST_DUE after the grace
// period, and closing payments nobody submitted. A batch per call; `nextCursor` is set while more remain (call again with ?cursor=).
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cursor = request.nextUrl.searchParams.get("cursor");
  return NextResponse.json(await recordCron("momo-renewals", () => processMomoRenewals({ cursor })));
}

import { recordCron } from "@/lib/admin/cron-run";
import { NextResponse, type NextRequest } from "next/server";
import { runCreatorViews } from "@/lib/creators/tracking/job";

// Reading many accounts and closing periods takes a while where the host allows it.
export const maxDuration = 300;

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Every 6 hours (CREATOR_VIEWS_CRON in worker-crons.ts): creators' post views, link checks, period closes and payouts
// (docs/CREATOR_CAMPAIGNS.md, "Reading views"). The answer has `nextCursor` while work is left; the caller calls again.
// Safe to run twice at once: readings are per post and a period is claimed before its payouts are written.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await recordCron("creator-views", () => runCreatorViews()));
}

import { recordCron } from "@/lib/admin/cron-run";
import { NextResponse, type NextRequest } from "next/server";
import { sendContentSummaries } from "@/lib/content-board/summary";

export const maxDuration = 60;

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Hourly (CONTENT_SUMMARY_CRON in worker.ts): the daily email of posts auto-approval scheduled, sent from 08:00 in each
// business's time zone (docs/CONTENT.md). Pages through every business that may be due; when a call runs out of time it
// answers `nextCursor` and the caller calls again with ?cursor=. Idempotent: at most one email a business a day.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cursor = request.nextUrl.searchParams.get("cursor");
  return NextResponse.json(await recordCron("content-summary", () => sendContentSummaries(new Date(), { cursor: cursor && cursor.length <= 120 ? cursor : null })));
}

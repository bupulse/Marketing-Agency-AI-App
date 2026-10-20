import { recordCron } from "@/lib/admin/cron-run";
import { NextResponse, type NextRequest } from "next/server";
import { runDueDailyPosts } from "@/lib/daily-posts/service";

// Each company's run writes with AI and plans its pictures, so give it room.
export const maxDuration = 300;

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Hourly (DAILY_POSTS_CRON in worker-crons.ts): the day's posts for every company with daily posts, from local midnight
// until midday (docs/CONTENT.md "Daily posts"), a couple of companies per call; the answer has `nextCursor` while some
// remain and the caller calls again with ?cursor=. Idempotent: one run per company and local day (DailyPostRun).
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cursor = request.nextUrl.searchParams.get("cursor");
  return NextResponse.json(await recordCron("daily-posts", () => runDueDailyPosts({ cursor: cursor && cursor.length <= 64 ? cursor : null })));
}

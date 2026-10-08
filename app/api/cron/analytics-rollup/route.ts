import { NextResponse, type NextRequest } from "next/server";
import { runDailyRollup } from "@/lib/analytics/rollup";

export const maxDuration = 300;

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Daily analytics roll-up (yesterday + today, plus a few back-fill days per call). The answer has `nextCursor`
// while back-fill days remain: call again until it is null (the cursor itself is ignored; each call finds what is missing).
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runDailyRollup());
}

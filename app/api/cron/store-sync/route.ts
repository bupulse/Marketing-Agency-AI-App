import { NextResponse, type NextRequest } from "next/server";
import { runDailyStoreSync } from "@/lib/stores/sync";

export const maxDuration = 300;

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Daily re-sync of imported store products. A few stores per call; the answer has `nextCursor` while stores remain:
// call again with ?cursor=<nextCursor> until it is null (the same pattern as /api/cron/autopilot). Safe to repeat.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cursor = request.nextUrl.searchParams.get("cursor");
  return NextResponse.json(await runDailyStoreSync({ cursor: cursor && cursor.length <= 64 ? cursor : null }));
}

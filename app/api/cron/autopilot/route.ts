import { NextResponse, type NextRequest } from "next/server";
import { runDueBusinesses } from "@/lib/autopilot/run";

// The run writes with AI and draws images, so give it room.
export const maxDuration = 300;

// Compares without stopping at the first different character.
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Called by .github/workflows/autopilot.yml on Fridays and Saturdays. Plans next week for every enabled
// business that has not been planned yet, a couple per call. The answer has `nextCursor` while businesses remain:
// call again with ?cursor=<nextCursor> until it is null. Safe to repeat (one run per business and week).
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cursor = request.nextUrl.searchParams.get("cursor");
  return NextResponse.json(await runDueBusinesses({ cursor: cursor && cursor.length <= 64 ? cursor : null }));
}

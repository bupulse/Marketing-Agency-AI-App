import { recordCron } from "@/lib/admin/cron-run";
import { NextResponse, type NextRequest } from "next/server";
import { finishLatePictures } from "@/lib/autopilot/late-pictures";

// One AI step per picture within 25 s (lib/autopilot/late-pictures.ts), well inside Netlify's 60 s.
export const maxDuration = 60;

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Every 30 minutes from Friday to Sunday (AUTOPILOT_VISUALS_CRON in worker-crons.ts): the AI pictures Autopilot left
// for later on Netlify are made one step at a time and replace the owner's photo on their posts (docs/CONTENT_VISUALS.md
// "Autopilot on Netlify"). Answers at once when none are waiting; `nextCursor` while some are left, and the caller calls
// again with ?cursor= (the cursor itself means nothing: the oldest waiting pictures go first).
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await recordCron("autopilot-visuals", () => finishLatePictures()));
}

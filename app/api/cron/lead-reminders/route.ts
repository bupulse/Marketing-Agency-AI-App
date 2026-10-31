import { recordCron } from "@/lib/admin/cron-run";
import { NextResponse, type NextRequest } from "next/server";
import { runDueJobs } from "@/lib/jobs/due";
import { REMINDER_KIND } from "@/lib/lead-alerts/reminders";

// Runs only the lead reminders (lib/lead-alerts/reminders.ts), so they can come every 2 minutes without running the
// publisher and every other due job that often. The every-5-minutes publish cron runs them too, as part of all due jobs.

// Compares without stopping at the first different character.
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await recordCron("lead-reminders", () => runDueJobs(undefined, [REMINDER_KIND])));
}

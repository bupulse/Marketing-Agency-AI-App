import { recordCron } from "@/lib/admin/cron-run";
import { NextResponse, type NextRequest } from "next/server";
import { publishDue } from "@/lib/publishing/engine";
import { runDueJobs } from "@/lib/jobs/due";
import "@/lib/jobs/handlers";

// Compares without stopping at the first different character.
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Called every minute by the Cloudflare Cron Trigger (worker.ts) and every 5 minutes by
// .github/workflows/publish-posts.yml as a fallback. Safe to run twice at once: posts are claimed atomically.
// After the publisher it runs the due jobs (lib/jobs/due.ts: automation waits and follow-ups, social checks), recorded
// as their own "due-jobs" run; a failure there never affects the publisher's answer.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const published = await recordCron("publish", () => publishDue());
  const jobs = await recordCron("due-jobs", () => runDueJobs()).catch((error) => {
    console.error("[jobs.cron]", error instanceof Error ? error.message : error);
    return null;
  });
  return NextResponse.json(jobs ? { ...published, jobs } : published);
}

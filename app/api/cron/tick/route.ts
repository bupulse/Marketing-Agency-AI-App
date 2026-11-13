import { NextResponse, type NextRequest } from "next/server";
import { tickMinute } from "@/lib/cron/schedule";
import { runCatchUp } from "@/lib/cron/catch-up-run";
import { runTick, TICK_BUDGET_MS } from "@/lib/cron/tick";
import { currentPlatform } from "@/lib/platform/detect";

// Compares without stopping at the first different character.
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Where the tick calls the job routes. On Cloud Run the container's own port (the same instance, so the calls never
 * leave it: no extra requests, no egress, no Cloudflare in between); elsewhere this request's own origin.
 */
function selfOrigin(request: NextRequest): string {
  if (currentPlatform() === "cloudrun") return `http://127.0.0.1:${process.env.PORT || "8080"}`;
  return new URL(request.url).origin;
}

// Cloud Run's only scheduled call (docs/DEPLOY_CLOUDRUN.md, "Scheduled jobs"): Cloud Scheduler POSTs here every minute
// with the CRON_SECRET bearer, and the jobs due in that UTC minute (worker-crons.ts, the same schedules as Cloudflare)
// run one after the other before the answer, a JSON summary. Always 200 once authorised, even when a job failed, so
// Cloud Scheduler never retries a tick and runs the jobs that did succeed twice; failures are in the summary and logs.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const minute = tickMinute(request.headers.get("x-cloudscheduler-scheduletime"));
  const startedAt = Date.now();
  const origin = selfOrigin(request);
  const summary = await runTick(minute, { origin, secret });
  // Then the jobs whose time was missed (a power cut, a restart, a long tick), each once (lib/cron/catch-up.ts), inside
  // the same time budget. The publisher is never part of it: it runs every minute above.
  const caughtUp = await runCatchUp(new Date(), { origin, secret, stopAt: startedAt + TICK_BUDGET_MS });
  return NextResponse.json(caughtUp.length ? { ...summary, caughtUp } : summary, { headers: { "Cache-Control": "no-store" } });
}

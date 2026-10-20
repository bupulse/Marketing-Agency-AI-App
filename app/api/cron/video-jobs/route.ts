import { recordCron } from "@/lib/admin/cron-run";
import { NextResponse, type NextRequest } from "next/server";
import { logError } from "@/lib/errors";
import { sendReadyNotices } from "@/lib/video-studio/notices";
import { sweepVideoJobs } from "@/lib/video-studio/sweep";

export const maxDuration = 120;

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Every 4 minutes (VIDEO_JOBS_CRON in worker-crons.ts): Video Studio designs whose request died are failed and their
// video credits given back, once (lib/video-studio/sweep.ts), and "Your video is ready" emails go out for studio videos
// that finished (lib/video-studio/notices.ts). Seedance polling joins it later. Idempotent: safe to run twice at once or
// to call by hand.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    await recordCron("video-jobs", async () => {
      const sweep = await sweepVideoJobs();
      // A mail problem must not hide the sweep's result: it is logged, and the unsent videos wait for the next run.
      const notices = await sendReadyNotices().catch(async (error) => {
        await logError(error, { source: "cron.video-jobs.notices" });
        return null;
      });
      return { ...sweep, notices };
    }),
  );
}

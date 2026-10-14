import { recordCron } from "@/lib/admin/cron-run";
import { NextResponse, type NextRequest } from "next/server";
import { purgeAbandonedUploads, purgePublishedVideos } from "@/lib/visuals/cleanup";
import { cleanupMusicOrphans } from "@/lib/music/service";
import { sweepStorage } from "@/lib/media/storage-sweep";
import { cleanupReleases } from "@/lib/updates/releases";

export const maxDuration = 120;

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Daily (MEDIA_CLEANUP_CRON in worker.ts): deletes content video files 30 days after their posts went out, and uploads
// that were never confirmed (expired reservations, unreferenced files over an hour old), every company's unrecorded
// gallery, Gallery video and stray files (lib/media/storage-sweep.ts), so the
// shared storage (Supabase free plan, 1 GB) does not fill up (docs/CONTENT_VISUALS.md). Also release zips and database
// backups older than 30 days, except the current and previous installed versions (docs/UPDATES.md). Idempotent: safe to run twice.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await recordCron("media-cleanup", async () => ({ ...(await purgePublishedVideos()), uploads: await purgeAbandonedUploads(), musicOrphans: await cleanupMusicOrphans(), storage: await sweepStorage(), releases: await cleanupReleases() })));
}

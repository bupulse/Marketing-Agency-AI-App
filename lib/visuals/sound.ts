// A video's music choice and the photo URLs the browser renderer needs (docs/VOICE_AND_MUSIC.md).
import "server-only";
import { isOwnDesignPath, isOwnPhotoPath } from "@/lib/designs/assets";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { bucketForPath } from "@/lib/publishing/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwnedLicence } from "@/lib/music/tracks";
import type { VideoPlan } from "./types";
import { readVideoPlan } from "./video-plan";
import { VisualError } from "./service";

/** Signed URLs (an hour) of a plan's scene photos that are the owner's own. */
export async function renderPhotoUrls(userId: string, plan: VideoPlan): Promise<Record<string, string>> {
  const paths = [...new Set(plan.scenes.flatMap((s) => (s.photoPath ? [s.photoPath] : [])))].filter((p) => isOwnPhotoPath(userId, p) || isOwnDesignPath(userId, p));
  const out: Record<string, string> = {};
  const storage = createAdminClient().storage;
  for (const bucket of ["media", "designs"] as const) {
    const list = paths.filter((p) => bucketForPath(p) === bucket);
    if (!list.length) continue;
    const { data } = await storage.from(bucket).createSignedUrls(list, 60 * 60);
    for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  }
  return out;
}

/** The owner picks another library track (or none) for a video; the video is made again with it. */
export async function setVideoMusic(businessId: string, visualId: string, trackId: string | null) {
  const row = await prisma.contentVisual.findFirst({ where: { id: visualId, businessId, kind: "video" } });
  const plan = row && readVideoPlan(row.plan);
  if (!row || !plan) throw new VisualError("We could not find that video.");
  let music: VideoPlan["music"] = null;
  if (trackId) {
    const track = await prisma.musicTrack.findFirst({ where: { id: trackId, active: true } });
    if (!track) throw new VisualError("That track is no longer in the library.");
    music = { trackId: track.id, title: track.title, path: track.path, attribution: track.attribution, owned: isOwnedLicence(track.licence) };
  }
  // A new mix is a remake: the video it has stays until the new one is saved, and it uses none of the plan's videos.
  await prisma.contentVisual.update({ where: { id: row.id }, data: { plan: { ...plan, music } as unknown as Prisma.InputJsonValue, status: "pending", error: null, robotAttempts: 0 } });
}

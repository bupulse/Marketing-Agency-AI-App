// Content visuals as the content screens show them: plans, rendered items and video photos with signed URLs.
import "server-only";
import { clipsInProgress } from "./ai-clips";
import { prisma } from "@/lib/db";
import { bucketForPath } from "@/lib/publishing/schemas";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readImagePlan } from "./direction";
import { robotStateOf } from "./robot";
import { readItems } from "./service";
import type { VisualKind, VisualStatus, VisualView } from "./types";
import { readVideoPlan } from "./video-plan";

const URL_SECONDS = 60 * 60;

/** Signed URLs for paths in either bucket (designs, media), one request per bucket. Paths that fail are left out. */
async function signAll(paths: string[]): Promise<Map<string, string>> {
  const byBucket = new Map<ReturnType<typeof bucketForPath>, string[]>();
  for (const p of new Set(paths)) byBucket.set(bucketForPath(p), [...(byBucket.get(bucketForPath(p)) ?? []), p]);
  const out = new Map<string, string>();
  if (byBucket.size === 0) return out;
  const storage = (await createClient()).storage;
  await Promise.all(
    [...byBucket].map(async ([bucket, list]) => {
      // Gallery videos' bucket has no Storage policies: the server signs them (the caller's rows are its own).
      const { data } = await (bucket === "gallery-videos" ? createAdminClient().storage : storage).from(bucket).createSignedUrls(list, URL_SECONDS);
      for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
    }),
  );
  return out;
}

export type OwnedVisual = VisualView & { contentId: string | null; groupId: string | null };

/** The company's visuals for some content versions or Autopilot groups, newest first. */
export async function loadVisuals(businessId: string, by: { contentIds?: string[]; groupIds?: string[] }): Promise<OwnedVisual[]> {
  const contentIds = by.contentIds ?? [];
  const groupIds = by.groupIds ?? [];
  if (contentIds.length === 0 && groupIds.length === 0) return [];
  const rows = await prisma.contentVisual.findMany({
    where: { businessId, OR: [...(contentIds.length ? [{ contentId: { in: contentIds } }] : []), ...(groupIds.length ? [{ groupId: { in: groupIds } }] : [])] },
    orderBy: { createdAt: "desc" },
    take: 400,
  });
  const parsed = rows.map((r) => ({ row: r, items: readItems(r.items), image: r.kind === "video" ? null : readImagePlan(r.plan), video: r.kind === "video" ? readVideoPlan(r.plan) : null }));
  const paths = parsed.flatMap((p) => [...p.items.map((i) => i.path), ...(p.video?.scenes.flatMap((s) => [...(s.photoPath ? [s.photoPath] : []), ...(s.clipPath ? [s.clipPath] : [])]) ?? [])]);
  const urls = await signAll(paths);
  return parsed.map(({ row, items, image, video }) => ({
    id: row.id,
    contentId: row.contentId,
    groupId: row.groupId,
    kind: row.kind as VisualKind,
    status: row.status as VisualStatus,
    error: row.error,
    items: items.flatMap((i) => (urls.has(i.path) ? [{ path: i.path, url: urls.get(i.path)!, designId: i.designId ?? null }] : [])),
    imagePlan: image,
    videoPlan: video,
    photoUrls: Object.fromEntries((video?.scenes ?? []).flatMap((s) => (s.photoPath && urls.has(s.photoPath) ? [[s.photoPath, urls.get(s.photoPath)!]] : []))),
    clipUrls: Object.fromEntries((video?.scenes ?? []).flatMap((s) => (s.clipPath && urls.has(s.clipPath) ? [[s.clipPath, urls.get(s.clipPath)!]] : []))),
    clips: row.kind === "video" && clipsInProgress(row) ? ("making" as const) : null,
    renderedAt: row.renderedAt?.toISOString() ?? null,
    robot: robotStateOf(row),
  }));
}

/** The image (or carousel) and the video of one content version or group, from a list loadVisuals returned. */
export function pickVisuals(list: OwnedVisual[], key: { contentId?: string; groupId?: string }) {
  const mine = list.filter((v) => (key.contentId ? v.contentId === key.contentId : v.groupId === key.groupId));
  return { image: mine.find((v) => v.kind !== "video") ?? null, video: mine.find((v) => v.kind === "video") ?? null };
}

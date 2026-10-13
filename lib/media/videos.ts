// The owner's own Gallery videos for the content pipeline (docs/MEDIA.md): "Gallery first", a post uses the subject's
// album video as it is before BuPulse makes one. The shape extends lib/content-flow/media.ts's GalleryItem
// ({ path, name, mimeType }), so the content flow can take these items directly.
import "server-only";
import { prisma } from "@/lib/db";
import { signedUrls } from "./service";
import { aspectOf } from "./rules";
import type { AlbumKind } from "./destinations";

export type GalleryVideo = {
  id: string;
  path: string;
  name: string;
  mimeType: string;
  durationMs: number;
  width: number | null;
  height: number | null;
  aspect: "portrait" | "square" | "landscape" | null;
  /** The owner's "What's in this video?" (null when not written): captions should relate to it. */
  description: string | null;
  posterPath: string | null;
  /** Signed (an hour) when asked for with `signed: true`; null otherwise. */
  posterUrl: string | null;
};

const VIDEO_SELECT = { id: true, path: true, name: true, mimeType: true, durationMs: true, width: true, height: true, description: true, posterPath: true } as const;

/**
 * A product's or campaign's album videos in album order (cover first), with poster, length, aspect and the owner's
 * description. A campaign without videos of its own uses its first product's, as its photos do.
 */
export async function subjectVideos(businessId: string, subject: { kind: AlbumKind; id: string }, options: { signed?: boolean; take?: number } = {}): Promise<GalleryVideo[]> {
  const take = Math.min(Math.max(options.take ?? 10, 1), 30);
  const asset = { businessId, kind: "video" };
  const order = [{ position: "asc" as const }, { createdAt: "asc" as const }];
  let rows =
    subject.kind === "product"
      ? (await prisma.productPhoto.findMany({ where: { productId: subject.id, asset }, orderBy: order, take, select: { asset: { select: VIDEO_SELECT } } })).map((r) => r.asset)
      : (await prisma.campaignPhoto.findMany({ where: { campaignId: subject.id, asset }, orderBy: order, take, select: { asset: { select: VIDEO_SELECT } } })).map((r) => r.asset);
  if (rows.length === 0 && subject.kind === "campaign") {
    const first = await prisma.campaignProduct.findFirst({ where: { campaignId: subject.id, product: { businessId } }, select: { productId: true } });
    if (first) return subjectVideos(businessId, { kind: "product", id: first.productId }, options);
  }
  rows = rows.filter((r) => (r.durationMs ?? 0) > 0);
  const urls = options.signed ? await signedUrls(rows.flatMap((r) => (r.posterPath ? [r.posterPath] : []))) : new Map<string, string>();
  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    name: r.name,
    mimeType: r.mimeType,
    durationMs: r.durationMs ?? 0,
    width: r.width,
    height: r.height,
    aspect: aspectOf(r.width, r.height),
    description: r.description,
    posterPath: r.posterPath,
    posterUrl: r.posterPath ? (urls.get(r.posterPath) ?? null) : null,
  }));
}

/** The line that tells the writer what the owner's video shows: their description, else its name. */
export function videoLine(video: Pick<GalleryVideo, "name" | "description" | "durationMs">): string {
  const what = video.description?.trim() || video.name;
  return `The post is the owner's own ${Math.round(video.durationMs / 1000)}-second video: "${what.replace(/"/g, "'")}". Write about what it shows.`;
}

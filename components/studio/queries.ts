import "server-only";
import { prisma } from "@/lib/db";
import { createSignedDownloadUrl } from "@/lib/storage";
import { loadVisuals, pickVisuals } from "@/lib/visuals/queries";
import { videoAvailable } from "@/lib/visuals/service";
import { parseVariants, type StudioContent } from "./helpers";

type ContentRow = {
  id: string;
  caption: string;
  hashtags: string[];
  videoScript: string;
  adHeadlines: string[];
  language: string;
  variants: unknown;
  edited: boolean;
  createdAt: Date;
};

export function toStudioContent(row: ContentRow): StudioContent {
  return {
    id: row.id,
    caption: row.caption,
    hashtags: row.hashtags,
    videoScript: row.videoScript,
    adHeadlines: row.adHeadlines,
    language: row.language,
    variants: parseVariants(row.variants),
    edited: row.edited,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A signed link for a stored file, or null when it is missing. */
export async function signedUrl(bucket: "media" | "designs", path: string): Promise<string | null> {
  try {
    return await createSignedDownloadUrl(bucket, path);
  } catch {
    return null;
  }
}

export async function signPhotos(paths: string[]): Promise<{ path: string; url: string }[]> {
  const urls = await Promise.all(paths.map((p) => signedUrl("media", p)));
  return paths.flatMap((path, i) => (urls[i] ? [{ path, url: urls[i] as string }] : []));
}

/** Content versions and designs of a product or campaign, for its page. */
export async function loadSubjectStudio(businessId: string, subject: { kind: "product" | "campaign"; id: string }) {
  const where = subject.kind === "product" ? { businessId, productId: subject.id } : { businessId, campaignId: subject.id };
  const [contents, designs, videoInPlan] = await Promise.all([
    prisma.generatedContent.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.design.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 }),
    videoAvailable(businessId),
  ]);
  const [designUrls, visuals] = await Promise.all([Promise.all(designs.map((d) => signedUrl("designs", d.path))), loadVisuals(businessId, { contentIds: contents.map((c) => c.id) })]);
  return {
    videoInPlan,
    contents: contents.map((c) => ({ ...toStudioContent(c), ...pickVisuals(visuals, { contentId: c.id }) })),
    designs: designs.flatMap((d, i) => (designUrls[i] ? [{ id: d.id, url: designUrls[i] as string, kind: d.kind, aspectRatio: d.aspectRatio, template: d.template }] : [])),
  };
}

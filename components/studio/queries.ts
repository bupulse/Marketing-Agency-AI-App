import "server-only";
import { prisma } from "@/lib/db";
import { createSignedDownloadUrl } from "@/lib/storage";
import { CAMPAIGN_TYPE_LABEL } from "@/lib/knowledge/campaigns";
import { KIND_LABEL } from "@/lib/knowledge/products";
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

/** The latest text for each product and campaign, newest first. */
export async function loadContentLibrary(businessId: string) {
  const rows = await prisma.generatedContent.findMany({
    where: { businessId, OR: [{ productId: { not: null } }, { campaignId: { not: null } }] },
    orderBy: { createdAt: "desc" },
    distinct: ["productId", "campaignId"],
    take: 300,
    include: { product: { select: { id: true, name: true, kind: true } }, campaign: { select: { id: true, name: true, type: true } } },
  });
  return rows.flatMap((c) => {
    const subject = c.product ? { kind: "product" as const, id: c.product.id } : c.campaign ? { kind: "campaign" as const, id: c.campaign.id } : null;
    if (!subject) return [];
    return [
      {
        id: c.id,
        subject,
        title: c.product?.name ?? c.campaign?.name ?? "",
        label: c.product ? KIND_LABEL[c.product.kind] : CAMPAIGN_TYPE_LABEL[c.campaign!.type],
        caption: c.caption,
        hashtags: c.hashtags,
        videoScript: c.videoScript,
        variants: parseVariants(c.variants),
        language: c.language,
        edited: c.edited,
        createdAt: c.createdAt.toISOString(),
      },
    ];
  });
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

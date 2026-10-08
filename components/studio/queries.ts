import "server-only";
import { prisma } from "@/lib/db";
import { createSignedDownloadUrl } from "@/lib/storage";
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

export async function loadProjectCards(businessId: string) {
  const projects = await prisma.project.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    take: 60,
    include: {
      _count: { select: { contents: true, designs: true } },
      storeSync: { select: { connection: { select: { provider: true } } } },
      contents: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });
  const thumbs = await Promise.all(projects.map((p) => (p.photoPaths[0] ? signedUrl("media", p.photoPaths[0]) : null)));
  return projects.map((p, i) => ({
    id: p.id,
    type: p.type,
    title: p.title,
    price: p.price,
    thumb: thumbs[i],
    contentCount: p._count.contents,
    designCount: p._count.designs,
    lastGenerated: p.contents[0]?.createdAt.toISOString() ?? null,
    syncedFrom: p.storeSync?.connection.provider ?? null,
  }));
}

export async function loadProjectDetail(businessId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, businessId },
    include: {
      contents: { orderBy: { createdAt: "desc" }, take: 50 },
      designs: { orderBy: { createdAt: "desc" }, take: 50 },
      storeSync: { select: { connection: { select: { provider: true } } } },
    },
  });
  if (!project) return null;
  const [photos, designUrls] = await Promise.all([
    signPhotos(project.photoPaths),
    Promise.all(project.designs.map((d) => signedUrl("designs", d.path))),
  ]);
  const designs = project.designs.flatMap((d, i) =>
    designUrls[i] ? [{ id: d.id, url: designUrls[i] as string, kind: d.kind, aspectRatio: d.aspectRatio, template: d.template }] : [],
  );
  return { project, contents: project.contents.map(toStudioContent), photos, designs };
}

export async function loadContentLibrary(businessId: string) {
  const projects = await prisma.project.findMany({
    where: { businessId, contents: { some: {} } },
    include: { contents: { orderBy: { createdAt: "desc" }, take: 1 } },
    take: 200,
  });
  return projects
    .flatMap((p) => {
      const c = p.contents[0];
      return c
        ? [{
            id: c.id,
            projectId: p.id,
            projectTitle: p.title,
            projectType: p.type,
            caption: c.caption,
            hashtags: c.hashtags,
            videoScript: c.videoScript,
            variants: parseVariants(c.variants),
            language: c.language,
            edited: c.edited,
            createdAt: c.createdAt.toISOString(),
          }]
        : [];
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

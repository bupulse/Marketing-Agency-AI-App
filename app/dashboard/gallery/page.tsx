import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { GalleryView } from "@/components/media/gallery-view";
import { galleryOverview, listMedia } from "@/lib/media/service";

export const metadata = { title: "Gallery" };

export default async function GalleryPage({ searchParams }: { searchParams: Promise<{ folder?: string }> }) {
  const { business } = await getAppContext();
  const { folder: requested } = await searchParams;
  const overview = await galleryOverview(business.id);
  // Only the business's own folders count; anything else falls back to every photo.
  const folder = requested === "none" || overview.folders.some((f) => f.id === requested) ? (requested as string) : "all";
  const { items, nextCursor } = await listMedia(business.id, { folderId: folder === "all" ? undefined : folder === "none" ? null : folder, take: 48 });

  return (
    <>
      <PageHeader title="Gallery" description="Your own photos, in one place. Use them in posts and designs for free, no image credits needed." />
      <GalleryView key={folder} folder={folder} overview={overview} initialItems={items} initialCursor={nextCursor} />
    </>
  );
}

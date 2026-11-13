import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { Images } from "lucide-react";
import { PageHeader } from "@/components/admin/kit";
import { GalleryView } from "@/components/media/gallery-view";
import { filterKey, parseFilter } from "@/lib/media/destinations";
import { galleryOverview, listMedia } from "@/lib/media/service";

export const metadata = { title: "Photos" };

export default async function GalleryPage({ searchParams }: { searchParams: Promise<{ folder?: string }> }) {
  const blocked = await featureGate("gallery");
  if (blocked) return blocked;
  const { business } = await getAppContext();
  const { folder: requested } = await searchParams;
  const overview = await galleryOverview(business.id);
  // Only the business's own folders and albums count; anything else falls back to every photo.
  const asked = parseFilter(requested);
  const filter =
    asked.kind === "folder" ? (overview.folders.some((f) => f.id === asked.id) ? asked : { kind: "all" as const })
    : asked.kind === "product" || asked.kind === "campaign" ? (overview.albums.some((a) => a.kind === asked.kind && a.id === asked.id) ? asked : { kind: "all" as const })
    : asked;
  const { items, nextCursor } = await listMedia(business.id, {
    folderId: filter.kind === "all" || filter.kind === "product" || filter.kind === "campaign" ? undefined : filter.kind === "none" ? null : filter.id,
    album: filter.kind === "product" || filter.kind === "campaign" ? filter : undefined,
    take: 48,
  });
  const folder = filter.kind === "folder" ? filter.id : filterKey(filter);

  return (
    <>
      <PageHeader icon={Images} tone="blue" title="Photos" description="Your own photos and videos, in folders and product albums. Free to use in posts and designs." />
      <GalleryView key={folder} folder={folder} overview={overview} initialItems={items} initialCursor={nextCursor} />
    </>
  );
}

// Product and campaign albums (docs/KNOWLEDGE_BASE.md): which gallery photos belong to which product or campaign.
// A link is a ProductPhoto / CampaignPhoto row; removing one never deletes the photo itself.
import "server-only";
import { prisma } from "@/lib/db";
import { MEDIA_BULK_MAX } from "./rules";
import { MAX_ALBUMS_PER_PHOTO, type AlbumKind } from "./destinations";
import { linkInTx, MediaError, ownAlbum } from "./service";

export type PhotoAlbums = { products: { id: string; name: string }[]; campaigns: { id: string; name: string }[] };

/** The albums a photo is in. */
export async function photoAlbums(businessId: string, assetId: string): Promise<PhotoAlbums> {
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: assetId, businessId },
    select: {
      products: { select: { product: { select: { id: true, name: true } } } },
      campaigns: { select: { campaign: { select: { id: true, name: true } } } },
    },
  });
  if (!asset) throw new MediaError("We could not find that photo.");
  return { products: asset.products.map((p) => p.product), campaigns: asset.campaigns.map((c) => c.campaign) };
}

/** Only the business's own photos among `ids`. */
async function ownAssetIds(businessId: string, ids: string[]): Promise<string[]> {
  const rows = await prisma.mediaAsset.findMany({ where: { businessId, id: { in: [...new Set(ids)].slice(0, MEDIA_BULK_MAX) } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Adds the business's photos to an album (after the ones already in it). Returns how many were new. */
export async function linkPhotos(businessId: string, kind: AlbumKind, albumId: string, assetIds: string[]): Promise<number> {
  await ownAlbum(businessId, kind, albumId);
  const own = await ownAssetIds(businessId, assetIds);
  if (own.length === 0) throw new MediaError("We could not find those photos.");
  return prisma.$transaction((tx) => linkInTx(tx, kind, albumId, own));
}

/** Takes photos out of an album. The photos stay in the gallery. */
export async function unlinkPhotos(businessId: string, kind: AlbumKind, albumId: string, assetIds: string[]): Promise<number> {
  await ownAlbum(businessId, kind, albumId);
  const ids = assetIds.slice(0, MEDIA_BULK_MAX);
  const { count } =
    kind === "product"
      ? await prisma.productPhoto.deleteMany({ where: { productId: albumId, assetId: { in: ids } } })
      : await prisma.campaignPhoto.deleteMany({ where: { campaignId: albumId, assetId: { in: ids } } });
  return count;
}

/** Puts one photo first (the cover); the others keep their order behind it. */
export async function makeCover(businessId: string, kind: AlbumKind, albumId: string, assetId: string): Promise<void> {
  await ownAlbum(businessId, kind, albumId);
  const links =
    kind === "product"
      ? await prisma.productPhoto.findMany({ where: { productId: albumId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { assetId: true } })
      : await prisma.campaignPhoto.findMany({ where: { campaignId: albumId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { assetId: true } });
  if (!links.some((l) => l.assetId === assetId)) throw new MediaError("That photo is not in this album.");
  const order = [assetId, ...links.map((l) => l.assetId).filter((a) => a !== assetId)];
  await prisma.$transaction(
    order.map((a, position) =>
      kind === "product"
        ? prisma.productPhoto.update({ where: { productId_assetId: { productId: albumId, assetId: a } }, data: { position } })
        : prisma.campaignPhoto.update({ where: { campaignId_assetId: { campaignId: albumId, assetId: a } }, data: { position } }),
    ),
  );
}

/**
 * Sets exactly which product albums a photo is in (the viewer's "Products" picker): links the new ones, removes the
 * others. Only the business's own products count; campaign links are left as they are.
 */
export async function setPhotoProducts(businessId: string, assetId: string, productIds: string[]): Promise<PhotoAlbums> {
  const wanted = [...new Set(productIds)];
  if (wanted.length > MAX_ALBUMS_PER_PHOTO) throw new MediaError(`A photo can be in up to ${MAX_ALBUMS_PER_PHOTO} albums.`);
  const asset = await prisma.mediaAsset.findFirst({ where: { id: assetId, businessId }, select: { id: true, products: { select: { productId: true } } } });
  if (!asset) throw new MediaError("We could not find that photo.");
  const own = wanted.length ? (await prisma.product.findMany({ where: { businessId, id: { in: wanted } }, select: { id: true } })).map((p) => p.id) : [];
  const have = new Set(asset.products.map((p) => p.productId));
  const add = own.filter((id) => !have.has(id));
  const remove = [...have].filter((id) => !own.includes(id));
  await prisma.$transaction(async (tx) => {
    if (remove.length) await tx.productPhoto.deleteMany({ where: { assetId, productId: { in: remove } } });
    for (const productId of add) await linkInTx(tx, "product", productId, [assetId]);
  });
  return photoAlbums(businessId, assetId);
}

/** An album's object paths in album order (designs, Autopilot, the publisher). */
export async function albumPaths(kind: AlbumKind, albumId: string, take = 30): Promise<string[]> {
  const rows =
    kind === "product"
      ? await prisma.productPhoto.findMany({ where: { productId: albumId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take, select: { asset: { select: { path: true } } } })
      : await prisma.campaignPhoto.findMany({ where: { campaignId: albumId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take, select: { asset: { select: { path: true } } } });
  return rows.map((r) => r.asset.path);
}

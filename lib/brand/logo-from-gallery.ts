// A gallery photo as the company's logo (the Business info quiz's "From your photos"): a copy in the private brand
// bucket, in the company's logo folder, so saveLook accepts it like an uploaded logo (isOwnLogoPath). The gallery
// photo itself stays where it is.
import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { buildObjectPath } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { LOGO_MAX_BYTES, LOGO_TYPES } from "./schemas";

export async function logoFromGalleryPhoto(ctx: { userId: string; businessId: string }, assetId: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: assetId, businessId: ctx.businessId }, select: { path: true, name: true, mimeType: true, bytes: true, kind: true } });
  if (!asset) return { ok: false, error: "We could not find that photo." };
  if (asset.kind !== "photo" || !(LOGO_TYPES as readonly string[]).includes(asset.mimeType)) return { ok: false, error: "Use a PNG, JPG or WebP photo for your logo." };
  if (asset.bytes > LOGO_MAX_BYTES) return { ok: false, error: "The logo must be 5 MB or smaller." };
  const storage = createAdminClient().storage;
  try {
    const { data, error } = await storage.from("media").download(asset.path);
    if (error || !data) throw error ?? new Error("No file");
    const path = buildObjectPath(ctx.userId, asset.name || "logo", "logo");
    const { error: upload } = await storage.from("brand").upload(path, new Uint8Array(await data.arrayBuffer()), { contentType: asset.mimeType, upsert: false });
    if (upload) throw upload;
    return { ok: true, path };
  } catch (error) {
    await logError(error, { source: "brand.logoFromGallery", level: "warn", businessId: ctx.businessId });
    return { ok: false, error: "We could not use that photo. Please try another one, or upload it." };
  }
}

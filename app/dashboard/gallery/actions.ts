"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/require-user";
import { assertFeature, FeatureRequiredError } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import {
  businessIdFor,
  createFolder as makeFolder,
  deleteAssets as removeAssets,
  deleteFolder as removeFolder,
  discardUpload as dropUpload,
  finalizeUpload as saveUpload,
  galleryOverview,
  listMedia,
  MediaError,
  moveAssets as moveInto,
  prepareUploads,
  renameAsset as renamePhoto,
  renameFolder as renameFolderRow,
  type FolderSummary,
  type GalleryOverview,
  type MediaItem,
  type UploadTarget,
} from "@/lib/media/service";
import { MEDIA_BULK_MAX, MEDIA_RATE, UPLOAD_BATCH_MAX } from "@/lib/media/rules";
import { RateLimitError, rateLimit, rateLimitMessage } from "@/lib/rate-limit";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const FAILED = "Something went wrong. Please try again.";
const id = z.string().min(1).max(60);
const folderId = id.nullish().transform((v) => v || null);
const ids = z.array(id).min(1).max(MEDIA_BULK_MAX);

type Ctx = { userId: string; businessId: string };

/** Signed-in, active user plus their business; maps expected failures to messages the user can read. */
async function guard<T extends object>(fn: (ctx: Ctx) => Promise<T>, options: { limit?: boolean } = {}): Promise<Result<T>> {
  const user = await requireActiveUser();
  try {
    const businessId = await businessIdFor(user.id);
    if (!businessId) return { ok: false, error: "Set up your business first." };
    await assertFeature(businessId, "gallery");
    if (options.limit) await rateLimit(`media-edit:${user.id}`, MEDIA_RATE.edit);
    return { ok: true, ...(await fn({ userId: user.id, businessId })) };
  } catch (error) {
    if (error instanceof MediaError || error instanceof FeatureRequiredError) return { ok: false, error: error.message };
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    void logError(error, { source: "gallery.action", userId: user.id });
    return { ok: false, error: FAILED };
  }
}

function refresh() {
  revalidatePath("/dashboard/gallery");
}

const uploadSchema = z.object({
  folderId,
  files: z.array(z.object({ name: z.string().max(260), type: z.string().max(100), size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) })).min(1).max(UPLOAD_BATCH_MAX),
});

/** Checks the files and returns one signed upload target per file, in order. */
export async function createUploadTargets(input: z.input<typeof uploadSchema>): Promise<Result<{ targets: UploadTarget[] }>> {
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Add up to 20 photos at a time." };
  return guard(async (ctx) => ({ targets: await prepareUploads(ctx, parsed.data.files, parsed.data.folderId) }));
}

const finalizeSchema = z.object({
  path: z.string().min(1).max(300),
  name: z.string().max(260),
  folderId,
  width: z.number().int().nullish(),
  height: z.number().int().nullish(),
});

export async function finalizeUpload(input: z.input<typeof finalizeSchema>): Promise<Result<{ item: MediaItem }>> {
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That upload could not be used." };
  // No revalidation here: the browser refreshes once after the whole drop, instead of once per file.
  return guard(async (ctx) => ({ item: await saveUpload(ctx, parsed.data) }));
}

/** Cleans up an upload that failed after reaching Storage. */
export async function discardUpload(path: string): Promise<void> {
  const user = await requireActiveUser();
  try {
    if (typeof path === "string") await dropUpload(user.id, path);
  } catch {}
}

const FOLDER_FILTER = z.string().max(60).optional();
const pageSchema = z.object({ folder: FOLDER_FILTER, search: z.string().max(80).optional(), cursor: z.string().max(60).nullish() });

/** One page of photos for "Load more" and the picker. `folder` is "all" (default), "none" or a folder id. */
export async function listGalleryPage(input: z.input<typeof pageSchema>): Promise<Result<{ items: MediaItem[]; nextCursor: string | null }>> {
  const parsed = pageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: FAILED };
  const { folder, search, cursor } = parsed.data;
  return guard(async ({ businessId }) => listMedia(businessId, { folderId: !folder || folder === "all" ? undefined : folder === "none" ? null : folder, search, cursor, take: 48 }));
}

export async function getGalleryOverview(): Promise<Result<{ overview: GalleryOverview }>> {
  return guard(async ({ businessId }) => ({ overview: await galleryOverview(businessId) }));
}

export async function createFolder(name: string): Promise<Result<{ folder: FolderSummary }>> {
  if (typeof name !== "string") return { ok: false, error: FAILED };
  const result = await guard(async ({ businessId }) => ({ folder: await makeFolder(businessId, name) }), { limit: true });
  if (result.ok) refresh();
  return result;
}

export async function renameFolder(folderIdInput: string, name: string): Promise<Result> {
  const parsed = z.object({ id, name: z.string() }).safeParse({ id: folderIdInput, name });
  if (!parsed.success) return { ok: false, error: FAILED };
  const result = await guard(async ({ businessId }) => {
    await renameFolderRow(businessId, parsed.data.id, parsed.data.name);
    return {};
  }, { limit: true });
  if (result.ok) refresh();
  return result;
}

/** Deletes the folder; its photos move to "Not in a folder". */
export async function deleteFolder(folderIdInput: string): Promise<Result<{ moved: number }>> {
  const parsed = id.safeParse(folderIdInput);
  if (!parsed.success) return { ok: false, error: FAILED };
  const result = await guard(({ businessId }) => removeFolder(businessId, parsed.data), { limit: true });
  if (result.ok) refresh();
  return result;
}

export async function renameAsset(assetId: string, name: string): Promise<Result<{ name: string }>> {
  const parsed = z.object({ id, name: z.string().max(260) }).safeParse({ id: assetId, name });
  if (!parsed.success) return { ok: false, error: FAILED };
  const result = await guard(async ({ businessId }) => ({ name: await renamePhoto(businessId, parsed.data.id, parsed.data.name) }), { limit: true });
  if (result.ok) refresh();
  return result;
}

/** Moves photos into a folder; `null` takes them out of any folder. */
export async function moveAssets(assetIds: string[], target: string | null): Promise<Result<{ moved: number }>> {
  const parsed = z.object({ ids, folderId }).safeParse({ ids: assetIds, folderId: target });
  if (!parsed.success) return { ok: false, error: FAILED };
  const result = await guard(async ({ businessId }) => ({ moved: await moveInto(businessId, parsed.data.ids, parsed.data.folderId) }), { limit: true });
  if (result.ok) refresh();
  return result;
}

export async function deleteAssets(assetIds: string[]): Promise<Result<{ deleted: number }>> {
  const parsed = ids.safeParse(assetIds);
  if (!parsed.success) return { ok: false, error: FAILED };
  const result = await guard(async ({ businessId }) => ({ deleted: await removeAssets(businessId, parsed.data) }), { limit: true });
  if (result.ok) refresh();
  return result;
}

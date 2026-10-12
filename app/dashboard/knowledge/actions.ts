"use server";

import { revalidatePath } from "next/cache";
import { z, type ZodError } from "zod";
import { prisma } from "@/lib/db";
import { AIProviderError } from "@/lib/ai/types";
import { requireActiveUser } from "@/lib/auth/require-user";
import { featureBlocked } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { knowledgeAction, SAVE_FAILED, type Result } from "@/lib/knowledge/guard";
import { resolveSubject, subjectColumns, subjectHref, type Subject } from "@/lib/knowledge/service";
import { linkPhotos, makeCover, photoAlbums, setPhotoProducts, unlinkPhotos, type PhotoAlbums } from "@/lib/media/albums";
import { MEDIA_BULK_MAX } from "@/lib/media/rules";
import { RATE_LIMITS, rateLimit, rateLimitMessage, RateLimitError } from "@/lib/rate-limit";
import { editedContentSchema, instructionSchema } from "@/lib/studio/schemas";
import { generateForSubject, pruneVersions, StudioNotFoundError, variantsJson } from "@/lib/studio/service";
import { UsageLimitError, type UsageBlockReason } from "@/lib/usage";

// Writing content for a product or campaign, editing it, and the albums' photos.

export type ContentResult = { ok: true; contentId: string } | { ok: false; error: string; fieldErrors?: Record<string, string>; blocked?: UsageBlockReason };

const NOT_FOUND = { ok: false as const, error: "We could not find that." };
const GENERATE_FAILED = "We could not write your content just now. You were not charged, please try again.";
const id = z.string().min(1).max(60);
const albumKind = z.enum(["product", "campaign"]);

function flatErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

function refresh(subject: Subject) {
  revalidatePath(subjectHref(subject));
  revalidatePath("/dashboard/content");
  // The usage meters in the app shell.
  revalidatePath("/dashboard", "layout");
}

/** A new content version for a product or campaign: the first one, or a regeneration with an optional note. */
export async function generateContent(subjectId: string, input: { instruction?: string } = {}): Promise<ContentResult> {
  const user = await requireActiveUser();
  const instruction = instructionSchema.safeParse(input?.instruction);
  if (!instruction.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: { instruction: "Use 500 characters or fewer." } };
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) return NOT_FOUND;
  const missing = await featureBlocked(business.id, "content");
  if (missing) return { ok: false, error: missing };
  const subject = await resolveSubject(business.id, subjectId);
  if (!subject) return NOT_FOUND;
  const count = await prisma.generatedContent.count({ where: { businessId: business.id, ...subjectColumns(subject) } });

  try {
    const content = await generateForSubject({ userId: user.id, businessId: business.id, subject, instruction: instruction.data, feature: count > 0 ? "regenerate" : "content" });
    refresh(subject);
    return { ok: true, contentId: content.id };
  } catch (error) {
    if (error instanceof StudioNotFoundError) return NOT_FOUND;
    if (error instanceof UsageLimitError) return { ok: false, error: "Your plan does not allow new content right now.", blocked: error.reason };
    if (!(error instanceof AIProviderError)) await logError(error, { source: "studio.generate", level: "error" });
    return { ok: false, error: GENERATE_FAILED };
  }
}

/** Saves the owner's edits as a new version. Costs no credit. */
export async function saveEditedContent(contentId: string, input: { caption: string; hashtags: string[]; videoScript: string; adHeadlines: string[] }): Promise<ContentResult> {
  const user = await requireActiveUser();
  const parsed = editedContentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flatErrors(parsed.error) };
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) return NOT_FOUND;
  try {
    await rateLimit(`edit:${user.id}`, RATE_LIMITS.contentEdit);
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    throw error;
  }
  const base = await prisma.generatedContent.findFirst({ where: { id: contentId, businessId: business.id }, select: { productId: true, campaignId: true, language: true } });
  if (!base || (!base.productId && !base.campaignId)) return NOT_FOUND;
  const subject: Subject = base.productId ? { kind: "product", id: base.productId } : { kind: "campaign", id: base.campaignId! };

  const { caption, videoScript, adHeadlines } = parsed.data;
  const hashtags = parsed.data.hashtags.map((t) => t.trim()).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`));
  try {
    const saved = await prisma.generatedContent.create({
      data: { businessId: business.id, ...subjectColumns(subject), caption, hashtags, videoScript, adHeadlines, language: base.language, variants: variantsJson({ caption, hashtags, videoScript }), edited: true, provider: "edit", model: "owner" },
      select: { id: true },
    });
    await pruneVersions(subject).catch(() => {});
    refresh(subject);
    return { ok: true, contentId: saved.id };
  } catch {
    return { ok: false, error: SAVE_FAILED };
  }
}

// ---- Albums -------------------------------------------------------------------------------------------------------
// Product and campaign albums are part of products (the `content` feature); the Gallery's own folders need `gallery`.

const albumSchema = z.object({ kind: albumKind, albumId: id, assetIds: z.array(id).min(1).max(MEDIA_BULK_MAX) });

function refreshAlbum(kind: "product" | "campaign", albumId: string) {
  revalidatePath(subjectHref({ kind, id: albumId }));
  revalidatePath("/dashboard/gallery");
}

/** Adds gallery photos to a product's or campaign's album. */
export async function addToAlbum(kind: string, albumId: string, assetIds: string[]): Promise<Result<{ added: number }>> {
  const parsed = albumSchema.safeParse({ kind, albumId, assetIds });
  if (!parsed.success) return { ok: false, error: SAVE_FAILED };
  const { data } = parsed;
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "knowledgeEdit", source: "knowledge.album.add" }, async ({ businessId }) => ({ added: await linkPhotos(businessId, data.kind, data.albumId, data.assetIds) }));
  if (result.ok) refreshAlbum(data.kind, data.albumId);
  return result;
}

/** Takes photos out of the album. They stay in the gallery. */
export async function removeFromAlbum(kind: string, albumId: string, assetIds: string[]): Promise<Result<{ removed: number }>> {
  const parsed = albumSchema.safeParse({ kind, albumId, assetIds });
  if (!parsed.success) return { ok: false, error: SAVE_FAILED };
  const { data } = parsed;
  const result = await knowledgeAction({ permission: "content", limit: "knowledgeEdit", source: "knowledge.album.remove" }, async ({ businessId }) => ({ removed: await unlinkPhotos(businessId, data.kind, data.albumId, data.assetIds) }));
  if (result.ok) refreshAlbum(data.kind, data.albumId);
  return result;
}

export async function setAlbumCover(kind: string, albumId: string, assetId: string): Promise<Result> {
  const parsed = z.object({ kind: albumKind, albumId: id, assetId: id }).safeParse({ kind, albumId, assetId });
  if (!parsed.success) return { ok: false, error: SAVE_FAILED };
  const { data } = parsed;
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "knowledgeEdit", source: "knowledge.album.cover" }, async ({ businessId }) => {
    await makeCover(businessId, data.kind, data.albumId, data.assetId);
    return {};
  });
  if (result.ok) refreshAlbum(data.kind, data.albumId);
  return result;
}

/** The albums a photo is in (the gallery viewer). */
export async function getPhotoAlbums(assetId: string): Promise<Result<{ albums: PhotoAlbums }>> {
  if (!id.safeParse(assetId).success) return { ok: false, error: SAVE_FAILED };
  return knowledgeAction({ permission: "content", feature: "gallery", source: "knowledge.album.read" }, async ({ businessId }) => ({ albums: await photoAlbums(businessId, assetId) }));
}

/** Sets which products a photo belongs to (the gallery viewer's "Products" picker). */
export async function setPhotoProductsAction(assetId: string, productIds: string[]): Promise<Result<{ albums: PhotoAlbums }>> {
  const parsed = z.object({ assetId: id, productIds: z.array(id).max(50) }).safeParse({ assetId, productIds });
  if (!parsed.success) return { ok: false, error: SAVE_FAILED };
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "knowledgeEdit", source: "knowledge.album.photo" }, async ({ businessId }) => ({ albums: await setPhotoProducts(businessId, parsed.data.assetId, parsed.data.productIds) }));
  if (result.ok) revalidatePath("/dashboard/gallery");
  return result;
}

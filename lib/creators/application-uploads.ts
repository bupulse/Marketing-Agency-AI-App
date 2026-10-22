import "server-only";
import { prisma } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { answerName, type ApplicationErrors } from "./application";
import type { Answer, FormField } from "./form-fields";
import { CREATOR_MEDIA_BUCKET, isCreatorImage, isCreatorVideo, MEDIA_KEEP_DAYS } from "./media";
import { MAX_FILE_BYTES } from "./tasks";

// Files sent with an application (UPLOAD fields, docs/CREATOR_CAMPAIGN_WIZARD.md "Form"). The applicant has no account,
// so the server hands out one signed upload URL per file, for a campaign that is live and taking applications, rate
// limited per address and per campaign, photos and videos only (as the field accepts), 50 MB at most (Supabase Free).
// Files go to the private "creator-media" bucket under "applications/<campaignId>/<uuid>.<ext>": never public, the
// company sees them through short-lived signed links. On submit each UPLOAD answer must be such a path, of this
// campaign, and the file must be there and fit the field. Files nobody sent an application with are deleted two days
// later, and every file of a campaign 60 days after it ends (cleanupApplicationUploads, run by the creator views job).

export const APPLICATION_UPLOAD_BYTES = MAX_FILE_BYTES;
/** Unsent uploads are kept this long (someone may still be filling in the form). */
export const UNSENT_KEEP_DAYS = 2;

/** Per address, all campaigns together: enough for a form or two, with retries. */
export const UPLOAD_LIMIT_IP = { limit: 10, windowSeconds: 60 * 60 };
/** Per campaign: what a busy campaign gets in a day, and the most a script could fill the free Storage with. */
export const UPLOAD_LIMIT_CAMPAIGN = { limit: 100, windowSeconds: 24 * 60 * 60 };

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-m4v": "m4v" };

export const uploadFolder = (campaignId: string) => `applications/${campaignId}/`;

/** Where a new upload of this type goes. */
export const newUploadPath = (campaignId: string, type: string) => `${uploadFolder(campaignId)}${globalThis.crypto.randomUUID()}.${EXT[type.toLowerCase()]}`;

/** True for a path this campaign's upload could have made (nothing else, so no other file can be named). */
export function isApplicationUploadPath(path: string, campaignId: string): boolean {
  if (!path.startsWith(uploadFolder(campaignId))) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic|heif|mp4|mov|webm|m4v)$/.test(path.slice(uploadFolder(campaignId).length));
}

/** Why a file cannot be sent for this field (its `accept`), or null. */
export function applicationFileProblem(file: { type: string; size: number }, accept: FormField["accept"]): string | null {
  const type = file.type.toLowerCase();
  const image = isCreatorImage(type);
  const video = isCreatorVideo(type);
  if (accept === "IMAGE" && !image) return "Send a photo (JPG, PNG, WebP or HEIC).";
  if (accept === "VIDEO" && !video) return "Send a video (MP4, MOV or WebM).";
  if (!image && !video) return "Send a photo or a video.";
  if (!Number.isFinite(file.size) || file.size <= 0) return "This file is empty.";
  if (file.size > APPLICATION_UPLOAD_BYTES) return `The file is over ${APPLICATION_UPLOAD_BYTES / 1024 / 1024} MB. Send a shorter or smaller one.`;
  return null;
}

/**
 * Checks the UPLOAD answers of an application: each is an upload of this campaign, there, and fits its field. A bad
 * one adds "Upload the file again." under its field in `errors`.
 */
export async function checkApplicationUploads(campaignId: string, fields: FormField[], answers: Record<string, Answer>, errors: ApplicationErrors): Promise<void> {
  const uploads = fields.filter((f) => f.type === "UPLOAD" && typeof answers[f.id] === "string");
  if (!uploads.length) return;
  const storage = createAdminClient().storage.from(CREATOR_MEDIA_BUCKET);
  for (const field of uploads) {
    const path = answers[field.id] as string;
    const bad = () => (errors[answerName(field.id)] = "Upload the file again.");
    if (!isApplicationUploadPath(path, campaignId)) {
      bad();
      continue;
    }
    const info = await storage.info(path);
    if (info.error || !info.data || applicationFileProblem({ type: String(info.data.contentType ?? ""), size: Number(info.data.size ?? 0) }, field.accept)) bad();
  }
}

/** The storage paths among an application's answers (CampaignCreator.answers as stored) that are uploads of its campaign. */
export function uploadPathsIn(answers: unknown, campaignId: string): string[] {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return [];
  return Object.values(answers as Record<string, unknown>).filter((v): v is string => typeof v === "string" && isApplicationUploadPath(v, campaignId));
}

const DAY = 86_400_000;

/**
 * Deletes application uploads nobody applied with, two days after they were made, and every upload of a campaign
 * that ended 60 days ago (or is gone). At most `folders` campaigns a run. Returns how many files were deleted.
 */
export async function cleanupApplicationUploads(now = new Date(), folders = 50): Promise<number> {
  const storage = createAdminClient().storage.from(CREATOR_MEDIA_BUCKET);
  const { data: campaigns } = await storage.list("applications", { limit: folders, sortBy: { column: "name", order: "asc" } });
  let deleted = 0;
  for (const folder of campaigns ?? []) {
    const campaignId = folder.name;
    if (!/^[a-z0-9]{10,40}$/.test(campaignId)) continue;
    const { data: files } = await storage.list(`applications/${campaignId}`, { limit: 100, sortBy: { column: "created_at", order: "asc" } });
    if (!files?.length) continue;
    const campaign = await prisma.creatorCampaign.findUnique({ where: { id: campaignId }, select: { status: true, endsOn: true } });
    const expired = !campaign || (campaign.status === "ENDED" && campaign.endsOn.getTime() < now.getTime() - MEDIA_KEEP_DAYS * DAY);
    const old = files.filter((f) => f.name && (expired || (f.created_at && Date.parse(f.created_at) < now.getTime() - UNSENT_KEEP_DAYS * DAY)));
    if (!old.length) continue;
    let gone = old.map((f) => `applications/${campaignId}/${f.name}`);
    if (!expired) {
      const rows = await prisma.campaignCreator.findMany({ where: { campaignId }, select: { answers: true } });
      const used = new Set(rows.flatMap((r) => uploadPathsIn(r.answers, campaignId)));
      gone = gone.filter((p) => !used.has(p));
    }
    if (!gone.length) continue;
    const removed = await storage.remove(gone);
    if (!removed.error) deleted += gone.length;
  }
  return deleted;
}

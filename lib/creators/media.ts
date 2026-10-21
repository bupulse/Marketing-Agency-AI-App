import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_FILE_BYTES, MAX_FILES } from "./tasks";

// The images and videos creators hand in (docs/CREATOR_CAMPAIGNS.md, "Limits"): the private Storage bucket
// "creator-media" (migration 20261028200000_creator_media_bucket), with no Storage policies, so only the server's key
// issues upload tokens and reads files. Paths are "<profileId>/<campaignId>/<uuid>-<name>": a hand-in may only use
// files under its own creator's and campaign's folder. Files go 60 days after the campaign ends (tracking/cleanup.ts).

export const CREATOR_MEDIA_BUCKET = "creator-media";
export const MEDIA_KEEP_DAYS = 60;

const IMAGE = /^image\/(jpeg|png|webp|heic|heif)$/;
const VIDEO = /^video\/(mp4|quicktime|webm|x-m4v)$/;

export const isCreatorImage = (type: string) => IMAGE.test(type);
export const isCreatorVideo = (type: string) => VIDEO.test(type);

export type UploadRequest = { name: string; type: string; size: number };
export type UploadTarget = { ok: true; path: string; token: string } | { ok: false; error: string };

const safeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-80) || "file";
export const folderOf = (profileId: string, campaignId: string) => `${profileId}/${campaignId}/`;

/** Why a file cannot be handed in for a task of this media kind, or null. */
export function fileProblem(file: UploadRequest, mediaKind: string): string | null {
  const type = file.type.toLowerCase();
  const image = isCreatorImage(type);
  const video = isCreatorVideo(type);
  if (!image && !video) return `${file.name} is not a photo or a video.`;
  if (mediaKind === "VIDEO" && !video) return `${file.name}: this task is for videos.`;
  if (mediaKind === "IMAGE" && !image) return `${file.name}: this task is for photos.`;
  if (!Number.isFinite(file.size) || file.size <= 0) return `${file.name} is empty.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name} is over ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
  return null;
}

/** Signed upload URLs for up to MAX_FILES files, lined up with `files`. */
export async function uploadTargets(profileId: string, campaignId: string, mediaKind: string, files: UploadRequest[]): Promise<UploadTarget[]> {
  if (!files.length || files.length > MAX_FILES) return files.map(() => ({ ok: false, error: `Add up to ${MAX_FILES} files.` }));
  const storage = createAdminClient().storage.from(CREATOR_MEDIA_BUCKET);
  const out: UploadTarget[] = [];
  for (const file of files) {
    const problem = fileProblem(file, mediaKind);
    if (problem) {
      out.push({ ok: false, error: problem });
      continue;
    }
    const path = `${folderOf(profileId, campaignId)}${globalThis.crypto.randomUUID()}-${safeName(file.name)}`;
    const { data, error } = await storage.createSignedUploadUrl(path);
    out.push(error || !data ? { ok: false, error: `${file.name} could not be started. Please try again.` } : { ok: true, path: data.path, token: data.token });
  }
  return out;
}

/**
 * The handed-in paths that really are this creator's uploads for this campaign, each there and within the limits.
 * Throws a message for the creator otherwise.
 */
export async function checkUploads(profileId: string, campaignId: string, mediaKind: string, paths: string[]): Promise<string[]> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length > MAX_FILES) throw new Error(`Add up to ${MAX_FILES} files.`);
  const folder = folderOf(profileId, campaignId);
  const storage = createAdminClient().storage.from(CREATOR_MEDIA_BUCKET);
  for (const path of unique) {
    if (!path.startsWith(folder) || path.includes("..") || path.slice(folder.length).includes("/")) throw new Error("That file could not be used. Please upload it again.");
    const info = await storage.info(path);
    if (info.error || !info.data) throw new Error("We could not find one of the files. Please upload it again.");
    const problem = fileProblem({ name: path.slice(folder.length + 37), type: String(info.data.contentType ?? ""), size: Number(info.data.size ?? 0) }, mediaKind);
    if (problem) throw new Error(problem);
  }
  return unique;
}

/** Short-lived links to show handed-in files (path -> url); a file that cannot be signed is left out. */
export async function mediaUrls(paths: string[], seconds = 60 * 60): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  const { data } = await createAdminClient().storage.from(CREATOR_MEDIA_BUCKET).createSignedUrls(paths, seconds);
  const out = new Map<string, string>();
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  return out;
}

/** Deletes every file under a creator's folder for a campaign (uploads never handed in too). Returns how many went. */
export async function deleteCampaignFolder(profileId: string, campaignId: string): Promise<number> {
  const storage = createAdminClient().storage.from(CREATOR_MEDIA_BUCKET);
  const folder = folderOf(profileId, campaignId).replace(/\/$/, "");
  let removed = 0;
  for (let round = 0; round < 20; round++) {
    const { data, error } = await storage.list(folder, { limit: 100 });
    if (error || !data?.length) break;
    const paths = data.filter((f) => f.name).map((f) => `${folder}/${f.name}`);
    if (!paths.length) break;
    const gone = await storage.remove(paths);
    if (gone.error) break;
    removed += paths.length;
    if (data.length < 100) break;
  }
  return removed;
}

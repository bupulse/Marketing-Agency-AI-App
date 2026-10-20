// Phone clips for viral videos (docs/VIRAL_RECIPES.md, "Phone clips"): 2 to 4 short clips the client films (5 to 10 s
// each: the shop, hands holding the product, the owner talking), which the designer may place as "video" layers. A
// client's clip is a video in their BuPulse Gallery ("Studio clips" folder: the Gallery's own checks, its video quota
// and rate limits), served back to their own pages only; the owner's test clips stay in video-lab/data/media. Free.
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { GALLERY_VIDEO_BUCKET } from "@/lib/media/rules";
import { MediaError, createFolder, finalizeUpload, prepareUploads } from "@/lib/media/service";
import type { BriefClip } from "@/lib/video-engine/designer";
import { readMp4Table } from "@/lib/video-engine/video-source";
import { ClientJobError, asClientError } from "./client-jobs";
import { mediaBytes, saveMedia } from "./data-source";
import { CLIP_SECONDS, MAX_CLIPS, clientClipPath, clipLengthOk } from "./clip-rules";
import type { StudioIdentity } from "./session";

export { CLIP_SECONDS, MAX_CLIPS, clientClipPath };

/** The largest clip (a 10 s phone clip at 1080p is about 15 to 25 MB). */
export const CLIP_MAX_BYTES = 30 * 1024 * 1024;
/** Codecs the studio's browser renderer decodes (WebCodecs): H.264, HEVC (iPhone), VP9, AV1. */
const CODECS = /^(avc1|avc3|hvc1|hev1|vp09|av01)/;
export const STUDIO_CLIPS_FOLDER = "Studio clips";

export type ClipInfo = { seconds: number; width: number; height: number; codec: string };

/** Reads an uploaded clip (MP4 or MOV) and checks it: a readable video track, 5 to 10 s, a codec the renderer plays. */
export function checkClip(bytes: Buffer): ClipInfo {
  if (bytes.length > CLIP_MAX_BYTES) throw new ClientJobError(`That clip is over ${CLIP_MAX_BYTES / 1024 / 1024} MB. Film a shorter clip (5 to 10 seconds) or at a lower quality.`, 400);
  if (bytes.length < 1000 || bytes.subarray(4, 8).toString("latin1") !== "ftyp") throw new ClientJobError("Use an MP4 or MOV video from your phone.", 400);
  let table;
  try {
    table = readMp4Table(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer);
  } catch (error) {
    throw new ClientJobError(error instanceof Error ? error.message : "That video could not be read.", 400);
  }
  const seconds = Math.round(table.durationMs / 100) / 10;
  if (!clipLengthOk(seconds)) throw new ClientJobError(`That clip is ${seconds} seconds. Use clips of ${CLIP_SECONDS.min} to ${CLIP_SECONDS.max} seconds (trim it on your phone).`, 400);
  if (!CODECS.test(table.codec)) throw new ClientJobError("Your phone saved this clip in a format the studio cannot play. On iPhone, set Camera > Formats > Most Compatible and film it again.", 400);
  return { seconds, width: table.width, height: table.height, codec: table.codec };
}

async function clipsFolder(businessId: string): Promise<string> {
  const found = await prisma.mediaFolder.findUnique({ where: { businessId_name: { businessId, name: STUDIO_CLIPS_FOLDER } }, select: { id: true } });
  if (found) return `folder:${found.id}`;
  try {
    return `folder:${(await createFolder(businessId, STUDIO_CLIPS_FOLDER)).id}`;
  } catch (error) {
    const again = await prisma.mediaFolder.findUnique({ where: { businessId_name: { businessId, name: STUDIO_CLIPS_FOLDER } }, select: { id: true } });
    if (again) return `folder:${again.id}`;
    throw error;
  }
}


/** Saves a client's phone clip into their Gallery ("Studio clips") and returns it as the page shows it. */
export async function uploadClipForClient(id: StudioIdentity, bytes: Buffer, fileName: string, mimeType: string) {
  try {
    const info = checkClip(bytes);
    const ctx = { userId: id.companyUserId, businessId: id.businessId };
    const destination = await clipsFolder(id.businessId);
    const type = /quicktime|\.mov$/i.test(`${mimeType} ${fileName}`) ? "video/quicktime" : "video/mp4";
    const name = `${fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 60) || "phone-clip"}.${type === "video/quicktime" ? "mov" : "mp4"}`;
    const [target] = await prepareUploads(ctx, [{ name, type, size: bytes.length }], destination);
    if (!target?.ok) throw new MediaError(target?.error ?? "The clip could not be saved. Please try again.");
    const up = await createAdminClient().storage.from(GALLERY_VIDEO_BUCKET).uploadToSignedUrl(target.path, target.token, new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), { contentType: "video/mp4" });
    if (up.error) throw new ClientJobError("The clip did not upload. Please try again.", 502);
    const item = await finalizeUpload(ctx, { path: target.path, name, destination, width: info.width, height: info.height });
    return { id: item.id, url: clientClipPath(item.id), seconds: info.seconds, width: info.width, height: info.height };
  } catch (error) {
    throw await asClientError(error, 0, id.companyUserId);
  }
}

/** The bytes of a client's own clip, or null (another business's, or not a video). */
export async function clientClipBytes(id: StudioIdentity, assetId: string): Promise<Buffer | null> {
  if (!/^[A-Za-z0-9-]{10,40}$/.test(assetId)) return null;
  const asset = await prisma.mediaAsset.findFirst({ where: { id: assetId, businessId: id.businessId, kind: "video" }, select: { path: true } });
  if (!asset) return null;
  const got = await createAdminClient().storage.from(GALLERY_VIDEO_BUCKET).download(asset.path);
  return got.error || !got.data ? null : Buffer.from(await got.data.arrayBuffer());
}

// ---- The owner's test clips (video-lab/data/media, served at /api/media/<id>)

const MEDIA = path.resolve("video-lab/data/media");
const OWNER_CLIP = /^um-[0-9a-f]{12}$/;

/** Saves the owner's test clip (checked like a client's) and its length and size beside it. */
export async function saveOwnerClip(bytes: Buffer, mimeType: string) {
  const info = checkClip(bytes);
  const saved = await saveMedia(bytes, /quicktime/i.test(mimeType) ? "video/quicktime" : "video/mp4");
  await fs.writeFile(path.join(MEDIA, `${saved.id}.clip.json`), JSON.stringify(info));
  return { id: saved.id, url: `/api/media/${saved.id}`, seconds: info.seconds, width: info.width, height: info.height };
}

/** The owner's test clips for a design, in the page's order. */
export async function ownerBriefClips(ids: unknown): Promise<BriefClip[]> {
  const wanted = (Array.isArray(ids) ? ids : []).map(String).filter((x) => OWNER_CLIP.test(x)).slice(0, MAX_CLIPS);
  const out: BriefClip[] = [];
  for (const w of wanted) {
    const info = await fs
      .readFile(path.join(MEDIA, `${w}.clip.json`), "utf8")
      .then((t) => JSON.parse(t) as ClipInfo)
      .catch(async () => {
        // An older reference upload: measured now.
        const m = await mediaBytes(w);
        try {
          return m ? checkClip(m.bytes) : null;
        } catch {
          return null;
        }
      });
    if (info) out.push({ path: `/api/media/${w}`, source: "phone", seconds: info.seconds, width: info.width, height: info.height });
  }
  return out;
}

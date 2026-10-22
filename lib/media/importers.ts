import "server-only";
import { CanvaApiError, exportDesignPng, listDesigns, type CanvaDesignSummary } from "@/lib/canva/client";
import { CanvaTimeoutError } from "@/lib/canva/jobs";
import { CanvaNotConnectedError, CanvaReconnectError, withCanva } from "@/lib/canva/tokens";
import { isCanvaEnabled } from "@/lib/canva/config";
import { prisma } from "@/lib/db";
import { isServiceEnabled, UNAVAILABLE_MESSAGE } from "@/lib/admin/switch";
import { rateLimit } from "@/lib/rate-limit";
import { HEIC_MESSAGE, heifPhotoType, IMPORT_MAX_FILES, isMediaType, MEDIA_MAX_BYTES, sniffMediaType, sniffVideoType, UNSUPPORTED_MESSAGE, VIDEO_MAX_BYTES } from "./rules";
import { DRIVE_SHARE_MESSAGE, DROPBOX_OPEN_MESSAGE, linkFileName, looksLikeHtml, parseMediaLink, WEB_PAGE_MESSAGE, type MediaLink } from "./links";
import { publicFetchOptions } from "./public-dns";
import { isDropboxHost, isGoogleApiHost, readCapped, SafeFetchError, safeFetchBytes, safeFetchResponse } from "./safe-fetch";
import { hasImported, importAsset, importVideo, limitImport, MediaError, type MediaItem, type PosterTarget } from "./service";

type Ctx = { userId: string; businessId: string };

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_ID = /^[A-Za-z0-9_-]{8,128}$/;
const CANVA_DESIGN_ID = /^[A-Za-z0-9_-]{6,64}$/;
/** Canva exports are scaled to this width so a big design stays under the 10 MB limit. */
const CANVA_EXPORT_WIDTH = 2048;

export { IMPORT_MAX_FILES };

/** Keys the browser needs to open each provider's picker. All are public identifiers, never secrets. */
export type ImportOptions = {
  google: { apiKey: string; clientId: string; appId: string } | null;
  dropboxAppKey: string | null;
  canva: "unavailable" | "connected" | "not_connected";
  /** "From a link" needs no keys: false only when the admin switched it off. */
  link: boolean;
};

export function googlePickerConfig(): ImportOptions["google"] {
  const apiKey = process.env.GOOGLE_PICKER_API_KEY;
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_YOUTUBE_CLIENT_ID;
  const appId = process.env.GOOGLE_PICKER_APP_ID;
  return apiKey && clientId && appId ? { apiKey, clientId, appId } : null;
}

export const dropboxAppKey = () => process.env.DROPBOX_APP_KEY || null;

export async function canvaImportState(userId: string): Promise<ImportOptions["canva"]> {
  if (!isCanvaEnabled() || !(await isServiceEnabled("canva"))) return "unavailable";
  return (await prisma.canvaConnection.count({ where: { userId } })) > 0 ? "connected" : "not_connected";
}

export async function importOptions(userId: string): Promise<ImportOptions> {
  // A source switched off in the admin console is hidden like one that is not configured.
  const [drive, dropbox, link] = await Promise.all([isServiceEnabled("google-drive"), isServiceEnabled("dropbox"), isServiceEnabled("link-import")]);
  return { google: drive ? googlePickerConfig() : null, dropboxAppKey: dropbox ? dropboxAppKey() : null, canva: await canvaImportState(userId), link };
}

function download(error: unknown, name: string): never {
  if (error instanceof SafeFetchError) {
    if (error.code === "too_big") throw new MediaError(`${name} is over 10 MB. Resize it and try again.`);
    if (error.code === "timeout") throw new MediaError(`${name} took too long to download. Please try again.`);
    if (error.code === "http" && (error.status === 401 || error.status === 403)) throw new MediaError("Google access ran out. Open the picker again and pick the files again.");
    if (error.code === "http" && error.status === 404) throw new MediaError(`${name} was not found. It may have been moved or deleted.`);
    throw new MediaError(`${name} could not be downloaded. Please try again.`);
  }
  throw error;
}

/** One photo the person picked in Google Picker. The access token is used for this call only and never stored. */
export async function importDriveFile(ctx: Ctx, input: { token: string; fileId: string; destination: string | null }): Promise<MediaItem> {
  if (!(await isServiceEnabled("google-drive"))) throw new MediaError(UNAVAILABLE_MESSAGE);
  if (!DRIVE_ID.test(input.fileId) || !input.token) throw new MediaError("That file could not be imported.");
  await limitImport(ctx.userId);
  const headers = { Authorization: `Bearer ${input.token}` };
  const file = `${DRIVE_API}/${encodeURIComponent(input.fileId)}`;
  let meta: { name?: string; mimeType?: string; size?: string };
  try {
    meta = JSON.parse(new TextDecoder().decode(await safeFetchBytes(`${file}?fields=name,mimeType,size`, { allowHost: isGoogleApiHost, maxBytes: 64 * 1024, timeoutMs: 15_000, headers })));
  } catch (error) {
    if (error instanceof SyntaxError) throw new MediaError("That file could not be imported.");
    return download(error, "That file");
  }
  const name = meta.name || "Drive photo";
  if (/^image\/hei[cf]/.test(meta.mimeType ?? "")) throw new MediaError(`${name}: ${HEIC_MESSAGE}`);
  if (!meta.mimeType || !isMediaType(meta.mimeType)) throw new MediaError(`${name}: ${UNSUPPORTED_MESSAGE}`);
  if (Number(meta.size) > MEDIA_MAX_BYTES) throw new MediaError(`${name} is over 10 MB. Resize it and try again.`);
  const bytes = await safeFetchBytes(`${file}?alt=media`, { allowHost: isGoogleApiHost, maxBytes: MEDIA_MAX_BYTES, timeoutMs: 45_000, headers }, `${name} is over 10 MB. Resize it and try again.`).catch((e) => download(e, name));
  return importAsset(ctx, { bytes, name, destination: input.destination, source: "google_drive" });
}

/** One Dropbox Chooser direct link. Only https links on Dropbox hosts are followed. */
export async function importDropboxFile(ctx: Ctx, input: { link: string; name: string; destination: string | null }): Promise<MediaItem> {
  if (!(await isServiceEnabled("dropbox"))) throw new MediaError(UNAVAILABLE_MESSAGE);
  await limitImport(ctx.userId);
  const bytes = await safeFetchBytes(input.link, { allowHost: isDropboxHost, maxBytes: MEDIA_MAX_BYTES, timeoutMs: 45_000 }, `${input.name} is over 10 MB. Resize it and try again.`).catch((e) => download(e, input.name));
  return importAsset(ctx, { bytes, name: input.name, destination: input.destination, source: "dropbox" });
}

/** A link download's whole budget: Netlify answers every request within 60 s, and the upload and checks come after. */
const LINK_TIMEOUT_MS = 40_000;

/** What a failed link download tells the person, by where the link points. */
function linkFailure(error: unknown, link: MediaLink, maxBytes: number): never {
  if (!(error instanceof SafeFetchError)) throw error;
  if (error.code === "too_big") throw new MediaError(maxBytes > MEDIA_MAX_BYTES ? "That file is over 50 MB. Photos can be up to 10 MB and videos up to 50 MB." : "That photo is over 10 MB. Resize it and try again.");
  if (error.code === "timeout") throw new MediaError("That file took too long to download. Please try again, or use a smaller file.");
  if (error.code === "blocked" && error.message.includes("private")) throw new MediaError(error.message);
  // Drive answers a file that is not shared publicly with a sign-in page, a 401/403 or a 404.
  if (link.kind === "drive" && (error.code === "http" || error.code === "blocked")) throw new MediaError(DRIVE_SHARE_MESSAGE);
  if (link.kind === "dropbox" && error.code === "http") throw new MediaError(DROPBOX_OPEN_MESSAGE);
  if (error.code === "http" && (error.status === 401 || error.status === 403)) throw new MediaError("That website does not let BuPulse download the file. Download it to your phone or computer and upload it instead.");
  if (error.code === "http" && error.status === 404) throw new MediaError("Nothing was found at that link. Check the link and try again.");
  if (error.code === "network" && error.message.startsWith("BuPulse")) throw new MediaError(error.message);
  throw new MediaError("That link could not be downloaded. Check the link and try again.");
}

/** The message for a link that gave a web page instead of a file. */
const pageMessage = (link: MediaLink) => (link.kind === "drive" ? DRIVE_SHARE_MESSAGE : link.kind === "dropbox" ? DROPBOX_OPEN_MESSAGE : WEB_PAGE_MESSAGE);

/**
 * One photo or video from a pasted link: a Google Drive file shared "Anyone with the link", a Dropbox share link, or any
 * https link straight to a file (lib/media/links.ts). Any public website can be named, so the download refuses
 * private and local addresses on every hop, by name and by where the name points (lib/media/public-dns.ts). The type
 * comes from the file's own first bytes, never from the website: a photo (JPG, PNG, WebP, 10 MB) goes through
 * importAsset, a video (MP4, MOV, WebM, 50 MB, 60 s) through importVideo. `videos: false` (a photo-only picker)
 * refuses videos.
 */
export async function importLinkedFile(
  ctx: Ctx,
  input: { link: string; destination: string | null; videos?: boolean },
): Promise<{ item: MediaItem; poster: PosterTarget | null }> {
  if (!(await isServiceEnabled("link-import"))) throw new MediaError(UNAVAILABLE_MESSAGE);
  const checked = parseMediaLink(input.link);
  if (!checked.ok) throw new MediaError(checked.error);
  const { link } = checked;
  const videos = input.videos !== false;
  await limitImport(ctx.userId);
  const maxBytes = videos ? VIDEO_MAX_BYTES : MEDIA_MAX_BYTES;
  let bytes: Uint8Array;
  let name: string | null;
  try {
    const response = await safeFetchResponse(link.url, { ...publicFetchOptions(), maxBytes, timeoutMs: LINK_TIMEOUT_MS, maxRedirects: 5 });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new SafeFetchError("The file could not be downloaded.", "http", response.status);
    }
    // A web page instead of the file (a Drive sign-in or share page, a site's page): no need to read it all.
    if (/^text\/html|^application\/xhtml/i.test(response.headers.get("content-type") ?? "")) {
      await response.body?.cancel().catch(() => {});
      throw new MediaError(pageMessage(link));
    }
    name = linkFileName(response.headers.get("content-disposition"), input.link);
    bytes = await readCapped(response, maxBytes, "too big");
  } catch (error) {
    if (error instanceof MediaError) throw error;
    return linkFailure(error, link, maxBytes);
  }
  const heif = heifPhotoType(bytes);
  if (heif === "heic") throw new MediaError(HEIC_MESSAGE);
  if (heif) throw new MediaError(UNSUPPORTED_MESSAGE);
  if (sniffMediaType(bytes)) return { item: await importAsset(ctx, { bytes, name: name ?? "Photo from a link", destination: input.destination, source: "link" }), poster: null };
  if (sniffVideoType(bytes)) {
    if (!videos) throw new MediaError("Only photos can be added here. Add videos in the Gallery.");
    return importVideo(ctx, { bytes, name: name ?? "Video from a link", destination: input.destination, source: "link" });
  }
  throw new MediaError(looksLikeHtml(bytes) ? pageMessage(link) : UNSUPPORTED_MESSAGE);
}

export class CanvaImportError extends MediaError {
  constructor(
    message: string,
    public needsConnect = false,
  ) {
    super(message);
  }
}

const RECONNECT = "Reconnect Canva to let BuPulse see your designs.";

function canvaFailure(error: unknown): never {
  if (error instanceof CanvaNotConnectedError) throw new CanvaImportError("Connect your Canva account first.", true);
  if (error instanceof CanvaReconnectError) throw new CanvaImportError(RECONNECT, true);
  if (error instanceof CanvaApiError) {
    // Accounts linked before "Import from Canva" lack the design:meta:read permission.
    if (error.status === 403 || error.status === 401) throw new CanvaImportError(RECONNECT, true);
    if (error.status === 429) throw new CanvaImportError("Canva is busy. Wait a minute and try again.");
    if (error.status === 404) throw new CanvaImportError("That design was not found in Canva.");
    if (error.status === 413) throw new CanvaImportError("That design is too large to import (over 10 MB).");
    if (error.status === 422) throw new CanvaImportError("Canva could not export that design.");
  }
  if (error instanceof CanvaTimeoutError) throw new CanvaImportError("Canva took too long. Please try again.");
  throw error;
}

export async function listCanvaDesigns(userId: string, input: { query?: string; cursor?: string | null }): Promise<{ items: CanvaDesignSummary[]; nextCursor: string | null }> {
  if (!(await isServiceEnabled("canva"))) throw new MediaError(UNAVAILABLE_MESSAGE);
  if (!isCanvaEnabled()) throw new CanvaImportError("Canva is not set up yet.");
  try {
    const page = await withCanva(userId, (token) => listDesigns(token, { query: input.query, continuation: input.cursor }));
    return { items: page.items, nextCursor: page.continuation };
  } catch (error) {
    return canvaFailure(error);
  }
}

/** Exports page 1 of a design as a PNG (2048 px wide) and adds it to the gallery. */
export async function importCanvaDesign(ctx: Ctx, input: { designId: string; title: string; destination: string | null }): Promise<MediaItem> {
  if (!(await isServiceEnabled("canva"))) throw new MediaError(UNAVAILABLE_MESSAGE);
  if (!isCanvaEnabled()) throw new CanvaImportError("Canva is not set up yet.");
  if (!CANVA_DESIGN_ID.test(input.designId)) throw new MediaError("That design could not be imported.");
  // Exports are the slow, rate-limited part, so count the hits before starting one.
  await limitImport(ctx.userId);
  await rateLimit(`canva-export:${ctx.userId}`, { limit: 60, windowSeconds: 60 * 60 });
  let bytes: Uint8Array;
  try {
    bytes = await withCanva(ctx.userId, (token) => exportDesignPng(token, input.designId, { width: CANVA_EXPORT_WIDTH }));
  } catch (error) {
    return canvaFailure(error);
  }
  return importAsset(ctx, { bytes, name: input.title || "Canva design", destination: input.destination, source: "canva" });
}

export { hasImported };

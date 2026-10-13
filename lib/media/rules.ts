// Pure helpers for the gallery: limits, validation and object paths. No I/O, so the browser can use them too.

export const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIA_MAX_ASSETS = 500;
export const MEDIA_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
export const MEDIA_MAX_FOLDERS = 100;
/** Files asked for in one upload request; the browser sends bigger drops in several. */
export const UPLOAD_BATCH_MAX = 20;
export const MEDIA_BULK_MAX = 200;

/** Per-user limits for gallery actions, used with `rateLimit`. */
export const MEDIA_RATE = {
  uploadBatch: { limit: 60, windowSeconds: 60 * 60 },
  /** Confirming uploads (each reads the file's head, a video's boxes too). */
  finalize: { limit: 300, windowSeconds: 60 * 60 },
  edit: { limit: 300, windowSeconds: 60 * 60 },
} as const;

/**
 * Gallery videos (docs/MEDIA.md): the owner's own clips, used before anything BuPulse makes. MP4, MOV (the same file
 * family; stored and served as MP4, which the networks take) and WebM, up to 60 seconds and 50 MB (Supabase's free
 * plan refuses bigger files).
 */
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const VIDEO_MAX_MS = 60_000;
/** The first frame the browser captures as the video's poster (a small JPEG next to it). */
export const POSTER_MAX_BYTES = 400 * 1024;
export const POSTER_MAX_SIDE = 720;
/** The largest poster the server keeps (the browser makes 720 px; anything past this is not ours). */
export const POSTER_SERVER_MAX_SIDE = 1280;
/**
 * Gallery videos and their posters live in their own private bucket (50 MB a file): no Storage policy lets a browser
 * write or read there, only the server's signed upload tokens (tied to a reservation) and its signed URLs. The shared
 * "media" bucket stays at 10 MB.
 */
export const GALLERY_VIDEO_BUCKET = "gallery-videos";
/** How long a video upload's reservation (and its signed upload token's use) lasts. */
export const VIDEO_RESERVATION_MS = 2 * 60 * 60 * 1000;
/** WebM files are read at most this far for their length (MP4/MOV are probed box by box). */
export const WEBM_READ_MAX_BYTES = 8 * 1024 * 1024;
/**
 * Videos are heavy and the free storage is small (MEDIA_PLATFORM_MAX_BYTES): each company's gallery videos stop at
 * MEDIA_COMPANY_VIDEO_MAX_BYTES, 300 MB by default, inside its 2 GB.
 */
export const COMPANY_VIDEO_DEFAULT_MAX_BYTES = 300 * 1024 * 1024;

export function companyVideoMaxBytes(raw: string | undefined = process.env.MEDIA_COMPANY_VIDEO_MAX_BYTES): number {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? Math.floor(n) : COMPANY_VIDEO_DEFAULT_MAX_BYTES;
}

/** Why `adding` bytes of video would pass the company's video cap, or null when they fit. */
export function videoQuotaProblem(usedVideoBytes: number, adding: number, max = companyVideoMaxBytes()): string | null {
  return usedVideoBytes + adding > max ? `Your videos have reached their ${formatBytes(max)} of storage. Delete some videos to add more.` : null;
}

/** The file picker's types: photos and videos (".mov" too, for phones that leave the type empty). */
export const UPLOAD_ACCEPT = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm", ".mp4", ".mov", ".webm"].join(",");

export function isVideoType(type: string): boolean {
  return (VIDEO_TYPES as readonly string[]).includes(type);
}

/** The type a gallery video is stored and served as: MOV is kept as MP4 (same container family). */
export function storedVideoType(type: string): "video/mp4" | "video/webm" {
  return type === "video/webm" ? "video/webm" : "video/mp4";
}

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mp4", "video/webm": "webm" };
const MIME_BY_EXTENSION: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm" };

export const UNSUPPORTED_MESSAGE = "Use a JPG, PNG or WebP photo, or an MP4, MOV or WebM video.";
export const HEIC_MESSAGE = "iPhone HEIC photos are not supported yet. Share the photo as a JPG, or pick it from your photo library so it converts automatically.";

export function isMediaType(type: string): boolean {
  return (MEDIA_TYPES as readonly string[]).includes(type);
}

export function extensionFor(mimeType: string): string {
  return EXTENSIONS[mimeType] ?? "jpg";
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** The type to trust for a picked file: the browser's, or the extension's when the browser leaves it empty. */
export function inferMimeType(name: string, type: string): string {
  return type || MIME_BY_EXTENSION[fileExtension(name)] || "";
}

/** A friendly reason a file cannot go in the gallery, or null when it can. */
export function fileProblem(file: { name: string; type: string; size: number }): string | null {
  const type = inferMimeType(file.name, file.type);
  if (/^image\/hei[cf]/.test(type) || ["heic", "heif"].includes(fileExtension(file.name))) return `${file.name}: ${HEIC_MESSAGE}`;
  if (isVideoType(type)) {
    if (!(file.size > 0)) return `${file.name} is empty.`;
    if (file.size > VIDEO_MAX_BYTES) return `${file.name} is over 50 MB. Please use a shorter or smaller video.`;
    return null;
  }
  if (!isMediaType(type)) return `${file.name}: ${UNSUPPORTED_MESSAGE}`;
  if (!(file.size > 0)) return `${file.name} is empty.`;
  if (file.size > MEDIA_MAX_BYTES) return `${file.name} is over 10 MB. Please use a smaller photo.`;
  return null;
}

/** Where a gallery photo lives (the "media" bucket), or a gallery video (`<userId>/clips/`, the gallery-videos bucket). */
export function galleryPath(userId: string, assetId: string, mimeType: string): string {
  return `${userId}/${isVideoType(mimeType) ? "clips" : "gallery"}/${assetId}.${extensionFor(mimeType)}`;
}

/** A gallery video's poster: `<assetId>-poster.jpg` next to it. */
export function posterPathFor(videoPath: string): string {
  return videoPath.replace(/\.[a-z0-9]+$/i, "-poster.jpg");
}

const GALLERY_FILE = /^[A-Za-z0-9-]{8,64}\.(jpg|png|webp)$/;
const GALLERY_VIDEO_FILE = /^[A-Za-z0-9-]{8,64}\.(mp4|webm)$/;

function inOwnFolder(userId: string, path: string, folder: string, file: RegExp): boolean {
  if (!userId || typeof path !== "string" || path.length > 300) return false;
  const prefix = `${userId}/${folder}/`;
  return path.startsWith(prefix) && file.test(path.slice(prefix.length)) && !path.endsWith("-poster.jpg");
}

/** A gallery photo path that belongs to the user: `<userId>/gallery/<assetId>.<jpg|png|webp>`, nothing else (no video, no poster). */
export function isOwnGalleryPath(userId: string, path: string): boolean {
  return inOwnFolder(userId, path, "gallery", GALLERY_FILE);
}

/** A gallery video path that belongs to the user: `<userId>/clips/<assetId>.<mp4|webm>` (gallery-videos bucket). */
export function isOwnGalleryVideoPath(userId: string, path: string): boolean {
  return inOwnFolder(userId, path, "clips", GALLERY_VIDEO_FILE);
}

/** A gallery video or its poster: the second path segment is "clips". */
export function isClipPath(path: string): boolean {
  return path.split("/")[1] === "clips";
}

export function isGalleryVideoPath(path: string): boolean {
  return /\.(mp4|webm)$/i.test(path);
}

export function assetIdFromPath(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
}

export function mimeFromPath(path: string): string {
  return MIME_BY_EXTENSION[fileExtension(path)] ?? "image/jpeg";
}

export type MediaUsage = { count: number; bytes: number };

/** Why `add` would not fit in the business's quota, or null when it fits. */
export function quotaProblem(current: MediaUsage, add: MediaUsage): string | null {
  if (current.count + add.count > MEDIA_MAX_ASSETS) {
    return `Your gallery is full: it holds up to ${MEDIA_MAX_ASSETS} photos. Delete some to add more.`;
  }
  if (current.bytes + add.bytes > MEDIA_MAX_TOTAL_BYTES) {
    return "Your gallery is out of space (2 GB). Delete some photos to add more.";
  }
  return null;
}

export function folderNameProblem(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "Give the folder a name.";
  if (name.length > 60) return "Keep the folder name under 60 characters.";
  if (/[\u0000-\u001f]/.test(name)) return "That name has characters we cannot use.";
  return null;
}

/** A photo's display name: trimmed, control characters removed, at most 120 characters. */
export function cleanPhotoName(raw: string, fallback = "Photo"): string {
  const name = raw.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return name || fallback;
}

/** "Summer party 3.JPG" becomes "Summer party 3". */
export function nameFromFile(fileName: string): string {
  return cleanPhotoName(fileName.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_-]+/g, " "));
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The image type a file's first bytes show, or null when it is not a JPEG, PNG or WebP. */
export function sniffMediaType(bytes: Uint8Array): (typeof MEDIA_TYPES)[number] | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/** Photos wider or taller than this are scaled down in the browser before upload. */
export const UPLOAD_MAX_SIDE = 2048;

/** The size to scale to so the long side is at most `max`; the same size when it already fits. */
export function scaledSize(width: number, height: number, max = UPLOAD_MAX_SIDE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const k = max / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** A video's type from its first bytes: an ISO media file ("ftyp": MP4, or MOV with the "qt  " brand) or WebM (EBML). */
export function sniffVideoType(bytes: Uint8Array): "video/mp4" | "video/quicktime" | "video/webm" | null {
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp") return String.fromCharCode(...bytes.subarray(8, 12)) === "qt  " ? "video/quicktime" : "video/mp4";
  // Older QuickTime files may start with another top-level atom (wide, mdat, moov, free).
  if (bytes.length >= 8 && ["moov", "mdat", "wide", "free", "skip"].includes(String.fromCharCode(...bytes.subarray(4, 8)))) return "video/quicktime";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  return null;
}

/** Portrait, square or landscape, from a width and height (null when unknown). */
export function aspectOf(width: number | null | undefined, height: number | null | undefined): "portrait" | "square" | "landscape" | null {
  if (!width || !height) return null;
  const r = width / height;
  return r < 0.9 ? "portrait" : r > 1.1 ? "landscape" : "square";
}

export function formatDuration(ms: number | null | undefined): string {
  const s = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Per-user limit for server-side imports (Google Drive, Dropbox, Canva): one hit per file. */
export const IMPORT_RATE = { limit: 200, windowSeconds: 60 * 60 } as const;
/** Files taken in one Import: the browser sends them to the server one at a time. */
export const IMPORT_MAX_FILES = 20;
export type ImportSource = "google_drive" | "dropbox" | "canva";

/** Width and height read from a JPEG, PNG or WebP header, or null when they cannot be found. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = sniffMediaType(bytes);
  try {
    if (type === "image/png" && bytes.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) };
    if (type === "image/webp" && bytes.length >= 30) {
      const kind = String.fromCharCode(...bytes.subarray(12, 16));
      if (kind === "VP8X") return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
      if (kind === "VP8L") {
        const bits = view.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (kind === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (type === "image/jpeg") {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return null;
        const marker = bytes[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
        i += 2 + view.getUint16(i + 2);
      }
    }
  } catch {}
  return null;
}

/**
 * `MediaAsset.source` of the photos the Knowledge base migration copied from old projects. They were already stored
 * before the gallery quota knew about them, so they never count toward a company's 500 photos / 2 GB.
 */
export const MIGRATED_SOURCE = "project-migration";
/** `MediaAsset.source` of photos copied from a Shopify or WooCommerce store. They count, like uploads. */
export const STORE_SOURCE = "store";

/** The Prisma filter for the photos that count toward a company's quota (null sources are uploads). */
export const COUNTED = { OR: [{ source: null }, { source: { not: MIGRATED_SOURCE } }] };

/**
 * All companies share one Storage project (Supabase free plan: 1 GB in total), so new photos stop before it is full.
 * MEDIA_PLATFORM_MAX_BYTES sets the cap; 900 MB by default. The admin is warned from 80%.
 */
export const PLATFORM_DEFAULT_MAX_BYTES = 900 * 1024 * 1024;
export const PLATFORM_WARN_RATIO = 0.8;
export const PLATFORM_FULL_MESSAGE = "BuPulse's photo storage is full right now, so new photos cannot be added. We have been told and are making room. Please try again later.";

export function platformMaxBytes(raw: string | undefined = process.env.MEDIA_PLATFORM_MAX_BYTES): number {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? Math.floor(n) : PLATFORM_DEFAULT_MAX_BYTES;
}

/** Why `adding` bytes would not fit in the shared storage, or null when they fit. */
export function platformProblem(usedBytes: number, adding: number, max = platformMaxBytes()): string | null {
  return usedBytes + adding > max ? PLATFORM_FULL_MESSAGE : null;
}

/** Whether the shared storage is past the warning line (80%). */
export function platformNearlyFull(usedBytes: number, max = platformMaxBytes()): boolean {
  return usedBytes >= max * PLATFORM_WARN_RATIO;
}

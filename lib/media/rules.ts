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
  edit: { limit: 300, windowSeconds: 60 * 60 },
} as const;

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MIME_BY_EXTENSION: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export const UNSUPPORTED_MESSAGE = "Use a JPG, PNG or WebP photo.";
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
  if (!isMediaType(type)) return `${file.name}: ${UNSUPPORTED_MESSAGE}`;
  if (!(file.size > 0)) return `${file.name} is empty.`;
  if (file.size > MEDIA_MAX_BYTES) return `${file.name} is over 10 MB. Please use a smaller photo.`;
  return null;
}

/** Where a gallery photo lives in the private "media" bucket. */
export function galleryPath(userId: string, assetId: string, mimeType: string): string {
  return `${userId}/gallery/${assetId}.${extensionFor(mimeType)}`;
}

const GALLERY_FILE = /^[A-Za-z0-9-]{8,64}\.(jpg|png|webp)$/;

/** A gallery object path that belongs to the user: `<userId>/gallery/<assetId>.<ext>`, nothing else. */
export function isOwnGalleryPath(userId: string, path: string): boolean {
  if (!userId || typeof path !== "string" || path.length > 300) return false;
  const prefix = `${userId}/gallery/`;
  return path.startsWith(prefix) && GALLERY_FILE.test(path.slice(prefix.length));
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

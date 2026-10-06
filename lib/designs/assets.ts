// Pure helpers for design files: paths, data URLs and image sizes. No I/O.
import { ASPECT_SIZES, type AspectRatio } from "./layout";

/** A media/brand object path that belongs to the user: `<userId>/...`, no traversal. */
export function isOwnObjectPath(userId: string, path: string): boolean {
  if (!path || path.length > 500 || path.includes("..") || path.includes("\\") || path.startsWith("/")) return false;
  return path.startsWith(`${userId}/`) && path.length > userId.length + 1;
}

/** A project photo in the media bucket: `<userId>/projects/...`. */
export function isOwnProjectPhotoPath(userId: string, path: string): boolean {
  return isOwnObjectPath(userId, path) && path.startsWith(`${userId}/projects/`);
}

/** Where a design file lives in the private "designs" bucket. */
export function designObjectPath(userId: string, designId: string, mimeType: string): string {
  const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  return `${userId}/designs/${designId}.${ext}`;
}

export function isOwnDesignPath(userId: string, path: string): boolean {
  return isOwnObjectPath(userId, path) && path.startsWith(`${userId}/designs/`);
}

export function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/** Reads width and height from PNG or JPEG bytes; falls back to the ratio's standard size. */
export function imageSize(bytes: Uint8Array, fallback: AspectRatio): { width: number; height: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) return { width: dv.getUint32(16), height: dv.getUint32(20) };
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) break;
        const marker = bytes[i + 1];
        const length = dv.getUint16(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
        i += 2 + length;
      }
    }
  } catch {}
  return ASPECT_SIZES[fallback];
}

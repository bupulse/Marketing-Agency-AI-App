// Profile and background photos in B Mail (design "Welcome" and "Settings"). The browser makes them small first
// (profile: a 256 px square, about 60 KB; background: up to 1920 px wide, about 300 KB); the server checks again.
// Pure: the actions and the tests share it.

export const PROFILE_MAX_BYTES = 200 * 1024;
export const BACKGROUND_MAX_BYTES = 900 * 1024;

/** The real type of an image from its first bytes (never trust the browser's label): jpeg, png or webp, else null. */
export function imageKind(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export function photoProblem(b: Uint8Array, max: number): string | null {
  if (!b.length) return "Choose a photo first.";
  if (b.length > max) return "That photo is too big. Try a smaller one.";
  if (!imageKind(b)) return "Use a JPG, PNG or WebP photo.";
  return null;
}

/** The public link to a person's photo (also used in signatures, so Gmail and others can show it). */
export const photoUrl = (memberId: string, photoPath: string | null | undefined, origin = "") =>
  photoPath ? `${origin}/api/mail/photo/${memberId}?v=${encodeURIComponent(photoPath.split("-").pop()?.replace(/\.\w+$/, "") ?? "1")}` : null;

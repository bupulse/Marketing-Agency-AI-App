// What the visitor may attach (UPLOAD_LIMITS, checked again by the server) and how photos are shrunk in the browser
// before upload, so a 4 MB phone photo goes out as a few hundred KB on a slow connection.
import { UPLOAD_LIMITS } from "../contract";
import { COPY } from "./copy";

export type UploadKind = "image" | "file" | "voice";

/** The bare type: "audio/webm;codecs=opus" → "audio/webm". */
export const bareMime = (mime: string) => mime.split(";")[0].trim().toLowerCase();

/** iPhone photos: not accepted as they are, but the browser can usually redraw them as JPEG. */
export const CONVERTIBLE_IMAGE = ["image/heic", "image/heif"];

export function uploadKind(mime: string): UploadKind | null {
  const m = bareMime(mime);
  if ((UPLOAD_LIMITS.imageMime as readonly string[]).includes(m)) return "image";
  if ((UPLOAD_LIMITS.fileMime as readonly string[]).includes(m)) return "file";
  if ((UPLOAD_LIMITS.voiceMime as readonly string[]).includes(m)) return "voice";
  return null;
}

export type UploadCheck = { ok: true; kind: UploadKind } | { ok: false; error: string };

/** Checks a file before anything is sent. Images may be over the limit here: shrinking comes first (checkShrunk). */
export function checkUpload(file: { type: string; size: number }): UploadCheck {
  const m = bareMime(file.type);
  const kind = uploadKind(m) ?? (CONVERTIBLE_IMAGE.includes(m) ? "image" : null);
  if (!kind || kind === "voice") return { ok: false, error: COPY.badType };
  if (file.size <= 0) return { ok: false, error: COPY.badType };
  if (kind !== "image" && file.size > UPLOAD_LIMITS.maxBytes) return { ok: false, error: COPY.tooBig };
  return { ok: true, kind };
}

/** The final check, after shrinking (or for a voice note): accepted type and at most 10 MB. */
export function checkFinal(file: { type: string; size: number }): UploadCheck {
  const kind = uploadKind(file.type);
  if (!kind) return { ok: false, error: COPY.badType };
  if (file.size <= 0 || file.size > UPLOAD_LIMITS.maxBytes) return { ok: false, error: COPY.tooBig };
  return { ok: true, kind };
}

/** Longest side of a shrunk photo: enough to read a screenshot, small enough for a phone connection. */
export const SHRINK_MAX_EDGE = 1600;
export const SHRINK_QUALITY = 0.85;
/** Photos already small enough (both sides and bytes) are sent as they are. */
export const SHRINK_SKIP_BYTES = 700 * 1024;

/** The size to draw a photo at: the same shape, never larger than the original, the longest side at most maxEdge. */
export function shrinkSize(width: number, height: number, maxEdge = SHRINK_MAX_EDGE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Whether a photo needs redrawing at all. */
export function needsShrink(file: { type: string; size: number }, width: number, height: number, maxEdge = SHRINK_MAX_EDGE): boolean {
  if (CONVERTIBLE_IMAGE.includes(bareMime(file.type))) return true;
  return Math.max(width, height) > maxEdge || file.size > SHRINK_SKIP_BYTES;
}

/** "momo-receipt.jpg · 240 KB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "0:09", "1:45" */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The recording type the browser can make, best first: Chrome and Firefox make webm/opus, Safari mp4. */
export const VOICE_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4", "audio/mpeg"];

export function pickVoiceType(isSupported: (type: string) => boolean): string | null {
  return VOICE_TYPES.find((t) => isSupported(t)) ?? null;
}

/** Bar heights (0..1) for a voice note bubble: always the same for the same note, so it does not jump on re-render. */
export function waveform(seed: string, bars = 16): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const v = ((h >>> 0) % 1000) / 1000;
    // Lower at both ends, like speech fading in and out.
    const edge = Math.sin((Math.PI * (i + 0.5)) / bars);
    out.push(Math.max(0.12, Math.min(1, 0.25 + v * 0.75 * edge)));
  }
  return out;
}

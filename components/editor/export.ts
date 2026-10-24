// Makes the MP4 of a spec in this browser (the same encoder as the Videos page). Client only.
import type { MotionSpec } from "@/lib/video-engine/spec";

/** The words for a problem while making the video, for the owner. */
export function exportProblem(error: unknown): string {
  const message = (error as Error)?.message || "";
  if (message === "Cancelled") return "Export cancelled.";
  if (/Chrome or Edge/.test(message)) return message;
  return "The video could not be made. If this page has been open for an hour, open the reel again: the clips' links expire. Then try again.";
}

export async function exportMp4(spec: MotionSpec, musicUrl: string | null, opts: { signal?: AbortSignal; onProgress?: (percent: number) => void } = {}): Promise<Blob> {
  const { encodeSpecMp4, loadSpecFonts } = await import("@/lib/video-engine/encode");
  await loadSpecFonts(spec).catch(() => undefined);
  return encodeSpecMp4(spec, new Map(), { musicUrl, quality: "720p", signal: opts.signal, onProgress: (f) => opts.onProgress?.(Math.round(f * 100)) });
}

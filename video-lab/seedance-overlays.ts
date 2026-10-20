// Video Studio: "Add BuPulse text" on a finished Seedance clip (docs/VIDEO_ENGINE.md, "Seedance overlay"). The clip comes
// back with clean frames, so BuPulse draws the hook, the price, the phone bar and the call to action on top: the
// overlay is a MotionSpec with the clip as its video layer (lib/video-engine/seedance-overlay.ts), encoded in the browser
// like a Motion video and kept as the job's "with text" MP4. Free (browser time). Kept next to the Seedance jobs, in
// video-lab/data/seedance/overlays/<job id>.json and <job id>-text.mp4; seedance-jobs.ts is not changed.
import fs from "node:fs/promises";
import path from "node:path";
import type { MotionSpec } from "@/lib/video-engine/spec";

const DIR = path.resolve("video-lab/data/seedance/overlays");
const safe = (id: string) => /^sd-[0-9a-f]{12}$/.test(id);

export type SeedanceOverlay = {
  jobId: string;
  createdAt: string;
  spec: MotionSpec;
  /** The clip under the text: the job's own MP4, or a stand-in while Seedance is in preview (no clip yet). */
  clipUrl: string;
  standIn: boolean;
  captionScore: number;
  captionMissed: string[];
  video: { bytes: number; savedAt: string; quality: string } | null;
};

export async function getOverlay(jobId: string): Promise<SeedanceOverlay | null> {
  if (!safe(jobId)) return null;
  return fs
    .readFile(path.join(DIR, `${jobId}.json`), "utf8")
    .then((t) => JSON.parse(t) as SeedanceOverlay)
    .catch(() => null);
}

export async function saveOverlay(o: SeedanceOverlay): Promise<void> {
  if (!safe(o.jobId)) throw new Error("Bad job id");
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, `${o.jobId}.json`), JSON.stringify(o, null, 2));
}

export const overlayVideoPath = (jobId: string) => path.join(DIR, `${jobId}-text.mp4`);

export async function saveOverlayVideo(jobId: string, bytes: Buffer): Promise<void> {
  if (!safe(jobId)) throw new Error("Bad job id");
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(overlayVideoPath(jobId), bytes);
}

export async function overlayVideoBytes(jobId: string): Promise<Buffer | null> {
  if (!safe(jobId)) return null;
  return fs.readFile(overlayVideoPath(jobId)).catch(() => null);
}

/** The tracks of an MP4 by their handler type ("vide", "soun"), read from its hdlr boxes. */
export function mp4Tracks(bytes: Buffer): string[] {
  const tracks: string[] = [];
  for (let i = bytes.indexOf("hdlr"); i > 0; i = bytes.indexOf("hdlr", i + 4)) {
    const kind = bytes.toString("latin1", i + 12, i + 16);
    if (kind === "vide" || kind === "soun") tracks.push(kind);
  }
  return tracks;
}

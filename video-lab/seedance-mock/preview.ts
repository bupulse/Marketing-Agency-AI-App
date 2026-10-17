// Seedance preview helpers (docs/VIDEO_ENGINE.md, "Preview mode"): the small reference photos a storyboard shows and
// how long a preview "renders" (3 to 8 s, fixed per job so a reload shows the same thing). The job itself lives in
// video-lab/seedance-jobs.ts next to the real ones.
import sharp from "sharp";
import type { SeedanceReference } from "@/lib/video-engine/seedance";

export const PREVIEW_MIN_MS = 3000;
export const PREVIEW_MAX_MS = 8000;

/** 3 to 8 seconds, from the job id (the same id always waits the same time). */
export function previewDelayMs(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PREVIEW_MIN_MS + (h % (PREVIEW_MAX_MS - PREVIEW_MIN_MS + 1));
}

/** Small JPEG data URLs (at most 240 px) of the image references, in order; null for one that cannot be read. */
export async function previewThumbs(references: SeedanceReference[]): Promise<(string | null)[]> {
  const images = references.filter((r) => r.kind === "image");
  return Promise.all(
    images.map(async (r) => {
      const m = r.url.match(/^data:image\/[a-z+.-]+;base64,(.+)$/i);
      if (!m) return null;
      try {
        const out = await sharp(Buffer.from(m[1], "base64")).rotate().resize({ width: 240, height: 240, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 62 }).toBuffer();
        return `data:image/jpeg;base64,${out.toString("base64")}`;
      } catch {
        return null;
      }
    }),
  );
}

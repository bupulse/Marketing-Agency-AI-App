// "Upload a video" on the Videos page (lib/video-library/upload.ts): pure rules, no I/O, so the browser uses them too.
// An uploaded video is a Gallery video (lib/media/rules.ts: MP4, MOV or WebM, up to 60 seconds and 50 MB, inside the
// company's video storage cap) in the Gallery's "Uploaded videos" folder, with a VideoJob of engine "upload" so it is
// in the Videos library like a studio video: watched, downloaded, scheduled and deleted there. It uses no credits.

/** VideoJob.engine of an uploaded video (engine is a plain string column: no migration). */
export const UPLOAD_ENGINE = "upload";
/** The Gallery folder uploaded videos go to, made the first time. */
export const UPLOAD_FOLDER = "Uploaded videos";
/** Videos picked in one go (each is up to 50 MB; the company's video cap stops most companies well before this). */
export const UPLOAD_PICK_MAX = 10;
/** A title (it is also the video's caption). */
export const UPLOAD_TITLE_MAX = 200;
/** The file picker: the Gallery's video types (".mov" too, for phones that leave the type empty). */
export const VIDEO_ACCEPT = ["video/mp4", "video/quicktime", "video/webm", ".mp4", ".mov", ".webm"].join(",");

/** The library's ratios (the card's frame shapes). */
export const LIBRARY_RATIOS = ["9:16", "4:5", "1:1", "16:9"] as const;
export type LibraryRatio = (typeof LIBRARY_RATIOS)[number];
const VALUE: Record<LibraryRatio, number> = { "9:16": 9 / 16, "4:5": 4 / 5, "1:1": 1, "16:9": 16 / 9 };

/** The library ratio closest to a video's shape; 9:16 (a phone video) when its size is unknown. */
export function ratioFor(width: number | null | undefined, height: number | null | undefined): LibraryRatio {
  if (!width || !height || width <= 0 || height <= 0) return "9:16";
  const r = Math.log(width / height);
  return LIBRARY_RATIOS.reduce((best, k) => (Math.abs(Math.log(VALUE[k]) - r) < Math.abs(Math.log(VALUE[best]) - r) ? k : best), "9:16" as LibraryRatio);
}

/** A title from a file name: no extension, dashes and underscores as spaces ("leaf-ad_v2.mp4" → "leaf ad v2"). */
export function titleFromFile(name: string): string {
  return name
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, UPLOAD_TITLE_MAX);
}

/** The card's title for an uploaded video: its caption's first line (shortened), else "Uploaded video". */
export function uploadTitle(caption: string): string {
  const line = caption.split("\n").find((l) => l.trim())?.trim() ?? "";
  if (!line) return "Uploaded video";
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

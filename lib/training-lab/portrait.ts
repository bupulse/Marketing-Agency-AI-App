// A portrait taken from an actor's video (docs/TRAINING_LAB.md, task 13): the size of the still and the file the browser
// sends. Shared by the Library's button and the server. Pure.

export const PORTRAIT_MAX_SIDE = 1600;
export const PORTRAIT_QUALITY = 0.9;

/** The still's size: the video's own, scaled down so the longest side is at most 1600 px (never scaled up). */
export function portraitSize(width: number, height: number, max = PORTRAIT_MAX_SIDE): { width: number; height: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** The moment in the video, to a tenth of a second. */
export const momentOf = (seconds: number) => Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 10) / 10);

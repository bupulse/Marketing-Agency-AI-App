import { extractColors } from "./colors";

const SAMPLE_SIZE = 64;

/** Browser only: draws the image small on a canvas and returns its main colours. Returns [] if it cannot be read. */
export async function extractColorsFromFile(file: File): Promise<string[]> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || SAMPLE_SIZE;
    const h = img.naturalHeight || SAMPLE_SIZE;
    const scale = Math.min(1, SAMPLE_SIZE / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return extractColors(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  } catch {
    return [];
  } finally {
    URL.revokeObjectURL(url);
  }
}

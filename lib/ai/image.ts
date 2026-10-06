import "server-only";
import { GeminiImageProvider } from "./gemini-image";
import type { ImageProvider } from "./types";

let imageProvider: ImageProvider | undefined;

// GEMINI_IMAGE_MODEL picks the model (default "gemini-2.5-flash-image"); GEMINI_API_KEY is shared with text.
export function getImageProvider(): ImageProvider {
  if (imageProvider) return imageProvider;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set (see .env.example)");
  imageProvider = new GeminiImageProvider(apiKey, process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image");
  return imageProvider;
}

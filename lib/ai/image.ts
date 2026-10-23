import "server-only";
import { DEFAULT_GEMINI_IMAGE_MODEL, GeminiImageProvider } from "./gemini-image";
import type { ImageProvider } from "./types";

const imageProviders = new Map<string, ImageProvider>();

// GEMINI_IMAGE_MODEL picks the default model (DEFAULT_GEMINI_IMAGE_MODEL); the image engine asks for its tier's model
// (lib/image-engine/painter.ts: Lite or Pro). GEMINI_API_KEY is shared with text.
export function getImageProvider(model?: string): ImageProvider {
  const id = model ?? process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_GEMINI_IMAGE_MODEL;
  const known = imageProviders.get(id);
  if (known) return known;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set (see .env.example)");
  const provider = new GeminiImageProvider(apiKey, id);
  imageProviders.set(id, provider);
  return provider;
}

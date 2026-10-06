import "server-only";
import { GoogleGenAI, type Part } from "@google/genai";
import { AIProviderError, type ImageProvider, type ImageRequest, type ImageResult } from "./types";

const MAX_REFERENCE_BYTES = 6 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A reference image as an inline part: data URLs are decoded, http(s) URLs (signed) are fetched. */
async function referencePart(url: string): Promise<Part> {
  const data = /^data:([^;,]+);base64,([\s\S]*)$/.exec(url);
  if (data) return { inlineData: { mimeType: data[1], data: data[2] } };
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`reference image fetch failed (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_REFERENCE_BYTES) throw new Error("reference image too large");
  return { inlineData: { mimeType: res.headers.get("content-type")?.split(";")[0] || "image/png", data: toBase64(bytes) } };
}

/** Gemini image model ("Nano Banana"): text, plus optional reference images, in; one image out. */
export class GeminiImageProvider implements ImageProvider {
  readonly name = "gemini";
  private ai: GoogleGenAI;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generate({ prompt, referenceImageUrls = [], aspectRatio }: ImageRequest): Promise<ImageResult> {
    let references: Part[];
    try {
      references = await Promise.all(referenceImageUrls.map(referencePart));
    } catch {
      // A broken reference should not cost the user an image; the design is still made from the prompt.
      references = [];
    }

    let response;
    try {
      response = await this.ai.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts: [...references, { text: prompt }] }],
        config: {
          responseModalities: ["IMAGE"],
          ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
        },
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      throw new AIProviderError(
        `Gemini image request failed${status ? ` (${status})` : ""}`,
        this.name,
        status === 429 || (status !== undefined && status >= 500),
      );
    }

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const image = parts.find((part) => part.inlineData?.data && part.inlineData.mimeType?.startsWith("image/"));
    if (!image?.inlineData?.data) {
      const reason = response.promptFeedback?.blockReason ?? response.candidates?.[0]?.finishReason;
      throw new AIProviderError(`Gemini returned no image${reason ? ` (${reason})` : ""}`, this.name);
    }

    const meta = response.usageMetadata;
    return {
      data: fromBase64(image.inlineData.data),
      mimeType: image.inlineData.mimeType ?? "image/png",
      provider: this.name,
      model: this.model,
      usage: {
        inputTokens: meta?.promptTokenCount ?? 0,
        // Generated images are billed as output tokens.
        outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
      },
    };
  }
}

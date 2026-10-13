import "server-only";
import { createInteraction, type Interaction } from "./gemini-rest";
import { AIProviderError, type ImageProvider, type ImageRequest, type ImageResult } from "./types";

const MAX_REFERENCE_BYTES = 6 * 1024 * 1024;

export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";

type ImageInput = { type: "image"; data: string; mime_type: string };

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
async function referencePart(url: string): Promise<ImageInput> {
  const data = /^data:([^;,]+);base64,([\s\S]*)$/.exec(url);
  if (data) return { type: "image", mime_type: data[1], data: data[2] };
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`reference image fetch failed (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_REFERENCE_BYTES) throw new Error("reference image too large");
  return { type: "image", mime_type: res.headers.get("content-type")?.split(";")[0] || "image/png", data: toBase64(bytes) };
}

/** Gemini image model ("Nano Banana"): text, plus optional reference images, in; one image out. */
export class GeminiImageProvider implements ImageProvider {
  readonly name = "gemini";

  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async generate({ prompt, referenceImageUrls = [], aspectRatio }: ImageRequest): Promise<ImageResult> {
    let references: ImageInput[];
    try {
      references = await Promise.all(referenceImageUrls.map(referencePart));
    } catch {
      // A broken reference should not cost the user an image; the design is still made from the prompt.
      references = [];
    }

    let interaction: Interaction;
    try {
      interaction = await createInteraction(
        this.apiKey,
        {
          model: this.model,
          input: [...references, { type: "text", text: prompt }],
          store: false,
          response_format: { type: "image", ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}) },
        },
        // One attempt may take up to 120 s: RENDER_LEASE_MS in lib/visuals/service.ts covers it.
        120_000,
      );
    } catch (error) {
      const status = (error as { status?: number }).status;
      throw new AIProviderError(
        `Gemini image request failed${status ? ` (${status})` : ""}`,
        this.name,
        status === 429 || (status !== undefined && status >= 500),
        undefined,
        this.model,
      );
    }

    const usage = {
      inputTokens: interaction.usage?.total_input_tokens ?? 0,
      // Generated images are billed as output tokens.
      outputTokens: (interaction.usage?.total_output_tokens ?? 0) + (interaction.usage?.total_thought_tokens ?? 0),
    };
    const image = (interaction.steps ?? [])
      .flatMap((step) => (step.type === "model_output" ? (step.content ?? []) : []))
      .find((content) => content.type === "image" && content.data);
    if (!image || image.type !== "image" || !image.data) {
      throw new AIProviderError(`Gemini returned no image (${interaction.status})`, this.name, false, usage, this.model);
    }

    return {
      data: fromBase64(image.data),
      mimeType: image.mime_type ?? "image/png",
      provider: this.name,
      model: this.model,
      usage,
    };
  }
}

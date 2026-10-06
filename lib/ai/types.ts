// Provider interfaces. Feature code depends only on these, never on a vendor SDK,
// so providers can be swapped with an environment variable.

export interface TextRequest {
  system: string;
  prompt: string;
  /** When set, the provider must return JSON matching this JSON Schema. */
  jsonSchema?: Record<string, unknown>;
}

export interface TextResult {
  text: string;
  provider: string;
  model: string;
}

export interface TextProvider {
  readonly name: string;
  generate(request: TextRequest): Promise<TextResult>;
}

export interface ImageRequest {
  prompt: string;
  /** Optional reference images (e.g. the business's logo or product photos). */
  referenceImageUrls?: string[];
  aspectRatio?: "1:1" | "4:5" | "9:16" | "16:9";
}

export interface ImageResult {
  /** PNG/JPEG bytes; the caller decides where to store them. */
  data: Uint8Array;
  mimeType: string;
  provider: string;
  model: string;
}

export interface ImageProvider {
  readonly name: string;
  generate(request: ImageRequest): Promise<ImageResult>;
}

// ---- Phase 2 (interfaces only for now) ----

export interface VideoRequest {
  prompt: string;
  imageUrls: string[];
  durationSeconds: number;
  aspectRatio?: "9:16" | "16:9" | "1:1";
}

export interface VideoJob {
  /** Video generation is slow; providers return a job to poll. */
  jobId: string;
  provider: string;
}

export interface VideoStatus {
  state: "pending" | "done" | "failed";
  videoUrl?: string;
  error?: string;
}

export interface VideoProvider {
  readonly name: string;
  start(request: VideoRequest): Promise<VideoJob>;
  status(jobId: string): Promise<VideoStatus>;
}

export interface Voice {
  id: string;
  name: string;
  previewUrl?: string;
  labels?: Record<string, string>;
}

export interface VoiceProvider {
  readonly name: string;
  listVoices(): Promise<Voice[]>;
  /** Returns MP3 bytes. Usage is billed per character of `text`. */
  speak(text: string, voiceId: string): Promise<Uint8Array>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    public provider: string,
    public retryable = false,
  ) {
    super(message);
  }
}

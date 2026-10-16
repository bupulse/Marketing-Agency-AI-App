// Seedance (BytePlus ModelArk) video generation (docs/VIDEO_ENGINE.md, "Seedance"): the real-video engine, for moving
// people and real footage. Owner decision 17 October 2026: BytePlus direct (prepaid pack), Seedance 2.0 series.
// Facts from the BytePlus docs read on 16 October 2026 (docs/research/VIDEO_COMPETITORS_TEARDOWN.md):
// - POST {base}/contents/generations/tasks -> { id }; GET {base}/contents/generations/tasks/{id} -> status queued |
//   running | succeeded | failed | expired, content.video_url (valid 24 hours), usage.completion_tokens;
//   DELETE cancels a queued task.
// - content: text, image_url (role first_frame | last_frame | reference_image), video_url (reference_video),
//   audio_url (reference_audio); images 1-9, videos 0-3, audio 0-3; prompts refer to "Image 1", "Video 2"...
// - ratio 21:9 16:9 4:3 1:1 3:4 9:16 adaptive; duration 4-15 s; resolution 480p 720p 1080p (4k on 2.0 only);
//   generate_audio, camera_fixed, seed, watermark, service_tier "flex" (slow, cheaper), draft (480p preview).
// - No real human faces in reference images or videos: use the digital character library (asset://<id>) instead.
// Server-side; no app imports, so the Video Lab can run it outside Next.js. The key never leaves process.env here.
import { estimateCostUsd } from "@/lib/ai/pricing";

export const SEEDANCE_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";

export const SEEDANCE_MODELS = {
  pro: { id: "dreamina-seedance-2-0-260128", name: "Seedance 2.0", blurb: "Highest quality; 4K possible", resolutions: ["480p", "720p", "1080p"] },
  fast: { id: "dreamina-seedance-2-0-fast-260128", name: "Seedance 2.0 Fast", blurb: "Quicker and cheaper", resolutions: ["480p", "720p"] },
  mini: { id: "dreamina-seedance-2-0-mini-260615", name: "Seedance 2.0 Mini", blurb: "Best value", resolutions: ["480p", "720p"] },
} as const;
export type SeedanceTier = keyof typeof SEEDANCE_MODELS;
export const SEEDANCE_RATIOS = ["9:16", "3:4", "1:1", "4:3", "16:9", "21:9", "adaptive"] as const;
export type SeedanceRatio = (typeof SEEDANCE_RATIOS)[number];
export const SEEDANCE_RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export type SeedanceResolution = (typeof SEEDANCE_RESOLUTIONS)[number];
export const SEEDANCE_LIMITS = { minSeconds: 4, maxSeconds: 15, maxImages: 9, maxVideos: 3, maxAudio: 3 } as const;

/**
 * Cost estimates in USD per output second, before BytePlus reports the tokens (then the real tokens are priced).
 * From public price pages read on 16 October 2026 (about $0.07/s at 480p, $0.15/s at 720p, $0.37/s at 1080p for
 * Seedance 2.0; Fast about 20% less; Mini about half). Estimates until the first BytePlus invoice is compared.
 */
export const SEEDANCE_USD_PER_SECOND: Record<SeedanceTier, Record<SeedanceResolution, number>> = {
  pro: { "480p": 0.07, "720p": 0.15, "1080p": 0.37 },
  fast: { "480p": 0.056, "720p": 0.12, "1080p": 0.3 },
  mini: { "480p": 0.035, "720p": 0.075, "1080p": 0.19 },
};
/** USD per million output tokens, used to price the real usage BytePlus reports (SEEDANCE_USD_PER_M_TOKENS to adjust). */
export const seedanceTokenRate = () => Number(process.env.SEEDANCE_USD_PER_M_TOKENS) || 7;

export type SeedanceReference = { kind: "image" | "video" | "audio"; url: string; role?: "first_frame" | "last_frame" | "reference_image" | "reference_video" | "reference_audio" };

export type SeedanceRequest = {
  tier: SeedanceTier;
  prompt: string;
  references: SeedanceReference[];
  ratio: SeedanceRatio;
  seconds: number;
  resolution: SeedanceResolution;
  audio: boolean;
  fixedLens: boolean;
  seed?: number | null;
  watermark?: boolean;
  /** "flex": offline, slower and cheaper; default online. */
  flex?: boolean;
  draft?: boolean;
};

export type SeedanceTask = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "expired";
  videoUrl: string | null;
  tokens: number;
  costUsd: number;
  seed: number | null;
  resolution: string | null;
  ratio: string | null;
  seconds: number | null;
  error: string | null;
};

export class SeedanceError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message);
    this.name = "SeedanceError";
  }
}

export const estimateSeedanceUsd = (r: Pick<SeedanceRequest, "tier" | "resolution" | "seconds">) => Math.round(SEEDANCE_USD_PER_SECOND[r.tier][r.resolution] * r.seconds * 1000) / 1000;

/** Builds the BytePlus request body. References keep their order: the prompt says "Image 1", "Video 1"... */
export function seedanceBody(r: SeedanceRequest): Record<string, unknown> {
  const content: Record<string, unknown>[] = [{ type: "text", text: r.prompt.slice(0, 4000) }];
  for (const ref of r.references.slice(0, SEEDANCE_LIMITS.maxImages + SEEDANCE_LIMITS.maxVideos + SEEDANCE_LIMITS.maxAudio)) {
    if (ref.kind === "image") content.push({ type: "image_url", image_url: { url: ref.url }, role: ref.role ?? "reference_image" });
    else if (ref.kind === "video") content.push({ type: "video_url", video_url: { url: ref.url }, role: "reference_video" });
    else content.push({ type: "audio_url", audio_url: { url: ref.url }, role: "reference_audio" });
  }
  return {
    model: SEEDANCE_MODELS[r.tier].id,
    content,
    generate_audio: r.audio,
    ratio: r.ratio,
    duration: Math.min(SEEDANCE_LIMITS.maxSeconds, Math.max(SEEDANCE_LIMITS.minSeconds, Math.round(r.seconds))),
    resolution: r.draft ? "480p" : r.resolution,
    camera_fixed: r.fixedLens,
    watermark: r.watermark ?? false,
    ...(r.seed !== undefined && r.seed !== null ? { seed: r.seed } : {}),
    ...(r.flex ? { service_tier: "flex" } : {}),
    ...(r.draft ? { draft: true } : {}),
  };
}

type Opts = { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch };
const headers = (apiKey: string) => ({ "content-type": "application/json", authorization: `Bearer ${apiKey}` });

/** Plain-English messages for BytePlus's answers. Only the status and error code are kept, never the message body. */
async function fail(res: Response): Promise<never> {
  let code = "";
  try {
    const body = (await res.json()) as { error?: { code?: string; type?: string } };
    code = String(body.error?.code ?? body.error?.type ?? "");
  } catch {
    // No JSON body.
  }
  const text =
    res.status === 401 || res.status === 403
      ? "The BytePlus key is not valid or Seedance is not activated on the account."
      : res.status === 429
        ? "BytePlus is busy or the Seedance limit is reached. Try again in a minute."
        : /sensitive|moderation|content/i.test(code)
          ? "BytePlus declined this request (its content rules: for example a real person's face in a photo)."
          : /balance|quota|insufficient/i.test(code)
            ? "The BytePlus balance or prepaid pack is used up."
            : `BytePlus could not take the request (${res.status}${code ? `, ${code}` : ""}).`;
  throw new SeedanceError(text, res.status, code || undefined);
}

export async function createSeedanceTask(r: SeedanceRequest, o: Opts): Promise<string> {
  const f = o.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${o.baseUrl ?? SEEDANCE_BASE_URL}/contents/generations/tasks`, { method: "POST", headers: headers(o.apiKey), body: JSON.stringify(seedanceBody(r)), signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new SeedanceError("BytePlus did not answer. Check the connection and try again.");
  }
  if (!res.ok) await fail(res);
  const body = (await res.json()) as { id?: string };
  if (!body.id) throw new SeedanceError("BytePlus answered without a task id.");
  return body.id;
}

type TaskBody = { id?: string; status?: string; content?: { video_url?: string }; usage?: { completion_tokens?: number; total_tokens?: number }; seed?: number; resolution?: string; ratio?: string; duration?: number; error?: { code?: string; message?: string } };

export async function getSeedanceTask(id: string, o: Opts): Promise<SeedanceTask> {
  const f = o.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${o.baseUrl ?? SEEDANCE_BASE_URL}/contents/generations/tasks/${encodeURIComponent(id)}`, { headers: headers(o.apiKey), signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new SeedanceError("BytePlus did not answer the status check.");
  }
  if (!res.ok) await fail(res);
  const b = (await res.json()) as TaskBody;
  const status = (["queued", "running", "succeeded", "failed", "expired"] as const).find((s) => s === b.status) ?? "running";
  const tokens = b.usage?.completion_tokens ?? b.usage?.total_tokens ?? 0;
  const code = b.error?.code ?? "";
  return {
    id: b.id ?? id,
    status,
    videoUrl: b.content?.video_url ?? null,
    tokens,
    costUsd: Math.round(((tokens * seedanceTokenRate()) / 1_000_000) * 10_000) / 10_000,
    seed: typeof b.seed === "number" ? b.seed : null,
    resolution: b.resolution ?? null,
    ratio: b.ratio ?? null,
    seconds: typeof b.duration === "number" ? b.duration : null,
    error: status === "failed" ? (/sensitive|moderation/i.test(code) ? "BytePlus declined the content (its rules: no real faces, nothing sensitive)." : `Seedance could not make this video${code ? ` (${code})` : ""}.`) : status === "expired" ? "The task expired before it ran." : null,
  };
}

export async function cancelSeedanceTask(id: string, o: Opts): Promise<void> {
  const f = o.fetchImpl ?? fetch;
  const res = await f(`${o.baseUrl ?? SEEDANCE_BASE_URL}/contents/generations/tasks/${encodeURIComponent(id)}`, { method: "DELETE", headers: headers(o.apiKey), signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (res && !res.ok && res.status !== 404) await fail(res);
}

/** Keeps the ledger's model naming for Seedance usage rows (lib/ai/pricing.ts prices Claude; Seedance is priced here). */
export const seedanceUsage = (tier: SeedanceTier, tokens: number) => ({ model: SEEDANCE_MODELS[tier].id, inputTokens: 0, outputTokens: tokens, costUsd: Math.round(((tokens * seedanceTokenRate()) / 1_000_000) * 10_000) / 10_000 });

// estimateCostUsd is Claude's table; re-exported so callers price both engines from one place.
export { estimateCostUsd as estimateClaudeUsd };

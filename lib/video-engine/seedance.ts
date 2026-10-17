// Seedance (BytePlus ModelArk) video generation (docs/VIDEO_ENGINE.md, "Seedance"): the real-video engine, for moving
// people and real footage. Owner decision 17 October 2026: BytePlus direct (prepaid pack), Seedance 2.0 series.
// Facts from the BytePlus docs read on 16 October 2026 (docs/research/VIDEO_COMPETITORS_TEARDOWN.md):
// - POST {base}/contents/generations/tasks -> { id }; GET {base}/contents/generations/tasks/{id} -> status queued |
//   running | succeeded | failed | expired, content.video_url (valid 24 hours), usage.completion_tokens;
//   DELETE cancels a queued task.
// - content: text, image_url (role first_frame | last_frame | reference_image), video_url (reference_video),
//   audio_url (reference_audio); images 0-9, videos 0-3, audio 0-3; prompts refer to "Image 1", "Video 2"...
// - ratio 21:9 16:9 4:3 1:1 3:4 9:16 adaptive; duration 4-15 s; resolution 480p 720p 1080p (4k on 2.0 only);
//   generate_audio, seed, watermark, execution_expires_after.
// Checked against the API reference on 17 October 2026 (docs/VIDEO_ENGINE.md, "What Seedance 2.0 takes"): the 2.0
// series has no camera_fixed (1.x only), no draft (2.5 and 1.5 pro only) and no service_tier "flex" yet, so none of
// them is sent; a fixed lens is asked for in the prompt instead. Reference limits: video-lab/seedance-references.ts.
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
  /** "flex" (offline, half price): not on the 2.0 series yet, so not sent; kept for when BytePlus adds it. */
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

/** BytePlus ends a task still queued or running after this long (and bills nothing); the studio waits a little longer. */
export const SEEDANCE_TASK_EXPIRES_SECONDS = 3600;
const STATIC_CAMERA = /static camera|locked-off|fixed camera|camera (stays|is) still/i;

/** Builds the BytePlus request body. References keep their order: the prompt says "Image 1", "Video 1"... */
export function seedanceBody(r: SeedanceRequest): Record<string, unknown> {
  // Seedance 2.0 has no fixed-camera switch: the prompt asks for it.
  const prompt = r.fixedLens && !STATIC_CAMERA.test(r.prompt) ? `${r.prompt.trim()}\nLocked-off static camera throughout: no camera movement.` : r.prompt;
  const content: Record<string, unknown>[] = [{ type: "text", text: prompt.slice(0, 4000) }];
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
    // "Draft" on the 2.0 series is a cheap 480p clip (BytePlus's draft mode is 2.5 and 1.5 pro only).
    resolution: r.draft ? "480p" : r.resolution,
    watermark: r.watermark ?? false,
    execution_expires_after: SEEDANCE_TASK_EXPIRES_SECONDS,
    ...(r.seed !== undefined && r.seed !== null ? { seed: r.seed } : {}),
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
  const text = /NotOpen|NotActivated|ModelAccess/i.test(code)
    ? "Seedance 2.0 is not activated on this BytePlus account: open ModelArk, Model activation, and activate it."
    : /overdue|balance|quota|insufficient/i.test(code) && res.status !== 429
      ? "The BytePlus balance or prepaid pack is used up."
      : res.status === 401 || res.status === 403
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

export type SeedanceConnection = {
  state: "connected" | "key invalid" | "not activated" | "unreachable" | "no key";
  /** Plain English for the owner: what is wrong and what to do. */
  message: string;
  httpStatus?: number;
  code?: string;
};

/**
 * Readiness check: lists one task (GET /contents/generations/tasks?page_size=1), which costs nothing. A key that
 * lists tasks is a working key; Seedance 2.0's own activation is confirmed by the first test clip.
 */
export async function checkSeedanceConnection(o: Partial<Opts> = {}): Promise<SeedanceConnection> {
  const apiKey = o.apiKey ?? process.env.SEEDANCE_API_KEY ?? "";
  if (!apiKey.trim()) return { state: "no key", message: "No BytePlus key yet: add SEEDANCE_API_KEY to .env (docs/VIDEO_ENGINE.md, \"Going live\")." };
  const f = o.fetchImpl ?? fetch;
  const base = o.baseUrl ?? process.env.SEEDANCE_BASE_URL ?? SEEDANCE_BASE_URL;
  let res: Response;
  try {
    res = await f(`${base}/contents/generations/tasks?page_num=1&page_size=1`, { headers: headers(apiKey.trim()), signal: AbortSignal.timeout(20_000) });
  } catch {
    return { state: "unreachable", message: `BytePlus did not answer at ${new URL(base).host}. Check the internet connection, or SEEDANCE_BASE_URL (ap-southeast).` };
  }
  let code = "";
  let total: number | null = null;
  try {
    const body = (await res.json()) as { error?: { code?: string; type?: string }; total?: number };
    code = String(body.error?.code ?? body.error?.type ?? "");
    total = typeof body.total === "number" ? body.total : null;
  } catch {
    // No JSON body.
  }
  const extra = { httpStatus: res.status, ...(code ? { code } : {}) };
  if (res.ok) return { state: "connected", message: `Connected to BytePlus ModelArk${total !== null ? ` (${total} video task${total === 1 ? "" : "s"} so far)` : ""}. Run the test clip (--make-clip) to confirm Seedance 2.0 itself is activated.`, ...extra };
  if (/NotOpen|NotActivated|ModelAccess/i.test(code)) return { state: "not activated", message: "The key works, but Seedance 2.0 is not activated: in ModelArk open Model activation (ap-southeast-1) and activate Seedance 2.0, Fast and Mini.", ...extra };
  if (/overdue|balance|insufficient/i.test(code)) return { state: "not activated", message: "The key works, but the BytePlus account has no balance or is overdue: top up the prepaid pack in Billing.", ...extra };
  if (res.status === 401 || /authentication|apikey|api_key|invalid.?key/i.test(code)) return { state: "key invalid", message: "BytePlus does not accept this key. Copy it again from ModelArk, API keys (region ap-southeast-1) into SEEDANCE_API_KEY, with no spaces or quotes.", ...extra };
  if (res.status === 403) return { state: "not activated", message: "The key is known but not allowed to use ModelArk yet: activate ModelArk and Seedance 2.0 on the account, or check the key's permissions.", ...extra };
  if (res.status === 429) return { state: "connected", message: "Connected, but BytePlus says it is busy right now (rate limit). Try again in a minute.", ...extra };
  if (res.status === 404) return { state: "unreachable", message: `BytePlus answered, but this address is not the ModelArk API (${res.status}). Check SEEDANCE_BASE_URL; the key must be from the same region (ap-southeast-1).`, ...extra };
  return { state: "unreachable", message: `BytePlus had a problem (${res.status}${code ? `, ${code}` : ""}). Try again in a few minutes.`, ...extra };
}

/** Keeps the ledger's model naming for Seedance usage rows (lib/ai/pricing.ts prices Claude; Seedance is priced here). */
export const seedanceUsage = (tier: SeedanceTier, tokens: number) => ({ model: SEEDANCE_MODELS[tier].id, inputTokens: 0, outputTokens: tokens, costUsd: Math.round(((tokens * seedanceTokenRate()) / 1_000_000) * 10_000) / 10_000 });

// estimateCostUsd is Claude's table; re-exported so callers price both engines from one place.
export { estimateCostUsd as estimateClaudeUsd };

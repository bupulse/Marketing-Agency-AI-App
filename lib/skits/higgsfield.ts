// Higgsfield's API (docs.higgsfield.ai, read on 2 November 2026) for the skit videos: Seedance 2.0 reference-to-video
// (`bytedance/seedance-2.0/reference-to-video`), which takes the client's voice notes as reference audio and moves the
// people's lips to them.
// - POST {base}/{model} with `Authorization: Key <key id>:<key secret>` -> { status: "queued", request_id, status_url,
//   cancel_url }.
// - GET {base}/requests/{id}/status -> status queued | in_progress (waiting) or completed | failed | nsfw | canceled
//   (done); a finished video is at video.url, kept at least 7 days (we copy it to our own storage at once).
// - The model's own input fields are not on the public docs page: the names below (prompt, image_urls up to 9,
//   audio_urls up to 3, duration 4-15 s, resolution, aspect_ratio) are the ones the owner gave on 2 November 2026 and
//   must be checked on the first real call (behind the "Skit videos" switch, off by default).
// The credentials are HF_CREDENTIALS ("<key id>:<key secret>") or HF_API_KEY + HF_API_SECRET; they never leave the server.
// No app imports, so tests can run it with a fake fetch.

export const HIGGSFIELD_BASE_URL = "https://api.higgsfield.ai";
export const SKIT_MODEL = "bytedance/seedance-2.0/reference-to-video";
export const HIGGSFIELD_LIMITS = { maxImages: 9, maxAudio: 3, minSeconds: 4, maxSeconds: 15 } as const;

export type HiggsfieldRequest = { prompt: string; imageUrls: string[]; audioUrls: string[]; seconds: number; resolution?: "480p" | "720p"; ratio?: "9:16" | "16:9" | "1:1" };
export type HiggsfieldStatus = { status: "waiting" | "completed" | "failed"; videoUrl: string | null; error: string | null };

export class HiggsfieldError extends Error {
  constructor(
    message: string,
    /** True when trying again later may work (network, 429, 5xx). */
    public retryable: boolean,
  ) {
    super(message);
    this.name = "HiggsfieldError";
  }
}

type Env = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type Opts = { env?: Env; fetch?: FetchLike; baseUrl?: string };

/** "Key <id>:<secret>", or null when no credentials are set. */
export function authHeader(env: Env = process.env): string | null {
  const joined = env.HF_CREDENTIALS?.trim() || (env.HF_API_KEY && env.HF_API_SECRET ? `${env.HF_API_KEY.trim()}:${env.HF_API_SECRET.trim()}` : "");
  return joined && joined.includes(":") ? `Key ${joined}` : null;
}

export function higgsfieldConfigured(env: Env = process.env): boolean {
  return authHeader(env) !== null;
}

/** The request body: the limits applied (at most 9 pictures, 3 voices, 4 to 15 seconds), 480p 9:16 by default. */
export function higgsfieldBody(r: HiggsfieldRequest): Record<string, unknown> {
  const seconds = Math.round(Math.min(Math.max(r.seconds, HIGGSFIELD_LIMITS.minSeconds), HIGGSFIELD_LIMITS.maxSeconds));
  return {
    prompt: r.prompt,
    image_urls: r.imageUrls.slice(0, HIGGSFIELD_LIMITS.maxImages),
    audio_urls: r.audioUrls.slice(0, HIGGSFIELD_LIMITS.maxAudio),
    duration: seconds,
    resolution: r.resolution ?? "480p",
    aspect_ratio: r.ratio ?? "9:16",
  };
}

/** A status answer in our words (pure). */
export function readStatus(body: unknown): HiggsfieldStatus {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const status = typeof b.status === "string" ? b.status : "";
  const video = b.video && typeof b.video === "object" ? (b.video as Record<string, unknown>) : null;
  const url = typeof video?.url === "string" ? video.url : null;
  const error = typeof b.error === "string" ? b.error : b.error && typeof b.error === "object" ? JSON.stringify(b.error).slice(0, 300) : null;
  if (status === "queued" || status === "in_progress") return { status: "waiting", videoUrl: null, error: null };
  if (status === "completed") return url ? { status: "completed", videoUrl: url, error: null } : { status: "failed", videoUrl: null, error: "Higgsfield finished without a video." };
  if (status === "nsfw") return { status: "failed", videoUrl: null, error: "Higgsfield's moderation refused the video." };
  if (status === "canceled") return { status: "failed", videoUrl: null, error: "The video was cancelled." };
  return { status: "failed", videoUrl: null, error: error ?? `Higgsfield answered "${status || "nothing"}".` };
}

async function call(path: string, init: RequestInit, o: Opts): Promise<unknown> {
  const auth = authHeader(o.env);
  if (!auth) throw new HiggsfieldError("Higgsfield is not set up (HF_CREDENTIALS).", false);
  const doFetch = o.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${o.baseUrl ?? HIGGSFIELD_BASE_URL}${path}`, { ...init, headers: { authorization: auth, "content-type": "application/json", accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new HiggsfieldError("Higgsfield could not be reached.", true);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new HiggsfieldError(`Higgsfield answered ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`, res.status === 429 || res.status >= 500);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HiggsfieldError("Higgsfield answered something unreadable.", true);
  }
}

/** Starts a skit video; returns the request id to poll. */
export async function submitSkitVideo(r: HiggsfieldRequest, o: Opts = {}): Promise<string> {
  const body = (await call(`/${SKIT_MODEL}`, { method: "POST", body: JSON.stringify(higgsfieldBody(r)) }, o)) as Record<string, unknown>;
  const id = typeof body.request_id === "string" ? body.request_id : null;
  if (!id) throw new HiggsfieldError("Higgsfield did not return a request id.", false);
  return id;
}

export async function skitVideoStatus(requestId: string, o: Opts = {}): Promise<HiggsfieldStatus> {
  if (!/^[A-Za-z0-9-]{1,100}$/.test(requestId)) throw new HiggsfieldError("Not a Higgsfield request id.", false);
  return readStatus(await call(`/requests/${requestId}/status`, { method: "GET" }, o));
}

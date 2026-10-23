// Google Veo AI clips (docs/VIDEO_ENGINE.md, "Veo AI clips"): short real moving clips of the client's product, mixed
// into a Motion video ("AI makes the clips"). Owner decision 19 October 2026: Veo 3.1 Lite through the Gemini API with
// the existing GEMINI_API_KEY, 720p, 9:16, billed per second ($0.05/s at 720p, audio always on), 2 to 3 clips a video.
// Facts from ai.google.dev/gemini-api/docs/veo and /pricing read on 19 October 2026:
// - POST {base}/models/{model}:predictLongRunning (header x-goog-api-key) -> { name } (an operation);
//   GET {base}/{name} until `done`; then response.generateVideoResponse.generatedSamples[0].video.uri, fetched with the
//   key header (it redirects). Generated files are kept 2 days, so they are downloaded at once.
// - instances: prompt (up to 1,024 tokens), image (the first frame), lastFrame; Lite has no
//   referenceImages and no extension. parameters: aspectRatio "9:16" | "16:9", resolution "720p" | "1080p" (1080p 8 s
//   only), durationSeconds 4 | 6 | 8, personGeneration ("allow_adult" is the only value for image-to-video).
// - 24 fps, one video per request, 11 s to 6 minutes, a SynthID watermark. Audio is always on: BuPulse drops it in
//   the mix (the engine's own music and voice-over are used). A clip blocked by the safety filters is not billed.
// Checked with the real key on 19 October 2026: the docs' REST examples send images as `inlineData`, but Veo 3.1 Lite
// answers 400 "inlineData isn't supported by this model"; it takes { bytesBase64Encoded, mimeType } (the predict
// format). durationSeconds is a number (4 to 8). numberOfVideos is refused ("isn't supported by this model"): one
// video per request is the default.
// Server-side and dependency-free, so the Video Lab runs it outside Next.js. The key never leaves process.env here.
//
// 23 October 2026: Google shut the three Veo 3.1 previews down on the Gemini API on 22 October 2026 (submits answer
// 404 "This model ... is no longer available. Please update your code to use models/gemini-omni-1.1-flash"; the
// model card still answers 200). Owner decision the same day: AI clips use **Gemini Omni Flash** (gemini-omni-1.1-flash),
// the default model now. Facts from ai.google.dev/gemini-api/docs/omni, /background-execution and /pricing read that day,
// and field names checked with refused (unbilled) requests:
// - POST {base}/interactions { model, input: [{ type: "image", data, mime_type }, { type: "text", text }] (or a string),
//   response_format: { type: "video", aspect_ratio "9:16" | "16:9", resolution "360p" | "720p" | "1080p" | "4k",
//   delivery "inline" | "uri" }, generation_config: { video_config: { task: "image_to_video" | "text_to_video" | ... } },
//   background: true } -> { id, status: "in_progress" }; GET {base}/interactions/{id} until status "completed" (or
//   "failed" / "cancelled"); the video is the steps[].content[] item of type "video": `data` (base64, the GET returns it
//   inline even for uri delivery) or `uri`. Errors: { error: { message, code } }.
// - No length field: the prompt asks for the length (timecodes work); the real length is read from the file.
// - Audio is made by default and steered by the prompt ("No dialogue"); BuPulse never mixes it in.
// - Price: $17.50 per million output tokens, 5,792 tokens a second at 720p: about $0.10 a second (no free tier).
// - "English is fully supported. Other languages are untested."
// The old predictLongRunning path stays for a Veo model set in VEO_MODEL (Vertex-style GA ids, if ever used).

export const VEO_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export const VEO_MODELS = {
  omni: { id: "gemini-omni-1.1-flash", name: "Gemini Omni Flash", resolutions: ["720p", "1080p"] },
  lite: { id: "veo-3.1-lite-generate-preview", name: "Veo 3.1 Lite", resolutions: ["720p", "1080p"] },
  fast: { id: "veo-3.1-fast-generate-preview", name: "Veo 3.1 Fast", resolutions: ["720p", "1080p"] },
  standard: { id: "veo-3.1-generate-preview", name: "Veo 3.1", resolutions: ["720p", "1080p"] },
} as const;
export type VeoTier = keyof typeof VEO_MODELS;
export const VEO_RATIOS = ["9:16", "16:9"] as const;
export type VeoRatio = (typeof VEO_RATIOS)[number];
export type VeoResolution = "720p" | "1080p";
export const VEO_SECONDS = [4, 6, 8] as const;
export type VeoSeconds = (typeof VEO_SECONDS)[number];
export const isVeoSeconds = (v: unknown): v is VeoSeconds => (VEO_SECONDS as readonly unknown[]).includes(v);
/** Clips one video may use (owner decision: 2 to 3), and how many Veo makes at once. */
export const VEO_CLIPS_PER_VIDEO = { min: 2, max: 3 } as const;
export const VEO_PARALLEL = 3;
/** Veo's prompt limit is 1,024 tokens; BuPulse's prompts stay well under it (about 4 characters a token). */
export const VEO_PROMPT_MAX_CHARS = 2400;

/**
 * List prices in USD per second of video with audio (Gemini API pricing page, 19 October 2026). Google bills only clips
 * that are made. VEO_USD_PER_SECOND overrides the rate of the model in use (for a price change before this table).
 */
export const VEO_USD_PER_SECOND: Record<VeoTier, Record<VeoResolution, number>> = {
  // Omni's 1080p is an upscale of 720p; Google prices only 720p, so the same rate is assumed until a bill says more.
  omni: { "720p": 0.1, "1080p": 0.1 },
  lite: { "720p": 0.05, "1080p": 0.08 },
  fast: { "720p": 0.1, "1080p": 0.12 },
  standard: { "720p": 0.4, "1080p": 0.4 },
};

/** The model id in use: VEO_MODEL, else Gemini Omni Flash (the Veo 3.1 previews were shut down on 22 October 2026). */
export const veoModel = (env: Record<string, string | undefined> = process.env) => env.VEO_MODEL?.trim() || VEO_MODELS.omni.id;
/** The tier of a model id (Omni for one this table does not know, which VEO_USD_PER_SECOND then prices). */
export const veoTierOf = (model: string): VeoTier => (Object.keys(VEO_MODELS) as VeoTier[]).find((t) => VEO_MODELS[t].id === model) ?? (/veo.*lite/.test(model) ? "lite" : /veo.*fast/.test(model) ? "fast" : /veo/.test(model) ? "standard" : "omni");
/** A Gemini Omni model: called through the Interactions API, not predictLongRunning. */
export const isOmniModel = (model: string) => /^gemini-omni/.test(model);

/** USD per second for a model and resolution, VEO_USD_PER_SECOND first when it is set. */
export function veoUsdPerSecond(model: string, resolution: VeoResolution = "720p", env: Record<string, string | undefined> = process.env): number {
  const override = Number(env.VEO_USD_PER_SECOND);
  if (Number.isFinite(override) && override > 0) return override;
  return VEO_USD_PER_SECOND[veoTierOf(model)][resolution];
}

/** The cost of one clip in USD (Google bills only clips that are made). */
export const veoClipUsd = (seconds: number, model: string = veoModel(), resolution: VeoResolution = "720p", env: Record<string, string | undefined> = process.env) =>
  Math.round(veoUsdPerSecond(model, resolution, env) * seconds * 10_000) / 10_000;

export type VeoImage = { base64: string; mimeType: "image/jpeg" | "image/png" };

export type VeoRequest = {
  model?: string;
  prompt: string;
  /** The first frame: the product photo, so the real product is in the clip. */
  image?: VeoImage | null;
  lastFrame?: VeoImage | null;
  ratio: VeoRatio;
  seconds: VeoSeconds;
  resolution: VeoResolution;
};

/** Why a clip failed, so the caller knows whether to try again and what to tell the client. */
export type VeoErrorKind = "blocked" | "quota" | "billing" | "key" | "busy" | "timeout" | "unreachable" | "invalid" | "failed";

export class VeoError extends Error {
  constructor(
    message: string,
    readonly kind: VeoErrorKind,
    readonly status?: number,
    /** Google's own reasons for a safety block (for the owner's logs; never shown to clients as they are). */
    readonly reasons: string[] = [],
  ) {
    super(message);
    this.name = "VeoError";
  }
  /** Worth one more try: Google busy, a timeout, the network, or a clip that failed for no stated reason. */
  get temporary(): boolean {
    return this.kind === "busy" || this.kind === "timeout" || this.kind === "unreachable" || this.kind === "failed";
  }
}

/** Builds the predictLongRunning body. Image-to-video only allows adults; text-to-video only "allow_all". */
export function veoBody(r: VeoRequest): Record<string, unknown> {
  const instance: Record<string, unknown> = { prompt: r.prompt.slice(0, VEO_PROMPT_MAX_CHARS) };
  if (r.image) instance.image = { bytesBase64Encoded: r.image.base64, mimeType: r.image.mimeType };
  if (r.image && r.lastFrame) instance.lastFrame = { bytesBase64Encoded: r.lastFrame.base64, mimeType: r.lastFrame.mimeType };
  // 1080p is 8 s only on Veo 3.1: a shorter clip falls back to 720p rather than being refused.
  const resolution = r.resolution === "1080p" && r.seconds !== 8 ? "720p" : r.resolution;
  return {
    instances: [instance],
    parameters: { aspectRatio: r.ratio, resolution, durationSeconds: r.seconds, personGeneration: r.image ? "allow_adult" : "allow_all" },
  };
}

type Opts = { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch };
const headers = (apiKey: string) => ({ "content-type": "application/json", "x-goog-api-key": apiKey });

/**
 * Plain-English messages for Google's answers. Google's message is read to tell billing from quota, but never passed
 * on (it can quote the project); only the status and Google's status word are kept.
 */
async function fail(res: Response): Promise<never> {
  let status = "";
  let text = "";
  try {
    const body = (await res.json()) as { error?: { status?: string; code?: string | number; message?: string } };
    status = String(body.error?.status ?? (typeof body.error?.code === "string" ? body.error.code : ""));
    text = String(body.error?.message ?? "");
  } catch {
    // No JSON body.
  }
  // The free tier has no Veo: Google answers 429 "limit: 0" (or asks for billing) until billing is turned on.
  if (/billing|free[_ ]tier|limit: ?0\b|prepay|credits? (are|is) depleted/i.test(text))
    throw new VeoError("Google Veo needs billing turned on for the Gemini API key (Google AI Studio, Billing), or its prepaid credit is used up.", "billing", res.status);
  if (res.status === 401 || /API_KEY_INVALID|api key not valid/i.test(text)) throw new VeoError("Google does not accept the Gemini API key. Copy it again from Google AI Studio into GEMINI_API_KEY.", "key", res.status);
  if (res.status === 403) throw new VeoError("The Gemini API key may not use Veo (Google refused it). Check the key's project in Google AI Studio.", "key", res.status);
  if (res.status === 404) throw new VeoError("This Veo model is not available to the key. Check VEO_MODEL (default veo-3.1-lite-generate-preview).", "invalid", res.status);
  if (res.status === 429 || status === "RESOURCE_EXHAUSTED") throw new VeoError("Google Veo is at its limit right now (too many clips at once, or the day's quota). Try again in a few minutes.", "quota", res.status);
  if (res.status >= 500) throw new VeoError("Google Veo had a problem on its side. Try again in a minute.", "busy", res.status);
  if (/safety|responsible ai|prohibited|sensitive/i.test(text)) throw new VeoError("Google declined this clip under its safety rules. Try a different shot or photo.", "blocked", res.status);
  throw new VeoError(`Google Veo could not take the request (${res.status}${status ? `, ${status}` : ""}).`, "invalid", res.status);
}

/**
 * The Gemini Omni request (Interactions API): the first frame and the prompt as the input, the clip's shape, made in
 * the background (Google answers at once with an id). The clip's length is asked for in the prompt (no length field).
 */
export function omniBody(r: VeoRequest): Record<string, unknown> {
  const prompt = r.prompt.slice(0, VEO_PROMPT_MAX_CHARS);
  return {
    model: r.model ?? veoModel(),
    input: r.image ? [{ type: "image", data: r.image.base64, mime_type: r.image.mimeType }, { type: "text", text: prompt }] : prompt,
    response_format: { type: "video", aspect_ratio: r.ratio, resolution: r.resolution, delivery: "uri" },
    generation_config: { video_config: { task: r.image ? "image_to_video" : "text_to_video" } },
    background: true,
  };
}

/**
 * Submits a clip and returns its operation name: "models/…/operations/…" (Veo), or "interactions/<id>" (Gemini Omni).
 */
export async function submitVeo(r: VeoRequest, o: Opts): Promise<string> {
  const f = o.fetchImpl ?? fetch;
  const model = r.model ?? veoModel();
  const omni = isOmniModel(model);
  let res: Response;
  try {
    res = omni
      ? await f(`${o.baseUrl ?? VEO_BASE_URL}/interactions`, { method: "POST", headers: headers(o.apiKey), body: JSON.stringify(omniBody({ ...r, model })), signal: AbortSignal.timeout(60_000) })
      : await f(`${o.baseUrl ?? VEO_BASE_URL}/models/${encodeURIComponent(model)}:predictLongRunning`, { method: "POST", headers: headers(o.apiKey), body: JSON.stringify(veoBody(r)), signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new VeoError("Google Veo did not answer. Check the connection and try again.", "unreachable");
  }
  if (!res.ok) await fail(res);
  const body = (await res.json()) as { name?: string; id?: string };
  const name = omni ? (body.id ? `interactions/${body.id}` : null) : body.name;
  if (!name) throw new VeoError("Google Veo answered without an operation name.", "failed");
  return name;
}

/**
 * A clip being made. A finished one carries the video's address (`videoUri`), or the video itself (`videoBytes`: Gemini
 * Omni returns it inline), or the reason it has none. veoClipBytes gives the MP4 either way.
 */
export type VeoOperation = { name: string; done: boolean; videoUri: string | null; videoBytes?: Buffer | null; error: VeoError | null };

type OperationBody = {
  name?: string;
  done?: boolean;
  error?: { code?: number; message?: string; status?: string };
  response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[]; raiMediaFilteredCount?: number; raiMediaFilteredReasons?: string[] } };
};

const SAFETY = /safety|responsible ai|blocked|prohibited|sensitive|celebrity|recogni[sz]able|policy|policies|minor|person|people/i;

type InteractionBody = {
  id?: string;
  status?: string;
  error?: { message?: string; code?: string | number };
  steps?: { type?: string; content?: { type?: string; data?: string; uri?: string; mime_type?: string; text?: string }[] }[];
};

/** Reads a Gemini Omni interaction (GET interactions/<id>): still working, the video (inline or a link), or why not. */
async function getOmniInteraction(name: string, o: Opts): Promise<VeoOperation> {
  const f = o.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${o.baseUrl ?? VEO_BASE_URL}/${name}`, { headers: headers(o.apiKey), signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new VeoError("Google Veo did not answer the status check.", "unreachable");
  }
  if (!res.ok) await fail(res);
  const b = (await res.json()) as InteractionBody;
  if (b.status === "in_progress" || b.status === "requires_action" || !b.status) return { name, done: false, videoUri: null, videoBytes: null, error: null };
  if (b.status !== "completed") {
    const message = b.error?.message ?? "";
    const error = SAFETY.test(message) ? new VeoError("Google declined this clip under its safety rules. Try a different shot or photo.", "blocked", undefined, [message.slice(0, 300)]) : new VeoError("Google Veo could not make this clip.", "failed");
    return { name, done: true, videoUri: null, videoBytes: null, error };
  }
  const items = (b.steps ?? []).flatMap((s) => s.content ?? []);
  const video = items.find((c) => c.type === "video" && (c.data || c.uri));
  if (!video) {
    // Finished without a video: Google's filters (it answers in text instead).
    const said = items.flatMap((c) => (c.type === "text" && c.text ? [c.text] : [])).join(" ");
    const error = SAFETY.test(said) ? new VeoError("Google declined this clip under its safety rules. Try a different shot or photo.", "blocked", undefined, said ? [said.slice(0, 300)] : []) : new VeoError("Google Veo finished without a video.", "failed");
    return { name, done: true, videoUri: null, videoBytes: null, error };
  }
  const videoUri = video.uri ? (video.uri.startsWith("http") ? video.uri : `${o.baseUrl ?? VEO_BASE_URL}/${video.uri.replace(/^\/+/, "")}`) : null;
  return { name, done: true, videoUri, videoBytes: video.data ? Buffer.from(video.data, "base64") : null, error: null };
}

/** Reads an operation. A finished one carries the video's address (or the video itself), or the reason it has none. */
export async function getVeoOperation(name: string, o: Opts): Promise<VeoOperation> {
  if (!/^[A-Za-z0-9._\-/]{1,300}$/.test(name) || name.includes("..")) throw new VeoError("That is not a Veo operation name.", "invalid");
  if (name.startsWith("interactions/")) return getOmniInteraction(name, o);
  const f = o.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${o.baseUrl ?? VEO_BASE_URL}/${name}`, { headers: headers(o.apiKey), signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new VeoError("Google Veo did not answer the status check.", "unreachable");
  }
  if (!res.ok) await fail(res);
  const b = (await res.json()) as OperationBody;
  if (!b.done) return { name, done: false, videoUri: null, error: null };
  const out = b.response?.generateVideoResponse;
  const uri = out?.generatedSamples?.[0]?.video?.uri ?? null;
  let error: VeoError | null = null;
  if (b.error) {
    const blocked = /safety|responsible ai|blocked|prohibited|sensitive|celebrity|person|people/i.test(b.error.message ?? "");
    error = blocked ? new VeoError("Google declined this clip under its safety rules. Try a different shot or photo.", "blocked", b.error.code) : new VeoError("Google Veo could not make this clip.", "failed", b.error.code);
  } else if (!uri) {
    const reasons = out?.raiMediaFilteredReasons ?? [];
    error = (out?.raiMediaFilteredCount ?? 0) > 0 || reasons.length ? new VeoError("Google declined this clip under its safety rules. Try a different shot or photo.", "blocked", undefined, reasons.map((x) => String(x).slice(0, 300))) : new VeoError("Google Veo finished without a video.", "failed");
  }
  return { name: b.name ?? name, done: true, videoUri: uri, error };
}

/** Downloads a finished clip (the address redirects; the key goes in the header). Checks it is an MP4. */
export async function downloadVeo(uri: string, o: Opts): Promise<Buffer> {
  // Only Google's own addresses get the key.
  let host = "";
  try {
    host = new URL(uri).hostname;
  } catch {
    // Not a URL: refused below.
  }
  if (!/(^|\.)googleapis\.com$|(^|\.)googleusercontent\.com$/.test(host)) throw new VeoError("Google Veo gave an unexpected download address.", "failed");
  // A Files API address (Gemini Omni's "uri" delivery) is fetched through its download form.
  if (/\/v1beta\/files\/[^/:?]+$/.test(new URL(uri).pathname)) uri = `${uri}:download?alt=media`;
  const f = o.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(uri, { headers: { "x-goog-api-key": o.apiKey }, redirect: "follow", signal: AbortSignal.timeout(120_000) });
  } catch {
    throw new VeoError("The clip could not be downloaded from Google. Try again.", "unreachable");
  }
  if (!res.ok) await fail(res);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 1000 || bytes.subarray(4, 8).toString("latin1") !== "ftyp") throw new VeoError("Google Veo sent something that is not an MP4.", "failed");
  return bytes;
}

/** A finished clip's MP4: the video Google returned inline, else downloaded from its address. Checks it is an MP4. */
export async function veoClipBytes(op: Pick<VeoOperation, "videoUri" | "videoBytes">, o: Opts): Promise<Buffer> {
  if (op.videoBytes) {
    if (op.videoBytes.length < 1000 || op.videoBytes.subarray(4, 8).toString("latin1") !== "ftyp") throw new VeoError("Google Veo sent something that is not an MP4.", "failed");
    return op.videoBytes;
  }
  if (!op.videoUri) throw new VeoError("Google Veo finished without a video.", "failed");
  return downloadVeo(op.videoUri, o);
}

/** Longest the studio waits for one clip: Google's worst case is 6 minutes; then it is given up (and refunded). */
export const VEO_MAX_WAIT_MS = 10 * 60_000;
const POLL_MS = 8_000;

export type VeoClip = { bytes: Buffer; operation: string; model: string; seconds: VeoSeconds; resolution: VeoResolution; costUsd: number; ms: number };

type WaitOpts = Opts & { pollMs?: number; maxWaitMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number; onState?: (state: "submitted" | "downloading", operation: string) => void | Promise<void> };

/**
 * Waits for a submitted clip (polls every 8 s) and downloads it at once. Also picks up an operation submitted before a
 * restart (`startedAt` then counts from the first submit). Throws a VeoError in plain English.
 */
export async function finishVeoOperation(name: string, r: Pick<VeoRequest, "model" | "seconds" | "resolution">, o: WaitOpts & { startedAt?: number }): Promise<VeoClip> {
  const model = r.model ?? veoModel();
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const started = o.startedAt ?? now();
  for (;;) {
    await sleep(o.pollMs ?? POLL_MS);
    const op = await getVeoOperation(name, o);
    if (op.done) {
      if (op.error || (!op.videoUri && !op.videoBytes)) throw op.error ?? new VeoError("Google Veo finished without a video.", "failed");
      await o.onState?.("downloading", name);
      const bytes = await veoClipBytes(op, o);
      const resolution = r.resolution === "1080p" && r.seconds !== 8 ? "720p" : r.resolution;
      return { bytes, operation: name, model, seconds: r.seconds, resolution, costUsd: veoClipUsd(r.seconds, model, resolution), ms: now() - started };
    }
    if (now() - started > (o.maxWaitMs ?? VEO_MAX_WAIT_MS)) throw new VeoError("Google Veo took too long to make this clip (over 10 minutes).", "timeout");
  }
}

/**
 * Makes one clip: submit, poll every 8 s, download at once. `onState` says where it is ("submitted" with the operation
 * name, so a caller can keep it; "downloading"). Throws a VeoError (blocked, quota, billing, timeout...) in plain
 * English; nothing is billed for a clip not made.
 */
export async function makeVeoClip(r: VeoRequest, o: WaitOpts): Promise<VeoClip> {
  const model = r.model ?? veoModel();
  const started = (o.now ?? Date.now)();
  const name = await submitVeo({ ...r, model }, o);
  await o.onState?.("submitted", name);
  return finishVeoOperation(name, { ...r, model }, { ...o, startedAt: started });
}

export type VeoConnection = { state: "connected" | "key invalid" | "no model" | "unreachable" | "no key"; message: string; httpStatus?: number };

/**
 * Readiness check: reads the model's card (GET models/{model}), which costs nothing. Billing (Veo has no free tier) is
 * only confirmed by the first clip.
 */
export async function checkVeoConnection(o: Partial<Opts> & { model?: string } = {}): Promise<VeoConnection> {
  const apiKey = (o.apiKey ?? process.env.GEMINI_API_KEY ?? "").trim();
  if (!apiKey) return { state: "no key", message: "No Gemini API key yet: add GEMINI_API_KEY in Admin -> Services (Google Gemini)." };
  const model = o.model ?? veoModel();
  const f = o.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${o.baseUrl ?? VEO_BASE_URL}/models/${encodeURIComponent(model)}`, { headers: headers(apiKey), signal: AbortSignal.timeout(20_000) });
  } catch {
    return { state: "unreachable", message: "Google did not answer. Check the internet connection." };
  }
  if (res.ok) return { state: "connected", message: `The key can see ${model}. Veo needs billing on the key's Google project; the first clip confirms it.`, httpStatus: res.status };
  if (res.status === 404) return { state: "no model", message: `The key cannot see ${model}. Check VEO_MODEL.`, httpStatus: res.status };
  if (res.status === 400 || res.status === 401 || res.status === 403) return { state: "key invalid", message: "Google does not accept the Gemini API key for Veo.", httpStatus: res.status };
  return { state: "unreachable", message: `Google answered ${res.status}. Try again in a few minutes.`, httpStatus: res.status };
}

// ---- Prompts --------------------------------------------------------------------------------------------------------

/**
 * One clip a video needs: what the shot shows, where, and how the camera moves. From the viral recipe's clip needs
 * (lib/video-engine/brain), or the default plan below until a recipe gives them.
 */
export type ClipNeed = { shot: string; seconds?: VeoSeconds; setting?: string | null; camera?: string | null; people?: boolean };

/** What the prompt may say about the product: its name and a short line, no price (prices are BuPulse's overlay). */
export type ClipFacts = { productName: string; summary?: string | null; country?: string | null; city?: string | null };

const clean = (s: string | null | undefined, max: number) =>
  (s ?? "")
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/g, "")
    .trim()
    .slice(0, max);

/**
 * Money in a clip prompt: a price, an amount with a currency, a discount. Gemini Omni refuses a request whose words
 * carry a price at once (400 INVALID_ARGUMENT, not billed; found by client-qa's reel test, 23 October 2026), and the
 * price is BuPulse's own overlay anyway.
 */
const MONEY = /\d[\d.,\s]*\s*(?:rwf|frw|usd|kes|ksh|ugx|tzs|eur|€|\$|£|%|k\b)|(?:rwf|frw|usd|kes|ksh|ugx|tzs|eur|€|\$|£)\s*\d|\b(?:price[ds]?|prix|igiciro|cost[s]?|cheap(?:er|est)?|discount(?:ed)?|sale|promo(?:tion)?|offer|deal|free|amafaranga|francs?|dollars?|shillings?)\b/i;

/** The facts without money: sentences that mention it are dropped (a name keeps its words without the amount). */
export function withoutMoney(text: string): string {
  const kept = text.split(/(?<=[.!?;])\s+/).filter((s) => !MONEY.test(s));
  return kept.join(" ").trim();
}
const nameWithoutMoney = (name: string) => name.replace(/[-–—,:(]?\s*(?:\d[\d.,\s]*\s*(?:rwf|frw|usd|kes|ksh|ugx|tzs|eur|€|\$|£)|(?:rwf|frw|usd|kes|ksh|ugx|tzs|eur|€|\$|£)\s*\d[\d.,]*)\)?/gi, "").trim();

/** The default setting: an ordinary, bright place in the business's city (Kigali for the Rwanda launch). */
export const defaultSetting = (f: Pick<ClipFacts, "city" | "country">) => {
  const city = clean(f.city, 40) || (!f.country || /rwanda|^rw$/i.test(f.country) ? "Kigali" : "");
  const country = clean(f.country, 40) || "Rwanda";
  return `a bright, tidy shop in ${city ? `${city}, ` : ""}${/^rw$/i.test(country) ? "Rwanda" : country}`;
};

/** The default plan for 2 or 3 clips: the product in use, the product in everyday Kigali life, a close detail. */
export function defaultClipPlan(f: ClipFacts, count = 3, seconds: VeoSeconds = 4): ClipNeed[] {
  const name = clean(nameWithoutMoney(f.productName), 80) || "the product";
  const city = clean(f.city, 40) || "Kigali";
  const plan: ClipNeed[] = [
    { shot: `A customer's hands pick up and use the ${name} the way a real customer would, in one smooth, natural action.`, setting: defaultSetting(f), camera: "slow handheld push-in, eye level", people: true, seconds },
    { shot: `The ${name} where it stands, in everyday ${city} life: soft natural movement and light around it while the product stays in focus.`, setting: `a sunny ${city} day`, camera: "slow orbit around the product", people: false, seconds },
    { shot: `A slow close-up gliding over the ${name}'s details, texture and finish.`, setting: "soft window light on a clean surface", camera: "slow macro slide, shallow depth of field", people: false, seconds },
  ];
  return plan.slice(0, Math.max(1, Math.min(VEO_CLIPS_PER_VIDEO.max, count)));
}

/**
 * The Veo prompt for one clip. The product photo is the first frame, so the prompt keeps the product as it is. Rules
 * every clip follows: no text or invented logos (BuPulse overlays its own text), adults only and East African where
 * people appear, no famous people, no speech (the clip's audio is dropped; BuPulse adds music and the voice-over).
 */
export function veoPrompt(need: ClipNeed, facts: ClipFacts, opts: { withImage?: boolean; ratio?: VeoRatio } = {}): string {
  const name = clean(nameWithoutMoney(facts.productName), 80) || "the product";
  const summary = clean(withoutMoney(facts.summary ?? ""), 200);
  const vertical = (opts.ratio ?? "9:16") === "9:16";
  const lines = [
    `${vertical ? "Vertical 9:16" : "Horizontal 16:9"} short video for a social media ad, realistic filmed look, smooth natural motion.`,
    opts.withImage !== false
      ? `The first frame shows the real product: ${name}${summary ? ` (${summary})` : ""}. Keep the product exactly as it is in that frame: same shape, colours and details. It stays clearly visible.`
      : `The product: ${name}${summary ? ` (${summary})` : ""}.`,
    `Shot: ${clean(need.shot, 400)}`,
    // With a first frame, a different setting makes Veo morph the scene mid-clip (tested 19 October 2026: the greenhouse
    // turned into a street shop and the tower changed shape), so the photo's place is kept and the setting is a mood.
    opts.withImage !== false
      ? `One continuous shot in the place shown in the first frame: no cut, no change of scene, and the product never changes shape.${need.setting ? ` Mood: ${clean(need.setting, 200)}.` : ""}`
      : `Setting: ${clean(need.setting, 200) || defaultSetting(facts)}.`,
    `Camera: ${clean(need.camera, 120) || "slow, steady push-in"}.`,
    // Gemini Omni has no length setting: the prompt asks for it (Veo's own length setting wins there).
    `Length: about ${need.seconds ?? 6} seconds.`,
    need.people === false
      ? "No people in the shot, or only hands."
      : "If people appear: adults only, East African (Rwandan), ordinary everyday people, natural and friendly; no famous people; show hands and the product more than faces.",
    "Do not add any text, letters, captions, subtitles, logos, brand names, signs or watermarks. Do not invent labels or packaging.",
    "No dialogue and no speech; quiet natural ambient sound only. Soft natural light, sharp focus on the product.",
  ];
  return lines.join("\n").slice(0, VEO_PROMPT_MAX_CHARS);
}

/** A clip as withLedger describes it: provider "veo", seconds recorded as input tokens (lib/ai/pricing.ts prices them per second). */
export const veoLedgerUsage = (model: string, seconds: number) => ({ provider: "veo", model, usage: { inputTokens: seconds, outputTokens: 0 } });

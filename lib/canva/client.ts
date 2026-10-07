import { CANVA_API, CANVA_REVOKE_URL, CANVA_TOKEN_URL, canvaConfig } from "./config";
import { CanvaTimeoutError, pollJob } from "./jobs";

const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 40_000;
const ASSET_JOB_MAX_MS = 25_000;
const EXPORT_JOB_MAX_MS = 45_000;
const MAX_EXPORT_BYTES = 25 * 1024 * 1024;

export class CanvaApiError extends Error {
  constructor(
    public status: number,
    public code: string | null,
    message: string,
  ) {
    super(message);
  }
}

export type CanvaTokens = { accessToken: string; refreshToken: string; expiresInSeconds: number };

async function request(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new CanvaTimeoutError();
    throw error;
  }
}

async function failure(response: Response): Promise<CanvaApiError> {
  let code: string | null = null;
  let message = `Canva returned ${response.status}`;
  try {
    const body = (await response.json()) as { code?: string; error?: string; message?: string; error_description?: string };
    code = body.code ?? body.error ?? null;
    message = body.message ?? body.error_description ?? message;
  } catch {}
  return new CanvaApiError(response.status, code, message);
}

async function tokenRequest(params: Record<string, string>): Promise<CanvaTokens> {
  const { clientId, clientSecret } = canvaConfig();
  const response = await request(CANVA_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!response.ok) throw await failure(response);
  const body = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number };
  if (!body.access_token || !body.refresh_token) throw new CanvaApiError(502, null, "Canva sent no tokens");
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresInSeconds: body.expires_in };
}

export function exchangeCode(code: string, verifier: string) {
  const { redirectUri } = canvaConfig();
  return tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri });
}

/** Best effort: tells Canva to forget the user's consent. Never throws. */
export async function revokeToken(token: string): Promise<void> {
  try {
    const { clientId, clientSecret } = canvaConfig();
    await request(
      CANVA_REVOKE_URL,
      {
        method: "POST",
        headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      },
      10_000,
    );
  } catch {}
}

/** Refresh tokens are single use: the response carries the next one. */
export function refreshTokens(refreshToken: string) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

async function api<T>(token: string, path: string, init: RequestInit = {}, timeoutMs?: number): Promise<T> {
  const response = await request(`${CANVA_API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } }, timeoutMs);
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

/** The Canva user's id, or null when it cannot be read (it is only used to label the connection). */
export async function getCanvaUserId(token: string): Promise<string | null> {
  try {
    const body = await api<{ team_user?: { user_id?: string } }>(token, "/users/me");
    return body.team_user?.user_id ?? null;
  } catch {
    return null;
  }
}

type Job<K extends string, V> = { job: { id: string; status: "in_progress" | "success" | "failed"; error?: { code?: string; message?: string } } & { [P in K]?: V } };

/** Uploads PNG bytes to the user's Canva library and waits for the import; returns the asset id. */
export async function uploadAsset(token: string, name: string, bytes: Uint8Array): Promise<string> {
  const created = await api<Job<"asset", { id: string }>>(
    token,
    "/asset-uploads",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Asset-Upload-Metadata": JSON.stringify({ name_base64: btoa(unescape(encodeURIComponent(name.slice(0, 50)))) }),
      },
      body: bytes as unknown as BodyInit,
    },
    UPLOAD_TIMEOUT_MS,
  );
  let job = created.job;
  return pollJob<string>(
    async () => {
      const asset = job.asset;
      if (job.status === "success" && asset) return { done: true, value: asset.id };
      if (job.status === "failed") throw new CanvaApiError(422, job.error?.code ?? "import_failed", job.error?.message ?? "Canva could not import the image");
      job = (await api<Job<"asset", { id: string }>>(token, `/asset-uploads/${encodeURIComponent(job.id)}`)).job;
      return { done: false };
    },
    { maxMs: ASSET_JOB_MAX_MS },
  );
}

/** Canva custom designs are 40-8000 px per side and at most 25 million pixels. */
export function canvaSize(width: number, height: number): { width: number; height: number } {
  let w = Math.min(8000, Math.max(40, Math.round(width)));
  let h = Math.min(8000, Math.max(40, Math.round(height)));
  const area = w * h;
  if (area > 25_000_000) {
    const scale = Math.sqrt(24_000_000 / area);
    w = Math.max(40, Math.floor(w * scale));
    h = Math.max(40, Math.floor(h * scale));
  }
  return { width: w, height: h };
}

export type CanvaDesign = { id: string; editUrl: string };

export async function createDesign(token: string, input: { assetId: string; title: string; width: number; height: number }): Promise<CanvaDesign> {
  const body = await api<{ design: { id: string; urls: { edit_url: string } } }>(token, "/designs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      design_type: { type: "custom", ...canvaSize(input.width, input.height) },
      asset_id: input.assetId,
      title: input.title.slice(0, 255),
    }),
  });
  return { id: body.design.id, editUrl: body.design.urls.edit_url };
}

/** Milliseconds left until `deadline` (epoch ms); throws CanvaTimeoutError when none are left. */
function remaining(deadline: number): number {
  const left = deadline - Date.now();
  if (left <= 500) throw new CanvaTimeoutError();
  return left;
}

/** Export files are served over https from a Canva host; anything else is refused. */
export function isCanvaDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "canva.com" || url.hostname.endsWith(".canva.com"));
  } catch {
    return false;
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) throw new CanvaApiError(413, "file_too_big", "The edited design is too large");
  const reader = response.body?.getReader();
  if (!reader) throw new CanvaApiError(502, "download_failed", "Could not download the edited design");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new CanvaApiError(413, "file_too_big", "The edited design is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Exports page 1 as a PNG, waits for the job and downloads the file. Everything stops at `deadline` (epoch ms). */
export async function exportDesignPng(
  token: string,
  designId: string,
  size: { width: number; height: number },
  deadline = Date.now() + EXPORT_JOB_MAX_MS + UPLOAD_TIMEOUT_MS,
): Promise<Uint8Array> {
  const timeout = () => Math.min(REQUEST_TIMEOUT_MS, remaining(deadline));
  const created = await api<Job<"urls", string[]>>(
    token,
    "/exports",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ design_id: designId, format: { type: "png", ...canvaSize(size.width, size.height), pages: [1] } }),
    },
    timeout(),
  );
  let job = created.job;
  const urls = await pollJob<string[]>(
    async () => {
      const ready = job.urls;
      if (job.status === "success" && ready?.length) return { done: true, value: ready };
      if (job.status === "failed") throw new CanvaApiError(422, job.error?.code ?? "export_failed", job.error?.message ?? "Canva could not export the design");
      job = (await api<Job<"urls", string[]>>(token, `/exports/${encodeURIComponent(job.id)}`, {}, timeout())).job;
      return { done: false };
    },
    { maxMs: Math.min(EXPORT_JOB_MAX_MS, remaining(deadline)) },
  );
  if (!isCanvaDownloadUrl(urls[0])) throw new CanvaApiError(502, "bad_download_url", "Canva sent an unexpected download address");
  const file = await request(urls[0], { redirect: "error" }, Math.min(UPLOAD_TIMEOUT_MS, remaining(deadline)));
  if (!file.ok) throw new CanvaApiError(file.status, "download_failed", "Could not download the edited design");
  return readCapped(file, MAX_EXPORT_BYTES);
}

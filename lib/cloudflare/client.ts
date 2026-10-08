// Cloudflare API v4 with a token the user pasted. The token is only ever used server-side.
const API = "https://api.cloudflare.com/client/v4";

export class CloudflareError extends Error {
  constructor(message: string, public status: number, public code?: number) {
    super(message);
  }
  /** The token is wrong, expired, revoked or missing a permission. */
  get authFailed() {
    return this.status === 401 || this.status === 403;
  }
}

type Envelope<T> = { success: boolean; result: T; errors?: { code: number; message: string }[]; result_info?: { total_pages?: number; page?: number } };

export async function cf<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}, fetchImpl: typeof fetch = fetch): Promise<Envelope<T>> {
  let response: Response;
  try {
    response = await fetchImpl(`${API}${path}`, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new CloudflareError("We could not reach Cloudflare. Please try again.", 0);
  }
  let body: Envelope<T> | null = null;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    // not JSON
  }
  if (!response.ok || !body?.success) {
    const first = body?.errors?.[0];
    const message =
      response.status === 401 || response.status === 403
        ? "Cloudflare did not accept this token, or it is missing a permission."
        : first?.message || `Cloudflare answered ${response.status}.`;
    throw new CloudflareError(message, response.status, first?.code);
  }
  return body;
}

/** True when the token is valid and active (GET /user/tokens/verify; works for user tokens). */
export async function verifyToken(token: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const { result } = await cf<{ status: string }>(token, "/user/tokens/verify", {}, fetchImpl);
  return result.status === "active";
}

export type Zone = { id: string; name: string; status: string };

/** The zones (domains) the token can see, at most 200. */
export async function listZones(token: string, fetchImpl: typeof fetch = fetch): Promise<Zone[]> {
  const zones: Zone[] = [];
  for (let page = 1; page <= 4; page++) {
    const body = await cf<Zone[]>(token, `/zones?per_page=50&page=${page}&order=name`, {}, fetchImpl);
    zones.push(...body.result.map((z) => ({ id: z.id, name: z.name, status: z.status })));
    if (page >= (body.result_info?.total_pages ?? 1)) break;
  }
  return zones;
}

/** Pre-filled "create token" page: Zone read and Zaraz edit for all zones. */
export function tokenPageUrl(): string {
  const keys = JSON.stringify([
    { key: "zone", type: "read" },
    { key: "zaraz", type: "edit" },
  ]);
  return `https://dash.cloudflare.com/profile/api-tokens?${new URLSearchParams({ permissionGroupKeys: keys, name: "BuPulse", zoneId: "all" }).toString()}`;
}

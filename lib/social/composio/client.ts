import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { countComposioCalls } from "../inbox/budget";
import { SocialError, type Network } from "../types";
import { OWN_APP_CONFIG, ownAuthConfig } from "./ways";

// "BuPulse-Socials": BuPulse's own Composio account (COMPOSIO_API_KEY, Admin -> Services -> Composio) connects the
// clients' social accounts through Composio's approved developer apps, so BuPulse needs no verified Meta, LinkedIn or
// Google app of its own. Clients never need a Composio account: each business is one Composio "user" (its id), and
// Composio keeps the network tokens. BuPulse stores only the Composio connected-account id (encrypted) per account.
// https://docs.composio.dev/auth/introduction

export const COMPOSIO_API = "https://backend.composio.dev/api/v3.1";

// Which networks it can connect (Composio-managed, or with BuPulse's own TikTok and X apps): ./ways.ts.
export { COMPOSIO_NETWORKS, composioCanSignIn, MANAGED_NETWORKS, OWN_APP_CONFIG, ownAuthConfig, viaComposio } from "./ways";

/** Marks a connection made through BuPulse-Socials; its other scope entry names the Composio connected account. */
export const COMPOSIO_SCOPE = "composio";
export const accountScope = (connectedAccountId: string) => `composio_account:${connectedAccountId}`;
export const scopeAccount = (scopes: readonly string[]) => scopes.find((s) => s.startsWith("composio_account:"))?.slice("composio_account:".length) ?? null;
export const isComposioResult = (scopes: readonly string[]) => scopes.includes(COMPOSIO_SCOPE);

const AUTH_CONFIGS_SETTING = "socials.composio.authConfigs";
const TIMEOUT_MS = 30_000;

type ApiError = { error?: { message?: string; code?: string | number } | string; message?: string };

/**
 * `reserved`: the caller already counted this call against the monthly limit (lib/social/inbox/budget.ts).
 * `timeoutMs`: a longer wait for a call that moves a file (30 seconds otherwise).
 */
export type CallOptions = { reserved?: boolean; timeoutMs?: number };

/**
 * One Composio API call. Composio itself failing (bad key, outage) is never the client's fault: "temporary".
 * Every call is counted for the month (lib/social/inbox/budget.ts) so BuPulse stays inside Composio's free calls.
 */
export async function composioApi<T>(network: Network, method: "GET" | "POST" | "DELETE", path: string, body?: unknown, options: CallOptions = {}): Promise<T> {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) throw new SocialError("BuPulse-Socials is not set up yet", "temporary", network);
  if (!options.reserved) await countComposioCalls(1);
  let response: Response;
  try {
    response = await fetch(`${COMPOSIO_API}${path}`, {
      method,
      headers: { "x-api-key": key, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    });
  } catch {
    throw new SocialError("Could not reach BuPulse-Socials", "temporary", network);
  }
  const json = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) {
    const message = typeof json.error === "object" ? json.error?.message : (json.error ?? json.message);
    if (response.status === 429) throw new SocialError("BuPulse-Socials is busy, trying again shortly", "rate_limit", network, 60);
    if (response.status === 404 && path.startsWith("/connected_accounts/")) throw new SocialError("This account is no longer connected", "auth", network);
    throw new SocialError(`BuPulse-Socials: ${message || `error ${response.status}`}`, response.status >= 500 || response.status === 401 || response.status === 403 ? "temporary" : "invalid", network);
  }
  return json;
}

const AUTH_PATTERNS = [/error validating access token/i, /session has expired/i, /\(#190\)/, /oauthexception.*(expired|invalid)/i, /token.*(expired|revoked|invalid)/i, /connected account.*(not active|inactive|expired|not found)/i, /re-?auth/i, /invalid_grant/i, /unauthori[sz]ed/i];
const RATE_PATTERNS = [/rate limit/i, /too many/i, /\(#(4|17|32|613)\)/, /\b429\b/, /quota/i];
const INVALID_PATTERNS = [/\(#100\)/, /invalid parameter/i, /validation/i, /not supported/i, /must be/i, /aspect ratio/i, /format/i];

/** Maps a failed tool run (Composio returns the network's message as text) to what the publisher should do. */
export function toolError(network: Network, message: string): SocialError {
  const text = message.slice(0, 300);
  if (AUTH_PATTERNS.some((p) => p.test(text))) return new SocialError(text, "auth", network);
  if (RATE_PATTERNS.some((p) => p.test(text))) return new SocialError(text, "rate_limit", network, 3600);
  if (INVALID_PATTERNS.some((p) => p.test(text))) return new SocialError(text, "invalid", network);
  return new SocialError(text, "temporary", network);
}

type ExecuteResponse = { data?: unknown; successful?: boolean; error?: string | null };

/** Runs one Composio tool for a business's connected account and returns its `data`. */
export async function runTool<T = Record<string, unknown>>(
  network: Network,
  slug: string,
  connectedAccountId: string,
  userId: string | undefined,
  args: Record<string, unknown>,
  options: CallOptions = {},
): Promise<T> {
  const r = await composioApi<ExecuteResponse>(network, "POST", `/tools/execute/${slug}`, { connected_account_id: connectedAccountId, ...(userId ? { user_id: userId } : {}), arguments: args }, options);
  if (!r.successful) throw toolError(network, r.error || `${slug} failed`);
  return (r.data ?? {}) as T;
}

type ProxyResponse = { data?: unknown; status?: number };

/**
 * Calls a network endpoint Composio has no tool for, with the connected account's own sign-in (Composio's proxy,
 * POST /tools/execute/proxy). `endpoint` is a full URL or a path relative to the account's base URL. A network error
 * comes back as a SocialError, the same as a tool's.
 */
export async function proxyRequest<T = Record<string, unknown>>(
  network: Network,
  connectedAccountId: string,
  userId: string | undefined,
  request: { endpoint: string; method: "GET" | "POST"; body?: Record<string, unknown> },
  options: CallOptions = {},
): Promise<T> {
  const r = await composioApi<ProxyResponse>(
    network,
    "POST",
    "/tools/execute/proxy",
    { connected_account_id: connectedAccountId, ...(userId ? { user_id: userId } : {}), endpoint: request.endpoint, method: request.method, ...(request.body ? { body: request.body } : {}) },
    options,
  );
  const status = typeof r.status === "number" ? r.status : 200;
  if (status >= 400) {
    const err = (r.data && typeof r.data === "object" ? (r.data as { error?: { message?: string; code?: number; error_subcode?: number } }).error : undefined) ?? {};
    const detail = [err.message, err.code !== undefined ? `(#${err.code})` : "", err.error_subcode ? `subcode ${err.error_subcode}` : ""].filter(Boolean).join(" ");
    throw toolError(network, detail || `error ${status}`);
  }
  return (r.data ?? {}) as T;
}

const LABELS: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", youtube: "YouTube", tiktok: "TikTok", twitter: "X" };

/**
 * The auth config a network signs in with. TikTok and X: the one made with BuPulse's own app (ownAuthConfig), never a
 * managed one. The others: the Composio-managed config ("BuPulse-Socials <Network>"), stored once, found or made on first use.
 */
export async function authConfigFor(network: Network): Promise<string> {
  if (OWN_APP_CONFIG[network]) {
    const own = ownAuthConfig(network);
    if (!own) throw new SocialError(`${LABELS[network] ?? network} is not set up in BuPulse-Socials yet`, "invalid", network);
    return own;
  }
  const row = await prisma.adminSetting.findUnique({ where: { key: AUTH_CONFIGS_SETTING } }).catch(() => null);
  const saved = (row?.value ?? {}) as Record<string, string>;
  if (saved[network]) return saved[network];

  const name = `BuPulse-Socials ${LABELS[network] ?? network}`;
  type Listed = { items?: { id: string; name?: string; is_composio_managed?: boolean; status?: string }[] };
  const listed = await composioApi<Listed>(network, "GET", `/auth_configs?toolkit_slug=${network}&limit=50`);
  let id = listed.items?.find((c) => c.name === name && c.is_composio_managed !== false && c.status !== "DISABLED")?.id;
  if (!id) {
    const made = await composioApi<{ auth_config?: { id: string } }>(network, "POST", "/auth_configs", {
      toolkit: { slug: network },
      auth_config: { type: "use_composio_managed_auth", name, credentials: {} },
    });
    id = made.auth_config?.id;
  }
  if (!id) throw new SocialError("BuPulse-Socials could not prepare this network", "temporary", network);
  const value = { ...saved, [network]: id } as Prisma.InputJsonValue;
  await prisma.adminSetting.upsert({ where: { key: AUTH_CONFIGS_SETTING }, create: { key: AUTH_CONFIGS_SETTING, value }, update: { value } });
  return id;
}

/** A one-time Composio sign-in link for this business. Composio sends the person back to `callbackUrl`. */
export async function createConnectLink(network: Network, businessId: string, callbackUrl: string): Promise<{ url: string; connectedAccountId: string }> {
  const authConfigId = await authConfigFor(network);
  const r = await composioApi<{ redirect_url?: string; connected_account_id?: string }>(network, "POST", "/connected_accounts/link", { auth_config_id: authConfigId, user_id: businessId, callback_url: callbackUrl });
  if (!r.redirect_url || !r.connected_account_id) throw new SocialError("BuPulse-Socials did not return a sign-in link", "temporary", network);
  return { url: r.redirect_url, connectedAccountId: r.connected_account_id };
}

export type ConnectedAccount = { id: string; status: string; userId: string | null; toolkit: string | null };

export async function getConnectedAccount(network: Network, id: string): Promise<ConnectedAccount> {
  const r = await composioApi<{ id: string; status?: string; user_id?: string; toolkit?: { slug?: string } }>(network, "GET", `/connected_accounts/${encodeURIComponent(id)}`);
  return { id: r.id, status: String(r.status ?? "").toUpperCase(), userId: r.user_id ?? null, toolkit: r.toolkit?.slug ?? null };
}

/** Removes the account from Composio (best effort): Composio then forgets its tokens. */
export async function deleteConnectedAccount(network: Network, id: string): Promise<void> {
  await composioApi(network, "DELETE", `/connected_accounts/${encodeURIComponent(id)}`).catch(() => undefined);
}

/**
 * Hands Composio a file for tools that take one (LinkedIn images): BuPulse downloads it from its short-lived signed
 * URL, asks Composio for an upload slot and puts the bytes there. Returns the FileUploadable a tool argument takes.
 */
export async function uploadFile(network: Network, toolSlug: string, url: string, mimetype: string, name: string): Promise<{ name: string; mimetype: string; s3key: string }> {
  const source = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
  if (!source?.ok) throw new SocialError("A photo on this post could not be read from storage", "temporary", network);
  const bytes = new Uint8Array(await source.arrayBuffer());
  const md5 = await md5Hex(bytes);
  const slot = await composioApi<{ key?: string; new_presigned_url?: string; metadata?: { storage_backend?: string } }>(network, "POST", "/files/upload/request", { toolkit_slug: network, tool_slug: toolSlug, filename: name, mimetype, md5 });
  if (!slot.key || !slot.new_presigned_url) throw new SocialError("BuPulse-Socials could not take the photo", "temporary", network);
  const put = await fetch(slot.new_presigned_url, {
    method: "PUT",
    headers: { "content-type": mimetype, ...(slot.metadata?.storage_backend === "azure_blob_storage" ? { "x-ms-blob-type": "BlockBlob" } : {}) },
    body: bytes,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  if (!put?.ok) throw new SocialError("BuPulse-Socials could not take the photo", "temporary", network);
  return { name, mimetype, s3key: slot.key };
}

async function md5Hex(bytes: Uint8Array): Promise<string> {
  // Web Crypto has no MD5; node:crypto does (Node and Cloudflare's nodejs_compat).
  const { createHash } = await import("node:crypto");
  return createHash("md5").update(bytes).digest("hex");
}

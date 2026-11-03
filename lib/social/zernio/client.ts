import "server-only";
import { logError } from "@/lib/errors";
import { SocialError, type AccountChoice, type Network } from "../types";
import { zernioProfileName } from "./ways";

// Zernio (zernio.com): BuPulse's own account (ZERNIO_API_KEY, Admin -> Services -> Zernio) connects the clients' TikTok
// through Zernio's approved TikTok for Business app. Clients never need a Zernio account: each business is one Zernio
// "profile" (./ways.ts), the client signs in to TikTok from Zernio's connect link, and Zernio keeps the tokens. BuPulse
// stores only the profile id and Zernio's account id on the connection.
// https://docs.zernio.com/guides/profiles, /guides/connecting-accounts, /connect/get-connect-url, /accounts/list-accounts,
// /accounts/delete-account, /guides/error-handling and /guides/rate-limits (read 3 November 2026). Nothing here has been
// checked against a live Zernio answer yet.

export { isZernioResult, scopeZernioProfile, viaZernio, zernioProfileScope, ZERNIO_SCOPE } from "./ways";

export const ZERNIO_API = "https://zernio.com/api/v1";
const TIMEOUT_MS = 30_000;
/** Zernio's billing gates and plan caps do not clear within the hour: the next try waits this long. */
export const LIMIT_RETRY_SECONDS = 6 * 60 * 60;

/** A failed Zernio call, with what it answered so callers can tell "exists", "billing" or "disconnected" apart. */
export class ZernioError extends SocialError {
  constructor(
    message: string,
    kind: SocialError["kind"],
    network: Network,
    public status: number,
    public code?: string,
    retryAfter?: number,
    stage: SocialError["stage"] = "before",
    public details?: Record<string, unknown>,
  ) {
    super(message, kind, network, retryAfter, stage);
  }
}

/** Zernio's error envelope: `type` and `code` are stable, `error` is display text (docs: /guides/error-handling). */
type Envelope = { error?: unknown; type?: unknown; code?: unknown; reason?: unknown; details?: unknown };

/**
 * `final`: the call creates the post, so a timeout or a 5xx leaves it unknown whether it went out (stage "final": never
 * resent). `timeoutMs`: a longer wait than 30 seconds.
 */
export type CallOptions = { final?: boolean; timeoutMs?: number };

const text = (v: unknown) => (typeof v === "string" ? v : "");
const label = (network: Network) => (network === "tiktok" ? "TikTok" : network);

/** Zernio's key, billing and plan problems are for the owner to fix: they go to Admin -> Errors too. */
async function tellOwner(network: Network, status: number, detail: string) {
  try {
    await logError(new Error(`Zernio ${status}: ${detail}`.slice(0, 300)), { source: "social.zernio", network, level: "warn" });
  } catch {
    // Logging never stops the answer.
  }
}

/**
 * One Zernio API call (`Authorization: Bearer <key>`, JSON). A 2xx comes back as it is, 207 included (a post created
 * whose publish failed: the caller reads post.status). Zernio failing (bad key, outage, BuPulse's billing) is never the
 * client's fault.
 */
export async function zernioApi<T>(network: Network, method: "GET" | "POST" | "DELETE", path: string, body?: Record<string, unknown>, options: CallOptions = {}): Promise<{ status: number; json: T }> {
  const key = process.env.ZERNIO_API_KEY?.trim();
  const name = label(network);
  if (!key) throw new ZernioError(`${name} through Zernio is not set up yet`, "temporary", network, 0);
  const stage = options.final ? ("final" as const) : ("before" as const);
  let response: Response;
  try {
    response = await fetch(`${ZERNIO_API}${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    });
  } catch {
    throw new ZernioError(`Could not reach Zernio, BuPulse's ${name} partner`, "temporary", network, 0, undefined, undefined, stage);
  }
  const json = (await response.json().catch(() => ({}))) as T & Envelope;
  if (response.ok) return { status: response.status, json };

  const status = response.status;
  const detail = text(json.error);
  const code = text(json.code) || undefined;
  const details = json.details && typeof json.details === "object" ? (json.details as Record<string, unknown>) : undefined;
  const retryAfter = Number(response.headers.get("retry-after")) || undefined;
  const fail = (message: string, kind: SocialError["kind"], wait?: number, at: SocialError["stage"] = "before") => new ZernioError(message, kind, network, status, code, wait, at, details);

  if (status === 401) {
    await tellOwner(network, status, detail || "the API key was refused");
    throw fail("Zernio did not accept BuPulse's key. BuPulse support has been told.", "temporary");
  }
  // Billing gates (free_tier_exceeded: more than the 2 free accounts and no card on file) and plan caps.
  if (status === 402 || code === "PROFILE_OVER_LIMIT" || code === "platform_account_limit") {
    await tellOwner(network, status, `${text(json.reason) || code || ""} ${detail}`.trim() || "billing gate");
    throw fail("BuPulse's Zernio plan does not allow this right now. BuPulse support has been told; the post will be tried again later.", "rate_limit", LIMIT_RETRY_SECONDS);
  }
  // The TikTok sign-in expired or was revoked, or the account was connected for ads only.
  if (code === "ACCOUNT_DISCONNECTED" || code === "ACCOUNT_NOT_ENABLED_FOR_POSTING" || code === "ads_connection_required") {
    throw fail(`${name} is no longer connected. Reconnect ${name} in Channels.`, "auth");
  }
  // 403 without a code: the account is not BuPulse's (removed in Zernio's dashboard, or another key).
  if (status === 403 && !code) throw fail(`This ${name} connection is no longer there. Reconnect ${name} in Channels.`, "auth");
  if (status === 403) {
    await tellOwner(network, status, `${code} ${detail}`.trim());
    throw fail("BuPulse's Zernio account cannot do this right now. BuPulse support has been told; the post will be tried again later.", "rate_limit", LIMIT_RETRY_SECONDS);
  }
  if (status === 404) throw fail(`This ${name} connection is no longer there. Reconnect ${name} in Channels.`, "auth");
  // The same Idempotency-Key still being processed: the first try may be posting.
  if (status === 409 && code === "idempotency_conflict") throw fail("Zernio is still working on this post", "temporary", retryAfter, stage);
  if (status === 429) {
    // A velocity or daily cap of the account, or Zernio's own request limit.
    throw fail(`${name}: ${detail ? detail.slice(0, 200) : "too many posts right now"}. The post will be tried again later.`, "rate_limit", retryAfter ?? 3600);
  }
  if (status >= 500) throw fail(`Zernio had a problem${detail ? `: ${detail.slice(0, 200)}` : ""}`, "temporary", retryAfter, stage);
  throw fail(detail ? detail.slice(0, 300) : `Zernio answered ${status}`, "invalid");
}

// ---- Profiles, the connect link and accounts ----

type Profile = { _id?: unknown };
const idOf = (p: Profile | undefined) => (typeof p?._id === "string" && p._id ? p._id : null);

/**
 * The business's Zernio profile id: found by its externalId (the business id), created on first use. A 409 (the name
 * or externalId exists) carries the existing profile's id. Profiles are free; only connected accounts are billed.
 */
export async function ensureZernioProfile(network: Network, businessId: string, businessName: string): Promise<string> {
  const found = await zernioApi<{ profiles?: Profile[] }>(network, "GET", `/profiles?externalId=${encodeURIComponent(businessId)}`);
  const existing = idOf(found.json.profiles?.[0]);
  if (existing) return existing;
  try {
    const created = await zernioApi<{ profile?: Profile }>(network, "POST", "/profiles", {
      name: zernioProfileName(businessId),
      externalId: businessId,
      ...(businessName.trim() ? { description: businessName.trim().slice(0, 200) } : {}),
    });
    const id = idOf(created.json.profile);
    if (id) return id;
  } catch (error) {
    const again = error instanceof ZernioError && error.status === 409 ? error.details?.existingProfileId : undefined;
    if (typeof again === "string" && again) return again;
    throw error;
  }
  throw new ZernioError("Zernio did not return a profile", "temporary", network, 200);
}

/**
 * Zernio's link that signs the person in to `network` and connects the account to the profile, then sends them back
 * to `redirectUrl` with connected, profileId, accountId and username (or error and platform) added; BuPulse's own
 * query (the state) is kept. A redirect to another site first passes Zernio's one-click "continue" page.
 */
export async function zernioConnectUrl(network: Network, profileId: string, redirectUrl: string): Promise<string> {
  const query = new URLSearchParams({ profileId, redirect_url: redirectUrl });
  const r = await zernioApi<{ authUrl?: unknown }>(network, "GET", `/connect/${network}?${query}`);
  const url = text(r.json.authUrl);
  if (!/^https:\/\//.test(url)) throw new ZernioError("Zernio did not return a sign-in link", "temporary", network, r.status);
  return url;
}

/** One connected account as GET /v1/accounts lists it (docs: SocialAccount). */
export type ZernioAccount = { _id?: unknown; platform?: unknown; profileId?: unknown; username?: unknown; displayName?: unknown; profilePicture?: unknown; tiktokAccountType?: unknown; isActive?: unknown; enabled?: unknown };

const https = (v: unknown) => (typeof v === "string" && /^https:\/\//.test(v) ? v : undefined);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * The account to save from Zernio's entry: Zernio's account id (what every post names; kept when the same TikTok
 * account reconnects), the @username as its name (or the display name), its picture. TikTok's own account type
 * ("business" or "personal") when Zernio has it; "creator" otherwise, as for the other TikTok ways.
 */
export function zernioAccountChoice(a: ZernioAccount): AccountChoice | null {
  const id = str(a._id);
  if (!id) return null;
  const username = str(a.username)?.replace(/^@/, "");
  const type = str(a.tiktokAccountType);
  return { externalAccountId: id, displayName: username ? `@${username}` : (str(a.displayName) ?? "TikTok account"), avatarUrl: https(a.profilePicture), accountType: type === "business" ? "business" : "creator" };
}

/**
 * The account a sign-in connected, read back from the business's own profile (so an accountId in the callback's query
 * that is not in this profile is never saved). Null when it is not there or cannot post (`enabled: false`).
 */
export async function zernioAccount(network: Network, profileId: string, accountId: string): Promise<AccountChoice | null> {
  const query = new URLSearchParams({ profileId, platform: network });
  const r = await zernioApi<{ accounts?: ZernioAccount[] }>(network, "GET", `/accounts?${query}`);
  const entry = (Array.isArray(r.json.accounts) ? r.json.accounts : []).find((a) => a._id === accountId && (a.profileId === undefined || a.profileId === profileId || (a.profileId as { _id?: unknown })?._id === profileId));
  if (!entry || entry.enabled === false) return null;
  return zernioAccountChoice(entry);
}

/** Disconnects the account from Zernio (best effort): Zernio forgets its tokens and stops billing it. */
export async function deleteZernioAccount(network: Network, accountId: string): Promise<void> {
  await zernioApi(network, "DELETE", `/accounts/${encodeURIComponent(accountId)}`).catch(() => undefined);
}

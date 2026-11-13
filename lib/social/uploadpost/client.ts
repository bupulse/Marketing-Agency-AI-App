import "server-only";
import { activeServiceFault, asFault, clearServiceFault, reportServiceFault, type FaultKey } from "@/lib/admin/service-faults";
import { SocialError, type Network } from "../types";
import { uploadPostLabel } from "./ways";

// Upload-Post (upload-post.com): BuPulse's own account (UPLOAD_POST_API_KEY, Admin -> Services -> Upload-Post) connects
// the clients' LinkedIn (Pages included) and TikTok through Upload-Post's approved apps. Clients never need an
// Upload-Post account: each business is one Upload-Post "profile" (./ways.ts profileUsername) holding both networks,
// and Upload-Post keeps their tokens. BuPulse stores only the profile's name on the connection.
// https://docs.upload-post.com/api/user-profiles and https://docs.upload-post.com/guides/user-profile-integration

export { isUploadPostResult, profileScope, profileUsername, scopeProfile, UPLOAD_POST_SCOPE, viaUploadPost } from "./ways";

export const UPLOAD_POST_API = "https://api.upload-post.com/api";
const TIMEOUT_MS = 30_000;
/** Upload-Post's monthly and daily limits do not reset within the hour: the next try waits this long. */
const LIMIT_RETRY_SECONDS = 6 * 60 * 60;

/** A failed Upload-Post call, with what it answered so callers can tell "already exists" or "plan limit" apart. */
export class UploadPostError extends SocialError {
  constructor(
    message: string,
    kind: SocialError["kind"],
    network: Network,
    public status: number,
    public code?: string,
    retryAfter?: number,
    stage: SocialError["stage"] = "before",
  ) {
    super(message, kind, network, retryAfter, stage);
  }
}

type Answer = { success?: boolean; message?: string; error?: string | { message?: string }; error_code?: string; usage?: { count?: number; limit?: number } };

/**
 * `final`: the call creates the post, so a timeout or a 5xx leaves it unknown whether it went out (stage "final":
 * never resent). `timeoutMs`: a longer wait than 30 seconds.
 */
export type CallOptions = { final?: boolean; timeoutMs?: number; /** Creating a profile: a 403 is the profile limit, which ensureProfile judges. */ profileCreate?: boolean };

const messageOf = (a: Answer) => (typeof a.error === "object" ? a.error?.message : a.error) || a.message || "";

/**
 * Upload-Post's own limits and key problems are for the owner to fix: each is ONE item on Admin -> Health (and one
 * warning in Admin -> Errors when it starts), not an error per call (lib/admin/service-faults.ts). The errors thrown for
 * them are marked, so the callers' logError leaves them out.
 */
async function tellOwner(key: FaultKey, detail: string, opts: { apiKey?: string; untilMs?: number } = {}) {
  await reportServiceFault(key, detail, opts);
}

const KEY_RETRY_MS = 15 * 60_000;
let lastKeyRetryAt = 0;

/** Is this key one Upload-Post refused (and not due for its 15-minute retry)? A new key goes through at once. */
async function keyRefused(key: string): Promise<boolean> {
  if (!(await activeServiceFault("uploadpost:key", { apiKey: key }))) return false;
  if (Date.now() - lastKeyRetryAt >= KEY_RETRY_MS) {
    lastKeyRetryAt = Date.now();
    return false;
  }
  return true;
}

/**
 * One Upload-Post API call (`Authorization: Apikey <key>`). JSON bodies for the profile calls, multipart forms for
 * the uploads. Upload-Post failing (bad key, outage, BuPulse's plan limits) is never the client's fault.
 */
export async function uploadPostApi<T>(network: Network, method: "GET" | "POST" | "DELETE", path: string, body?: Record<string, unknown> | FormData, options: CallOptions = {}): Promise<T> {
  const key = process.env.UPLOAD_POST_API_KEY?.trim();
  const label = uploadPostLabel(network);
  if (!key) throw new UploadPostError(`${label} through Upload-Post is not set up yet`, "temporary", network, 0);
  if (await keyRefused(key)) throw asFault(new UploadPostError(KEY_REFUSED, "temporary", network, 401), "uploadpost:key");
  const form = body instanceof FormData;
  const stage = options.final ? ("final" as const) : ("before" as const);
  let response: Response;
  try {
    response = await fetch(`${UPLOAD_POST_API}${path}`, {
      method,
      // fetch sets the multipart boundary itself for a FormData body.
      headers: { authorization: `Apikey ${key}`, ...(body === undefined || form ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    });
  } catch {
    throw new UploadPostError(`Could not reach Upload-Post, BuPulse's ${label} partner`, "temporary", network, 0, undefined, undefined, stage);
  }
  const json = (await response.json().catch(() => ({}))) as T & Answer;
  if (response.ok) {
    // A good answer: a refused key recorded before is fixed (a cached read when there is none).
    await clearServiceFault("uploadpost:key");
    return json;
  }

  const detail = messageOf(json);
  const code = json.error_code;
  const status = response.status;
  if (status === 401) {
    await tellOwner("uploadpost:key", detail || "the API key was refused", { apiKey: key });
    lastKeyRetryAt = Date.now();
    throw asFault(new UploadPostError(KEY_REFUSED, "temporary", network, status, code), "uploadpost:key");
  }
  if (options.profileCreate && (status === 403 || isProfileLimit(detail, code))) {
    // ensureProfile decides: a profile that exists is still used; otherwise it is the profile limit.
    throw new UploadPostError(detail || "plan restriction", "rate_limit", network, status, code, LIMIT_RETRY_SECONDS);
  }
  if (options.profileCreate && status === 429) {
    // Too many requests right now: rate limiting, not the profile limit and not the posting limit.
    throw new UploadPostError("Upload-Post is busy right now. Try again in a minute.", "rate_limit", network, status, code, Number(response.headers.get("retry-after")) || 60);
  }
  if (status === 429) {
    const retryAfter = Number(response.headers.get("retry-after")) || LIMIT_RETRY_SECONDS;
    await tellOwner("uploadpost:plan-limit", detail || "limit reached", { untilMs: retryAfter * 1000 });
    const used = json.usage?.limit ? ` (${json.usage.count ?? json.usage.limit} of ${json.usage.limit} this month)` : "";
    throw asFault(new UploadPostError(`BuPulse reached its ${label} posting limit with Upload-Post${used}. BuPulse support has been told; the post will be tried again later.`, "rate_limit", network, status, code, retryAfter), "uploadpost:plan-limit");
  }
  if (status === 403) {
    await tellOwner("uploadpost:plan-limit", `${code ?? ""} ${detail}`.trim() || "plan restriction", { untilMs: LIMIT_RETRY_SECONDS * 1000 });
    throw asFault(new UploadPostError("BuPulse's Upload-Post plan does not allow this right now. BuPulse support has been told; the post will be tried again later.", "rate_limit", network, status, code, LIMIT_RETRY_SECONDS), "uploadpost:plan-limit");
  }
  if (status === 404) throw new UploadPostError(`This ${label} connection is no longer there. Reconnect ${label} in Channels.`, "auth", network, status, code);
  // "None of the requested platforms are valid for profile ...: no Linkedin account configured": the network was
  // removed. tiktok_reconnect_required: TikTok's sign-in expired (docs.upload-post.com/guides/post-to-tiktok-api).
  if (status === 400 && (code === "tiktok_reconnect_required" || /no \w+ account configured|not valid for profile|not associated with any profile/i.test(detail))) {
    throw new UploadPostError(`${label} is no longer connected. Reconnect ${label} in Channels.`, "auth", network, status, code);
  }
  // TikTok's own daily cap on Upload-Post's app (passes within the day; not BuPulse's plan).
  if (code === "reached_active_user_cap") throw new UploadPostError("TikTok is busy for today. The post will be tried again later.", "rate_limit", network, status, code, LIMIT_RETRY_SECONDS);
  if (status >= 500) throw new UploadPostError(`Upload-Post had a problem${detail ? `: ${detail.slice(0, 200)}` : ""}`, "temporary", network, status, code, undefined, stage);
  throw new UploadPostError(detail ? detail.slice(0, 300) : `Upload-Post answered ${status}`, "invalid", network, status, code);
}

// ---- Profiles and the connect page ----

export type UploadPostProfile = { username?: string; social_accounts?: Record<string, unknown> };

const KEY_REFUSED = "Upload-Post did not accept BuPulse's key. BuPulse support has been told.";
export const PROFILE_LIMIT_MESSAGE = "BuPulse's LinkedIn and TikTok partner has no room for another company right now. BuPulse has been told; try again later.";
/** While the profile limit is known, a new profile is asked for at most this often (the owner may have freed one). */
const PROFILE_RETRY_MS = 30 * 60_000;
let lastProfileTryAt = 0;

/** Upload-Post's words for "your plan holds no more profiles". */
export function isProfileLimit(detail: string, code?: string): boolean {
  return /profile[_ ]?limit|limit.*profiles?|profiles?.*limit|maximum (number of )?profiles|max(imum)?_profiles/i.test(`${code ?? ""} ${detail}`);
}

/**
 * Makes sure the business's profile exists: created on first use, reused after (409 "already exists"). Upload-Post's
 * free plan holds 2 profiles: at the limit (403) a profile that already exists is still used; a new one cannot be made,
 * which is ONE Admin -> Health item (not an error per Connect press), and while it lasts a new profile is asked for at
 * most every 30 minutes, so pressing Connect again only costs one cheap look-up.
 */
export async function ensureProfile(network: Network, username: string, displayName: string): Promise<void> {
  const limitKnown = Boolean(await activeServiceFault("uploadpost:profile-limit"));
  if (limitKnown && Date.now() - lastProfileTryAt < PROFILE_RETRY_MS) {
    if (await getProfile(network, username).then(Boolean, () => false)) return;
    await tellOwner("uploadpost:profile-limit", "a company could not connect (limit still reached)");
    throw asFault(new UploadPostError(PROFILE_LIMIT_MESSAGE, "rate_limit", network, 403, "profile_limit", LIMIT_RETRY_SECONDS), "uploadpost:profile-limit");
  }
  lastProfileTryAt = Date.now();
  try {
    await uploadPostApi(network, "POST", "/uploadposts/users", { username, ...(displayName.trim() ? { display_name: displayName.trim().slice(0, 100) } : {}) }, { profileCreate: true });
    // Made: there is room again.
    await clearServiceFault("uploadpost:profile-limit");
  } catch (error) {
    if (error instanceof UploadPostError && error.status === 409) return;
    if (error instanceof UploadPostError && (error.status === 403 || (error.status !== 429 && isProfileLimit(error.message, error.code)))) {
      if (await getProfile(network, username).then(Boolean, () => false)) return;
      await tellOwner("uploadpost:profile-limit", error.message || "profile limit reached");
      throw asFault(new UploadPostError(PROFILE_LIMIT_MESSAGE, "rate_limit", network, 403, "profile_limit", LIMIT_RETRY_SECONDS), "uploadpost:profile-limit");
    }
    throw error;
  }
}

/** The profile and its connected accounts (`social_accounts.linkedin` / `.tiktok` once connected), or null when it does not exist. */
export async function getProfile(network: Network, username: string): Promise<UploadPostProfile | null> {
  try {
    const r = await uploadPostApi<{ profile?: UploadPostProfile }>(network, "GET", `/uploadposts/users/${encodeURIComponent(username)}`);
    return r.profile ?? null;
  } catch (error) {
    if (error instanceof UploadPostError && error.status === 404) return null;
    throw error;
  }
}

const CONNECT_TEXT = {
  linkedin: { connect_title: "Connect LinkedIn to BuPulse", connect_description: "Press LinkedIn and sign in. Then press Back to BuPulse to choose where BuPulse posts: your company Page or your profile." },
  tiktok: { connect_title: "Connect TikTok to BuPulse", connect_description: "Press TikTok and sign in to your TikTok account. Then press Back to BuPulse." },
};

/**
 * Upload-Post's hosted connect page for this profile, showing only `network`, which sends the person back to
 * `redirectUrl` (its "Back to BuPulse" button). The link holds a token valid 48 hours.
 */
export async function connectLink(network: Network, username: string, redirectUrl: string): Promise<string> {
  const r = await uploadPostApi<{ access_url?: string }>(network, "POST", "/uploadposts/users/generate-jwt", {
    username,
    redirect_url: redirectUrl,
    platforms: [network],
    show_calendar: false,
    ...CONNECT_TEXT[network === "tiktok" ? "tiktok" : "linkedin"],
    redirect_button_text: "Back to BuPulse",
  });
  if (!r.access_url || !/^https:\/\//.test(r.access_url)) throw new UploadPostError("Upload-Post did not return a sign-in link", "temporary", network, 200);
  return r.access_url;
}

export type UploadPostPage = { id?: unknown; name?: unknown; picture?: unknown; vanityName?: unknown };

/** The LinkedIn company Pages the profile's LinkedIn member administers ([] when there are none: Upload-Post answers 404). */
export async function linkedinPages(username: string): Promise<UploadPostPage[]> {
  try {
    const r = await uploadPostApi<{ pages?: UploadPostPage[] }>("linkedin", "GET", `/uploadposts/linkedin/pages?profile=${encodeURIComponent(username)}`);
    return Array.isArray(r.pages) ? r.pages : [];
  } catch (error) {
    if (error instanceof UploadPostError && error.status === 404) return [];
    throw error;
  }
}

/** What the profile's TikTok account allows (GET /uploadposts/tiktok/settings: docs.upload-post.com/api/get-tiktok-settings). */
export type TikTokSettings = { privacy_level_options?: unknown; max_video_post_duration_sec?: unknown };

/** The profile's TikTok publishing settings, cached a few minutes on Upload-Post's side. */
export const tiktokSettings = (username: string) => uploadPostApi<TikTokSettings>("tiktok", "GET", `/uploadposts/tiktok/settings?profile=${encodeURIComponent(username)}`, undefined, { timeoutMs: 10_000 });

/** Unlinks one network from the profile (best effort): Upload-Post then forgets its tokens. */
export async function disconnectNetwork(network: Network, username: string): Promise<void> {
  await uploadPostApi(network, "DELETE", "/uploadposts/users/social", { profile_username: username, social_platform: network }).catch(() => undefined);
}

// ---- Uploads ----

/** Starts an upload (/upload_text, /upload_photos or /upload). A timeout or 5xx here is "final": never resent. */
export const startUpload = <T>(network: Network, path: "/upload_text" | "/upload_photos" | "/upload", form: FormData) => uploadPostApi<T>(network, "POST", path, form, { final: true });

/** Where an asynchronous upload is (GET /uploadposts/status?request_id=...). */
export const uploadStatus = <T>(network: Network, requestId: string) => uploadPostApi<T>(network, "GET", `/uploadposts/status?request_id=${encodeURIComponent(requestId)}`, undefined, { timeoutMs: 10_000 });

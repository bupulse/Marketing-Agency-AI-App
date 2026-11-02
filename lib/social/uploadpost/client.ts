import "server-only";
import { logError } from "@/lib/errors";
import { SocialError, type Network } from "../types";

// Upload-Post (upload-post.com): BuPulse's own account (UPLOAD_POST_API_KEY, Admin -> Services -> Upload-Post) connects
// the clients' LinkedIn through Upload-Post's approved LinkedIn app, Pages included. Clients never need an Upload-Post
// account: each business is one Upload-Post "profile" (./ways.ts profileUsername), and Upload-Post keeps the LinkedIn
// tokens. BuPulse stores only the profile's name on the connection.
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
export type CallOptions = { final?: boolean; timeoutMs?: number };

const messageOf = (a: Answer) => (typeof a.error === "object" ? a.error?.message : a.error) || a.message || "";

/** Upload-Post's own limits and key problems are for the owner to fix: they go to Admin -> Errors too. */
async function tellOwner(network: Network, status: number, detail: string) {
  try {
    await logError(new Error(`Upload-Post ${status}: ${detail}`.slice(0, 300)), { source: "social.uploadpost", network, level: "warn" });
  } catch {
    // Logging never stops the answer.
  }
}

/**
 * One Upload-Post API call (`Authorization: Apikey <key>`). JSON bodies for the profile calls, multipart forms for
 * the uploads. Upload-Post failing (bad key, outage, BuPulse's plan limits) is never the client's fault.
 */
export async function uploadPostApi<T>(network: Network, method: "GET" | "POST" | "DELETE", path: string, body?: Record<string, unknown> | FormData, options: CallOptions = {}): Promise<T> {
  const key = process.env.UPLOAD_POST_API_KEY?.trim();
  if (!key) throw new UploadPostError("LinkedIn through Upload-Post is not set up yet", "temporary", network, 0);
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
    throw new UploadPostError("Could not reach Upload-Post, BuPulse's LinkedIn partner", "temporary", network, 0, undefined, undefined, stage);
  }
  const json = (await response.json().catch(() => ({}))) as T & Answer;
  if (response.ok) return json;

  const detail = messageOf(json);
  const code = json.error_code;
  const status = response.status;
  if (status === 401) {
    await tellOwner(network, status, detail || "the API key was refused");
    throw new UploadPostError("Upload-Post did not accept BuPulse's key. BuPulse support has been told.", "temporary", network, status, code);
  }
  if (status === 429) {
    await tellOwner(network, status, detail || "limit reached");
    const used = json.usage?.limit ? ` (${json.usage.count ?? json.usage.limit} of ${json.usage.limit} this month)` : "";
    throw new UploadPostError(`BuPulse reached its LinkedIn posting limit with Upload-Post${used}. BuPulse support has been told; the post will be tried again later.`, "rate_limit", network, status, code, Number(response.headers.get("retry-after")) || LIMIT_RETRY_SECONDS);
  }
  if (status === 403) {
    await tellOwner(network, status, `${code ?? ""} ${detail}`.trim() || "plan restriction");
    throw new UploadPostError("BuPulse's Upload-Post plan does not allow this right now. BuPulse support has been told; the post will be tried again later.", "rate_limit", network, status, code, LIMIT_RETRY_SECONDS);
  }
  if (status === 404) throw new UploadPostError("This LinkedIn connection is no longer there. Reconnect LinkedIn in Channels.", "auth", network, status, code);
  // "None of the requested platforms are valid for profile ...: no Linkedin account configured": LinkedIn was removed.
  if (status === 400 && /no \w+ account configured|not valid for profile|not associated with any profile/i.test(detail)) {
    throw new UploadPostError("LinkedIn is no longer connected. Reconnect LinkedIn in Channels.", "auth", network, status, code);
  }
  if (status >= 500) throw new UploadPostError(`Upload-Post had a problem${detail ? `: ${detail.slice(0, 200)}` : ""}`, "temporary", network, status, code, undefined, stage);
  throw new UploadPostError(detail ? detail.slice(0, 300) : `Upload-Post answered ${status}`, "invalid", network, status, code);
}

// ---- Profiles and the connect page ----

export type UploadPostProfile = { username?: string; social_accounts?: Record<string, unknown> };

/**
 * Makes sure the business's profile exists: created on first use, reused after (409 "already exists"). Upload-Post's
 * free plan holds 2 profiles: at the limit (403) a profile that already exists is still used.
 */
export async function ensureProfile(network: Network, username: string, displayName: string): Promise<void> {
  try {
    await uploadPostApi(network, "POST", "/uploadposts/users", { username, ...(displayName.trim() ? { display_name: displayName.trim().slice(0, 100) } : {}) });
  } catch (error) {
    if (error instanceof UploadPostError && error.status === 409) return;
    if (error instanceof UploadPostError && error.status === 403 && (await getProfile(network, username).then(Boolean, () => false))) return;
    throw error;
  }
}

/** The profile and its connected accounts (`social_accounts.linkedin` once LinkedIn is connected), or null when it does not exist. */
export async function getProfile(network: Network, username: string): Promise<UploadPostProfile | null> {
  try {
    const r = await uploadPostApi<{ profile?: UploadPostProfile }>(network, "GET", `/uploadposts/users/${encodeURIComponent(username)}`);
    return r.profile ?? null;
  } catch (error) {
    if (error instanceof UploadPostError && error.status === 404) return null;
    throw error;
  }
}

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
    connect_title: "Connect LinkedIn to BuPulse",
    connect_description: "Press LinkedIn and sign in. Then press Back to BuPulse to choose where BuPulse posts: your company Page or your profile.",
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

/** Unlinks one network from the profile (best effort): Upload-Post then forgets its tokens. */
export async function disconnectNetwork(network: Network, username: string): Promise<void> {
  await uploadPostApi(network, "DELETE", "/uploadposts/users/social", { profile_username: username, social_platform: network }).catch(() => undefined);
}

// ---- Uploads ----

/** Starts an upload (/upload_text, /upload_photos or /upload). A timeout or 5xx here is "final": never resent. */
export const startUpload = <T>(network: Network, path: "/upload_text" | "/upload_photos" | "/upload", form: FormData) => uploadPostApi<T>(network, "POST", path, form, { final: true });

/** Where an asynchronous upload is (GET /uploadposts/status?request_id=...). */
export const uploadStatus = <T>(network: Network, requestId: string) => uploadPostApi<T>(network, "GET", `/uploadposts/status?request_id=${encodeURIComponent(requestId)}`, undefined, { timeoutMs: 10_000 });

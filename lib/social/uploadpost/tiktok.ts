import "server-only";
import { SocialError, type AccountChoice, type ConnectionCredentials, type PublishRequest, type PublishResult } from "../types";
import { getProfile, tiktokSettings, UploadPostError } from "./client";
import { shortTitle } from "./linkedin";
import { asObject, https, runUpload, str, type Entry } from "./upload";

// TikTok through Upload-Post: the account a sign-in posts to and publishing one video or photos (TikTok's photo mode)
// there, public by default. For these connections `credentials.uploadPostProfile` names the Upload-Post profile.
// https://docs.upload-post.com/api/upload-video, /api/upload-photo, /api/get-tiktok-settings, /api/upload-status,
// /api/user-profiles and /guides/post-to-tiktok-api (read 3 November 2026). Upload-Post's TikTok posting is on its paid
// plans only (./ways.ts tiktokViaUploadPost); nothing here has been checked against a live TikTok answer yet.

const T = "tiktok" as const;
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
/** TikTok photo posts: up to 35 pictures (docs: /api/upload-photo). */
const MAX_PHOTOS = 35;
/** A photo post's title is at most 90 characters; its text goes in tiktok_description (up to 4,000). */
const PHOTO_TITLE = 90;
const MAX_CAPTION = 2200;
const MAX_DESCRIPTION = 4000;

/**
 * The account out of the profile's TikTok entry: `username` is TikTok's open_id for Upload-Post's app (stable, so a
 * reconnect updates the same connection), `handle` the public @name. The docs show the entry with and without
 * `handle` (unconfirmed which one a live profile gives). Null when the profile has no TikTok connected.
 */
export function tiktokAccountFrom(tiktok: unknown): AccountChoice | null {
  if (!tiktok) return null;
  const e = asObject(tiktok);
  const handle = str(e.handle)?.replace(/^@/, "");
  const id = str(e.username) ?? handle;
  if (!id) return null;
  return { externalAccountId: id, displayName: handle ? `@${handle}` : (str(e.display_name) ?? "TikTok account"), avatarUrl: https(e.social_images), accountType: "creator" };
}

/** The profile's TikTok account (null when TikTok was not connected on Upload-Post's page). */
export async function tiktokAccounts(username: string): Promise<AccountChoice[] | null> {
  const profile = await getProfile(T, username);
  const account = tiktokAccountFrom(asObject(profile?.social_accounts).tiktok);
  return account ? [account] : null;
}

// ---- Privacy ----

const PUBLIC = "PUBLIC_TO_EVERYONE";
/** The widest level after public, for a photo post on an account that cannot post publicly (a private account). */
const NEXT_WIDEST = ["FOLLOWER_OF_CREATOR", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"];

/**
 * The privacy_level to send: public whenever the account allows it. An account that does not (a private account:
 * its options leave out PUBLIC_TO_EVERYONE) gets its own default on a video (privacy_level left out, which the docs say
 * works on every account) and the widest level it has on photos (photo posts need one). Unknown options (the settings
 * could not be read): public, Upload-Post's own default for photos; a private account then fails with
 * tiktok_privacy_unavailable, which posts nothing.
 */
export function privacyFor(options: readonly string[] | null, kind: "video" | "photos"): string | undefined {
  if (!options || options.includes(PUBLIC)) return PUBLIC;
  if (kind === "video") return undefined;
  return NEXT_WIDEST.find((level) => options.includes(level)) ?? options[0];
}

/** The account's privacy options, or null when they cannot be read (anything but a lost connection: that stops the post). */
async function privacyOptions(username: string): Promise<string[] | null> {
  try {
    const settings = await tiktokSettings(username);
    const options = settings.privacy_level_options;
    return Array.isArray(options) ? options.filter((o): o is string => typeof o === "string") : null;
  } catch (error) {
    if (error instanceof UploadPostError && error.kind === "auth") throw error;
    return null;
  }
}

// ---- Publishing ----

const AUTH = [/tiktok_reconnect_required/i, /reauth/i, /re-?connect/i, /expired/i, /revoked/i, /no \w+ account configured/i, /platform_not_configured/i, /unauthori[sz]ed/i, /invalid.?token/i, /access_token_invalid/i, /scope_not_authorized/i];
const LIMIT = [/reached_active_user_cap/i, /spam_risk/i, /too many/i, /\b429\b/, /limit/i, /quota/i];

/**
 * A TikTok failure Upload-Post reported: nothing was posted, so it is never "final". tiktok_media_rejected: TikTok
 * refused the file (sending it again fails again); tiktok_publish_failed: worth another try (the docs: Upload-Post
 * first checks the account for about 2 minutes, so the video is not there); tiktok_privacy_unavailable: the account
 * does not allow that privacy level.
 */
export function failure(message: string, code?: string): SocialError {
  const text = (message || "TikTok did not take the post").slice(0, 300);
  const both = `${code ?? ""} ${text}`;
  if (code === "tiktok_privacy_unavailable" || /privacy_unavailable|privacy_level_option_mismatch/i.test(both)) {
    return new SocialError("TikTok: this account does not allow public posts. Make the TikTok account public, then try again.", "invalid", T);
  }
  if (code === "tiktok_media_rejected" || /media_rejected/i.test(both)) return new SocialError(`TikTok did not accept this video or photo: ${text}`, "invalid", T);
  if (AUTH.some((p) => p.test(both))) return new SocialError("TikTok no longer lets BuPulse post for this account. Reconnect TikTok in Channels.", "auth", T);
  if (LIMIT.some((p) => p.test(both))) return new SocialError(`TikTok: ${text}`, "rate_limit", T, 3600);
  if (code === "tiktok_publish_failed" || /publish_failed/i.test(both)) return new SocialError(`TikTok: ${text}`, "temporary", T);
  return new SocialError(`TikTok: ${text}`, "invalid", T);
}

/**
 * The post's lasting id and link once TikTok has made it public. Until then (TikTok publishes on its own, the link can
 * take about 3 minutes; drafts sent to the inbox have none) platform_post_id is only TikTok's temporary publish id,
 * so it is not used: Upload-Post's request id stands for the post instead.
 */
function lasting(entry: Record<string, unknown>): { externalId?: string; permalink?: string } {
  const permalink = https(entry.post_url) ?? https(entry.url);
  if (!permalink) return {};
  return { externalId: str(entry.platform_post_id) ?? str(entry.post_id) ?? /\/(?:video|photo)\/(\d+)/.exec(permalink)?.[1], permalink };
}

/**
 * Posts on TikTok through Upload-Post: one video (MP4, MOV or WebM) or photos (up to 35, posted as TikTok's photo
 * mode with music added), public unless the account does not allow it (privacyFor), straight to the profile
 * (post_mode DIRECT_POST, Upload-Post's default). The caption is the post's text; TikTok shows no clickable links, so
 * the post's link is not added. Asynchronous, then a few status checks (./upload.ts runUpload).
 *
 * Unconfirmed: whether Upload-Post converts PNG pictures for TikTok (its docs list JPG, JPEG and WebP; a refused
 * picture comes back as tiktok_media_rejected). Not sent: is_aigc (BuPulse's posts do not yet say which media is AI
 * made) and brand_organic_toggle (TikTok's "promotional content" label: the owner's call).
 */
export async function publishTikTok(c: ConnectionCredentials, post: PublishRequest): Promise<PublishResult> {
  const user = c.uploadPostProfile;
  if (!user) throw new SocialError("This TikTok connection is incomplete. Reconnect TikTok in Channels.", "auth", T);
  const images = post.media.filter((m) => m.mimeType.startsWith("image/"));
  const videos = post.media.filter((m) => m.mimeType.startsWith("video/"));
  if (images.length + videos.length !== post.media.length || (videos.length && images.length) || videos.length > 1) {
    throw new SocialError("A TikTok post takes one video or photos, not both", "invalid", T);
  }
  if (!videos.length && !images.length) throw new SocialError("A TikTok post needs a video or photos", "invalid", T);
  if (videos.length && !VIDEO_TYPES.has(videos[0].mimeType.toLowerCase())) throw new SocialError("TikTok takes MP4, MOV or WebM videos", "invalid", T);
  if (images.length > MAX_PHOTOS) throw new SocialError(`TikTok takes up to ${MAX_PHOTOS} photos in one post`, "invalid", T);
  const text = (post.format === "ARTICLE" && post.title ? `${post.title}\n\n${post.text}` : post.text).trim();
  const limit = videos.length ? MAX_CAPTION : MAX_DESCRIPTION;
  if (Array.from(text).length > limit) throw new SocialError(`TikTok captions are limited to ${limit.toLocaleString("en-US")} characters`, "invalid", T);

  const kind = videos.length ? "video" : "photos";
  const privacy = privacyFor(await privacyOptions(user), kind);

  // BuPulse's own request id, so the post can be followed even when the answer is lost.
  const ownRequestId = `bp-${crypto.randomUUID()}`;
  const form = new FormData();
  form.append("user", user);
  form.append("request_id", ownRequestId);
  form.append("platform[]", T);
  form.append("async_upload", "true");
  if (privacy) form.append("privacy_level", privacy);
  // TikTok's daily cap on Upload-Post's app: an error (tried again later) instead of a draft in the TikTok inbox that
  // BuPulse would count as posted. The docs say this only applies on older connections; newer ones answer the error.
  form.append("disable_inbox_fallback", "true");
  let path: "/upload_photos" | "/upload";
  if (kind === "video") {
    path = "/upload";
    form.append("video", videos[0].url);
    // A video's caption is its title (up to 2,200 characters); `description` is not used for TikTok.
    if (text) form.append("title", text);
  } else {
    path = "/upload_photos";
    for (const image of images) form.append("photos[]", image.url);
    const title = shortTitle(text, PHOTO_TITLE);
    if (title) form.append("title", title);
    if (text) form.append("tiktok_description", text);
    form.append("auto_add_music", "true");
    form.append("photo_cover_index", "0");
  }

  const { outcome, requestId } = await runUpload(T, path, form, ownRequestId);
  return resultOf(outcome, requestId);
}

function resultOf(outcome: Entry, requestId: string): PublishResult {
  if (outcome.state === "failed") throw failure(outcome.message, outcome.code);
  const { externalId, permalink } = outcome.state === "done" ? lasting(outcome.entry) : {};
  if (externalId) return { externalId, ...(permalink ? { permalink } : {}) };
  // Accepted, not public yet (or finished without a lasting id): Upload-Post's request id stands for the post.
  return { externalId: `uploadpost:${requestId}`, ...(permalink ? { permalink } : {}) };
}

import "server-only";
import { SocialError, type ConnectionCredentials, type MetricsSnapshot, type PublishRequest, type PublishResult } from "../types";
import { shortTitle } from "../uploadpost/linkedin";
import { zernioApi, ZernioError } from "./client";

// TikTok through Zernio: publishing one video or photos (TikTok's photo carousel) straight to the account, public by
// default, and finding the post's TikTok link afterwards. For these connections `credentials.externalAccountId` is
// Zernio's account id and `credentials.zernioProfile` the business's Zernio profile.
// https://docs.zernio.com/platforms/tiktok, /platforms/tiktok/posts, /platforms/tiktok/fields, /platforms/tiktok/media,
// /platforms/tiktok/reference, /posts/create-post, /posts/get-post, /guides/post-lifecycle and
// /accounts/get-tiktok-creator-info (read 3 November 2026). Nothing here has been checked against a live TikTok answer.
//
// Zernio's TikTok connections go through TikTok's Business app (every new connection, the docs say): a video posted
// directly is public only, photo posts keep every privacy level the account allows, and Zernio allows 15 videos and
// 15 photo posts per account per rolling 24 hours (a post past it is held and published by Zernio later, not failed).

const T = "tiktok" as const;
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
/** TikTok photo carousels: up to 35 pictures (JPEG, PNG or WebP). */
const MAX_PHOTOS = 35;
/** A photo post's title (`content`) is cut to 90 characters by Zernio; its full text goes in `description` (4,000). */
const PHOTO_TITLE = 90;
const MAX_CAPTION = 2200;
const MAX_DESCRIPTION = 4000;
/** publishNow publishes inside the request: a large video can take a while (TikTok pulls it from the signed link). */
const PUBLISH_TIMEOUT_MS = 120_000;
/** TikTok's own "too many posts in 24 hours" and Zernio's account cooldowns: try again a few hours later. */
const DAY_LIMIT_RETRY_SECONDS = 3 * 60 * 60;

// ---- Privacy and the interaction switches ----

const PUBLIC = "PUBLIC_TO_EVERYONE";
/** The widest level after public, for an account that cannot post publicly (a private account). */
const NEXT_WIDEST = ["FOLLOWER_OF_CREATOR", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"];

/**
 * The privacy_level to send (Zernio requires one on every TikTok post): public whenever the account allows it, or when
 * its levels cannot be read. A private account (no public level) gets its widest level; on a video Zernio's Business
 * app lane refuses anything but public, which fails with "Selected privacy level ... is not available" (nothing posted)
 * and the client is told to make the account public (failure()).
 */
export function privacyFor(levels: readonly string[] | null): string {
  if (!levels || !levels.length || levels.includes(PUBLIC)) return PUBLIC;
  return NEXT_WIDEST.find((level) => levels.includes(level)) ?? levels[0];
}

/** What creator info says about the account (GET /v1/accounts/{id}/tiktok/creator-info?mediaType=video|photo). */
export type CreatorInfo = { levels: string[] | null; comment: boolean; duet: boolean; stitch: boolean };

type Toggle = { enabled?: unknown } | null | undefined;
/** An interaction is on unless the creator switched it off in the TikTok app (`enabled: false`). */
const on = (t: Toggle) => !(t && t.enabled === false);

/**
 * The account's privacy levels and whether comments, duets and stitches are allowed. TikTok forbids defaulting these
 * switches and BuPulse has no screen for them yet, so each is on where the creator allows it (Zernio's own example
 * turns all three on); the owner may want a setting later. Unreadable (anything but a lost connection, which stops the
 * post): public with comments, duets and stitches on.
 */
export async function creatorInfo(accountId: string, kind: "video" | "photo"): Promise<CreatorInfo> {
  try {
    const r = await zernioApi<{ privacyLevels?: unknown; postingLimits?: { interactionSettings?: Record<string, Toggle> } }>(T, "GET", `/accounts/${encodeURIComponent(accountId)}/tiktok/creator-info?mediaType=${kind}`, undefined, { timeoutMs: 10_000 });
    const levels = Array.isArray(r.json.privacyLevels) ? r.json.privacyLevels.map((l) => (l && typeof l === "object" ? (l as { value?: unknown }).value : l)).filter((v): v is string => typeof v === "string") : null;
    const toggles = r.json.postingLimits?.interactionSettings ?? {};
    return { levels, comment: on(toggles.allow_comment), duet: on(toggles.allow_duet), stitch: on(toggles.allow_stitch) };
  } catch (error) {
    if (error instanceof ZernioError && error.kind === "auth") throw error;
    return { levels: null, comment: true, duet: true, stitch: true };
  }
}

// ---- Failures ----

const AUTH = [/missing required tiktok permissions/i, /missing_tiktok_permissions/i, /reconnect/i, /re-?auth/i, /expired/i, /revoked/i, /access_token_invalid/i, /invalid.?token/i, /scope_not_authorized/i, /unauthori[sz]ed/i, /disconnected/i];
const DAY_LIMIT = [/too many posts/i, /at capacity/i, /active user quota/i, /reached_active_user_cap/i, /spam_risk_too_many/i, /daily/i, /cooldown/i, /rate.?limit/i, /quota/i];

/**
 * A TikTok entry Zernio marked failed (`errorMessage`, `errorCategory`; docs: /guides/post-lifecycle). Nothing was
 * posted, so it is never "final", except Zernio's "timeout waiting for platform response", which the docs call normal
 * for a large video still being processed: the video may still appear, so it is never resent.
 */
export function failure(message: string, category?: string): SocialError {
  const words = (message || "TikTok did not take the post").slice(0, 300);
  if (/timeout waiting for platform/i.test(words)) return new SocialError(`TikTok is still processing this video: ${words}`, "temporary", T, undefined, "final");
  if (/privacy level/i.test(words)) return new SocialError("TikTok: this account does not allow public posts. Make the TikTok account public, then try again.", "invalid", T);
  if (category === "auth_expired" || AUTH.some((p) => p.test(words))) return new SocialError("TikTok no longer lets BuPulse post for this account. Reconnect TikTok in Channels.", "auth", T);
  if (category === "user_abuse" || category === "platform_rate_limit" || category === "quota_exhausted" || DAY_LIMIT.some((p) => p.test(words))) {
    return new SocialError(`TikTok: ${words}`, "rate_limit", T, category === "platform_rate_limit" ? 3600 : DAY_LIMIT_RETRY_SECONDS);
  }
  // TikTok could not download the media from its link: the next try signs fresh links.
  if (category === "platform_error" || category === "system_error" || /download failed/i.test(words)) return new SocialError(`TikTok: ${words}`, "temporary", T);
  // user_content, platform_rejected (moderation, "Duplicate content detected"), account_issue and anything unknown.
  return new SocialError(`TikTok: ${words}`, "invalid", T);
}

// ---- Publishing ----

type Entry = { platform?: unknown; status?: unknown; platformPostId?: unknown; platformPostUrl?: unknown; errorMessage?: unknown; errorCategory?: unknown };
type Post = { _id?: unknown; status?: unknown; platforms?: Entry[] };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const https = (v: unknown) => (typeof v === "string" && /^https:\/\//.test(v) ? v : undefined);
const tiktokEntry = (post: Post | undefined) => (Array.isArray(post?.platforms) ? post.platforms.find((e) => e?.platform === T) : undefined);

/**
 * The post's lasting id and link once TikTok has made it public. TikTok gives the video's id some minutes after
 * publishing, so `platformPostUrl` is empty at first: until then Zernio's post id stands for the post and the metrics
 * job asks again (zernioResolve).
 */
function lasting(entry: Entry | undefined): { externalId?: string; permalink?: string } {
  const permalink = https(entry?.platformPostUrl);
  if (!permalink) return {};
  return { externalId: /\/(?:video|photo)\/(\d+)/.exec(permalink)?.[1] ?? str(entry?.platformPostId), permalink };
}

/**
 * Posts on TikTok through Zernio: one video (MP4, MOV or WebM, 3 seconds to 10 minutes) or photos (up to 35, a photo
 * carousel with TikTok's music added), published at once (`publishNow`) straight to the profile (not the TikTok inbox:
 * `draft` is not sent), public unless the account does not allow it (privacyFor). The caption is the post's text;
 * TikTok shows no clickable links, so the post's link is not added. Media are the signed links, which Zernio downloads.
 *
 * `content_preview_confirmed` and `express_consent_given` are TikTok's required yes: the client saw and approved the
 * post in BuPulse before it was scheduled. Not sent: `video_made_with_ai` (BuPulse's posts do not yet say which media is
 * AI made; Business app photo posts refuse it anyway) and `commercialContentType` (TikTok's promotional label: the
 * owner's call).
 */
export async function publishTikTokViaZernio(c: ConnectionCredentials, post: PublishRequest): Promise<PublishResult> {
  const accountId = c.externalAccountId;
  if (!c.zernioProfile || !accountId) throw new SocialError("This TikTok connection is incomplete. Reconnect TikTok in Channels.", "auth", T);
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

  const kind = videos.length ? "video" : "photo";
  const info = await creatorInfo(accountId, kind);
  const settings: Record<string, unknown> = {
    privacy_level: privacyFor(info.levels),
    allow_comment: info.comment,
    content_preview_confirmed: true,
    express_consent_given: true,
  };
  let content: string;
  let mediaItems: { type: "video" | "image"; url: string }[];
  if (kind === "video") {
    content = text;
    mediaItems = [{ type: "video", url: videos[0].url }];
    settings.allow_duet = info.duet;
    settings.allow_stitch = info.stitch;
  } else {
    content = shortTitle(text, PHOTO_TITLE);
    mediaItems = images.map((m) => ({ type: "image", url: m.url }));
    settings.media_type = "photo";
    settings.photo_cover_index = 0;
    settings.auto_add_music = true;
    if (text) settings.description = text;
  }

  const r = await zernioApi<{ post?: Post }>(
    T,
    "POST",
    "/posts",
    { ...(content ? { content } : {}), mediaItems, platforms: [{ platform: T, accountId }], tiktokSettings: settings, publishNow: true },
    { final: true, timeoutMs: PUBLISH_TIMEOUT_MS },
  );
  return resultOf(r.json.post);
}

/**
 * What a publishNow answer means (201 published, 207 failed or reset to "scheduled", 200 an idempotent replay). A
 * TikTok entry still pending, processing or uploading, or a post Zernio set back to "scheduled" after a passing error
 * (it retries by itself), is accepted: Zernio's post id stands for it.
 */
export function resultOf(post: Post | undefined): PublishResult {
  const id = str(post?._id);
  const entry = tiktokEntry(post);
  const status = str(entry?.status);
  if (status === "failed" || (!entry && post?.status === "failed")) throw failure(str(entry?.errorMessage) ?? "", str(entry?.errorCategory));
  if (status === "cancelled") throw new SocialError("TikTok: Zernio cancelled this post (the account was disconnected). Reconnect TikTok in Channels.", "auth", T);
  if (!id) throw new SocialError("Zernio did not say whether the post went out", "temporary", T, undefined, "final");
  const { externalId, permalink } = status === "published" ? lasting(entry) : {};
  if (externalId) return { externalId, ...(permalink ? { permalink } : {}) };
  return { externalId: `zernio:${id}`, ...(permalink ? { permalink } : {}) };
}

/**
 * For the metrics job: a post saved under Zernio's id gets TikTok's lasting id and link once TikTok has them (GET
 * /v1/posts/{id}). No numbers yet (Zernio has an analytics API; not used).
 */
export async function zernioResolve(externalId: string): Promise<MetricsSnapshot> {
  const id = /^zernio:(.+)$/.exec(externalId)?.[1];
  if (!id) return {};
  const r = await zernioApi<{ post?: Post }>(T, "GET", `/posts/${encodeURIComponent(id)}`, undefined, { timeoutMs: 10_000 });
  const entry = tiktokEntry(r.json.post);
  if (str(entry?.status) !== "published") return {};
  const found = lasting(entry);
  return found.externalId ? { resolved: { externalId: found.externalId, ...(found.permalink ? { permalink: found.permalink } : {}) } } : {};
}

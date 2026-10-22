import "server-only";
import { escapeLittleText } from "../providers/linkedin/text";
import { TIKTOK_PRIVACY_LEVEL } from "../providers/tiktok";
import { finalStage, SocialError, type AccountChoice, type ConnectionCredentials, type MetricsSnapshot, type Network, type PublishRequest, type PublishResult } from "../types";
import { proxyRequest, runTool, uploadFile } from "./client";
import { tiktokDirectPost } from "./ways";

// What each network does through BuPulse-Socials (Composio tools), with the same inputs and results as the direct
// providers in lib/social/providers, so the publisher, metrics and Autopilot do not care which way an account was
// connected. For these connections `credentials.accessToken` holds the Composio connected-account id, not a token.
// Tool inputs: https://docs.composio.dev/toolkits/<network>. Composio passes the network's own answer back in `data`,
// sometimes wrapped once more, so the readers below look one level down too.

type Json = Record<string, unknown>;

export type ComposioNetwork = {
  /** The accounts this sign-in may post to (Pages, the Instagram account, the LinkedIn member and Pages, channels). */
  accounts(connectedAccountId: string, userId: string): Promise<AccountChoice[]>;
  publish(credentials: ConnectionCredentials, post: PublishRequest): Promise<PublishResult>;
  metrics?(credentials: ConnectionCredentials, externalId: string): Promise<MetricsSnapshot>;
};

const asObject = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

/** The first array of objects found in `data` (itself, or one or two levels down: data.data, response_data.items...). */
function listIn(data: unknown): Json[] {
  if (Array.isArray(data)) return data.filter((x) => x && typeof x === "object") as Json[];
  const o = asObject(data);
  for (const key of ["data", "items", "pages", "elements", "videos", "response_data"]) {
    const found = o[key];
    if (Array.isArray(found)) return found.filter((x) => x && typeof x === "object") as Json[];
    if (found && typeof found === "object") {
      const deeper = listIn(found);
      if (deeper.length) return deeper;
    }
  }
  return [];
}

/** A field of the answer, or of the answer's own `data` / `response_data`. */
function field(data: unknown, ...names: string[]): unknown {
  const layers = [asObject(data), asObject(asObject(data).data), asObject(asObject(data).response_data)];
  for (const layer of layers) for (const name of names) if (layer[name] !== undefined && layer[name] !== null && layer[name] !== "") return layer[name];
  return undefined;
}

const text = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);

function requireId(network: Network, data: unknown, ...names: string[]): string {
  const id = text(field(data, ...names));
  if (!id) throw new SocialError(`${network} did not say which post was made`, "temporary", network, undefined, "final");
  return id;
}

const isVideo = (m: { mimeType: string }) => m.mimeType.toLowerCase().startsWith("video/");

// ---- Facebook Pages ----

const facebook: ComposioNetwork = {
  async accounts(account, userId) {
    const data = await runTool("facebook", "FACEBOOK_LIST_MANAGED_PAGES", account, userId, { fields: "id,name,category,picture{url}", limit: 100 });
    const pages = listIn(data).filter((p) => text(p.id));
    if (!pages.length) throw new SocialError("No Facebook Pages found for this login", "invalid", "facebook");
    return pages.map((p) => ({
      externalAccountId: text(p.id)!,
      displayName: text(p.name) ?? "Facebook Page",
      avatarUrl: text(asObject(asObject(p.picture).data).url),
      accountType: "page",
    }));
  },

  async publish(c, post) {
    const F = "facebook" as const;
    const page = c.externalAccountId;
    const run = (slug: string, args: Json) => runTool(F, slug, c.accessToken, c.composioUserId, { page_id: page, ...args });
    const videos = post.media.filter(isVideo);
    const images = post.media.filter((m) => m.mimeType.startsWith("image/"));
    let data: unknown;
    if (videos.length) {
      if (post.media.length > 1) throw new SocialError("Facebook posts a video on its own, without photos", "invalid", F);
      data = await finalStage(F, () => run("FACEBOOK_CREATE_VIDEO_POST", { file_url: videos[0].url, description: post.text || undefined, published: true }));
    } else {
      if (images.length !== post.media.length) throw new SocialError("Facebook posts support images and videos only", "invalid", F);
      if (!post.text.trim() && !images.length && !post.link) throw new SocialError("A Facebook post needs text, a link or a photo", "invalid", F);
      if (images.length === 0) data = await finalStage(F, () => run("FACEBOOK_CREATE_POST", { message: post.text || "", link: post.link || undefined, published: true }));
      else if (images.length === 1) data = await finalStage(F, () => run("FACEBOOK_CREATE_PHOTO_POST", { url: images[0].url, message: post.text || undefined, published: true }));
      else data = await finalStage(F, () => run("FACEBOOK_CREATE_MULTI_PHOTO_POST", { photo_urls: images.map((m) => m.url), message: post.text || undefined }));
    }
    const externalId = requireId(F, data, "post_id", "id");
    const permalink = await runTool(F, "FACEBOOK_GET_POST", c.accessToken, c.composioUserId, { post_id: externalId, fields: "permalink_url" }).then(
      (d) => text(field(d, "permalink_url")),
      () => undefined,
    );
    return { externalId, permalink };
  },

  async metrics(c, externalId) {
    const d = await runTool("facebook", "FACEBOOK_GET_POST", c.accessToken, c.composioUserId, { post_id: externalId, fields: "reactions.summary(true).limit(0),comments.summary(true).limit(0),shares" });
    const summary = (key: string) => num(asObject(asObject(field(d, key)).summary).total_count);
    return { likes: summary("reactions"), comments: summary("comments"), shares: num(asObject(field(d, "shares")).count) ?? 0 };
  },
};

// ---- Instagram (Business and Creator accounts) ----

const IG_TYPES: Record<string, string> = { BUSINESS: "business", MEDIA_CREATOR: "creator", CREATOR: "creator" };

function assertInstagramMedia(post: PublishRequest) {
  const E = "instagram" as const;
  if (!post.media.length) throw new SocialError("Instagram posts need at least one image", "invalid", E);
  if (post.media.some(isVideo)) {
    if (post.media.length > 1) throw new SocialError("Instagram posts a video on its own, without photos", "invalid", E);
    if (post.media[0].mimeType.toLowerCase() !== "video/mp4") throw new SocialError("Instagram only accepts MP4 videos", "invalid", E);
    return;
  }
  if (post.media.length > 10) throw new SocialError("Instagram carousels have at most 10 images", "invalid", E);
  if (post.media.some((m) => m.mimeType.toLowerCase() !== "image/jpeg")) throw new SocialError("Instagram only accepts JPEG images. Please use a JPG photo.", "invalid", E);
}

const instagram: ComposioNetwork = {
  async accounts(account, userId) {
    const d = await runTool("instagram", "INSTAGRAM_GET_USER_INFO", account, userId, { ig_user_id: "me", fields: "id,user_id,username,name,account_type,profile_picture_url" });
    const id = text(field(d, "user_id", "id"));
    if (!id) throw new SocialError("No Instagram account found for this login", "invalid", "instagram");
    // Professional accounts only: Instagram does not let apps post to personal ones.
    const type = String(field(d, "account_type") ?? "").toUpperCase();
    if (type && !IG_TYPES[type]) throw new SocialError("No Instagram professional account found for this login", "invalid", "instagram");
    const username = text(field(d, "username"));
    return [{ externalAccountId: id, displayName: username ? `@${username}` : (text(field(d, "name")) ?? id), avatarUrl: text(field(d, "profile_picture_url")), accountType: IG_TYPES[type] ?? "business" }];
  },

  async publish(c, post) {
    const E = "instagram" as const;
    assertInstagramMedia(post);
    const ig = c.externalAccountId;
    const run = (slug: string, args: Json) => runTool(E, slug, c.accessToken, c.composioUserId, { ig_user_id: ig, ...args });
    // The caption goes as-is: Composio encodes it (its tool notes say to write "#" as %23, but that shows "%23" on Instagram).
    const caption = post.text;
    let container: unknown;
    if (post.media.length === 1 && isVideo(post.media[0])) container = await run("INSTAGRAM_POST_IG_USER_MEDIA", { media_type: "REELS", video_url: post.media[0].url, caption, share_to_feed: true });
    else if (post.media.length === 1) container = await run("INSTAGRAM_POST_IG_USER_MEDIA", { image_url: post.media[0].url, caption });
    else container = await run("INSTAGRAM_CREATE_CAROUSEL_CONTAINER", { child_image_urls: post.media.map((m) => m.url), caption });
    const creationId = text(field(container, "id", "creation_id", "container_id"));
    if (!creationId) throw new SocialError("Instagram did not accept the photos", "temporary", E);
    // Composio waits for the container to finish; Netlify stops a function at 60 s, so the wait stays short and a
    // container still processing is retried later (nothing was published yet).
    const published = await finalStage(E, () => run("INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH", { creation_id: creationId, max_wait_seconds: 25 }));
    const externalId = requireId(E, published, "id", "media_id");
    const permalink = await runTool(E, "INSTAGRAM_GET_IG_MEDIA", c.accessToken, c.composioUserId, { ig_media_id: externalId, fields: "permalink" }).then(
      (d) => text(field(d, "permalink")),
      () => undefined,
    );
    return { externalId, permalink };
  },

  async metrics(c, externalId) {
    const d = await runTool("instagram", "INSTAGRAM_GET_IG_MEDIA", c.accessToken, c.composioUserId, { ig_media_id: externalId, fields: "like_count,comments_count" });
    return { likes: num(field(d, "like_count")), comments: num(field(d, "comments_count")) };
  },
};

// ---- LinkedIn (the member's profile and the Pages they administer) ----

const linkedin: ComposioNetwork = {
  async accounts(account, userId) {
    const me = await runTool("linkedin", "LINKEDIN_GET_MY_INFO", account, userId, {});
    const raw = text(field(me, "sub", "id", "author_id", "person_id")) ?? "";
    const memberId = raw.replace(/^urn:li:person:/, "");
    const accounts: AccountChoice[] = [];
    if (memberId) {
      const first = text(field(me, "localizedFirstName", "given_name"));
      const last = text(field(me, "localizedLastName", "family_name"));
      accounts.push({ externalAccountId: memberId, displayName: text(field(me, "name")) ?? ([first, last].filter(Boolean).join(" ") || "LinkedIn member"), avatarUrl: text(field(me, "picture")), accountType: "member" });
    }
    // Pages are a bonus: Composio's app may not have the organization permissions, and then the member is enough.
    const orgs = await runTool("linkedin", "LINKEDIN_GET_COMPANY_INFO", account, userId, { role: "ADMINISTRATOR", state: "APPROVED", count: 50 }).catch(() => null);
    const ids = new Set([...JSON.stringify(orgs ?? {}).matchAll(/urn:li:organization:(\d+)/g)].map((m) => m[1]));
    for (const id of ids) accounts.push({ externalAccountId: id, displayName: `LinkedIn Page ${id}`, accountType: "organization" });
    if (!accounts.length) throw new SocialError("No LinkedIn profile found for this login", "invalid", "linkedin");
    return accounts;
  },

  async publish(c, post) {
    const E = "linkedin" as const;
    const author = c.accountType === "organization" ? `urn:li:organization:${c.externalAccountId}` : `urn:li:person:${c.externalAccountId}`;
    const images = post.media.filter((m) => m.mimeType.startsWith("image/"));
    if (images.length !== post.media.length) throw new SocialError("LinkedIn posts through BuPulse support photos only", "invalid", E);
    const body = post.format === "ARTICLE" && post.title ? `${post.title}\n\n${post.text}` : post.text;
    let commentary = escapeLittleText(body);
    if (post.link && !images.length && !body.includes(post.link)) commentary += `\n\n${escapeLittleText(post.link, { hashtags: false })}`;
    if (!commentary.trim() && !images.length) throw new SocialError("A LinkedIn post needs text or a photo", "invalid", E);
    const files: Awaited<ReturnType<typeof uploadFile>>[] = [];
    for (const [i, m] of images.entries()) files.push(await uploadFile(E, "LINKEDIN_CREATE_LINKED_IN_POST", m.url, m.mimeType, `photo-${i + 1}.${m.mimeType.split("/")[1] ?? "jpg"}`));
    const data = await finalStage(E, () =>
      runTool(E, "LINKEDIN_CREATE_LINKED_IN_POST", c.accessToken, c.composioUserId, { author, commentary, visibility: "PUBLIC", lifecycleState: "PUBLISHED", ...(files.length ? { images: files } : {}) }),
    );
    // Composio answers { x_restli_id: "urn:li:share:..." } (LinkedIn's x-restli-id header).
    const externalId = requireId(E, data, "x_restli_id", "id", "post_id", "x-restli-id", "urn");
    return { externalId, permalink: `https://www.linkedin.com/feed/update/${externalId}` };
  },
};

// ---- YouTube (channels; posts stay scripts, as with the direct app) ----

const youtube: ComposioNetwork = {
  async accounts(account, userId) {
    const d = await runTool("youtube", "YOUTUBE_LIST_CHANNELS", account, userId, { mine: true, part: "snippet", maxResults: 50 });
    const channels = listIn(d).filter((ch) => text(ch.id));
    if (!channels.length) throw new SocialError("No YouTube channel found for this login", "invalid", "youtube");
    return channels.map((ch) => {
      const snippet = asObject(ch.snippet);
      return { externalAccountId: text(ch.id)!, displayName: text(snippet.title) ?? "YouTube channel", avatarUrl: text(asObject(asObject(snippet.thumbnails).default).url), accountType: "channel" };
    });
  },
  async publish() {
    throw new SocialError("YouTube posts are scripts for now: BuPulse does not upload videos yet", "invalid", "youtube");
  },
};

// ---- TikTok (BuPulse's own TikTok app: COMPOSIO_TIKTOK_AUTH_CONFIG_ID) ----
// Composio has TikTok tools (docs.composio.dev/toolkits/tiktok) but does not say which fields they answer, so BuPulse
// calls TikTok's own documented endpoints through Composio's proxy, with the account's sign-in. Videos go up as
// FILE_UPLOAD: BuPulse puts the bytes on TikTok's upload_url itself (that link needs no sign-in and no verified
// domain, which signed storage links can never have). Photos stay reminders: TikTok pulls photos only from a verified
// domain. https://developers.tiktok.com/doc/content-posting-api-get-started

const TIKTOK_API = "https://open.tiktokapis.com/v2";
const TT_VIDEO_FIELDS = "id,share_url,view_count,like_count,comment_count,share_count";
const TT_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
/** TikTok takes a file under 64 MB in one piece; bigger ones go in pieces of 10 MB, the last one taking the rest. */
const TT_ONE_PIECE = 64_000_000;
const TT_PIECE = 10_000_000;
/** Bigger than any Gallery video (docs/MEDIA.md); BuPulse holds the whole file while it sends it. */
const TT_MAX_BYTES = 250_000_000;

// TikTok's error codes (the direct provider's lists, lib/social/providers/tiktok.ts), with plain words for the owner.
const TT_AUTH = ["access_token_invalid", "scope_not_authorized", "auth_removed"];
const TT_RATE = ["rate_limit_exceeded", "spam_risk_too_many_posts", "spam_risk_too_many_pending_share", "reached_active_user_cap"];
const TT_INVALID = ["unaudited_client_can_only_post_to_private_accounts", "privacy_level_option_mismatch", "spam_risk_user_banned_from_posting", "invalid_param", "file_format_check_failed", "duration_check_failed"];
const TT_WORDS: Record<string, string> = {
  unaudited_client_can_only_post_to_private_accounts: "TikTok lets BuPulse post only to private accounts until BuPulse's TikTok app is approved.",
  spam_risk_too_many_pending_share: "TikTok keeps at most 5 videos a day waiting in your TikTok inbox. Post the ones waiting there first.",
  spam_risk_too_many_posts: "TikTok says this account posted too much today. We will try again later.",
};

function ttError(code: string, message: string): SocialError {
  const words = TT_WORDS[code] ?? `TikTok: ${message || code}`;
  if (TT_AUTH.includes(code)) return new SocialError(words, "auth", "tiktok");
  if (TT_RATE.includes(code)) return new SocialError(words, "rate_limit", "tiktok", 3600);
  if (TT_INVALID.includes(code)) return new SocialError(words, "invalid", "tiktok");
  return new SocialError(words, "temporary", "tiktok");
}

type Account = { account: string; userId: string | undefined };

/** One TikTok call through the proxy. TikTok answers HTTP 200 with error.code "ok" when it worked. */
async function tiktokCall(who: Account, request: { endpoint: string; method: "GET" | "POST"; body?: Json }): Promise<Json> {
  let d: Json;
  try {
    d = await proxyRequest("tiktok", who.account, who.userId, { ...request, endpoint: `${TIKTOK_API}${request.endpoint}` });
  } catch (error) {
    // A 4xx: the proxy's message carries TikTok's code as "(#code)".
    const code = error instanceof SocialError ? [...TT_AUTH, ...TT_RATE, ...TT_INVALID].find((c) => error.message.includes(c)) : undefined;
    throw code ? ttError(code, (error as SocialError).message) : error;
  }
  const err = asObject(d.error);
  const code = text(err.code);
  if (code && code !== "ok") throw ttError(code, text(err.message) ?? "");
  return asObject(d.data);
}

/** TikTok video ids are int64: one sent as a JSON number may have lost its last digits, so it is matched, not used. */
const exactId = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? v : typeof v === "number" && Number.isSafeInteger(v) ? String(v) : undefined);

async function download(network: Network, url: string): Promise<Uint8Array> {
  const source = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!source?.ok) throw new SocialError("The video on this post could not be read from storage", "temporary", network);
  return new Uint8Array(await source.arrayBuffer());
}

/** The pieces TikTok expects (https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide). */
export function tiktokPieces(size: number): { chunk_size: number; total_chunk_count: number } {
  if (size <= TT_ONE_PIECE) return { chunk_size: size, total_chunk_count: 1 };
  return { chunk_size: TT_PIECE, total_chunk_count: Math.floor(size / TT_PIECE) };
}

/** Puts piece `i` of the video on TikTok's upload_url (no sign-in needed: the link itself is the permission). */
async function putPiece(uploadUrl: string, bytes: Uint8Array, mimeType: string, i: number) {
  const { chunk_size, total_chunk_count } = tiktokPieces(bytes.length);
  const start = i * chunk_size;
  const end = i === total_chunk_count - 1 ? bytes.length : start + chunk_size;
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": mimeType, "content-range": `bytes ${start}-${end - 1}/${bytes.length}` },
    body: bytes.slice(start, end),
    signal: AbortSignal.timeout(40_000),
  }).catch(() => null);
  if (!res) throw new SocialError("TikTok did not answer while the video was sent", "temporary", "tiktok");
  if (!res.ok) throw new SocialError(`TikTok refused the video (error ${res.status})`, res.status >= 500 ? "temporary" : "invalid", "tiktok");
}

const tiktok: ComposioNetwork = {
  async accounts(account, userId) {
    const who = { account, userId };
    let d: Json;
    try {
      d = await tiktokCall(who, { endpoint: "/user/info/?fields=open_id,avatar_url,display_name,username", method: "GET" });
    } catch (error) {
      // username needs the user.info.profile scope; the basic fields are enough.
      if (!(error instanceof SocialError) || error.kind === "rate_limit") throw error;
      d = await tiktokCall(who, { endpoint: "/user/info/?fields=open_id,avatar_url,display_name", method: "GET" });
    }
    const user = asObject(d.user);
    const id = text(user.open_id);
    if (!id) throw new SocialError("No TikTok account found for this login", "invalid", "tiktok");
    const username = text(user.username);
    return [{ externalAccountId: id, displayName: username ? `@${username}` : (text(user.display_name) ?? "TikTok account"), avatarUrl: text(user.avatar_url), accountType: "creator" }];
  },

  async publish(c, post) {
    const T = "tiktok" as const;
    const video = post.media.length === 1 && isVideo(post.media[0]) ? post.media[0] : null;
    if (!video) throw new SocialError("TikTok takes one video from BuPulse. Photo posts come to you as reminders.", "invalid", T);
    const mimeType = video.mimeType.toLowerCase();
    if (!TT_VIDEO_TYPES.has(mimeType)) throw new SocialError("TikTok takes MP4, MOV or WebM videos", "invalid", T);
    const description = post.text;
    if (Array.from(description).length > 2200) throw new SocialError("TikTok captions are limited to 2,200 characters", "invalid", T);
    const bytes = await download(T, video.url);
    if (bytes.length > TT_MAX_BYTES) throw new SocialError("This video is too big for TikTok. Make it shorter.", "invalid", T);

    const who = { account: c.accessToken, userId: c.composioUserId };
    const source_info = { source: "FILE_UPLOAD", video_size: bytes.length, ...tiktokPieces(bytes.length) };
    let init: Json;
    if (tiktokDirectPost()) {
      // TikTok asks for the creator's current options before a direct post.
      // https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info
      const info = await tiktokCall(who, { endpoint: "/post/publish/creator_info/query/", method: "POST", body: {} });
      const options = Array.isArray(info.privacy_level_options) ? info.privacy_level_options : null;
      if (options && !options.includes(TIKTOK_PRIVACY_LEVEL)) throw new SocialError(`This TikTok account does not allow ${TIKTOK_PRIVACY_LEVEL} posts`, "invalid", T);
      // https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
      init = await tiktokCall(who, { endpoint: "/post/publish/video/init/", method: "POST", body: { post_info: { title: description, privacy_level: TIKTOK_PRIVACY_LEVEL, disable_comment: false, disable_duet: false, disable_stitch: false }, source_info } });
    } else {
      // https://developers.tiktok.com/doc/content-posting-api-reference-upload-video
      init = await tiktokCall(who, { endpoint: "/post/publish/inbox/video/init/", method: "POST", body: { source_info } });
    }
    const publishId = text(init.publish_id);
    const uploadUrl = text(init.upload_url);
    if (!publishId || !uploadUrl) throw new SocialError("TikTok did not get ready for the video", "temporary", T);
    // The last piece makes the post: a timeout there leaves it unknown whether TikTok has it.
    const pieces = source_info.total_chunk_count;
    for (let i = 0; i < pieces - 1; i++) await putPiece(uploadUrl, bytes, mimeType, i);
    await finalStage(T, () => putPiece(uploadUrl, bytes, mimeType, pieces - 1));
    // TikTok checks the video after this; the lasting video id comes later (metrics resolves it), so no link yet.
    return { externalId: publishId };
  },

  async metrics(c, externalId) {
    const who = { account: c.accessToken, userId: c.composioUserId };
    let videoId = exactId(externalId);
    let shareUrl: string | undefined;
    if (!videoId) {
      // Still the publish id: TikTok gives the video id once the post is public and passed its checks.
      // https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
      const s = await tiktokCall(who, { endpoint: "/post/publish/status/fetch/", method: "POST", body: { publish_id: externalId } });
      const ids = Array.isArray(s.publicaly_available_post_id) ? s.publicaly_available_post_id : [];
      if (!ids.length) return {};
      videoId = exactId(ids[0]);
      if (!videoId) {
        // A number too long to keep exactly: the account's newest videos (ids as text) say which one it is.
        const listed = await tiktokCall(who, { endpoint: `/video/list/?fields=${TT_VIDEO_FIELDS}`, method: "POST", body: { max_count: 20 } });
        const match = listIn(listed).find((v) => typeof v.id === "string" && Number(v.id) === Number(ids[0]));
        if (!match) return {};
        videoId = text(match.id)!;
        shareUrl = text(match.share_url);
      }
    }
    const d = await tiktokCall(who, { endpoint: `/video/query/?fields=${TT_VIDEO_FIELDS}`, method: "POST", body: { filters: { video_ids: [videoId] } } });
    const v = listIn(d).find((x) => text(x.id) === videoId);
    if (!v) return videoId !== externalId ? { resolved: { externalId: videoId, permalink: shareUrl } } : {};
    const snapshot: MetricsSnapshot = { views: num(v.view_count), likes: num(v.like_count), comments: num(v.comment_count), shares: num(v.share_count) };
    if (videoId !== externalId) snapshot.resolved = { externalId: videoId, permalink: text(v.share_url) ?? shareUrl };
    return snapshot;
  },
};

// ---- X (Twitter; BuPulse's own X app: COMPOSIO_TWITTER_AUTH_CONFIG_ID) ----
// Tools: https://docs.composio.dev/toolkits/twitter. X charges BuPulse for every call (no free tier since February
// 2026: about $0.015 a post, $0.20 a post with a link, $0.005 a post read), docs/guide/features/13-social-connections.md.
// X sends ids as text ("1445880548472328192"), which keeps them exact.

const X = "twitter" as const;
const X_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
/** Media ids as text: a long id sent as a number cannot be trusted. */
const xId = (data: unknown) => {
  for (const name of ["media_id_string", "id", "media_id"]) {
    const v = field(data, name);
    if (typeof v === "string" && v) return v;
    if (typeof v === "number" && Number.isSafeInteger(v)) return String(v);
  }
  return undefined;
};
/** X's own error text, so a used-up X credit balance waits instead of failing every post at once. */
function xError(error: unknown): unknown {
  if (!(error instanceof SocialError)) return error;
  if (/credits?|payment required|\b402\b/i.test(error.message)) return new SocialError("BuPulse's X account has no credit left. We will try again later.", "rate_limit", X, 3600);
  if (/duplicate content/i.test(error.message)) return new SocialError("X does not take the same post twice. Change the text a little.", "invalid", X);
  return error;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A video is ready to post once X finished processing it; Netlify stops a function at 60 s, so the wait is short. */
async function xVideoReady(c: ConnectionCredentials, mediaId: string, upload: unknown) {
  let info = asObject(field(upload, "processing_info"));
  for (let i = 0; i < 4 && info.state && info.state !== "succeeded"; i++) {
    if (info.state === "failed") throw new SocialError(`X could not use this video: ${text(asObject(info.error).message) ?? "it failed X's checks"}`, "invalid", X);
    await wait(Math.min(4, Math.max(1, num(info.check_after_secs) ?? 2)) * 1000);
    const status = await runTool(X, "TWITTER_GET_MEDIA_UPLOAD_STATUS", c.accessToken, c.composioUserId, { media_id: mediaId });
    info = asObject(field(status, "processing_info"));
  }
  if (info.state === "failed") throw new SocialError(`X could not use this video: ${text(asObject(info.error).message) ?? "it failed X's checks"}`, "invalid", X);
  if (info.state && info.state !== "succeeded") throw new SocialError("X is still getting the video ready. We will try again.", "temporary", X);
}

const twitter: ComposioNetwork = {
  async accounts(account, userId) {
    const d = await runTool(X, "TWITTER_USER_LOOKUP_ME", account, userId, { user_fields: ["profile_image_url", "username", "name"] });
    const id = text(field(d, "id"));
    if (!id) throw new SocialError("No X account found for this login", "invalid", X);
    const username = text(field(d, "username"));
    return [{ externalAccountId: id, displayName: username ? `@${username}` : (text(field(d, "name")) ?? "X account"), avatarUrl: text(field(d, "profile_image_url")), accountType: "profile" }];
  },

  async publish(c, post) {
    const videos = post.media.filter(isVideo);
    const images = post.media.filter((m) => !isVideo(m));
    if (videos.length && post.media.length > 1) throw new SocialError("X posts a video on its own, without photos", "invalid", X);
    if (videos.length && videos[0].mimeType.toLowerCase() !== "video/mp4") throw new SocialError("X only accepts MP4 videos", "invalid", X);
    if (images.length > 4) throw new SocialError("X takes at most 4 photos in a post", "invalid", X);
    if (images.some((m) => !X_IMAGE_TYPES.has(m.mimeType.toLowerCase()))) throw new SocialError("X takes JPEG, PNG, WebP and GIF photos", "invalid", X);
    let body = post.text.trim();
    if (post.link && !body.includes(post.link)) body = body ? `${body}\n\n${post.link}` : post.link;
    if (!body && !post.media.length) throw new SocialError("An X post needs text or a photo", "invalid", X);
    if (body.length > 280) throw new SocialError("X allows 280 characters", "invalid", X);

    try {
      const mediaIds: string[] = [];
      for (const [i, m] of post.media.entries()) {
        const video = isVideo(m);
        const slug = video ? "TWITTER_UPLOAD_LARGE_MEDIA" : "TWITTER_UPLOAD_MEDIA";
        const file = await uploadFile(X, slug, m.url, m.mimeType, `${video ? "video" : "photo"}-${i + 1}.${m.mimeType.split("/")[1] ?? "jpg"}`);
        const up = await runTool(X, slug, c.accessToken, c.composioUserId, { media: file, media_category: video ? "tweet_video" : "tweet_image" }, { timeoutMs: video ? 45_000 : undefined });
        const id = xId(up);
        if (!id) throw new SocialError(`X did not take the ${video ? "video" : "photo"}`, "temporary", X);
        if (video) await xVideoReady(c, id, up);
        mediaIds.push(id);
      }
      const data = await finalStage(X, () => runTool(X, "TWITTER_CREATION_OF_A_POST", c.accessToken, c.composioUserId, { ...(body ? { text: body } : {}), ...(mediaIds.length ? { media_media_ids: mediaIds } : {}) }));
      const externalId = requireId(X, data, "id");
      return { externalId, permalink: `https://x.com/i/web/status/${externalId}` };
    } catch (error) {
      throw xError(error);
    }
  },

  async metrics(c, externalId) {
    const d = await runTool(X, "TWITTER_POST_LOOKUP_BY_POST_ID", c.accessToken, c.composioUserId, { id: externalId, tweet_fields: ["public_metrics"] }).catch((e) => {
      throw xError(e);
    });
    const m = asObject(field(d, "public_metrics"));
    const retweets = num(m.retweet_count);
    const quotes = num(m.quote_count);
    return {
      views: num(m.impression_count),
      likes: num(m.like_count),
      comments: num(m.reply_count),
      shares: retweets === undefined && quotes === undefined ? undefined : (retweets ?? 0) + (quotes ?? 0),
      saves: num(m.bookmark_count),
    };
  },
};

const NETWORKS: Partial<Record<Network, ComposioNetwork>> = { facebook, instagram, linkedin, youtube, tiktok, twitter };

export function composioNetwork(network: Network): ComposioNetwork {
  const n = NETWORKS[network];
  if (!n) throw new SocialError(`${network} cannot be connected through BuPulse-Socials`, "invalid", network);
  return n;
}

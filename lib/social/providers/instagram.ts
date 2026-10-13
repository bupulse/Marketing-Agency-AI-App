import { timeBudget } from "@/lib/platform/limits";
import { graphGet, graphJson, graphPost, GRAPH_VERSION } from "../graph";
import {
  finalStage,
  SocialError,
  type AccountChoice,
  type ConnectionCredentials,
  type MetricsSnapshot,
  type NetworkRules,
  type OAuthResult,
  type PublishRequest,
  type PublishResult,
  type SocialProvider,
} from "../types";

// Instagram, two ways in:
// - "instagram" (default): Instagram API with Instagram Login. No Facebook Page needed. Host graph.instagram.com.
// - "facebook": Facebook Login, for Instagram accounts linked to a Facebook Page. Host graph.facebook.com, Page token.
// Both publish the same way. Instagram Login tokens start with "IG"; Facebook tokens with "EA", which is how
// the host is chosen from the token alone (ConnectionCredentials carries no variant).

const rules: NetworkRules = { network: "instagram", label: "Instagram", maxText: 2200, maxHashtags: 30, requiresMedia: true, maxImages: 10, formats: ["POST", "CAROUSEL", "SCRIPT"], videoOnly: false };

export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_insights"];
export const INSTAGRAM_VIA_FACEBOOK_SCOPES = ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish", "instagram_manage_insights"];

const IG_AUTHORIZE = "https://www.instagram.com/oauth/authorize";
const IG_TOKEN = "https://api.instagram.com/oauth/access_token";
const IG_GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;
const FB_GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Container polling. Mutable so tests can run it without waiting. */
export const POLL = { intervalMs: 2000, deadlineMs: 3 * 60 * 1000 };

const appId = () => process.env.INSTAGRAM_APP_ID;
const appSecret = () => process.env.INSTAGRAM_APP_SECRET;
const fbId = () => process.env.FACEBOOK_APP_ID;
const fbSecret = () => process.env.FACEBOOK_APP_SECRET;

export const isInstagramConfigured = () => !!appId() && !!appSecret();
export const isInstagramViaFacebookConfigured = () => !!fbId() && !!fbSecret();

const isInstagramToken = (token: string) => token.startsWith("IG");
const hostFor = (token: string) => (isInstagramToken(token) ? IG_GRAPH : FB_GRAPH);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const E = "instagram" as const;

const ACCOUNT_TYPES: Record<string, string> = { BUSINESS: "business", MEDIA_CREATOR: "creator", CREATOR: "creator" };

async function finishInstagramLogin(code: string, redirectUri: string): Promise<OAuthResult> {
  const short = await graphJson<{ access_token?: string; user_id?: string | number; permissions?: string | string[]; data?: { access_token: string; user_id: string | number; permissions?: string }[] }>(E, IG_TOKEN, {
    method: "POST",
    body: new URLSearchParams({ client_id: appId()!, client_secret: appSecret()!, grant_type: "authorization_code", redirect_uri: redirectUri, code }),
  });
  const first = short.data?.[0] ?? short;
  if (!first.access_token) throw new SocialError("Instagram did not return a token", "invalid", E);

  const long = await graphGet<{ access_token: string; expires_in: number }>(E, "https://graph.instagram.com/access_token", {
    grant_type: "ig_exchange_token",
    client_secret: appSecret(),
    access_token: first.access_token,
  });
  const me = await graphGet<{ user_id?: string; id?: string; username?: string; name?: string; account_type?: string; profile_picture_url?: string }>(E, `${IG_GRAPH}/me`, {
    fields: "user_id,username,name,account_type,profile_picture_url",
    access_token: long.access_token,
  });
  const id = String(me.user_id ?? me.id ?? first.user_id);
  const granted = Array.isArray(first.permissions) ? first.permissions : (first.permissions ?? "").split(/[,\s]+/).filter(Boolean);
  return {
    accessToken: long.access_token,
    expiresAt: new Date(Date.now() + long.expires_in * 1000),
    // meta_uid lets the data-deletion callback find this connection from Meta's signed_request.
    scopes: [...(granted.length ? granted : INSTAGRAM_SCOPES), `meta_uid:${first.user_id ?? id}`, `meta_uid:${id}`],
    accounts: [
      {
        externalAccountId: id,
        displayName: me.username ? `@${me.username}` : (me.name ?? id),
        avatarUrl: me.profile_picture_url,
        accountType: ACCOUNT_TYPES[(me.account_type ?? "").toUpperCase()] ?? "business",
      },
    ],
  };
}

async function finishFacebookLogin(code: string, redirectUri: string): Promise<OAuthResult> {
  const short = await graphGet<{ access_token: string }>(E, `${FB_GRAPH}/oauth/access_token`, { client_id: fbId(), client_secret: fbSecret(), redirect_uri: redirectUri, code });
  const long = await graphGet<{ access_token: string }>(E, `${FB_GRAPH}/oauth/access_token`, { grant_type: "fb_exchange_token", client_id: fbId(), client_secret: fbSecret(), fb_exchange_token: short.access_token });
  const me = await graphGet<{ id: string }>(E, `${FB_GRAPH}/me`, { fields: "id", access_token: long.access_token });
  const pages = await graphGet<{ data: { access_token: string; instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string } }[] }>(E, `${FB_GRAPH}/me/accounts`, {
    fields: "name,access_token,instagram_business_account{id,username,name,profile_picture_url}",
    limit: 100,
    access_token: long.access_token,
  });
  const accounts: AccountChoice[] = [];
  const accountTokens: NonNullable<OAuthResult["accountTokens"]> = {};
  for (const page of pages.data) {
    const ig = page.instagram_business_account;
    if (!ig || accountTokens[ig.id]) continue;
    accounts.push({ externalAccountId: ig.id, displayName: ig.username ? `@${ig.username}` : (ig.name ?? ig.id), avatarUrl: ig.profile_picture_url, accountType: "business" });
    accountTokens[ig.id] = { accessToken: page.access_token };
  }
  if (!accounts.length) throw new SocialError("No Instagram Business account linked to your Facebook Pages", "invalid", E);
  return { accessToken: long.access_token, scopes: [...INSTAGRAM_VIA_FACEBOOK_SCOPES, `meta_uid:${me.id}`], accounts, accountTokens };
}

type Status = { status_code?: string; status?: string };

/** Polls a container until it is FINISHED. ERROR fails the post, EXPIRED and a timeout can be retried. */
export async function waitForContainer(token: string, containerId: string, deadline = Date.now() + POLL.deadlineMs): Promise<void> {
  while (Date.now() < deadline) {
    const s = await graphGet<Status>(E, `${hostFor(token)}/${containerId}`, { fields: "status_code,status", access_token: token });
    if (s.status_code === "FINISHED" || s.status_code === "PUBLISHED") return;
    if (s.status_code === "ERROR") throw new SocialError(`Instagram could not process the media${s.status ? `: ${s.status}` : ""}`, "invalid", E);
    if (s.status_code === "EXPIRED") throw new SocialError("Instagram media expired before it was published", "temporary", E);
    await sleep(POLL.intervalMs);
  }
  throw new SocialError("Instagram is still processing the media", "temporary", E);
}

/** Fails early, with a clear message, when the account has used up its 24-hour publishing quota. */
async function checkQuota(token: string, igId: string): Promise<void> {
  try {
    const r = await graphGet<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(E, `${hostFor(token)}/${igId}/content_publishing_limit`, { fields: "quota_usage,config", access_token: token });
    const q = r.data?.[0];
    if (q?.quota_usage !== undefined && q.config?.quota_total !== undefined && q.quota_usage >= q.config.quota_total) {
      throw new SocialError("Instagram's limit of API posts per day is reached for this account", "rate_limit", E, 3600);
    }
  } catch (error) {
    if (error instanceof SocialError && error.kind === "rate_limit" && /limit of API posts/.test(error.message)) throw error;
    // The limit check is a courtesy; if it fails, try to publish anyway.
  }
}

const isVideo = (m: { mimeType: string }) => m.mimeType.toLowerCase().startsWith("video/");

function assertJpeg(post: PublishRequest) {
  if (!post.media.length) throw new SocialError("Instagram posts need at least one image", "invalid", E);
  // A content video (docs/CONTENT_VISUALS.md) is posted alone, as a Reel, and must be an MP4.
  if (post.media.some(isVideo)) {
    if (post.media.length > 1) throw new SocialError("Instagram posts a video on its own, without photos", "invalid", E);
    if (post.media[0].mimeType.toLowerCase() !== "video/mp4") throw new SocialError("Instagram only accepts MP4 videos", "invalid", E);
    return;
  }
  if (post.media.length > 10) throw new SocialError("Instagram carousels have at most 10 images", "invalid", E);
  for (const m of post.media) {
    if (m.mimeType.toLowerCase() !== "image/jpeg") throw new SocialError("Instagram only accepts JPEG images. Please use a JPG photo.", "invalid", E);
  }
}

async function publish(credentials: ConnectionCredentials, post: PublishRequest): Promise<PublishResult> {
  assertJpeg(post);
  const token = credentials.accessToken;
  const base = hostFor(token);
  const igId = credentials.externalAccountId;
  const caption = post.text;
  await checkQuota(token, igId);

  // One deadline covers every container, children and parent together. Netlify stops a function at 60 s, so the wait
  // is 25 s there; a container still processing is retried later ("temporary"), nothing was published yet.
  const deadline = Date.now() + timeBudget(POLL.deadlineMs, 25_000);
  let creationId: string;
  if (post.media.length === 1 && isVideo(post.media[0])) {
    // A Reel: Instagram fetches and processes the video; a container still processing is retried later ("temporary").
    creationId = (await graphPost<{ id: string }>(E, `${base}/${igId}/media`, { media_type: "REELS", video_url: post.media[0].url, caption, share_to_feed: true, access_token: token })).id;
  } else if (post.media.length === 1) {
    creationId = (await graphPost<{ id: string }>(E, `${base}/${igId}/media`, { image_url: post.media[0].url, caption, access_token: token })).id;
  } else {
    const children = await Promise.all(post.media.map(async (m) => (await graphPost<{ id: string }>(E, `${base}/${igId}/media`, { image_url: m.url, is_carousel_item: true, access_token: token })).id));
    await Promise.all(children.map((id) => waitForContainer(token, id, deadline)));
    creationId = (await graphPost<{ id: string }>(E, `${base}/${igId}/media`, { media_type: "CAROUSEL", children: children.join(","), caption, access_token: token })).id;
  }
  await waitForContainer(token, creationId, deadline);
  const published = await finalStage(E, () => graphPost<{ id: string }>(E, `${base}/${igId}/media_publish`, { creation_id: creationId, access_token: token }));
  const permalink = await graphGet<{ permalink?: string }>(E, `${base}/${published.id}`, { fields: "permalink", access_token: token }).then((r) => r.permalink, () => undefined);
  return { externalId: published.id, permalink };
}

async function metrics(credentials: ConnectionCredentials, externalId: string): Promise<MetricsSnapshot> {
  const token = credentials.accessToken;
  const base = hostFor(token);
  const counts = await graphGet<{ like_count?: number; comments_count?: number }>(E, `${base}/${externalId}`, { fields: "like_count,comments_count", access_token: token });
  // Which insight metrics exist depends on the media type, so each is asked for on its own.
  const insight = async (metric: string) => {
    try {
      const r = await graphGet<{ data?: { values?: { value: number }[]; total_value?: { value: number } }[] }>(E, `${base}/${externalId}/insights`, { metric, access_token: token });
      const d = r.data?.[0];
      return d?.values?.[0]?.value ?? d?.total_value?.value;
    } catch {
      return undefined;
    }
  };
  const [reach, saves, shares, views] = await Promise.all([insight("reach"), insight("saved"), insight("shares"), insight("views")]);
  return { likes: counts.like_count, comments: counts.comments_count, reach, saves, shares, views };
}

export const instagramProvider: SocialProvider = {
  network: "instagram",
  rules,
  isConfigured: isInstagramConfigured,
  authorizeUrl({ state, redirectUri, variant }) {
    if (variant === "facebook") {
      if (!isInstagramViaFacebookConfigured()) throw new SocialError("Facebook login is not set up yet", "invalid", E);
      const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
      url.search = new URLSearchParams({ client_id: fbId()!, redirect_uri: redirectUri, state, response_type: "code", scope: INSTAGRAM_VIA_FACEBOOK_SCOPES.join(",") }).toString();
      return url.toString();
    }
    if (!isInstagramConfigured()) throw new SocialError("Instagram is not set up yet", "invalid", E);
    const url = new URL(IG_AUTHORIZE);
    url.search = new URLSearchParams({ client_id: appId()!, redirect_uri: redirectUri, response_type: "code", scope: INSTAGRAM_SCOPES.join(","), state }).toString();
    return url.toString();
  },
  finishOAuth: ({ code, redirectUri, variant }) => (variant === "facebook" ? finishFacebookLogin(code, redirectUri) : finishInstagramLogin(code, redirectUri)),
  async refresh({ accessToken }) {
    // Facebook Page tokens do not expire, so there is nothing to refresh for them.
    if (!isInstagramToken(accessToken)) return { accessToken };
    const r = await graphGet<{ access_token: string; expires_in: number }>(E, "https://graph.instagram.com/refresh_access_token", { grant_type: "ig_refresh_token", access_token: accessToken });
    return { accessToken: r.access_token, expiresAt: new Date(Date.now() + r.expires_in * 1000) };
  },
  publish,
  metrics,
};

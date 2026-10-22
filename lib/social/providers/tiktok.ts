import { errorFrom, socialFetch, classify, describeError, type ErrorHints } from "./http";
import { tiktokVideoPosts } from "../composio/ways";
import {
  SocialError,
  type AccountChoice,
  type NetworkRules,
  type OAuthResult,
  type PublishRequest,
  type PublishResult,
  type RefreshedTokens,
  type SocialProvider,
  finalStage,
} from "../types";

// Stage 1 has no video generation, so TikTok posts are SCRIPT reminders and the publisher never calls publish
// for them. OAuth, the profile and token refresh work now so accounts can be connected ahead of time.
//
// Photo carousels (Content Posting API, PHOTO media type) are implemented, but TikTok pulls the images from
// our URLs and only accepts a domain or URL prefix we verified in the TikTok portal. Signed Supabase storage
// URLs cannot be verified, so "POST" is advertised only when TIKTOK_PHOTO_POSTING=true, set after the images
// are served from a verified bupulse.com path.
const BASE_RULES = { network: "tiktok", label: "TikTok", maxText: 2200, requiresMedia: true, maxImages: 35, videoOnly: true } as const;

export const tiktokRules: NetworkRules = {
  ...BASE_RULES,
  get formats() {
    return process.env.TIKTOK_PHOTO_POSTING === "true" ? (["POST", "SCRIPT"] as const) : (["SCRIPT"] as const);
  },
  // Videos go out through BuPulse-Socials once BuPulse's TikTok app is set up there (lib/social/composio/networks.ts);
  // until then a TikTok video post is the reminder with the video attached. `formats` stays about photo posts.
  get videoPosts() {
    return tiktokVideoPosts();
  },
};

/**
 * Apps that have not passed TikTok's audit can only publish with SELF_ONLY (private to the creator), and posts
 * made before the audit stay private for good. After the audit passes, change this to the level the creator picks
 * from creator_info's privacy_level_options (for example PUBLIC_TO_EVERYONE).
 * https://developers.tiktok.com/doc/content-posting-api-get-started
 */
export const TIKTOK_PRIVACY_LEVEL = "SELF_ONLY";

const SCOPES = ["user.info.basic", "video.publish", "video.upload"];
const AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
const API = "https://open.tiktokapis.com";
const MAX_TITLE = 90;
const MAX_DESCRIPTION = 4000;

const HINTS: ErrorHints = {
  auth: ["access_token_invalid", "scope_not_authorized"],
  rateLimit: ["rate_limit_exceeded", "spam_risk_too_many_posts", "reached_active_user_cap"],
  invalid: ["unaudited_client_can_only_post_to_private_accounts", "url_ownership_unverified", "privacy_level_option_mismatch", "spam_risk_user_banned_from_posting", "invalid_param"],
};
// A refresh token TikTok rejects (expired after 365 days or revoked) means the creator must reconnect.
const REFRESH_HINTS: ErrorHints = { auth: ["invalid_grant", "invalid_request", "access_token_invalid"] };

function config() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) throw new SocialError("TikTok is not set up", "invalid", "tiktok");
  return { clientKey, clientSecret };
}

type TokenBody = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; open_id?: string; error?: string; error_description?: string };

async function tokenRequest(params: Record<string, string>, hints: ErrorHints): Promise<{ accessToken: string; refreshToken?: string; expiresAt: Date; scopes: string[] }> {
  const { clientKey, clientSecret } = config();
  // https://developers.tiktok.com/doc/oauth-user-access-token-management
  const response = await socialFetch("tiktok", `${API}/v2/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({ ...params, client_key: clientKey, client_secret: clientSecret }).toString(),
  });
  if (!response.ok) throw await errorFrom("tiktok", response, hints);
  const body = (await response.json()) as TokenBody;
  // TikTok can answer 200 with an error body.
  if (body.error || !body.access_token) {
    const { message, code } = describeError(body, "TikTok sent no access token");
    throw classify("tiktok", body.error ? 400 : 502, message, code, hints);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 86_400) * 1000),
    scopes: (body.scope ?? "").split(",").filter(Boolean),
  };
}

async function profile(accessToken: string): Promise<AccountChoice> {
  // https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info
  const response = await socialFetch("tiktok", `${API}/v2/user/info/?fields=open_id,avatar_url,display_name`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw await errorFrom("tiktok", response, HINTS);
  const user = ((await response.json()) as { data?: { user?: { open_id?: string; avatar_url?: string; display_name?: string } } }).data?.user;
  if (!user?.open_id) throw new SocialError("TikTok did not say who connected", "temporary", "tiktok");
  return { externalAccountId: user.open_id, displayName: user.display_name || "TikTok creator", avatarUrl: user.avatar_url, accountType: "creator" };
}

const runes = (text: string) => Array.from(text).length;
const clip = (text: string, max: number) => Array.from(text).slice(0, max).join("");

export const tiktokProvider: SocialProvider = {
  network: "tiktok",
  rules: tiktokRules,
  isConfigured: () => !!process.env.TIKTOK_CLIENT_KEY && !!process.env.TIKTOK_CLIENT_SECRET,

  // https://developers.tiktok.com/doc/login-kit-web (the web flow has no PKCE parameter)
  authorizeUrl({ state, redirectUri }) {
    const { clientKey } = config();
    const params = new URLSearchParams({ client_key: clientKey, response_type: "code", scope: SCOPES.join(","), redirect_uri: redirectUri, state });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  async finishOAuth({ code, redirectUri }): Promise<OAuthResult> {
    const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, HINTS);
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, scopes: tokens.scopes.length ? tokens.scopes : SCOPES, accounts: [await profile(tokens.accessToken)] };
  },

  /** Access tokens last 24 hours, refresh tokens 365 days. The response may carry a new refresh token. */
  async refresh({ refreshToken }): Promise<RefreshedTokens> {
    if (!refreshToken) throw new SocialError("TikTok needs a refresh token, so the creator must reconnect", "auth", "tiktok");
    const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, REFRESH_HINTS);
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken ?? refreshToken, expiresAt: tokens.expiresAt };
  },

  async publish(credentials, post: PublishRequest): Promise<PublishResult> {
    const images = post.media.filter((m) => m.mimeType.startsWith("image/"));
    // Videos go through BuPulse-Socials only (lib/social/composio/networks.ts): reconnecting the account moves it there.
    if (images.length === 0) throw new SocialError("This TikTok account cannot take videos from BuPulse yet. Reconnect it in Channels.", "invalid", "tiktok");
    if (images.length > tiktokRules.maxImages) throw new SocialError(`TikTok takes at most ${tiktokRules.maxImages} photos`, "invalid", "tiktok");
    const description = post.text;
    if (runes(description) > MAX_DESCRIPTION) throw new SocialError(`TikTok descriptions are limited to ${MAX_DESCRIPTION} characters`, "invalid", "tiktok");
    const headers = { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json; charset=UTF-8" };

    // TikTok requires reading the creator's current options before a direct post.
    // https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info
    const info = await socialFetch("tiktok", `${API}/v2/post/publish/creator_info/query/`, { method: "POST", headers, body: "{}" });
    if (!info.ok) throw await errorFrom("tiktok", info, HINTS);
    const options = ((await info.json()) as { data?: { privacy_level_options?: string[] } }).data?.privacy_level_options;
    if (options && !options.includes(TIKTOK_PRIVACY_LEVEL)) throw new SocialError(`This TikTok account does not allow ${TIKTOK_PRIVACY_LEVEL} posts`, "invalid", "tiktok");

    // https://developers.tiktok.com/doc/content-posting-api-reference-photo-post
    // The whole call is "final": a timeout or 5xx leaves it unknown whether TikTok accepted the post.
    const publishId = await finalStage("tiktok", async () => {
      const res = await socialFetch("tiktok", `${API}/v2/post/publish/content/init/`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          media_type: "PHOTO",
          post_mode: "DIRECT_POST",
          post_info: { title: clip(post.title || description, MAX_TITLE), description, privacy_level: TIKTOK_PRIVACY_LEVEL, disable_comment: false },
          source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: images.map((m) => m.url) },
        }),
      }, 30_000);
      if (!res.ok) throw await errorFrom("tiktok", res, HINTS);
      return ((await res.json()) as { data?: { publish_id?: string } }).data?.publish_id;
    });
    if (!publishId) throw new SocialError("TikTok did not return a publish id", "invalid", "tiktok", undefined, "final");
    // TikTok processes the photos after this call, and the public post id only exists after moderation
    // (POST /v2/post/publish/status/fetch/), so there is no permalink yet.
    return { externalId: publishId };
  },

  /** Best effort. https://developers.tiktok.com/doc/oauth-user-access-token-management */
  async revoke(credentials) {
    const { clientKey, clientSecret } = config();
    await socialFetch("tiktok", `${API}/v2/oauth/revoke/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, token: credentials.accessToken }).toString(),
    }, 10_000).catch(() => undefined);
  },
};

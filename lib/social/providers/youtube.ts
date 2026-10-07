import { errorFrom, socialFetch, type ErrorHints } from "./http";
import {
  SocialError,
  type AccountChoice,
  type MetricsSnapshot,
  type NetworkRules,
  type OAuthResult,
  type RefreshedTokens,
  type SocialProvider,
} from "../types";

// Stage 1 has no video generation, so YouTube is connect-and-measure only: publish always refuses, and the
// publisher never calls it for SCRIPT posts. The upload scope is requested now so customers do not have to
// reconnect when video arrives.
const rules: NetworkRules = { network: "youtube", label: "YouTube", maxText: 5000, requiresMedia: true, maxImages: 0, formats: ["SCRIPT"], videoOnly: true };

/** youtube.upload is for later; youtube.readonly lists the channel and reads video statistics. */
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/youtube/v3";

const HINTS: ErrorHints = {
  // 403 quota errors must retry later rather than disconnect the channel.
  rateLimit: ["quotaExceeded", "rateLimitExceeded", "dailyLimitExceeded", "userRateLimitExceeded"],
  auth: ["authError", "invalidCredentials", "insufficientPermissions", "forbidden"],
};
// A refresh token Google rejects (revoked, or unused for six months) means the owner must reconnect.
const TOKEN_HINTS: ErrorHints = { auth: ["invalid_grant"] };

function config() {
  const clientId = process.env.GOOGLE_YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new SocialError("YouTube is not set up", "invalid", "youtube");
  return { clientId, clientSecret };
}

async function tokenRequest(params: Record<string, string>): Promise<{ accessToken: string; refreshToken?: string; expiresAt: Date; scopes: string[] }> {
  const { clientId, clientSecret } = config();
  // https://developers.google.com/identity/protocols/oauth2/web-server (exchange and refresh share this endpoint)
  const response = await socialFetch("youtube", TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret }).toString(),
  });
  if (!response.ok) throw await errorFrom("youtube", response, TOKEN_HINTS);
  const body = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!body.access_token) throw new SocialError("Google sent no access token", "temporary", "youtube");
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
    scopes: (body.scope ?? "").split(" ").filter(Boolean),
  };
}

async function channels(accessToken: string): Promise<AccountChoice[]> {
  // https://developers.google.com/youtube/v3/docs/channels/list (1 quota unit)
  const response = await socialFetch("youtube", `${API}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw await errorFrom("youtube", response, HINTS);
  const items = ((await response.json()) as { items?: { id: string; snippet?: { title?: string; thumbnails?: { default?: { url?: string } } } }[] }).items ?? [];
  if (items.length === 0) throw new SocialError("No YouTube channel found", "invalid", "youtube");
  return items.map((item) => ({
    externalAccountId: item.id,
    displayName: item.snippet?.title ?? "YouTube channel",
    avatarUrl: item.snippet?.thumbnails?.default?.url,
    accountType: "channel",
  }));
}

const count = (value?: string) => (value === undefined ? undefined : Number(value));

export const youtubeProvider: SocialProvider = {
  network: "youtube",
  rules,
  isConfigured: () => !!process.env.GOOGLE_YOUTUBE_CLIENT_ID && !!process.env.GOOGLE_YOUTUBE_CLIENT_SECRET,

  // access_type=offline gives a refresh token, and prompt=consent makes Google send one again on reconnect.
  // https://developers.google.com/identity/protocols/oauth2/web-server
  authorizeUrl({ state, codeChallenge, redirectUri }) {
    const { clientId } = config();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
    });
    if (codeChallenge) {
      params.set("code_challenge", codeChallenge);
      params.set("code_challenge_method", "S256");
    }
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  async finishOAuth({ code, codeVerifier, redirectUri }): Promise<OAuthResult> {
    const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, ...(codeVerifier ? { code_verifier: codeVerifier } : {}) });
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, scopes: tokens.scopes.length ? tokens.scopes : SCOPES, accounts: await channels(tokens.accessToken) };
  },

  /** Google keeps the same refresh token, so the response carries only a new access token. */
  async refresh({ refreshToken }): Promise<RefreshedTokens> {
    if (!refreshToken) throw new SocialError("YouTube needs a refresh token, so the owner must reconnect", "auth", "youtube");
    const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken ?? refreshToken, expiresAt: tokens.expiresAt };
  },

  async publish() {
    throw new SocialError("YouTube posts are scripts for now: BuPulse does not upload videos yet", "invalid", "youtube");
  },

  async metrics(credentials, externalId): Promise<MetricsSnapshot> {
    // https://developers.google.com/youtube/v3/docs/videos/list (1 quota unit; counts come back as strings)
    const response = await socialFetch("youtube", `${API}/videos?part=statistics&id=${encodeURIComponent(externalId)}`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
    if (!response.ok) throw await errorFrom("youtube", response, HINTS);
    const stats = ((await response.json()) as { items?: { statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }).items?.[0]?.statistics;
    if (!stats) return {};
    return { views: count(stats.viewCount), likes: count(stats.likeCount), comments: count(stats.commentCount) };
  },

  /** Best effort. https://developers.google.com/identity/protocols/oauth2/web-server */
  async revoke(credentials) {
    await socialFetch("youtube", REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: credentials.accessToken }).toString(),
    }, 10_000).catch(() => undefined);
  },
};

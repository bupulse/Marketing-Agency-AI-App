import { graphGet, graphPost, GRAPH_VERSION } from "../graph";
import { finalStage, SocialError, type ConnectionCredentials, type MetricsSnapshot, type NetworkRules, type OAuthResult, type PublishRequest, type PublishResult, type SocialProvider } from "../types";

// Facebook Pages through Facebook Login. The user picks one or more Pages and BuPulse stores each Page's own
// token. Page tokens taken from a long-lived user token do not expire, so there is nothing to refresh.

const rules: NetworkRules = { network: "facebook", label: "Facebook", maxText: 63206, requiresMedia: false, maxImages: 10, formats: ["POST", "CAROUSEL"], videoOnly: false };

// read_insights is left out on purpose: likes, comments and shares come from the post itself, and every
// extra permission is one more thing Meta's review can reject (docs/PLATFORM_APPS.md).
export const FACEBOOK_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts"];

const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const E = "facebook" as const;
const id = () => process.env.FACEBOOK_APP_ID;
const secret = () => process.env.FACEBOOK_APP_SECRET;

export const isFacebookConfigured = () => !!id() && !!secret();

type PageRow = { id: string; name: string; access_token: string; category?: string; picture?: { data?: { url?: string } } };

async function finishOAuth({ code, redirectUri }: { code: string; redirectUri: string }): Promise<OAuthResult> {
  const short = await graphGet<{ access_token: string }>(E, `${GRAPH}/oauth/access_token`, { client_id: id(), client_secret: secret(), redirect_uri: redirectUri, code });
  const long = await graphGet<{ access_token: string }>(E, `${GRAPH}/oauth/access_token`, { grant_type: "fb_exchange_token", client_id: id(), client_secret: secret(), fb_exchange_token: short.access_token });
  const me = await graphGet<{ id: string }>(E, `${GRAPH}/me`, { fields: "id", access_token: long.access_token });
  const pages = await graphGet<{ data: PageRow[] }>(E, `${GRAPH}/me/accounts`, { fields: "id,name,access_token,category,picture{url}", limit: 100, access_token: long.access_token });
  if (!pages.data.length) throw new SocialError("No Facebook Pages found for this login", "invalid", E);
  return {
    accessToken: long.access_token,
    scopes: [...FACEBOOK_SCOPES, `meta_uid:${me.id}`],
    accounts: pages.data.map((p) => ({ externalAccountId: p.id, displayName: p.name, avatarUrl: p.picture?.data?.url, accountType: "page" })),
    accountTokens: Object.fromEntries(pages.data.map((p) => [p.id, { accessToken: p.access_token }])),
  };
}

async function publish(credentials: ConnectionCredentials, post: PublishRequest): Promise<PublishResult> {
  const token = credentials.accessToken;
  const page = credentials.externalAccountId;
  const images = post.media.filter((m) => m.mimeType.startsWith("image/"));
  if (images.length !== post.media.length) throw new SocialError("Facebook posts support images only for now", "invalid", E);
  if (!post.text.trim() && !images.length && !post.link) throw new SocialError("A Facebook post needs text, a link or a photo", "invalid", E);

  let externalId: string;
  if (images.length === 0) {
    externalId = (await finalStage(E, () => graphPost<{ id: string }>(E, `${GRAPH}/${page}/feed`, { message: post.text || undefined, link: post.link || undefined, access_token: token }))).id;
  } else if (images.length === 1) {
    const r = await finalStage(E, () => graphPost<{ id: string; post_id?: string }>(E, `${GRAPH}/${page}/photos`, { url: images[0].url, caption: post.text || undefined, access_token: token }));
    externalId = r.post_id ?? r.id;
  } else {
    // Upload each photo unpublished, then attach them all to one feed post.
    const ids: string[] = [];
    for (const image of images) ids.push((await graphPost<{ id: string }>(E, `${GRAPH}/${page}/photos`, { url: image.url, published: false, access_token: token })).id);
    const attached = Object.fromEntries(ids.map((photo, i) => [`attached_media[${i}]`, JSON.stringify({ media_fbid: photo })]));
    externalId = (await finalStage(E, () => graphPost<{ id: string }>(E, `${GRAPH}/${page}/feed`, { message: post.text || undefined, access_token: token, ...attached }))).id;
  }
  const permalink = await graphGet<{ permalink_url?: string }>(E, `${GRAPH}/${externalId}`, { fields: "permalink_url", access_token: token }).then(
    (r) => r.permalink_url,
    () => undefined,
  );
  return { externalId, permalink };
}

async function metrics(credentials: ConnectionCredentials, externalId: string): Promise<MetricsSnapshot> {
  const r = await graphGet<{ reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } }; shares?: { count?: number } }>(E, `${GRAPH}/${externalId}`, {
    fields: "reactions.summary(true).limit(0),comments.summary(true).limit(0),shares",
    access_token: credentials.accessToken,
  });
  return { likes: r.reactions?.summary?.total_count, comments: r.comments?.summary?.total_count, shares: r.shares?.count ?? 0 };
}

export const facebookProvider: SocialProvider = {
  network: "facebook",
  rules,
  isConfigured: isFacebookConfigured,
  authorizeUrl({ state, redirectUri }) {
    if (!isFacebookConfigured()) throw new SocialError("Facebook is not set up yet", "invalid", E);
    const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
    url.search = new URLSearchParams({ client_id: id()!, redirect_uri: redirectUri, state, response_type: "code", scope: FACEBOOK_SCOPES.join(",") }).toString();
    return url.toString();
  },
  finishOAuth,
  publish,
  metrics,
};

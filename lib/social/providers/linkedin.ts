import { escapeLittleText } from "./linkedin/text";
import { errorFrom, socialFetch } from "./http";
import {
  SocialError,
  type AccountChoice,
  type ConnectionCredentials,
  type MetricsSnapshot,
  type NetworkRules,
  type OAuthResult,
  type PublishRequest,
  type PublishResult,
  type RefreshedTokens,
  type SocialProvider,
  finalStage,
} from "../types";

// ARTICLE: LinkedIn's API cannot create native newsletter articles, so an ARTICLE becomes a long-form post:
// the title on the first line, then the text. That is why "ARTICLE" stays in the formats below.
const rules: NetworkRules = { network: "linkedin", label: "LinkedIn", maxText: 3000, requiresMedia: false, maxImages: 9, formats: ["POST", "CAROUSEL", "ARTICLE"], videoOnly: false };

/** Marketing API versions are retired after about a year (202510 shuts down on 15 Oct 2026), so bump this deliberately. */
export const LINKEDIN_VERSION = "202609";
const API = "https://api.linkedin.com";
const AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGES = 20;
/** Access tokens last 60 days when LinkedIn does not say otherwise. */
const DEFAULT_TOKEN_SECONDS = 60 * 24 * 60 * 60;

/** "member" posts as the person (Share on LinkedIn). "organization" posts as a Page (Community Management API). */
const MEMBER_SCOPES = ["openid", "profile", "w_member_social"];
const ORGANIZATION_SCOPES = ["w_organization_social", "r_organization_social", "rw_organization_admin"];

/** Entry added to the saved scopes so every connection made by the same LinkedIn member can share one token. */
export const LINKEDIN_MEMBER_SCOPE_PREFIX = "li_member:";

type Variant = "member" | "organization";

function variantOf(variant?: string): Variant {
  return variant === "organization" ? "organization" : "member";
}

/** Set once the app has the Community Management API product (Pages). Without it LinkedIn rejects the Page scopes. */
function pagesEnabled(): boolean {
  return process.env.LINKEDIN_COMMUNITY_MANAGEMENT === "true";
}

/**
 * Both variants request the same scopes. LinkedIn invalidates a member's earlier tokens when the same app is
 * authorized again with a different scope set, so a profile and a Page connected by one login would otherwise
 * knock each other out. https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
 */
function requestedScopes(): string[] {
  return pagesEnabled() ? [...MEMBER_SCOPES, ...ORGANIZATION_SCOPES] : MEMBER_SCOPES;
}

function config() {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new SocialError("LinkedIn is not set up", "invalid", "linkedin");
  return { clientId, clientSecret };
}

function restHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, "Linkedin-Version": LINKEDIN_VERSION, "X-Restli-Protocol-Version": "2.0.0" };
}

async function tokenRequest(params: Record<string, string>, refreshing: boolean): Promise<{ accessToken: string; refreshToken?: string; expiresAt: Date; scopes: string[] }> {
  const { clientId, clientSecret } = config();
  // https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow (step 3)
  // https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens (step 2)
  const response = await socialFetch("linkedin", TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret }).toString(),
  });
  // A refresh that LinkedIn rejects (400 invalid_request: expired or revoked) means the member must reconnect.
  if (!response.ok) throw await errorFrom("linkedin", response, refreshing ? { auth: ["invalid_request", "invalid_grant"] } : {});
  const body = (await response.json()) as { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string };
  if (!body.access_token) throw new SocialError("LinkedIn sent no access token", "temporary", "linkedin");
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + (body.expires_in ?? DEFAULT_TOKEN_SECONDS) * 1000),
    scopes: (body.scope ?? "").split(/[\s,]+/).filter(Boolean),
  };
}

async function memberAccount(accessToken: string): Promise<AccountChoice> {
  // https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
  const response = await socialFetch("linkedin", `${API}/v2/userinfo`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw await errorFrom("linkedin", response);
  const body = (await response.json()) as { sub?: string; name?: string; picture?: string };
  if (!body.sub) throw new SocialError("LinkedIn did not say who connected", "temporary", "linkedin");
  return { externalAccountId: body.sub, displayName: body.name ?? "LinkedIn member", avatarUrl: body.picture, accountType: "member" };
}

const orgId = (urn: string) => urn.split(":").pop() as string;

async function organizationAccounts(accessToken: string): Promise<AccountChoice[]> {
  // https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role
  const acls = await socialFetch("linkedin", `${API}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=100`, { headers: restHeaders(accessToken) });
  if (!acls.ok) throw await errorFrom("linkedin", acls);
  const urns = [...new Set(((await acls.json()) as { elements?: { organization?: string }[] }).elements?.map((e) => e.organization).filter((u): u is string => !!u))];
  if (urns.length === 0) throw new SocialError("No LinkedIn Pages found where this account is an administrator", "invalid", "linkedin");

  // https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-lookup-api (batch get)
  const ids = urns.map(orgId);
  const lookup = await socialFetch("linkedin", `${API}/rest/organizations?ids=List(${ids.join(",")})`, { headers: restHeaders(accessToken) });
  const names: Record<string, { localizedName?: string }> = lookup.ok ? ((await lookup.json()) as { results?: Record<string, { localizedName?: string }> }).results ?? {} : {};
  // The logo is an image URN that needs another call per Page, so Pages are listed without an avatar.
  return ids.map((id) => ({ externalAccountId: id, displayName: names[id]?.localizedName ?? `LinkedIn Page ${id}`, accountType: "organization" }));
}

function authorUrn(credentials: ConnectionCredentials): string {
  return credentials.accountType === "organization" ? `urn:li:organization:${credentials.externalAccountId}` : `urn:li:person:${credentials.externalAccountId}`;
}

async function uploadImage(accessToken: string, owner: string, media: PublishRequest["media"][number]): Promise<string> {
  const source = await socialFetch("linkedin", media.url, {}, 30_000);
  if (!source.ok) throw new SocialError("Could not read an image to publish", "temporary", "linkedin");
  const bytes = await source.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new SocialError("An image is too large for LinkedIn", "invalid", "linkedin");

  // https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api (initializeUpload)
  const init = await socialFetch("linkedin", `${API}/rest/images?action=initializeUpload`, {
    method: "POST",
    headers: { ...restHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  if (!init.ok) throw await errorFrom("linkedin", init);
  const { value } = (await init.json()) as { value?: { uploadUrl?: string; image?: string } };
  if (!value?.uploadUrl || !value.image) throw new SocialError("LinkedIn did not accept the image upload", "temporary", "linkedin");

  // The upload URL takes the bytes with a PUT and the member's token (unlike video).
  // https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/vector-asset-api#upload-the-image
  const put = await socialFetch("linkedin", value.uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": media.mimeType }, body: bytes }, 60_000);
  if (!put.ok) throw await errorFrom("linkedin", put);
  return value.image;
}

/** Escapes the text (keeping hashtags clickable) and appends the link escaped as plain text, so "#section" stays part of the URL. */
function commentary(post: PublishRequest, appendLink: boolean): { raw: string; escaped: string } {
  const body = post.format === "ARTICLE" && post.title ? `${post.title}\n\n${post.text}` : post.text;
  const link = appendLink ? post.link : null;
  return {
    raw: link ? `${body}\n\n${link}` : body,
    escaped: link ? `${escapeLittleText(body)}\n\n${escapeLittleText(link, { hashtags: false })}` : escapeLittleText(body),
  };
}

export const linkedinProvider: SocialProvider = {
  network: "linkedin",
  rules,
  isConfigured: () => !!process.env.LINKEDIN_CLIENT_ID && !!process.env.LINKEDIN_CLIENT_SECRET,

  // https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow (step 2). No PKCE for LinkedIn web apps.
  authorizeUrl({ state, redirectUri }) {
    const { clientId } = config();
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: requestedScopes().join(" "),
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  async finishOAuth({ code, redirectUri, variant }): Promise<OAuthResult> {
    const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, false);
    if (variantOf(variant) === "organization" && !pagesEnabled()) {
      throw new SocialError("No LinkedIn Pages available: the Community Management API is not enabled for BuPulse yet", "invalid", "linkedin");
    }
    const member = await memberAccount(tokens.accessToken);
    const accounts = variantOf(variant) === "organization" ? await organizationAccounts(tokens.accessToken) : [member];
    const scopes = [...(tokens.scopes.length ? tokens.scopes : requestedScopes()), `${LINKEDIN_MEMBER_SCOPE_PREFIX}${member.externalAccountId}`];
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, scopes, accounts };
  },

  /**
   * Only approved partners get refresh tokens. Without one the member has to reconnect, so this throws "auth"
   * and the connection layer marks the connection EXPIRING as the 60-day access token nears its end.
   */
  async refresh({ refreshToken }): Promise<RefreshedTokens> {
    if (!refreshToken) throw new SocialError("LinkedIn gave no refresh token, so the member must reconnect", "auth", "linkedin");
    const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, true);
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken ?? refreshToken, expiresAt: tokens.expiresAt };
  },

  async publish(credentials, post): Promise<PublishResult> {
    const author = authorUrn(credentials);
    const images = post.media.filter((m) => m.mimeType.startsWith("image/"));
    if (images.length > MAX_IMAGES) throw new SocialError(`LinkedIn takes at most ${MAX_IMAGES} images`, "invalid", "linkedin");
    const text = commentary(post, images.length > 0);
    if (!text.raw.trim()) throw new SocialError("A LinkedIn post needs some text", "invalid", "linkedin");
    // The limit is checked on the escaped text LinkedIn receives, which is never shorter than what the member sees.
    if (text.escaped.length > rules.maxText) throw new SocialError(`LinkedIn posts are limited to ${rules.maxText} characters`, "invalid", "linkedin");

    let content: Record<string, unknown> | undefined;
    if (images.length >= 2) {
      const urns = [];
      for (const image of images) urns.push(await uploadImage(credentials.accessToken, author, image));
      // https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api (2 to 20 images)
      content = { multiImage: { images: urns.map((id) => ({ id })) } };
    } else if (images.length === 1) {
      // https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api#create-image-content
      content = { media: { id: await uploadImage(credentials.accessToken, author, images[0]) } };
    } else if (post.link) {
      // Posts API does not scrape links, so the title is ours to set.
      // https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api#article-post-creation-sample-request
      content = { article: { source: post.link, title: post.title || new URL(post.link).hostname } };
    }

    // https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api#create-organic-posts
    // The whole call is "final": a timeout or 5xx leaves it unknown whether LinkedIn created the post.
    const response = await finalStage("linkedin", async () => {
      const res = await socialFetch("linkedin", `${API}/rest/posts`, {
        method: "POST",
        headers: { ...restHeaders(credentials.accessToken), "Content-Type": "application/json" },
        body: JSON.stringify({
          author,
          commentary: text.escaped,
          visibility: "PUBLIC",
          distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
          ...(content ? { content } : {}),
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
        }),
      }, 30_000);
      if (!res.ok) throw await errorFrom("linkedin", res);
      return res;
    });
    const externalId = response.headers.get("x-restli-id");
    // The post may exist even without an id, so retrying could double-post: fail it, marked final.
    if (!externalId) throw new SocialError("LinkedIn did not return the post id", "invalid", "linkedin", undefined, "final");
    return { externalId, permalink: `https://www.linkedin.com/feed/update/${externalId}/` };
  },

  /** Page posts only: member post analytics need r_member_social, which LinkedIn restricts to approved apps. */
  async metrics(credentials, externalId): Promise<MetricsSnapshot> {
    if (credentials.accountType !== "organization") return {};
    const kind = externalId.startsWith("urn:li:ugcPost:") ? "ugcPosts" : "shares";
    const entity = encodeURIComponent(`urn:li:organization:${credentials.externalAccountId}`);
    // https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics#retrieve-statistics-for-specific-shares
    const url = `${API}/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${entity}&${kind}=List(${encodeURIComponent(externalId)})`;
    const response = await socialFetch("linkedin", url, { headers: restHeaders(credentials.accessToken) });
    if (!response.ok) throw await errorFrom("linkedin", response);
    const stats = ((await response.json()) as { elements?: { totalShareStatistics?: Record<string, number> }[] }).elements?.[0]?.totalShareStatistics;
    // A post with no impressions or actions is left out of the list, which means zeros.
    return {
      views: stats?.impressionCount ?? 0,
      reach: stats?.uniqueImpressionsCount ?? 0,
      likes: stats?.likeCount ?? 0,
      comments: stats?.commentCount ?? 0,
      shares: stats?.shareCount ?? 0,
    };
  },
};

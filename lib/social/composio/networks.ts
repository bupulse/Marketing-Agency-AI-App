import "server-only";
import { escapeLittleText } from "../providers/linkedin/text";
import { finalStage, SocialError, type AccountChoice, type ConnectionCredentials, type MetricsSnapshot, type Network, type PublishRequest, type PublishResult } from "../types";
import { runTool, uploadFile } from "./client";

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
  for (const key of ["data", "items", "pages", "elements", "response_data"]) {
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
    const run = (slug: string, args: Json) => runTool(F, slug, c.accessToken, undefined, { page_id: page, ...args });
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
    const permalink = await runTool(F, "FACEBOOK_GET_POST", c.accessToken, undefined, { post_id: externalId, fields: "permalink_url" }).then(
      (d) => text(field(d, "permalink_url")),
      () => undefined,
    );
    return { externalId, permalink };
  },

  async metrics(c, externalId) {
    const d = await runTool("facebook", "FACEBOOK_GET_POST", c.accessToken, undefined, { post_id: externalId, fields: "reactions.summary(true).limit(0),comments.summary(true).limit(0),shares" });
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
    const run = (slug: string, args: Json) => runTool(E, slug, c.accessToken, undefined, { ig_user_id: ig, ...args });
    // The tool sends the caption as-is in the request, so a raw "#" would cut it off (Composio's own advice).
    const caption = post.text.replace(/#/g, "%23");
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
    const permalink = await runTool(E, "INSTAGRAM_GET_IG_MEDIA", c.accessToken, undefined, { ig_media_id: externalId, fields: "permalink" }).then(
      (d) => text(field(d, "permalink")),
      () => undefined,
    );
    return { externalId, permalink };
  },

  async metrics(c, externalId) {
    const d = await runTool("instagram", "INSTAGRAM_GET_IG_MEDIA", c.accessToken, undefined, { ig_media_id: externalId, fields: "like_count,comments_count" });
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
      runTool(E, "LINKEDIN_CREATE_LINKED_IN_POST", c.accessToken, undefined, { author, commentary, visibility: "PUBLIC", lifecycleState: "PUBLISHED", ...(files.length ? { images: files } : {}) }),
    );
    const externalId = requireId(E, data, "id", "post_id", "x-restli-id", "urn");
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

const NETWORKS: Partial<Record<Network, ComposioNetwork>> = { facebook, instagram, linkedin, youtube };

export function composioNetwork(network: Network): ComposioNetwork {
  const n = NETWORKS[network];
  if (!n) throw new SocialError(`${network} cannot be connected through BuPulse-Socials`, "invalid", network);
  return n;
}

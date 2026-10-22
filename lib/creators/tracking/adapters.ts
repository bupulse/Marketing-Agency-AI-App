import "server-only";
import { addDaysYmd } from "@/lib/demo/slots";
import { SocialError } from "@/lib/social/types";
import type { CreatorNetwork } from "../describe";
import { facebookIds, shortcodeOf, type ParsedLink } from "./links";
import type { Caller, CreatorAccount, CreatorAdapter, NetworkPost, ReadResult } from "./types";

// The creators' side of each network through BuPulse-Socials (Composio): which accounts a sign-in gives, finding a
// handed-in link on the creator's own account, and reading many posts' numbers in few calls. Creator-only: the
// company's posting (lib/social/composio/networks.ts) is untouched. What was checked in the docs, with links, is in
// docs/CREATOR_CAMPAIGNS.md ("What the networks give"). Composio passes the network's answer back in `data`, sometimes
// wrapped once more, so the readers look one level down too, and every number is optional.

type Json = Record<string, unknown>;

/** The sign-in gave an account BuPulse cannot use (owner decision: professional Instagram, Facebook Pages only). */
export class CreatorAccountError extends Error {
  constructor(public code: "personal" | "no_pages" | "no_accounts") {
    super(code);
    this.name = "CreatorAccountError";
  }
}

const asObject = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const text = (v: unknown) => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
/** A follower count, or undefined (left out of the account) when the network did not give one. */
const count = (v: unknown) => {
  const n = num(v);
  return n !== null && n >= 0 ? Math.floor(n) : undefined;
};

/** The first array of objects in `data` (itself, or a level or two down: data.data, data.videos, response_data...). */
export function listIn(data: unknown): Json[] {
  if (Array.isArray(data)) return data.filter((x) => x && typeof x === "object") as Json[];
  const o = asObject(data);
  for (const key of ["data", "items", "videos", "media", "posts", "response_data"]) {
    const found = o[key];
    if (Array.isArray(found)) return found.filter((x) => x && typeof x === "object") as Json[];
    if (found && typeof found === "object") {
      const deeper = listIn(found);
      if (deeper.length) return deeper;
    }
  }
  return [];
}

/** A field of the answer, or of the answer's own `data` / `response_data` / `data.user`. */
function field(data: unknown, ...names: string[]): unknown {
  const top = asObject(data);
  const layers = [top, asObject(top.data), asObject(top.response_data), asObject(asObject(top.data).user), asObject(top.user)];
  for (const layer of layers) for (const name of names) if (layer[name] !== undefined && layer[name] !== null && layer[name] !== "") return layer[name];
  return undefined;
}

/** The paging cursor of a Graph list answer: paging.cursors.after while paging.next says there is more. */
function afterCursor(data: unknown): string | null {
  for (const layer of [asObject(data), asObject(asObject(data).data), asObject(asObject(data).response_data)]) {
    const paging = asObject(layer.paging);
    if (Object.keys(paging).length) return paging.next ? (text(asObject(paging.cursors).after) ?? null) : null;
  }
  return null;
}

/**
 * Insights in Graph's shape, { data: [{ name, values: [{ value }] }] } or with total_value: { value }, as a name ->
 * number map. Metrics the network left out are simply missing (Instagram answers an empty set, not 0).
 */
export function insightValues(data: unknown): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of listIn(data)) {
    const name = text(m.name);
    if (!name) continue;
    const first = Array.isArray(m.values) ? asObject(m.values[0]).value : undefined;
    const value = num(first) ?? num(asObject(m.total_value).value);
    if (value !== null) out.set(name, value);
  }
  return out;
}

const unix = (ymd: string) => Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 1000);
const dateOf = (v: unknown) => {
  const s = text(v);
  if (!s) return null;
  const n = Number(s);
  const d = Number.isFinite(n) && /^\d+$/.test(s) ? new Date(n * 1000) : new Date(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? null : d;
};

/** A by-id read that the network answered "no such object": the post is gone (or no longer this account's). */
export function isGone(error: unknown): boolean {
  if (!(error instanceof SocialError) || error.kind !== "invalid") return false;
  return /does not exist|unsupported get request|cannot be loaded|not found|nonexist|\(#100\)|\(#803\)/i.test(error.message);
}

/** Up to this many list pages per reading of one account (each page is one Composio call). */
const MAX_PAGES = 6;
const FIND_PAGES = 4;

// ---- Instagram (professional accounts, Instagram Login through Composio) ----
// The media list has no views with Instagram Login (view_count is Business Discovery only, total_views_count Facebook
// Login only), so views come from insights: asked for inside the list call first (insights.metric(...) expansion),
// and per post (INSTAGRAM_GET_IG_MEDIA_INSIGHTS) for any post the list answer has none for.

const IG_TYPES: Record<string, string> = { BUSINESS: "business", MEDIA_CREATOR: "creator", CREATOR: "creator" };
const IG_FIELDS = "id,shortcode,permalink,timestamp,caption,media_type,media_product_type,like_count,comments_count";
const IG_METRICS = ["views", "reach", "shares"];
/** Set when the list call refused the insights expansion: per-post insights from then on (this server's lifetime). */
let igExpansionRefused = false;

function igPost(m: Json, insights?: Map<string, number>): NetworkPost | null {
  const id = text(m.id);
  if (!id) return null;
  const i = insights ?? insightValues(m.insights);
  return {
    externalId: id,
    permalink: text(m.permalink) ?? null,
    postedAt: dateOf(m.timestamp),
    caption: text(m.caption) ?? null,
    views: i.get("views") ?? null,
    reach: i.get("reach") ?? null,
    likes: num(m.like_count),
    comments: num(m.comments_count),
    shares: i.get("shares") ?? null,
  };
}

async function igPage(call: Caller, args: Json): Promise<{ items: Json[]; after: string | null }> {
  const base = { ig_user_id: "me", ...args };
  if (!igExpansionRefused) {
    try {
      const d = await call.tool("INSTAGRAM_GET_IG_USER_MEDIA", { ...base, fields: `${IG_FIELDS},insights.metric(${IG_METRICS.join(",")})` });
      return { items: listIn(d), after: afterCursor(d) };
    } catch (error) {
      if (!(error instanceof SocialError) || error.kind !== "invalid") throw error;
      igExpansionRefused = true;
    }
  }
  const d = await call.tool("INSTAGRAM_GET_IG_USER_MEDIA", { ...base, fields: IG_FIELDS });
  return { items: listIn(d), after: afterCursor(d) };
}

/** Views, reach and shares of one media (one call); missing metrics stay missing. */
async function igInsights(call: Caller, mediaId: string): Promise<Map<string, number>> {
  try {
    return insightValues(await call.tool("INSTAGRAM_GET_IG_MEDIA_INSIGHTS", { ig_media_id: mediaId, metric: IG_METRICS, period: "lifetime" }));
  } catch (error) {
    if (error instanceof SocialError && (error.kind === "auth" || error.kind === "rate_limit")) throw error;
    return new Map();
  }
}

async function withInsights(call: Caller, item: Json): Promise<NetworkPost | null> {
  const post = igPost(item);
  if (!post || post.views !== null) return post;
  const i = await igInsights(call, post.externalId);
  return { ...post, views: i.get("views") ?? null, reach: i.get("reach") ?? post.reach, shares: i.get("shares") ?? post.shares };
}

const instagram: CreatorAdapter = {
  async accounts(call) {
    const d = await call.tool("INSTAGRAM_GET_USER_INFO", { ig_user_id: "me", fields: "id,user_id,username,name,account_type,profile_picture_url,followers_count" });
    const id = text(field(d, "user_id", "id"));
    if (!id) throw new CreatorAccountError("no_accounts");
    const type = String(field(d, "account_type") ?? "").toUpperCase();
    // Owner decision: professional accounts only (personal ones cannot share their views).
    if (type && !IG_TYPES[type]) throw new CreatorAccountError("personal");
    const username = text(field(d, "username"));
    const account: CreatorAccount = { externalAccountId: id, displayName: username ? `@${username}` : (text(field(d, "name")) ?? id), avatarUrl: text(field(d, "profile_picture_url")), accountType: IG_TYPES[type] ?? "business" };
    const followers = count(field(d, "followers_count"));
    return [followers === undefined ? account : { ...account, followers }];
  },

  async followers(call) {
    return count(field(await call.tool("INSTAGRAM_GET_USER_INFO", { ig_user_id: "me", fields: "id,followers_count" }), "followers_count")) ?? null;
  },

  async find(call, _account, link, day) {
    if (!link.shortcode) return null;
    let after: string | null = null;
    for (let page = 0; page < FIND_PAGES; page++) {
      const r = await igPage(call, { limit: 50, since: unix(addDaysYmd(day, -3)), ...(after ? { after } : {}) });
      const hit = r.items.find((m) => text(m.shortcode) === link.shortcode || shortcodeOf(text(m.permalink)) === link.shortcode);
      if (hit) return withInsights(call, hit);
      if (!r.after || !r.items.length) return null;
      after = r.after;
    }
    return null;
  },

  async read(call, _account, posts) {
    const found = new Map<string, NetworkPost>();
    const wanted = new Set(posts.map((p) => p.externalId));
    const oldest = posts.reduce<Date | null>((min, p) => (p.postedAt && (!min || p.postedAt < min) ? p.postedAt : min), null);
    let after: string | null = null;
    let complete = false;
    for (let page = 0; page < MAX_PAGES && found.size < wanted.size; page++) {
      const r = await igPage(call, { limit: 100, ...(oldest ? { since: Math.floor(oldest.getTime() / 1000) - 86_400 } : {}), ...(after ? { after } : {}) });
      for (const item of r.items) {
        const id = text(item.id);
        if (!id || !wanted.has(id)) continue;
        const post = await withInsights(call, item);
        if (post) found.set(id, post);
      }
      if (!r.after || !r.items.length) {
        complete = true;
        break;
      }
      after = r.after;
    }
    // Not in the list: asked for by id, which tells a deleted post from one the list did not reach.
    const gone: string[] = [];
    for (const id of wanted) {
      if (found.has(id)) continue;
      try {
        const post = igPost(asObject(await call.tool("INSTAGRAM_GET_IG_MEDIA", { ig_media_id: id, fields: IG_FIELDS })));
        if (post) found.set(id, { ...post, ...(await igInsights(call, id).then((i) => ({ views: i.get("views") ?? null, reach: i.get("reach") ?? null, shares: i.get("shares") ?? null }))) });
        else if (complete) gone.push(id);
      } catch (error) {
        if (isGone(error)) gone.push(id);
        else if (error instanceof SocialError && (error.kind === "auth" || error.kind === "rate_limit")) throw error;
      }
    }
    return { found, gone } satisfies ReadResult;
  },
};

// ---- Facebook Pages ----
// Page posts through FACEBOOK_GET_PAGE_POSTS (no paging cursor: `until` steps back), views and reach from post
// insights post_media_view and post_total_media_view_unique (post_impressions* are deprecated from Graph v25).

const FB_FIELDS = "id,permalink_url,created_time,message,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)";
const FB_METRICS = ["post_media_view", "post_total_media_view_unique"];
let fbExpansionRefused = false;

function fbPost(p: Json, insights?: Map<string, number>): NetworkPost | null {
  const id = text(p.id);
  if (!id) return null;
  const i = insights ?? insightValues(p.insights);
  const summary = (key: string) => num(asObject(asObject(p[key]).summary).total_count);
  return {
    externalId: id,
    permalink: text(p.permalink_url) ?? null,
    postedAt: dateOf(p.created_time),
    caption: text(p.message) ?? null,
    views: i.get("post_media_view") ?? null,
    reach: i.get("post_total_media_view_unique") ?? null,
    likes: summary("reactions"),
    comments: summary("comments"),
    shares: num(asObject(p.shares).count) ?? (p.shares === undefined ? 0 : null),
  };
}

async function fbPage(call: Caller, pageId: string, args: Json): Promise<Json[]> {
  const base = { page_id: pageId, limit: 100, ...args };
  if (!fbExpansionRefused) {
    try {
      return listIn(await call.tool("FACEBOOK_GET_PAGE_POSTS", { ...base, fields: `${FB_FIELDS},insights.metric(${FB_METRICS.join(",")})` }));
    } catch (error) {
      if (!(error instanceof SocialError) || error.kind !== "invalid") throw error;
      fbExpansionRefused = true;
    }
  }
  return listIn(await call.tool("FACEBOOK_GET_PAGE_POSTS", { ...base, fields: FB_FIELDS }));
}

async function fbInsights(call: Caller, postId: string): Promise<Map<string, number>> {
  try {
    return insightValues(await call.tool("FACEBOOK_GET_POST_INSIGHTS", { post_id: postId, metrics: FB_METRICS.join(","), period: "lifetime" }));
  } catch (error) {
    if (error instanceof SocialError && (error.kind === "auth" || error.kind === "rate_limit")) throw error;
    return new Map();
  }
}

async function fbWithInsights(call: Caller, item: Json): Promise<NetworkPost | null> {
  const post = fbPost(item);
  if (!post || post.views !== null) return post;
  const i = await fbInsights(call, post.externalId);
  return { ...post, views: i.get("post_media_view") ?? null, reach: i.get("post_total_media_view_unique") ?? null };
}

/** A Page post matches a link when they share an id: the post id's parts, or an id in its permalink. */
function fbMatches(p: Json, link: ParsedLink): boolean {
  const own = new Set([...(text(p.id)?.split("_") ?? []), ...facebookIds(text(p.permalink_url) ?? "")]);
  return link.ids.some((id) => own.has(id));
}

/**
 * A Page's followers: `followers_count`, or `fan_count` (its likes; "For New Page Experience Pages, this field will
 * return followers_count", developers.facebook.com/docs/graph-api/reference/page) when it gives none.
 */
const FB_COUNT_FIELDS = "followers_count,fan_count";
const pageFollowers = (p: Json) => count(p.followers_count) ?? count(p.fan_count);

const facebook: CreatorAdapter = {
  async accounts(call) {
    const d = await call.tool("FACEBOOK_LIST_MANAGED_PAGES", { fields: `id,name,category,picture{url},${FB_COUNT_FIELDS}`, limit: 100 });
    const pages = listIn(d).filter((p) => text(p.id));
    if (!pages.length) throw new CreatorAccountError("no_pages");
    return pages.map((p): CreatorAccount => {
      const page: CreatorAccount = { externalAccountId: text(p.id)!, displayName: text(p.name) ?? "Facebook Page", avatarUrl: text(asObject(asObject(p.picture).data).url), accountType: "page" };
      const followers = pageFollowers(p);
      return followers === undefined ? page : { ...page, followers };
    });
  },

  async followers(call, account) {
    const d = await call.tool("FACEBOOK_GET_PAGE_DETAILS", { page_id: account.externalAccountId, fields: `id,${FB_COUNT_FIELDS}` });
    return count(field(d, "followers_count")) ?? count(field(d, "fan_count")) ?? null;
  },

  async find(call, account, link, day) {
    let until: string | null = null;
    for (let page = 0; page < FIND_PAGES; page++) {
      const items = await fbPage(call, account.externalAccountId, { since: String(unix(addDaysYmd(day, -3))), ...(until ? { until } : {}) });
      const hit = items.find((p) => fbMatches(p, link));
      if (hit) return fbWithInsights(call, hit);
      const last = dateOf(items.at(-1)?.created_time);
      if (items.length < 100 || !last) return null;
      until = String(Math.floor(last.getTime() / 1000) - 1);
    }
    return null;
  },

  async read(call, account, posts) {
    const found = new Map<string, NetworkPost>();
    const wanted = new Set(posts.map((p) => p.externalId));
    const oldest = posts.reduce<Date | null>((min, p) => (p.postedAt && (!min || p.postedAt < min) ? p.postedAt : min), null);
    let until: string | null = null;
    let complete = false;
    for (let page = 0; page < MAX_PAGES && found.size < wanted.size; page++) {
      const items = await fbPage(call, account.externalAccountId, { ...(oldest ? { since: String(Math.floor(oldest.getTime() / 1000) - 86_400) } : {}), ...(until ? { until } : {}) });
      for (const item of items) {
        const id = text(item.id);
        if (!id || !wanted.has(id)) continue;
        const post = await fbWithInsights(call, item);
        if (post) found.set(id, post);
      }
      const last = dateOf(items.at(-1)?.created_time);
      if (items.length < 100 || !last) {
        complete = true;
        break;
      }
      until = String(Math.floor(last.getTime() / 1000) - 1);
    }
    const gone: string[] = [];
    for (const id of wanted) {
      if (found.has(id)) continue;
      try {
        const post = fbPost(asObject(await call.tool("FACEBOOK_GET_POST", { post_id: id, fields: FB_FIELDS })));
        if (post) found.set(id, { ...post, ...(await fbInsights(call, id).then((i) => ({ views: i.get("post_media_view") ?? null, reach: i.get("post_total_media_view_unique") ?? null }))) });
        else if (complete) gone.push(id);
      } catch (error) {
        if (isGone(error)) gone.push(id);
        else if (error instanceof SocialError && (error.kind === "auth" || error.kind === "rate_limit")) throw error;
      }
    }
    return { found, gone };
  },
};

// ---- TikTok (Display API through Composio's proxy, so the fields asked for are exact) ----
// POST /v2/video/query/ takes up to 20 ids and answers only videos of the signed-in account, with view_count,
// like_count, comment_count and share_count: one call reads 20 posts, and an id it leaves out is gone or not theirs.

const TIKTOK_API = "https://open.tiktokapis.com/v2";
const TT_FIELDS = "id,create_time,share_url,video_description,title,view_count,like_count,comment_count,share_count";

function ttPost(v: Json): NetworkPost | null {
  const id = text(v.id);
  if (!id) return null;
  return {
    externalId: id,
    permalink: text(v.share_url) ?? null,
    postedAt: dateOf(v.create_time),
    caption: [text(v.title), text(v.video_description)].filter(Boolean).join("\n") || null,
    views: num(v.view_count),
    reach: null,
    likes: num(v.like_count),
    comments: num(v.comment_count),
    shares: num(v.share_count),
  };
}

/** TikTok answers 200 with error.code "ok"; anything else is a failure, said in its own words. */
function ttCheck(d: unknown): void {
  const err = asObject(field(d, "error"));
  const code = text(err.code);
  if (code && code !== "ok") {
    const message = `${text(err.message) ?? "TikTok error"} (${code})`;
    if (/access_token|scope|unauthori/i.test(code)) throw new SocialError(message, "auth", "tiktok");
    if (/rate_limit/i.test(code)) throw new SocialError(message, "rate_limit", "tiktok", 3600);
    throw new SocialError(message, "invalid", "tiktok");
  }
}

async function ttQuery(call: Caller, ids: string[]): Promise<NetworkPost[]> {
  const d = await call.proxy({ endpoint: `${TIKTOK_API}/video/query/?fields=${TT_FIELDS}`, method: "POST", body: { filters: { video_ids: ids } } });
  ttCheck(d);
  return listIn(d).map(ttPost).filter((p): p is NetworkPost => !!p);
}

/** GET /v2/user/info/ with these fields; a field whose scope the sign-in lacks fails the call (then fewer are asked). */
async function ttUser(call: Caller, fields: string[]): Promise<unknown> {
  const d = await call.proxy({ endpoint: `${TIKTOK_API}/user/info/?fields=${fields.join(",")}`, method: "GET" });
  ttCheck(d);
  return d;
}

const TT_BASIC = ["open_id", "union_id", "avatar_url", "display_name"];

const tiktok: CreatorAdapter = {
  async accounts(call) {
    let d: unknown;
    // follower_count needs the user.info.stats scope and username user.info.profile; the basic fields are enough.
    const tries = [[...TT_BASIC, "username", "follower_count"], [...TT_BASIC, "username"], TT_BASIC];
    for (const [i, fields] of tries.entries()) {
      try {
        d = await ttUser(call, fields);
        break;
      } catch (error) {
        if (!(error instanceof SocialError) || error.kind === "rate_limit" || i === tries.length - 1) throw error;
      }
    }
    const id = text(field(d, "open_id"));
    if (!id) throw new CreatorAccountError("no_accounts");
    const username = text(field(d, "username"));
    const account: CreatorAccount = { externalAccountId: id, displayName: username ? `@${username}` : (text(field(d, "display_name")) ?? "TikTok account"), avatarUrl: text(field(d, "avatar_url")), accountType: "creator" };
    const followers = count(field(d, "follower_count"));
    return [followers === undefined ? account : { ...account, followers }];
  },

  async followers(call) {
    try {
      return count(field(await ttUser(call, ["open_id", "follower_count"]), "follower_count")) ?? null;
    } catch (error) {
      // Without the user.info.stats scope there is no count (scope_not_authorized): not a failure of the account.
      if (error instanceof SocialError && /scope/i.test(error.message)) return null;
      throw error;
    }
  },

  async find(call, _account, link) {
    if (!link.videoId) return null;
    return (await ttQuery(call, [link.videoId])).find((v) => v.externalId === link.videoId) ?? null;
  },

  async read(call, _account, posts) {
    const found = new Map<string, NetworkPost>();
    const gone: string[] = [];
    const ids = posts.map((p) => p.externalId);
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20);
      const got = await ttQuery(call, chunk);
      for (const v of got) found.set(v.externalId, v);
      for (const id of chunk) if (!found.has(id)) gone.push(id);
    }
    return { found, gone };
  },
};

const ADAPTERS: Record<CreatorNetwork, CreatorAdapter> = { instagram, facebook, tiktok };

export const creatorAdapter = (network: CreatorNetwork): CreatorAdapter => ADAPTERS[network];

/** Tests only: forget that a list call refused the insights expansion. */
export function resetExpansionMemory() {
  igExpansionRefused = false;
  fbExpansionRefused = false;
}

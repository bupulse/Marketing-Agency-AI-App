import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instagramProvider, POLL } from "@/lib/social/providers/instagram";
import { facebookProvider } from "@/lib/social/providers/facebook";
import { SocialError, type PublishRequest } from "@/lib/social/types";

const IG = { connectionId: "c", externalAccountId: "17841", accountType: "business", accessToken: "IGtoken" };
const FB = { connectionId: "c", externalAccountId: "page1", accountType: "page", accessToken: "EAtoken" };
const jpeg = (n: number) => ({ url: `https://signed.example.com/${n}.jpg`, mimeType: "image/jpeg" });

type Handler = (url: string, body: URLSearchParams | null) => unknown;
function fakeFetch(handler: Handler) {
  const calls: { url: string; body: URLSearchParams | null; auth: string | null }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body instanceof URLSearchParams ? init.body : null;
    calls.push({ url, body, auth: new Headers(init?.headers).get("authorization") });
    const out = handler(url, body);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200 });
  }));
  return calls;
}

beforeEach(() => {
  POLL.intervalMs = 1;
  POLL.deadlineMs = 50;
});
afterEach(() => vi.unstubAllGlobals());

describe("Instagram publish", () => {
  it("creates a container, polls until FINISHED, then publishes", async () => {
    let polls = 0;
    const calls = fakeFetch((url) => {
      if (url.includes("content_publishing_limit")) return { data: [{ quota_usage: 3, config: { quota_total: 100 } }] };
      if (url.endsWith("/17841/media")) return { id: "container1" };
      if (url.includes("/container1?")) return { status_code: ++polls < 3 ? "IN_PROGRESS" : "FINISHED" };
      if (url.endsWith("/media_publish")) return { id: "media1" };
      return { permalink: "https://instagram.com/p/abc" };
    });
    const result = await instagramProvider.publish(IG, { format: "POST", text: "Hello", media: [jpeg(1)] });
    expect(result).toEqual({ externalId: "media1", permalink: "https://instagram.com/p/abc" });
    expect(polls).toBe(3);
    const create = calls.find((c) => c.url.endsWith("/17841/media"))!;
    expect(create.url.startsWith("https://graph.instagram.com/")).toBe(true);
    expect(create.body!.get("image_url")).toBe("https://signed.example.com/1.jpg");
    expect(create.body!.get("caption")).toBe("Hello");
    expect(create.auth).toBeNull(); // graph.instagram.com documents only access_token as a parameter
    expect(create.body!.get("access_token")).toBe("IGtoken");
    const publish = calls.find((c) => c.url.endsWith("/media_publish"))!;
    expect(publish.body!.get("creation_id")).toBe("container1");
    // The order matters: nothing is published before the container is ready.
    expect(calls.indexOf(publish)).toBeGreaterThan(calls.findIndex((c) => c.url.includes("/container1?")));
  });

  it("builds a carousel from child containers", async () => {
    let n = 0;
    const calls = fakeFetch((url, body) => {
      if (url.includes("content_publishing_limit")) return { data: [] };
      if (url.endsWith("/17841/media")) return { id: body!.get("media_type") === "CAROUSEL" ? "carousel" : `child${++n}` };
      if (url.includes("?fields=status_code")) return { status_code: "FINISHED" };
      if (url.endsWith("/media_publish")) return { id: "m" };
      return {};
    });
    await instagramProvider.publish(IG, { format: "CAROUSEL", text: "x", media: [jpeg(1), jpeg(2), jpeg(3)] });
    const children = calls.filter((c) => c.body?.get("is_carousel_item") === "true");
    expect(children).toHaveLength(3);
    const parent = calls.find((c) => c.body?.get("media_type") === "CAROUSEL")!;
    expect(parent.body!.get("children")).toBe("child1,child2,child3");
  });

  it("polls carousel children in parallel under one overall deadline", async () => {
    POLL.deadlineMs = 60;
    const started: string[] = [];
    let made = 0;
    fakeFetch((url, body) => {
      if (url.includes("content_publishing_limit")) return { data: [] };
      if (url.endsWith("/17841/media")) return { id: body!.get("media_type") === "CAROUSEL" ? "carousel" : `child${++made}` };
      const id = /\/(child\d+|carousel)\?/.exec(url)?.[1];
      if (id) started.push(id);
      return { status_code: "IN_PROGRESS" };
    });
    const t0 = Date.now();
    await expect(instagramProvider.publish(IG, { format: "CAROUSEL", text: "x", media: Array.from({ length: 10 }, (_, i) => jpeg(i)) })).rejects.toMatchObject({ kind: "temporary" });
    expect(Date.now() - t0).toBeLessThan(500); // 10 children share one deadline instead of waiting one after another
    expect(new Set(started.slice(0, 10)).size).toBe(10);
    expect(started).not.toContain("carousel");
  });

  it("marks failures of the final publish call with stage final, earlier ones not", async () => {
    const down = new Response("oops", { status: 503 });
    fakeFetch((url) => (url.includes("content_publishing_limit") ? { data: [] } : url.endsWith("/media") ? { id: "c1" } : url.endsWith("/media_publish") ? down : { status_code: "FINISHED" }));
    await expect(instagramProvider.publish(IG, { format: "POST", text: "x", media: [jpeg(1)] })).rejects.toMatchObject({ kind: "temporary", stage: "final" });
    fakeFetch((url) => (url.includes("content_publishing_limit") ? { data: [] } : new Response("oops", { status: 503 })));
    const early = await instagramProvider.publish(IG, { format: "POST", text: "x", media: [jpeg(1)] }).catch((e) => e);
    expect(early.stage).toBe("before");
    fakeFetch(() => new Response("oops", { status: 503 }));
    await expect(facebookProvider.publish(FB, { format: "POST", text: "hi", media: [] })).rejects.toMatchObject({ stage: "final" });
  });

  it("fails clearly on non-JPEG images and bad counts, before any request", async () => {
    const calls = fakeFetch(() => ({}));
    const png: PublishRequest = { format: "POST", text: "x", media: [{ url: "https://x/1.png", mimeType: "image/png" }] };
    await expect(instagramProvider.publish(IG, png)).rejects.toMatchObject({ kind: "invalid", message: expect.stringContaining("JPEG") });
    await expect(instagramProvider.publish(IG, { format: "POST", text: "x", media: [] })).rejects.toMatchObject({ kind: "invalid" });
    await expect(instagramProvider.publish(IG, { format: "CAROUSEL", text: "x", media: Array.from({ length: 11 }, (_, i) => jpeg(i)) })).rejects.toMatchObject({ kind: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("maps container ERROR to invalid and a stuck container to temporary", async () => {
    fakeFetch((url) => (url.includes("content_publishing_limit") ? { data: [] } : url.endsWith("/media") ? { id: "c1" } : { status_code: "ERROR", status: "Bad aspect ratio" }));
    await expect(instagramProvider.publish(IG, { format: "POST", text: "x", media: [jpeg(1)] })).rejects.toMatchObject({ kind: "invalid", message: expect.stringContaining("Bad aspect ratio") });
    fakeFetch((url) => (url.includes("content_publishing_limit") ? { data: [] } : url.endsWith("/media") ? { id: "c1" } : { status_code: "IN_PROGRESS" }));
    await expect(instagramProvider.publish(IG, { format: "POST", text: "x", media: [jpeg(1)] })).rejects.toMatchObject({ kind: "temporary" });
  });

  it("stops with rate_limit when the daily quota is used up", async () => {
    const calls = fakeFetch(() => ({ data: [{ quota_usage: 100, config: { quota_total: 100 } }] }));
    await expect(instagramProvider.publish(IG, { format: "POST", text: "x", media: [jpeg(1)] })).rejects.toMatchObject({ kind: "rate_limit", retryAfter: 3600 });
    expect(calls.some((c) => c.url.endsWith("/media"))).toBe(false);
  });

  it("maps Graph error codes: expired token is auth, throttling is rate_limit, 5xx is temporary", async () => {
    fakeFetch((url) => (url.includes("content_publishing_limit") ? { data: [] } : new Response(JSON.stringify({ error: { code: 190, message: "Error validating access token" } }), { status: 400 })));
    await expect(instagramProvider.publish(IG, { format: "POST", text: "x", media: [jpeg(1)] })).rejects.toMatchObject({ kind: "auth" });
    fakeFetch((url) => (url.includes("content_publishing_limit") ? { data: [] } : new Response(JSON.stringify({ error: { code: 4, message: "too many calls" } }), { status: 400 })));
    await expect(instagramProvider.publish(IG, { format: "POST", text: "x", media: [jpeg(1)] })).rejects.toMatchObject({ kind: "rate_limit" });
    fakeFetch((url) => (url.includes("content_publishing_limit") ? { data: [] } : new Response("oops", { status: 503 })));
    await expect(instagramProvider.publish(IG, { format: "POST", text: "x", media: [jpeg(1)] })).rejects.toMatchObject({ kind: "temporary" });
  });

  it("uses the Facebook host for Instagram accounts connected through Facebook", async () => {
    const calls = fakeFetch((url) => (url.includes("content_publishing_limit") ? { data: [] } : url.endsWith("/media") ? { id: "c1" } : url.endsWith("/media_publish") ? { id: "m" } : { status_code: "FINISHED" }));
    await instagramProvider.publish({ ...IG, accessToken: "EAtoken" }, { format: "POST", text: "x", media: [jpeg(1)] });
    expect(calls[0].url.startsWith("https://graph.facebook.com/")).toBe(true);
    expect(calls[0].auth).toBe("Bearer EAtoken");
  });
});

describe("Instagram tokens and metrics", () => {
  it("refreshes Instagram Login tokens and leaves Facebook Page tokens alone", async () => {
    const calls = fakeFetch(() => ({ access_token: "IGnew", expires_in: 5_184_000 }));
    const fresh = await instagramProvider.refresh!({ accessToken: "IGold" });
    expect(fresh.accessToken).toBe("IGnew");
    expect(fresh.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 59 * 86_400_000);
    expect(calls[0].url).toContain("grant_type=ig_refresh_token");
    expect(await instagramProvider.refresh!({ accessToken: "EAfb" })).toEqual({ accessToken: "EAfb" });
    expect(calls).toHaveLength(1);
  });

  it("collects likes, comments and the insights that exist", async () => {
    fakeFetch((url) => {
      if (url.includes("fields=like_count")) return { like_count: 12, comments_count: 3 };
      if (url.includes("metric=reach")) return { data: [{ values: [{ value: 340 }] }] };
      if (url.includes("metric=saved")) return { data: [{ values: [{ value: 7 }] }] };
      if (url.includes("metric=views")) return { data: [{ total_value: { value: 900 } }] };
      return new Response(JSON.stringify({ error: { code: 100, message: "unsupported metric" } }), { status: 400 });
    });
    expect(await instagramProvider.metrics!(IG, "m1")).toEqual({ likes: 12, comments: 3, reach: 340, saves: 7, shares: undefined, views: 900 });
  });
});

describe("Facebook publish", () => {
  it("posts text and a link to the feed", async () => {
    const calls = fakeFetch((url) => (url.endsWith("/feed") ? { id: "page1_55" } : { permalink_url: "https://facebook.com/page1/posts/55" }));
    const r = await facebookProvider.publish(FB, { format: "POST", text: "Hi", media: [], link: "https://shop.example.com" });
    expect(r.externalId).toBe("page1_55");
    expect(calls[0].body!.get("link")).toBe("https://shop.example.com");
    expect(calls[0].auth).toBe("Bearer EAtoken");
    expect(calls[0].body!.get("access_token")).toBeNull();
  });

  it("posts one photo with a caption and uses post_id", async () => {
    const calls = fakeFetch((url) => (url.endsWith("/photos") ? { id: "photo1", post_id: "page1_77" } : {}));
    expect((await facebookProvider.publish(FB, { format: "POST", text: "Cap", media: [jpeg(1)] })).externalId).toBe("page1_77");
    expect(calls[0].body!.get("caption")).toBe("Cap");
  });

  it("attaches several unpublished photos to one feed post", async () => {
    let n = 0;
    const calls = fakeFetch((url) => (url.endsWith("/photos") ? { id: `ph${++n}` } : url.endsWith("/feed") ? { id: "page1_99" } : {}));
    await facebookProvider.publish(FB, { format: "CAROUSEL", text: "Many", media: [jpeg(1), jpeg(2)] });
    expect(calls.filter((c) => c.url.endsWith("/photos")).every((c) => c.body!.get("published") === "false")).toBe(true);
    const feed = calls.find((c) => c.url.endsWith("/feed"))!;
    expect(JSON.parse(feed.body!.get("attached_media[1]")!)).toEqual({ media_fbid: "ph2" });
  });

  it("rejects empty posts and reads metrics from the post", async () => {
    fakeFetch(() => ({}));
    await expect(facebookProvider.publish(FB, { format: "POST", text: " ", media: [] })).rejects.toBeInstanceOf(SocialError);
    fakeFetch(() => ({ reactions: { summary: { total_count: 9 } }, comments: { summary: { total_count: 2 } }, shares: { count: 1 } }));
    expect(await facebookProvider.metrics!(FB, "page1_55")).toEqual({ likes: 9, comments: 2, shares: 1 });
  });

  it("lists Pages with their own tokens after login", async () => {
    process.env.FACEBOOK_APP_ID = "id";
    process.env.FACEBOOK_APP_SECRET = "secret";
    fakeFetch((url) => (url.includes("fb_exchange_token") ? { access_token: "long" } : url.includes("/oauth/access_token") ? { access_token: "short" } : url.includes("/me/accounts") ? { data: [{ id: "p1", name: "Shop", access_token: "pt1", picture: { data: { url: "https://pic" } } }] } : { id: "u1" }));
    const r = await facebookProvider.finishOAuth({ code: "c", redirectUri: "https://x/cb" });
    expect(r.accounts).toEqual([{ externalAccountId: "p1", displayName: "Shop", avatarUrl: "https://pic", accountType: "page" }]);
    expect(r.accountTokens!.p1.accessToken).toBe("pt1");
    expect(r.scopes).toContain("meta_uid:u1");
  });
});

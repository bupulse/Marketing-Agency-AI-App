import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAt, jsonResponse, mockFetch } from "./helpers";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { authConfigFor, createConnectLink, viaComposio } from "@/lib/social/composio/client";
import { composioNetwork, tiktokPieces } from "@/lib/social/composio/networks";
import { getProvider } from "@/lib/social/registry";
import { formatFor } from "@/lib/publishing/validate";
import { acceptsVideo, mediaForPost } from "@/lib/visuals/post-media";
import { sharesResults } from "@/lib/publishing/results";
import type { ConnectionCredentials } from "@/lib/social/types";

// TikTok and X through BuPulse-Socials (lib/social/composio): BuPulse's own TikTok and X apps, added in Composio as
// auth configs (COMPOSIO_TIKTOK_AUTH_CONFIG_ID, COMPOSIO_TWITTER_AUTH_CONFIG_ID). Every network call is mocked.

const ok = (data: unknown) => jsonResponse({ data, successful: true, error: null });
const failed = (error: string) => jsonResponse({ data: {}, successful: false, error });
/** Composio's proxy answer: the network's own body and status. */
const proxied = (data: unknown, status = 200) => jsonResponse({ data, status });
const tiktokOk = (data: unknown) => proxied({ data, error: { code: "ok", message: "", log_id: "l1" } });
const body = (fn: ReturnType<typeof vi.fn>, i: number) => JSON.parse(callAt(fn, i).body ?? "{}");
const bytes = (n: number) => new Response(new Uint8Array(n), { status: 200 });

const socials = (network: "tiktok" | "twitter", externalAccountId: string, accountType: string): ConnectionCredentials => ({
  connectionId: "c1",
  externalAccountId,
  accountType,
  accessToken: "ca_123",
  method: "COMPOSIO",
  composioUserId: "biz1",
});

const ENV = ["COMPOSIO_API_KEY", "COMPOSIO_TIKTOK_AUTH_CONFIG_ID", "COMPOSIO_TWITTER_AUTH_CONFIG_ID", "TIKTOK_DIRECT_POST", "SOCIALS_DIRECT"];

beforeEach(() => {
  for (const name of ENV) delete process.env[name];
  process.env.COMPOSIO_API_KEY = "ak_test_key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ENV) delete process.env[name];
});

describe("TikTok and X need BuPulse's own apps in Composio", () => {
  it("stay Coming soon until their auth config ids are set", () => {
    expect(viaComposio("tiktok")).toBe(false);
    expect(viaComposio("twitter")).toBe(false);
    process.env.COMPOSIO_TIKTOK_AUTH_CONFIG_ID = " ac_tiktok ";
    process.env.COMPOSIO_TWITTER_AUTH_CONFIG_ID = "ac_x";
    expect(viaComposio("tiktok")).toBe(true);
    expect(viaComposio("twitter")).toBe(true);
    process.env.SOCIALS_DIRECT = "tiktok";
    expect(viaComposio("tiktok")).toBe(false);
  });

  it("never asks Composio for a managed TikTok or X sign-in", async () => {
    const fetch = mockFetch();
    await expect(authConfigFor("tiktok")).rejects.toMatchObject({ kind: "invalid" });
    process.env.COMPOSIO_TIKTOK_AUTH_CONFIG_ID = "ac_tiktok";
    expect(await authConfigFor("tiktok")).toBe("ac_tiktok");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("makes the sign-in link with BuPulse's own TikTok config, for this business", async () => {
    process.env.COMPOSIO_TIKTOK_AUTH_CONFIG_ID = "ac_tiktok";
    const fetch = mockFetch(jsonResponse({ redirect_url: "https://connect.composio.dev/link/1", connected_account_id: "ca_9" }));
    expect(await createConnectLink("tiktok", "biz1", "https://bupulse.com/api/social/tiktok/composio?state=s")).toEqual({ url: "https://connect.composio.dev/link/1", connectedAccountId: "ca_9" });
    expect(callAt(fetch, 0).url).toBe("https://backend.composio.dev/api/v3.1/connected_accounts/link");
    expect(body(fetch, 0)).toEqual({ auth_config_id: "ac_tiktok", user_id: "biz1", callback_url: "https://bupulse.com/api/social/tiktok/composio?state=s" });
  });
});

describe("TikTok through BuPulse-Socials", () => {
  it("reads the account through Composio's proxy", async () => {
    const fetch = mockFetch(tiktokOk({ user: { open_id: "ou_1", display_name: "Nova Phones", username: "novaphones", avatar_url: "https://p16/a.jpg" } }));
    expect(await composioNetwork("tiktok").accounts("ca_1", "biz1")).toEqual([{ externalAccountId: "ou_1", displayName: "@novaphones", avatarUrl: "https://p16/a.jpg", accountType: "creator" }]);
    expect(callAt(fetch, 0).url).toBe("https://backend.composio.dev/api/v3.1/tools/execute/proxy");
    expect(body(fetch, 0)).toEqual({ connected_account_id: "ca_1", user_id: "biz1", endpoint: "https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,username", method: "GET" });
  });

  it("falls back to the basic fields when the username scope was not granted", async () => {
    mockFetch(proxied({ data: {}, error: { code: "scope_not_authorized", message: "scope" } }, 401), tiktokOk({ user: { open_id: "ou_1", display_name: "Nova" } }));
    expect((await composioNetwork("tiktok").accounts("ca_1", "biz1"))[0]).toMatchObject({ externalAccountId: "ou_1", displayName: "Nova" });
  });

  it("sends a video to the TikTok inbox until direct posting is switched on, putting the file on TikTok's upload link", async () => {
    const fetch = mockFetch(bytes(1000), tiktokOk({ publish_id: "v_inbox_file~v2.1", upload_url: "https://open-upload.tiktokapis.com/video/?upload_id=1" }), new Response(null, { status: 201 }));
    const result = await getProvider("tiktok").publish(socials("tiktok", "ou_1", "creator"), { format: "POST", text: "Galaxy A56 #Kigali", media: [{ url: "https://storage.example/v.mp4?token=x", mimeType: "video/mp4" }] });
    expect(result).toEqual({ externalId: "v_inbox_file~v2.1" });
    expect(callAt(fetch, 0).url).toBe("https://storage.example/v.mp4?token=x");
    expect(body(fetch, 1)).toMatchObject({ endpoint: "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/", method: "POST", body: { source_info: { source: "FILE_UPLOAD", video_size: 1000, chunk_size: 1000, total_chunk_count: 1 } } });
    expect(callAt(fetch, 2).url).toBe("https://open-upload.tiktokapis.com/video/?upload_id=1");
    expect(callAt(fetch, 2).init.method).toBe("PUT");
    expect(callAt(fetch, 2).headers).toEqual({ "content-type": "video/mp4", "content-range": "bytes 0-999/1000" });
  });

  it("posts directly with the caption once TIKTOK_DIRECT_POST is on, after reading the creator's options", async () => {
    process.env.TIKTOK_DIRECT_POST = "true";
    const fetch = mockFetch(bytes(10), tiktokOk({ privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"] }), tiktokOk({ publish_id: "v_pub_file~1", upload_url: "https://up/1" }), new Response(null, { status: 201 }));
    await getProvider("tiktok").publish(socials("tiktok", "ou_1", "creator"), { format: "POST", text: "New stock", media: [{ url: "https://s/v.mp4", mimeType: "video/mp4" }] });
    expect(body(fetch, 1).endpoint).toBe("https://open.tiktokapis.com/v2/post/publish/creator_info/query/");
    expect(body(fetch, 2)).toMatchObject({ endpoint: "https://open.tiktokapis.com/v2/post/publish/video/init/", body: { post_info: { title: "New stock", privacy_level: "SELF_ONLY" } } });
  });

  it("refuses photo posts before calling anything", async () => {
    const fetch = mockFetch();
    const error = await getProvider("tiktok").publish(socials("tiktok", "ou_1", "creator"), { format: "POST", text: "x", media: [{ url: "https://s/a.jpg", mimeType: "image/jpeg" }] }).catch((e) => e);
    expect(error.kind).toBe("invalid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("explains TikTok's refusals in plain words, and never retries an unclear last upload by itself", async () => {
    mockFetch(bytes(10), proxied({ data: {}, error: { code: "spam_risk_too_many_pending_share", message: "too many" } }, 403));
    const pending = await getProvider("tiktok").publish(socials("tiktok", "ou_1", "creator"), { format: "POST", text: "x", media: [{ url: "https://s/v.mp4", mimeType: "video/mp4" }] }).catch((e) => e);
    expect(pending).toMatchObject({ kind: "rate_limit", message: expect.stringMatching(/5 videos a day/) });

    mockFetch(bytes(10), tiktokOk({ publish_id: "p1", upload_url: "https://up/1" }), new Response(null, { status: 503 }));
    const unclear = await getProvider("tiktok").publish(socials("tiktok", "ou_1", "creator"), { format: "POST", text: "x", media: [{ url: "https://s/v.mp4", mimeType: "video/mp4" }] }).catch((e) => e);
    expect(unclear).toMatchObject({ kind: "temporary", stage: "final" });
  });

  it("cuts big videos into 10 MB pieces, the last one taking the rest", () => {
    expect(tiktokPieces(4_000_000)).toEqual({ chunk_size: 4_000_000, total_chunk_count: 1 });
    expect(tiktokPieces(64_000_000)).toEqual({ chunk_size: 64_000_000, total_chunk_count: 1 });
    expect(tiktokPieces(95_500_000)).toEqual({ chunk_size: 10_000_000, total_chunk_count: 9 });
  });

  it("finds the video id once the post is public, then reads its views and gives the post its lasting id and link", async () => {
    const fetch = mockFetch(
      tiktokOk({ status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["7300000000000000001"] }),
      tiktokOk({ videos: [{ id: "7300000000000000001", share_url: "https://www.tiktok.com/@nova/video/7300000000000000001", view_count: 1200, like_count: 80, comment_count: 7, share_count: 3 }] }),
    );
    expect(await getProvider("tiktok").metrics!(socials("tiktok", "ou_1", "creator"), "v_pub_file~1")).toEqual({
      views: 1200,
      likes: 80,
      comments: 7,
      shares: 3,
      resolved: { externalId: "7300000000000000001", permalink: "https://www.tiktok.com/@nova/video/7300000000000000001" },
    });
    expect(body(fetch, 0).body).toEqual({ publish_id: "v_pub_file~1" });
    expect(body(fetch, 1)).toMatchObject({ endpoint: "https://open.tiktokapis.com/v2/video/query/?fields=id,share_url,view_count,like_count,comment_count,share_count", body: { filters: { video_ids: ["7300000000000000001"] } } });
  });

  it("matches a video id that came as a long number against the account's newest videos", async () => {
    // JSON numbers lose the last digits of a TikTok id; the list gives ids as text.
    const status = new Response('{"data":{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7300000000000000123]},"error":{"code":"ok"}},"status":200}', { status: 200 });
    mockFetch(status, tiktokOk({ videos: [{ id: "7300000000000000999" }, { id: "7300000000000000123", share_url: "https://t/123" }] }), tiktokOk({ videos: [{ id: "7300000000000000123", view_count: 5 }] }));
    const snapshot = await getProvider("tiktok").metrics!(socials("tiktok", "ou_1", "creator"), "v_pub_file~1");
    expect(snapshot).toMatchObject({ views: 5, resolved: { externalId: "7300000000000000123", permalink: "https://t/123" } });
  });

  it("reads nothing while the video is private, in the inbox or still checked", async () => {
    mockFetch(tiktokOk({ status: "SEND_TO_USER_INBOX", publicaly_available_post_id: [] }));
    expect(await getProvider("tiktok").metrics!(socials("tiktok", "ou_1", "creator"), "v_inbox_file~1")).toEqual({});
  });

  it("reads a known video straight away", async () => {
    const fetch = mockFetch(tiktokOk({ videos: [{ id: "7300000000000000001", view_count: 50 }] }));
    expect(await getProvider("tiktok").metrics!(socials("tiktok", "ou_1", "creator"), "7300000000000000001")).toEqual({ views: 50, likes: undefined, comments: undefined, shares: undefined });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("TikTok video posts in the composer and content", () => {
  it("are reminders until BuPulse's TikTok app is set up, then real posts", () => {
    const rules = () => getProvider("tiktok").rules;
    expect(acceptsVideo("tiktok", "u/v.mp4")).toBe(false);
    expect(formatFor(rules(), 1, true)).toBe("SCRIPT");
    expect(mediaForPost({ network: "tiktok", format: "SCRIPT", rules: rules(), images: [], video: "u/v.mp4" })).toEqual({ format: "SCRIPT", mediaPaths: ["u/v.mp4"] });

    process.env.COMPOSIO_TIKTOK_AUTH_CONFIG_ID = "ac_tiktok";
    expect(rules().videoPosts).toBe(true);
    expect(acceptsVideo("tiktok", "u/v.mp4")).toBe(true);
    expect(formatFor(rules(), 1, true)).toBe("POST");
    // Photos stay reminders: TikTok pulls photos only from a verified domain.
    expect(formatFor(rules(), 1, false)).toBe("SCRIPT");
    expect(mediaForPost({ network: "tiktok", format: "SCRIPT", rules: rules(), images: [], video: "u/v.mp4" })).toEqual({ format: "POST", mediaPaths: ["u/v.mp4"] });
  });

  it("show results only for accounts connected through BuPulse-Socials", () => {
    expect(sharesResults("tiktok", "creator", "COMPOSIO")).toBe(true);
    expect(sharesResults("tiktok", "creator", "DIRECT")).toBe(false);
    expect(sharesResults("twitter", "profile", "COMPOSIO")).toBe(true);
  });
});

describe("X through BuPulse-Socials", () => {
  it("reads the signed-in profile", async () => {
    const fetch = mockFetch(ok({ data: { id: "1445880548472328192", name: "Nova Phones", username: "novaphones", profile_image_url: "https://pbs/a.jpg" } }));
    expect(await composioNetwork("twitter").accounts("ca_1", "biz1")).toEqual([{ externalAccountId: "1445880548472328192", displayName: "@novaphones", avatarUrl: "https://pbs/a.jpg", accountType: "profile" }]);
    expect(callAt(fetch, 0).url).toBe("https://backend.composio.dev/api/v3.1/tools/execute/TWITTER_USER_LOOKUP_ME");
    expect(body(fetch, 0).arguments).toEqual({ user_fields: ["profile_image_url", "username", "name"] });
  });

  it("posts text with the link and returns the post's id and link", async () => {
    const fetch = mockFetch(ok({ data: { id: "1850000000000000001", text: "Open today" } }));
    const result = await getProvider("twitter").publish(socials("twitter", "1445", "profile"), { format: "POST", text: "Open today #Kigali", media: [], link: "https://nova.rw" });
    expect(result).toEqual({ externalId: "1850000000000000001", permalink: "https://x.com/i/web/status/1850000000000000001" });
    expect(callAt(fetch, 0).url).toMatch(/TWITTER_CREATION_OF_A_POST$/);
    expect(body(fetch, 0)).toEqual({ connected_account_id: "ca_123", user_id: "biz1", arguments: { text: "Open today #Kigali\n\nhttps://nova.rw" } });
  });

  it("uploads a photo through Composio's files, then posts it", async () => {
    const fetch = mockFetch(
      bytes(20),
      jsonResponse({ key: "s3/photo-1", new_presigned_url: "https://s3.example/put" }),
      new Response(null, { status: 200 }),
      ok({ data: { id: "1860000000000000001", media_key: "3_186" } }),
      ok({ data: { id: "1850000000000000002" } }),
    );
    await getProvider("twitter").publish(socials("twitter", "1445", "profile"), { format: "POST", text: "New phones", media: [{ url: "https://s/a.jpg", mimeType: "image/jpeg" }] });
    expect(body(fetch, 1)).toMatchObject({ toolkit_slug: "twitter", tool_slug: "TWITTER_UPLOAD_MEDIA", mimetype: "image/jpeg" });
    expect(callAt(fetch, 3).url).toMatch(/TWITTER_UPLOAD_MEDIA$/);
    expect(body(fetch, 3).arguments).toEqual({ media: { name: "photo-1.jpeg", mimetype: "image/jpeg", s3key: "s3/photo-1" }, media_category: "tweet_image" });
    expect(body(fetch, 4).arguments).toEqual({ text: "New phones", media_media_ids: ["1860000000000000001"] });
  });

  it("refuses what X cannot take before calling anything", async () => {
    const fetch = mockFetch();
    const post = (text: string, media: { url: string; mimeType: string }[]) => getProvider("twitter").publish(socials("twitter", "1445", "profile"), { format: "POST", text, media }).catch((e) => e);
    expect((await post("x".repeat(281), [])).kind).toBe("invalid");
    expect((await post("x", Array.from({ length: 5 }, (_, i) => ({ url: `https://s/${i}.jpg`, mimeType: "image/jpeg" })))).kind).toBe("invalid");
    expect((await post("x", [{ url: "https://s/v.webm", mimeType: "video/webm" }])).kind).toBe("invalid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("waits when BuPulse's X account has no credit left, instead of failing the post", async () => {
    mockFetch(failed("402 Payment Required: Your enrolled account does not have any credits to fulfill this request."));
    const error = await getProvider("twitter").publish(socials("twitter", "1445", "profile"), { format: "POST", text: "Hi", media: [] }).catch((e) => e);
    expect(error).toMatchObject({ kind: "rate_limit", stage: "before" });
  });

  it("reads views, likes, replies, reposts and saves", async () => {
    const fetch = mockFetch(ok({ data: { id: "185", public_metrics: { impression_count: 900, like_count: 12, reply_count: 3, retweet_count: 2, quote_count: 1, bookmark_count: 4 } } }));
    expect(await getProvider("twitter").metrics!(socials("twitter", "1445", "profile"), "185")).toEqual({ views: 900, likes: 12, comments: 3, shares: 3, saves: 4 });
    expect(body(fetch, 0).arguments).toEqual({ id: "185", tweet_fields: ["public_metrics"] });
  });

  it("has no sign-in of its own", () => {
    expect(getProvider("twitter").isConfigured()).toBe(false);
    expect(() => getProvider("twitter").authorizeUrl({ state: "s", redirectUri: "https://x" })).toThrow(/BuPulse-Socials/);
  });
});

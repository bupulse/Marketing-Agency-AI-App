import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAt, jsonResponse, mockFetch } from "../social/helpers";

// Composio's API answered from recorded shapes (docs.composio.dev/toolkits/instagram, /facebook, /tiktok; Graph and
// TikTok Display API answers as Composio passes them back in `data`). The month's budget always says yes here.
const budget = vi.hoisted(() => ({ reserve: vi.fn(async () => true) }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/social/inbox/budget", () => ({ reserveComposioCalls: budget.reserve, countComposioCalls: vi.fn() }));

import { CreatorAccountError, creatorAdapter, insightValues, resetExpansionMemory } from "@/lib/creators/tracking/adapters";
import { BudgetError, composioCaller } from "@/lib/creators/tracking/caller";
import { parsePostLink } from "@/lib/creators/tracking/links";

const ok = (data: unknown) => jsonResponse({ data, successful: true, error: null });
const failed = (error: string) => jsonResponse({ data: {}, successful: false, error });
const body = (fn: ReturnType<typeof vi.fn>, i: number) => JSON.parse(callAt(fn, i).body ?? "{}");
const slugOf = (fn: ReturnType<typeof vi.fn>, i: number) => callAt(fn, i).url.split("/").pop();

const ig = { network: "instagram" as const, externalAccountId: "17841400000000001" };
const fb = { network: "facebook" as const, externalAccountId: "111222333" };
const tt = { network: "tiktok" as const, externalAccountId: "open-1" };
const caller = (network: "instagram" | "facebook" | "tiktok") => composioCaller(network, "ca_creator", "creator_prof1", 18_000);

const igInsights = (views: number, reach: number, shares: number) => ({
  data: [
    { name: "views", period: "lifetime", values: [{ value: views }] },
    { name: "reach", period: "lifetime", values: [{ value: reach }] },
    { name: "shares", period: "lifetime", values: [{ value: shares }] },
  ],
});

beforeEach(() => {
  process.env.COMPOSIO_API_KEY = "ak_test_key";
  budget.reserve.mockReset().mockResolvedValue(true);
  resetExpansionMemory();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.COMPOSIO_API_KEY;
});

describe("Instagram", () => {
  it("refuses a personal account and keeps a professional one", async () => {
    mockFetch(ok({ id: "1", user_id: "17841400000000001", username: "ana.rw", account_type: "PERSONAL" }));
    await expect(creatorAdapter("instagram").accounts(caller("instagram"))).rejects.toBeInstanceOf(CreatorAccountError);
    mockFetch(ok({ id: "1", user_id: "17841400000000001", username: "ana.rw", account_type: "MEDIA_CREATOR" }));
    expect(await creatorAdapter("instagram").accounts(caller("instagram"))).toEqual([{ externalAccountId: "17841400000000001", displayName: "@ana.rw", avatarUrl: undefined, accountType: "creator" }]);
  });

  it("finds a handed-in reel on the creator's own account by its shortcode, with views from insights", async () => {
    const fetch = mockFetch(
      ok({
        data: [
          { id: "m2", shortcode: "OTHER1", permalink: "https://www.instagram.com/p/OTHER1/", timestamp: "2026-10-20T08:00:00+0000", caption: "x" },
          { id: "m1", shortcode: "DAbC123xyz", permalink: "https://www.instagram.com/reel/DAbC123xyz/", timestamp: "2026-10-20T09:30:00+0000", caption: "New shoes @leafshop", like_count: 40, comments_count: 3, insights: igInsights(1200, 900, 7) },
        ],
        paging: { cursors: { after: "c1" } },
      }),
    );
    const post = await creatorAdapter("instagram").find(caller("instagram"), ig, parsePostLink("instagram", "https://www.instagram.com/reel/DAbC123xyz/")!, "2026-10-20");
    expect(post).toEqual({ externalId: "m1", permalink: "https://www.instagram.com/reel/DAbC123xyz/", postedAt: new Date("2026-10-20T09:30:00Z"), caption: "New shoes @leafshop", views: 1200, reach: 900, likes: 40, comments: 3, shares: 7 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(slugOf(fetch, 0)).toBe("INSTAGRAM_GET_IG_USER_MEDIA");
    expect(body(fetch, 0)).toMatchObject({ connected_account_id: "ca_creator", user_id: "creator_prof1", arguments: { ig_user_id: "me", limit: 50, fields: expect.stringContaining("insights.metric(views,reach,shares)") } });
    expect(budget.reserve).toHaveBeenCalledTimes(1);
  });

  it("asks for insights per post when the list refuses the expansion", async () => {
    const fetch = mockFetch(
      failed("(#100) Tried accessing nonexisting field (insights)"),
      ok({ data: [{ id: "m1", shortcode: "DAbC123xyz", timestamp: "2026-10-20T09:30:00+0000", like_count: 4 }] }),
      ok(igInsights(50, 40, 1)),
    );
    const post = await creatorAdapter("instagram").find(caller("instagram"), ig, parsePostLink("instagram", "https://www.instagram.com/reel/DAbC123xyz/")!, "2026-10-20");
    expect(post?.views).toBe(50);
    expect(slugOf(fetch, 2)).toBe("INSTAGRAM_GET_IG_MEDIA_INSIGHTS");
    expect(body(fetch, 2).arguments).toEqual({ ig_media_id: "m1", metric: ["views", "reach", "shares"], period: "lifetime" });
  });

  it("answers null for a link that is not on the creator's account", async () => {
    mockFetch(ok({ data: [{ id: "m9", shortcode: "SOMEONE", timestamp: "2026-10-20T09:30:00+0000" }], paging: { cursors: { after: "c1" } } }));
    expect(await creatorAdapter("instagram").find(caller("instagram"), ig, parsePostLink("instagram", "https://www.instagram.com/p/NOTMINE1/")!, "2026-10-20")).toBeNull();
  });

  it("reads many posts with one list call, and tells a deleted post from one the list did not reach", async () => {
    const fetch = mockFetch(
      ok({ data: [{ id: "m1", timestamp: "2026-10-19T09:00:00+0000", like_count: 10, insights: igInsights(500, 400, 2) }, { id: "m2", timestamp: "2026-10-18T09:00:00+0000", like_count: 3, insights: igInsights(90, 80, 0) }], paging: { cursors: { after: "x" } } }),
      failed("(#100) Unsupported get request. Object with ID 'm3' does not exist"),
    );
    const r = await creatorAdapter("instagram").read(caller("instagram"), ig, [
      { externalId: "m1", postedAt: new Date("2026-10-19T09:00:00Z") },
      { externalId: "m2", postedAt: new Date("2026-10-18T09:00:00Z") },
      { externalId: "m3", postedAt: new Date("2026-10-17T09:00:00Z") },
    ]);
    expect([...r.found.keys()]).toEqual(["m1", "m2"]);
    expect(r.found.get("m1")).toMatchObject({ views: 500, reach: 400, likes: 10 });
    expect(r.gone).toEqual(["m3"]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(body(fetch, 0).arguments).toMatchObject({ limit: 100, since: Math.floor(Date.parse("2026-10-17T09:00:00Z") / 1000) - 86_400 });
    expect(slugOf(fetch, 1)).toBe("INSTAGRAM_GET_IG_MEDIA");
  });

  it("stops at once when the month's calls are used up", async () => {
    budget.reserve.mockResolvedValue(false);
    const fetch = mockFetch();
    await expect(creatorAdapter("instagram").read(caller("instagram"), ig, [{ externalId: "m1", postedAt: null }])).rejects.toBeInstanceOf(BudgetError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Facebook Pages", () => {
  it("needs a Page and lists every one", async () => {
    mockFetch(ok({ data: [] }));
    await expect(creatorAdapter("facebook").accounts(caller("facebook"))).rejects.toMatchObject({ code: "no_pages" });
    mockFetch(ok({ data: [{ id: "111222333", name: "Ana Styles", picture: { data: { url: "https://p/x.jpg" } } }, { id: "444", name: "Ana Food" }] }));
    expect((await creatorAdapter("facebook").accounts(caller("facebook"))).map((a) => a.externalAccountId)).toEqual(["111222333", "444"]);
  });

  it("finds a post by an id of its link, with views from post_media_view", async () => {
    const fetch = mockFetch(
      ok({
        data: [
          {
            id: "111222333_98765432101",
            permalink_url: "https://www.facebook.com/111222333/posts/98765432101",
            created_time: "2026-10-20T10:00:00+0000",
            message: "Shop @leafshop",
            shares: { count: 2 },
            reactions: { summary: { total_count: 15 } },
            comments: { summary: { total_count: 4 } },
            insights: { data: [{ name: "post_media_view", values: [{ value: 3000 }] }, { name: "post_total_media_view_unique", values: [{ value: 2100 }] }] },
          },
        ],
      }),
    );
    const post = await creatorAdapter("facebook").find(caller("facebook"), fb, parsePostLink("facebook", "https://www.facebook.com/permalink.php?story_fbid=98765432101&id=111222333")!, "2026-10-20");
    expect(post).toMatchObject({ externalId: "111222333_98765432101", views: 3000, reach: 2100, likes: 15, comments: 4, shares: 2 });
    expect(body(fetch, 0).arguments).toMatchObject({ page_id: "111222333", limit: 100, fields: expect.stringContaining("insights.metric(post_media_view,post_total_media_view_unique)") });
  });
});

describe("TikTok", () => {
  const video = (id: string, views: number) => ({ id, create_time: 1_792_490_400, share_url: `https://www.tiktok.com/@ana/video/${id}`, title: "", video_description: "Dance #leaf", view_count: views, like_count: 9, comment_count: 1, share_count: 2 });

  it("finds a video by its id with one query, through Composio's proxy with exact fields", async () => {
    const fetch = mockFetch(jsonResponse({ data: { data: { videos: [video("7412345678901234567", 4200)] }, error: { code: "ok" } }, status: 200 }));
    const post = await creatorAdapter("tiktok").find(caller("tiktok"), tt, parsePostLink("tiktok", "https://www.tiktok.com/@ana/video/7412345678901234567")!, "2026-10-20");
    expect(post).toMatchObject({ externalId: "7412345678901234567", views: 4200, likes: 9, comments: 1, shares: 2, caption: "Dance #leaf" });
    expect(callAt(fetch, 0).url).toBe("https://backend.composio.dev/api/v3.1/tools/execute/proxy");
    expect(body(fetch, 0)).toMatchObject({ endpoint: expect.stringMatching(/^https:\/\/open\.tiktokapis\.com\/v2\/video\/query\/\?fields=.*view_count/), method: "POST", body: { filters: { video_ids: ["7412345678901234567"] } } });
  });

  it("reads 20 videos a call; an id TikTok leaves out is gone", async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `74123456789012345${String(i).padStart(2, "0")}`);
    const fetch = mockFetch(
      jsonResponse({ data: { data: { videos: ids.slice(0, 19).map((id) => video(id, 100)) }, error: { code: "ok" } }, status: 200 }),
      jsonResponse({ data: { data: { videos: [video(ids[20], 5)] }, error: { code: "ok" } }, status: 200 }),
    );
    const r = await creatorAdapter("tiktok").read(caller("tiktok"), tt, ids.map((externalId) => ({ externalId, postedAt: null })));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(body(fetch, 0).body.filters.video_ids).toHaveLength(20);
    expect(r.found.size).toBe(20);
    expect(r.gone).toEqual([ids[19]]);
  });

  it("maps TikTok's own error codes (an expired token means signing in again)", async () => {
    mockFetch(jsonResponse({ data: { data: {}, error: { code: "access_token_invalid", message: "The access token is invalid" } }, status: 200 }));
    await expect(creatorAdapter("tiktok").read(caller("tiktok"), tt, [{ externalId: "1", postedAt: null }])).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("insight answers", () => {
  it("reads values and total_value, and leaves out what is missing", () => {
    const m = insightValues({ data: [{ name: "views", values: [{ value: 5 }] }, { name: "reach", total_value: { value: 4 } }, { name: "shares", values: [] }] });
    expect(Object.fromEntries(m)).toEqual({ views: 5, reach: 4 });
  });
});

describe("follower counts (docs/CREATOR_CAMPAIGN_WIZARD.md, \"Followers\")", () => {
  it("Instagram: followers_count with the account, and on its own", async () => {
    const fetch = mockFetch(ok({ id: "1", user_id: "17841400000000001", username: "ana.rw", account_type: "BUSINESS", followers_count: 12_300 }), ok({ id: "1", followers_count: 12_400 }));
    expect(await creatorAdapter("instagram").accounts(caller("instagram"))).toEqual([{ externalAccountId: "17841400000000001", displayName: "@ana.rw", avatarUrl: undefined, accountType: "business", followers: 12_300 }]);
    expect(body(fetch, 0).arguments.fields).toContain("followers_count");
    expect(await creatorAdapter("instagram").followers!(caller("instagram"), ig)).toBe(12_400);
  });

  it("Facebook: a Page's followers_count, or fan_count when it gives none", async () => {
    const fetch = mockFetch(ok({ data: [{ id: "111222333", name: "Ana Styles", followers_count: 900, fan_count: 850 }, { id: "444", name: "Ana Food", fan_count: 40 }] }), ok({ id: "111222333", followers_count: 901 }));
    expect((await creatorAdapter("facebook").accounts(caller("facebook"))).map((a) => a.followers)).toEqual([900, 40]);
    expect(body(fetch, 0).arguments.fields).toContain("followers_count,fan_count");
    expect(await creatorAdapter("facebook").followers!(caller("facebook"), fb)).toBe(901);
    expect(slugOf(fetch, 1)).toBe("FACEBOOK_GET_PAGE_DETAILS");
    expect(body(fetch, 1).arguments).toMatchObject({ page_id: "111222333", fields: "id,followers_count,fan_count" });
  });

  it("TikTok: follower_count needs user.info.stats; without it the account still connects, with no count", async () => {
    const scope = jsonResponse({ data: { data: {}, error: { code: "scope_not_authorized", message: "The user did not authorize the scope required for completing this request." } }, status: 200 });
    const user = (extra: Record<string, unknown>) => jsonResponse({ data: { data: { user: { open_id: "open-1", display_name: "Ana", ...extra } }, error: { code: "ok" } }, status: 200 });
    let fetch = mockFetch(user({ username: "ana", follower_count: 5_000 }));
    expect(await creatorAdapter("tiktok").accounts(caller("tiktok"))).toEqual([{ externalAccountId: "open-1", displayName: "@ana", avatarUrl: undefined, accountType: "creator", followers: 5_000 }]);
    expect(body(fetch, 0).endpoint).toContain("follower_count");
    fetch = mockFetch(scope, user({ username: "ana" }));
    expect(await creatorAdapter("tiktok").accounts(caller("tiktok"))).toEqual([{ externalAccountId: "open-1", displayName: "@ana", avatarUrl: undefined, accountType: "creator" }]);
    expect(body(fetch, 1).endpoint).not.toContain("follower_count");
    mockFetch(scope);
    expect(await creatorAdapter("tiktok").followers!(caller("tiktok"), tt)).toBeNull();
  });
});

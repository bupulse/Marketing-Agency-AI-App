import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escapeLittleText } from "@/lib/social/providers/linkedin/text";
import { LINKEDIN_VERSION, linkedinProvider } from "@/lib/social/providers/linkedin";
import { SocialError } from "@/lib/social/types";
import { callAt, jsonResponse, mockFetch } from "./helpers";

const creds = (accountType: string, id = "abc") => ({ connectionId: "c1", externalAccountId: id, accountType, accessToken: "tok" });
const post = (over = {}) => ({ format: "POST" as const, text: "Hello", media: [], ...over });
const created = (id = "urn:li:share:1") => new Response(null, { status: 201, headers: { "x-restli-id": id } });
const image = (n: number) => ({ url: `https://files.test/${n}.png`, mimeType: "image/png" });
const imageBytes = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
const initUpload = (n: number) => jsonResponse({ value: { uploadUrl: `https://upload.test/${n}`, image: `urn:li:image:${n}` } });

beforeEach(() => {
  vi.stubEnv("LINKEDIN_COMMUNITY_MANAGEMENT", "true");
  vi.stubEnv("LINKEDIN_CLIENT_ID", "cid");
  vi.stubEnv("LINKEDIN_CLIENT_SECRET", "secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("linkedin config and authorize URL", () => {
  it("is configured only with both keys", () => {
    expect(linkedinProvider.isConfigured()).toBe(true);
    vi.stubEnv("LINKEDIN_CLIENT_SECRET", "");
    expect(linkedinProvider.isConfigured()).toBe(false);
  });

  it("asks for the union of member and Page scopes", () => {
    const url = new URL(linkedinProvider.authorizeUrl({ state: "s", redirectUri: "https://bupulse.com/api/social/linkedin/callback" }));
    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("state")).toBe("s");
    expect(url.searchParams.get("scope")).toBe("openid profile w_member_social w_organization_social r_organization_social rw_organization_admin");
  });

  it("requests the same scopes for both variants so one login does not invalidate the other", () => {
    const scope = (variant?: string) => new URL(linkedinProvider.authorizeUrl({ state: "s", redirectUri: "https://x/cb", variant })).searchParams.get("scope");
    expect(scope("organization")).toBe(scope("member"));
  });

  it("asks for member scopes only without the Community Management product", () => {
    vi.stubEnv("LINKEDIN_COMMUNITY_MANAGEMENT", "");
    const url = new URL(linkedinProvider.authorizeUrl({ state: "s", redirectUri: "https://x/cb", variant: "organization" }));
    expect(url.searchParams.get("scope")).toBe("openid profile w_member_social");
  });
});

describe("linkedin finishOAuth", () => {
  it("exchanges the code and returns the member", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ access_token: "A", expires_in: 5184000, scope: "openid,profile,w_member_social" }),
      jsonResponse({ sub: "p1", name: "Jane Doe", picture: "https://pic" }),
    );
    const result = await linkedinProvider.finishOAuth({ code: "code", redirectUri: "https://x/cb" });
    const token = callAt(fetchMock, 0);
    expect(token.url).toBe("https://www.linkedin.com/oauth/v2/accessToken");
    const form = new URLSearchParams(token.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("code");
    expect(form.get("client_secret")).toBe("secret");
    expect(callAt(fetchMock, 1).url).toBe("https://api.linkedin.com/v2/userinfo");
    expect(result.accessToken).toBe("A");
    expect(result.refreshToken).toBeUndefined();
    expect(result.scopes).toEqual(["openid", "profile", "w_member_social", "li_member:p1"]);
    expect(result.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 59 * 86_400_000);
    expect(result.accounts).toEqual([{ externalAccountId: "p1", displayName: "Jane Doe", avatarUrl: "https://pic", accountType: "member" }]);
  });

  it("lists the Pages the member administers", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ access_token: "A", expires_in: 100, refresh_token: "R" }),
      jsonResponse({ sub: "p1", name: "Jane" }),
      jsonResponse({ elements: [{ organization: "urn:li:organization:11" }, { organization: "urn:li:organization:22" }] }),
      jsonResponse({ results: { "11": { localizedName: "Acme" } } }),
    );
    const result = await linkedinProvider.finishOAuth({ code: "c", redirectUri: "https://x/cb", variant: "organization" });
    const acls = callAt(fetchMock, 2);
    expect(acls.url).toContain("/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED");
    expect(acls.headers["Linkedin-Version"]).toBe(LINKEDIN_VERSION);
    expect(acls.headers["X-Restli-Protocol-Version"]).toBe("2.0.0");
    expect(callAt(fetchMock, 3).url).toBe("https://api.linkedin.com/rest/organizations?ids=List(11,22)");
    expect(result.refreshToken).toBe("R");
    expect(result.scopes).toContain("li_member:p1");
    expect(result.accounts).toEqual([
      { externalAccountId: "11", displayName: "Acme", accountType: "organization" },
      { externalAccountId: "22", displayName: "LinkedIn Page 22", accountType: "organization" },
    ]);
  });

  it("fails clearly when the member administers no Pages", async () => {
    mockFetch(jsonResponse({ access_token: "A", expires_in: 100 }), jsonResponse({ sub: "p1" }), jsonResponse({ elements: [] }));
    await expect(linkedinProvider.finishOAuth({ code: "c", redirectUri: "https://x/cb", variant: "organization" })).rejects.toMatchObject({ kind: "invalid", message: expect.stringMatching(/^No /) });
  });

  it("refuses Page connections without the Community Management product", async () => {
    vi.stubEnv("LINKEDIN_COMMUNITY_MANAGEMENT", "");
    mockFetch(jsonResponse({ access_token: "A", expires_in: 100 }));
    await expect(linkedinProvider.finishOAuth({ code: "c", redirectUri: "https://x/cb", variant: "organization" })).rejects.toMatchObject({ kind: "invalid", message: expect.stringMatching(/^No /) });
  });

  it("gives both variants the same scopes and member id", async () => {
    mockFetch(jsonResponse({ access_token: "A", expires_in: 100, scope: "s" }), jsonResponse({ sub: "p1", name: "Jane" }));
    const member = await linkedinProvider.finishOAuth({ code: "c", redirectUri: "https://x/cb" });
    mockFetch(jsonResponse({ access_token: "B", expires_in: 100, scope: "s" }), jsonResponse({ sub: "p1" }), jsonResponse({ elements: [{ organization: "urn:li:organization:11" }] }), jsonResponse({ results: { "11": { localizedName: "Acme" } } }));
    const org = await linkedinProvider.finishOAuth({ code: "c", redirectUri: "https://x/cb", variant: "organization" });
    expect(org.scopes).toEqual(member.scopes);
    expect(member.accounts[0].accountType).toBe("member");
    expect(org.accounts[0].accountType).toBe("organization");
  });
});

describe("linkedin refresh", () => {
  it("throws auth when there is no refresh token", async () => {
    await expect(linkedinProvider.refresh!({ accessToken: "A" })).rejects.toMatchObject({ kind: "auth" });
  });

  it("exchanges the refresh token", async () => {
    const fetchMock = mockFetch(jsonResponse({ access_token: "A2", expires_in: 86400, refresh_token: "R2" }));
    const result = await linkedinProvider.refresh!({ accessToken: "A", refreshToken: "R" });
    expect(new URLSearchParams(callAt(fetchMock, 0).body).get("grant_type")).toBe("refresh_token");
    expect(result.accessToken).toBe("A2");
    expect(result.refreshToken).toBe("R2");
  });

  it("maps a rejected refresh token to auth", async () => {
    mockFetch(jsonResponse({ error: "invalid_request", error_description: "The provided authorization grant or refresh token is invalid, expired or revoked" }, { status: 400 }));
    await expect(linkedinProvider.refresh!({ accessToken: "A", refreshToken: "R" })).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("linkedin publish", () => {
  it("posts text as the member", async () => {
    const fetchMock = mockFetch(created("urn:li:share:99"));
    const result = await linkedinProvider.publish(creds("member", "p1"), post({ text: "Hello world" }));
    const call = callAt(fetchMock, 0);
    expect(call.url).toBe("https://api.linkedin.com/rest/posts");
    expect(call.headers.Authorization).toBe("Bearer tok");
    expect(call.headers["Linkedin-Version"]).toBe(LINKEDIN_VERSION);
    expect(call.headers["X-Restli-Protocol-Version"]).toBe("2.0.0");
    expect(JSON.parse(call.body!)).toEqual({
      author: "urn:li:person:p1",
      commentary: "Hello world",
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    });
    expect(result).toEqual({ externalId: "urn:li:share:99", permalink: "https://www.linkedin.com/feed/update/urn:li:share:99/" });
  });

  it("posts as the Page and escapes reserved characters while keeping hashtags", async () => {
    const fetchMock = mockFetch(created());
    await linkedinProvider.publish(creds("organization", "77"), post({ text: "Save 50% (today) #sale_now" }));
    const body = JSON.parse(callAt(fetchMock, 0).body!);
    expect(body.author).toBe("urn:li:organization:77");
    expect(body.commentary).toBe("Save 50% \\(today\\) {hashtag|\\#|sale_now}");
  });

  it("maps ARTICLE to a long-form post with the title first", async () => {
    const fetchMock = mockFetch(created());
    await linkedinProvider.publish(creds("member"), post({ format: "ARTICLE", title: "My title", text: "Body" }));
    expect(JSON.parse(callAt(fetchMock, 0).body!).commentary).toBe("My title\n\nBody");
  });

  it("posts a link as an article card", async () => {
    const fetchMock = mockFetch(created());
    await linkedinProvider.publish(creds("member"), post({ link: "https://shop.test/offer", title: "Offer" }));
    expect(JSON.parse(callAt(fetchMock, 0).body!).content).toEqual({ article: { source: "https://shop.test/offer", title: "Offer" } });
  });

  it("uploads a single image then posts it", async () => {
    const fetchMock = mockFetch(imageBytes(), initUpload(1), new Response(null, { status: 201 }), created());
    await linkedinProvider.publish(creds("organization", "77"), post({ media: [image(1)] }));
    const init = callAt(fetchMock, 1);
    expect(init.url).toBe("https://api.linkedin.com/rest/images?action=initializeUpload");
    expect(JSON.parse(init.body!)).toEqual({ initializeUploadRequest: { owner: "urn:li:organization:77" } });
    const put = callAt(fetchMock, 2);
    expect(put.url).toBe("https://upload.test/1");
    expect(put.init.method).toBe("PUT");
    expect(put.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(callAt(fetchMock, 3).body!).content).toEqual({ media: { id: "urn:li:image:1" } });
  });

  it("uploads each image of a multi-image post", async () => {
    const fetchMock = mockFetch(imageBytes(), initUpload(1), new Response(null, { status: 201 }), imageBytes(), initUpload(2), new Response(null, { status: 201 }), created());
    await linkedinProvider.publish(creds("member", "p1"), post({ format: "CAROUSEL", media: [image(1), image(2)], link: "https://shop.test" }));
    const body = JSON.parse(callAt(fetchMock, 6).body!);
    expect(body.content).toEqual({ multiImage: { images: [{ id: "urn:li:image:1" }, { id: "urn:li:image:2" }] } });
    expect(body.commentary).toBe("Hello\n\nhttps://shop.test");
  });

  it("escapes the text but not the link as a hashtag", async () => {
    const fetchMock = mockFetch(imageBytes(), initUpload(1), new Response(null, { status: 201 }), created());
    await linkedinProvider.publish(creds("member"), post({ text: "Go #now", media: [image(1)], link: "https://shop.test/p#section_1" }));
    expect(JSON.parse(callAt(fetchMock, 3).body!).commentary).toBe("Go {hashtag|\\#|now}\n\nhttps://shop.test/p\\#section\\_1");
  });

  it("checks the 3000 limit on the escaped text", async () => {
    const fetchMock = mockFetch();
    await expect(linkedinProvider.publish(creds("member"), post({ text: "(".repeat(2000) }))).rejects.toMatchObject({ kind: "invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks failures of the create call as final when the outcome is unknown", async () => {
    mockFetch(jsonResponse({ message: "boom" }, { status: 503 }));
    await expect(linkedinProvider.publish(creds("member"), post())).rejects.toMatchObject({ kind: "temporary", stage: "final" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("t"), { name: "TimeoutError" })));
    await expect(linkedinProvider.publish(creds("member"), post())).rejects.toMatchObject({ kind: "temporary", stage: "final" });
  });

  it("keeps a missing post id final too", async () => {
    mockFetch(new Response(null, { status: 201 }));
    await expect(linkedinProvider.publish(creds("member"), post())).rejects.toMatchObject({ stage: "final" });
  });

  it("rejects text over 3000 characters without calling LinkedIn", async () => {
    const fetchMock = mockFetch();
    await expect(linkedinProvider.publish(creds("member"), post({ text: "a".repeat(3001) }))).rejects.toMatchObject({ kind: "invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limit"],
    [503, "temporary"],
    [422, "invalid"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    mockFetch(jsonResponse({ message: "nope" }, { status, headers: { "retry-after": "30" } }));
    const error = await linkedinProvider.publish(creds("member"), post()).catch((e) => e);
    expect(error).toBeInstanceOf(SocialError);
    expect(error.kind).toBe(kind);
    if (kind === "rate_limit") expect(error.retryAfter).toBe(30);
  });

  it("maps a timeout to temporary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("t"), { name: "TimeoutError" })));
    await expect(linkedinProvider.publish(creds("member"), post())).rejects.toMatchObject({ kind: "temporary" });
  });
});

describe("linkedin metrics", () => {
  it("reads Page post statistics", async () => {
    const fetchMock = mockFetch(jsonResponse({ elements: [{ totalShareStatistics: { impressionCount: 100, uniqueImpressionsCount: 80, likeCount: 5, commentCount: 2, shareCount: 1 } }] }));
    const metrics = await linkedinProvider.metrics!(creds("organization", "77"), "urn:li:share:9");
    expect(callAt(fetchMock, 0).url).toContain("organizationalEntity=urn%3Ali%3Aorganization%3A77&shares=List(urn%3Ali%3Ashare%3A9)");
    expect(metrics).toEqual({ views: 100, reach: 80, likes: 5, comments: 2, shares: 1 });
  });

  it("treats a post missing from the list as zeros", async () => {
    mockFetch(jsonResponse({ elements: [] }));
    expect(await linkedinProvider.metrics!(creds("organization", "77"), "urn:li:share:9")).toMatchObject({ views: 0, likes: 0 });
  });

  it("returns nothing for member posts", async () => {
    const fetchMock = mockFetch();
    expect(await linkedinProvider.metrics!(creds("member"), "urn:li:share:9")).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("escapeLittleText", () => {
  it("escapes every reserved character", () => {
    expect(escapeLittleText("a|b{c}d@e[f]g(h)i<j>k*l_m~n\\o")).toBe("a\\|b\\{c\\}d\\@e\\[f\\]g\\(h\\)i\\<j\\>k\\*l\\_m\\~n\\\\o");
  });
  it("turns hashtags into the hashtag template", () => {
    expect(escapeLittleText("Go #BuPulse now")).toBe("Go {hashtag|\\#|BuPulse} now");
  });
});

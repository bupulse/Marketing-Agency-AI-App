import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TIKTOK_PRIVACY_LEVEL, tiktokProvider } from "@/lib/social/providers/tiktok";
import { callAt, jsonResponse, mockFetch } from "./helpers";

const creds = { connectionId: "c1", externalAccountId: "open1", accountType: "creator", accessToken: "tok" };
const photo = (n: number) => ({ url: `https://bupulse.com/m/${n}.jpg`, mimeType: "image/jpeg" });
const post = (over = {}) => ({ format: "POST" as const, text: "Caption", media: [photo(1), photo(2)], ...over });
const creatorInfo = () => jsonResponse({ data: { privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"] }, error: { code: "ok" } });

beforeEach(() => {
  vi.stubEnv("TIKTOK_CLIENT_KEY", "key");
  vi.stubEnv("TIKTOK_CLIENT_SECRET", "secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("tiktok config and rules", () => {
  it("is configured only with both keys", () => {
    expect(tiktokProvider.isConfigured()).toBe(true);
    vi.stubEnv("TIKTOK_CLIENT_KEY", "");
    expect(tiktokProvider.isConfigured()).toBe(false);
  });

  it("offers photo posts only once the domain is verified", () => {
    expect(tiktokProvider.rules.formats).toEqual(["SCRIPT"]);
    vi.stubEnv("TIKTOK_PHOTO_POSTING", "true");
    expect(tiktokProvider.rules.formats).toEqual(["POST", "SCRIPT"]);
  });

  it("builds the authorize URL", () => {
    const url = new URL(tiktokProvider.authorizeUrl({ state: "s", redirectUri: "https://bupulse.com/api/social/tiktok/callback" }));
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(url.searchParams.get("client_key")).toBe("key");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("user.info.basic,video.publish,video.upload");
    expect(url.searchParams.get("state")).toBe("s");
  });
});

describe("tiktok finishOAuth and refresh", () => {
  it("exchanges the code and reads the profile", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ access_token: "A", refresh_token: "R", expires_in: 86400, refresh_expires_in: 31536000, open_id: "open1", scope: "user.info.basic,video.publish", token_type: "Bearer" }),
      jsonResponse({ data: { user: { open_id: "open1", display_name: "Shop", avatar_url: "https://av" } }, error: { code: "ok" } }),
    );
    const result = await tiktokProvider.finishOAuth({ code: "c", redirectUri: "https://x/cb" });
    const token = callAt(fetchMock, 0);
    expect(token.url).toBe("https://open.tiktokapis.com/v2/oauth/token/");
    const form = new URLSearchParams(token.body);
    expect(form.get("client_key")).toBe("key");
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(callAt(fetchMock, 1).url).toBe("https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name");
    expect(result.refreshToken).toBe("R");
    expect(result.scopes).toEqual(["user.info.basic", "video.publish"]);
    expect(result.accounts).toEqual([{ externalAccountId: "open1", displayName: "Shop", avatarUrl: "https://av", accountType: "creator" }]);
  });

  it("treats an error body on a 200 as a failure", async () => {
    mockFetch(jsonResponse({ error: "invalid_grant", error_description: "Authorization code is expired" }));
    await expect(tiktokProvider.finishOAuth({ code: "c", redirectUri: "https://x/cb" })).rejects.toMatchObject({ kind: "invalid" });
  });

  it("refreshes and keeps the newest refresh token", async () => {
    const fetchMock = mockFetch(jsonResponse({ access_token: "A2", refresh_token: "R2", expires_in: 86400 }));
    const result = await tiktokProvider.refresh!({ accessToken: "A", refreshToken: "R" });
    expect(new URLSearchParams(callAt(fetchMock, 0).body).get("refresh_token")).toBe("R");
    expect(result).toMatchObject({ accessToken: "A2", refreshToken: "R2" });
    expect(result.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
  });

  it("maps an expired refresh token to auth", async () => {
    mockFetch(jsonResponse({ error: "invalid_grant", error_description: "Refresh token is expired" }, { status: 400 }));
    await expect(tiktokProvider.refresh!({ accessToken: "A", refreshToken: "R" })).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("tiktok photo publish", () => {
  it("checks creator info, then posts the photos privately", async () => {
    const fetchMock = mockFetch(creatorInfo(), jsonResponse({ data: { publish_id: "v_pub_1" }, error: { code: "ok" } }));
    const result = await tiktokProvider.publish(creds, post({ title: "Sale" }));
    expect(callAt(fetchMock, 0).url).toBe("https://open.tiktokapis.com/v2/post/publish/creator_info/query/");
    const init = callAt(fetchMock, 1);
    expect(init.url).toBe("https://open.tiktokapis.com/v2/post/publish/content/init/");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body!)).toEqual({
      media_type: "PHOTO",
      post_mode: "DIRECT_POST",
      post_info: { title: "Sale", description: "Caption", privacy_level: TIKTOK_PRIVACY_LEVEL, disable_comment: false },
      source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: ["https://bupulse.com/m/1.jpg", "https://bupulse.com/m/2.jpg"] },
    });
    expect(TIKTOK_PRIVACY_LEVEL).toBe("SELF_ONLY");
    expect(result).toEqual({ externalId: "v_pub_1" });
  });

  it("clips the title to 90 characters", async () => {
    const fetchMock = mockFetch(creatorInfo(), jsonResponse({ data: { publish_id: "p" } }));
    await tiktokProvider.publish(creds, post({ text: "x".repeat(200) }));
    expect(JSON.parse(callAt(fetchMock, 1).body!).post_info.title).toHaveLength(90);
  });

  it("marks failures of the init call as final when the outcome is unknown", async () => {
    mockFetch(creatorInfo(), jsonResponse({ error: { code: "internal", message: "boom" } }, { status: 500 }));
    await expect(tiktokProvider.publish(creds, post())).rejects.toMatchObject({ kind: "temporary", stage: "final" });
  });

  it("refuses posts without images", async () => {
    const fetchMock = mockFetch();
    await expect(tiktokProvider.publish(creds, post({ media: [] }))).rejects.toMatchObject({ kind: "invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, "access_token_invalid", "auth"],
    [403, "url_ownership_unverified", "invalid"],
    [403, "unaudited_client_can_only_post_to_private_accounts", "invalid"],
    [403, "spam_risk_too_many_posts", "rate_limit"],
    [429, "rate_limit_exceeded", "rate_limit"],
    [500, "internal", "temporary"],
  ])("maps %i %s to %s", async (status, code, kind) => {
    mockFetch(creatorInfo(), jsonResponse({ error: { code, message: "bad", log_id: "l" } }, { status }));
    await expect(tiktokProvider.publish(creds, post())).rejects.toMatchObject({ kind });
  });
});

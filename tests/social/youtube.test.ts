import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { youtubeProvider } from "@/lib/social/providers/youtube";
import { callAt, jsonResponse, mockFetch } from "./helpers";

const creds = { connectionId: "c1", externalAccountId: "UC1", accountType: "channel", accessToken: "tok" };

beforeEach(() => {
  vi.stubEnv("GOOGLE_YOUTUBE_CLIENT_ID", "gid");
  vi.stubEnv("GOOGLE_YOUTUBE_CLIENT_SECRET", "gsecret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("youtube config and authorize URL", () => {
  it("is configured only with both keys", () => {
    expect(youtubeProvider.isConfigured()).toBe(true);
    vi.stubEnv("GOOGLE_YOUTUBE_CLIENT_ID", "");
    expect(youtubeProvider.isConfigured()).toBe(false);
  });

  it("asks for offline access, consent and both scopes", () => {
    const url = new URL(youtubeProvider.authorizeUrl({ state: "s", codeChallenge: "ch", redirectUri: "http://localhost:3000/api/social/youtube/callback" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly");
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("youtube finishOAuth and refresh", () => {
  it("exchanges the code and lists channels", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ access_token: "A", refresh_token: "R", expires_in: 3599, scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly" }),
      jsonResponse({ items: [{ id: "UC1", snippet: { title: "My shop", thumbnails: { default: { url: "https://thumb" } } } }] }),
    );
    const result = await youtubeProvider.finishOAuth({ code: "c", codeVerifier: "v", redirectUri: "https://x/cb" });
    const token = callAt(fetchMock, 0);
    expect(token.url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(token.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code_verifier")).toBe("v");
    expect(form.get("client_secret")).toBe("gsecret");
    const channels = callAt(fetchMock, 1);
    expect(channels.url).toBe("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true");
    expect(channels.headers.Authorization).toBe("Bearer A");
    expect(result.refreshToken).toBe("R");
    expect(result.scopes).toHaveLength(2);
    expect(result.accounts).toEqual([{ externalAccountId: "UC1", displayName: "My shop", avatarUrl: "https://thumb", accountType: "channel" }]);
  });

  it("fails clearly when there is no channel", async () => {
    mockFetch(jsonResponse({ access_token: "A", expires_in: 3599 }), jsonResponse({ items: [] }));
    await expect(youtubeProvider.finishOAuth({ code: "c", redirectUri: "https://x/cb" })).rejects.toMatchObject({ kind: "invalid" });
  });

  it("refreshes and keeps the same refresh token", async () => {
    mockFetch(jsonResponse({ access_token: "A2", expires_in: 3599 }));
    expect(await youtubeProvider.refresh!({ accessToken: "A", refreshToken: "R" })).toMatchObject({ accessToken: "A2", refreshToken: "R" });
  });

  it("maps a revoked refresh token to auth", async () => {
    mockFetch(jsonResponse({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 }));
    await expect(youtubeProvider.refresh!({ accessToken: "A", refreshToken: "R" })).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("youtube publish and metrics", () => {
  it("refuses to publish in Stage 1", async () => {
    await expect(youtubeProvider.publish(creds, { format: "POST", text: "x", media: [] })).rejects.toMatchObject({ kind: "invalid", network: "youtube" });
  });

  it("reads video statistics as numbers", async () => {
    const fetchMock = mockFetch(jsonResponse({ items: [{ statistics: { viewCount: "120", likeCount: "7", commentCount: "3" } }] }));
    expect(await youtubeProvider.metrics!(creds, "vid1")).toEqual({ views: 120, likes: 7, comments: 3 });
    expect(callAt(fetchMock, 0).url).toBe("https://www.googleapis.com/youtube/v3/videos?part=statistics&id=vid1");
  });

  it("returns nothing for an unknown video", async () => {
    mockFetch(jsonResponse({ items: [] }));
    expect(await youtubeProvider.metrics!(creds, "gone")).toEqual({});
  });

  it.each([
    [401, undefined, "auth"],
    [403, "quotaExceeded", "rate_limit"],
    [403, "forbidden", "auth"],
    [429, undefined, "rate_limit"],
    [503, undefined, "temporary"],
    [400, "badRequest", "invalid"],
  ])("maps %i %s to %s", async (status, reason, kind) => {
    mockFetch(jsonResponse({ error: { code: status, message: "m", errors: reason ? [{ reason }] : [] } }, { status }));
    await expect(youtubeProvider.metrics!(creds, "v")).rejects.toMatchObject({ kind });
  });
});

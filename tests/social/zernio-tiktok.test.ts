import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAt, jsonResponse, mockFetch } from "./helpers";

vi.mock("@/lib/db", () => ({ prisma: {} }));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/errors", () => ({ logError }));

import { ensureZernioProfile, zernioAccount, zernioAccountChoice, zernioConnectUrl } from "@/lib/social/zernio/client";
import { creatorInfo, failure, privacyFor, publishTikTokViaZernio, resultOf, zernioResolve } from "@/lib/social/zernio/tiktok";
import { tiktokViaZernio, viaZernio } from "@/lib/social/zernio/ways";
import { getProvider } from "@/lib/social/registry";
import { acceptsVideo } from "@/lib/visuals/post-media";
import type { ConnectionCredentials, PublishRequest } from "@/lib/social/types";

// Zernio's answers here follow docs.zernio.com (read 3 November 2026), not a live Zernio account.
const API = "https://zernio.com/api/v1";
const ACCOUNT = "66b2e19d8c3f5a7e9d0b1c2d";
const PROFILE = "66a1f0c2a4b9d3e8f1a2b3c4";

const creds = (): ConnectionCredentials => ({ connectionId: "c1", externalAccountId: ACCOUNT, accountType: "creator", accessToken: PROFILE, method: "DIRECT", zernioProfile: PROFILE });
const video = (over: Partial<PublishRequest> = {}): PublishRequest => ({ format: "POST", text: "Fresh bread in Kigali #bakery", media: [{ url: "https://s/v.mp4", mimeType: "video/mp4" }], ...over });
const photos = (over: Partial<PublishRequest> = {}): PublishRequest => ({ format: "POST", text: "Our new cakes\nCome taste them this weekend", media: [{ url: "https://s/1.jpg", mimeType: "image/jpeg" }, { url: "https://s/2.png", mimeType: "image/png" }], ...over });
const ALL = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"];
const info = (levels = ALL, toggles: Record<string, unknown> = {}) =>
  jsonResponse({
    creator: { nickname: "inzozi", canPostMore: true },
    privacyLevels: levels.map((value) => ({ value, label: value })),
    postingLimits: { maxVideoDurationSec: 600, interactionSettings: { allow_comment: { enabled: true, required: true, default: false }, allow_duet: { enabled: true }, allow_stitch: { enabled: true }, ...toggles } },
  });
const posted = (entry: Record<string, unknown>, status = "published", code = 201) => jsonResponse({ post: { _id: "65f1c0a9e2b5af0012ab34cd", status, platforms: [{ platform: "tiktok", ...entry }] } }, { status: code });
const body = (fetch: ReturnType<typeof vi.fn>, i: number) => JSON.parse(callAt(fetch, i).body!);

beforeEach(() => {
  process.env.ZERNIO_API_KEY = "sk_test_zernio_123";
  logError.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ZERNIO_API_KEY;
});

describe("when TikTok goes through Zernio", () => {
  it("needs the key, and is for TikTok only", () => {
    expect(viaZernio("tiktok")).toBe(true);
    expect(viaZernio("linkedin")).toBe(false);
    delete process.env.ZERNIO_API_KEY;
    expect(viaZernio("tiktok")).toBe(false);
    expect(tiktokViaZernio()).toBe(false);
  });

  it("lets TikTok's rules take photo posts and real video posts", () => {
    const rules = getProvider("tiktok").rules;
    expect(rules.formats).toContain("POST");
    expect(rules.videoPosts).toBe(true);
    expect(acceptsVideo("tiktok", "a/b.mp4")).toBe(true);
    delete process.env.ZERNIO_API_KEY;
    expect(getProvider("tiktok").rules.formats).toEqual(["SCRIPT"]);
    expect(getProvider("tiktok").rules.videoPosts).toBe(false);
  });
});

describe("profiles, the connect link and the account", () => {
  it("finds the business's profile by its externalId", async () => {
    const fetch = mockFetch(jsonResponse({ profiles: [{ _id: PROFILE, name: "bupulse_biz1", externalId: "biz1" }] }));
    expect(await ensureZernioProfile("tiktok", "biz1", "Inzozi Bakery")).toBe(PROFILE);
    expect(callAt(fetch, 0).url).toBe(`${API}/profiles?externalId=biz1`);
    expect(callAt(fetch, 0).headers.authorization).toBe("Bearer sk_test_zernio_123");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("creates it on first use, and takes the existing one from a 409", async () => {
    let fetch = mockFetch(jsonResponse({ profiles: [] }), jsonResponse({ message: "Profile created", profile: { _id: PROFILE } }, { status: 201 }));
    expect(await ensureZernioProfile("tiktok", "biz1", "Inzozi Bakery")).toBe(PROFILE);
    expect(callAt(fetch, 1).url).toBe(`${API}/profiles`);
    expect(body(fetch, 1)).toEqual({ name: "bupulse_biz1", externalId: "biz1", description: "Inzozi Bakery" });
    fetch = mockFetch(jsonResponse({ profiles: [] }), jsonResponse({ error: "exists", type: "invalid_request_error", code: "profile_name_conflict", details: { existingProfileId: "other1" } }, { status: 409 }));
    expect(await ensureZernioProfile("tiktok", "biz1", "")).toBe("other1");
  });

  it("asks for TikTok's connect link with BuPulse's return address", async () => {
    const fetch = mockFetch(jsonResponse({ authUrl: "https://www.tiktok.com/v2/auth/authorize/?client_key=x", state: "z" }));
    const url = await zernioConnectUrl("tiktok", PROFILE, "https://bupulse.com/api/social/tiktok/zernio?state=s");
    expect(url).toBe("https://www.tiktok.com/v2/auth/authorize/?client_key=x");
    const asked = new URL(callAt(fetch, 0).url);
    expect(asked.pathname).toBe("/api/v1/connect/tiktok");
    expect(asked.searchParams.get("profileId")).toBe(PROFILE);
    expect(asked.searchParams.get("redirect_url")).toBe("https://bupulse.com/api/social/tiktok/zernio?state=s");
  });

  it("turns Zernio's account into the connection: its id, @username and picture", () => {
    expect(zernioAccountChoice({ _id: ACCOUNT, platform: "tiktok", username: "inzozi.bakery", displayName: "Inzozi", profilePicture: "https://p16.tiktokcdn.com/a.jpg", tiktokAccountType: "business" })).toEqual({
      externalAccountId: ACCOUNT,
      displayName: "@inzozi.bakery",
      avatarUrl: "https://p16.tiktokcdn.com/a.jpg",
      accountType: "business",
    });
    expect(zernioAccountChoice({ _id: ACCOUNT, displayName: "Inzozi", profilePicture: null })).toMatchObject({ displayName: "Inzozi", avatarUrl: undefined, accountType: "creator" });
    expect(zernioAccountChoice({})).toBeNull();
  });

  it("reads the account back from the business's profile only", async () => {
    const list = () => jsonResponse({ accounts: [{ _id: ACCOUNT, platform: "tiktok", profileId: PROFILE, username: "inzozi", isActive: true }], hasAnalyticsAccess: false });
    let fetch = mockFetch(list());
    expect((await zernioAccount("tiktok", PROFILE, ACCOUNT))?.externalAccountId).toBe(ACCOUNT);
    expect(callAt(fetch, 0).url).toBe(`${API}/accounts?profileId=${PROFILE}&platform=tiktok`);
    fetch = mockFetch(list());
    expect(await zernioAccount("tiktok", PROFILE, "someone-elses-account")).toBeNull();
    mockFetch(jsonResponse({ accounts: [{ _id: ACCOUNT, platform: "tiktok", profileId: { _id: PROFILE }, enabled: false }] }));
    expect(await zernioAccount("tiktok", PROFILE, ACCOUNT)).toBeNull();
  });
});

describe("privacy and the interaction switches", () => {
  it("is public whenever the account allows it, or when its levels are unknown", () => {
    expect(privacyFor(ALL)).toBe("PUBLIC_TO_EVERYONE");
    expect(privacyFor(null)).toBe("PUBLIC_TO_EVERYONE");
    expect(privacyFor([])).toBe("PUBLIC_TO_EVERYONE");
  });

  it("gives a private account its widest level", () => {
    expect(privacyFor(["MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"])).toBe("FOLLOWER_OF_CREATOR");
    expect(privacyFor(["SELF_ONLY"])).toBe("SELF_ONLY");
  });

  it("keeps comments, duets and stitches on unless the creator switched them off", async () => {
    mockFetch(info(ALL, { allow_duet: { enabled: false }, allow_stitch: null }));
    expect(await creatorInfo(ACCOUNT, "video")).toEqual({ levels: ALL, comment: true, duet: false, stitch: true });
    mockFetch(jsonResponse({ error: "boom" }, { status: 500 }));
    expect(await creatorInfo(ACCOUNT, "video")).toEqual({ levels: null, comment: true, duet: true, stitch: true });
    mockFetch(jsonResponse({ error: "Account is disconnected", code: "ACCOUNT_DISCONNECTED" }, { status: 403 }));
    await expect(creatorInfo(ACCOUNT, "video")).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("publishing", () => {
  it("posts a video straight to TikTok, public, with TikTok's required yes, and returns TikTok's post once it has a link", async () => {
    const fetch = mockFetch(info(), posted({ status: "published", platformPostUrl: "https://www.tiktok.com/@inzozi/video/7300000000000000001" }));
    const result = await publishTikTokViaZernio(creds(), video({ link: "https://inzozi.rw" }));
    expect(result).toEqual({ externalId: "7300000000000000001", permalink: "https://www.tiktok.com/@inzozi/video/7300000000000000001" });
    expect(callAt(fetch, 0).url).toBe(`${API}/accounts/${ACCOUNT}/tiktok/creator-info?mediaType=video`);
    expect(callAt(fetch, 1).url).toBe(`${API}/posts`);
    expect(body(fetch, 1)).toEqual({
      content: "Fresh bread in Kigali #bakery",
      mediaItems: [{ type: "video", url: "https://s/v.mp4" }],
      platforms: [{ platform: "tiktok", accountId: ACCOUNT }],
      tiktokSettings: { privacy_level: "PUBLIC_TO_EVERYONE", allow_comment: true, allow_duet: true, allow_stitch: true, content_preview_confirmed: true, express_consent_given: true },
      publishNow: true,
    });
  });

  it("posts photos as a carousel: a short title, the text as the description, music added", async () => {
    const fetch = mockFetch(info(), posted({ status: "published", platformPostUrl: "https://www.tiktok.com/@inzozi/photo/7300000000000000002" }));
    const result = await publishTikTokViaZernio(creds(), photos({ text: `${"Fresh cakes every morning. ".repeat(5)}\nSecond line` }));
    expect(result.externalId).toBe("7300000000000000002");
    expect(callAt(fetch, 0).url).toContain("mediaType=photo");
    const sent = body(fetch, 1);
    expect(sent.mediaItems).toEqual([{ type: "image", url: "https://s/1.jpg" }, { type: "image", url: "https://s/2.png" }]);
    expect(Array.from(sent.content as string).length).toBeLessThanOrEqual(90);
    expect(sent.tiktokSettings).toMatchObject({ media_type: "photo", photo_cover_index: 0, auto_add_music: true, privacy_level: "PUBLIC_TO_EVERYONE", allow_comment: true });
    expect(sent.tiktokSettings.description).toContain("Second line");
    expect(sent.tiktokSettings.allow_duet).toBeUndefined();
    expect(sent.tiktokSettings.draft).toBeUndefined();
  });

  it("counts a post TikTok has not linked yet as sent, under Zernio's post id", async () => {
    mockFetch(info(), posted({ status: "published", platformPostUrl: null }));
    expect(await publishTikTokViaZernio(creds(), video())).toEqual({ externalId: "zernio:65f1c0a9e2b5af0012ab34cd" });
    // 207 with the post set back to "scheduled": a passing error that Zernio retries by itself.
    mockFetch(info(), posted({ status: "pending" }, "scheduled", 207));
    expect(await publishTikTokViaZernio(creds(), video())).toEqual({ externalId: "zernio:65f1c0a9e2b5af0012ab34cd" });
  });

  it("reads a 207 failure: a reconnect, a later try or a refusal", async () => {
    mockFetch(info(), posted({ status: "failed", errorMessage: "Token expired", errorCategory: "auth_expired", errorSource: "user" }, "failed", 207));
    await expect(publishTikTokViaZernio(creds(), video())).rejects.toMatchObject({ kind: "auth", stage: "before" });
    mockFetch(info(), posted({ status: "failed", errorMessage: "TikTok direct posting is at capacity right now. Use tiktokSettings.draft: true to deliver via Creator Inbox, or try again in a few hours as capacity frees up." }, "failed", 207));
    await expect(publishTikTokViaZernio(creds(), video())).rejects.toMatchObject({ kind: "rate_limit" });
    mockFetch(info(), posted({ status: "failed", errorMessage: "TikTok flagged this post as potentially risky (spam_risk)", errorCategory: "platform_rejected" }, "failed", 207));
    await expect(publishTikTokViaZernio(creds(), video())).rejects.toMatchObject({ kind: "invalid" });
  });

  it("tells a private account to go public", async () => {
    mockFetch(info(["FOLLOWER_OF_CREATOR", "SELF_ONLY"]), jsonResponse({ error: "Selected privacy level 'FOLLOWER_OF_CREATOR' is not available for this creator. Available options: PUBLIC_TO_EVERYONE", type: "invalid_request_error", code: "invalid_field_value" }, { status: 400 }));
    const error = await publishTikTokViaZernio(creds(), video()).catch((e) => e);
    expect(error.kind).toBe("invalid");
    expect(failure("Selected privacy level 'X' is not available for this creator.")).toMatchObject({ kind: "invalid", message: expect.stringContaining("public") });
  });

  it("asks for a reconnect when Zernio says the account is disconnected", async () => {
    mockFetch(info(), jsonResponse({ error: "Account is disconnected and cannot be posted to.", code: "ACCOUNT_DISCONNECTED" }, { status: 403 }));
    await expect(publishTikTokViaZernio(creds(), video())).rejects.toMatchObject({ kind: "auth" });
  });

  it("waits on Zernio's limits and billing, telling the owner about billing", async () => {
    mockFetch(info(), jsonResponse({ error: "Velocity limit: 25 posts per hour" }, { status: 429, headers: { "retry-after": "120" } }));
    await expect(publishTikTokViaZernio(creds(), video())).rejects.toMatchObject({ kind: "rate_limit", retryAfter: 120 });
    mockFetch(info(), jsonResponse({ error: "Add a payment method", code: "PAYMENT_REQUIRED", reason: "free_tier_exceeded" }, { status: 402 }));
    const error = await publishTikTokViaZernio(creds(), video()).catch((e) => e);
    expect(error.kind).toBe("rate_limit");
    expect(error.retryAfter).toBeGreaterThanOrEqual(3600);
    expect(logError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ source: "social.zernio", network: "tiktok" }));
  });

  it("never resends after a timeout or a 5xx on the post itself", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(info()).mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", fetch);
    await expect(publishTikTokViaZernio(creds(), video())).rejects.toMatchObject({ kind: "temporary", stage: "final" });
    mockFetch(info(), jsonResponse({ error: "upstream down", type: "api_error", code: "temporarily_unavailable" }, { status: 503 }));
    await expect(publishTikTokViaZernio(creds(), video())).rejects.toMatchObject({ kind: "temporary", stage: "final" });
    // The docs call this normal for a large video still being processed: it may still appear.
    expect(failure("Publishing failed during platform API call (timeout waiting for platform response)")).toMatchObject({ kind: "temporary", stage: "final" });
  });

  it("refuses posts TikTok cannot take, without calling Zernio", async () => {
    const fetch = mockFetch();
    await expect(publishTikTokViaZernio(creds(), video({ media: [] }))).rejects.toMatchObject({ kind: "invalid" });
    await expect(publishTikTokViaZernio(creds(), video({ media: [{ url: "https://s/1.jpg", mimeType: "image/jpeg" }, { url: "https://s/v.mp4", mimeType: "video/mp4" }] }))).rejects.toMatchObject({ kind: "invalid" });
    await expect(publishTikTokViaZernio(creds(), video({ media: [{ url: "https://s/v.avi", mimeType: "video/x-msvideo" }] }))).rejects.toMatchObject({ kind: "invalid" });
    await expect(publishTikTokViaZernio(creds(), photos({ media: Array.from({ length: 36 }, (_, i) => ({ url: `https://s/${i}.jpg`, mimeType: "image/jpeg" })) }))).rejects.toMatchObject({ kind: "invalid" });
    await expect(publishTikTokViaZernio(creds(), video({ text: "a".repeat(2201) }))).rejects.toMatchObject({ kind: "invalid" });
    await expect(publishTikTokViaZernio({ ...creds(), zernioProfile: undefined }, video())).rejects.toMatchObject({ kind: "auth" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("tells the kinds of failures apart", () => {
    expect(failure("You have created too many posts in the last 24 hours via the API.")).toMatchObject({ kind: "rate_limit" });
    expect(failure("Missing required TikTok permissions. Please reconnect with all required scopes.")).toMatchObject({ kind: "auth" });
    expect(failure("TikTok video upload failed: Your video URL returned an error (download failed)")).toMatchObject({ kind: "temporary", stage: "before" });
    expect(failure("Duplicate content detected.")).toMatchObject({ kind: "invalid" });
    expect(failure("Platform maintenance", "platform_error")).toMatchObject({ kind: "temporary" });
    expect(() => resultOf({ _id: "p1", status: "cancelled", platforms: [{ platform: "tiktok", status: "cancelled" }] })).toThrow(expect.objectContaining({ kind: "auth" }));
  });
});

describe("the registry", () => {
  it("publishes TikTok's Zernio connections through Zernio and finds the TikTok link later", async () => {
    const fetch = mockFetch(info(), posted({ status: "published", platformPostUrl: null }));
    const provider = getProvider("tiktok");
    expect((await provider.publish(creds(), video())).externalId).toBe("zernio:65f1c0a9e2b5af0012ab34cd");
    expect(callAt(fetch, 1).url).toBe(`${API}/posts`);
    mockFetch(posted({ status: "published", platformPostUrl: "https://www.tiktok.com/@inzozi/video/7300000000000000009" }, "published", 200));
    expect(await provider.metrics!(creds(), "zernio:65f1c0a9e2b5af0012ab34cd")).toEqual({ resolved: { externalId: "7300000000000000009", permalink: "https://www.tiktok.com/@inzozi/video/7300000000000000009" } });
    mockFetch(posted({ status: "published", platformPostUrl: null }, "published", 200));
    expect(await zernioResolve("zernio:65f1c0a9e2b5af0012ab34cd")).toEqual({});
    const none = mockFetch();
    expect(await provider.metrics!(creds(), "7300000000000000009")).toEqual({});
    expect(none).not.toHaveBeenCalled();
  });
});

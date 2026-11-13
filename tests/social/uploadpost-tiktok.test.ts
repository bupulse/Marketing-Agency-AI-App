import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAt, jsonResponse, mockFetch } from "./helpers";

vi.mock("@/lib/db", () => ({ prisma: {} }));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/errors", () => ({ logError }));

import { connectLink } from "@/lib/social/uploadpost/client";
import { resetServiceFaultsForTests } from "@/lib/admin/service-faults";
import { timing } from "@/lib/social/uploadpost/upload";
import { failure, privacyFor, publishTikTok, tiktokAccountFrom, tiktokAccounts } from "@/lib/social/uploadpost/tiktok";
import { tiktokViaUploadPost, viaUploadPost } from "@/lib/social/uploadpost/ways";
import { getProvider } from "@/lib/social/registry";
import { acceptsVideo } from "@/lib/visuals/post-media";
import type { ConnectionCredentials, PublishRequest } from "@/lib/social/types";

const API = "https://api.upload-post.com/api";
const form = (fn: ReturnType<typeof vi.fn>, i: number) => callAt(fn, i).init.body as FormData;

const creds = (): ConnectionCredentials => ({ connectionId: "c1", externalAccountId: "open_1", accountType: "creator", accessToken: "bupulse_biz1", method: "DIRECT", uploadPostProfile: "bupulse_biz1" });
const video = (over: Partial<PublishRequest> = {}): PublishRequest => ({ format: "POST", text: "Fresh bread in Kigali #bakery", media: [{ url: "https://s/v.mp4", mimeType: "video/mp4" }], ...over });
const photos = (over: Partial<PublishRequest> = {}): PublishRequest => ({ format: "POST", text: "Our new cakes\nCome taste them this weekend", media: [{ url: "https://s/1.jpg", mimeType: "image/jpeg" }, { url: "https://s/2.webp", mimeType: "image/webp" }], ...over });
const settings = (options = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]) => jsonResponse({ success: true, privacy_level_options: options, max_video_post_duration_sec: 600 });
const started = (requestId = "req1") => jsonResponse({ success: true, message: "Upload initiated successfully in background.", request_id: requestId, total_platforms: 1 });
const status = (entry: Record<string, unknown>, top = "completed") => jsonResponse({ request_id: "req1", status: top, results: [{ platform: "tiktok", ...entry }] });

beforeEach(() => {
  process.env.UPLOAD_POST_API_KEY = "up_test_key_123";
  process.env.UPLOAD_POST_TIKTOK = "true";
  timing.pollMs = 0;
  timing.polls = 3;
  logError.mockReset();
  resetServiceFaultsForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.UPLOAD_POST_API_KEY;
  delete process.env.UPLOAD_POST_TIKTOK;
});

describe("when TikTok goes through Upload-Post", () => {
  it("needs the key and UPLOAD_POST_TIKTOK=true (TikTok is on Upload-Post's paid plans only)", () => {
    expect(viaUploadPost("tiktok")).toBe(true);
    delete process.env.UPLOAD_POST_TIKTOK;
    expect(viaUploadPost("tiktok")).toBe(false);
    expect(viaUploadPost("linkedin")).toBe(true);
    process.env.UPLOAD_POST_TIKTOK = "true";
    delete process.env.UPLOAD_POST_API_KEY;
    expect(viaUploadPost("tiktok")).toBe(false);
    expect(tiktokViaUploadPost()).toBe(false);
  });

  it("lets TikTok's rules take photo posts and real video posts", () => {
    const rules = getProvider("tiktok").rules;
    expect(rules.formats).toContain("POST");
    expect(rules.videoPosts).toBe(true);
    expect(acceptsVideo("tiktok", "a/b.mp4")).toBe(true);
    delete process.env.UPLOAD_POST_TIKTOK;
    expect(getProvider("tiktok").rules.formats).toEqual(["SCRIPT"]);
    expect(getProvider("tiktok").rules.videoPosts).toBe(false);
    expect(acceptsVideo("tiktok", "a/b.mp4")).toBe(false);
  });
});

describe("the account of a sign-in", () => {
  it("takes the open_id as the id and the @handle as the name", () => {
    expect(tiktokAccountFrom({ username: "open_1", handle: "inzozi.bakery", display_name: "Inzozi", social_images: "https://p16.tiktokcdn.com/a.jpg", reauth_required: false })).toEqual({
      externalAccountId: "open_1",
      displayName: "@inzozi.bakery",
      avatarUrl: "https://p16.tiktokcdn.com/a.jpg",
      accountType: "creator",
    });
    expect(tiktokAccountFrom({ username: "open_2", display_name: "Inzozi" })?.displayName).toBe("Inzozi");
    expect(tiktokAccountFrom(null)).toBeNull();
    expect(tiktokAccountFrom({})).toBeNull();
  });

  it("reads the profile's TikTok entry, or null when TikTok was not connected", async () => {
    const fetch = mockFetch(jsonResponse({ success: true, profile: { username: "bupulse_biz1", social_accounts: { linkedin: { username: "abc" }, tiktok: { username: "open_1", display_name: "Inzozi" } } } }));
    expect(await tiktokAccounts("bupulse_biz1")).toEqual([{ externalAccountId: "open_1", displayName: "Inzozi", avatarUrl: undefined, accountType: "creator" }]);
    expect(callAt(fetch, 0).url).toBe(`${API}/uploadposts/users/bupulse_biz1`);
    mockFetch(jsonResponse({ success: true, profile: { username: "bupulse_biz1", social_accounts: { linkedin: { username: "abc" } } } }));
    expect(await tiktokAccounts("bupulse_biz1")).toBeNull();
  });

  it("asks for a TikTok-only connect page", async () => {
    const fetch = mockFetch(jsonResponse({ success: true, access_url: "https://app.upload-post.com/connect?token=jwt" }));
    await connectLink("tiktok", "bupulse_biz1", "https://bupulse.com/api/social/tiktok/uploadpost?state=s");
    const body = JSON.parse(callAt(fetch, 0).body!);
    expect(body).toMatchObject({ username: "bupulse_biz1", platforms: ["tiktok"], show_calendar: false, connect_title: "Connect TikTok to BuPulse" });
  });
});

describe("privacy", () => {
  it("is public whenever the account allows it, or when its options are unknown", () => {
    expect(privacyFor(["PUBLIC_TO_EVERYONE", "SELF_ONLY"], "video")).toBe("PUBLIC_TO_EVERYONE");
    expect(privacyFor(["PUBLIC_TO_EVERYONE", "SELF_ONLY"], "photos")).toBe("PUBLIC_TO_EVERYONE");
    expect(privacyFor(null, "video")).toBe("PUBLIC_TO_EVERYONE");
  });

  it("leaves a private account's video on its own default, and its photos on the widest level it has", () => {
    const priv = ["MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"];
    expect(privacyFor(priv, "video")).toBeUndefined();
    expect(privacyFor(priv, "photos")).toBe("FOLLOWER_OF_CREATOR");
    expect(privacyFor(["SELF_ONLY"], "photos")).toBe("SELF_ONLY");
  });
});

describe("publishing", () => {
  it("posts a video publicly with the caption as its title and returns TikTok's post once it has a link", async () => {
    const fetch = mockFetch(settings(), started(), status({ success: true, status: "completed", platform_post_id: "7300000000000000001", post_url: "https://www.tiktok.com/@inzozi/video/7300000000000000001" }));
    const result = await publishTikTok(creds(), video({ link: "https://inzozi.rw" }));
    expect(result).toEqual({ externalId: "7300000000000000001", permalink: "https://www.tiktok.com/@inzozi/video/7300000000000000001" });
    expect(callAt(fetch, 0).url).toBe(`${API}/uploadposts/tiktok/settings?profile=bupulse_biz1`);
    expect(callAt(fetch, 1).url).toBe(`${API}/upload`);
    const body = form(fetch, 1);
    expect(body.get("user")).toBe("bupulse_biz1");
    expect(body.getAll("platform[]")).toEqual(["tiktok"]);
    expect(body.get("video")).toBe("https://s/v.mp4");
    expect(body.get("title")).toBe("Fresh bread in Kigali #bakery");
    expect(body.get("description")).toBeNull();
    expect(body.get("privacy_level")).toBe("PUBLIC_TO_EVERYONE");
    expect(body.get("async_upload")).toBe("true");
    expect(body.get("disable_inbox_fallback")).toBe("true");
    expect(String(body.get("request_id"))).toMatch(/^bp-/);
    expect(callAt(fetch, 2).url).toBe(`${API}/uploadposts/status?request_id=req1`);
  });

  it("posts photos in photo mode: a short title, the text as the description, music added", async () => {
    const fetch = mockFetch(settings(), started(), status({ success: true, status: "completed", post_url: "https://www.tiktok.com/@inzozi/photo/7300000000000000002" }));
    const result = await publishTikTok(creds(), photos({ text: `${"Fresh cakes every morning. ".repeat(5)}\nSecond line` }));
    expect(result.externalId).toBe("7300000000000000002");
    expect(callAt(fetch, 1).url).toBe(`${API}/upload_photos`);
    const body = form(fetch, 1);
    expect(body.getAll("photos[]")).toEqual(["https://s/1.jpg", "https://s/2.webp"]);
    expect(String(body.get("title")).length).toBeLessThanOrEqual(90);
    expect(String(body.get("tiktok_description"))).toContain("Second line");
    expect(body.get("auto_add_music")).toBe("true");
    expect(body.get("photo_cover_index")).toBe("0");
    expect(body.get("privacy_level")).toBe("PUBLIC_TO_EVERYONE");
  });

  it("follows a private account's settings", async () => {
    const priv = ["MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"];
    let fetch = mockFetch(settings(priv), started(), status({ success: true, status: "completed" }));
    await publishTikTok(creds(), video());
    expect(form(fetch, 1).get("privacy_level")).toBeNull();
    fetch = mockFetch(settings(priv), started(), status({ success: true, status: "completed" }));
    await publishTikTok(creds(), photos());
    expect(form(fetch, 1).get("privacy_level")).toBe("FOLLOWER_OF_CREATOR");
  });

  it("sends public when the settings cannot be read, but stops when the TikTok connection is gone", async () => {
    const fetch = mockFetch(jsonResponse({ success: false, error: "boom" }, { status: 500 }), started(), status({ success: true, status: "completed" }));
    await publishTikTok(creds(), video());
    expect(form(fetch, 1).get("privacy_level")).toBe("PUBLIC_TO_EVERYONE");
    const gone = mockFetch(jsonResponse({ success: false, message: "Profile bupulse_biz1 has no Tiktok account configured" }, { status: 400 }));
    await expect(publishTikTok(creds(), video())).rejects.toMatchObject({ kind: "auth" });
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it("refuses posts TikTok cannot take, without calling Upload-Post", async () => {
    const fetch = mockFetch();
    await expect(publishTikTok(creds(), video({ media: [] }))).rejects.toMatchObject({ kind: "invalid" });
    await expect(publishTikTok(creds(), video({ media: [{ url: "https://s/1.jpg", mimeType: "image/jpeg" }, { url: "https://s/v.mp4", mimeType: "video/mp4" }] }))).rejects.toMatchObject({ kind: "invalid" });
    await expect(publishTikTok(creds(), video({ media: [{ url: "https://s/v.avi", mimeType: "video/x-msvideo" }] }))).rejects.toMatchObject({ kind: "invalid" });
    await expect(publishTikTok(creds(), photos({ media: Array.from({ length: 36 }, (_, i) => ({ url: `https://s/${i}.jpg`, mimeType: "image/jpeg" })) }))).rejects.toMatchObject({ kind: "invalid" });
    await expect(publishTikTok(creds(), video({ text: "a".repeat(2201) }))).rejects.toMatchObject({ kind: "invalid" });
    await expect(publishTikTok({ ...creds(), uploadPostProfile: undefined }, video())).rejects.toMatchObject({ kind: "auth" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("counts a post TikTok has not made public yet as sent, under Upload-Post's request id", async () => {
    // Late post id: success with no link yet, platform_post_id is only TikTok's temporary publish id.
    mockFetch(settings(), started("req7"), status({ success: true, status: "completed", platform_post_id: "v_pub_url~v2.123", post_url: null, warnings: ["post id will follow"] }));
    expect(await publishTikTok(creds(), video())).toEqual({ externalId: "uploadpost:req7" });
    const queued = () => status({ success: true, status: "processing" }, "in_progress");
    mockFetch(settings(), started("req8"), queued(), queued(), queued());
    expect(await publishTikTok(creds(), video())).toEqual({ externalId: "uploadpost:req8" });
  });

  it("asks for a reconnect when TikTok's sign-in expired or the account was removed", async () => {
    mockFetch(settings(), started(), status({ success: false, status: "failed", error: "Access token invalid or expired", error_code: "tiktok_reconnect_required" }, "failed"));
    await expect(publishTikTok(creds(), video())).rejects.toMatchObject({ kind: "auth", stage: "before" });
    mockFetch(settings(), started(), status({ success: false, status: "skipped", skipped: true, skip_reason: "profile_platform_not_configured" }, "failed"));
    await expect(publishTikTok(creds(), video())).rejects.toMatchObject({ kind: "auth" });
  });

  it("retries later on TikTok's daily cap, and says so when BuPulse's plan has no TikTok", async () => {
    mockFetch(settings(), jsonResponse({ success: false, message: "Daily cap reached", error_code: "reached_active_user_cap" }, { status: 400 }));
    await expect(publishTikTok(creds(), video())).rejects.toMatchObject({ kind: "rate_limit", stage: "before" });
    mockFetch(settings(), jsonResponse({ success: false, message: "TikTok is available on paid plans only" }, { status: 403 }));
    const error = await publishTikTok(creds(), video()).catch((e) => e);
    expect(error.kind).toBe("rate_limit");
    expect(error.retryAfter).toBeGreaterThanOrEqual(3600);
    expect(logError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ source: "service-fault.uploadpost:plan-limit" }));
  });

  it("never resends after a timeout on the upload itself", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(settings()).mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", fetch);
    await expect(publishTikTok(creds(), video())).rejects.toMatchObject({ kind: "temporary", stage: "final" });
  });

  it("tells the kinds of TikTok failures apart", () => {
    expect(failure("Privacy level not available", "tiktok_privacy_unavailable")).toMatchObject({ kind: "invalid" });
    expect(failure("File refused", "tiktok_media_rejected")).toMatchObject({ kind: "invalid" });
    expect(failure("TikTok internal error", "tiktok_publish_failed")).toMatchObject({ kind: "temporary", stage: "before" });
    expect(failure("spam_risk_too_many_posts")).toMatchObject({ kind: "rate_limit" });
    expect(failure("Video duration exceeds the account's maximum")).toMatchObject({ kind: "invalid" });
  });
});

describe("the registry", () => {
  it("publishes TikTok's Upload-Post connections through Upload-Post and reads no numbers for them", async () => {
    const fetch = mockFetch(settings(), started(), status({ success: true, status: "completed", post_url: "https://www.tiktok.com/@inzozi/video/7300000000000000009" }));
    const provider = getProvider("tiktok");
    expect((await provider.publish(creds(), video())).externalId).toBe("7300000000000000009");
    expect(callAt(fetch, 1).url).toBe(`${API}/upload`);
    expect(await provider.metrics!(creds(), "7300000000000000009")).toEqual({});
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAt, jsonResponse, mockFetch } from "./helpers";

vi.mock("@/lib/db", () => ({ prisma: {} }));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/errors", () => ({ logError }));

import { connectLink, ensureProfile, linkedinPages, UploadPostError } from "@/lib/social/uploadpost/client";
import { accountsFrom, linkedinAccounts, publishLinkedIn, shortTitle, statusOutcome, timing } from "@/lib/social/uploadpost/linkedin";
import { pageTarget, profileScope, profileUsername, scopeProfile, viaUploadPost } from "@/lib/social/uploadpost/ways";
import { getProvider } from "@/lib/social/registry";
import { SocialError, type ConnectionCredentials, type PublishRequest } from "@/lib/social/types";

const API = "https://api.upload-post.com/api";
const form = (fn: ReturnType<typeof vi.fn>, i: number) => callAt(fn, i).init.body as FormData;

const creds = (accountType: "member" | "organization", externalAccountId = accountType === "organization" ? "42" : "m1"): ConnectionCredentials => ({
  connectionId: "c1",
  externalAccountId,
  accountType,
  accessToken: "bupulse_biz1",
  method: "DIRECT",
  uploadPostProfile: "bupulse_biz1",
});
const post = (over: Partial<PublishRequest> = {}): PublishRequest => ({ format: "POST", text: "Hello Kigali", media: [], ...over });
const started = (requestId = "req1") => jsonResponse({ success: true, message: "Upload initiated successfully in background.", request_id: requestId, total_platforms: 1 });

beforeEach(() => {
  process.env.UPLOAD_POST_API_KEY = "up_test_key_123";
  timing.pollMs = 0;
  timing.polls = 3;
  logError.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.UPLOAD_POST_API_KEY;
});

describe("which networks go through Upload-Post", () => {
  it("routes LinkedIn only, and only while the key is set", () => {
    expect(viaUploadPost("linkedin")).toBe(true);
    expect(viaUploadPost("facebook")).toBe(false);
    delete process.env.UPLOAD_POST_API_KEY;
    expect(viaUploadPost("linkedin")).toBe(false);
  });

  it("names one profile per business with the characters Upload-Post allows", () => {
    expect(profileUsername("1b2c-3d4e")).toBe("bupulse_1b2c-3d4e");
    expect(profileUsername("a.b/c")).toBe("bupulse_a_b_c");
    expect(scopeProfile(["uploadpost", profileScope("bupulse_x")])).toBe("bupulse_x");
  });

  it("sends a Page as its organization URN", () => {
    expect(pageTarget("42")).toBe("urn:li:organization:42");
    expect(pageTarget("urn:li:organization:42")).toBe("urn:li:organization:42");
  });
});

describe("the accounts of a sign-in", () => {
  it("lists the member, then each Page by its number with its name and logo", () => {
    const accounts = accountsFrom(
      { username: "urn:li:person:abc", display_name: "Aline U.", social_images: "https://media.licdn.com/me.jpg" },
      [
        { id: "urn:li:organization:12345678", name: "Inzozi Bakery", picture: "https://media.licdn.com/logo.png", vanityName: "inzozi" },
        { id: "urn:li:organization:87654321", name: null, picture: null },
        { id: "urn:li:organization:12345678", name: "Inzozi Bakery" },
      ],
    );
    expect(accounts).toEqual([
      { externalAccountId: "abc", displayName: "Aline U.", avatarUrl: "https://media.licdn.com/me.jpg", accountType: "member" },
      { externalAccountId: "12345678", displayName: "Inzozi Bakery", avatarUrl: "https://media.licdn.com/logo.png", accountType: "organization" },
      { externalAccountId: "87654321", displayName: "LinkedIn Page 87654321", avatarUrl: undefined, accountType: "organization" },
    ]);
  });

  it("is null when LinkedIn was not connected", () => {
    expect(accountsFrom(null, [])).toBeNull();
    expect(accountsFrom("", [])).toBeNull();
  });

  it("reads the profile, then its Pages (none: Upload-Post answers 404)", async () => {
    const fetch = mockFetch(
      jsonResponse({ success: true, profile: { username: "bupulse_biz1", social_accounts: { linkedin: { username: "abc", display_name: "Aline" } } } }),
      jsonResponse({ success: false, message: "No LinkedIn pages found" }, { status: 404 }),
    );
    const accounts = await linkedinAccounts("bupulse_biz1");
    expect(accounts?.map((a) => a.accountType)).toEqual(["member"]);
    expect(callAt(fetch, 0).url).toBe(`${API}/uploadposts/users/bupulse_biz1`);
    expect(callAt(fetch, 0).headers.authorization).toBe("Apikey up_test_key_123");
    expect(callAt(fetch, 1).url).toBe(`${API}/uploadposts/linkedin/pages?profile=bupulse_biz1`);
  });

  it("is null when the profile has no LinkedIn yet", async () => {
    mockFetch(jsonResponse({ success: true, profile: { username: "bupulse_biz1", social_accounts: { linkedin: null } } }));
    expect(await linkedinAccounts("bupulse_biz1")).toBeNull();
  });
});

describe("profiles and the connect page", () => {
  it("creates the profile, or reuses one that exists", async () => {
    const fetch = mockFetch(jsonResponse({ success: true }, { status: 201 }), jsonResponse({ success: false, message: "exists" }, { status: 409 }));
    await ensureProfile("linkedin", "bupulse_biz1", "Inzozi Bakery");
    await ensureProfile("linkedin", "bupulse_biz1", "Inzozi Bakery");
    expect(JSON.parse(callAt(fetch, 0).body!)).toEqual({ username: "bupulse_biz1", display_name: "Inzozi Bakery" });
    expect(callAt(fetch, 0).init.method).toBe("POST");
  });

  it("at the plan's profile limit still uses an existing profile, and says so when there is none", async () => {
    mockFetch(jsonResponse({ success: false, error_code: "PROFILE_LIMIT_REACHED" }, { status: 403 }), jsonResponse({ success: true, profile: { username: "bupulse_biz1" } }));
    await expect(ensureProfile("linkedin", "bupulse_biz1", "")).resolves.toBeUndefined();

    mockFetch(jsonResponse({ success: false, error_code: "PROFILE_LIMIT_REACHED" }, { status: 403 }), jsonResponse({ success: false, message: "Profile not found" }, { status: 404 }));
    const error = await ensureProfile("linkedin", "bupulse_biz2", "").catch((e) => e);
    expect(error).toBeInstanceOf(UploadPostError);
    expect(error.status).toBe(403);
    expect(logError).toHaveBeenCalled();
  });

  it("asks for a LinkedIn-only connect page that comes back to BuPulse", async () => {
    const fetch = mockFetch(jsonResponse({ success: true, access_url: "https://app.upload-post.com/connect?token=jwt", duration: "48h" }));
    const url = await connectLink("linkedin", "bupulse_biz1", "https://bupulse.com/api/social/linkedin/uploadpost?state=s");
    expect(url).toBe("https://app.upload-post.com/connect?token=jwt");
    const body = JSON.parse(callAt(fetch, 0).body!);
    expect(callAt(fetch, 0).url).toBe(`${API}/uploadposts/users/generate-jwt`);
    expect(body).toMatchObject({ username: "bupulse_biz1", redirect_url: "https://bupulse.com/api/social/linkedin/uploadpost?state=s", platforms: ["linkedin"], show_calendar: false });
  });

  it("treats a failing Pages list as a failure, not as 'no Pages'", async () => {
    mockFetch(jsonResponse({ success: false, error: "LinkedIn API error" }, { status: 500 }));
    await expect(linkedinPages("bupulse_biz1")).rejects.toMatchObject({ kind: "temporary" });
  });
});

describe("publishing", () => {
  it("posts text as the Page with a link preview and returns LinkedIn's post", async () => {
    const fetch = mockFetch(
      started(),
      jsonResponse({ request_id: "req1", status: "completed", completed: 1, total: 1, results: [{ platform: "linkedin", success: true, status: "completed", platform_post_id: "urn:li:share:777", post_url: "https://www.linkedin.com/feed/update/urn:li:share:777" }] }),
    );
    const result = await publishLinkedIn(creds("organization"), post({ link: "https://inzozi.rw/menu" }));
    expect(result).toEqual({ externalId: "urn:li:share:777", permalink: "https://www.linkedin.com/feed/update/urn:li:share:777" });
    expect(callAt(fetch, 0).url).toBe(`${API}/upload_text`);
    const body = form(fetch, 0);
    expect(body.get("user")).toBe("bupulse_biz1");
    expect(body.getAll("platform[]")).toEqual(["linkedin"]);
    expect(body.get("title")).toBe("Hello Kigali");
    expect(body.get("linkedin_link_url")).toBe("https://inzozi.rw/menu");
    expect(body.get("target_linkedin_page_id")).toBe("urn:li:organization:42");
    expect(body.get("async_upload")).toBe("true");
    expect(String(body.get("request_id"))).toMatch(/^bp-/);
    expect(callAt(fetch, 1).url).toBe(`${API}/uploadposts/status?request_id=req1`);
  });

  it("posts on the member's profile without a Page id", async () => {
    const fetch = mockFetch(started(), jsonResponse({ status: "completed", results: [{ platform: "linkedin", success: true, status: "completed", post_id: "urn:li:share:1" }] }));
    await publishLinkedIn(creds("member"), post());
    expect(form(fetch, 0).get("target_linkedin_page_id")).toBeNull();
  });

  it("sends photos by their links, the text as the description and a short title", async () => {
    const fetch = mockFetch(started(), jsonResponse({ status: "completed", results: [{ platform: "linkedin", success: true, status: "completed", platform_post_id: "urn:li:share:2" }] }));
    const text = `${"Fresh bread every morning. ".repeat(12)}\nSecond line`;
    await publishLinkedIn(creds("organization"), post({ text, link: "https://inzozi.rw", media: [{ url: "https://s/1.jpg", mimeType: "image/jpeg" }, { url: "https://s/2.png", mimeType: "image/png" }] }));
    const body = form(fetch, 0);
    expect(callAt(fetch, 0).url).toBe(`${API}/upload_photos`);
    expect(body.getAll("photos[]")).toEqual(["https://s/1.jpg", "https://s/2.png"]);
    expect(String(body.get("description"))).toBe(`${text}\n\nhttps://inzozi.rw`);
    expect(String(body.get("title")).length).toBeLessThanOrEqual(200);
    expect(body.get("linkedin_link_url")).toBeNull();
  });

  it("sends one video by its link", async () => {
    const fetch = mockFetch(started(), jsonResponse({ status: "completed", results: [{ platform: "linkedin", success: true, status: "completed", platform_post_id: "urn:li:ugcPost:3" }] }));
    await publishLinkedIn(creds("organization"), post({ media: [{ url: "https://s/v.mp4", mimeType: "video/mp4" }] }));
    expect(callAt(fetch, 0).url).toBe(`${API}/upload`);
    expect(form(fetch, 0).get("video")).toBe("https://s/v.mp4");
  });

  it("refuses a photo and a video together, and an empty post, without calling Upload-Post", async () => {
    const fetch = mockFetch();
    await expect(publishLinkedIn(creds("member"), post({ media: [{ url: "https://s/1.jpg", mimeType: "image/jpeg" }, { url: "https://s/v.mp4", mimeType: "video/mp4" }] }))).rejects.toMatchObject({ kind: "invalid" });
    await expect(publishLinkedIn(creds("member"), post({ text: " " }))).rejects.toMatchObject({ kind: "invalid" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks for a reconnect when LinkedIn's session expired", async () => {
    mockFetch(started(), jsonResponse({ status: "failed", results: [{ platform: "linkedin", success: false, status: "failed", error: "Your LinkedIn session has expired. Please reconnect your LinkedIn account." }] }));
    const error = await publishLinkedIn(creds("organization"), post()).catch((e) => e);
    expect(error).toBeInstanceOf(SocialError);
    expect(error.kind).toBe("auth");
    expect(error.stage).toBe("before");
  });

  it("says clearly when BuPulse's monthly upload limit is used up, and tells the owner", async () => {
    mockFetch(jsonResponse({ success: false, message: "This upload would exceed your monthly limit.", usage: { count: 10, limit: 10 } }, { status: 429 }));
    const error = await publishLinkedIn(creds("organization"), post()).catch((e) => e);
    expect(error.kind).toBe("rate_limit");
    expect(error.stage).toBe("before");
    expect(error.message).toContain("10 of 10 this month");
    expect(error.retryAfter).toBeGreaterThanOrEqual(3600);
    expect(logError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ source: "social.uploadpost" }));
  });

  it("asks for a reconnect when the profile has no LinkedIn any more", async () => {
    mockFetch(jsonResponse({ success: false, message: 'None of the requested platforms are valid for profile "bupulse_biz1". Profile bupulse_biz1 has no Linkedin account configured' }, { status: 400 }));
    await expect(publishLinkedIn(creds("member"), post())).rejects.toMatchObject({ kind: "auth" });
  });

  it("never resends after a timeout or an Upload-Post outage on the upload itself", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    await expect(publishLinkedIn(creds("member"), post())).rejects.toMatchObject({ kind: "temporary", stage: "final" });
    mockFetch(jsonResponse({ success: false, error: "boom" }, { status: 502 }));
    await expect(publishLinkedIn(creds("member"), post())).rejects.toMatchObject({ kind: "temporary", stage: "final" });
  });

  it("counts a post still on its way after the checks as sent, under Upload-Post's request id", async () => {
    const queued = () => jsonResponse({ status: "in_progress", results: [{ platform: "linkedin", success: true, message: "Queued", status: "queued" }] });
    mockFetch(started("req9"), queued(), queued(), jsonResponse({}, { status: 500 }));
    expect(await publishLinkedIn(creds("organization"), post())).toEqual({ externalId: "uploadpost:req9" });
  });

  it("reads the status answers", () => {
    expect(statusOutcome({ status: "in_progress", results: [{ platform: "linkedin", success: true, message: "Queued" }] })).toEqual({ state: "pending" });
    expect(statusOutcome({ status: "processing", results: [{ platform: "linkedin", success: false, status: "retryable", error: "LinkedIn 500" }] })).toEqual({ state: "pending" });
    expect(statusOutcome({ status: "failed", message: "Upload appears to have failed", results: [] })).toEqual({ state: "failed", message: "Upload appears to have failed" });
  });

  it("keeps a title short and whole", () => {
    expect(shortTitle("\n  First line\nSecond")).toBe("First line");
    expect(shortTitle("😀".repeat(150)).length).toBe(200);
  });
});

describe("the registry", () => {
  it("publishes Upload-Post connections through Upload-Post and reads no numbers for them", async () => {
    const fetch = mockFetch(started(), jsonResponse({ status: "completed", results: [{ platform: "linkedin", success: true, status: "completed", platform_post_id: "urn:li:share:5" }] }));
    const provider = getProvider("linkedin");
    expect((await provider.publish(creds("organization"), post())).externalId).toBe("urn:li:share:5");
    expect(callAt(fetch, 0).url).toBe(`${API}/upload_text`);
    expect(await provider.metrics!(creds("organization"), "urn:li:share:5")).toEqual({});
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

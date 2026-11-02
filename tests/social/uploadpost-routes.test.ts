import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAt, jsonResponse, mockFetch } from "./helpers";
// Plans are not part of this test's database: every plan feature is granted (tests/stubs/entitlements.ts).
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(),
  rateLimit: vi.fn(),
  saveConnections: vi.fn(),
  forgetUnusedUploadPost: vi.fn(),
  prisma: { business: { findUnique: vi.fn() }, serviceSwitch: { findMany: vi.fn() } },
}));

vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/rate-limit")>()), rateLimit: mocks.rateLimit }));
vi.mock("@/lib/social/connections", () => ({ saveConnections: mocks.saveConnections, forgetUnusedUploadPost: mocks.forgetUnusedUploadPost }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => { throw new Error("not on cloudflare"); } }));

import { GET as connect } from "@/app/api/social/[network]/connect/route";
import { GET as uploadPostCallback } from "@/app/api/social/[network]/uploadpost/route";
import { openState, openPending, sealState, STATE_COOKIE } from "@/lib/social/oauth";
import { clearSwitchCache } from "@/lib/admin/switch";

const USER = "11111111-1111-1111-1111-111111111111";
const SITE = "http://127.0.0.1:3000";
const params = (network: string) => ({ params: Promise.resolve({ network }) });
const location = (r: Response) => new URL(r.headers.get("location")!);
const cookieValue = (r: Response, name: string) => decodeURIComponent(new RegExp(`${name}=([^;]*)`).exec(r.headers.get("set-cookie") ?? "")?.[1] ?? "") || undefined;

beforeEach(() => {
  vi.resetAllMocks();
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  process.env.UPLOAD_POST_API_KEY = "up_test_key_123";
  process.env.COMPOSIO_API_KEY = "ak_test_key";
  mocks.requireActiveUser.mockResolvedValue({ id: USER });
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.prisma.business.findUnique.mockResolvedValue({ id: "biz1", name: "Inzozi Bakery" });
  mocks.prisma.serviceSwitch.findMany.mockResolvedValue([]);
  mocks.forgetUnusedUploadPost.mockResolvedValue(undefined);
  clearSwitchCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.UPLOAD_POST_API_KEY;
  delete process.env.COMPOSIO_API_KEY;
});

describe("connecting LinkedIn through Upload-Post", () => {
  it("makes the business's profile and sends the person to Upload-Post's page with a sealed cookie", async () => {
    const fetch = mockFetch(jsonResponse({ success: true }, { status: 201 }), jsonResponse({ success: true, access_url: "https://app.upload-post.com/connect?token=jwt" }));
    const response = await connect(new Request(`${SITE}/api/social/linkedin/connect?next=/dashboard/connections`), params("linkedin"));
    expect(location(response).href).toBe("https://app.upload-post.com/connect?token=jwt");
    expect(JSON.parse(callAt(fetch, 0).body!).username).toBe("bupulse_biz1");
    const redirect = new URL(JSON.parse(callAt(fetch, 1).body!).redirect_url);
    expect(redirect.origin + redirect.pathname).toBe(`${SITE}/api/social/linkedin/uploadpost`);
    const opened = await openState(cookieValue(response, STATE_COOKIE), USER, "linkedin");
    expect(opened.ok && opened.data.uploadPostProfile).toBe("bupulse_biz1");
    expect(opened.ok && opened.data.state).toBe(redirect.searchParams.get("state"));
  });

  it("says 'paused on our side' when BuPulse's Upload-Post plan has no room for another profile", async () => {
    mockFetch(jsonResponse({ success: false, error_code: "PROFILE_LIMIT_REACHED" }, { status: 403 }), jsonResponse({ success: false }, { status: 404 }));
    const response = await connect(new Request(`${SITE}/api/social/linkedin/connect`), params("linkedin"));
    expect(location(response).searchParams.get("error")).toBe("full");
  });

  it("leaves Upload-Post alone when it is switched off (the BuPulse-Socials path runs instead)", async () => {
    mocks.prisma.serviceSwitch.findMany.mockResolvedValue([{ service: "uploadpost" }]);
    clearSwitchCache();
    const fetch = vi.fn<(url: string) => Promise<Response>>(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetch);
    const response = await connect(new Request(`${SITE}/api/social/linkedin/connect`), params("linkedin"));
    expect(fetch.mock.calls.some(([url]) => String(url).includes("upload-post.com"))).toBe(false);
    expect(location(response).hostname).not.toBe("app.upload-post.com");
  });
});

describe("coming back from Upload-Post", () => {
  async function back(query: string, state: { state: string; uploadPostProfile?: string; userId?: string }) {
    const sealed = await sealState({ state: state.state, verifier: "", userId: state.userId ?? USER, network: "linkedin", next: "/dashboard/connections", uploadPostProfile: state.uploadPostProfile ?? "bupulse_biz1" });
    return uploadPostCallback(new Request(`${SITE}/api/social/linkedin/uploadpost${query}`, { headers: { cookie: `${STATE_COOKIE}=${encodeURIComponent(sealed)}` } }), params("linkedin"));
  }

  it("offers the Pages and the profile in the picker", async () => {
    mockFetch(
      jsonResponse({ success: true, profile: { username: "bupulse_biz1", social_accounts: { linkedin: { username: "abc", display_name: "Aline" } } } }),
      jsonResponse({ success: true, pages: [{ id: "urn:li:organization:42", name: "Inzozi Bakery", picture: "https://media.licdn.com/l.png" }] }),
    );
    const response = await back("?state=s", { state: "s" });
    expect(location(response).searchParams.get("pick")).toBe("linkedin");
    const pending = await openPending((name) => cookieValue(response, name), USER);
    expect(pending?.result.scopes).toEqual(["uploadpost", "uploadpost_profile:bupulse_biz1"]);
    expect(pending?.result.accounts.map((a) => [a.externalAccountId, a.accountType])).toEqual([["abc", "member"], ["42", "organization"]]);
    expect(mocks.saveConnections).not.toHaveBeenCalled();
  });

  it("treats coming back without connecting LinkedIn as cancelled", async () => {
    mockFetch(jsonResponse({ success: true, profile: { username: "bupulse_biz1", social_accounts: {} } }));
    expect(location(await back("?state=s", { state: "s" })).searchParams.get("error")).toBe("denied");
  });

  it("rejects another state or another business's profile, calling nothing", async () => {
    const fetch = mockFetch();
    expect(location(await back("?state=other", { state: "s" })).searchParams.get("error")).toBe("state");
    expect(location(await back("?state=s", { state: "s", uploadPostProfile: "bupulse_biz2" })).searchParams.get("error")).toBe("state");
    expect(location(await back("?state=s", { state: "s", userId: "someone-else" })).searchParams.get("error")).toBe("state");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails cleanly when Upload-Post cannot be read, unlinking the unused sign-in", async () => {
    mockFetch(jsonResponse({ success: false, error: "boom" }, { status: 500 }));
    expect(location(await back("?state=s", { state: "s" })).searchParams.get("error")).toBe("failed");
    expect(mocks.forgetUnusedUploadPost).toHaveBeenCalledWith("linkedin", "bupulse_biz1");
  });

  it("is only for LinkedIn", async () => {
    const response = await uploadPostCallback(new Request(`${SITE}/api/social/facebook/uploadpost?state=s`), params("facebook"));
    expect(response.status).toBe(404);
  });
});

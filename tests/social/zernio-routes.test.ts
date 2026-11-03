import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAt, jsonResponse, mockFetch } from "./helpers";
// Plans are not part of this test's database: every plan feature is granted (tests/stubs/entitlements.ts).
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(),
  rateLimit: vi.fn(),
  saveConnections: vi.fn(),
  forgetUnusedZernio: vi.fn(),
  forgetUnusedUploadPost: vi.fn(),
  prisma: { business: { findUnique: vi.fn() }, serviceSwitch: { findMany: vi.fn() } },
}));

vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/rate-limit")>()), rateLimit: mocks.rateLimit }));
vi.mock("@/lib/social/connections", () => ({ saveConnections: mocks.saveConnections, forgetUnusedZernio: mocks.forgetUnusedZernio, forgetUnusedUploadPost: mocks.forgetUnusedUploadPost }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => { throw new Error("not on cloudflare"); } }));

import { GET as connect } from "@/app/api/social/[network]/connect/route";
import { GET as zernioCallback } from "@/app/api/social/[network]/zernio/route";
import { openState, sealState, STATE_COOKIE } from "@/lib/social/oauth";
import { clearSwitchCache } from "@/lib/admin/switch";

// Zernio's answers here follow docs.zernio.com (read 3 November 2026), not a live Zernio account.
const USER = "11111111-1111-1111-1111-111111111111";
const SITE = "http://127.0.0.1:3000";
const PROFILE = "66a1f0c2a4b9d3e8f1a2b3c4";
const ACCOUNT = "66b2e19d8c3f5a7e9d0b1c2d";
const params = (network: string) => ({ params: Promise.resolve({ network }) });
const location = (r: Response) => new URL(r.headers.get("location")!);
const cookieValue = (r: Response, name: string) => decodeURIComponent(new RegExp(`${name}=([^;]*)`).exec(r.headers.get("set-cookie") ?? "")?.[1] ?? "") || undefined;

beforeEach(() => {
  vi.resetAllMocks();
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  process.env.ZERNIO_API_KEY = "sk_test_zernio_123";
  process.env.UPLOAD_POST_API_KEY = "up_test_key_123";
  process.env.UPLOAD_POST_TIKTOK = "true";
  mocks.requireActiveUser.mockResolvedValue({ id: USER });
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.prisma.business.findUnique.mockResolvedValue({ id: "biz1", name: "Inzozi Bakery" });
  mocks.prisma.serviceSwitch.findMany.mockResolvedValue([]);
  mocks.forgetUnusedZernio.mockResolvedValue(undefined);
  clearSwitchCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ZERNIO_API_KEY;
  delete process.env.UPLOAD_POST_API_KEY;
  delete process.env.UPLOAD_POST_TIKTOK;
});

describe("connecting TikTok through Zernio", () => {
  it("finds the business's profile and sends the person to Zernio's link with a sealed cookie, ahead of Upload-Post", async () => {
    const fetch = mockFetch(jsonResponse({ profiles: [{ _id: PROFILE }] }), jsonResponse({ authUrl: "https://zernio.com/connect/welcome?ticket=t" }));
    const response = await connect(new Request(`${SITE}/api/social/tiktok/connect?next=/dashboard/connections`), params("tiktok"));
    expect(location(response).href).toBe("https://zernio.com/connect/welcome?ticket=t");
    expect(fetch.mock.calls.every(([url]) => String(url).startsWith("https://zernio.com/api/v1/"))).toBe(true);
    const asked = new URL(callAt(fetch, 1).url);
    const redirect = new URL(asked.searchParams.get("redirect_url")!);
    expect(redirect.origin + redirect.pathname).toBe(`${SITE}/api/social/tiktok/zernio`);
    const opened = await openState(cookieValue(response, STATE_COOKIE), USER, "tiktok");
    expect(opened.ok && opened.data.zernioProfile).toBe(PROFILE);
    expect(opened.ok && opened.data.state).toBe(redirect.searchParams.get("state"));
  });

  it("says 'paused on our side' when BuPulse's Zernio account is past its free accounts", async () => {
    mockFetch(jsonResponse({ profiles: [{ _id: PROFILE }] }), jsonResponse({ error: "Add a payment method", code: "PAYMENT_REQUIRED", reason: "free_tier_exceeded" }, { status: 402 }));
    const response = await connect(new Request(`${SITE}/api/social/tiktok/connect`), params("tiktok"));
    expect(location(response).searchParams.get("error")).toBe("full");
  });

  it("leaves Zernio alone when it is switched off (Upload-Post runs instead)", async () => {
    mocks.prisma.serviceSwitch.findMany.mockResolvedValue([{ service: "zernio" }]);
    clearSwitchCache();
    const fetch = vi.fn<(url: string) => Promise<Response>>(async () => jsonResponse({ success: true, access_url: "https://app.upload-post.com/connect?token=jwt" }));
    vi.stubGlobal("fetch", fetch);
    const response = await connect(new Request(`${SITE}/api/social/tiktok/connect`), params("tiktok"));
    expect(fetch.mock.calls.some(([url]) => String(url).includes("zernio.com"))).toBe(false);
    expect(location(response).hostname).toBe("app.upload-post.com");
  });

  it("leaves LinkedIn to Upload-Post", async () => {
    const fetch = vi.fn<(url: string) => Promise<Response>>(async () => jsonResponse({ success: true, access_url: "https://app.upload-post.com/connect?token=jwt" }));
    vi.stubGlobal("fetch", fetch);
    await connect(new Request(`${SITE}/api/social/linkedin/connect`), params("linkedin"));
    expect(fetch.mock.calls.some(([url]) => String(url).includes("zernio.com"))).toBe(false);
  });
});

describe("coming back from Zernio", () => {
  async function back(query: string, state: { state?: string; zernioProfile?: string; userId?: string } = {}) {
    const sealed = await sealState({ state: state.state ?? "s", verifier: "", userId: state.userId ?? USER, network: "tiktok", next: "/dashboard/connections", zernioProfile: state.zernioProfile ?? PROFILE });
    return zernioCallback(new Request(`${SITE}/api/social/tiktok/zernio${query}`, { headers: { cookie: `${STATE_COOKIE}=${encodeURIComponent(sealed)}` } }), params("tiktok"));
  }
  const ok = `?state=s&connected=tiktok&profileId=${PROFILE}&accountId=${ACCOUNT}&username=inzozi.bakery`;
  const listed = (over: Record<string, unknown> = {}) =>
    jsonResponse({ accounts: [{ _id: ACCOUNT, platform: "tiktok", profileId: PROFILE, username: "inzozi.bakery", displayName: "Inzozi", profilePicture: "https://p16.tiktokcdn.com/a.jpg", isActive: true, ...over }], hasAnalyticsAccess: false });

  it("saves the one TikTok account straight away, marked as Zernio's", async () => {
    const fetch = mockFetch(listed());
    const response = await back(ok);
    expect(location(response).searchParams.get("connected")).toBe("tiktok");
    expect(callAt(fetch, 0).url).toBe(`https://zernio.com/api/v1/accounts?profileId=${PROFILE}&platform=tiktok`);
    expect(mocks.saveConnections).toHaveBeenCalledWith(
      "biz1",
      "tiktok",
      expect.objectContaining({ accessToken: PROFILE, scopes: ["zernio", `zernio_profile:${PROFILE}`], accounts: [expect.objectContaining({ externalAccountId: ACCOUNT, displayName: "@inzozi.bakery", avatarUrl: "https://p16.tiktokcdn.com/a.jpg" })] }),
      [ACCOUNT],
      "AUTO",
    );
    expect(mocks.forgetUnusedZernio).not.toHaveBeenCalled();
  });

  it("rejects another state, another profile or another user, calling nothing", async () => {
    const fetch = mockFetch();
    expect(location(await back(ok.replace("state=s", "state=other"))).searchParams.get("error")).toBe("state");
    expect(location(await back(ok, { zernioProfile: "another-profile" })).searchParams.get("error")).toBe("state");
    expect(location(await back(ok, { userId: "someone-else" })).searchParams.get("error")).toBe("state");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never saves an account that is not in the business's profile, nor disconnects it", async () => {
    mockFetch(listed({ _id: "someone-elses-account" }));
    expect(location(await back(ok)).searchParams.get("error")).toBe("failed");
    expect(mocks.saveConnections).not.toHaveBeenCalled();
    expect(mocks.forgetUnusedZernio).not.toHaveBeenCalled();
  });

  it("treats TikTok's refusal as refused, a missing permission as cancelled, and a billing gate as 'paused on our side'", async () => {
    const fetch = mockFetch();
    expect(location(await back("?state=s&error=oauth_denied&platform=tiktok")).searchParams.get("error")).toBe("refused");
    expect(location(await back("?state=s&error=missing_tiktok_permissions&platform=tiktok")).searchParams.get("error")).toBe("denied");
    expect(location(await back("?state=s&error=payment_required&platform=tiktok")).searchParams.get("error")).toBe("full");
    expect(location(await back("?state=s&error=something_new&platform=tiktok")).searchParams.get("error")).toBe("failed");
    expect(location(await back("?state=s")).searchParams.get("error")).toBe("denied");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("disconnects the account from Zernio again when TikTok was switched off meanwhile", async () => {
    mocks.prisma.serviceSwitch.findMany.mockResolvedValue([{ service: "zernio" }]);
    clearSwitchCache();
    mockFetch(listed());
    expect(location(await back(ok)).searchParams.get("error")).toBe("unavailable");
    expect(mocks.forgetUnusedZernio).toHaveBeenCalledWith("tiktok", ACCOUNT);
    expect(mocks.saveConnections).not.toHaveBeenCalled();
  });

  it("fails cleanly when saving fails, disconnecting the unused account", async () => {
    mockFetch(listed());
    mocks.saveConnections.mockRejectedValue(new Error("db down"));
    expect(location(await back(ok)).searchParams.get("error")).toBe("failed");
    expect(mocks.forgetUnusedZernio).toHaveBeenCalledWith("tiktok", ACCOUNT);
  });

  it("is only for the networks Zernio connects", async () => {
    const response = await zernioCallback(new Request(`${SITE}/api/social/linkedin/zernio?state=s`), params("linkedin"));
    expect(response.status).toBe(404);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(),
  rateLimit: vi.fn(),
  saveConnections: vi.fn(),
  prisma: { business: { findUnique: vi.fn() }, serviceSwitch: { findMany: vi.fn() } },
}));

vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/rate-limit")>()), rateLimit: mocks.rateLimit }));
vi.mock("@/lib/social/connections", () => ({ saveConnections: mocks.saveConnections }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => { throw new Error("not on cloudflare"); } }));

import { GET as connect } from "@/app/api/social/[network]/connect/route";
import { GET as callback } from "@/app/api/social/[network]/callback/route";
import { sealState, STATE_COOKIE } from "@/lib/social/oauth";
import { CONNECT_ERRORS } from "@/lib/social/connect-errors";
import { RateLimitError } from "@/lib/rate-limit";
import { clearSwitchCache } from "@/lib/admin/switch";

const USER = "11111111-1111-1111-1111-111111111111";
const SITE = "http://127.0.0.1:3000";
const params = (network: string) => ({ params: Promise.resolve({ network }) });
const location = (r: Response) => new URL(r.headers.get("location")!);

beforeEach(() => {
  vi.resetAllMocks();
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  process.env.INSTAGRAM_APP_ID = "ig-id";
  process.env.INSTAGRAM_APP_SECRET = "ig-secret";
  process.env.FACEBOOK_APP_ID = "fb-id";
  process.env.FACEBOOK_APP_SECRET = "fb-secret";
  mocks.requireActiveUser.mockResolvedValue({ id: USER });
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.prisma.business.findUnique.mockResolvedValue({ id: "biz1" });
  mocks.prisma.serviceSwitch.findMany.mockResolvedValue([]);
  clearSwitchCache();
});
afterEach(() => vi.unstubAllGlobals());

async function cb(query: string, pending?: { state: string; next?: string; userId?: string; network?: "instagram" | "facebook"; variant?: string; now?: number }) {
  const headers: Record<string, string> = {};
  if (pending) {
    const sealed = await sealState({ state: pending.state, verifier: "v".repeat(43), userId: pending.userId ?? USER, network: pending.network ?? "instagram", variant: pending.variant ?? "instagram", next: pending.next ?? "/dashboard/connections" }, pending.now);
    headers.cookie = `${STATE_COOKIE}=${encodeURIComponent(sealed)}`;
  }
  const network = pending?.network ?? "instagram";
  return callback(new Request(`${SITE}/api/social/${network}/callback${query}`, { headers }), params(network));
}

describe("connect", () => {
  it("redirects to Instagram login with the scopes and a sealed httpOnly cookie", async () => {
    const response = await connect(new Request(`${SITE}/api/social/instagram/connect?next=/dashboard/connections`), params("instagram"));
    const url = location(response);
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights");
    expect(url.searchParams.get("redirect_uri")).toBe(`${SITE}/api/social/instagram/callback`);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain(`${STATE_COOKIE}=`);
    expect(cookie.toLowerCase()).toContain("httponly");
  });

  it("uses Facebook login for the facebook variant", async () => {
    const url = location(await connect(new Request(`${SITE}/api/social/instagram/connect?variant=facebook`), params("instagram")));
    expect(url.hostname).toBe("www.facebook.com");
    expect(url.searchParams.get("client_id")).toBe("fb-id");
    expect(url.searchParams.get("scope")).toContain("instagram_content_publish");
  });

  it("answers 404 for unknown networks and friendly redirects for unavailable ones", async () => {
    expect((await connect(new Request(`${SITE}/api/social/myspace/connect`), params("myspace"))).status).toBe(404);
    expect(location(await connect(new Request(`${SITE}/api/social/instagram/connect?variant=bogus`), params("instagram"))).searchParams.get("error")).toBe("unavailable");
    delete process.env.INSTAGRAM_APP_ID;
    expect(location(await connect(new Request(`${SITE}/api/social/instagram/connect`), params("instagram"))).searchParams.get("error")).toBe("unavailable");
  });

  it("never redirects to an off-site next", async () => {
    const response = await connect(new Request(`${SITE}/api/social/instagram/connect?next=//evil.com`), params("instagram"));
    expect(location(response).hostname).toBe("www.instagram.com");
  });

  it("is rate limited", async () => {
    mocks.rateLimit.mockRejectedValue(new RateLimitError(60));
    expect(location(await connect(new Request(`${SITE}/api/social/instagram/connect`), params("instagram"))).searchParams.get("error")).toBe("rate_limit");
  });
});

describe("callback error paths", () => {
  it("sends users back with state when the cookie is missing or the state differs", async () => {
    expect(location(await cb("?code=c&state=x")).searchParams.get("error")).toBe("state");
    expect(location(await cb("?code=c&state=wrong", { state: "right" })).searchParams.get("error")).toBe("state");
  });

  it("rejects a state cookie that belongs to another user", async () => {
    expect(location(await cb("?code=c&state=s", { state: "s", userId: "someone-else" })).searchParams.get("error")).toBe("state");
  });

  it("reports an expired state", async () => {
    expect(location(await cb("?code=c&state=s", { state: "s", now: Date.now() - 11 * 60_000 })).searchParams.get("error")).toBe("expired");
  });

  it("treats access_denied as denied and other errors as failed", async () => {
    expect(location(await cb("?error=access_denied&state=s", { state: "s" })).searchParams.get("error")).toBe("denied");
    expect(location(await cb("?error=server_error&state=s", { state: "s" })).searchParams.get("error")).toBe("failed");
  });

  it("fails without a code and when the token exchange fails, never saving", async () => {
    expect(location(await cb("?state=s", { state: "s" })).searchParams.get("error")).toBe("failed");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad code", code: 100 } }), { status: 400 })));
    expect(location(await cb("?code=c&state=s", { state: "s" })).searchParams.get("error")).toBe("failed");
    expect(mocks.saveConnections).not.toHaveBeenCalled();
  });

  it("shows 'unavailable' and exchanges nothing when the network was switched off in the admin console meanwhile", async () => {
    mocks.prisma.serviceSwitch.findMany.mockResolvedValue([{ service: "meta" }]);
    clearSwitchCache();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await cb("?code=c&state=s", { state: "s" });
    expect(location(response).searchParams.get("error")).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.saveConnections).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain(`${STATE_COOKIE}=;`);
  });

  it("clears the state cookie on every exit", async () => {
    const response = await cb("?error=access_denied&state=s", { state: "s" });
    expect(response.headers.get("set-cookie")).toContain(`${STATE_COOKIE}=;`);
  });
});

describe("Instagram through Facebook", () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const fb = (accounts: unknown[]) => vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes("fb_exchange_token")) return json({ access_token: "long" });
    if (url.includes("/oauth/access_token")) return json({ access_token: "short" });
    if (url.includes("/me/accounts")) return json({ data: accounts });
    return json({ id: "fbuser" });
  }));

  it("works with only the Facebook keys and requests the five permissions", async () => {
    delete process.env.INSTAGRAM_APP_ID;
    const url = location(await connect(new Request(`${SITE}/api/social/instagram/connect?variant=facebook`), params("instagram")));
    expect(url.hostname).toBe("www.facebook.com");
    expect(url.searchParams.get("scope")!.split(",").sort()).toEqual(["instagram_basic", "instagram_content_publish", "instagram_manage_insights", "pages_read_engagement", "pages_show_list"]);
  });

  it("lists only Instagram accounts linked to the user's Pages and saves a single one directly", async () => {
    fb([{ id: "p1", name: "No IG", access_token: "t1" }, { id: "p2", name: "Shop", access_token: "t2", instagram_business_account: { id: "ig9", username: "shop" } }]);
    mocks.saveConnections.mockResolvedValue(["c1"]);
    const response = await cb("?code=abc&state=s", { state: "s", variant: "facebook" });
    expect(location(response).searchParams.get("connected")).toBe("instagram");
    const [, , oauth, ids] = mocks.saveConnections.mock.calls[0];
    expect(oauth.accounts.map((a: { externalAccountId: string }) => a.externalAccountId)).toEqual(["ig9"]);
    expect(oauth.accountTokens.ig9.accessToken).toBe("t2");
    expect(ids).toEqual(["ig9"]);
  });

  it("tells the user how to fix it when no Page has an Instagram account", async () => {
    fb([{ id: "p1", name: "No IG", access_token: "t1" }]);
    const response = await cb("?code=abc&state=s", { state: "s", variant: "facebook" });
    expect(location(response).searchParams.get("error")).toBe("no_accounts");
    expect(CONNECT_ERRORS.no_accounts).toContain("linked to a Facebook Page");
    expect(mocks.saveConnections).not.toHaveBeenCalled();
  });
});

describe("callback success", () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("exchanges the code for a long-lived token and saves the single Instagram account", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://api.instagram.com/oauth/access_token")) return json({ access_token: "short", user_id: 99, permissions: "instagram_business_basic,instagram_business_content_publish" });
      if (url.startsWith("https://graph.instagram.com/access_token")) return json({ access_token: "IGlong", expires_in: 5_184_000 });
      return json({ user_id: "17841", username: "shop", account_type: "BUSINESS", profile_picture_url: "https://x/y.jpg" });
    }));
    mocks.saveConnections.mockResolvedValue(["c1"]);
    const response = await cb("?code=abc&state=s", { state: "s" });
    expect(location(response).searchParams.get("connected")).toBe("instagram");
    const [businessId, network, oauth, ids, mode] = mocks.saveConnections.mock.calls[0];
    expect(businessId).toBe("biz1");
    expect(network).toBe("instagram");
    expect(oauth.accessToken).toBe("IGlong");
    expect(oauth.accounts).toEqual([{ externalAccountId: "17841", displayName: "@shop", avatarUrl: "https://x/y.jpg", accountType: "business" }]);
    expect(oauth.scopes).toContain("meta_uid:99");
    expect(ids).toEqual(["17841"]);
    expect(mode).toBe("AUTO");
    expect(calls.some((u) => u.includes("grant_type=ig_exchange_token"))).toBe(true);
  });

  it("holds several Facebook Pages in the encrypted cookie for the account picker", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("fb_exchange_token")) return json({ access_token: "long" });
      if (url.includes("/oauth/access_token")) return json({ access_token: "short" });
      if (url.includes("/me/accounts")) return json({ data: [{ id: "p1", name: "One", access_token: "pt1" }, { id: "p2", name: "Two", access_token: "pt2" }] });
      return json({ id: "fbuser" });
    }));
    const response = await cb("?code=abc&state=s", { state: "s", network: "facebook", variant: "" });
    expect(location(response).searchParams.get("pick")).toBe("facebook");
    expect(response.headers.get("set-cookie")).toContain("bp_social_pending_0=");
    expect(mocks.saveConnections).not.toHaveBeenCalled();
  });
});

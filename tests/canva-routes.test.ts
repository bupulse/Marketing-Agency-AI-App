import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkActiveUser: vi.fn(),
  requireActiveUser: vi.fn(),
  openDesignInCanva: vi.fn(),
  startCanvaReturn: vi.fn(),
  finishCanvaReturn: vi.fn(),
  saveTokens: vi.fn(),
}));

vi.mock("@/lib/auth/require-user", () => ({ checkActiveUser: mocks.checkActiveUser, requireActiveUser: mocks.requireActiveUser, requirePersonalUser: mocks.requireActiveUser }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/canva/tokens", () => ({ saveTokens: mocks.saveTokens }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => { throw new Error("not on cloudflare"); } }));
vi.mock("@/lib/canva/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/canva/service")>()),
  openDesignInCanva: mocks.openDesignInCanva,
  startCanvaReturn: mocks.startCanvaReturn,
  finishCanvaReturn: mocks.finishCanvaReturn,
}));

import { GET as connect } from "@/app/api/canva/connect/route";
import { GET as callback } from "@/app/api/canva/callback/route";
import { POST as open } from "@/app/api/canva/open/route";
import { GET as canvaReturn } from "@/app/api/canva/return/route";
import { OAUTH_COOKIE, sealOAuthState } from "@/lib/canva/pkce";
import { CanvaError } from "@/lib/canva/service";

const USER = "11111111-1111-1111-1111-111111111111";
const SITE = "http://127.0.0.1:3000";

beforeEach(() => {
  vi.resetAllMocks();
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.CANVA_CLIENT_ID = "OC-client";
  process.env.CANVA_CLIENT_SECRET = "secret";
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  delete process.env.CANVA_REDIRECT_URI;
  mocks.requireActiveUser.mockResolvedValue({ id: USER, actorId: USER });
  mocks.checkActiveUser.mockResolvedValue({ status: "ok", user: { id: USER, actorId: USER } });
});
afterEach(() => vi.unstubAllGlobals());

const location = (r: Response) => new URL(r.headers.get("location")!);

async function callbackRequest(query: string, pending?: { state: string; next: string; userId?: string }) {
  const headers: Record<string, string> = {};
  if (pending) {
    const sealed = await sealOAuthState({ state: pending.state, verifier: "v".repeat(43), userId: pending.userId ?? USER, next: pending.next });
    headers.cookie = `${OAUTH_COOKIE}=${encodeURIComponent(sealed)}`;
  }
  return callback(new Request(`${SITE}/api/canva/callback${query}`, { headers }));
}

describe("connect", () => {
  it("redirects to Canva with an S256 challenge and sets a sealed httpOnly cookie", async () => {
    const response = await connect(new Request(`${SITE}/api/canva/connect?next=/dashboard/settings`));
    const url = location(response);
    expect(url.origin + url.pathname).toBe("https://www.canva.com/api/oauth/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("asset:write design:content:write design:content:read design:meta:read");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain(`${OAUTH_COOKIE}=`);
    expect(cookie.toLowerCase()).toContain("httponly");
  });

  it("is hidden when Canva is not configured", async () => {
    delete process.env.CANVA_CLIENT_ID;
    expect((await connect(new Request(`${SITE}/api/canva/connect`))).status).toBe(404);
  });
});

describe("callback", () => {
  it("rejects a state that does not match and stores nothing", async () => {
    const response = await callbackRequest("?code=c&state=wrong", { state: "right", next: "/dashboard/designs" });
    expect(location(response).searchParams.get("canva")).toBe("error");
    expect(mocks.saveTokens).not.toHaveBeenCalled();
  });

  it("rejects a callback with no pending login", async () => {
    expect(location(await callbackRequest("?code=c&state=s")).searchParams.get("canva")).toBe("error");
  });

  it("rejects a pending login that belongs to another user", async () => {
    const response = await callbackRequest("?code=c&state=s", { state: "s", next: "/dashboard/designs", userId: "someone-else" });
    expect(location(response).searchParams.get("canva")).toBe("error");
  });

  it("reports access_denied as denied", async () => {
    const response = await callbackRequest("?error=access_denied&state=s", { state: "s", next: "/dashboard/connections" });
    const url = location(response);
    expect(url.pathname).toBe("/dashboard/connections");
    expect(url.searchParams.get("canva")).toBe("denied");
    expect(mocks.saveTokens).not.toHaveBeenCalled();
  });

  it("stores tokens and returns to a safe next", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.endsWith("/oauth/token")
        ? new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 100 }))
        : new Response(JSON.stringify({ team_user: { user_id: "cu1" } })),
    ));
    const response = await callbackRequest("?code=c&state=s", { state: "s", next: "/dashboard/connections" });
    const url = location(response);
    expect(url.pathname).toBe("/dashboard/connections");
    expect(url.searchParams.get("canva")).toBe("connected");
    expect(mocks.saveTokens).toHaveBeenCalledWith(USER, expect.objectContaining({ accessToken: "a", refreshToken: "r" }), "cu1");
  });

  it("never redirects to another site", async () => {
    const response = await callbackRequest("?error=access_denied&state=s", { state: "s", next: "//evil.example/x" });
    expect(location(response).origin).toBe(SITE);
    expect(location(response).pathname).toBe("/dashboard/designs");
  });
});

describe("open", () => {
  const post = (body: unknown) => open(new Request(`${SITE}/api/canva/open`, { method: "POST", body: JSON.stringify(body) }));

  it("answers 403 for an account scheduled for deletion", async () => {
    mocks.checkActiveUser.mockResolvedValue({ status: "locked" });
    expect((await post({ designId: "d1" })).status).toBe(403);
    expect(mocks.openDesignInCanva).not.toHaveBeenCalled();
  });

  it("answers 401 when signed out", async () => {
    mocks.checkActiveUser.mockResolvedValue({ status: "signed_out" });
    expect((await post({ designId: "d1" })).status).toBe(401);
  });

  it("maps not-connected to 409 and a foreign design to 404", async () => {
    mocks.openDesignInCanva.mockRejectedValueOnce(new CanvaError("x", "not_connected")).mockRejectedValueOnce(new CanvaError("y", "not_found"));
    expect((await post({ designId: "d1" })).status).toBe(409);
    expect((await post({ designId: "foreign" })).status).toBe(404);
    expect(mocks.openDesignInCanva).toHaveBeenCalledWith(USER, "foreign", USER);
  });
});

describe("return", () => {
  const get = () => canvaReturn(new Request(`${SITE}/api/canva/return?correlation_jwt=a.b.c`));

  it("sends a locked account to the deletion page without doing any work", async () => {
    mocks.checkActiveUser.mockResolvedValue({ status: "locked" });
    expect(location(await get()).pathname).toBe("/account/deletion");
    expect(mocks.startCanvaReturn).not.toHaveBeenCalled();
  });

  it("sends a signed-out user to login and back to the return URL", async () => {
    mocks.checkActiveUser.mockResolvedValue({ status: "signed_out" });
    const url = location(await get());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/api/canva/return?correlation_jwt=a.b.c");
  });

  it("redirects to the designs page with the new design on success", async () => {
    mocks.startCanvaReturn.mockResolvedValue({});
    mocks.finishCanvaReturn.mockResolvedValue({ designId: "new1" });
    const url = location(await get());
    expect(url.pathname).toBe("/dashboard/designs");
    expect(url.searchParams.get("canva")).toBe("saved");
    expect(url.searchParams.get("design")).toBe("new1");
  });

  it("answers 'processing' when another return is already saving", async () => {
    mocks.startCanvaReturn.mockRejectedValue(new CanvaError("busy", "processing"));
    expect(location(await get()).searchParams.get("canva")).toBe("processing");
  });

  it("answers 'processing' after 30 s and lets the save finish in the background", async () => {
    vi.useFakeTimers();
    try {
      let finish!: (v: { designId: string }) => void;
      mocks.startCanvaReturn.mockResolvedValue({});
      mocks.finishCanvaReturn.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      const pending = get();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(location(await pending).searchParams.get("canva")).toBe("processing");
      finish({ designId: "late" });
    } finally {
      vi.useRealTimers();
    }
  });
});

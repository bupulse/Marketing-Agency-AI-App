import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    canvaConnection: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
    canvaEdit: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
    design: { findFirst: vi.fn(), create: vi.fn() },
  },
  rateLimit: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  download: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: mocks.rateLimit,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove, download: mocks.download }) } }),
}));

import { decrypt, encrypt } from "@/lib/crypto";
import { codeChallenge, newCodeVerifier, openOAuthState, sealOAuthState, sameString, base64Url } from "@/lib/canva/pkce";
import { pollJob, CanvaTimeoutError } from "@/lib/canva/jobs";
import { getAccessToken, disconnectCanva, CanvaReconnectError, CanvaNotConnectedError } from "@/lib/canva/tokens";
import { canvaSize, CanvaApiError, isCanvaDownloadUrl } from "@/lib/canva/client";
import { resetKeyCache } from "@/lib/canva/return-jwt";
import { completeCanvaReturn, openDesignInCanva, CanvaError } from "@/lib/canva/service";
import { RateLimitError } from "@/lib/rate-limit";

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.resetAllMocks();
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.CANVA_CLIENT_ID = "OC-client";
  process.env.CANVA_CLIENT_SECRET = "secret";
});
afterEach(() => vi.unstubAllGlobals());

describe("PKCE and signed state", () => {
  it("matches the RFC 7636 S256 example", async () => {
    expect(await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("makes verifiers of 43+ URL-safe characters", () => {
    const v = newCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(newCodeVerifier()).not.toBe(v);
  });

  it("round-trips sealed state for the same user only", async () => {
    const sealed = await sealOAuthState({ state: "s", verifier: "v", userId: USER, next: "/dashboard/designs" });
    expect(sealed).not.toContain("verifier");
    expect(await openOAuthState(sealed, USER)).toMatchObject({ state: "s", verifier: "v" });
    expect(await openOAuthState(sealed, OTHER)).toBeNull();
  });

  it("rejects tampered, expired and missing state", async () => {
    const now = Date.now();
    const sealed = await sealOAuthState({ state: "s", verifier: "v", userId: USER, next: "/" }, now);
    expect(await openOAuthState(sealed.slice(0, -4) + "AAAA", USER)).toBeNull();
    expect(await openOAuthState(sealed, USER, now + 11 * 60 * 1000)).toBeNull();
    expect(await openOAuthState(undefined, USER)).toBeNull();
  });

  it("compares state strings exactly", () => {
    expect(sameString("abc", "abc")).toBe(true);
    expect(sameString("abc", "abd")).toBe(false);
    expect(sameString("abc", "abcd")).toBe(false);
  });
});

describe("token encryption", () => {
  it("round-trips and does not store plaintext", async () => {
    const sealed = await encrypt("access-token-123");
    expect(sealed).not.toContain("access-token-123");
    expect(await decrypt(sealed)).toBe("access-token-123");
  });
});

describe("pollJob", () => {
  it("waits with growing delays until done", async () => {
    const delays: number[] = [];
    let calls = 0;
    const value = await pollJob(async () => (++calls < 4 ? { done: false } : { done: true, value: "ok" }), {
      maxMs: 60_000,
      sleep: async (ms) => void delays.push(ms),
    });
    expect(value).toBe("ok");
    expect(delays).toEqual([500, 750, 1125]);
  });

  it("gives up after the total time cap", async () => {
    let t = 0;
    await expect(
      pollJob(async () => ({ done: false }), { maxMs: 5000, now: () => t, sleep: async (ms) => void (t += ms) }),
    ).rejects.toBeInstanceOf(CanvaTimeoutError);
    expect(t).toBeLessThanOrEqual(5000);
  });
});

describe("download address", () => {
  it("accepts only https on a canva.com host", () => {
    expect(isCanvaDownloadUrl("https://export-download.canva.com/a.png")).toBe(true);
    expect(isCanvaDownloadUrl("http://export-download.canva.com/a.png")).toBe(false);
    expect(isCanvaDownloadUrl("https://evil.com/a.png")).toBe(false);
    expect(isCanvaDownloadUrl("https://canva.com.evil.com/a.png")).toBe(false);
    expect(isCanvaDownloadUrl("not a url")).toBe(false);
  });
});

describe("openDesignInCanva", () => {
  it("never touches a design that is not the user's", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.prisma.design.findFirst.mockResolvedValue(null);
    await expect(openDesignInCanva(USER, "foreign")).rejects.toMatchObject({ code: "not_found" });
    expect(mocks.prisma.design.findFirst).toHaveBeenCalledWith({ where: { id: "foreign", business: { userId: USER } } });
    expect(mocks.download).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops with a friendly message when rate limited", async () => {
    mocks.prisma.design.findFirst.mockResolvedValue({ id: "d1", path: `${USER}/designs/d1.png`, width: 10, height: 10 });
    mocks.rateLimit.mockRejectedValue(new RateLimitError(600));
    await expect(openDesignInCanva(USER, "d1")).rejects.toMatchObject({ code: "timeout", message: expect.stringContaining("10 minutes") });
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("uploads once, creates the design and tags the edit URL with the stored state", async () => {
    mocks.prisma.design.findFirst.mockResolvedValue({ id: "d1", path: `${USER}/designs/d1.png`, width: 1080, height: 1350 });
    mocks.download.mockResolvedValue({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null });
    mocks.prisma.canvaConnection.findUnique.mockResolvedValue({ accessTokenEncrypted: await encrypt("tok"), refreshTokenEncrypted: await encrypt("r"), expiresAt: new Date(Date.now() + 3600_000) });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/asset-uploads") && init?.method === "POST") return tokenResponse({ job: { id: "j1", status: "in_progress" } });
      if (url.endsWith("/asset-uploads/j1")) return tokenResponse({ job: { id: "j1", status: "success", asset: { id: "A1" } } });
      if (url.endsWith("/designs")) return tokenResponse({ design: { id: "CANVA1", urls: { edit_url: "https://www.canva.com/api/design/tok/edit" } } });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { url } = await openDesignInCanva(USER, "d1");
    const state = new URL(url).searchParams.get("correlation_state")!;
    expect(state.length).toBeLessThanOrEqual(50);
    expect(mocks.prisma.canvaEdit.create).toHaveBeenCalledWith({ data: { id: state, userId: USER, designId: "d1", canvaDesignId: "CANVA1" } });
    expect(fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith("/asset-uploads") && i?.method === "POST")).toHaveLength(1);
  });
});

describe("canvaSize", () => {
  it("clamps to Canva's limits", () => {
    expect(canvaSize(10, 20000)).toEqual({ width: 40, height: 8000 });
    const big = canvaSize(8000, 8000);
    expect(big.width * big.height).toBeLessThanOrEqual(25_000_000);
  });
});

function tokenResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("getAccessToken", () => {
  it("returns the stored token while it is fresh, without calling Canva", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.prisma.canvaConnection.findUnique.mockResolvedValue({
      accessTokenEncrypted: await encrypt("fresh"),
      refreshTokenEncrypted: await encrypt("r1"),
      expiresAt: new Date(Date.now() + 3600_000),
    });
    expect(await getAccessToken(USER)).toBe("fresh");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired token with Basic auth and stores the new pair", async () => {
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse({ access_token: "new-a", refresh_token: "new-r", expires_in: 14400 }));
    vi.stubGlobal("fetch", fetchMock);
    mocks.prisma.canvaConnection.findUnique.mockResolvedValue({
      accessTokenEncrypted: await encrypt("old"),
      refreshTokenEncrypted: await encrypt("r1"),
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await getAccessToken(USER)).toBe("new-a");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.canva.com/rest/v1/oauth/token");
    expect(init.headers.Authorization).toBe(`Basic ${btoa("OC-client:secret")}`);
    expect(init.body).toContain("grant_type=refresh_token");
    expect(init.body).toContain("refresh_token=r1");
    const saved = mocks.prisma.canvaConnection.upsert.mock.calls[0][0].create;
    expect(saved.accessTokenEncrypted).not.toContain("new-a");
    expect(await decrypt(saved.refreshTokenEncrypted)).toBe("new-r");
  });

  it("asks to reconnect and forgets the tokens when the refresh is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(tokenResponse({ error: "invalid_grant" }, 400)));
    const row = { accessTokenEncrypted: await encrypt("old"), refreshTokenEncrypted: await encrypt("r1"), expiresAt: new Date(0) };
    mocks.prisma.canvaConnection.findUnique.mockResolvedValue(row);
    await expect(getAccessToken(USER)).rejects.toBeInstanceOf(CanvaReconnectError);
    expect(mocks.prisma.canvaConnection.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
  });

  it("keeps the connection and reports a busy Canva on a 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(tokenResponse({ code: "too_many_requests" }, 429)));
    mocks.prisma.canvaConnection.findUnique.mockResolvedValue({ accessTokenEncrypted: await encrypt("old"), refreshTokenEncrypted: await encrypt("r1"), expiresAt: new Date(0) });
    await expect(getAccessToken(USER)).rejects.toMatchObject({ status: 429 });
    expect(mocks.prisma.canvaConnection.deleteMany).not.toHaveBeenCalled();
  });

  it("keeps the connection when our own client credentials are rejected (invalid_client)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(tokenResponse({ error: "invalid_client" }, 401)));
    mocks.prisma.canvaConnection.findUnique.mockResolvedValue({ accessTokenEncrypted: await encrypt("old"), refreshTokenEncrypted: await encrypt("r1"), expiresAt: new Date(0) });
    await expect(getAccessToken(USER)).rejects.toBeInstanceOf(CanvaApiError);
    expect(mocks.prisma.canvaConnection.deleteMany).not.toHaveBeenCalled();
  });

  it("revokes the refresh token with Canva when the user disconnects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    mocks.prisma.canvaConnection.findUnique.mockResolvedValue({ refreshTokenEncrypted: await encrypt("r-secret") });
    await disconnectCanva(USER);
    expect(mocks.prisma.canvaConnection.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.canva.com/rest/v1/oauth/revoke");
    expect(fetchMock.mock.calls[0][1].body).toBe("token=r-secret");
  });

  it("uses tokens a concurrent request already stored instead of disconnecting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(tokenResponse({ error: "invalid_grant" }, 400)));
    const stale = { accessTokenEncrypted: await encrypt("old"), refreshTokenEncrypted: await encrypt("r1"), expiresAt: new Date(0) };
    const newer = { accessTokenEncrypted: await encrypt("other-request"), refreshTokenEncrypted: await encrypt("r2"), expiresAt: new Date(Date.now() + 3600_000) };
    mocks.prisma.canvaConnection.findUnique.mockResolvedValueOnce(stale).mockResolvedValueOnce(newer);
    expect(await getAccessToken(USER)).toBe("other-request");
    expect(mocks.prisma.canvaConnection.deleteMany).not.toHaveBeenCalled();
  });

  it("throws when Canva is not connected", async () => {
    mocks.prisma.canvaConnection.findUnique.mockResolvedValue(null);
    await expect(getAccessToken(USER)).rejects.toBeInstanceOf(CanvaNotConnectedError);
  });
});

describe("return handler", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4, 0x38, 0, 0, 4, 0x38]);
  const original = { id: "d1", businessId: "b1", projectId: null, kind: "TEMPLATE", template: "offer", prompt: null, aspectRatio: "1:1", path: `${USER}/designs/d1.png`, width: 1080, height: 1080 };
  let keys: CryptoKeyPair;

  async function sign(claims: object, key = keys.privateKey) {
    const enc = (o: object) => base64Url(new TextEncoder().encode(JSON.stringify(o)));
    const head = enc({ alg: "ES256", kid: "k1" });
    const body = enc(claims);
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${base64Url(new Uint8Array(sig))}`;
  }
  const claims = (over: object = {}) => ({ aud: "OC-client", sub: "u", team_id: "t", design_id: "CANVA1", correlation_state: "state1", type: "rti", exp: Math.floor(Date.now() / 1000) + 3600, ...over });

  beforeEach(async () => {
    resetKeyCache();
    mocks.prisma.canvaEdit.updateMany.mockResolvedValue({ count: 1 });
    keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "k1" };
    mocks.prisma.design.findFirst.mockResolvedValue(original);
    mocks.prisma.canvaEdit.findFirst.mockResolvedValue({ id: "state1", userId: USER, designId: "d1", canvaDesignId: "CANVA1" });
    mocks.prisma.canvaConnection.findUnique.mockResolvedValue({
      accessTokenEncrypted: await encrypt("tok"),
      refreshTokenEncrypted: await encrypt("r"),
      expiresAt: new Date(Date.now() + 3600_000),
    });
    mocks.upload.mockResolvedValue({ error: null });
    mocks.prisma.design.create.mockResolvedValue({});
    const exportJob = (status: string) => tokenResponse({ job: { id: "e1", status, urls: status === "success" ? ["https://export-download.canva.com/x.png"] : undefined } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/connect/keys")) return tokenResponse({ keys: [jwk] });
        if (url.endsWith("/exports") && init?.method === "POST") return exportJob("in_progress");
        if (url.endsWith("/exports/e1")) return exportJob("success");
        if (url.startsWith("https://export-download.canva.com")) return new Response(PNG);
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  });

  it("exports the edited design and saves it as a new design, leaving the original", async () => {
    const result = await completeCanvaReturn(USER, await sign(claims()));
    const exportCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([u]) => String(u).endsWith("/exports"));
    expect(JSON.parse(exportCall![1].body)).toEqual({ design_id: "CANVA1", format: { type: "png", width: 1080, height: 1080, pages: [1] } });
    expect(mocks.upload.mock.calls[0][0]).toBe(`${USER}/designs/${result.designId}.png`);
    const created = mocks.prisma.design.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ id: result.designId, businessId: "b1", template: "offer", aspectRatio: "1:1", width: 1080, height: 1080 });
    // The session is kept (so a second "Return to BuPulse" works); only the claim is released.
    expect(mocks.prisma.canvaEdit.deleteMany).not.toHaveBeenCalled();
    expect(mocks.prisma.canvaEdit.updateMany).toHaveBeenLastCalledWith({ where: { id: "state1", userId: USER }, data: { processingAt: null } });
  });

  it("claims the session atomically, so a double return saves once", async () => {
    mocks.prisma.canvaEdit.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(completeCanvaReturn(USER, await sign(claims()))).rejects.toMatchObject({ code: "processing" });
    expect(mocks.prisma.design.create).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("saves again on a second return after the first finished", async () => {
    const token = await sign(claims());
    const first = await completeCanvaReturn(USER, token);
    const second = await completeCanvaReturn(USER, token);
    expect(second.designId).not.toBe(first.designId);
    expect(mocks.prisma.design.create).toHaveBeenCalledTimes(2);
  });

  it("removes the stored file and frees the claim when the design row cannot be written", async () => {
    mocks.prisma.design.create.mockRejectedValue(new Error("db down"));
    await expect(completeCanvaReturn(USER, await sign(claims()))).rejects.toBeInstanceOf(CanvaError);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.canvaEdit.updateMany).toHaveBeenLastCalledWith({ where: { id: "state1", userId: USER }, data: { processingAt: null } });
  });

  it("refuses to download from a host that is not Canva", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      String(url).endsWith("/exports/e1") ? tokenResponse({ job: { id: "e1", status: "success", urls: ["https://evil.example/x.png"] } }) : base(url, init),
    );
    await expect(completeCanvaReturn(USER, await sign(claims()))).rejects.toMatchObject({ code: "failed" });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("evil.example"))).toBe(false);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("stops downloading a file that grows past the size cap", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!String(url).startsWith("https://export-download.canva.com")) return base(url, init);
      const chunk = new Uint8Array(8 * 1024 * 1024);
      let sent = 0;
      return new Response(new ReadableStream({ pull(c) { if (sent++ < 5) c.enqueue(chunk); else c.close(); } }));
    });
    await expect(completeCanvaReturn(USER, await sign(claims()))).rejects.toMatchObject({ code: "failed" });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("rejects alg none, HS256 and tokens not valid yet", async () => {
    const enc = (o: object) => base64Url(new TextEncoder().encode(JSON.stringify(o)));
    const body = enc(claims());
    await expect(completeCanvaReturn(USER, `${enc({ alg: "none" })}.${body}.`)).rejects.toBeInstanceOf(CanvaError);
    await expect(completeCanvaReturn(USER, `${enc({ alg: "HS256" })}.${body}.${base64Url(new Uint8Array(32))}`)).rejects.toBeInstanceOf(CanvaError);
    await expect(completeCanvaReturn(USER, await sign(claims({ nbf: Math.floor(Date.now() / 1000) + 3600 })))).rejects.toBeInstanceOf(CanvaError);
    expect(mocks.prisma.design.create).not.toHaveBeenCalled();
  });

  it("rejects a token signed with another key", async () => {
    const other = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    await expect(completeCanvaReturn(USER, await sign(claims(), other.privateKey))).rejects.toBeInstanceOf(CanvaError);
    expect(mocks.prisma.design.create).not.toHaveBeenCalled();
  });

  it("rejects wrong audience, wrong type and expired tokens", async () => {
    for (const over of [{ aud: "someone-else" }, { type: "other" }, { exp: 1 }]) {
      await expect(completeCanvaReturn(USER, await sign(claims(over)))).rejects.toBeInstanceOf(CanvaError);
    }
  });

  it("rejects a session that belongs to another user or another Canva design", async () => {
    mocks.prisma.canvaEdit.findFirst.mockResolvedValue(null);
    await expect(completeCanvaReturn(OTHER, await sign(claims()))).rejects.toMatchObject({ code: "not_found" });
    expect(mocks.prisma.canvaEdit.findFirst).toHaveBeenCalledWith({ where: { id: "state1", userId: OTHER } });
    mocks.prisma.canvaEdit.findFirst.mockResolvedValue({ id: "state1", userId: USER, designId: "d1", canvaDesignId: "CANVA1" });
    await expect(completeCanvaReturn(USER, await sign(claims({ design_id: "OTHER" })))).rejects.toMatchObject({ code: "not_found" });
  });

  it("does not use a design the user does not own", async () => {
    mocks.prisma.design.findFirst.mockResolvedValue(null);
    await expect(completeCanvaReturn(USER, await sign(claims()))).rejects.toMatchObject({ code: "not_found" });
  });

  it("gives a friendly timeout when the export never finishes", async () => {
    const token = await sign(claims());
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    try {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
        String(url).endsWith("/exports/e1") ? tokenResponse({ job: { id: "e1", status: "in_progress" } }) : base(url, init),
      );
      const pending = completeCanvaReturn(USER, token);
      const assertion = expect(pending).rejects.toMatchObject({ code: "timeout" });
      // Crypto resolves on the real event loop, so keep nudging the fake clock until the poll gives up.
      let settled = false;
      void assertion.finally(() => (settled = true));
      for (let i = 0; i < 200 && !settled; i += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        await vi.advanceTimersByTimeAsync(3000);
      }
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

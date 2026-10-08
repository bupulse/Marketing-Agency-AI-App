import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ savePending: vi.fn(), saveConnection: vi.fn(), findFirst: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { business: { findFirst: mocks.findFirst } } }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/stores/connection", () => ({ savePending: mocks.savePending, saveConnection: mocks.saveConnection }));

import { POST as callback } from "@/app/api/stores/woocommerce/callback/route";
import { buildWooAuthorizeUrl, normalizeWooProduct, openWooState, sealWooState, verifyWooKeys, wooProvider } from "@/lib/stores/woocommerce";

const KEY = `ck_${"a".repeat(40)}`;
const SECRET = `cs_${"b".repeat(40)}`;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
  process.env.NEXT_PUBLIC_SITE_URL = "https://app.bupulse.test";
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue({ id: "biz1" });
});

const stateFor = (storeUrl = "https://store.com") => sealWooState({ userId: "u1", businessId: "biz1", storeUrl });

function storeFetch(opts: { auth?: boolean } = {}) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (opts.auth === false) return new Response("{}", { status: 401 });
    if (u.includes("/data/currencies/current")) return new Response(JSON.stringify({ code: "USD" }), { status: 200 });
    return new Response("[]", { status: 200, headers: { "x-wp-totalpages": "1" } });
  });
}

const post = (body: unknown) => callback(new Request("https://app.bupulse.test/api/stores/woocommerce/callback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("signed state", () => {
  it("round-trips and cannot be forged, tampered with or replayed after expiry", async () => {
    const sealed = await stateFor();
    expect(await openWooState(sealed)).toMatchObject({ userId: "u1", businessId: "biz1", storeUrl: "https://store.com" });
    expect(await openWooState(`${sealed}x`)).toBeNull();
    expect(await openWooState("v1:1:AAAA:BBBB")).toBeNull();
    expect(await openWooState("plain-user-id")).toBeNull();
    expect(await openWooState(null)).toBeNull();
    const old = await sealWooState({ userId: "u1", businessId: "biz1", storeUrl: "https://store.com" }, 1_000);
    expect(await openWooState(old, 1_000 + 16 * 60_000)).toBeNull();
  });
  it("builds the one-click URL with read scope and our callback", async () => {
    const url = new URL(buildWooAuthorizeUrl("https://store.com", "STATE"));
    expect(url.origin + url.pathname).toBe("https://store.com/wc-auth/v1/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      app_name: "BuPulse",
      scope: "read",
      user_id: "STATE",
      return_url: "https://app.bupulse.test/dashboard/stores/woocommerce?connected=1",
      callback_url: "https://app.bupulse.test/api/stores/woocommerce/callback",
    });
  });
});

describe("callback", () => {
  it("saves verified keys as PENDING for the user and store named in the state, not in the request, and never touches the active connection", async () => {
    const f = storeFetch();
    vi.stubGlobal("fetch", f);
    const res = await post({ user_id: await stateFor("https://store.com"), consumer_key: KEY, consumer_secret: SECRET, key_id: 1, key_permissions: "read", store: "https://evil.com" });
    vi.unstubAllGlobals();
    expect(res.status).toBe(200);
    expect(mocks.savePending).toHaveBeenCalledWith({ businessId: "biz1", provider: "woocommerce", storeUrl: "https://store.com", secret: `${KEY}:${SECRET}`, currency: "USD" });
    expect(mocks.saveConnection).not.toHaveBeenCalled();
    expect(f.mock.calls.every(([u]) => String(u).startsWith("https://store.com/"))).toBe(true);
  });
  it("rejects a forged or expired state with 401", async () => {
    expect((await post({ user_id: "forged", consumer_key: KEY, consumer_secret: SECRET })).status).toBe(401);
    expect((await post({ consumer_key: KEY, consumer_secret: SECRET })).status).toBe(401);
    expect(mocks.savePending).not.toHaveBeenCalled();
    expect(mocks.saveConnection).not.toHaveBeenCalled();
  });
  it("rejects malformed keys and keys the store does not accept", async () => {
    expect((await post({ user_id: await stateFor(), consumer_key: "nope", consumer_secret: SECRET })).status).toBe(400);
    vi.stubGlobal("fetch", storeFetch({ auth: false }));
    expect((await post({ user_id: await stateFor(), consumer_key: KEY, consumer_secret: SECRET })).status).toBe(400);
    vi.unstubAllGlobals();
    expect(mocks.savePending).not.toHaveBeenCalled();
  });
  it("rejects a state whose business no longer belongs to the user", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect((await post({ user_id: await stateFor(), consumer_key: KEY, consumer_secret: SECRET })).status).toBe(401);
  });
});

describe("REST API", () => {
  it("authenticates with Basic auth and falls back to query keys when the header is stripped", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("authorization");
      seen.push({ url: String(url), auth });
      return auth ? new Response("{}", { status: 401 }) : new Response("[]", { status: 200 });
    });
    await verifyWooKeys("https://store.com", `${KEY}:${SECRET}`, f as unknown as typeof fetch);
    expect(seen[0].auth).toBe(`Basic ${btoa(`${KEY}:${SECRET}`)}`);
    expect(seen[1].auth).toBeNull();
    expect(seen[1].url).toContain(`consumer_key=${KEY}`);
  });

  it("pages products and reports the next page", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify([{ id: 7, name: "Mug &amp; saucer", price: "12.5", images: [{ src: "https://store.com/a.jpg" }] }]), { status: 200, headers: { "x-wp-totalpages": "3" } }));
    vi.stubGlobal("fetch", f);
    const page = await wooProvider.listProducts({ provider: "woocommerce", storeUrl: "https://store.com", secret: `${KEY}:${SECRET}`, currency: "USD" }, { cursor: "2", search: "mug" });
    vi.unstubAllGlobals();
    const url = new URL(String((f.mock.calls as unknown as string[][])[0][0]));
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("search")).toBe("mug");
    expect(page.nextCursor).toBe("3");
    expect(page.products[0]).toMatchObject({ externalId: "7", title: "Mug & saucer", price: "$12.50", imageUrls: ["https://store.com/a.jpg"] });
  });

  it("maps variable products, html descriptions, categories and attributes", () => {
    const p = normalizeWooProduct(
      { id: 1, name: "Tee", type: "variable", price: "10", short_description: "<p>Soft &amp; light</p>", categories: [{ name: "Clothes" }], tags: [{ name: "summer" }], attributes: [{ name: "Size", options: ["S", "M"], visible: true }, { name: "Hidden", options: ["x"], visible: false }], images: [{ src: "https://x.com/1.jpg" }] },
      "EUR",
    );
    expect(p).toMatchObject({ price: "From €10.00", description: "Soft & light", features: ["Clothes", "summer", "Size: S, M"] });
  });
});

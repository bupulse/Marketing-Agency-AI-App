import { beforeEach, describe, expect, it, vi } from "vitest";
// Plans are not part of this test's database: every plan feature is granted (tests/stubs/entitlements.ts).
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(async () => ({ count: 1 })),
  requireActiveUser: vi.fn(),
  saveConnection: vi.fn(),
  exchange: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { storeConnection: { deleteMany: mocks.deleteMany }, business: { findUnique: vi.fn(async () => ({ id: "biz1" })) } } }));
vi.mock("@/lib/rate-limit", () => ({ RATE_LIMITS: { storeConnect: {} }, rateLimit: vi.fn(), RateLimitError: class extends Error {} }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock("@/lib/stores/connection", () => ({ saveConnection: mocks.saveConnection }));

import { POST as webhook } from "@/app/api/stores/shopify/webhooks/route";
import { GET as callback } from "@/app/api/stores/shopify/callback/route";
import { GET as connect, POST as connectPost } from "@/app/api/stores/shopify/connect/route";
import { hmacBase64, hmacHex } from "@/lib/stores/hmac";
import { installRedirect, normalizeShopDomain, normalizeShopifyProduct, searchQuery, verifyOAuthHmac, verifyWebhookHmac } from "@/lib/stores/shopify";
import { SHOPIFY_COOKIE, sealShopifyState } from "@/lib/stores/state";

const SECRET = "shpss_test_secret";
const USER = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  process.env.SHOPIFY_API_KEY = "key123";
  process.env.SHOPIFY_API_SECRET = SECRET;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.NEXT_PUBLIC_SITE_URL = "https://app.bupulse.test";
  vi.clearAllMocks();
  mocks.requireActiveUser.mockResolvedValue({ id: USER });
});

describe("shop domain validation", () => {
  it("accepts *.myshopify.com in its common spellings", () => {
    expect(normalizeShopDomain("my-shop")).toBe("my-shop.myshopify.com");
    expect(normalizeShopDomain(" My-Shop.myshopify.com ")).toBe("my-shop.myshopify.com");
    expect(normalizeShopDomain("https://admin.shopify.com/store/my-shop")).toBe("my-shop.myshopify.com");
    expect(normalizeShopDomain("https://my-shop.myshopify.com/")).toBe("my-shop.myshopify.com");
  });
  it("rejects anything else, because the shop host receives our secret code", () => {
    for (const bad of ["evil.com", "my-shop.myshopify.com.evil.com", "evil.com/.myshopify.com", "my-shop.myshopify.com:8080", "user@my-shop.myshopify.com", "https://127.0.0.1", "", "a b.myshopify.com", "-x.myshopify.com", null]) {
      expect(normalizeShopDomain(bad as string)).toBeNull();
    }
  });
});

describe("OAuth HMAC", () => {
  async function signed(params: Record<string, string>) {
    const message = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
    return new URLSearchParams({ ...params, hmac: await hmacHex(SECRET, message) });
  }
  it("accepts a correctly signed callback regardless of parameter order", async () => {
    const q = await signed({ code: "abc", shop: "a.myshopify.com", state: "s1", timestamp: "1700000000" });
    expect(await verifyOAuthHmac(q, SECRET)).toBe(true);
  });
  it("rejects a changed parameter, a missing hmac and a wrong secret", async () => {
    const q = await signed({ code: "abc", shop: "a.myshopify.com", state: "s1", timestamp: "1700000000" });
    q.set("shop", "b.myshopify.com");
    expect(await verifyOAuthHmac(q, SECRET)).toBe(false);
    q.delete("hmac");
    expect(await verifyOAuthHmac(q, SECRET)).toBe(false);
    expect(await verifyOAuthHmac(await signed({ code: "abc" }), "other")).toBe(false);
  });
});

describe("OAuth routes", () => {
  const URL_BASE = "https://app.bupulse.test/api/stores/shopify/connect";
  async function signedQuery(over: Record<string, string> = {}) {
    const params: Record<string, string> = { shop: "my-shop.myshopify.com", host: "abc", timestamp: String(Math.floor(Date.now() / 1000)), ...over };
    const message = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
    return new URLSearchParams({ ...params, hmac: await hmacHex(SECRET, message) });
  }

  it("an install signed by Shopify redirects to the shop with read_products only, and seals the state in an httpOnly cookie", async () => {
    const res = await connect(new Request(`${URL_BASE}?${await signedQuery()}`));
    expect([302, 303, 307]).toContain(res.status);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe("https://my-shop.myshopify.com");
    expect(location.searchParams.get("scope")).toBe("read_products");
    expect(location.searchParams.get("client_id")).toBe("key123");
    expect(location.searchParams.get("redirect_uri")).toBe("https://app.bupulse.test/api/stores/shopify/callback");
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
  });

  it("a ?_rsc=… added by Next's router while following the post-login redirect does not break the signature", async () => {
    const res = await connect(new Request(`${URL_BASE}?${await signedQuery()}&_rsc=abc123`));
    expect(new URL(res.headers.get("location")!).origin).toBe("https://my-shop.myshopify.com");
  });

  it("a GET that Shopify did not sign (a link anyone could craft) does nothing", async () => {
    for (const url of [`${URL_BASE}?shop=my-shop`, `${URL_BASE}?shop=my-shop.myshopify.com&hmac=deadbeef&timestamp=${Math.floor(Date.now() / 1000)}`]) {
      const res = await connect(new Request(url));
      expect(res.headers.get("location")).toContain("error=invalid_request");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(mocks.requireActiveUser).not.toHaveBeenCalled();
  });

  it("a signed install that is too old is refused (replay)", async () => {
    const q = await signedQuery({ timestamp: String(Math.floor(Date.now() / 1000) - 3600) });
    expect((await connect(new Request(`${URL_BASE}?${q}`))).headers.get("location")).toContain("error=invalid_request");
  });

  it("the typed-shop form is a POST from our own origin; another origin or none is refused", async () => {
    const body = () => new URLSearchParams({ shop: "my-shop" });
    const ok = await postConnect(body(), "https://app.bupulse.test");
    expect(new URL(ok.headers.get("location")!).origin).toBe("https://my-shop.myshopify.com");
    for (const origin of ["https://evil.example.org", null]) {
      const res = await postConnect(body(), origin);
      expect(res.headers.get("location")).toContain("error=invalid_request");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("connect refuses a non-Shopify host", async () => {
    const res = await postConnect(new URLSearchParams({ shop: "evil.com" }), "https://app.bupulse.test");
    expect(res.headers.get("location")).toContain("error=invalid_shop");
  });

  function postConnect(form: URLSearchParams, origin: string | null) {
    return connectPost(new Request(URL_BASE, { method: "POST", body: form, headers: origin ? { origin } : {} }));
  }

  it("installRedirect starts OAuth only for a fresh, correctly signed install", async () => {
    const q = Object.fromEntries(await signedQuery());
    expect(await installRedirect(q, SECRET)).toMatch(/^\/api\/stores\/shopify\/connect\?/);
    expect(await installRedirect({ ...q, shop: "evil.com" }, SECRET)).toBeNull();
    expect(await installRedirect({ ...q, host: "tampered" }, SECRET)).toBeNull();
    expect(await installRedirect({ shop: q.shop }, SECRET)).toBeNull();
    expect(await installRedirect(q, SECRET, Date.now() + 3600_000)).toBeNull();
  });

  async function callbackRequest(over: { state?: string; cookieState?: string; shop?: string; tamper?: boolean } = {}) {
    const state = over.state ?? "state-1";
    const params = { code: "thecode", shop: over.shop ?? "my-shop.myshopify.com", state, timestamp: "1700000000" };
    const message = Object.keys(params).sort().map((k) => `${k}=${(params as Record<string, string>)[k]}`).join("&");
    const q = new URLSearchParams({ ...params, hmac: await hmacHex(SECRET, message) });
    if (over.tamper) q.set("code", "other");
    const sealed = await sealShopifyState({ state: over.cookieState ?? "state-1", shop: "my-shop.myshopify.com", userId: USER });
    return new Request(`https://app.bupulse.test/api/stores/shopify/callback?${q}`, { headers: { cookie: `${SHOPIFY_COOKIE}=${encodeURIComponent(sealed)}` } });
  }

  it("callback with a tampered query is rejected before anything else happens", async () => {
    const res = await callback(await callbackRequest({ tamper: true }));
    expect(res.headers.get("location")).toContain("error=invalid_request");
    expect(mocks.requireActiveUser).not.toHaveBeenCalled();
    expect(mocks.saveConnection).not.toHaveBeenCalled();
  });

  it("callback with the wrong state is rejected", async () => {
    const res = await callback(await callbackRequest({ state: "state-2" }));
    expect(res.headers.get("location")).toContain("error=invalid_request");
    expect(mocks.saveConnection).not.toHaveBeenCalled();
  });

  it("callback with a different shop than the one that started the flow is rejected", async () => {
    const res = await callback(await callbackRequest({ shop: "other-shop.myshopify.com" }));
    expect(res.headers.get("location")).toContain("error=invalid_request");
  });

  it("a valid callback exchanges the code and stores the token", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/admin/oauth/access_token")) {
        expect(JSON.parse(String(init?.body))).toEqual({ client_id: "key123", client_secret: SECRET, code: "thecode" });
        return new Response(JSON.stringify({ access_token: "shpat_abc", scope: "read_products" }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await callback(await callbackRequest());
    vi.unstubAllGlobals();
    expect(res.headers.get("location")).toContain("connected=1");
    expect(mocks.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ businessId: "biz1", provider: "shopify", storeUrl: "my-shop.myshopify.com", secret: "shpat_abc" }));
  });
});

describe("webhooks (GDPR and uninstall)", () => {
  async function post(topic: string, body = "{}", sign = true, shop = "my-shop.myshopify.com") {
    const hmac = sign ? await hmacBase64(SECRET, body) : "bogus";
    return webhook(new Request("https://app.bupulse.test/api/stores/shopify/webhooks", { method: "POST", body, headers: { "x-shopify-hmac-sha256": hmac, "x-shopify-topic": topic, "x-shopify-shop-domain": shop } }));
  }
  it("rejects a bad signature with 401 and does nothing", async () => {
    expect((await post("shop/redact", "{}", false)).status).toBe(401);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
  it("verifies over the raw body", async () => {
    expect(await verifyWebhookHmac("{}", await hmacBase64(SECRET, "{}"), SECRET)).toBe(true);
    expect(await verifyWebhookHmac("{ }", await hmacBase64(SECRET, "{}"), SECRET)).toBe(false);
    expect(await verifyWebhookHmac("{}", null, SECRET)).toBe(false);
  });
  it.each(["customers/data_request", "customers/redact"])("%s answers 200 and stores nothing (no customer data is kept)", async (topic) => {
    expect((await post(topic)).status).toBe(200);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
  it.each(["shop/redact", "app/uninstalled"])("%s deletes the shop's connection", async (topic) => {
    expect((await post(topic)).status).toBe(200);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { provider: "shopify", storeUrl: "my-shop.myshopify.com" } });
  });
  it("ignores a webhook naming a non-Shopify shop", async () => {
    expect((await post("shop/redact", "{}", true, "evil.com")).status).toBe(200);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});

describe("product mapping", () => {
  it("maps price ranges, tags and images", () => {
    const p = normalizeShopifyProduct({
      id: "gid://shopify/Product/1",
      title: "Leather bag",
      description: "Hand made.",
      productType: "Bags",
      tags: ["leather", "Bags", "gift"],
      priceRangeV2: { minVariantPrice: { amount: "20.0", currencyCode: "USD" }, maxVariantPrice: { amount: "35.0", currencyCode: "USD" } },
      media: { nodes: [{ image: { url: "https://cdn.shopify.com/a.jpg" } }, null, {}] },
    });
    expect(p).toMatchObject({ externalId: "gid://shopify/Product/1", title: "Leather bag", price: "From $20.00", description: "Hand made.", features: ["Bags", "leather", "gift"], imageUrls: ["https://cdn.shopify.com/a.jpg"] });
  });
  it("shows a single price when min equals max", () => {
    const p = normalizeShopifyProduct({ id: "1", title: "x", priceRangeV2: { minVariantPrice: { amount: "5", currencyCode: "USD" }, maxVariantPrice: { amount: "5", currencyCode: "USD" } } });
    expect(p.price).toBe("$5.00");
  });
  it("search cannot inject query operators", () => {
    expect(searchQuery('red" OR status:draft')).toBe("status:active title:*red* title:*OR* title:*status* title:*draft*");
    expect(searchQuery("")).toBe("status:active");
  });
});

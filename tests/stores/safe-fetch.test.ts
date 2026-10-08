import { describe, expect, it, vi } from "vitest";
import { checkImageUrl, fetchImage, isShopifyImageHost, storeApiFetch } from "@/lib/stores/safe-fetch";
import { normalizeStoreUrl } from "@/lib/stores/woocommerce";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const img = (bytes: Uint8Array = JPEG) => new Response(bytes as BodyInit, { status: 200, headers: { "content-type": "image/jpeg" } });

describe("SSRF guard for images", () => {
  it.each([
    "http://cdn.shopify.com/a.jpg",
    "https://127.0.0.1/a.jpg",
    "https://localhost/a.jpg",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.5/a.jpg",
    "https://[::1]/a.jpg",
    "https://user:pw@cdn.shopify.com/a.jpg",
    "https://cdn.shopify.com:8443/a.jpg",
    "ftp://cdn.shopify.com/a.jpg",
    "file:///etc/passwd",
    "https://2130706433/a.jpg",
  ])("refuses %s", (url) => {
    expect(checkImageUrl(url)).toBeNull();
  });

  it("applies the Shopify host rule", () => {
    expect(checkImageUrl("https://cdn.shopify.com/s/a.jpg", isShopifyImageHost)).not.toBeNull();
    expect(checkImageUrl("https://evil.example.org/a.jpg", isShopifyImageHost)).toBeNull();
    expect(checkImageUrl("https://cdn.shopify.com.evil.org/a.jpg", isShopifyImageHost)).toBeNull();
  });

  it("downloads a real image and sniffs its type", async () => {
    const f = vi.fn(async () => img());
    const r = await fetchImage("https://cdn.shopify.com/a.jpg", isShopifyImageHost, f as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: true, mimeType: "image/jpeg" });
  });

  it("refuses a redirect to a private address, and never fetches it", async () => {
    const f = vi.fn(async (url: string) => (url.includes("cdn.shopify.com") ? new Response(null, { status: 302, headers: { location: "https://169.254.169.254/x" } }) : img()));
    const r = await fetchImage("https://cdn.shopify.com/a.jpg", isShopifyImageHost, f as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect off the allowed hosts", async () => {
    const f = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example.org/a.jpg" } }));
    expect((await fetchImage("https://cdn.shopify.com/a.jpg", isShopifyImageHost, f as unknown as typeof fetch)).ok).toBe(false);
  });

  it("rejects non-images whatever the content type says, and oversized files", async () => {
    const html = new Response("<html>", { status: 200, headers: { "content-type": "image/jpeg" } });
    expect((await fetchImage("https://cdn.shopify.com/a.jpg", undefined, (async () => html) as unknown as typeof fetch)).ok).toBe(false);
    const big = new Response(new Uint8Array(10), { status: 200, headers: { "content-length": String(50 * 1024 * 1024) } });
    expect((await fetchImage("https://cdn.shopify.com/a.jpg", undefined, (async () => big) as unknown as typeof fetch)).ok).toBe(false);
  });
});

describe("store URLs and API calls", () => {
  it("normalises a store address and refuses private ones", () => {
    expect(normalizeStoreUrl("shop.example-store.com/")).toEqual({ ok: true, url: "https://shop.example-store.com" });
    expect(normalizeStoreUrl("https://store.com/shop/wp-admin/")).toEqual({ ok: true, url: "https://store.com/shop" });
    for (const bad of ["http://store.com", "https://192.168.1.10", "https://localhost", "https://store.internal", "https://10.1.1.1/shop", "javascript:alert(1)", "", "https://u:p@store.com"]) {
      expect(normalizeStoreUrl(bad).ok).toBe(false);
    }
  });

  it("never sends keys to another host after a redirect", async () => {
    const f = vi.fn(async () => new Response(null, { status: 301, headers: { location: "https://other.com/wp-json" } }));
    await expect(storeApiFetch("https://store.com/wp-json/wc/v3/products", { headers: { authorization: "Basic xxx" } }, f as unknown as typeof fetch)).rejects.toThrow(/redirected/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("follows a same-host redirect", async () => {
    let n = 0;
    const f = vi.fn(async () => (n++ === 0 ? new Response(null, { status: 301, headers: { location: "https://store.com/shop/wp-json/wc/v3/products" } }) : new Response("[]", { status: 200 })));
    const r = await storeApiFetch("https://store.com/wp-json/wc/v3/products", {}, f as unknown as typeof fetch);
    expect(r.status).toBe(200);
  });
});

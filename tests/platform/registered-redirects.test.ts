import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canvaConfig } from "@/lib/canva/config";
import { googleCalendarConfig } from "@/lib/google-calendar/oauth";
import { googleRedirectUri } from "@/lib/auth/google-signin";
import { originFor } from "@/lib/auth/site-url";
import { redirectUri } from "@/lib/social/oauth";
import { NETWORKS } from "@/lib/social/types";
import { shopifyRedirectUri } from "@/lib/stores/shopify";
import { hostRoute } from "@/lib/platform/app-hosts";
import { buildWooAuthorizeUrl } from "@/lib/stores/woocommerce";

// With the host split on (docs/HOSTS.md) every OAuth flow still names the address registered with the provider, on
// bupulse.com, both when it starts (authorize URL) and in the token exchange (the same function feeds both): nothing
// changes in the Meta, Google, LinkedIn, TikTok, YouTube, Canva or Shopify consoles.

const PROD = { NEXT_PUBLIC_SITE_URL: "https://bupulse.com", PUBLIC_LINK_URL: "", MARKETING_APP_URL: "https://marketing.bupulse.com", ADMIN_APP_URL: "https://admin.bupulse.com", CLIENT_COOKIE_DOMAIN: ".bupulse.com" };

beforeEach(() => {
  for (const [k, v] of Object.entries(PROD)) vi.stubEnv(k, v);
  vi.stubEnv("CANVA_CLIENT_ID", "c");
  vi.stubEnv("CANVA_CLIENT_SECRET", "s");
  vi.stubEnv("CANVA_REDIRECT_URI", "");
  vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "g");
  vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "s");
});
afterEach(() => vi.unstubAllEnvs());

describe("registered redirect URIs stay on bupulse.com", () => {
  it("every social network", () => {
    for (const n of NETWORKS) expect(redirectUri(n)).toBe(`https://bupulse.com/api/social/${n}/callback`);
  });
  it("Canva, Shopify and the admin Google Calendar", () => {
    expect(canvaConfig().redirectUri).toBe("https://bupulse.com/api/canva/callback");
    expect(shopifyRedirectUri()).toBe("https://bupulse.com/api/stores/shopify/callback");
    expect(googleCalendarConfig()?.redirectUri).toBe("https://bupulse.com/api/admin/google-calendar/callback");
  });
  it("Google sign-in: the sign-in pages are on bupulse.com, so /auth/google is bupulse.com's", () => {
    expect(googleRedirectUri(originFor(new Headers({ host: "bupulse.com", "x-forwarded-proto": "https" })))).toBe("https://bupulse.com/auth/google");
    // And bupulse.com never sends /login or /auth/* to another host.
    for (const p of ["/login", "/auth/google", "/auth/callback", "/auth/confirm"]) expect(hostRoute("GET", p, "", "bupulse.com")).toEqual({ action: "pass" });
  });
  it("WooCommerce: its keys are POSTed to bupulse.com server to server; the person comes back to the Marketing host", () => {
    const url = new URL(buildWooAuthorizeUrl("https://shop.example", "state", "https://bupulse.com"));
    expect(url.searchParams.get("callback_url")).toBe("https://bupulse.com/api/stores/woocommerce/callback");
    expect(url.searchParams.get("return_url")).toBe("https://marketing.bupulse.com/stores/woocommerce?connected=1");
    expect(hostRoute("POST", "/api/stores/woocommerce/callback", "", "bupulse.com")).toEqual({ action: "pass" });
  });
  it("callbacks finish on bupulse.com (the shared session and the state cookie are there), except the admin's Google Calendar", () => {
    for (const p of ["/api/social/facebook/callback", "/api/creator/instagram/callback", "/api/canva/callback", "/api/canva/return", "/api/stores/shopify/callback", "/api/social/tiktok/composio", "/api/social/x/zernio", "/api/social/linkedin/uploadpost"]) {
      expect(hostRoute("GET", p, "?code=x&state=y", "bupulse.com"), p).toEqual({ action: "pass" });
    }
    expect(hostRoute("GET", "/api/admin/google-calendar/callback", "?code=x&state=y", "bupulse.com")).toEqual({ action: "redirect", url: "https://admin.bupulse.com/api/admin/google-calendar/callback?code=x&state=y" });
  });
});

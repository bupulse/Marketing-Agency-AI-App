import { beforeEach, describe, expect, it, vi } from "vitest";

// Links and redirects follow the address the visitor is on, but only an address we serve: on the test machine the
// https://test.bupulse.com tunnel or localhost; in production only https://bupulse.com, whatever Host arrives.

const h = vi.hoisted(() => ({ headers: null as Headers | null }));
vi.mock("next/headers", () => ({
  headers: async () => {
    if (!h.headers) throw new Error("headers() was called outside a request scope");
    return h.headers;
  },
}));

import { linkSiteUrl, requestSiteUrl, secureCookies } from "@/lib/auth/request-site";
import { originFor, publicSiteUrl } from "@/lib/auth/site-url";
import { runAsBackgroundJob } from "@/lib/platform/background-job";

const req = (host: string, proto?: string) => {
  const hd = new Headers({ host });
  if (proto) hd.set("x-forwarded-proto", proto);
  return hd;
};

describe("on the test machine", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3001");
    vi.stubEnv("AUTH_EXTRA_ORIGINS", "https://test.bupulse.com");
    vi.stubEnv("PUBLIC_LINK_URL", "https://test.bupulse.com");
    h.headers = null;
  });

  it("a visitor on the tunnel gets the tunnel, https cookies included", async () => {
    h.headers = req("test.bupulse.com", "https");
    expect(await requestSiteUrl()).toBe("https://test.bupulse.com");
    expect(await linkSiteUrl()).toBe("https://test.bupulse.com");
    expect(await secureCookies()).toBe(true);
  });

  it("a visitor on localhost stays on localhost", async () => {
    h.headers = req("localhost:3001");
    expect(await requestSiteUrl()).toBe("http://localhost:3001");
    expect(await linkSiteUrl()).toBe("http://localhost:3001");
    expect(await secureCookies()).toBe(false);
  });

  it("a forged Host is never followed", async () => {
    h.headers = req("evil.example", "https");
    expect(await requestSiteUrl()).toBe("http://localhost:3001");
    expect(await linkSiteUrl()).toBe("https://test.bupulse.com");
    h.headers = new Headers({ host: "localhost:3001", "x-forwarded-host": "evil.example" });
    expect(originFor(h.headers)).toBe("http://localhost:3001");
  });

  it("no request (a script): redirects use siteUrl, links the public address", async () => {
    expect(await requestSiteUrl()).toBe("http://localhost:3001");
    expect(await linkSiteUrl()).toBe("https://test.bupulse.com");
  });

  it("a cron job called on localhost still links to the public address", async () => {
    h.headers = req("localhost:3001");
    expect(await runAsBackgroundJob(() => linkSiteUrl())).toBe("https://test.bupulse.com");
    expect(await linkSiteUrl()).toBe("http://localhost:3001");
  });
});

describe("in production", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bupulse.com");
    vi.stubEnv("AUTH_EXTRA_ORIGINS", "");
    vi.stubEnv("PUBLIC_LINK_URL", "");
  });

  it("everything is https://bupulse.com, whatever Host arrives", async () => {
    for (const host of ["bupulse.com", "test.bupulse.com", "localhost:3001", "evil.example", ""]) {
      h.headers = host ? req(host, "https") : null;
      expect(await requestSiteUrl(), host).toBe("https://bupulse.com");
      expect(await linkSiteUrl(), host).toBe("https://bupulse.com");
    }
    expect(publicSiteUrl()).toBe("https://bupulse.com");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { originFor } from "@/lib/auth/site-url";

const h = (init: Record<string, string>) => new Headers(init);

describe("originFor", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3001");
    vi.stubEnv("AUTH_EXTRA_ORIGINS", "https://test.bupulse.com");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns the tunnel address when the visitor came through it", () => {
    expect(originFor(h({ host: "test.bupulse.com", "x-forwarded-proto": "https" }))).toBe("https://test.bupulse.com");
    expect(originFor(h({ "x-forwarded-host": "test.bupulse.com", host: "localhost:3001" }))).toBe("https://test.bupulse.com");
  });
  it("keeps localhost on http", () => {
    expect(originFor(h({ host: "localhost:3001" }))).toBe("http://localhost:3001");
  });
  it("never trusts an unknown host", () => {
    expect(originFor(h({ host: "evil.example", "x-forwarded-proto": "https" }))).toBe("http://localhost:3001");
    expect(originFor(h({}))).toBe("http://localhost:3001");
  });
  it("production: only the site address", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bupulse.com");
    vi.stubEnv("AUTH_EXTRA_ORIGINS", "");
    expect(originFor(h({ host: "bupulse.com", "x-forwarded-proto": "https" }))).toBe("https://bupulse.com");
    expect(originFor(h({ host: "test.bupulse.com", "x-forwarded-proto": "https" }))).toBe("https://bupulse.com");
  });
});

describe("originFor with the host split (docs/HOSTS.md)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("accepts the Marketing and admin hosts once they are set, and *.localhost on http for local tests", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://bupulse.localhost:3041");
    vi.stubEnv("AUTH_EXTRA_ORIGINS", "");
    vi.stubEnv("MARKETING_APP_URL", "http://marketing.bupulse.localhost:3041");
    vi.stubEnv("ADMIN_APP_URL", "http://admin.bupulse.localhost:3041");
    vi.stubEnv("CLIENT_COOKIE_DOMAIN", ".bupulse.localhost");
    expect(originFor(h({ host: "marketing.bupulse.localhost:3041" }))).toBe("http://marketing.bupulse.localhost:3041");
    expect(originFor(h({ host: "admin.bupulse.localhost:3041" }))).toBe("http://admin.bupulse.localhost:3041");
    expect(originFor(h({ host: "other.bupulse.localhost:3041" }))).toBe("http://bupulse.localhost:3041");
    vi.stubEnv("MARKETING_APP_URL", "");
    expect(originFor(h({ host: "marketing.bupulse.localhost:3041" }))).toBe("http://bupulse.localhost:3041");
  });
});

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

import { describe, expect, it } from "vitest";
import { RateLimiter, cookieValue, isLocal, safeNext, sameText, setCookieHeader, tokenFor } from "@/video-lab/gate";

describe("studio password gate", () => {
  it("treats only this computer as local", () => {
    expect(isLocal({ host: "localhost:3100" }, 3100)).toBe(true);
    expect(isLocal({ host: "127.0.0.1:3100" }, 3100)).toBe(true);
    expect(isLocal({ host: "video.bupulse.com" }, 3100)).toBe(false);
    expect(isLocal({ host: "localhost:3100", "x-forwarded-for": "41.186.1.2" }, 3100)).toBe(false);
    expect(isLocal({ host: "localhost:3100", "cf-connecting-ip": "41.186.1.2" }, 3100)).toBe(false);
  });

  it("signs the cookie with the password and the secret", () => {
    const secret = Buffer.alloc(32, 7);
    expect(tokenFor("pw", secret)).toBe(tokenFor("pw", secret));
    expect(tokenFor("pw", secret)).not.toBe(tokenFor("pw2", secret));
    expect(tokenFor("pw", secret)).not.toBe(tokenFor("pw", Buffer.alloc(32, 8)));
    expect(sameText("abc", "abc")).toBe(true);
    expect(sameText("abc", "abcd")).toBe(false);
  });

  it("reads the cookie and sets it httpOnly, Lax, Secure only over https", () => {
    expect(cookieValue({ cookie: "a=1; bp_studio=tok%3D; b=2" })).toBe("tok=");
    expect(cookieValue({})).toBeNull();
    const plain = setCookieHeader("t", {});
    expect(plain).toContain("HttpOnly");
    expect(plain).toContain("SameSite=Lax");
    expect(plain).toContain(`Max-Age=${30 * 86400}`);
    expect(plain).not.toContain("Secure");
    expect(setCookieHeader("t", { "x-forwarded-proto": "https" })).toContain("; Secure");
  });

  it("only redirects back to paths on the studio", () => {
    expect(safeNext("/app/video/motion?prompt=x")).toBe("/app/video/motion?prompt=x");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("/login")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });

  it("allows 10 tries per 10 minutes per address", () => {
    const rl = new RateLimiter(10, 600_000);
    for (let i = 0; i < 10; i++) expect(rl.hit("ip", 1000 + i)).toBe(true);
    expect(rl.hit("ip", 2000)).toBe(false);
    expect(rl.hit("other", 2000)).toBe(true);
    expect(rl.hit("ip", 1000 + 600_001)).toBe(true);
  });
});

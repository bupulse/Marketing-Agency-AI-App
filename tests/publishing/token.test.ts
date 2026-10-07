import { beforeEach, describe, expect, it } from "vitest";
import { createMarkPostedToken, readMarkPostedToken } from "@/lib/publishing/token";

describe("mark-as-posted token", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "test-key-for-tokens";
  });

  it("round-trips a post id", async () => {
    const token = await createMarkPostedToken("post_123");
    expect(await readMarkPostedToken(token)).toBe("post_123");
  });

  it("rejects a changed id, a changed signature and garbage", async () => {
    const token = await createMarkPostedToken("post_123");
    const [, expires, signature] = token.split(".");
    expect(await readMarkPostedToken(`post_999.${expires}.${signature}`)).toBeNull();
    expect(await readMarkPostedToken(`post_123.${expires}.${signature.slice(0, -2)}xx`)).toBeNull();
    expect(await readMarkPostedToken("nope")).toBeNull();
    expect(await readMarkPostedToken("")).toBeNull();
  });

  it("expires after 30 days and does not verify under another key", async () => {
    const issued = new Date("2026-01-01T00:00:00Z");
    const token = await createMarkPostedToken("post_123", issued);
    expect(await readMarkPostedToken(token, new Date("2026-01-20T00:00:00Z"))).toBe("post_123");
    expect(await readMarkPostedToken(token, new Date("2026-03-01T00:00:00Z"))).toBeNull();
    process.env.ENCRYPTION_KEY = "another-key";
    expect(await readMarkPostedToken(token, issued)).toBeNull();
  });
});

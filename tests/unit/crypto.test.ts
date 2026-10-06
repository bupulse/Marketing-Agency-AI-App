import { beforeEach, describe, expect, it } from "vitest";
import { decrypt, encrypt, needsReencryption } from "@/lib/crypto";

const keyA = Buffer.alloc(32, 1).toString("base64");
const keyB = Buffer.alloc(32, 2).toString("base64");

describe("crypto", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = keyA;
    delete process.env.ENCRYPTION_KEY_ID;
    delete process.env.ENCRYPTION_KEY_1;
  });

  it("round-trips and uses the versioned format", async () => {
    const payload = await encrypt("secret-token");
    expect(payload).toMatch(/^v1:1:[^:]+:[^:]+$/);
    expect(payload).not.toContain("secret-token");
    expect(await decrypt(payload)).toBe("secret-token");
  });

  it("uses a fresh iv each time", async () => {
    expect(await encrypt("same")).not.toBe(await encrypt("same"));
  });

  it("rejects tampered or malformed payloads", async () => {
    const payload = await encrypt("secret");
    const parts = payload.split(":");
    parts[3] = Buffer.from("tampered-ciphertext-bytes").toString("base64");
    await expect(decrypt(parts.join(":"))).rejects.toThrow();
    await expect(decrypt("v9:1:a:b")).rejects.toThrow();
    await expect(decrypt("garbage")).rejects.toThrow();
  });

  it("decrypts old payloads after key rotation", async () => {
    const old = await encrypt("legacy");
    process.env.ENCRYPTION_KEY_ID = "2";
    process.env.ENCRYPTION_KEY_1 = keyA;
    process.env.ENCRYPTION_KEY = keyB;
    expect(await decrypt(old)).toBe("legacy");
    expect(needsReencryption(old)).toBe(true);
    const fresh = await encrypt("legacy");
    expect(fresh.startsWith("v1:2:")).toBe(true);
    expect(needsReencryption(fresh)).toBe(false);
  });

  it("fails when the key is missing or the wrong size", async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    await expect(encrypt("x")).rejects.toThrow(/32 bytes/);
    delete process.env.ENCRYPTION_KEY;
    await expect(encrypt("x")).rejects.toThrow(/not set/);
  });
});

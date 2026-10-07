import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSignedRequest } from "@/app/api/meta/data-deletion/signed-request";

const secret = "test-app-secret";

function sign(payload: object, key = secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", key).update(body).digest("base64url");
  return `${sig}.${body}`;
}

describe("parseSignedRequest", () => {
  it("returns the payload for a correctly signed request", async () => {
    const result = await parseSignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: "12345" }), secret);
    expect(result?.user_id).toBe("12345");
  });

  it("rejects a request signed with another secret", async () => {
    expect(await parseSignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: "1" }, "other"), secret)).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const [sig] = sign({ algorithm: "HMAC-SHA256", user_id: "1" }).split(".");
    const forged = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "2" })).toString("base64url");
    expect(await parseSignedRequest(`${sig}.${forged}`, secret)).toBeNull();
  });

  it("rejects a request issued more than 24 hours ago, accepts a recent or undated one", async () => {
    const now = Date.now();
    const at = (ageSeconds: number) => sign({ algorithm: "HMAC-SHA256", user_id: "1", issued_at: Math.floor(now / 1000) - ageSeconds });
    expect(await parseSignedRequest(at(3600), secret, now)).not.toBeNull();
    expect(await parseSignedRequest(at(25 * 3600), secret, now)).toBeNull();
    expect(await parseSignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: "1" }), secret, now)).not.toBeNull();
  });

  it("rejects malformed input and unknown algorithms", async () => {
    expect(await parseSignedRequest("nodot", secret)).toBeNull();
    expect(await parseSignedRequest("a.b.c", secret)).toBeNull();
    expect(await parseSignedRequest(sign({ algorithm: "HMAC-SHA1", user_id: "1" }), secret)).toBeNull();
    expect(await parseSignedRequest(sign({ algorithm: "HMAC-SHA256" }), secret)).toBeNull();
  });
});

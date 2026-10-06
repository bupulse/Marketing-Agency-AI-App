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
  it("returns the payload for a correctly signed request", () => {
    const result = parseSignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: "12345" }), secret);
    expect(result?.user_id).toBe("12345");
  });

  it("rejects a request signed with another secret", () => {
    expect(parseSignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: "1" }, "other"), secret)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const [sig] = sign({ algorithm: "HMAC-SHA256", user_id: "1" }).split(".");
    const forged = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "2" })).toString("base64url");
    expect(parseSignedRequest(`${sig}.${forged}`, secret)).toBeNull();
  });

  it("rejects malformed input and unknown algorithms", () => {
    expect(parseSignedRequest("nodot", secret)).toBeNull();
    expect(parseSignedRequest("a.b.c", secret)).toBeNull();
    expect(parseSignedRequest(sign({ algorithm: "HMAC-SHA1", user_id: "1" }), secret)).toBeNull();
    expect(parseSignedRequest(sign({ algorithm: "HMAC-SHA256" }), secret)).toBeNull();
  });
});

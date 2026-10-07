import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteMetaConnections: vi.fn(),
  prisma: { contactRequest: { create: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/social/meta-callbacks", () => ({ deleteMetaConnections: mocks.deleteMetaConnections }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => { throw new Error("no"); } }));

import { POST as deletion } from "@/app/api/meta/data-deletion/route";
import { POST as deauthorize } from "@/app/api/meta/deauthorize/route";

function sign(payload: object, secret: string) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${createHmac("sha256", secret).update(body).digest("base64url")}.${body}`;
}
function form(signed?: string) {
  const data = new FormData();
  if (signed) data.set("signed_request", signed);
  return new Request("https://bupulse.test/api/meta/x", { method: "POST", body: data });
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.FACEBOOK_APP_SECRET = "fb-secret";
  process.env.INSTAGRAM_APP_SECRET = "ig-secret";
  delete process.env.META_APP_SECRET;
  mocks.deleteMetaConnections.mockResolvedValue(2);
});

describe("data deletion callback", () => {
  it("verifies the signature, deletes that user's connections and returns url and confirmation code", async () => {
    const response = await deletion(form(sign({ algorithm: "HMAC-SHA256", user_id: "555" }, "fb-secret")));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.confirmation_code).toMatch(/^[0-9a-f]{16}$/);
    expect(body.url).toContain(`/data-deletion?code=${body.confirmation_code}`);
    expect(mocks.deleteMetaConnections).toHaveBeenCalledWith("555");
    expect(mocks.prisma.contactRequest.create.mock.calls[0][0].data).toMatchObject({ kind: "meta_data_deletion", handled: true });
  });

  it("also accepts requests signed by the Instagram app secret", async () => {
    expect((await deletion(form(sign({ algorithm: "HMAC-SHA256", user_id: "1" }, "ig-secret")))).status).toBe(200);
  });

  it("rejects forged, missing and wrongly signed requests without deleting anything", async () => {
    expect((await deletion(form(sign({ algorithm: "HMAC-SHA256", user_id: "555" }, "attacker")))).status).toBe(400);
    expect((await deletion(form())).status).toBe(400);
    expect((await deletion(form("garbage"))).status).toBe(400);
    expect(mocks.deleteMetaConnections).not.toHaveBeenCalled();
  });

  it("answers 503 when no Meta secret is configured", async () => {
    delete process.env.FACEBOOK_APP_SECRET;
    delete process.env.INSTAGRAM_APP_SECRET;
    expect((await deletion(form(sign({ user_id: "1" }, "x")))).status).toBe(503);
  });
});

describe("deauthorize callback", () => {
  it("removes the user's connections after verifying the signature", async () => {
    expect((await deauthorize(form(sign({ algorithm: "HMAC-SHA256", user_id: "777" }, "fb-secret")))).status).toBe(200);
    expect(mocks.deleteMetaConnections).toHaveBeenCalledWith("777");
  });

  it("ignores forged requests", async () => {
    expect((await deauthorize(form(sign({ user_id: "777" }, "nope")))).status).toBe(400);
    expect(mocks.deleteMetaConnections).not.toHaveBeenCalled();
  });
});

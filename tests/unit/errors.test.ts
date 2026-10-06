import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ prisma: { errorLog: { create } } }));

import { logError, redact } from "@/lib/errors";

describe("redact", () => {
  it("replaces secret-looking keys at any depth", () => {
    expect(
      redact({
        route: "/api/x",
        accessToken: "abc",
        nested: { apiKey: "k", Authorization: "Bearer z", ok: 1 },
        list: [{ password: "p" }],
      }),
    ).toEqual({
      route: "/api/x",
      accessToken: "[redacted]",
      nested: { apiKey: "[redacted]", Authorization: "[redacted]", ok: 1 },
      list: [{ password: "[redacted]" }],
    });
  });
});

describe("logError", () => {
  beforeEach(() => {
    create.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("writes the error with redacted context", async () => {
    create.mockResolvedValue({});
    await logError(new Error("boom"), {
      source: "api/test",
      userId: "u1",
      refreshToken: "secret",
      extra: 1,
    });
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      level: "error",
      source: "api/test",
      message: "boom",
      userId: "u1",
      context: { refreshToken: "[redacted]", extra: 1 },
    });
    expect(data.stack).toContain("boom");
  });

  it("never throws when the database write fails", async () => {
    create.mockRejectedValue(new Error("db down"));
    await expect(logError("oops", { source: "x" })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { analyticsEvent: { create: (...a: unknown[]) => create(...a) } } }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => { throw new Error("no worker"); } }));

import { trackEvent } from "@/lib/analytics/events";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("trackEvent", () => {
  beforeEach(() => {
    create.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns nothing and writes the event in the background", async () => {
    create.mockResolvedValue({});
    const out = trackEvent("signup", { userId: "11111111-1111-4111-8111-111111111111", businessId: "b1", sessionId: "abcdef123456", props: { method: "PASSWORD" } });
    expect(out).toBeUndefined();
    await flush();
    expect(create).toHaveBeenCalledWith({
      data: { name: "signup", userId: "11111111-1111-4111-8111-111111111111", businessId: "b1", sessionId: "abcdef123456", props: { method: "PASSWORD" } },
    });
  });

  it("never throws when the database rejects", async () => {
    create.mockRejectedValue(new Error("db down"));
    expect(() => trackEvent("x")).not.toThrow();
    await flush();
  });

  it("never throws when the database throws synchronously", async () => {
    create.mockImplementation(() => { throw new Error("sync boom"); });
    expect(() => trackEvent("x", { props: { a: 1 } })).not.toThrow();
    await flush();
  });

  it("drops a malformed user id and session id instead of failing", async () => {
    create.mockResolvedValue({});
    trackEvent("x", { userId: "not-a-uuid", sessionId: "no way" });
    await flush();
    expect(create.mock.calls[0][0].data).toMatchObject({ userId: null, sessionId: null });
  });

  it("does not wait for the write", () => {
    create.mockReturnValue(new Promise(() => {})); // never resolves
    expect(() => trackEvent("slow")).not.toThrow();
  });
});

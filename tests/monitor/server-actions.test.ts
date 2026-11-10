import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ me: vi.fn(), rateLimit: vi.fn(), checkOnce: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/lib/support/app-auth", () => ({ requireSupportAgentPage: h.me }));
vi.mock("@/lib/rate-limit", () => {
  class RateLimitError extends Error {
    constructor(public retryAfterSeconds: number) {
      super("Too many requests");
    }
  }
  return { RateLimitError, rateLimit: h.rateLimit };
});
vi.mock("@/scripts/monitor/uptime-check.mjs", () => ({ checkOnce: h.checkOnce }));
vi.mock("@/lib/monitor/manual-check", () => ({ dispatchOutsideCheck: h.dispatch }));

import { runCheckNow } from "@/app/support/(app)/server/actions";
import { RateLimitError } from "@/lib/rate-limit";

const result = { ok: true, statusCode: 200, statusMs: 180, databaseMs: 30, version: "1.4.2", pages: [{ path: "/", status: 200, ms: 600 }] };

describe("Run a check now (server action)", () => {
  afterAll(() => {
    delete process.env.PUBLIC_LINK_URL;
  });
  beforeEach(() => {
    for (const f of Object.values(h)) f.mockReset();
    h.checkOnce.mockResolvedValue(result);
    h.dispatch.mockResolvedValue("not-set-up");
    process.env.PUBLIC_LINK_URL = "https://bupulse.com";
  });

  it("an agent cannot run it, and nothing is checked", async () => {
    h.me.mockResolvedValue({ id: "a1", role: "AGENT" });
    expect(await runCheckNow()).toEqual({ error: "Only technical staff and supervisors can run a check." });
    expect(h.checkOnce).not.toHaveBeenCalled();
    expect(h.rateLimit).not.toHaveBeenCalled();
  });

  it.each(["TECH", "SUPERVISOR"])("%s gets the result, the outside check is asked for too", async (role) => {
    h.me.mockResolvedValue({ id: "a1", role });
    const out = await runCheckNow();
    expect(h.rateLimit).toHaveBeenCalledWith("support:server-check:a1", { limit: 1, windowSeconds: 30 });
    expect(h.checkOnce).toHaveBeenCalledWith("https://bupulse.com");
    expect(out.result).toMatchObject({ ...result, site: "bupulse.com", outside: "not-set-up" });
  });

  it("once every 30 seconds per person", async () => {
    h.me.mockResolvedValue({ id: "a1", role: "TECH" });
    h.rateLimit.mockRejectedValue(new RateLimitError(21));
    expect(await runCheckNow()).toEqual({ error: "A check just ran. Try again in 21 seconds." });
    expect(h.checkOnce).not.toHaveBeenCalled();
  });
});

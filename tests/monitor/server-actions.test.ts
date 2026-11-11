import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ me: vi.fn(), rateLimit: vi.fn(), checkOnce: vi.fn(), dispatch: vi.fn(), find: vi.fn(), del: vi.fn(), audit: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("@/lib/request-limits", () => ({ requestIp: async () => null }));
vi.mock("@/lib/admin/audit", () => ({ writeAudit: h.audit }));
vi.mock("@/lib/db", () => {
  const tx = { uptimeIncident: { delete: h.del } };
  return { prisma: { uptimeIncident: { findUnique: h.find, delete: h.del }, $transaction: async (run: (t: typeof tx) => Promise<unknown>) => run(tx) } };
});
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

import { removeOutageAction, runCheckNow } from "@/app/support/(app)/server/actions";
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

describe("Remove a false outage (server action)", () => {
  const row = { id: "cmoutage000001", startedAt: new Date("2026-11-10T15:50:00Z"), endedAt: new Date("2026-11-10T20:47:00Z"), minutes: 297, reason: "long-gap" };
  const form = (id: string) => {
    const f = new FormData();
    f.set("id", id);
    return f;
  };
  beforeEach(() => {
    for (const f of Object.values(h)) f.mockReset();
    h.find.mockResolvedValue(row);
  });

  it("admin@bupulse.com removes it, with the removed outage in the audit log", async () => {
    h.me.mockResolvedValue({ id: "own", role: "SUPERVISOR", owner: true, email: "admin@bupulse.com" });
    await removeOutageAction(form(row.id));
    expect(h.del).toHaveBeenCalledWith({ where: { id: row.id } });
    expect(h.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actor: "support:admin@bupulse.com" }), "uptime_incident_remove", `uptime_incident:${row.id}`, expect.objectContaining({ minutes: 297 }), null);
    expect(h.revalidate).toHaveBeenCalledWith("/support/server");
  });

  it("nobody else can, and a bad id does nothing", async () => {
    h.me.mockResolvedValue({ id: "t1", role: "TECH", owner: false, email: "tech@example.com" });
    await removeOutageAction(form(row.id));
    h.me.mockResolvedValue({ id: "own", role: "SUPERVISOR", owner: true, email: "admin@bupulse.com" });
    await removeOutageAction(form("../x"));
    expect(h.del).not.toHaveBeenCalled();
  });
});

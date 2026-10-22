import { beforeEach, describe, expect, it, vi } from "vitest";

// The start-trial and custom plan call actions are public POST endpoints: a few tries an hour per company, then a
// friendly message; the ICS route serves only live, recent bookings to a few dozen requests an hour per address.

const h = vi.hoisted(() => ({
  requireActiveUser: vi.fn(),
  rateLimit: vi.fn(async () => undefined),
  startOwnTrial: vi.fn(async () => ({ status: "TRIALING" })),
  bookDemo: vi.fn(),
  cancelDemo: vi.fn(),
  bookPlanCall: vi.fn(),
  cancelPlanCall: vi.fn(),
  findUnique: vi.fn(),
  bookingIcs: vi.fn(async () => "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"),
}));

class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super("Too many requests");
  }
}

vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: h.requireActiveUser }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: h.rateLimit, RateLimitError, rateLimitMessage: (e: RateLimitError) => `You're doing that a lot. Please try again in ${Math.ceil(e.retryAfterSeconds / 60)} minutes.` }));
vi.mock("@/lib/demo/bookings", () => {
  class DemoError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  }
  return { DemoError, bookDemo: h.bookDemo, cancelDemo: h.cancelDemo, bookingIcs: h.bookingIcs };
});
vi.mock("@/lib/trial/start", () => {
  class TrialError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  }
  return { TrialError, startOwnTrial: h.startOwnTrial };
});
vi.mock("@/lib/demo/plan-calls", () => ({ bookPlanCall: h.bookPlanCall, cancelPlanCall: h.cancelPlanCall }));
vi.mock("@/lib/db", () => ({ prisma: { demoBooking: { findUnique: h.findUnique } } }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "cf-connecting-ip": "203.0.113.9" }) }));

const OWNER = { id: "u1", actorId: "u1", role: "OWNER", businessId: "b1", email: "o@x.rw", email_confirmed_at: "2026-10-01T00:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  h.requireActiveUser.mockResolvedValue(OWNER);
  h.rateLimit.mockResolvedValue(undefined);
});

describe("start trial and custom plan call actions", () => {
  it("start trial: owner or admin (settings), one hit per company, then the service; the dashboard opens next", async () => {
    const a = { ...(await import("@/app/start-trial/actions")), ...(await import("@/lib/demo/limits")) };
    const f = new FormData();
    f.set("plan", "STARTER");
    await expect(a.startTrialAction({}, f)).rejects.toThrow("NEXT_REDIRECT /dashboard");
    expect(h.requireActiveUser).toHaveBeenCalledWith("settings");
    expect(h.rateLimit).toHaveBeenCalledWith("demo:trial:b1", a.DEMO_LIMITS.trial);
    expect(h.startOwnTrial).toHaveBeenCalledWith({ businessId: "b1", actorId: "u1", planKey: "STARTER", ip: "203.0.113.9" });
    h.rateLimit.mockRejectedValueOnce(new RateLimitError(600));
    expect(await a.startTrialAction({}, f)).toEqual({ error: "You're doing that a lot. Please try again in 10 minutes." });
    expect(h.startOwnTrial).toHaveBeenCalledTimes(1);
  });

  it("start trial: a teammate without the settings permission never reaches the service", async () => {
    const { startTrialAction } = await import("@/app/start-trial/actions");
    h.requireActiveUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT /dashboard/no-access?need=settings"));
    const f = new FormData();
    f.set("plan", "STARTER");
    await expect(startTrialAction({}, f)).rejects.toThrow("no-access");
    expect(h.rateLimit).not.toHaveBeenCalled();
    expect(h.startOwnTrial).not.toHaveBeenCalled();
  });

  it("start trial: the service's refusal in words; an already started trial goes to the dashboard; anything else is generic", async () => {
    const { startTrialAction } = await import("@/app/start-trial/actions");
    const { TrialError } = await import("@/lib/trial/start");
    const f = new FormData();
    f.set("plan", "PRO");
    h.startOwnTrial.mockRejectedValueOnce(new TrialError("not_in_region", "Choose one of the plans shown."));
    expect(await startTrialAction({}, f)).toEqual({ error: "Choose one of the plans shown." });
    // A second tap, or another tab: the first one started it, so this one opens the dashboard too.
    h.startOwnTrial.mockRejectedValueOnce(new TrialError("not_pending", "Your free trial has already started."));
    await expect(startTrialAction({}, f)).rejects.toThrow("NEXT_REDIRECT /dashboard");
    h.startOwnTrial.mockRejectedValueOnce(new TrialError("changed", "Your account changed while starting the trial. Reload the page."));
    await expect(startTrialAction({}, f)).rejects.toThrow("NEXT_REDIRECT /dashboard");
    h.startOwnTrial.mockRejectedValueOnce(new Error("database down"));
    expect(await startTrialAction({}, f)).toEqual({ error: "Something went wrong. Nothing was changed. Please try again." });
  });

  it("the custom plan call: the owner (billing) with a confirmed email, the demo's limits, linked to the request", async () => {
    const a = { ...(await import("@/app/custom-plan/call/actions")), ...(await import("@/lib/demo/limits")) };
    const b = new FormData();
    b.set("startsAt", "2026-10-13T08:00:00.000Z");
    b.set("request", "req1");
    h.bookPlanCall.mockResolvedValue({ rescheduled: false });
    await expect(a.bookPlanCallAction({}, b)).rejects.toThrow("NEXT_REDIRECT /custom-plan/call?booked=1");
    h.bookPlanCall.mockResolvedValueOnce({ rescheduled: true });
    await expect(a.bookPlanCallAction({}, b)).rejects.toThrow("NEXT_REDIRECT /custom-plan/call?moved=1");
    expect(h.requireActiveUser).toHaveBeenCalledWith("billing");
    expect(h.bookPlanCall).toHaveBeenCalledWith({ businessId: "b1", startsAt: new Date("2026-10-13T08:00:00.000Z"), requestId: "req1" });
    expect(h.rateLimit).toHaveBeenCalledWith("demo:book:b1", a.DEMO_LIMITS.book);
    expect(h.bookDemo).not.toHaveBeenCalled();
    h.rateLimit.mockRejectedValueOnce(new RateLimitError(60));
    expect(await a.bookPlanCallAction({}, b)).toMatchObject({ error: expect.stringMatching(/doing that a lot/) });
    const bad = new FormData();
    bad.set("startsAt", "soon");
    expect(await a.bookPlanCallAction({}, bad)).toEqual({ error: "Pick a time from the list." });
    const { DemoError } = await import("@/lib/demo/bookings");
    h.bookPlanCall.mockRejectedValueOnce(new DemoError("conflict", "That time is no longer free. Pick another one."));
    expect(await a.bookPlanCallAction({}, b)).toEqual({ error: "That time is no longer free. Pick another one." });
    h.requireActiveUser.mockResolvedValue({ ...OWNER, email_confirmed_at: undefined });
    expect(await a.bookPlanCallAction({}, b)).toEqual({ error: expect.stringMatching(/Confirm your email/) });
    expect(h.bookPlanCall).toHaveBeenCalledTimes(3);

    h.requireActiveUser.mockResolvedValue(OWNER);
    expect(await a.cancelPlanCallAction()).toEqual({ ok: true });
    expect(h.cancelPlanCall).toHaveBeenCalledWith({ businessId: "b1" });
    expect(h.rateLimit).toHaveBeenCalledWith("demo:cancel:b1", a.DEMO_LIMITS.cancel);
    expect(h.cancelDemo).not.toHaveBeenCalled();
    h.requireActiveUser.mockRejectedValueOnce(new Error("forbidden"));
    expect(await a.cancelPlanCallAction()).toEqual({ ok: false, error: "Ask your company owner to do this." });
  });

  it("no \"use server\" file exports anything but async functions (each export is a public endpoint)", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(__dirname, "..", "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== "node_modules" && name !== "generated" && !name.startsWith(".")) walk(full);
        } else if (/\.(ts|tsx)$/.test(name)) files.push(full);
      }
    };
    for (const dir of ["app", "components", "lib"]) walk(join(root, dir));
    const bad: string[] = [];
    let serverFiles = 0;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (!/^\s*["']use server["'];?/.test(text)) continue;
      serverFiles++;
      for (const line of text.split("\n")) {
        if (!line.startsWith("export ")) continue;
        if (/^export (type|interface) /.test(line) || /^export async function /.test(line)) continue;
        bad.push(`${file.slice(root.length + 1)}: ${line.slice(0, 80)}`);
      }
    }
    expect(serverFiles).toBeGreaterThan(30);
    expect(bad).toEqual([]);
  });
});

describe("the .ics route", () => {
  const route = () => import("@/app/api/demo/ics/[token]/route");
  const get = async (token: string, ip = "203.0.113.5") => {
    const { GET } = await route();
    const { NextRequest } = await import("next/server");
    return GET(new NextRequest(`https://bupulse.test/api/demo/ics/${token}`, { headers: { "cf-connecting-ip": ip } }), { params: Promise.resolve({ token }) });
  };
  const TOKEN = "A".repeat(43);
  const booking = (over: Record<string, unknown> = {}) => ({ id: "bk1", status: "booked", startsAt: new Date(Date.now() + 3_600_000), endsAt: new Date(Date.now() + 5_400_000), icsToken: TOKEN, business: { name: "Inzu", user: { email: "a@b.rw", name: "Aline" } }, ...over });

  it("serves a live booking's invite (the client's copy), and 404 for a bad token, a cancelled or an old booking", async () => {
    h.findUnique.mockResolvedValue(booking());
    const ok = await get(TOKEN);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/calendar");
    expect(h.bookingIcs).toHaveBeenCalledWith(expect.objectContaining({ id: "bk1" }), { name: "Inzu", email: "a@b.rw", contact: "Aline" }, "client");
    expect((await get("short")).status).toBe(404);
    h.findUnique.mockResolvedValue(null);
    expect((await get(TOKEN)).status).toBe(404);
    h.findUnique.mockResolvedValue(booking({ status: "cancelled" }));
    expect((await get(TOKEN)).status).toBe(404);
    h.findUnique.mockResolvedValue(booking({ status: "done" }));
    expect((await get(TOKEN)).status).toBe(404);
    h.findUnique.mockResolvedValue(booking({ startsAt: new Date(Date.now() - 3 * 86_400_000), endsAt: new Date(Date.now() - 2 * 86_400_000) }));
    expect((await get(TOKEN)).status).toBe(404);
    // Ended a few hours ago: still served (people add it to their calendar late).
    h.findUnique.mockResolvedValue(booking({ startsAt: new Date(Date.now() - 7_200_000), endsAt: new Date(Date.now() - 3_600_000) }));
    expect((await get(TOKEN)).status).toBe(200);
  });

  it("is rate limited per address", async () => {
    const { ICS_RATE_LIMIT } = await import("@/lib/demo/ics-config");
    h.findUnique.mockResolvedValue(booking());
    await get(TOKEN, "198.51.100.7");
    expect(h.rateLimit).toHaveBeenCalledWith("demo-ics:198.51.100.7", ICS_RATE_LIMIT);
    h.rateLimit.mockRejectedValueOnce(new RateLimitError(900));
    const limited = await get(TOKEN, "198.51.100.7");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("900");
    expect(h.findUnique).toHaveBeenCalledTimes(1);
  });
});

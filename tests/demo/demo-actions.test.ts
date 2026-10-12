import { beforeEach, describe, expect, it, vi } from "vitest";

// The demo actions are public POST endpoints: a few tries an hour per company, then a friendly message; the ICS route
// serves only live, recent bookings to a few dozen requests an hour per address.

const h = vi.hoisted(() => ({
  requireActiveUser: vi.fn(),
  rateLimit: vi.fn(async () => undefined),
  choosePlan: vi.fn(),
  bookDemo: vi.fn(),
  cancelDemo: vi.fn(),
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
  return { DemoError, choosePlan: h.choosePlan, bookDemo: h.bookDemo, cancelDemo: h.cancelDemo, bookingIcs: h.bookingIcs };
});
vi.mock("@/lib/db", () => ({ prisma: { demoBooking: { findUnique: h.findUnique } } }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); } }));

const OWNER = { id: "u1", actorId: "u1", role: "OWNER", businessId: "b1", email: "o@x.rw" };

beforeEach(() => {
  vi.clearAllMocks();
  h.requireActiveUser.mockResolvedValue(OWNER);
  h.rateLimit.mockResolvedValue(undefined);
});

describe("demo actions", () => {
  it("count one hit per company and kind, and answer in words when the limit is reached (nothing runs)", async () => {
    const a = await import("@/app/book-demo/actions");
    const f = new FormData();
    f.set("plan", "STARTER");
    await expect(a.choosePlanAction({}, f)).rejects.toThrow("NEXT_REDIRECT /book-demo?step=time");
    expect(h.rateLimit).toHaveBeenCalledWith("demo:choose:b1", a.DEMO_LIMITS.choose);
    expect(h.choosePlan).toHaveBeenCalledWith({ businessId: "b1", planKey: "STARTER" });
    h.rateLimit.mockRejectedValueOnce(new RateLimitError(600));
    expect(await a.choosePlanAction({}, f)).toEqual({ error: "You're doing that a lot. Please try again in 10 minutes." });
    expect(h.choosePlan).toHaveBeenCalledTimes(1);

    const b = new FormData();
    b.set("startsAt", "2026-10-13T08:00:00.000Z");
    await expect(a.bookDemoAction({}, b)).rejects.toThrow("NEXT_REDIRECT /dashboard?demo=booked");
    expect(h.rateLimit).toHaveBeenCalledWith("demo:book:b1", a.DEMO_LIMITS.book);
    h.rateLimit.mockRejectedValueOnce(new RateLimitError(60));
    expect(await a.bookDemoAction({}, b)).toMatchObject({ error: expect.stringMatching(/doing that a lot/) });
    expect(h.bookDemo).toHaveBeenCalledTimes(1);

    const c = await import("@/app/dashboard/demo/actions");
    expect(await c.cancelDemoAction()).toEqual({ ok: true });
    expect(h.rateLimit).toHaveBeenCalledWith("demo:cancel:b1", a.DEMO_LIMITS.cancel);
    h.rateLimit.mockRejectedValueOnce(new RateLimitError(60));
    expect(await c.cancelDemoAction()).toMatchObject({ ok: false, error: expect.stringMatching(/doing that a lot/) });
    expect(h.cancelDemo).toHaveBeenCalledTimes(1);
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
    const { ICS_RATE_LIMIT } = await route();
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

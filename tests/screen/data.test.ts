import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    user: { count: vi.fn() },
    billingEvent: { findMany: vi.fn(), findFirst: vi.fn() },
    subscription: { findMany: vi.fn() },
    staffMember: { findMany: vi.fn() },
    business: { findMany: vi.fn() },
    $queryRaw: vi.fn(async () => [] as unknown[]),
  },
  getLeaderboard: vi.fn(),
  agentForPayment: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/admin/settings", async (orig) => ({ ...(await orig<typeof import("@/lib/admin/settings")>()), getSetting: async () => 14 }));
vi.mock("@/lib/screen/sounds", () => ({ activeSoundUrls: async () => [{ id: "s1", url: "https://x.supabase.co/storage/v1/object/sign/sounds/a.mp3?token=t" }] }));
vi.mock("@/lib/sales/attribution", () => ({
  getLeaderboard: h.getLeaderboard,
  agentForPayment: h.agentForPayment,
  monthOf: (d: Date) => d.toISOString().slice(0, 7),
  // Like the real one: the name, else the email's local part.
  staffName: (s: { name: string | null; email: string }) => s.name?.trim() || s.email.split("@")[0],
}));

import { loadSnapshot, newPayments, screenData } from "@/lib/screen/data";
import { advanceCursor, formatCursor, isAfter, kigaliDayStart, parseCursor, screenName } from "@/lib/screen/shared";

const momo = (id: string, at: string, usdCents: number, userId = "u1") => ({
  id,
  eventId: `e-${id}`,
  type: "manual_payment.confirmed",
  payload: { data: { id: `mp-${id}`, usd_cents: usdCents, amount_minor: usdCents * 13, currency: "RWF", network: "MTN" } },
  createdAt: new Date(at),
  userId,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.user.count.mockResolvedValue(4);
  h.prisma.billingEvent.findMany.mockResolvedValue([]);
  h.prisma.billingEvent.findFirst.mockResolvedValue(null);
  h.prisma.subscription.findMany.mockResolvedValue([]);
  h.prisma.staffMember.findMany.mockResolvedValue([]);
  h.prisma.business.findMany.mockResolvedValue([]);
  h.getLeaderboard.mockResolvedValue([]);
  h.agentForPayment.mockResolvedValue(null);
});

describe("what the screen shows", () => {
  it("never contains an email address or a phone number", async () => {
    const now = new Date();
    h.prisma.subscription.findMany.mockResolvedValue([
      { trialEndsAt: new Date(now.getTime() + 3 * 86_400_000), user: { business: { name: "owner@shop.rw", salesAgentId: "s1" } } },
      { trialEndsAt: new Date(now.getTime() + 86_400_000), user: { business: { name: "Call 0788 123 456", salesAgentId: "s2" } } },
      { trialEndsAt: new Date(now.getTime() + 86_400_000), user: { business: { name: "Kigali Salon", salesAgentId: null } } },
    ]);
    h.prisma.staffMember.findMany.mockResolvedValue([
      { id: "s1", name: "jane@bupulse.com", email: "jane@bupulse.com" },
      { id: "s2", name: null, email: "eric@bupulse.com" },
    ]);
    h.getLeaderboard.mockResolvedValue([{ staffId: "s1", name: "+250 788 123 456", ownCents: 100, teamShareCents: 0, totalCents: 100, clients: 1 }]);
    h.prisma.billingEvent.findMany.mockResolvedValue([momo("b1", now.toISOString(), 5000)]);
    h.prisma.business.findMany.mockResolvedValue([{ userId: "u1", name: "boss@client.com" }]);
    h.agentForPayment.mockResolvedValue({ staffId: "s1", name: "jane@bupulse.com" });

    const data = await screenData("1_");
    const text = JSON.stringify({ ...data, sounds: [] });
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/0788|788 123/);
    expect(data.trials.map((t) => t.company)).toEqual(["A new client", "A new client", "Kigali Salon"]);
    expect(data.trials.map((t) => t.agent)).toEqual([null, "eric", null]);
    expect(data.leaderboard[0].agent).toBe("Agent");
    expect(data.celebrations[0]).toMatchObject({ client: "A new client", usdCents: 5000, agent: "Agent" });
    // Only what the screen needs: no ids of users, companies or staff.
    expect(text).not.toMatch(/"u1"|"s1"|userId|staffId|email|phone/);
  });

  it("counts active users in the last 5 minutes and since midnight in Kigali, and sums today's and this month's revenue", async () => {
    const now = new Date("2026-10-13T08:00:00Z");
    h.prisma.billingEvent.findMany.mockResolvedValue([momo("a", "2026-10-02T09:00:00Z", 1000), momo("b", "2026-10-13T07:00:00Z", 2500), momo("c", "2026-09-30T09:00:00Z", 999)]);
    const snap = await loadSnapshot(now);
    // With the RWF actually paid (exact on the TV when the default currency is RWF).
    expect(snap.revenue).toEqual({ todayCents: 2500, monthCents: 3500, todayRwfMinor: 32500, todayRwfUsdCents: 2500, monthRwfMinor: 45500, monthRwfUsdCents: 3500 });
    const [nowCall, todayCall] = h.prisma.user.count.mock.calls.map((c) => c[0].where.lastSeenAt.gte.toISOString());
    expect(nowCall).toBe("2026-10-13T07:55:00.000Z");
    expect(todayCall).toBe("2026-10-12T22:00:00.000Z");
    expect(kigaliDayStart(new Date("2026-10-12T23:30:00Z")).toISOString()).toBe("2026-10-12T22:00:00.000Z");
  });

  it("shapes the charts from the same rows: revenue per day, sign-ups from one grouped query, trial lengths", async () => {
    const now = new Date("2026-10-13T08:00:00Z");
    h.prisma.billingEvent.findMany.mockResolvedValue([momo("a", "2026-10-02T09:00:00Z", 1000), momo("b", "2026-10-13T07:00:00Z", 2500)]);
    h.prisma.$queryRaw.mockResolvedValueOnce([{ day: new Date("2026-10-12T00:00:00Z"), count: BigInt(2) }]);
    h.prisma.subscription.findMany.mockResolvedValue([{ trialEndsAt: new Date("2026-10-16T08:00:00Z"), currentPeriodStart: new Date("2026-10-09T08:00:00Z"), user: { business: { name: "Kigali Salon", salesAgentId: null } } }]);
    const snap = await loadSnapshot(now);
    expect(snap.daily).toHaveLength(13);
    expect(snap.daily[1]).toMatchObject({ day: "2026-10-02", usdCents: 1000 });
    expect(snap.daily[12]).toMatchObject({ day: "2026-10-13", usdCents: 2500 });
    expect(snap.signups).toHaveLength(14);
    expect(snap.signups.find((d) => d.day === "2026-10-12")?.count).toBe(2);
    expect(h.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(snap.trials[0]).toMatchObject({ company: "Kigali Salon", daysLeft: 3, totalDays: 7 });
    expect(snap.goalRwf).toBe(9_000_000);
  });

  it("names are trimmed and refused when they hold contact details", () => {
    expect(screenName("  Acme   Shop ")).toBe("Acme Shop");
    expect(screenName("Shop 2026 - 2027")).toBe("Shop 2026 - 2027");
    expect(screenName("Mama's shop 0788123456")).toBeNull();
    expect(screenName("x@y.z")).toBeNull();
    expect(screenName("")).toBeNull();
  });
});

describe("new payments", () => {
  it("the first poll starts at the newest money event and celebrates nothing", async () => {
    h.prisma.billingEvent.findFirst.mockResolvedValue({ id: "b7", createdAt: new Date("2026-10-13T08:00:00Z") });
    const r = await newPayments(null);
    expect(r.celebrations).toEqual([]);
    expect(formatCursor(r.cursor)).toBe(`${Date.parse("2026-10-13T08:00:00Z")}_b7`);
    expect(h.prisma.billingEvent.findMany).not.toHaveBeenCalled();
  });

  it("celebrates payments after the cursor, oldest first, with the agent on the payment's date or the team", async () => {
    const cursor = { at: new Date("2026-10-13T08:00:00Z"), id: "b7" };
    h.prisma.billingEvent.findMany.mockResolvedValue([
      momo("b8", "2026-10-13T08:00:00Z", 1500, "u1"),
      { id: "b9", eventId: "e9", type: "adjustment.created", payload: { data: { id: "r1", action: "refund", status: "approved", payout_totals: { currency_code: "USD", earnings: 300 } } }, createdAt: new Date("2026-10-13T08:00:01Z"), userId: "u1" },
      momo("c1", "2026-10-13T08:00:02Z", 4000, "u2"),
    ]);
    h.prisma.business.findMany.mockResolvedValue([{ userId: "u1", name: "Kigali Salon" }, { userId: "u2", name: "Nyamirambo Hardware" }]);
    h.agentForPayment.mockImplementation(async (userId: string) => (userId === "u1" ? { staffId: "s1", name: "Aline" } : null));
    const r = await newPayments(cursor);
    expect(r.celebrations).toEqual([
      { id: "pay:mp-b8", client: "Kigali Salon", usdCents: 1500, localMinor: 19500, currency: "RWF", agent: "Aline" },
      { id: "pay:mp-c1", client: "Nyamirambo Hardware", usdCents: 4000, localMinor: 52000, currency: "RWF", agent: null },
    ]);
    // The refund moves the cursor on but is not celebrated; the cursor ends at the last event read.
    expect(r.cursor).toEqual({ at: new Date("2026-10-13T08:00:02Z"), id: "c1" });
    const where = h.prisma.billingEvent.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ createdAt: { gt: cursor.at } }, { createdAt: cursor.at, id: { gt: "b7" } }]);
    expect(h.agentForPayment).toHaveBeenCalledWith("u1", new Date("2026-10-13T08:00:00Z"));
  });

  it("nothing new keeps the cursor", async () => {
    const cursor = { at: new Date("2026-10-13T08:00:00Z"), id: "b7" };
    const r = await newPayments(cursor);
    expect(r).toEqual({ celebrations: [], cursor });
  });

  it("cursor rules: parse, compare, advance", () => {
    expect(parseCursor("1760000000000_abc")).toEqual({ at: new Date(1760000000000), id: "abc" });
    expect(parseCursor("1760000000000_")).toEqual({ at: new Date(1760000000000), id: "" });
    for (const bad of ["", "abc", "1_a-b", "1_" + "a".repeat(41), "x_1", null]) expect(parseCursor(bad)).toBeNull();
    const c = { at: new Date(1000), id: "m" };
    expect(isAfter({ createdAt: new Date(1000), id: "n" }, c)).toBe(true);
    expect(isAfter({ createdAt: new Date(1000), id: "m" }, c)).toBe(false);
    expect(isAfter({ createdAt: new Date(999), id: "z" }, c)).toBe(false);
    expect(advanceCursor(c, [{ createdAt: new Date(1001), id: "a" }])).toEqual({ at: new Date(1001), id: "a" });
    expect(advanceCursor(c, [])).toBe(c);
  });
});

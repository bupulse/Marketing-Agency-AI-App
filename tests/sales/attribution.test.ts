import { beforeEach, describe, expect, it, vi } from "vitest";

// Who a payment counts for, the team share and the leaderboard. Pure functions first, then the loaders on a mock.

const db = vi.hoisted(() => ({
  clientAssignment: { findFirst: vi.fn(), findMany: vi.fn() },
  staffMember: { findUnique: vi.fn(), findMany: vi.fn() },
  staffRole: { findMany: vi.fn() },
  billingEvent: { findMany: vi.fn() },
  business: { groupBy: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { agentAt, agentForPayment, getLeaderboard, leaderboard, splitEqually, type AssignmentSpan } from "@/lib/sales/attribution";
import type { RevenueEntry } from "@/lib/money/revenue-shared";

const d = (s: string) => new Date(`2026-10-${s}T12:00:00Z`);
const pay = (userId: string | null, at: Date, usdCents: number, id = `${userId}-${at.toISOString()}`): RevenueEntry => ({
  id, at, month: at.toISOString().slice(0, 7), userId, kind: usdCents < 0 ? "refund" : "payment", usdCents, method: "momo", localMinor: null, currency: "RWF", plan: null, priceId: null, partial: false,
});

// Client u1: agent A until 15 October, then B (a manager's reassignment). u2: unassigned. u3: agent A throughout.
const spans: AssignmentSpan[] = [
  { userId: "u1", staffId: "A", startsAt: d("01"), endsAt: d("15") },
  { userId: "u1", staffId: "B", startsAt: d("15"), endsAt: null },
  { userId: "u2", staffId: null, startsAt: d("01"), endsAt: null },
  { userId: "u3", staffId: "A", startsAt: d("01"), endsAt: null },
];
const agents = [
  { staffId: "A", name: "Alice" },
  { staffId: "B", name: "Bob" },
  { staffId: "C", name: "Chen" },
];

describe("agent at a payment's time", () => {
  it("follows the assignment periods: a reassignment counts from its moment, past payments stay", () => {
    expect(agentAt(spans, "u1", d("10"))).toBe("A");
    expect(agentAt(spans, "u1", d("15"))).toBe("B");
    expect(agentAt(spans, "u1", d("20"))).toBe("B");
    expect(agentAt(spans, "u2", d("20"))).toBeNull();
    expect(agentAt(spans, "u9", d("20"))).toBeNull();
    expect(agentAt(spans, "u1", new Date("2026-09-30T00:00:00Z"))).toBeNull();
  });
});

describe("team share", () => {
  it("splits equally in whole cents, leftover cents to the first", () => {
    expect(splitEqually(900, 3)).toEqual([300, 300, 300]);
    expect(splitEqually(1000, 3)).toEqual([334, 333, 333]);
    expect(splitEqually(-1000, 3)).toEqual([-334, -333, -333]);
    expect(splitEqually(500, 0)).toEqual([]);
    expect(splitEqually(1001, 3).reduce((a, b) => a + b, 0)).toBe(1001);
  });
});

describe("leaderboard", () => {
  it("credits own sales by period, splits unassigned payments, sorts by total", () => {
    const rows = leaderboard({
      entries: [pay("u1", d("10"), 2000), pay("u1", d("20"), 5000), pay("u3", d("05"), 1000), pay("u3", d("06"), -400), pay("u2", d("08"), 900), pay(null, d("09"), 300)],
      assignments: spans,
      agents,
      clients: new Map([["A", 1], ["B", 1]]),
    });
    expect(rows.map((r) => r.staffId)).toEqual(["B", "A", "C"]);
    expect(rows[0]).toMatchObject({ staffId: "B", name: "Bob", ownCents: 5000, teamShareCents: 400, totalCents: 5400, clients: 1 });
    expect(rows[1]).toMatchObject({ staffId: "A", name: "Alice", ownCents: 2600, teamShareCents: 400, totalCents: 3000, clients: 1 });
    expect(rows[2]).toMatchObject({ staffId: "C", name: "Chen", ownCents: 0, teamShareCents: 400, totalCents: 400, clients: 0 });
    // Every cent is counted once.
    expect(rows.reduce((s, r) => s + r.totalCents, 0)).toBe(2000 + 5000 + 1000 - 400 + 900 + 300);
  });

  it("puts payments of an agent who is not on the board into the team share", () => {
    const rows = leaderboard({ entries: [pay("u3", d("05"), 1000)], assignments: spans, agents: agents.slice(1) });
    expect(rows.map((r) => r.teamShareCents)).toEqual([500, 500]);
  });

  it("orders ties by name and is empty without agents", () => {
    expect(leaderboard({ entries: [], assignments: [], agents: [{ staffId: "Z", name: "Zoe" }, { staffId: "Y", name: "Amy" }] }).map((r) => r.name)).toEqual(["Amy", "Zoe"]);
    expect(leaderboard({ entries: [pay("u2", d("05"), 100)], assignments: spans, agents: [] })).toEqual([]);
  });
});

describe("loaders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("agentForPayment returns the agent assigned at that time, or null", async () => {
    db.clientAssignment.findFirst.mockResolvedValueOnce({ staffId: "A" });
    db.staffMember.findUnique.mockResolvedValueOnce({ id: "A", name: null, email: "alice@example.com" });
    expect(await agentForPayment("u1", d("10"))).toEqual({ staffId: "A", name: "alice" });
    const where = db.clientAssignment.findFirst.mock.calls[0][0].where;
    expect(where).toEqual({ userId: "u1", startsAt: { lte: d("10") }, OR: [{ endsAt: null }, { endsAt: { gt: d("10") } }] });
    db.clientAssignment.findFirst.mockResolvedValueOnce({ staffId: null });
    expect(await agentForPayment("u2", d("10"))).toBeNull();
    db.clientAssignment.findFirst.mockResolvedValueOnce(null);
    expect(await agentForPayment("u9", d("10"))).toBeNull();
  });

  it("getLeaderboard counts sales staff active that month and the month's payments only", async () => {
    db.staffMember.findMany.mockResolvedValue([
      { id: "A", name: "Alice", email: "a@x.com", roleKey: "sales_agent", status: "active", disabledAt: null },
      { id: "B", name: "Bob", email: "b@x.com", roleKey: "sales_manager", status: "invited", disabledAt: null },
      { id: "F", name: "Fay", email: "f@x.com", roleKey: "finance", status: "active", disabledAt: null },
      { id: "D", name: "Dan", email: "d@x.com", roleKey: "sales_agent", status: "disabled", disabledAt: new Date("2026-09-20T00:00:00Z") },
    ]);
    db.staffRole.findMany.mockResolvedValue([]);
    const manual = (id: string, userId: string, at: string, cents: number) => ({ eventId: id, type: "manual_payment.confirmed", createdAt: new Date(at), userId, payload: { data: { usd_cents: cents, amount_minor: cents * 14, currency: "RWF", network: "MTN", confirmed_at: at } } });
    db.billingEvent.findMany.mockResolvedValue([manual("e1", "u3", "2026-10-05T10:00:00Z", 1000), manual("e2", "u2", "2026-10-06T10:00:00Z", 600), manual("e3", "u3", "2026-09-29T10:00:00Z", 9999)]);
    db.clientAssignment.findMany.mockResolvedValue(spans);
    db.business.groupBy.mockResolvedValue([{ salesAgentId: "A", _count: { _all: 2 } }]);
    const rows = await getLeaderboard("2026-10");
    expect(rows.map((r) => r.staffId)).toEqual(["A", "B"]);
    // u3's October payment is A's; u2 (unassigned) is split; September's payment is left out. Fay (finance) and Dan
    // (disabled before October) are not on the board.
    expect(rows[0]).toMatchObject({ staffId: "A", name: "Alice", ownCents: 1000, teamShareCents: 300, totalCents: 1300, clients: 2 });
    expect(rows[1]).toMatchObject({ staffId: "B", name: "Bob", ownCents: 0, teamShareCents: 300, totalCents: 300, clients: 0 });
  });

  it("getLeaderboard is empty without sales staff", async () => {
    db.staffMember.findMany.mockResolvedValue([]);
    db.staffRole.findMany.mockResolvedValue([]);
    db.billingEvent.findMany.mockResolvedValue([]);
    expect(await getLeaderboard("bad")).toEqual([]);
  });
});

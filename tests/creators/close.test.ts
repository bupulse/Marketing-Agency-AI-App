import { beforeEach, describe, expect, it, vi } from "vitest";
import { computePeriodPay, type PayoutBreakdown } from "@/lib/creators/pay";

// closePeriod with the ledger's numbers given (periodPay) and an in-memory database: the claim that makes it run once,
// the payouts, pay taken back for posts removed after a PAID payout, and the end of the campaign.
const db = vi.hoisted(() => {
  const state = {
    period: { id: "per2", campaignId: "camp1", index: 2, status: "OPEN", endsAt: new Date("2026-11-30T22:00:00Z") },
    later: null as { id: string } | null,
    earlier: [] as { campaignCreatorId: string; status: string; breakdown: unknown }[],
    stopped: [] as { id: string; campaignCreatorId: string }[],
    written: [] as Record<string, unknown>[],
    postUpdates: [] as unknown[],
    campaignUpdates: [] as unknown[],
  };
  const prisma = {
    creatorPeriod: {
      findUnique: vi.fn(async () => ({ ...state.period })),
      findFirst: vi.fn(async () => state.later),
      // The claim: only one caller ever sees OPEN.
      updateMany: vi.fn(async () => {
        if (state.period.status !== "OPEN") return { count: 0 };
        state.period.status = "CLOSED";
        return { count: 1 };
      }),
    },
    creatorPayout: {
      findMany: vi.fn(async () => state.earlier),
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        state.written.push(...data);
        return { count: data.length };
      }),
    },
    creatorPost: { findMany: vi.fn(async () => state.stopped), updateMany: vi.fn(async (a: unknown) => state.postUpdates.push(a)) },
    creatorCampaign: { update: vi.fn(async (a: unknown) => state.campaignUpdates.push(a)) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { state, prisma };
});
const ledger = vi.hoisted(() => ({ periodPay: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: db.prisma }));
vi.mock("@/lib/creators/ledger", () => ledger);

import { closePeriod } from "@/lib/creators/tracking/close";

const NOW = new Date("2026-12-01T03:31:00Z");
const pay = computePeriodPay({ ratePerThousand: 1000 }, {}, [
  { postId: "p2", creatorId: "cc1", status: "TRACKING", postedInPeriod: true, viewsAtStart: 0, viewsAtEnd: 3000 },
  { postId: "p9", creatorId: "cc2", status: "TRACKING", postedInPeriod: true, viewsAtStart: 0, viewsAtEnd: 0 },
]);
const paidBreakdown: PayoutBreakdown = { views: 5000, countedViews: 5000, gross: 5000, earned: 5000, posts: [{ postId: "p1", views: 5000, countedViews: 5000, rate: 5000, milestones: [], milestonePay: 0, fee: 0, amount: 5000 }], deducted: [], stillOwed: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(db.state, { later: { id: "per3" }, earlier: [], stopped: [], written: [], postUpdates: [], campaignUpdates: [] });
  db.state.period.status = "OPEN";
  ledger.periodPay.mockResolvedValue({ period: db.state.period, pay });
});

describe("closing a period", () => {
  it("writes a payout for every creator who earned, once", async () => {
    const first = await closePeriod("per2", NOW);
    expect(first).toMatchObject({ status: "closed", last: false, payouts: [{ campaignCreatorId: "cc1", amount: 3000 }] });
    expect(db.state.written).toHaveLength(1);
    expect(db.state.written[0]).toMatchObject({ periodId: "per2", campaignCreatorId: "cc1", amount: 3000, deductions: 0, countedViews: 3000 });
    // A second run (or one that overlapped) finds it closed and writes nothing.
    expect(await closePeriod("per2", NOW)).toMatchObject({ status: "already" });
    expect(db.state.written).toHaveLength(1);
  });

  it("is safe when two runs close it at the same moment", async () => {
    db.prisma.creatorPeriod.findUnique.mockImplementation(async () => ({ ...db.state.period, status: "OPEN" }));
    const results = await Promise.all([closePeriod("per2", NOW), closePeriod("per2", NOW)]);
    expect(results.map((r) => r.status).sort()).toEqual(["already", "closed"]);
    expect(db.prisma.creatorPayout.createMany).toHaveBeenCalledTimes(1);
  });

  it("does not close before the period's end", async () => {
    expect(await closePeriod("per2", new Date("2026-11-30T12:00:00Z"))).toMatchObject({ status: "already" });
    expect(db.prisma.creatorPeriod.updateMany).not.toHaveBeenCalled();
  });

  it("takes back pay of a post removed after its PAID payout, never twice, and keeps what is still owed", async () => {
    db.state.earlier = [{ campaignCreatorId: "cc1", status: "PAID", breakdown: paidBreakdown }];
    db.state.stopped = [{ id: "p1", campaignCreatorId: "cc1" }];
    await closePeriod("per2", NOW);
    const row = db.state.written[0] as { amount: number; deductions: number; breakdown: PayoutBreakdown };
    expect(row).toMatchObject({ amount: 0, deductions: 3000 });
    expect(row.breakdown.deducted).toEqual([{ postId: "p1", amount: 5000 }]);
    expect(row.breakdown.stillOwed).toBe(2000);

    // Next period: p1 was taken back already (it is in an earlier payout's `deducted`), so nothing more comes off.
    db.state.period.status = "OPEN";
    db.state.written = [];
    db.state.earlier = [{ campaignCreatorId: "cc1", status: "PAID", breakdown: paidBreakdown }, { campaignCreatorId: "cc1", status: "DUE", breakdown: row.breakdown }];
    await closePeriod("per2", NOW);
    expect(db.state.written[0]).toMatchObject({ amount: 3000, deductions: 0 });
  });

  it("ends the campaign after its last period: posts FINAL, campaign ENDED, owed deductions recorded", async () => {
    db.state.later = null;
    db.state.earlier = [{ campaignCreatorId: "cc2", status: "PAID", breakdown: { ...paidBreakdown, posts: [{ ...paidBreakdown.posts[0], postId: "p8" }] } }];
    db.state.stopped = [{ id: "p8", campaignCreatorId: "cc2" }];
    const r = await closePeriod("per2", NOW);
    expect(r.last).toBe(true);
    // cc2 earned nothing this period, but the last period records the 5,000 still owed.
    expect(db.state.written.find((w) => w.campaignCreatorId === "cc2")).toMatchObject({ amount: 0, deductions: 0, breakdown: expect.objectContaining({ stillOwed: 5000 }) });
    expect(db.state.postUpdates).toEqual([
      { where: { campaignId: "camp1", status: "TRACKING" }, data: { status: "FINAL", nextReadAt: null } },
      { where: { campaignId: "camp1", status: "CHECKING" }, data: { status: "INVALID", statusReason: expect.any(String) } },
    ]);
    expect(db.state.campaignUpdates).toEqual([{ where: { id: "camp1" }, data: { status: "ENDED", acceptingApplications: false } }]);
  });
});

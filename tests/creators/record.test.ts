import { beforeEach, describe, expect, it, vi } from "vitest";

// A company's payment record on the marketplace (lib/creators/record.ts): creators paid, the median days from a
// month's end to the payment, "Some payments late" for DUE payouts over 14 days past their month, "New on BuPulse".

const h = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { creatorPayout: { findMany: h.findMany } } }));

import { NEW_RECORD, paymentRecord, paymentRecords, recordInWords, recordOf } from "@/lib/creators/record";

const DAY = 86_400_000;
const NOW = new Date("2026-10-21T10:00:00Z");
const END = new Date("2026-10-01T00:00:00Z");
const at = (days: number, from = END) => new Date(from.getTime() + days * DAY);

describe("recordOf", () => {
  it("counts different people and takes the median of the days, rounded up", () => {
    const r = recordOf(
      [
        { email: "a@x.rw", paidAt: at(1), periodEndsAt: END },
        { email: "A@x.rw", paidAt: at(3), periodEndsAt: END },
        { email: "b@x.rw", paidAt: at(2.5), periodEndsAt: END },
      ],
      [],
      NOW,
    );
    expect(r).toEqual({ creatorsPaid: 2, medianDays: 3, late: false, isNew: false });
  });

  it("an even count takes the middle two; paid before the month's end counts as 0 days", () => {
    expect(recordOf([{ email: "a", paidAt: at(-2), periodEndsAt: END }, { email: "b", paidAt: at(4), periodEndsAt: END }], [], NOW).medianDays).toBe(2);
  });

  it("is new with no paid payout, and late with a DUE payout more than 14 days past its month", () => {
    expect(recordOf([], [], NOW)).toEqual(NEW_RECORD);
    expect(recordOf([], [{ periodEndsAt: at(-15, NOW) }], NOW)).toMatchObject({ isNew: true, late: true });
    expect(recordOf([], [{ periodEndsAt: at(-13, NOW) }], NOW).late).toBe(false);
  });
});

describe("recordInWords", () => {
  it("says it in plain words", () => {
    expect(recordInWords(NEW_RECORD).lines).toEqual(["New on BuPulse"]);
    expect(recordInWords({ creatorsPaid: 1, medianDays: 0, late: false, isNew: false }).lines).toEqual(["Paid 1 creator", "Usually within a day of the month's end"]);
    expect(recordInWords({ creatorsPaid: 12, medianDays: 3, late: true, isNew: false })).toEqual({ lines: ["Paid 12 creators", "Usually within 3 days of the month's end", "Some payments late"], late: true });
  });
});

describe("paymentRecords", () => {
  beforeEach(() => h.findMany.mockReset());

  it("reads PAID payouts and old DUE ones per company; companies without any are new", async () => {
    const row = (businessId: string, status: string, email: string, paidAt: Date | null) => ({ status, paidAt, campaignCreator: { email }, period: { endsAt: END, campaign: { businessId } } });
    h.findMany.mockResolvedValue([row("b1", "PAID", "a@x.rw", at(2)), row("b1", "PAID", "b@x.rw", at(4)), row("b2", "DUE", "c@x.rw", null)]);
    const records = await paymentRecords(["b1", "b2", "b3", "b1"], NOW);
    expect(records.get("b1")).toEqual({ creatorsPaid: 2, medianDays: 3, late: false, isNew: false });
    expect(records.get("b2")).toEqual({ creatorsPaid: 0, medianDays: null, late: true, isNew: true });
    expect(records.get("b3")).toEqual(NEW_RECORD);
    const where = h.findMany.mock.calls[0][0].where;
    expect(where.period.campaign.businessId.in).toEqual(["b1", "b2", "b3"]);
    expect(where.OR[1]).toEqual({ status: "DUE", period: { endsAt: { lt: at(-14, NOW) } } });
  });

  it("asks nothing for no companies", async () => {
    expect((await paymentRecords([], NOW)).size).toBe(0);
    expect(h.findMany).not.toHaveBeenCalled();
    h.findMany.mockResolvedValue([]);
    expect(await paymentRecord("b9", NOW)).toEqual(NEW_RECORD);
  });
});

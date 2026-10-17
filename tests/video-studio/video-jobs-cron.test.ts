import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; status: string; leaseUntil: Date | null; refundedAt: Date | null; credits: number; periodStart: Date | null; businessId: string; error?: string };
const db = vi.hoisted(() => ({ rows: [] as Row[] }));
const prisma = vi.hoisted(() => ({
  videoJob: {
    findMany: vi.fn(async ({ where, take }: { where: { status: string; leaseUntil: { lt: Date }; refundedAt: null }; take: number }) =>
      db.rows
        .filter((r) => r.status === where.status && r.leaseUntil && r.leaseUntil < where.leaseUntil.lt && r.refundedAt === null)
        .slice(0, take)
        .map((r) => ({ id: r.id, credits: r.credits, periodStart: r.periodStart, business: { userId: `owner-of-${r.businessId}` } })),
    ),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: string; leaseUntil: { lt: Date }; refundedAt: null }; data: Partial<Row> }) => {
      const r = db.rows.find((x) => x.id === where.id);
      if (!r || r.status !== where.status || !r.leaseUntil || !(r.leaseUntil < where.leaseUntil.lt) || r.refundedAt !== null) return { count: 0 };
      Object.assign(r, data);
      return { count: 1 };
    }),
  },
}));
const usage = vi.hoisted(() => ({ refundUsage: vi.fn(async () => {}) }));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/usage", () => usage);
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/admin/cron-run", () => ({ recordCron: vi.fn(async (_job: string, run: () => Promise<unknown>) => run()) }));

import { sweepVideoJobs, STRANDED_MESSAGE } from "@/lib/video-studio/sweep";
import { POST } from "@/app/api/cron/video-jobs/route";
import { NextRequest } from "next/server";

const NOW = new Date("2026-10-17T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const PERIOD = new Date("2026-10-01T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  db.rows = [
    { id: "stranded", status: "designing", leaseUntil: ago(3), refundedAt: null, credits: 35, periodStart: PERIOD, businessId: "b1" },
    { id: "working", status: "designing", leaseUntil: new Date("2099-01-01T00:00:00Z"), refundedAt: null, credits: 35, periodStart: PERIOD, businessId: "b1" },
    { id: "done", status: "designed", leaseUntil: null, refundedAt: null, credits: 35, periodStart: PERIOD, businessId: "b1" },
    { id: "failed-already", status: "failed", leaseUntil: null, refundedAt: ago(30), credits: 35, periodStart: PERIOD, businessId: "b2" },
  ];
});

describe("the Video Studio sweep", () => {
  it("fails a design whose lease passed and gives its credits back to the company account, exactly once", async () => {
    expect(await sweepVideoJobs(NOW)).toEqual({ stranded: 1, refunded: 1, credits: 35, refundErrors: 0 });
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
    expect(usage.refundUsage).toHaveBeenCalledWith("owner-of-b1", "videoCredits", PERIOD, 35);
    expect(db.rows.find((r) => r.id === "stranded")).toMatchObject({ status: "failed", error: STRANDED_MESSAGE, refundedAt: NOW, leaseUntil: null });
    // A second run (or two runs at once) finds nothing more to refund.
    expect(await sweepVideoJobs(NOW)).toEqual({ stranded: 0, refunded: 0, credits: 0, refundErrors: 0 });
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
    // Untouched: the design still in its lease, the finished one, the one already refunded.
    expect(db.rows.find((r) => r.id === "working")?.status).toBe("designing");
    expect(db.rows.find((r) => r.id === "done")?.status).toBe("designed");
  });

  it("leaves a design that finished between the look and the claim, and refunds nothing for it", async () => {
    prisma.videoJob.updateMany.mockImplementationOnce(async () => {
      Object.assign(db.rows[0], { status: "designed", leaseUntil: null });
      return { count: 0 };
    });
    expect(await sweepVideoJobs(NOW)).toMatchObject({ stranded: 0, refunded: 0 });
    expect(usage.refundUsage).not.toHaveBeenCalled();
    expect(db.rows[0].status).toBe("designed");
  });

  it("a refund that fails is counted and logged, never retried into a double refund", async () => {
    usage.refundUsage.mockRejectedValueOnce(new Error("db blip"));
    expect(await sweepVideoJobs(NOW)).toEqual({ stranded: 1, refunded: 0, credits: 0, refundErrors: 1 });
    expect(await sweepVideoJobs(NOW)).toMatchObject({ stranded: 0 });
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
  });

  it("the cron route needs the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const req = (auth?: string) => new NextRequest("https://x.test/api/cron/video-jobs", { method: "POST", headers: auth ? { authorization: auth } : {} });
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req("Bearer wrong"))).status).toBe(401);
    const ok = await POST(req("Bearer s3cret"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ stranded: 1, refunded: 1 });
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(req("Bearer s3cret"))).status).toBe(500);
  });
});

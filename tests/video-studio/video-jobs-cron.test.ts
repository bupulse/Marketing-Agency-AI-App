import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; status: string; leaseUntil: Date | null; refundedAt: Date | null; credits: number; periodStart: Date | null; businessId: string; error?: string; voiceCredits?: number; voicePeriodStart?: Date | null; voiceReservedAt?: Date | null };
type Where = { id?: string; status?: string; leaseUntil?: { lt: Date }; refundedAt?: null; voiceCredits?: { gt: number }; voiceReservedAt?: { lt: Date } | Date | null };
const db = vi.hoisted(() => ({ rows: [] as Row[] }));
const prisma = vi.hoisted(() => ({
  videoJob: {
    findMany: vi.fn(async ({ where, take }: { where: Where; take: number }) =>
      (where.voiceCredits
        ? db.rows.filter((r) => (r.voiceCredits ?? 0) > 0 && r.voiceReservedAt && r.voiceReservedAt < (where.voiceReservedAt as { lt: Date }).lt)
        : db.rows.filter((r) => r.status === where.status && r.leaseUntil && r.leaseUntil < where.leaseUntil!.lt && r.refundedAt === null)
      )
        .slice(0, take)
        .map((r) => ({ id: r.id, credits: r.credits, periodStart: r.periodStart, voiceCredits: r.voiceCredits ?? 0, voicePeriodStart: r.voicePeriodStart ?? null, voiceReservedAt: r.voiceReservedAt ?? null, business: { userId: `owner-of-${r.businessId}` } })),
    ),
    updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<Row> }) => {
      const r = db.rows.find((x) => x.id === where.id);
      if (!r) return { count: 0 };
      if (where.voiceCredits) {
        if (!((r.voiceCredits ?? 0) > 0) || r.voiceReservedAt?.getTime() !== (where.voiceReservedAt as Date).getTime()) return { count: 0 };
      } else if (r.status !== where.status || !r.leaseUntil || !(r.leaseUntil < where.leaseUntil!.lt) || r.refundedAt !== null) return { count: 0 };
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
// The Seedance part of the sweep has its own tests (tests/video-studio/seedance-jobs.test.ts).
vi.mock("@/lib/video-studio/seedance-jobs", () => ({ sweepSeedanceJobs: vi.fn(async () => ({ stranded: 0, expired: 0 })) }));
// The content videos' AI clips run in the same sweep (tests/visuals/ai-clips.test.ts covers them).
const AI_CLIPS = vi.hoisted(() => ({ started: 0, fallback: 0, made: 0, done: 0, refunded: 0, credits: 0 }));
vi.mock("@/lib/visuals/ai-clips", () => ({ runAiClips: vi.fn(async () => AI_CLIPS) }));

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
    expect(await sweepVideoJobs(NOW)).toEqual({ stranded: 1, refunded: 1, credits: 35, refundErrors: 0, voiceRefunded: 0, voiceCredits: 0, seedance: { stranded: 0, expired: 0 }, aiClips: AI_CLIPS });
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
    expect(usage.refundUsage).toHaveBeenCalledWith("owner-of-b1", "videoCredits", PERIOD, 35);
    expect(db.rows.find((r) => r.id === "stranded")).toMatchObject({ status: "failed", error: STRANDED_MESSAGE, refundedAt: NOW, leaseUntil: null });
    // A second run (or two runs at once) finds nothing more to refund.
    expect(await sweepVideoJobs(NOW)).toEqual({ stranded: 0, refunded: 0, credits: 0, refundErrors: 0, voiceRefunded: 0, voiceCredits: 0, seedance: { stranded: 0, expired: 0 }, aiClips: AI_CLIPS });
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
    expect(await sweepVideoJobs(NOW)).toEqual({ stranded: 1, refunded: 0, credits: 0, refundErrors: 1, voiceRefunded: 0, voiceCredits: 0, seedance: { stranded: 0, expired: 0 }, aiClips: AI_CLIPS });
    expect(await sweepVideoJobs(NOW)).toMatchObject({ stranded: 0 });
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
  });

  it("gives back a voice-over reservation whose request died, exactly once, and leaves a fresh one alone", async () => {
    const VPERIOD = new Date("2026-10-01T00:00:00Z");
    db.rows = [
      { id: "voice-stale", status: "designed", leaseUntil: null, refundedAt: null, credits: 35, periodStart: PERIOD, businessId: "b1", voiceCredits: 15, voicePeriodStart: VPERIOD, voiceReservedAt: ago(11) },
      { id: "voice-fresh", status: "ready", leaseUntil: null, refundedAt: null, credits: 35, periodStart: PERIOD, businessId: "b2", voiceCredits: 15, voicePeriodStart: VPERIOD, voiceReservedAt: ago(2) },
    ];
    expect(await sweepVideoJobs(NOW)).toMatchObject({ stranded: 0, voiceRefunded: 1, voiceCredits: 15 });
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
    expect(usage.refundUsage).toHaveBeenCalledWith("owner-of-b1", "videoCredits", VPERIOD, 15);
    expect(db.rows[0]).toMatchObject({ voiceCredits: 0, voicePeriodStart: null, voiceReservedAt: null, status: "designed" });
    expect(db.rows[1]).toMatchObject({ voiceCredits: 15 });
    expect(await sweepVideoJobs(NOW)).toMatchObject({ voiceRefunded: 0 });
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
  });

  it("a voice reservation its request settled between the look and the claim is not refunded", async () => {
    db.rows = [{ id: "v", status: "designed", leaseUntil: null, refundedAt: null, credits: 35, periodStart: PERIOD, businessId: "b1", voiceCredits: 15, voicePeriodStart: PERIOD, voiceReservedAt: ago(11) }];
    prisma.videoJob.updateMany.mockImplementationOnce(async () => {
      Object.assign(db.rows[0], { voiceCredits: 0, voicePeriodStart: null, voiceReservedAt: null });
      return { count: 0 };
    });
    expect(await sweepVideoJobs(NOW)).toMatchObject({ voiceRefunded: 0 });
    expect(usage.refundUsage).not.toHaveBeenCalled();
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

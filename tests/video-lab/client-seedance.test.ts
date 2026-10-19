import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  unavailable: vi.fn(async (): Promise<"no-key" | "off" | null> => "no-key"),
  submit: vi.fn(),
  preview: vi.fn(),
  rows: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    videoJob: {
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] }; businessId?: string } }) => m.rows.filter((r) => (where.id ? where.id.in.includes(r.id as string) : r.businessId === where.businessId))),
      findFirst: vi.fn(async ({ where }: { where: { id: string; businessId: string } }) => m.rows.find((r) => r.id === where.id && r.businessId === where.businessId) ?? null),
    },
  },
}));
vi.mock("@/lib/video-studio/seedance-jobs", () => ({
  SEEDANCE_MESSAGES: { off: "Real video is paused right now. Please try again later.", noKey: "Real video is coming soon: here is the free storyboard of what Seedance will film. No credits were taken." },
  seedanceUnavailable: m.unavailable,
  submitSeedanceJob: m.submit,
  createSeedancePreview: m.preview,
  cancelSeedanceJob: vi.fn(),
  saveSeedanceOverlayJob: vi.fn(),
}));
vi.mock("@/lib/video-studio/brief", () => ({ loadBriefFacts: vi.fn() }));
vi.mock("@/video-lab/client-jobs", () => {
  class ClientJobError extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  }
  return { ClientJobError, ownerOf: (id: { companyUserId: string; userId: string; businessId: string }) => ({ userId: id.companyUserId, actorId: id.userId, businessId: id.businessId }), asClientError: vi.fn(async (e: Error) => new ClientJobError(e.message, 400)), clientVideoUrl: vi.fn(), getClientJob: vi.fn() };
});

import { clientSeedancePreview, labSeedanceJob, listClientSeedanceJobs, submitSeedanceForClient } from "@/video-lab/client-seedance";

const me = { userId: "person-1", businessId: "biz-1", companyUserId: "owner-1", role: "OWNER" };
const request = { tier: "fast" as const, prompt: "0-2s: close-up, push-in: the tower. 2-5s: medium shot, orbit: hands pick basil.", references: [], ratio: "9:16" as const, seconds: 5, resolution: "720p" as const, audio: true, fixedLens: false };
const row = (over: Record<string, unknown>) => ({ id: "c" + "a".repeat(24), status: "submitted", createdAt: new Date("2026-10-20T08:00:00Z"), updatedAt: new Date("2026-10-20T08:00:00Z"), providerTaskId: "cgt-1", brief: { title: "LEAF Hydro Tower", request: { tier: "fast", referenceNotes: ["Image 1"] } }, credits: 160, costUsd: 0, error: null, businessId: "biz-1", productId: "p-1", videoPath: null, bytes: 0, storyboard: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  m.rows = [];
  m.unavailable.mockResolvedValue("no-key");
  m.preview.mockImplementation(async (_o: unknown, input: { title: string }, p: { storyboard: unknown; readyAt: Date; notice: string }) => {
    const r = row({ id: `c${String(m.rows.length).padStart(24, "b")}`, status: "preview", credits: 0, providerTaskId: null, storyboard: p.storyboard, brief: { title: input.title, request: {}, preview: { notice: p.notice, readyAt: p.readyAt.toISOString(), wouldCostCredits: 160 } } });
    m.rows.push(r);
    return { id: r.id };
  });
});

describe("a client's real video", () => {
  it("is a free preview (the storyboard, no credits) until the BytePlus key is set, one per version", async () => {
    const jobs = await submitSeedanceForClient(me, { productId: "p-1", request, referenceNotes: [], title: "LEAF Hydro Tower", versions: 2 });
    expect(m.submit).not.toHaveBeenCalled();
    expect(m.preview).toHaveBeenCalledTimes(2);
    expect(jobs.map((j) => j.status)).toEqual(["preview", "preview"]);
    expect(jobs[0].preview?.notice).toMatch(/^Real video is coming soon/);
    expect((m.preview.mock.calls[0][2] as { storyboard: { kind: string } }).storyboard.kind).toBe("seedance-storyboard");
  });

  it("is refused before anything is charged while Seedance is switched off, and sent for real when it runs", async () => {
    m.unavailable.mockResolvedValue("off");
    await expect(submitSeedanceForClient(me, { productId: "p-1", request, referenceNotes: [], title: "x", versions: 1 })).rejects.toThrow(/paused/);
    expect(m.submit).not.toHaveBeenCalled();
    m.unavailable.mockResolvedValue(null);
    m.submit.mockImplementation(async () => {
      m.rows.push(row({}));
      return { id: m.rows[0].id };
    });
    const jobs = await submitSeedanceForClient(me, { productId: "p-1", request, referenceNotes: [], title: "x", versions: 1 });
    expect(m.submit).toHaveBeenCalledWith({ userId: "owner-1", actorId: "person-1", businessId: "biz-1" }, expect.objectContaining({ request: expect.objectContaining({ tier: "fast" }) }));
    expect(jobs[0]).toMatchObject({ status: "queued", taskId: "cgt-1", credits: 160 });
  });

  it("is shown to the page in the local jobs' shape: submitted is queued, ready succeeded, a due preview ready", () => {
    expect(labSeedanceJob(row({ status: "ready", videoPath: "owner-1/clips/x.mp4", bytes: 4000 }) as never)).toMatchObject({ status: "succeeded", videoFile: `c${"a".repeat(24)}.mp4`, bytes: 4000, title: "LEAF Hydro Tower", request: { referenceNotes: ["Image 1"] } });
    const pv = row({ status: "preview", brief: { preview: { notice: "n", readyAt: "2026-10-20T08:00:05Z", wouldCostCredits: 160 } } });
    expect(labSeedanceJob(pv as never, Date.parse("2026-10-20T08:00:01Z")).status).toBe("preview");
    expect(labSeedanceJob(pv as never, Date.parse("2026-10-20T08:00:06Z")).status).toBe("preview-ready");
  });

  it("only ever lists and opens the client's own jobs", async () => {
    m.rows = [row({}), row({ id: "c" + "z".repeat(24), businessId: "biz-2" })];
    expect((await listClientSeedanceJobs(me)).map((j) => j.businessId)).toEqual(["biz-1"]);
    expect(await clientSeedancePreview(me, "c" + "z".repeat(24))).toBeNull();
    expect(await clientSeedancePreview(me, "sd-0123456789ab")).toBeNull();
  });
});

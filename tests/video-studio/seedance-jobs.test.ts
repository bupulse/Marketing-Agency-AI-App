import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory VideoJob table that understands the filters seedance-jobs.ts uses (equality, null, in, not null, lt,
// lte, OR), so the claims and the refund-once updates are tested for real.
type Row = Record<string, unknown> & { id: string };
const db = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), next: 0 }));
const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as Record<string, unknown>[]).some((w) => matches(row, w));
    const v = row[k] ?? null;
    if (cond === null) return v === null;
    if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
    if (typeof cond === "object") {
      const c = cond as { in?: unknown[]; not?: unknown; lt?: Date; lte?: Date };
      if (c.in) return c.in.includes(v);
      if ("not" in c) return c.not === null ? v !== null : v !== c.not;
      if (c.lt) return v instanceof Date && v.getTime() < c.lt.getTime();
      if (c.lte) return v instanceof Date && v.getTime() <= c.lte.getTime();
    }
    return v === cond;
  });
const prisma = vi.hoisted(() => {
  const withBusiness = (r: Record<string, unknown> | undefined) => (r ? { ...r, business: { userId: "company-1" }, product: { name: "LEAF Hydro Tower" } } : null);
  return {
    videoJob: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `cjob${String(++db.next).padStart(21, "0")}`;
        const row = { id, createdAt: new Date("2026-10-20T08:00:00Z"), updatedAt: new Date(), refundedAt: null, leaseUntil: null, nextPollAt: null, expiresAt: null, providerTaskId: null, attempts: 0, videoPath: null, error: null, costUsd: 0, caption: "", hashtags: [], warnings: [], score: null, captionScore: null, spec: null, parentId: null, mode: null, ...data };
        db.rows.set(id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = { ...db.rows.get(where.id), ...data };
        db.rows.set(where.id, row);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const [id, row] of db.rows) {
          if (!matches(row, where)) continue;
          db.rows.set(id, { ...row, ...data });
          count++;
        }
        return { count };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => withBusiness(db.rows.get(where.id))),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => withBusiness(db.rows.get(where.id))!),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => [...db.rows.values()].find((r) => matches(r, where)) ?? null),
      findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take?: number }) => [...db.rows.values()].filter((r) => matches(r, where)).slice(0, take ?? 100)),
    },
  };
});
const usage = vi.hoisted(() => ({ consumeUsage: vi.fn(async () => ({ periodStart: new Date("2026-10-01T00:00:00Z") })), refundUsage: vi.fn(async () => undefined) }));
const sw = vi.hoisted(() => ({ off: false }));
const media = vi.hoisted(() => ({ prepareUploads: vi.fn(async () => [{ ok: true, path: "company-1/clips/a.mp4", token: "t" }]), upload: vi.fn(async () => ({ error: null })), saveJobVideo: vi.fn() }));
const ledger = vi.hoisted(() => ({ calls: [] as string[], recorded: [] as { tokens: number }[] }));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/usage", () => usage);
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => undefined) }));
vi.mock("@/lib/admin/switch", async (orig) => {
  const real = await orig<typeof import("@/lib/admin/switch")>();
  return { ...real, assertServiceEnabled: vi.fn(async (id: string) => { if (sw.off && id === "seedance") throw new real.ServiceDisabledError("seedance"); }) };
});
vi.mock("@/lib/ai/ledger", () => ({
  withLedger: vi.fn(async (ctx: { feature: string }, _meta: unknown, call: () => Promise<unknown>) => {
    ledger.calls.push(ctx.feature);
    return call();
  }),
  recordAiCall: vi.fn(async (_ctx: unknown, entry: { usage: { outputTokens: number } }) => void ledger.recorded.push({ tokens: entry.usage.outputTokens })),
}));
vi.mock("@/lib/media/service", () => ({ MediaError: class MediaError extends Error {}, prepareUploads: media.prepareUploads }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: media.upload }) } }) }));
vi.mock("@/lib/video-studio/library", () => ({
  studioFolder: vi.fn(async () => "folder:studio"),
  saveJobVideo: media.saveJobVideo,
}));

import { SEEDANCE_GRACE_MS, SEEDANCE_SAVE_TRIES, SEEDANCE_SUBMIT_LEASE_MS, cancelSeedanceJob, createSeedancePreview, pollDueSeedanceJobs, pollSeedanceJob, saveSeedanceOverlayJob, submitSeedanceJob, sweepSeedanceJobs } from "@/lib/video-studio/seedance-jobs";
import { VideoStudioError } from "@/lib/video-studio/jobs";
import { sampleSpec } from "@/lib/video-engine/sample";
import type { SeedanceRequest } from "@/lib/video-engine/seedance";

const owner = { userId: "company-1", actorId: "person-1", businessId: "biz-1" };
const env = { SEEDANCE_API_KEY: "test-key" };
const request: SeedanceRequest = { tier: "fast", prompt: "0-2s: close-up, push-in: the LEAF Hydro Tower on a balcony. 2-5s: medium shot, orbit: hands pick basil.", references: [{ kind: "image", url: "data:image/jpeg;base64,AAAA", role: "reference_image" }], ratio: "9:16", seconds: 5, resolution: "720p", audio: true, fixedLens: false };
const input = { productId: "prod-1", request, referenceNotes: ["Image 1: the tower on a balcony"], title: "LEAF Hydro Tower", templateId: "viral", platform: "instagram", brief: { recipe: { version: 1 } } };
const MP4 = new Uint8Array(4000).fill(7);

/** BytePlus as a fetch: create answers a task id, each status check the next of `statuses`, the download the MP4. */
function byteplus(statuses: (string | Error)[], opts: { create?: number; download?: number } = {}) {
  const seen: string[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    seen.push(`${init?.method ?? "GET"} ${url.replace(/^https:\/\/[^/]+/, "")}`);
    if (url.endsWith("/contents/generations/tasks") && init?.method === "POST") return opts.create ? new Response(JSON.stringify({ error: { code: "AuthenticationError" } }), { status: opts.create }) : Response.json({ id: "cgt-1" });
    if (/\/contents\/generations\/tasks\/cgt-1$/.test(url) && init?.method === "DELETE") return new Response(null, { status: 200 });
    if (/\/contents\/generations\/tasks\/cgt-1$/.test(url)) {
      const next = statuses.shift() ?? "running";
      if (next instanceof Error) throw next;
      return Response.json({ id: "cgt-1", model: "dreamina-seedance-2-0-fast-260128", status: next, content: next === "succeeded" ? { video_url: "https://ark-content.bytepluses.com/clip.mp4" } : undefined, usage: { completion_tokens: 108_900 }, error: next === "failed" ? { code: "OutputVideoSensitiveContentDetected" } : undefined });
    }
    if (url === "https://ark-content.bytepluses.com/clip.mp4") return opts.download ? new Response("no", { status: opts.download }) : new Response(MP4, { status: 200 });
    throw new Error(`unexpected ${url}`);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, seen };
}
const at = (iso: string) => () => new Date(iso);
const row = (id: string) => db.rows.get(id) as Row;

beforeEach(() => {
  vi.clearAllMocks();
  db.rows.clear();
  sw.off = false;
  ledger.calls.length = 0;
  ledger.recorded.length = 0;
  media.saveJobVideo.mockImplementation(async (_ctx: unknown, id: string, file: { path: string }) => {
    db.rows.set(id, { ...db.rows.get(id), status: "ready", videoPath: file.path, bytes: 4000 });
    return {};
  });
});

describe("submitting a Seedance clip", () => {
  it("takes the credits first, writes the job, creates the task through the ledger and waits for the poller", async () => {
    const bp = byteplus([]);
    const job = await submitSeedanceJob(owner, input, { env, fetchImpl: bp.fetchImpl, now: at("2026-10-20T08:00:00Z") });
    expect(usage.consumeUsage).toHaveBeenCalledWith("company-1", "videoCredits", expect.any(Number));
    expect(prisma.videoJob.create.mock.invocationCallOrder[0]).toBeGreaterThan(usage.consumeUsage.mock.invocationCallOrder[0]);
    expect(ledger.calls).toEqual(["video-seedance"]);
    expect(row(job.id)).toMatchObject({ engine: "seedance", status: "submitted", providerTaskId: "cgt-1", quality: "fast 720p", templateId: "viral", platform: "instagram", productId: "prod-1", ratio: "9:16", seconds: 5 });
    expect((row(job.id).nextPollAt as Date).toISOString()).toBe("2026-10-20T08:00:10.000Z");
    expect((row(job.id).expiresAt as Date).toISOString()).toBe("2026-10-20T09:00:00.000Z");
    // The references are kept as their notes only, never the image data.
    expect(JSON.stringify(row(job.id))).not.toContain("base64");
    expect((row(job.id).brief as { recipe: unknown; request: { referenceNotes: string[] } }).request.referenceNotes).toEqual(["Image 1: the tower on a balcony"]);
    expect(usage.refundUsage).not.toHaveBeenCalled();
  });

  it("a refused request fails the job and gives the credits back once, in plain words", async () => {
    const bp = byteplus([], { create: 401 });
    await expect(submitSeedanceJob(owner, input, { env, fetchImpl: bp.fetchImpl })).rejects.toThrow(/key is not valid.*Your credits are back/);
    const [job] = [...db.rows.values()] as Row[];
    expect(job).toMatchObject({ status: "failed", refundedAt: expect.any(Date) });
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
    // The sweep never refunds it a second time.
    await sweepSeedanceJobs(new Date(Date.now() + SEEDANCE_SUBMIT_LEASE_MS * 2));
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
  });

  it("charges nothing when Seedance cannot run: no key, or switched off in Admin -> Services", async () => {
    await expect(submitSeedanceJob(owner, input, { env: {} })).rejects.toBeInstanceOf(VideoStudioError);
    sw.off = true;
    await expect(submitSeedanceJob(owner, input, { env })).rejects.toThrow(/paused/);
    expect(usage.consumeUsage).not.toHaveBeenCalled();
    expect(db.rows.size).toBe(0);
  });

  it("a free preview is a job with its storyboard and no credits", async () => {
    const job = await createSeedancePreview(owner, input, { storyboard: { kind: "seedance-storyboard", shots: [] }, readyAt: new Date("2026-10-20T08:00:05Z"), notice: "Preview" });
    expect(row(job.id)).toMatchObject({ engine: "seedance", status: "preview", credits: 0, storyboard: { kind: "seedance-storyboard" } });
    expect((row(job.id).brief as { preview: { wouldCostCredits: number } }).preview.wouldCostCredits).toBeGreaterThan(0);
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });
});

describe("the poller", () => {
  const submit = async (statuses: (string | Error)[], opts: { download?: number } = {}) => {
    const bp = byteplus(statuses, opts);
    const job = await submitSeedanceJob(owner, input, { env, fetchImpl: bp.fetchImpl, now: at("2026-10-20T08:00:00Z") });
    return { id: job.id, bp };
  };

  it("follows queued and running, then downloads the clip into the Gallery and records the real cost", async () => {
    const { id, bp } = await submit(["queued", "running", "succeeded"]);
    expect(await pollSeedanceJob(id, { env, fetchImpl: bp.fetchImpl, now: at("2026-10-20T08:00:10Z") })).toBe("waiting");
    expect(row(id).status).toBe("queued");
    expect(await pollSeedanceJob(id, { env, fetchImpl: bp.fetchImpl, now: at("2026-10-20T08:00:20Z") })).toBe("waiting");
    expect(row(id).status).toBe("running");
    expect(await pollSeedanceJob(id, { env, fetchImpl: bp.fetchImpl, now: at("2026-10-20T08:01:30Z") })).toBe("ready");
    expect(media.prepareUploads).toHaveBeenCalledWith({ userId: "company-1", businessId: "biz-1" }, [{ name: `seedance-${id}.mp4`, type: "video/mp4", size: 4000 }], "folder:studio");
    expect(media.upload).toHaveBeenCalledTimes(1);
    expect(media.saveJobVideo).toHaveBeenCalledWith({ userId: "company-1", businessId: "biz-1" }, id, expect.objectContaining({ path: "company-1/clips/a.mp4" }), { engine: "seedance" });
    expect(row(id)).toMatchObject({ status: "ready", videoPath: "company-1/clips/a.mp4", leaseUntil: null, nextPollAt: null });
    expect(row(id).costUsd).toBeCloseTo(0.61, 2);
    expect(ledger.recorded).toEqual([{ tokens: 108_900 }]);
    expect(usage.refundUsage).not.toHaveBeenCalled();
    // A finished job is not polled again.
    expect(await pollSeedanceJob(id, { env, fetchImpl: bp.fetchImpl })).toBe("skipped");
  });

  it("a failed task gives the credits back exactly once, even if two pollers see it", async () => {
    const { id, bp } = await submit(["failed", "failed"]);
    const [a, b] = await Promise.all([pollSeedanceJob(id, { env, fetchImpl: bp.fetchImpl }), pollSeedanceJob(id, { env, fetchImpl: bp.fetchImpl })]);
    expect([a, b].sort()).toEqual(["failed", "skipped"]);
    expect(row(id)).toMatchObject({ status: "failed", refundedAt: expect.any(Date) });
    expect(String(row(id).error)).toMatch(/declined the content.*Your credits are back/);
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
    expect(usage.refundUsage).toHaveBeenCalledWith("company-1", "videoCredits", new Date("2026-10-01T00:00:00Z"), row(id).credits);
  });

  it("a BytePlus that does not answer is asked again later, until the task's expiry has passed", async () => {
    const { id, bp } = await submit([new Error("network"), new Error("network")]);
    expect(await pollSeedanceJob(id, { env, fetchImpl: bp.fetchImpl, now: at("2026-10-20T08:00:10Z") })).toBe("waiting");
    expect(row(id).status).toBe("submitted");
    expect(await pollSeedanceJob(id, { env, fetchImpl: bp.fetchImpl, now: () => new Date(Date.parse("2026-10-20T09:00:00Z") + SEEDANCE_GRACE_MS + 1000) })).toBe("failed");
    expect(String(row(id).error)).toMatch(/did not finish within the hour/);
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
  });

  it("a clip that cannot be saved is tried again, then given up with the credits back", async () => {
    const { id, bp } = await submit(Array(SEEDANCE_SAVE_TRIES).fill("succeeded"), { download: 500 });
    for (let i = 1; i < SEEDANCE_SAVE_TRIES; i++) {
      expect(await pollSeedanceJob(id, { env, fetchImpl: bp.fetchImpl, now: () => new Date(Date.parse("2026-10-20T08:01:00Z") + i * 60_000) })).toBe("waiting");
      expect(row(id).attempts).toBe(i);
    }
    expect(await pollSeedanceJob(id, { env, fetchImpl: bp.fetchImpl, now: at("2026-10-20T08:30:00Z") })).toBe("failed");
    expect(String(row(id).error)).toMatch(/could not be saved/);
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
  });

  it("resumes after a restart: due jobs are read from the database, not from memory", async () => {
    const { id, bp } = await submit(["succeeded"]);
    // A new process: nothing in memory, only the row.
    const out = await pollDueSeedanceJobs({ env, fetchImpl: bp.fetchImpl, now: at("2026-10-20T08:05:00Z") });
    expect(out).toMatchObject({ ready: 1 });
    expect(row(id).status).toBe("ready");
    // Not due yet, or no key: nothing is asked.
    expect(await pollDueSeedanceJobs({ env: {}, fetchImpl: bp.fetchImpl })).toEqual({ waiting: 0, ready: 0, failed: 0, skipped: 0 });
  });

  it("only polls BytePlus's own video host", async () => {
    const { id } = await submit([]);
    const evil = vi.fn(async (url: string) => (url.includes("/tasks/") ? Response.json({ id: "cgt-1", status: "succeeded", content: { video_url: "https://evil.example.com/x.mp4" }, usage: { completion_tokens: 1 } }) : new Response(MP4)));
    for (let i = 0; i < SEEDANCE_SAVE_TRIES; i++) await pollSeedanceJob(id, { env, fetchImpl: evil as unknown as typeof fetch, now: () => new Date(Date.parse("2026-10-20T08:01:00Z") + i * 600_000) });
    expect(evil.mock.calls.some(([u]) => String(u).includes("evil.example.com"))).toBe(false);
    expect(row(id).status).toBe("failed");
  });
});

describe("the sweep and cancelling", () => {
  it("fails a submit that died before BytePlus answered, and a task BytePlus has ended, with the credits back once", async () => {
    const now = new Date("2026-10-20T10:00:00Z");
    const stuck = await prisma.videoJob.create({ data: { businessId: "biz-1", engine: "seedance", status: "submitting", credits: 160, periodStart: new Date("2026-10-01"), leaseUntil: new Date(now.getTime() - 1000) } });
    const ended = await prisma.videoJob.create({ data: { businessId: "biz-1", engine: "seedance", status: "running", providerTaskId: "cgt-9", credits: 160, periodStart: new Date("2026-10-01"), expiresAt: new Date(now.getTime() - SEEDANCE_GRACE_MS - 1000) } });
    const fresh = await prisma.videoJob.create({ data: { businessId: "biz-1", engine: "seedance", status: "running", providerTaskId: "cgt-8", credits: 160, periodStart: new Date("2026-10-01"), expiresAt: new Date(now.getTime() + 60_000) } });
    expect(await sweepSeedanceJobs(now)).toEqual({ stranded: 1, expired: 1 });
    expect(row(stuck.id)).toMatchObject({ status: "failed", refundedAt: expect.any(Date) });
    expect(row(ended.id).status).toBe("failed");
    expect(row(fresh.id).status).toBe("running");
    expect(usage.refundUsage).toHaveBeenCalledTimes(2);
    expect(await sweepSeedanceJobs(now)).toEqual({ stranded: 0, expired: 0 });
    expect(usage.refundUsage).toHaveBeenCalledTimes(2);
  });

  it("cancels a task that has not started (BytePlus told, credits back once), and a preview (nothing to give back)", async () => {
    const bp = byteplus([]);
    const job = await submitSeedanceJob(owner, input, { env, fetchImpl: bp.fetchImpl });
    await cancelSeedanceJob(owner, job.id, { env, fetchImpl: bp.fetchImpl });
    await cancelSeedanceJob(owner, job.id, { env, fetchImpl: bp.fetchImpl });
    expect(row(job.id)).toMatchObject({ status: "cancelled" });
    expect(bp.seen).toContain("DELETE /api/v3/contents/generations/tasks/cgt-1");
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
    const pv = await createSeedancePreview(owner, input, { storyboard: {}, readyAt: new Date(), notice: "" });
    await cancelSeedanceJob(owner, pv.id);
    expect(row(pv.id).status).toBe("cancelled");
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
    expect(await cancelSeedanceJob({ ...owner, businessId: "someone-else" }, job.id)).toBeNull();
  });

  it("BuPulse's text over a clip is one child Motion job, made again in place", async () => {
    const bp = byteplus([]);
    const parent = await submitSeedanceJob(owner, input, { env, fetchImpl: bp.fetchImpl });
    const spec = sampleSpec({ business: "LEAF", product: "LEAF Hydro Tower", price: "250,000 RWF", photoCount: 0 }) as never;
    const first = await saveSeedanceOverlayJob(owner, parent.id, { spec, clipUrl: `/videos/seedance/${parent.id}.mp4`, standIn: false, captionScore: 90, captionMissed: [] });
    const again = await saveSeedanceOverlayJob(owner, parent.id, { spec, clipUrl: `/videos/seedance/${parent.id}.mp4`, standIn: false, captionScore: 92, captionMissed: [] });
    expect(first.created).toBe(true);
    expect(again).toEqual({ id: first.id, created: false });
    expect(row(first.id)).toMatchObject({ engine: "motion", mode: "overlay", parentId: parent.id, status: "designed", credits: 0, captionScore: { score: 92 } });
    await expect(saveSeedanceOverlayJob({ ...owner, businessId: "other" }, parent.id, { spec, clipUrl: "", standIn: false, captionScore: 0, captionMissed: [] })).rejects.toThrow(/could not find/);
  });
});

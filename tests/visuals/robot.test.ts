import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    contentVisual: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    business: { findUnique: vi.fn() },
    cronRun: { findMany: vi.fn(), findFirst: vi.fn() },
  },
  logError: vi.fn(),
  recordCron: vi.fn(),
  videoAvailable: vi.fn(),
  prepareVideoUpload: vi.fn(),
  finalizeVideo: vi.fn(),
  signedUrls: vi.fn(),
  remove: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: mocks.logError }));
vi.mock("@/lib/admin/cron-run", () => ({ recordCron: mocks.recordCron }));
vi.mock("@/lib/rate-limit", () => {
  class RateLimitError extends Error {}
  return { rateLimit: mocks.rateLimit, RateLimitError };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: (bucket: string) => ({ createSignedUrls: (paths: string[], s: number) => mocks.signedUrls(bucket, paths, s), remove: mocks.remove }) } }) }));
vi.mock("@/lib/visuals/service", () => {
  class VisualError extends Error {}
  return { ROBOT_LEASE_MS: 15 * 60 * 1000, VisualError, videoAvailable: mocks.videoAvailable, prepareVideoUpload: mocks.prepareVideoUpload, finalizeVideo: mocks.finalizeVideo };
});

import { RateLimitError } from "@/lib/rate-limit";
import { VisualError } from "@/lib/visuals/service";
import { claimRobotVideos, completeRobotVideo, failRobotVideo, parseCounts, recordRobotRun, ROBOT_CLAIMS_PER_BUSINESS_HOUR, ROBOT_CLAIMS_PER_HOUR, robotStateOf, ROBOT_LEASE_MS, ROBOT_MAX_ATTEMPTS } from "@/lib/visuals/robot";
import type { VideoPlan } from "@/lib/visuals/types";

const NOW = new Date("2026-10-13T10:00:00Z");
const U = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const own = `${U}/gallery/aaaaaaaa-1000.jpg`;
const design = `${U}/designs/ai-1.png`;
const foreign = `${OTHER}/gallery/bbbbbbbb-1000.jpg`;

const plan = (photos: (string | null)[] = [own]): VideoPlan => ({
  version: 1,
  width: 1080,
  height: 1920,
  fps: 30,
  pack: "clean",
  colors: { background: "#000000", text: "#ffffff", accent: "#ff0000" },
  businessName: "Shop",
  scenes: photos.map((p, i) => ({ text: `Scene ${i}`, photoPath: p, durationMs: 4000, motion: "zoom-in" as const, role: "body" as const })),
  crossfadeMs: 500,
  totalMs: 12_000,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VIDEO_ROBOT_SECRET = "s3cret";
  mocks.prisma.business.findUnique.mockResolvedValue({ userId: U });
  mocks.videoAvailable.mockResolvedValue(true);
  mocks.prisma.contentVisual.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.contentVisual.findUnique.mockResolvedValue({ robotAttempts: 1 });
  mocks.prepareVideoUpload.mockResolvedValue({ path: `${U}/videos/v1-abcd1.mp4`, token: "t", signedUrl: "https://storage.example/upload?token=t", seconds: 12 });
  mocks.signedUrls.mockImplementation(async (_b: string, paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://storage.example/${p}?sig=1` })) }));
  mocks.recordCron.mockImplementation(async (_job: string, run: () => Promise<unknown>) => run());
  mocks.remove.mockResolvedValue({ data: [], error: null });
  mocks.rateLimit.mockResolvedValue(undefined);
});

describe("claiming videos", () => {
  it("leases each video atomically for 15 minutes and reserves its upload through prepareVideoUpload", async () => {
    mocks.prisma.contentVisual.findMany.mockResolvedValue([{ id: "v1", businessId: "b1", plan: plan([own, design, null]) }]);
    const jobs = await claimRobotVideos({ max: 3 }, NOW);
    expect(jobs).toHaveLength(1);
    const lease = mocks.prisma.contentVisual.updateMany.mock.calls[0][0];
    // Compare-and-set: still pending, under 3 failures, no live lease.
    expect(lease.where).toMatchObject({ id: "v1", kind: "video", status: "pending", robotAttempts: { lt: ROBOT_MAX_ATTEMPTS }, OR: [{ renderingUntil: null }, { renderingUntil: { lt: NOW } }] });
    expect(lease.data.renderingUntil).toEqual(new Date(NOW.getTime() + ROBOT_LEASE_MS));
    expect(lease.data.robotJobId).toBe(jobs[0].job);
    // The attempt counts from the claim, so a run killed mid-render still counts toward the 3.
    expect(lease.data.robotAttempts).toEqual({ increment: 1 });
    expect(mocks.prepareVideoUpload).toHaveBeenCalledWith({ userId: U, businessId: "b1", service: true }, "v1", { bytes: 8 * 1024 * 1024, mimeType: "video/mp4", durationMs: 12_000 });
    expect(jobs[0].upload).toEqual({ url: "https://storage.example/upload?token=t", contentType: "video/mp4" });
    expect(Object.keys(jobs[0].photoUrls).sort()).toEqual([design, own].sort());
    // No database ids or storage paths outside the signed URLs.
    expect(jobs[0]).not.toHaveProperty("id");
    expect(JSON.stringify(jobs[0])).not.toContain("b1");
  });

  it("skips a video another run (or the owner's browser) leased first", async () => {
    mocks.prisma.contentVisual.findMany.mockResolvedValue([{ id: "v1", businessId: "b1", plan: plan() }, { id: "v2", businessId: "b1", plan: plan() }]);
    mocks.prisma.contentVisual.updateMany.mockResolvedValueOnce({ count: 0 });
    const jobs = await claimRobotVideos({ max: 3 }, NOW);
    expect(jobs).toHaveLength(1);
    expect(mocks.prepareVideoUpload).toHaveBeenCalledTimes(1);
    expect(mocks.prepareVideoUpload.mock.calls[0][1]).toBe("v2");
  });

  it("only takes videos of companies that still have video, and stops at max", async () => {
    mocks.videoAvailable.mockImplementation(async (id: string) => id !== "nope");
    mocks.prisma.contentVisual.findMany.mockResolvedValue([
      { id: "v0", businessId: "nope", plan: plan() },
      { id: "v1", businessId: "b1", plan: plan() },
      { id: "v2", businessId: "b1", plan: plan() },
      { id: "v3", businessId: "b1", plan: plan() },
    ]);
    const jobs = await claimRobotVideos({ max: 2 }, NOW);
    expect(jobs).toHaveLength(2);
    expect(mocks.prepareVideoUpload.mock.calls.map((c) => c[1])).toEqual(["v1", "v2"]);
    expect(mocks.videoAvailable).toHaveBeenCalledTimes(2); // once per company
  });

  it("never signs a photo path the owner does not own", async () => {
    mocks.prisma.contentVisual.findMany.mockResolvedValue([{ id: "v1", businessId: "b1", plan: plan([foreign, own]) }]);
    const [job] = await claimRobotVideos({}, NOW);
    expect(Object.keys(job.photoUrls)).toEqual([own]);
    expect(mocks.signedUrls.mock.calls.flatMap((c) => c[1])).not.toContain(foreign);
  });

  it("releases the lease without counting an attempt when the owner has no seconds or room left", async () => {
    mocks.prisma.contentVisual.findMany.mockResolvedValue([{ id: "v1", businessId: "b1", plan: plan() }]);
    mocks.prepareVideoUpload.mockRejectedValue(new VisualError("Your plan's video seconds for this month are used up."));
    expect(await claimRobotVideos({}, NOW)).toEqual([]);
    const release = mocks.prisma.contentVisual.updateMany.mock.calls[1][0];
    expect(release.data).toEqual({ renderingUntil: null, robotJobId: null, robotAttempts: { decrement: 1 } });
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("claims at most 60 videos an hour in all and 10 per company", async () => {
    expect(ROBOT_CLAIMS_PER_HOUR).toEqual({ limit: 60, windowSeconds: 3600 });
    expect(ROBOT_CLAIMS_PER_BUSINESS_HOUR).toEqual({ limit: 10, windowSeconds: 3600 });
    mocks.prisma.contentVisual.findMany.mockResolvedValue([
      { id: "v1", businessId: "full", plan: plan() },
      { id: "v2", businessId: "full", plan: plan() },
      { id: "v3", businessId: "b1", plan: plan() },
      { id: "v4", businessId: "b1", plan: plan() },
    ]);
    mocks.prisma.business.findUnique.mockResolvedValue({ userId: U });
    mocks.rateLimit.mockImplementation(async (key: string) => {
      if (key === "video-robot-claims:full") throw new RateLimitError(60);
    });
    let jobs = await claimRobotVideos({ max: 5 }, NOW);
    expect(mocks.prepareVideoUpload.mock.calls.map((c) => c[1])).toEqual(["v3", "v4"]);
    expect(jobs).toHaveLength(2);
    // The global cap stops the claim altogether.
    vi.clearAllMocks();
    mocks.rateLimit.mockRejectedValue(new RateLimitError(60));
    jobs = await claimRobotVideos({ max: 5 }, NOW);
    expect(jobs).toEqual([]);
    expect(mocks.prisma.contentVisual.updateMany).not.toHaveBeenCalled();
  });

  it("reserves a WebM upload when the robot can only make WebM", async () => {
    mocks.prisma.contentVisual.findMany.mockResolvedValue([{ id: "v1", businessId: "b1", plan: plan() }]);
    const [job] = await claimRobotVideos({ format: "webm" }, NOW);
    expect(mocks.prepareVideoUpload.mock.calls[0][2].mimeType).toBe("video/webm");
    expect(job.upload.contentType).toBe("video/webm");
  });
});

const held = (over: object = {}) => ({ id: "v1", businessId: "b1", plan: plan(), uploadPath: `${U}/videos/v1-abcd1.mp4`, renderingUntil: new Date(NOW.getTime() + 60_000), business: { userId: U }, ...over });

describe("completing a job", () => {
  it("runs the browser's finalize (same checks, billing and hooks) on the reserved file", async () => {
    mocks.prisma.contentVisual.findUnique.mockResolvedValueOnce(held());
    mocks.finalizeVideo.mockResolvedValue({ path: `${U}/videos/v1-abcd1.mp4`, seconds: 12 });
    expect(await completeRobotVideo("job-1", NOW)).toEqual({ ok: true, seconds: 12 });
    expect(mocks.prisma.contentVisual.findUnique.mock.calls[0][0].where).toEqual({ robotJobId: "job-1" });
    expect(mocks.finalizeVideo).toHaveBeenCalledWith({ userId: U, businessId: "b1", service: true }, "v1", { path: `${U}/videos/v1-abcd1.mp4`, durationMs: 12_000 }, { robotJob: "job-1" });
  });

  it("refuses an unknown job or one whose lease ran out", async () => {
    mocks.prisma.contentVisual.findUnique.mockResolvedValueOnce(null);
    expect(await completeRobotVideo("nope", NOW)).toEqual({ ok: false, error: "unknown_job" });
    mocks.prisma.contentVisual.findUnique.mockResolvedValueOnce(held({ renderingUntil: new Date(NOW.getTime() - 1) }));
    expect(await completeRobotVideo("late", NOW)).toEqual({ ok: false, error: "unknown_job" });
    expect(mocks.finalizeVideo).not.toHaveBeenCalled();
    // The late robot's file and reservation go.
    expect(mocks.remove).toHaveBeenCalledWith([`${U}/videos/v1-abcd1.mp4`]);
    expect(mocks.prisma.contentVisual.updateMany.mock.calls.map((c) => c[0].data)).toEqual([{ uploadPath: null, uploadBytes: 0, uploadExpiresAt: null }, { renderingUntil: null, robotJobId: null }]);
  });

  it("a rejected file releases the lease (the attempt was counted at claim)", async () => {
    mocks.prisma.contentVisual.findUnique.mockResolvedValueOnce(held());
    mocks.finalizeVideo.mockRejectedValue(new VisualError("Videos can be at most 30 seconds long."));
    expect(await completeRobotVideo("job-1", NOW)).toEqual({ ok: false, error: "rejected" });
    const release = mocks.prisma.contentVisual.updateMany.mock.calls.at(-1)![0];
    expect(release).toEqual({ where: { id: "v1", robotJobId: "job-1" }, data: { renderingUntil: null, robotJobId: null } });
  });
});

describe("failing a job", () => {
  it("releases lease and reservation and deletes the file (the attempt was counted at claim)", async () => {
    mocks.prisma.contentVisual.findUnique.mockResolvedValueOnce(held()).mockResolvedValueOnce({ robotAttempts: 3 });
    expect(await failRobotVideo("job-1", "timeout", NOW)).toEqual({ ok: true, attempts: 3 });
    expect(mocks.remove).toHaveBeenCalledWith([`${U}/videos/v1-abcd1.mp4`]);
    const calls = mocks.prisma.contentVisual.updateMany.mock.calls.map((c) => c[0]);
    expect(calls[0].data).toEqual({ uploadPath: null, uploadBytes: 0, uploadExpiresAt: null });
    expect(calls[1].data).toEqual({ renderingUntil: null, robotJobId: null });
  });

  it("does nothing for a job it does not hold", async () => {
    mocks.prisma.contentVisual.findUnique.mockResolvedValueOnce(null);
    expect(await failRobotVideo("x", "render_failed", NOW)).toEqual({ ok: false });
    expect(mocks.prisma.contentVisual.updateMany).not.toHaveBeenCalled();
  });
});

describe("what the owner sees", () => {
  const row = (over: object = {}) => ({ kind: "video", status: "pending", robotAttempts: 0, robotJobId: null, renderingUntil: null, ...over });
  it("queued, making, then left to the browser after 3 failures", () => {
    expect(robotStateOf(row(), NOW)).toBe("queued");
    expect(robotStateOf(row({ robotJobId: "j", renderingUntil: new Date(NOW.getTime() + 1000) }), NOW)).toBe("making");
    expect(robotStateOf(row({ robotJobId: "j", renderingUntil: new Date(NOW.getTime() - 1000) }), NOW)).toBe("queued");
    expect(robotStateOf(row({ robotAttempts: 3 }), NOW)).toBe("browser");
    // The third try in progress is still "making".
    expect(robotStateOf(row({ robotAttempts: 3, robotJobId: "j", renderingUntil: new Date(NOW.getTime() + 1000) }), NOW)).toBe("making");
    expect(robotStateOf(row({ status: "ready" }), NOW)).toBeNull();
  });
  it("nothing while the robot is off", () => {
    delete process.env.VIDEO_ROBOT_SECRET;
    expect(robotStateOf(row(), NOW)).toBeNull();
  });
});

describe("heartbeat", () => {
  it("records counts only", async () => {
    await recordRobotRun({ claimed: 2, made: 1, failed: 1 });
    expect(mocks.recordCron).toHaveBeenCalledWith("video-robot", expect.any(Function));
    expect(await mocks.recordCron.mock.results[0].value).toEqual({ claimed: 2, made: 1, failed: 1, ok: true });
    expect(parseCounts('{"made":2,"failed":1,"ok":true}')).toEqual({ made: 2, failed: 1 });
    expect(parseCounts("not json")).toEqual({ made: 0, failed: 0 });
  });
});

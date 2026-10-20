import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Premium 3D as VideoJobs (lib/video-studio/premium-jobs.ts). No Blender and no Claude here: the scene designer and the
// renderer are mocked, the database is an in-memory VideoJob table.
type Row = Record<string, unknown> & { id: string; status: string; createdAt: Date };
const db = vi.hoisted(() => ({ jobs: new Map<string, Record<string, unknown>>(), next: 0 }));
const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "in" in (v as object)) return ((v as { in: unknown[] }).in).includes(row[k]);
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
const prisma = vi.hoisted(() => ({
  videoJob: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const id = `cpremium${String(++db.next).padStart(15, "0")}`;
      db.jobs.set(id, { attempts: 0, refundedAt: null, parentId: null, createdAt: new Date(Date.now() + db.next), ...data, id });
      return { id };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = db.jobs.get(where.id as string);
      if (!row || !matches(row, where)) return { count: 0 };
      const inc = (data.attempts as { increment?: number } | undefined)?.increment;
      db.jobs.set(row.id as string, { ...row, ...data, ...(inc ? { attempts: (row.attempts as number) + inc } : {}) });
      return { count: 1 };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = { ...db.jobs.get(where.id), ...data };
      db.jobs.set(where.id, row);
      return row;
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => [...db.jobs.values()].filter((r) => matches(r, where)).sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime())),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => [...db.jobs.values()].find((r) => matches(r, where)) ?? null),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => withRelations(db.jobs.get(where.id))),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => withRelations(db.jobs.get(where.id))!),
  },
}));
const withRelations = (r: Record<string, unknown> | undefined) => (r ? { ...r, business: { userId: "company-1" }, product: { name: "LEAF Hydro Tower" } } : null);

const m = vi.hoisted(() => ({
  consume: vi.fn(async () => ({ periodStart: new Date("2026-10-01T00:00:00Z") })),
  refund: vi.fn(async () => undefined),
  enabled: vi.fn(async () => true),
  design: vi.fn(),
  save: vi.fn(),
  prepare: vi.fn(),
  upload: vi.fn(async () => ({ error: null })),
  unavailable: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/usage", () => ({ consumeUsage: m.consume, refundUsage: m.refund }));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: m.enabled }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/video-engine/blender-design", () => ({ designBlenderScene: m.design }));
vi.mock("@/lib/media/service", () => ({ MediaError: class MediaError extends Error {}, prepareUploads: m.prepare }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: m.upload }) } }) }));
vi.mock("@/lib/music/service", () => ({ trackForVideo: vi.fn(async () => null), musicUrl: (p: string) => `https://x.test/${p}` }));
vi.mock("@/lib/video-studio/library", () => ({ saveJobVideo: m.save, studioFolder: vi.fn(async () => "folder:studio") }));
vi.mock("@/lib/video-studio/jobs", () => ({
  DESIGN_LEASE_MS: 600_000,
  VideoStudioError: class VideoStudioError extends Error {
    constructor(
      message: string,
      public code: string,
      public status: number,
    ) {
      super(message);
    }
  },
  designUnavailable: m.unavailable,
  ledgeredClaude: vi.fn(() => vi.fn()),
}));
const photoB64 = vi.hoisted(() => ({ value: "" }));
vi.mock("@/lib/video-studio/brief", () => ({
  loadBriefFacts: vi.fn(async () => ({ productId: "p1", business: { name: "LEAF Business", country: "Rwanda" }, product: { name: "LEAF Hydro Tower" } })),
  choosePhotos: vi.fn(async () => [{ path: "u1/gallery/tower.jpg", width: 400, height: 220, note: null, cutoutBox: null, cutoutPath: null }]),
  readPhotos: vi.fn(async () => [{ base64: photoB64.value, mediaType: "image/jpeg", width: 400, height: 220 }]),
}));

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "premium-vj-"));
photoB64.value = (await sharp({ create: { width: 400, height: 220, channels: 3, background: "#3a6" } }).jpeg().toBuffer()).toString("base64");
const P = await import("@/lib/video-studio/premium-jobs");
afterAll(() => fs.rm(dir, { recursive: true, force: true }));

const owner = { userId: "company-1", actorId: "person-1", businessId: "biz-1" };
const input = { productId: "p1", templateId: "product-hero", hookId: "auto", ratio: "9:16" as const, seconds: 6, quality: "540p" as const, music: false };
const scene = { duration: 6, canvas: { quality: "540p", ratio: "9:16" } };
const designed = { scene, caption: "Grow greens at home", hashtags: ["#Kigali"], say: "Fresh greens", warnings: [], factWarnings: [], usage: [], costUsd: 0, apiEquivalentUsd: 0.085, attempts: 1 };
const renderer = vi.fn(async (_scene: unknown, outPath: string) => {
  const b = Buffer.alloc(2048);
  b.write("ftypisom", 4, "latin1");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, b);
  return { bytes: b.length, seconds: 95 };
});
const deps = (extra = {}) => ({ dataDir: dir, transport: vi.fn() as never, ...extra });
const row = (id: string) => db.jobs.get(id) as Row;
const settled = async (id: string, status: string) => vi.waitFor(() => expect(row(id).status).toBe(status), { timeout: 3000, interval: 10 });

beforeEach(() => {
  db.jobs.clear();
  vi.clearAllMocks();
  m.enabled.mockResolvedValue(true);
  m.unavailable.mockResolvedValue(null);
  m.design.mockResolvedValue(designed);
  m.prepare.mockResolvedValue([{ ok: true, path: "company-1/clips/x.mp4", token: "t" }]);
  m.save.mockImplementation(async (_ctx: unknown, id: string) => {
    db.jobs.set(id, { ...row(id), status: "ready", videoPath: "company-1/clips/x.mp4" });
    return {};
  });
});

describe("Premium 3D as VideoJobs", () => {
  it("is coming soon for clients until the owner switches premium3d on: nothing is charged", async () => {
    m.enabled.mockResolvedValueOnce(false);
    await expect(P.startPremiumJob(owner, input, deps())).rejects.toMatchObject({ status: 503, message: "Premium 3D is coming soon." });
    expect(m.enabled).toHaveBeenCalledWith("premium3d");
    expect(m.consume).not.toHaveBeenCalled();
    expect(db.jobs.size).toBe(0);
  });

  it("reserves 100 credits at 540p, designs the scene, queues it, renders it and saves the MP4 to the Gallery", async () => {
    const onQueued = vi.fn();
    const id = await P.startPremiumJob(owner, input, deps({ onQueued }));
    expect(m.consume).toHaveBeenCalledWith("company-1", "videoCredits", 100);
    expect(row(id)).toMatchObject({ engine: "premium3d", status: expect.stringMatching(/designing|queued/), quality: "540p", credits: 100 });
    await settled(id, "queued");
    expect(onQueued).toHaveBeenCalled();
    expect(row(id)).toMatchObject({ scene, caption: "Grow greens at home", hashtags: ["#Kigali"] });
    // Blender reads server-written photo files from the job's own folder.
    const photos = (m.design.mock.calls[0] as unknown[])[3] as { photos: { image: string }[] };
    expect(photos.photos[0].image).toBe(path.join(dir, id, "photo-1.jpg"));
    expect(await P.renderNextPremiumJob({ render: renderer, dataDir: dir })).toBe("ready");
    expect(renderer).toHaveBeenCalledWith(expect.objectContaining({ canvas: expect.objectContaining({ quality: "540p" }) }), path.join(dir, id, "clip.mp4"), expect.objectContaining({ jobDir: path.join(dir, id) }));
    expect(m.save).toHaveBeenCalledWith({ userId: "company-1", businessId: "biz-1" }, id, expect.objectContaining({ path: "company-1/clips/x.mp4", destination: "folder:studio" }), { engine: "premium3d" });
    expect(row(id)).toMatchObject({ status: "ready", attempts: 1 });
    expect(m.refund).not.toHaveBeenCalled();
    expect(await P.renderNextPremiumJob({ render: renderer, dataDir: dir })).toBe("none");
  });

  it("a failed design and a failed render each give the credits back exactly once", async () => {
    m.design.mockRejectedValueOnce(new Error("Claude said no"));
    const a = await P.startPremiumJob(owner, input, deps());
    await settled(a, "failed");
    expect(row(a).error).toBe(P.PREMIUM_MESSAGES.design);
    expect(m.refund).toHaveBeenCalledTimes(1);
    expect(m.refund).toHaveBeenLastCalledWith("company-1", "videoCredits", new Date("2026-10-01T00:00:00Z"), 100);
    expect(await P.failPremiumOnce(a, "again", ["failed", "designing"])).toBe(false);
    expect(m.refund).toHaveBeenCalledTimes(1);

    const b = await P.startPremiumJob(owner, { ...input, quality: "720p" }, deps());
    await settled(b, "queued");
    expect(await P.renderNextPremiumJob({ render: vi.fn(async () => Promise.reject(new Error("Blender crashed"))), dataDir: dir })).toBe("failed");
    expect(row(b)).toMatchObject({ status: "failed", error: P.PREMIUM_MESSAGES.render });
    expect(m.refund).toHaveBeenCalledTimes(2);
    expect(m.refund).toHaveBeenLastCalledWith("company-1", "videoCredits", expect.any(Date), 150);
  });

  it("a re-render is a child job of a finished clip (70 credits, the parent's scene at the new size)", async () => {
    const id = await P.startPremiumJob(owner, input, deps());
    await settled(id, "queued");
    await expect(P.rerenderPremiumJob(owner, id, "720p", {})).rejects.toMatchObject({ status: 404 });
    await P.renderNextPremiumJob({ render: renderer, dataDir: dir });
    const child = await P.rerenderPremiumJob(owner, id, "720p", {});
    expect(m.consume).toHaveBeenLastCalledWith("company-1", "videoCredits", 70);
    expect(row(child)).toMatchObject({ parentId: id, status: "queued", quality: "720p", credits: 70, scene: { ...scene, canvas: { ...scene.canvas, quality: "720p" } } });
    expect(await P.renderNextPremiumJob({ render: renderer, dataDir: dir })).toBe("ready");
    // The child reads its parent's photo files, still on this computer.
    expect(renderer).toHaveBeenLastCalledWith(expect.anything(), path.join(dir, child, "clip.mp4"), expect.objectContaining({ photos: [expect.objectContaining({ image: path.join(dir, id, "photo-1.jpg") })] }));
    // Another business cannot re-render it.
    await expect(P.rerenderPremiumJob({ ...owner, businessId: "biz-2" }, id, "540p", {})).rejects.toMatchObject({ status: 404 });
  });

  it("after a restart: a design that was running is failed and refunded, a render goes back in the queue once", async () => {
    const at = new Date();
    db.jobs.set("cdesigning000000000000001", { id: "cdesigning000000000000001", engine: "premium3d", status: "designing", attempts: 0, credits: 100, periodStart: at, refundedAt: null, createdAt: at });
    db.jobs.set("crendering000000000000001", { id: "crendering000000000000001", engine: "premium3d", status: "rendering", attempts: 1, credits: 100, periodStart: at, refundedAt: null, createdAt: at });
    db.jobs.set("crendering000000000000002", { id: "crendering000000000000002", engine: "premium3d", status: "rendering", attempts: 2, credits: 150, periodStart: at, refundedAt: null, createdAt: at });
    expect(await P.recoverPremiumJobs()).toEqual({ failed: 2, requeued: 1 });
    expect(row("cdesigning000000000000001")).toMatchObject({ status: "failed", error: P.PREMIUM_MESSAGES.restart });
    expect(row("crendering000000000000001").status).toBe("queued");
    expect(row("crendering000000000000002").status).toBe("failed");
    expect(m.refund).toHaveBeenCalledTimes(2);
  });

  it("the loop renders queued clips one after another through the shared queue", async () => {
    const a = await P.startPremiumJob(owner, input, deps());
    const b = await P.startPremiumJob(owner, input, deps());
    await settled(a, "queued");
    await settled(b, "queued");
    const serial = vi.fn((work: () => Promise<unknown>) => work());
    const loop = P.startPremiumRenderLoop({ render: renderer, dataDir: dir, serial: serial as unknown as <T>(work: () => Promise<T>) => Promise<T>, intervalMs: 60_000 });
    await settled(a, "ready");
    await settled(b, "ready");
    loop.stop();
    expect(serial).toHaveBeenCalledTimes(3); // two clips, then "none"
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Every Veo call is mocked (no spend): the fetch below answers as Google does.
const m = vi.hoisted(() => ({
  charge: vi.fn(),
  refund: vi.fn(async () => undefined),
  enabled: vi.fn(async () => true),
  ledger: vi.fn(),
  record: vi.fn(async () => undefined),
  spent: vi.fn(async () => 0),
  prepareUploads: vi.fn(),
  finalizeUpload: vi.fn(),
  upload: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/lib/db", () => ({ prisma: { mediaFolder: { findUnique: vi.fn(async () => ({ id: "folder-1" })) } } }));
vi.mock("@/lib/admin/switch", () => ({ ServiceDisabledError: class ServiceDisabledError extends Error {}, isServiceEnabled: m.enabled }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: m.ledger }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: m.upload }) } }) }));
vi.mock("@/lib/media/service", () => ({ MediaError: class MediaError extends Error {}, createFolder: vi.fn(), prepareUploads: m.prepareUploads, finalizeUpload: m.finalizeUpload, setAssetDescription: vi.fn(async () => null) }));
vi.mock("@/video-lab/credits", () => ({ charge: m.charge, refund: m.refund }));
vi.mock("@/video-lab/store", () => ({ DAILY_CAP_USD: 5, record: m.record, spentToday: m.spent }));
vi.mock("@/video-lab/cutouts", () => ({ cutoutForPhoto: vi.fn(async () => ({ ok: false, reason: "scene" })) }));
vi.mock("@/video-lab/data-source", () => ({
  listProducts: vi.fn(async (businessId: string) => (businessId === "biz-1" ? [{ id: "p-1", name: "LEAF Hydro Tower", summary: "Grow greens at home.", photos: [{ assetId: "ph-1" }, { assetId: "ph-2" }] }] : [])),
  getBusiness: vi.fn(async () => ({ name: "LEAF Business", description: "Hydroponic towers for homes and schools", language: "en", colors: [], phone: "0788000000", website: null, country: "Rwanda", tone: null })),
  photoJpeg: vi.fn(async () => ({ bytes: await sharp({ create: { width: 400, height: 220, channels: 3, background: "#3a6" } }).jpeg().toBuffer(), width: 400, height: 220 })),
}));

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "veo-lab-"));
process.env.VEO_LAB_DIR = dir;
process.env.GEMINI_API_KEY = "test-key";
delete process.env.VEO_MODEL;
delete process.env.VEO_USD_PER_SECOND;

const { aiClipRecipe, aiClipRunView, aiClipsForBrief, aiClipsRecord, firstFrame, getAiClipRun, readNeeds, runMessage, startAiClips } = await import("@/video-lab/ai-clips");

afterAll(() => fs.rm(dir, { recursive: true, force: true }));

const me = { userId: "person-1", businessId: "biz-1", companyUserId: "owner-1", role: "MEMBER" };
const PAYER = { userId: "owner-1", periodStart: "2026-10-01T00:00:00.000Z" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const mp4 = () => {
  const b = Buffer.alloc(4096);
  b.write("ftypisom", 4, "latin1");
  return new Response(new Uint8Array(b), { status: 200 });
};

/** A fake Google: `plan` says, per submitted clip in order, how its operation ends. */
function google(plan: ("ok" | "blocked" | "busy" | "failed")[]) {
  let n = 0;
  const outcome = new Map<string, string>();
  const bodies: Record<string, unknown>[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith(":predictLongRunning")) {
      bodies.push(JSON.parse(String(init?.body)));
      const what = plan[n] ?? "ok";
      n += 1;
      if (what === "busy") return json({ error: { status: "UNAVAILABLE", message: "busy" } }, 503);
      const name = `models/veo/operations/op${n}`;
      outcome.set(name, what);
      return json({ name });
    }
    const op = url.match(/(models\/veo\/operations\/op\d+)$/)?.[1];
    if (op) {
      const what = outcome.get(op);
      if (what === "blocked") return json({ name: op, done: true, response: { generateVideoResponse: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ["person"] } } });
      if (what === "failed") return json({ name: op, done: true, error: { code: 13, message: "internal" } });
      return json({ name: op, done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `https://generativelanguage.googleapis.com/v1beta/files/${op.split("/").pop()}:download` } }] } } });
    }
    return mp4();
  });
  return { f, bodies };
}

const settle = async (runId: string) => {
  await vi.waitFor(async () => expect((await aiClipRunView((await getAiClipRun(runId))!)).done).toBe(true), { timeout: 5000, interval: 20 });
  return aiClipRunView((await getAiClipRun(runId))!);
};

beforeEach(() => {
  vi.clearAllMocks();
  m.charge.mockResolvedValue(PAYER);
  m.enabled.mockResolvedValue(true);
  m.spent.mockResolvedValue(0);
  m.prepareUploads.mockResolvedValue([{ ok: true, path: "owner-1/clips/c.mp4", token: "t" }]);
  m.finalizeUpload.mockResolvedValue({ id: "asset-7", path: "owner-1/clips/c.mp4" });
  m.ledger.mockImplementation(async (_ctx: unknown, _meta: unknown, call: () => Promise<unknown>) => call());
});

describe("AI clips (Veo) in the studio", () => {
  it("charges 65 credits a 4 s clip, makes 3 clips with the product photos as first frames, and saves them to the client's Gallery", async () => {
    const g = google(["ok", "ok", "ok"]);
    const run = await startAiClips(me, { businessId: "someone-else", productId: "p-1" }, { fetchImpl: g.f as unknown as typeof fetch, sleep: async () => {} });
    expect(m.charge).toHaveBeenCalledWith(195, "AI clips (Veo) x3", run.id);
    const view = await settle(run.id);
    expect(view.ready).toHaveLength(3);
    expect(view.message).toBe("All 3 AI clips are ready.");
    expect(view.clips.every((c) => c.url?.startsWith("/videos/veo/vc-"))).toBe(true);
    // The request Veo got: the photo as the first frame, 9:16, 720p, 4 s, adults only.
    expect(g.bodies[0]).toMatchObject({ instances: [{ image: { mimeType: "image/jpeg" } }], parameters: { aspectRatio: "9:16", resolution: "720p", durationSeconds: 4, personGeneration: "allow_adult" } });
    expect(String((g.bodies[0].instances as { prompt: string }[])[0].prompt)).toMatch(/Do not add any text/);
    // Each clip through the cost ledger as "veo", and into the Gallery's "AI clips" folder.
    expect(m.ledger).toHaveBeenCalledWith({ userId: "person-1", businessId: "biz-1", feature: "video-veo" }, { provider: "veo", model: "veo-3.1-lite-generate-preview" }, expect.any(Function), expect.any(Function));
    expect(m.prepareUploads).toHaveBeenCalledWith({ userId: "owner-1", businessId: "biz-1" }, [expect.objectContaining({ type: "video/mp4" })], "folder:folder-1");
    expect(m.refund).not.toHaveBeenCalled();
    // Into the design: the business's own ready clips, sound off; another business gets none.
    const brief = await aiClipsForBrief(view.ready, "biz-1");
    expect(brief).toHaveLength(3);
    expect(brief[0]).toMatchObject({ path: expect.stringMatching(/^\/videos\/veo\/vc-[0-9a-f]{12}\.mp4$/), source: "ai", seconds: 4, width: 720, height: 1280 });
    expect(await aiClipsForBrief(view.ready, "biz-2")).toEqual([]);
    expect(await aiClipsRecord(view.ready)).toMatchObject({ provider: "veo", credits: 195, costUsd: 0.6 });
  });

  it("retries a temporary error once, and refunds a blocked clip in plain English", async () => {
    const g = google(["busy", "ok", "blocked"]);
    const run = await startAiClips(me, { businessId: "biz-1", productId: "p-1", count: 2 }, { fetchImpl: g.f as unknown as typeof fetch, sleep: async () => {} });
    const view = await settle(run.id);
    expect(view.ready).toHaveLength(1);
    const failed = view.clips.find((c) => c.status === "failed");
    expect(failed?.error).toMatch(/declined this clip under its safety rules/);
    expect(m.refund).toHaveBeenCalledTimes(1);
    expect(m.refund).toHaveBeenCalledWith(65, "AI clip failed", failed?.id, PAYER);
    expect(view.message).toBe("1 of 2 AI clips are ready; 1 could not be made (its credits are back).");
  });

  it("gives up after the second try and refunds", async () => {
    const g = google(["failed", "failed"]);
    const run = await startAiClips(me, { businessId: "biz-1", productId: "p-1", count: 1 }, { fetchImpl: g.f as unknown as typeof fetch, sleep: async () => {} });
    const view = await settle(run.id);
    expect(view.clips[0]).toMatchObject({ status: "failed", tries: 2 });
    expect(m.refund).toHaveBeenCalledWith(65, "AI clip failed", view.clips[0].id, PAYER);
  });

  it("refuses before charging when Veo is switched off, the key is missing or the product is not the client's", async () => {
    m.enabled.mockResolvedValueOnce(false);
    await expect(startAiClips(me, { businessId: "biz-1", productId: "p-1" })).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/paused/) });
    await expect(startAiClips({ ...me, businessId: "biz-2" }, { businessId: "biz-1", productId: "p-1" })).rejects.toMatchObject({ status: 404 });
    process.env.GEMINI_API_KEY = "";
    await expect(startAiClips(me, { businessId: "biz-1", productId: "p-1" })).rejects.toMatchObject({ status: 503 });
    process.env.GEMINI_API_KEY = "test-key";
    expect(m.charge).not.toHaveBeenCalled();
  });

  it("keeps the owner's tests inside the lab's daily budget, and records their cost in the lab ledger", async () => {
    m.spent.mockResolvedValueOnce(4.9);
    await expect(startAiClips(null, { businessId: "biz-1", productId: "p-1" })).rejects.toMatchObject({ status: 429 });
    m.charge.mockResolvedValue(null);
    const g = google(["ok"]);
    const run = await startAiClips(null, { businessId: "biz-1", productId: "p-1", count: 1, seconds: 6 }, { fetchImpl: g.f as unknown as typeof fetch, sleep: async () => {} });
    expect(m.charge).toHaveBeenCalledWith(95, "AI clips (Veo) x1", run.id);
    await settle(run.id);
    expect(m.record).toHaveBeenCalledWith(expect.stringMatching(/^vc-/), "veo-clip", [expect.objectContaining({ inputTokens: 6, costUsd: 0.3 })]);
    expect(m.ledger).not.toHaveBeenCalled();
    expect(m.prepareUploads).not.toHaveBeenCalled();
  });

  it("makes the clips for a viral recipe's AI beats, and the design gets that same recipe back", async () => {
    const g = google(["ok", "ok", "ok"]);
    const run = await startAiClips(me, { businessId: "biz-1", productId: "p-1", count: 3, recipe: { styleId: "viral", platform: "tiktok", purpose: "ad", seconds: 15, ratio: "9:16" } }, { fetchImpl: g.f as unknown as typeof fetch, sleep: async () => {} });
    expect(run.recipe?.clipNeeds.some((n) => n.source === "ai")).toBe(true);
    const aiShots = run.recipe!.clipNeeds.filter((n) => n.source === "ai").map((n) => n.shot);
    const view = await settle(run.id);
    expect(view.clips.map((c) => c.shot)).toEqual(aiShots.slice(0, 3).map((x) => x.replace(/\s+/g, " ").trim().slice(0, 400)));
    expect(await aiClipRecipe(view.ready, "biz-1")).toEqual(run.recipe);
    expect(await aiClipRecipe(view.ready, "biz-2")).toBeNull();
  });

  it("reads clip needs from a recipe, and words the progress", () => {
    expect(readNeeds([{ shot: "Hands water the tower", camera: "slow tilt", people: false }, "x", "A close detail of the roots"], 4)).toEqual([
      { shot: "Hands water the tower", setting: null, camera: "slow tilt", seconds: 4, people: false },
      { shot: "A close detail of the roots", setting: null, camera: null, seconds: 4 },
    ]);
    expect(readNeeds([], 4)).toBeNull();
    // A viral recipe's needs: the phone and photo beats are not made here.
    expect(readNeeds([{ beat: 1, seconds: 6, shot: "Your phone clip: the shop", source: "phone" }, { beat: 2, seconds: 6, shot: "Hands pick lettuce", source: "ai" }], 4)).toEqual([{ shot: "Hands pick lettuce", setting: null, camera: null, seconds: 6 }]);
    expect(runMessage([{ status: "ready", error: null }, { status: "making", error: null }, { status: "queued", error: null }])).toMatch(/^Making AI clip 2 of 3/);
    expect(runMessage([{ status: "failed", error: "Google said no." }])).toBe("The AI clip could not be made: Google said no. Your credits are back.");
  });

  it("crops the first frame to the clip's shape around the product", async () => {
    const photo = await sharp({ create: { width: 2048, height: 1143, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    const meta = await sharp(await firstFrame(photo, "9:16", { x: 0.7, y: 0.2, w: 0.1, h: 0.6 })).metadata();
    expect([meta.width, meta.height]).toEqual([720, 1280]);
    const wide = await sharp(await firstFrame(photo, "16:9", null)).metadata();
    expect([wide.width, wide.height]).toEqual([1280, 720]);
  });
});

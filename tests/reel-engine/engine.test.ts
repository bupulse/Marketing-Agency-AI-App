import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const jobs = new Map<string, Record<string, unknown>>();
  return {
    jobs,
    switchOn: { value: true },
    spent: { value: 0 },
    design: vi.fn(),
    submit: vi.fn(),
    poll: vi.fn(),
    upload: vi.fn(async () => ({ error: null })),
    prisma: {
      reelPresenter: { findUnique: vi.fn(async () => ({ path: "u1/designs/p.png", description: "a Black Rwandan woman" })), upsert: vi.fn() },
      reelJob: {
        aggregate: vi.fn(async () => ({ _sum: { costUsd: h.spent.value } })),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: "job1", costUsd: 0, ...data };
          jobs.set("job1", row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = jobs.get(where.id)!;
          for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === "object" && "increment" in (v as object) ? (row[k] as number) + (v as { increment: number }).increment : v;
          return row;
        }),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => jobs.get(where.id) ?? null),
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async ({ where }: { where: { id?: string; businessId: string } }) => (where.id ? (jobs.get(where.id) ?? null) : ([...jobs.values()].at(-1) ?? null))),
      },
    },
  };
});

vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: async () => h.switchOn.value }));
vi.mock("@/lib/ai", () => ({ getTextProvider: () => ({ name: "gemini", generate: async () => ({ text: "{}", provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } }) }) }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: async (_c: unknown, _m: unknown, call: () => unknown) => call() }));
vi.mock("@/lib/designs/service", () => ({ createEngineDesign: h.design, designUrls: async () => new Map() }));
vi.mock("@/lib/image-engine/check", () => ({ checkPicture: async () => ({ ok: true, problems: [], fix: null, ran: true }) }));
vi.mock("@/lib/image-engine/planner", () => ({ claudeJson: async () => null }));
vi.mock("@/lib/image-engine/engine", () => ({
  loadFacts: async () => ({ business: { audience: null }, facts: { name: "LEAF", industry: null, description: "Towers", audience: null, place: "Kigali", language: "English", voice: null, colors: [] }, subject: { name: "Tower", description: null, price: null, sellingPoints: [] }, photos: ["u1/gallery/a.jpg"], reviews: [], hasPrice: false }),
}));
vi.mock("@/lib/music/service", () => ({ musicUrl: (p: string) => p, trackForVideo: async () => null }));
vi.mock("@/lib/storage", () => ({ createSignedUploadUrl: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array([0x89, 1, 2])]), error: null }), upload: h.upload, createSignedUrls: async () => ({ data: [] }) }) } }) }));
vi.mock("@/lib/video-engine/veo", async (orig) => ({ ...(await orig<typeof import("@/lib/video-engine/veo")>()), submitVeo: h.submit, getVeoOperation: h.poll, veoClipBytes: undefined, downloadVeo: async () => Buffer.from([0, 0, 0, 24]) }));

import { latestReel, reelEngineOn, retryReel, startReel, stepReel } from "@/lib/reel-engine/engine";
import { veoClipUsd, veoModel } from "@/lib/video-engine/veo";

const owner = { userId: "u1", businessId: "b1" };

beforeEach(() => {
  h.jobs.clear();
  h.switchOn.value = true;
  h.spent.value = 0;
  process.env.REEL_ENGINE_BUSINESSES = "b1";
  process.env.GEMINI_API_KEY = "test-key";
  let n = 0;
  h.design.mockReset().mockImplementation(async () => ({ id: `d${++n}`, path: `u1/designs/f${n}.png`, mimeType: "image/png", bytes: new Uint8Array([1]) }));
  h.submit.mockReset().mockImplementation(async () => `models/veo/operations/op${Math.random()}`);
  h.poll.mockReset().mockResolvedValue({ name: "op", done: true, videoUri: "https://generativelanguage.googleapis.com/v.mp4", error: null });
});

describe("the reel engine (test only)", () => {
  it("is on only with the Veo switch, the key and the company on the test list", async () => {
    expect(await reelEngineOn("b1")).toBe(true);
    expect(await reelEngineOn("b2")).toBe(false);
    h.switchOn.value = false;
    expect(await reelEngineOn("b1")).toBe(false);
  });

  it("refuses a reel that would pass the test budget", async () => {
    h.spent.value = 9;
    await expect(startReel(owner, { language: "Kinyarwanda", tier: "lite" })).rejects.toThrow(/test budget is used/);
  });

  it("frames the 4 clips one step at a time, then sends them to Veo, then saves the clips and is ready to join", async () => {
    const id = await startReel(owner, { language: "English", tier: "lite", subjectId: "p1" });
    for (let i = 0; i < 4; i++) await stepReel(owner, id);
    expect(h.design).toHaveBeenCalledTimes(4);
    expect(h.design.mock.calls[0][0]).toMatchObject({ aspectRatio: "9:16", model: "gemini-3.1-flash-image", usePhotoPath: "u1/gallery/a.jpg" });
    expect(h.submit).not.toHaveBeenCalled();
    await stepReel(owner, id);
    expect(h.submit).toHaveBeenCalledTimes(4);
    expect(h.submit.mock.calls[0][0]).toMatchObject({ ratio: "9:16", seconds: 8, resolution: "720p", image: { mimeType: "image/png" } });
    const job = h.jobs.get(id)!;
    expect(job.status).toBe("assembling");
    expect(h.upload).toHaveBeenCalledTimes(4);
    expect(job.costUsd).toBeCloseTo(4 * 0.067 + 4 * veoClipUsd(8, veoModel()), 2);
  });

  it("a clip Google refuses is sent again twice (refusals cost nothing), then fails the reel with the reason", async () => {
    const id = await startReel(owner, { language: "English", tier: "lite" });
    for (let i = 0; i < 4; i++) await stepReel(owner, id);
    const refused = { name: "op", done: true, videoUri: null, error: new Error("Google declined this clip under its safety rules.") };
    h.poll.mockResolvedValueOnce(refused);
    await stepReel(owner, id);
    expect(h.jobs.get(id)).toMatchObject({ status: "filming" });
    expect(h.submit).toHaveBeenCalledTimes(4);
    h.poll.mockResolvedValueOnce(refused);
    await stepReel(owner, id);
    expect(h.submit).toHaveBeenCalledTimes(5);
    h.poll.mockResolvedValueOnce(refused);
    await stepReel(owner, id);
    expect(h.submit).toHaveBeenCalledTimes(6);
    expect(h.jobs.get(id)).toMatchObject({ status: "failed" });
    expect(String(h.jobs.get(id)!.error)).toMatch(/safety rules/);
    expect(h.jobs.get(id)!.costUsd).toBeCloseTo(4 * 0.067 + 3 * veoClipUsd(8, veoModel()), 2);

    // "Try the failed clips again": the 3 filmed clips are kept, only the failed one is filmed again.
    await retryReel(owner, id);
    expect(h.jobs.get(id)).toMatchObject({ status: "filming", error: null });
    await stepReel(owner, id);
    expect(h.submit).toHaveBeenCalledTimes(7);
    expect(h.jobs.get(id)).toMatchObject({ status: "assembling" });
  });
});

describe("the presenter", () => {
  it("is always described fully, whatever the company id", async () => {
    const { presenterDescription } = await import("@/lib/reel-engine/engine");
    for (const seed of ["cmv535q4400018345z64tfm4l", "a", "zzzzzzzzzzzzzzzzzzzzzzzzz", "b1", "9f94cabc-e849-4619"]) {
      const d = presenterDescription(seed, null);
      expect(d).not.toContain("undefined");
      expect(d).toMatch(/^a Black Rwandan (woman|man) in (her|his) /);
    }
  });
});

describe("carrying on with a reel", () => {
  it("the page gets the latest reel back, so an unfinished one carries on", async () => {
    expect(await latestReel(owner)).toBeNull();
    const id = await startReel(owner, { language: "Kinyarwanda", tier: "lite" });
    await stepReel(owner, id);
    const view = await latestReel(owner);
    expect(view).toMatchObject({ id, status: "filming", language: "Kinyarwanda" });
    expect(view!.clips.map((c) => c.status)).toEqual(["framed", "planned", "planned", "planned"]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const jobs = new Map<string, Record<string, unknown>>();
  return {
    jobs,
    switchOn: { value: true },
    spent: { value: 0 },
    photos: { value: ["u1/gallery/a.jpg"] },
    design: vi.fn(),
    submit: vi.fn(),
    poll: vi.fn(),
    upload: vi.fn(async () => ({ error: null })),
    check: vi.fn(async () => ({ ok: true, problems: [] as string[], ran: true })),
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
vi.mock("@/lib/reel-engine/checker", () => ({ checkClip: h.check }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: async () => h.switchOn.value }));
vi.mock("@/lib/ai", () => ({ getTextProvider: () => ({ name: "gemini", generate: async () => ({ text: "{}", provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } }) }) }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: async (_c: unknown, _m: unknown, call: () => unknown) => call() }));
vi.mock("@/lib/designs/service", () => ({ createEngineDesign: h.design, designUrls: async () => new Map(), DesignError: class DesignError extends Error {} }));
vi.mock("@/lib/image-engine/check", () => ({ checkPicture: async () => ({ ok: true, problems: [], fix: null, ran: true }) }));
vi.mock("@/lib/image-engine/planner", () => ({ claudeJson: async () => null }));
vi.mock("@/lib/image-engine/engine", () => ({
  loadFacts: async () => ({ business: { audience: null }, facts: { name: "LEAF", industry: null, description: "Towers", audience: null, place: "Kigali", language: "English", voice: null, colors: [] }, subject: { name: "Tower", description: null, price: null, sellingPoints: [] }, photos: h.photos.value, reviews: [], hasPrice: false }),
}));
vi.mock("@/lib/music/service", () => ({ musicUrl: (p: string) => p, trackForVideo: async () => null }));
vi.mock("@/lib/storage", () => ({ createSignedUploadUrl: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array([0x89, 1, 2])]), error: null }), upload: h.upload, createSignedUrls: async () => ({ data: [] }) }) } }) }));
vi.mock("@/lib/video-engine/veo", async (orig) => ({ ...(await orig<typeof import("@/lib/video-engine/veo")>()), submitVeo: h.submit, getVeoOperation: h.poll, veoClipBytes: undefined, downloadVeo: async () => Buffer.from([0, 0, 0, 24]) }));

import { BUSY_GIVE_UP_MS, framePhotos, latestReel, QUOTA_MESSAGE, reelEngineOn, retryReel, startReel, stepReel } from "@/lib/reel-engine/engine";
import { veoClipUsd, veoModel } from "@/lib/video-engine/veo";

const owner = { userId: "u1", businessId: "b1" };

/** Steps until the reel is no longer filming (one finished clip is saved, or one saved clip checked, per step). */
async function settle(id: string) {
  for (let n = 0; n < 40 && h.jobs.get(id)!.status === "filming"; n++) await stepReel(owner, id);
}

/** Starts a reel and takes its two planning steps (the presenter, then the script), as the screen does. */
async function begin(request: Parameters<typeof startReel>[1]) {
  const id = await startReel(owner, request);
  await stepReel(owner, id);
  await stepReel(owner, id);
  return id;
}

beforeEach(() => {
  h.jobs.clear();
  h.switchOn.value = true;
  h.spent.value = 0;
  h.photos.value = ["u1/gallery/a.jpg"];
  process.env.REEL_ENGINE_BUSINESSES = "b1";
  process.env.GEMINI_API_KEY = "test-key";
  let n = 0;
  h.design.mockReset().mockImplementation(async () => ({ id: `d${++n}`, path: `u1/designs/f${n}.png`, mimeType: "image/png", bytes: new Uint8Array([1]) }));
  h.submit.mockReset().mockImplementation(async () => `models/veo/operations/op${Math.random()}`);
  h.check.mockReset().mockResolvedValue({ ok: true, problems: [], ran: true });
  h.poll.mockReset().mockResolvedValue({ name: "op", done: true, videoUri: "https://generativelanguage.googleapis.com/v.mp4", error: null });
});

describe("the reel engine (test only)", () => {
  it("is on only with the Veo switch, the key and the company on the test list", async () => {
    expect(await reelEngineOn("b1")).toBe(true);
    expect(await reelEngineOn("b2")).toBe(false);
    h.switchOn.value = false;
    expect(await reelEngineOn("b1")).toBe(false);
  });

  it("paints every frame of a reel from the same product photo (an album can show several models)", async () => {
    h.photos.value = ["u1/gallery/spiral.jpg", "u1/gallery/pots.jpg", "u1/gallery/tree.jpg"];
    const id = await begin({ language: "English", tier: "lite", subjectId: "p1" });
    for (let i = 0; i < 7; i++) await stepReel(owner, id);
    expect(h.design).toHaveBeenCalledTimes(7);
    expect(new Set(h.design.mock.calls.map((c) => (c[0] as { usePhotoPath: string }).usePhotoPath))).toEqual(new Set(["u1/gallery/spiral.jpg"]));
    expect((h.jobs.get(id)!.plan as { productPhoto: string }).productPhoto).toBe("u1/gallery/spiral.jpg");
  });

  it("tries the reel's own photo first, then the rest of the album", () => {
    expect(framePhotos(["a", "b", "c"], null)).toEqual(["a", "b", "c"]);
    expect(framePhotos(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  it("refuses a reel that would pass the test budget", async () => {
    h.spent.value = 9;
    await expect(startReel(owner, { language: "Kinyarwanda", tier: "lite" })).rejects.toThrow(/test budget is used/);
  });

  it("frames the 4 clips one step at a time, then sends them to Veo, then saves the clips and is ready to join", async () => {
    const id = await begin({ language: "English", tier: "lite", subjectId: "p1" });
    for (let i = 0; i < 7; i++) await stepReel(owner, id);
    expect(h.design).toHaveBeenCalledTimes(7);
    expect(h.design.mock.calls[0][0]).toMatchObject({ aspectRatio: "9:16", model: "gemini-3.1-flash-image", usePhotoPath: "u1/gallery/a.jpg" });
    expect(h.submit).not.toHaveBeenCalled();
    await stepReel(owner, id);
    // At most 3 clips filming at once: Google answers more with RESOURCE_EXHAUSTED.
    expect(h.submit).toHaveBeenCalledTimes(3);
    expect(h.submit.mock.calls[0][0]).toMatchObject({ ratio: "9:16", seconds: 8, resolution: "720p", image: { mimeType: "image/png" } });
    // One finished clip is saved and checked per step, so no request runs long.
    expect(h.upload).toHaveBeenCalledTimes(1);
    await settle(id);
    const job = h.jobs.get(id)!;
    expect(job.status).toBe("assembling");
    expect(h.upload).toHaveBeenCalledTimes(7);
    expect(job.costUsd).toBeCloseTo(7 * 0.067 + 3 * veoClipUsd(8, veoModel()) + 4 * veoClipUsd(4, veoModel()), 2);
  });

  it("a clip Google refuses is sent again twice (refusals cost nothing), then fails the reel with the reason", async () => {
    const id = await begin({ language: "English", tier: "lite" });
    for (let i = 0; i < 7; i++) await stepReel(owner, id);
    const refused = { name: "op", done: true, videoUri: null, error: new Error("Google declined this clip under its safety rules.") };
    // The first clip sent (the hook) is refused every time; each refusal sends it again at a later step.
    let k = 0;
    let hookPrompt: string | null = null;
    const hookOps = new Set<string>();
    h.submit.mockImplementation(async (req: { prompt: string }) => {
      const op = `models/veo/operations/op${++k}`;
      hookPrompt ??= req.prompt;
      if (req.prompt === hookPrompt) hookOps.add(op);
      return op;
    });
    h.poll.mockImplementation(async (op: string) => (hookOps.has(op) ? refused : { name: op, done: true, videoUri: "https://generativelanguage.googleapis.com/v.mp4", error: null }));
    // The other clips finish first, so trying again never pays for them twice.
    await settle(id);
    expect(h.submit).toHaveBeenCalledTimes(9);
    expect(h.jobs.get(id)).toMatchObject({ status: "failed" });
    expect(String(h.jobs.get(id)!.error)).toMatch(/safety rules/);
    // Only the filmed clips are paid; the refused one costs nothing.
    const filmed = (h.jobs.get(id)!.plan as { clips: { status: string; seconds: number }[] }).clips.filter((c) => c.status === "done");
    expect(filmed).toHaveLength(6);
    expect(h.jobs.get(id)!.costUsd).toBeCloseTo(7 * 0.067 + filmed.reduce((t, c) => t + veoClipUsd(c.seconds, veoModel()), 0), 2);

    // "Try the failed clips again": the filmed clips are kept, only the failed one is filmed again.
    h.poll.mockResolvedValue({ name: "op", done: true, videoUri: "https://generativelanguage.googleapis.com/v.mp4", error: null });
    await retryReel(owner, id);
    expect(h.jobs.get(id)).toMatchObject({ status: "filming", error: null });
    await settle(id);
    expect(h.submit).toHaveBeenCalledTimes(10);
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
    const id = await begin({ language: "Kinyarwanda", tier: "lite" });
    await stepReel(owner, id);
    const view = await latestReel(owner);
    expect(view).toMatchObject({ id, status: "filming", language: "Kinyarwanda" });
    expect(view!.clips.map((c) => c.status)).toEqual(["framed", "planned", "planned", "planned", "planned", "planned", "planned"]);
  });
});

describe("the clip checker in the engine", () => {
  it("films a clip again when the checker sees broken physics, telling the model what went wrong, at most twice a reel", async () => {
    const id = await begin({ language: "English", tier: "lite" });
    for (let i = 0; i < 7; i++) await stepReel(owner, id);
    h.check
      .mockResolvedValueOnce({ ok: false, problems: ["3 s: a man walks through the tower"], ran: true })
      .mockResolvedValueOnce({ ok: false, problems: ["5 s: her fingers melt into the leaves"], ran: true })
      .mockResolvedValueOnce({ ok: false, problems: ["1 s: a face changes"], ran: true });
    await settle(id);
    const plan = h.jobs.get(id)!.plan as { refilms: number; clips: { status: string; avoid?: string[]; problems?: string[] }[] };
    expect(plan.refilms).toBe(2);
    expect(plan.clips.every((c) => c.status === "done")).toBe(true);
    // Two clips were filmed again, each told what went wrong; the third bad take is kept with what the checker saw,
    // because the reel's 2 refilms were used.
    expect(plan.clips.flatMap((c) => c.avoid ?? []).sort()).toEqual(["3 s: a man walks through the tower", "5 s: her fingers melt into the leaves"]);
    expect(plan.clips.filter((c) => c.problems?.includes("1 s: a face changes"))).toHaveLength(1);
    expect(h.submit).toHaveBeenCalledTimes(9);
    expect(h.submit.mock.calls.map((c) => String(c[0].prompt)).join(" ")).toContain("avoid exactly this: 3 s: a man walks through the tower.");
    expect(h.jobs.get(id)).toMatchObject({ status: "assembling" });
    // 9 clips paid: the 7 and the 2 filmed again.
    const refilmed = (plan.clips as { avoid?: string[]; seconds?: number }[]).filter((c) => c.avoid?.length).reduce((t, c) => t + veoClipUsd(c.seconds ?? 8, veoModel()), 0);
    expect(h.jobs.get(id)!.costUsd).toBeCloseTo(7 * 0.067 + 3 * veoClipUsd(8, veoModel()) + 4 * veoClipUsd(4, veoModel()) + refilmed, 2);
  });
});

describe("a product photo that cannot be read", () => {
  it("is skipped: the frame is painted without it instead of failing the reel", async () => {
    const { DesignError } = await import("@/lib/designs/service");
    const id = await begin({ language: "English", tier: "lite" });
    h.design.mockImplementationOnce(async () => {
      throw new DesignError("That photo could not be loaded. Please pick it again.");
    });
    await stepReel(owner, id);
    expect(h.jobs.get(id)).toMatchObject({ status: "filming" });
    expect(h.design).toHaveBeenCalledTimes(2);
    expect(h.design.mock.calls[0][0]).toMatchObject({ usePhotoPath: "u1/gallery/a.jpg" });
    expect(h.design.mock.calls[1][0]).toMatchObject({ usePhotoPath: null });
    // The failed try was never painted, so it is not charged.
    expect(h.jobs.get(id)!.costUsd).toBeCloseTo(0.067, 3);
  });
});

describe("re-cutting a finished reel", () => {
  it("lets the browser replace the reel's file (the first re-cut failed: 'The resource already exists')", async () => {
    const storage = await import("@/lib/storage");
    vi.mocked(storage.createSignedUploadUrl).mockResolvedValue({ path: "p", token: "tok", signedUrl: "u" });
    const { reelUploadTarget } = await import("@/lib/reel-engine/engine");
    const id = await begin({ language: "English", tier: "lite" });
    for (let i = 0; i < 7; i++) await stepReel(owner, id);
    await settle(id);
    expect(await reelUploadTarget(owner, id)).toEqual({ path: `u1/clips/reels/${id}.mp4`, token: "tok" });
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith("gallery-videos", `u1/clips/reels/${id}.mp4`, { service: true, upsert: true });
  });
});

describe("Google at its limit", () => {
  it("never films more than 3 clips at once, and a clip Google is too busy for waits a minute without counting as a try", async () => {
    const id = await begin({ language: "English", tier: "lite" });
    for (let i = 0; i < 7; i++) await stepReel(owner, id);
    const t0 = new Date();
    h.poll.mockResolvedValueOnce({ name: "op", done: true, videoUri: null, error: Object.assign(new Error("Google Veo is at its limit right now."), { kind: "quota" }) });
    await stepReel(owner, id, t0);
    const clip = (h.jobs.get(id)!.plan as { clips: { status: string; tries?: number; retryAt?: number }[] }).clips[0];
    expect(clip).toMatchObject({ status: "framed" });
    expect(clip.tries ?? 0).toBe(0);
    expect(clip.retryAt).toBe(t0.getTime() + 60_000);
    // Not sent again before the minute is up, then filmed like the others.
    await stepReel(owner, id, new Date(t0.getTime() + 10_000));
    expect((h.jobs.get(id)!.plan as { clips: { status: string }[] }).clips[0].status).toBe("framed");
    for (let n = 0; n < 30 && h.jobs.get(id)!.status === "filming"; n++) await stepReel(owner, id, new Date(t0.getTime() + 61_000 + n * 1000));
    expect(h.jobs.get(id)).toMatchObject({ status: "assembling" });
  });

  it("a submit Google refuses for its limit (HTTP 429) waits too, instead of failing the reel", async () => {
    const id = await begin({ language: "English", tier: "lite" });
    for (let i = 0; i < 7; i++) await stepReel(owner, id);
    h.submit.mockRejectedValueOnce(Object.assign(new Error("Google Veo is at its limit right now."), { name: "VeoError", kind: "quota" }));
    const t0 = new Date();
    await stepReel(owner, id, t0);
    expect(h.jobs.get(id)).toMatchObject({ status: "filming" });
    const clip = (h.jobs.get(id)!.plan as { clips: { status: string; retryAt?: number }[] }).clips[0];
    expect(clip).toMatchObject({ status: "framed", retryAt: t0.getTime() + 60_000 });
    for (let n = 0; n < 30 && h.jobs.get(id)!.status === "filming"; n++) await stepReel(owner, id, new Date(t0.getTime() + 61_000 + n * 1000));
    expect(h.jobs.get(id)).toMatchObject({ status: "assembling" });
  });
});

describe("within Netlify's 60 s (docs/VIDEO_ENGINE_LAUNCH.md section 1)", () => {
  type Clip = { status: string; operation?: string | null; error?: string; retryAt?: number | null };
  const clipsOf = (id: string) => (h.jobs.get(id)!.plan as { clips: Clip[] }).clips;

  it("starting a reel is quick: the portrait and the script are the next two steps, one per call", async () => {
    const id = await startReel(owner, { language: "English", tier: "lite", brief: "rooftop farming" });
    expect(h.design).not.toHaveBeenCalled();
    expect(h.jobs.get(id)).toMatchObject({ status: "filming", plan: { clips: [], stage: "presenter", brief: "rooftop farming" } });
    await stepReel(owner, id);
    expect((h.jobs.get(id)!.plan as { stage: string }).stage).toBe("script");
    expect(clipsOf(id)).toEqual([]);
    await stepReel(owner, id);
    expect(h.jobs.get(id)!.plan).not.toHaveProperty("stage");
    expect(clipsOf(id)).toHaveLength(7);
    expect(h.design).not.toHaveBeenCalled();
  });

  it("a planning step cut off half way is taken again after its hold, and a reel with nothing to film fails, never assembles", async () => {
    // Cut off in the presenter step: nothing was saved, so the job is still at that stage and the next step does it.
    const id = await startReel(owner, { language: "English", tier: "lite" });
    expect((h.jobs.get(id)!.plan as { stage: string }).stage).toBe("presenter");
    await stepReel(owner, id);
    await stepReel(owner, id);
    expect(clipsOf(id)).toHaveLength(7);
    // An old reel cut off before planning moved into steps: no clips and no planning stage.
    h.jobs.set("old", { id: "old", businessId: "b1", status: "filming", costUsd: 0, language: "English", subjectId: null, plan: { clips: [] } });
    await stepReel(owner, "old");
    expect(h.jobs.get("old")).toMatchObject({ status: "failed", error: "The reel could not be planned. Please try again." });
  });

  it("stops sending clips once the step's time is used, and saves each clip's job at Google as soon as it is accepted", async () => {
    const id = await begin({ language: "English", tier: "lite" });
    for (let i = 0; i < 7; i++) await stepReel(owner, id);
    let clock = Date.now();
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    h.submit.mockImplementation(async () => {
      clock += 20_000;
      return `models/veo/operations/op${clock}`;
    });
    h.poll.mockResolvedValue({ name: "op", done: false, videoUri: null, error: null });
    // What each save held at the moment it was made (the plan object changes after).
    const kept: number[] = [];
    const update = h.prisma.reelJob.update.getMockImplementation()!;
    h.prisma.reelJob.update.mockImplementation(async (a: { where: { id: string }; data: Record<string, unknown> }) => {
      if (!("stepUntil" in a.data) && a.data.plan) kept.push((a.data.plan as { clips: Clip[] }).clips.filter((c) => c.operation).length);
      return update(a);
    });
    await stepReel(owner, id);
    now.mockRestore();
    h.prisma.reelJob.update.mockImplementation(update);
    expect(h.submit).toHaveBeenCalledTimes(2);
    // Each accepted clip was saved at once, while the step still held the reel (no stepUntil in those saves).
    expect(kept).toEqual([1, 2]);
  });

  it("does one heavy thing per step: a finished clip is saved in one step and checked in the next", async () => {
    const id = await begin({ language: "English", tier: "lite" });
    for (let i = 0; i < 7; i++) await stepReel(owner, id);
    await stepReel(owner, id);
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(h.check).not.toHaveBeenCalled();
    expect(clipsOf(id).filter((c) => c.status === "checking")).toHaveLength(1);
    await stepReel(owner, id);
    expect(h.check).toHaveBeenCalledTimes(1);
    expect(h.upload).toHaveBeenCalledTimes(1);
  });

  it("gives up on a clip Google stays at its limit for, and the reel fails with a clear message", async () => {
    const id = await begin({ language: "English", tier: "lite" });
    for (let i = 0; i < 7; i++) await stepReel(owner, id);
    const quota = Object.assign(new Error("Google Veo is at its limit right now."), { name: "VeoError", kind: "quota" });
    h.submit.mockRejectedValue(quota);
    const t0 = Date.now();
    await stepReel(owner, id, new Date(t0));
    expect(clipsOf(id)[0]).toMatchObject({ status: "framed", retryAt: t0 + 60_000 });
    await stepReel(owner, id, new Date(t0 + 10 * 60_000));
    expect(clipsOf(id).filter((c) => c.status === "failed")).toHaveLength(0);
    // Half an hour with no clip taken: every clip still waiting fails, and so does the reel (nothing was paid for them).
    await stepReel(owner, id, new Date(t0 + BUSY_GIVE_UP_MS));
    expect(clipsOf(id).every((c) => c.status === "failed" && c.error === QUOTA_MESSAGE)).toBe(true);
    expect(h.jobs.get(id)).toMatchObject({ status: "failed", error: QUOTA_MESSAGE });
    // Trying again later starts the clock again.
    h.submit.mockReset().mockImplementation(async () => `models/veo/operations/op${Math.random()}`);
    await retryReel(owner, id);
    await settle(id);
    expect(h.jobs.get(id)).toMatchObject({ status: "assembling" });
  });

  it("counts clips filming and Google's waits across every business's reels, not per reel", async () => {
    const id = await begin({ language: "English", tier: "lite" });
    for (let i = 0; i < 7; i++) await stepReel(owner, id);
    const t0 = Date.now();
    const findMany = h.prisma.reelJob.findMany as unknown as ReturnType<typeof vi.fn>;
    const other = (clips: Clip[]) => findMany.mockImplementation(async (a?: { where?: { status?: string } }) => (a?.where?.status === "filming" ? [{ plan: { clips } }] : []));
    // Another company's reel has 3 clips at Google: this one waits.
    other([{ status: "filming" }, { status: "filming" }, { status: "filming" }]);
    await stepReel(owner, id, new Date(t0));
    expect(h.submit).not.toHaveBeenCalled();
    // Another company's clip was just told Google is at its limit: nobody sends until its wait is over.
    other([{ status: "framed", busySince: t0, retryAt: t0 + 60_000 } as Clip]);
    await stepReel(owner, id, new Date(t0 + 30_000));
    expect(h.submit).not.toHaveBeenCalled();
    await stepReel(owner, id, new Date(t0 + 61_000));
    expect(h.submit).toHaveBeenCalledTimes(3);
    findMany.mockReset().mockImplementation(async () => []);
  });
});

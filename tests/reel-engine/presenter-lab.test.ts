import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const bucket = (name: string) => ({
    download: vi.fn(async () => ({ data: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1])], { type: "image/jpeg" }), error: null as Error | null })),
    upload: vi.fn(async () => ({ error: null as Error | null })),
    remove: vi.fn(async () => ({ error: null })),
    name,
  });
  const buckets: Record<string, ReturnType<typeof bucket>> = { "training-lab": bucket("training-lab"), designs: bucket("designs") };
  return {
    buckets,
    actors: [] as Record<string, unknown>[],
    known: { value: null as null | { path: string; description: string } },
    upsert: vi.fn(async ({ create }: { create: { path: string; description: string } }) => h.known.value ?? create),
    design: vi.fn(async () => ({ id: "d1", path: "u1/designs/painted.png", mimeType: "image/png", bytes: new Uint8Array([1]) })),
    recordRun: vi.fn(async () => "run1"),
    findMany: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    reelPresenter: { findUnique: vi.fn(async () => h.known.value), upsert: h.upsert },
    trainingExample: { findMany: h.findMany },
    reelJob: { update: vi.fn(async () => ({})) },
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: (name: string) => h.buckets[name] } }) }));
vi.mock("@/lib/designs/service", () => ({ createEngineDesign: h.design, designUrls: async () => new Map(), DesignError: class DesignError extends Error {} }));
vi.mock("@/lib/training-lab/runs", () => ({ recordRun: h.recordRun }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: async () => true }));
vi.mock("@/lib/ai", () => ({ getTextProvider: vi.fn() }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: async (_c: unknown, _m: unknown, call: () => unknown) => call() }));
vi.mock("@/lib/image-engine/check", () => ({ checkPicture: vi.fn() }));
vi.mock("@/lib/image-engine/planner", () => ({ claudeJson: async () => null }));
vi.mock("@/lib/image-engine/engine", () => ({ loadFacts: vi.fn() }));
vi.mock("@/lib/music/service", () => ({ musicUrl: (p: string) => p, trackForVideo: async () => null }));
vi.mock("@/lib/storage", () => ({ createSignedUploadUrl: vi.fn() }));
vi.mock("@/lib/reel-engine/checker", () => ({ checkClip: vi.fn() }));

const { labPresenters } = await import("@/lib/training-lab/reader");
const { ensurePresenter } = await import("@/lib/reel-engine/engine");

const owner = { userId: "u1", businessId: "b1" };
const actor = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  kind: "actor",
  title: "Aline at the market",
  howMade: "Phone portrait.",
  whatIsGood: "A warm smile.",
  neverThis: null,
  notes: { people: "A woman in her late twenties with short braids, call 0788 300 400" },
  tags: [],
  sector: null,
  language: null,
  technique: [],
  rating: null,
  consentGiven: true,
  consentName: "Aline Uwase",
  engines: ["presenter"],
  transcript: null,
  path: "admin1/a1/aline.jpg",
  mime: "image/jpeg",
  bytes: 4,
  createdAt: new Date("2026-10-20T10:00:00Z"),
  ...over,
});

beforeEach(() => {
  h.known.value = null;
  h.actors = [];
  h.findMany.mockReset().mockImplementation(async () => h.actors);
  for (const b of Object.values(h.buckets)) for (const f of [b.download, b.upload, b.remove]) f.mockClear();
  for (const f of [h.upsert, h.design, h.recordRun]) f.mockClear();
});

describe("labPresenters", () => {
  it("asks only for consented actors on the presenter engine with a file", async () => {
    await labPresenters();
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { kind: "actor", consentGiven: true, engines: { has: "presenter" }, path: { not: null } } }));
  });

  it("never returns an actor without consent, off the presenter switch, or without an image or video", async () => {
    h.actors = [actor({ id: "no", consentGiven: false }), actor({ id: "off", engines: ["image"] }), actor({ id: "pdf", mime: "application/pdf" }), actor({ id: "ok" })];
    expect((await labPresenters()).map((a) => a.id)).toEqual(["ok"]);
  });

  it("ranks by rating, then sector, then tags the audience names", async () => {
    h.actors = [actor({ id: "plain" }), actor({ id: "farm", sector: "Agriculture" }), actor({ id: "star", rating: 5 }), actor({ id: "mums", tags: ["mothers"] })];
    expect((await labPresenters({ sector: "agriculture", audience: "Young mothers in Kigali" })).map((a) => a.id)).toEqual(["star", "farm", "mums", "plain"]);
  });

  it("describes the actor from the owner's words, without their name or a phone number", async () => {
    h.actors = [actor({ title: "Aline Uwase at the market" }), actor({ id: "a2", title: "aline smiling", consentName: "Aline" })];
    const [a, b] = await labPresenters();
    expect(b.description).toMatch(/^the presenter smiling\./);
    expect(a.description).toBe("the presenter at the market. A woman in her late twenties with short braids, call");
    expect(a.description).not.toContain("Aline");
    expect(a.consentName).toBe("Aline Uwase");
  });

  it("is empty on an error", async () => {
    h.findMany.mockRejectedValueOnce(new Error("db down"));
    expect(await labPresenters()).toEqual([]);
  });
});

describe("ensurePresenter with the Lab", () => {
  it("never replaces an existing presenter", async () => {
    h.known.value = { path: "u1/designs/old.png", description: "the old one" };
    h.actors = [actor()];
    expect(await ensurePresenter(owner, "job1", null, "agriculture")).toEqual(h.known.value);
    expect(h.findMany).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.design).not.toHaveBeenCalled();
  });

  it("copies a consented actor's portrait into the company's private designs folder and logs the painter's run", async () => {
    h.actors = [actor()];
    const out = await ensurePresenter(owner, "job1", null, "agriculture");
    expect(h.buckets["training-lab"].download).toHaveBeenCalledWith("admin1/a1/aline.jpg");
    const [path, , opts] = h.buckets.designs.upload.mock.calls[0] as unknown as [string, Uint8Array, { contentType: string; upsert: boolean }];
    expect(path).toMatch(/^u1\/designs\/[0-9a-f-]{36}\.jpg$/);
    expect(opts).toEqual({ contentType: "image/jpeg", upsert: false });
    expect(out).toMatchObject({ path, description: "the presenter at the market. A woman in her late twenties with short braids, call" });
    expect(h.design).not.toHaveBeenCalled();
    expect(h.recordRun).toHaveBeenCalledWith(expect.objectContaining({ agentId: "painter", brain: "rules", ok: true, exampleIds: ["a1"], resultRef: "presenter:b1" }));
  });

  it("never uses an actor without consent: it paints one instead", async () => {
    h.actors = [actor({ consentGiven: false })];
    const out = await ensurePresenter(owner, "job1", null);
    expect(h.buckets["training-lab"].download).not.toHaveBeenCalled();
    expect(h.design).toHaveBeenCalledTimes(1);
    expect(out.path).toBe("u1/designs/painted.png");
  });

  it("skips a video-only actor for now, and paints", async () => {
    h.actors = [actor({ mime: "video/mp4", path: "admin1/a1/clip.mp4" })];
    await ensurePresenter(owner, "job1", null);
    expect(h.buckets["training-lab"].download).not.toHaveBeenCalled();
    expect(h.design).toHaveBeenCalledTimes(1);
  });

  it("paints when the copy fails", async () => {
    h.actors = [actor()];
    h.buckets.designs.upload.mockResolvedValueOnce({ error: new Error("full") });
    await ensurePresenter(owner, "job1", null);
    expect(h.design).toHaveBeenCalledTimes(1);
    expect(h.recordRun).not.toHaveBeenCalled();
  });

  it("keeps a presenter made at the same moment and removes its own copy", async () => {
    h.actors = [actor()];
    h.upsert.mockResolvedValueOnce({ path: "u1/designs/other.png", description: "made by another reel" });
    const out = await ensurePresenter(owner, "job1", null);
    expect(out.path).toBe("u1/designs/other.png");
    expect(h.buckets.designs.remove).toHaveBeenCalledWith([expect.stringMatching(/^u1\/designs\/.+\.jpg$/)]);
    expect(h.recordRun).not.toHaveBeenCalled();
  });
});

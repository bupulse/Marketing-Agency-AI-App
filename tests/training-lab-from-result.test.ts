import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const bucket = () => ({ download: vi.fn(), upload: vi.fn(async () => ({ error: null as Error | null })), remove: vi.fn() });
  return {
    audits: [] as { action: string; target: string | null; after: unknown }[],
    buckets: { "gallery-videos": bucket(), "training-lab": bucket() } as Record<string, ReturnType<typeof bucket>>,
    reel: { value: null as null | Record<string, unknown> },
    existing: { value: null as null | { id: string } },
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: "ex1" })),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 2 })),
    reelFindMany: vi.fn(),
    exampleFindMany: vi.fn(async () => [] as { tags: string[] }[]),
  };
});

vi.mock("@/lib/admin/audit", () => ({
  writeAudit: async (_db: unknown, _ctx: unknown, action: string, target: string | null, _before: unknown, after: unknown) => {
    m.audits.push({ action, target, after });
  },
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    reelJob: { findFirst: vi.fn(async () => m.reel.value), findMany: m.reelFindMany },
    trainingExample: { findFirst: vi.fn(async () => m.existing.value), findMany: m.exampleFindMany, update: m.update },
    agentRun: { updateMany: m.updateMany },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ trainingExample: { create: m.create }, auditLog: {} }),
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: (name: string) => m.buckets[name] } }) }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));

const lab = await import("@/lib/training-lab/from-result");
const ctx = { actor: "admin", ip: null, viaApi: false };
const OWNER = { id: "0b6f3c1e-1111-4222-8333-444455556666", isOwner: true, staffId: null };
const plan = { title: "Grow at home", hook: "No land? No problem.", setting: "a home greenhouse in Kigali", clips: [{ kind: "talk" }, { kind: "broll" }, { kind: "broll" }, { kind: "talk" }, { kind: "talk" }] };
const reel = { id: "reel1", plan, language: "Kinyarwanda", path: "u1/clips/reels/reel1.mp4" };

beforeEach(() => {
  m.audits.length = 0;
  m.reel.value = reel;
  m.existing.value = null;
  for (const f of [m.create, m.update, m.updateMany, m.reelFindMany, m.exampleFindMany]) f.mockClear();
  for (const b of Object.values(m.buckets)) for (const f of [b.download, b.upload, b.remove]) f.mockReset();
  m.buckets["gallery-videos"].download.mockResolvedValue({ data: new Blob([new Uint8Array([0, 0, 0, 24, 1, 2])]), error: null });
  m.buckets["training-lab"].upload.mockResolvedValue({ error: null });
  m.updateMany.mockResolvedValue({ count: 2 });
});

describe("rating what a run made", () => {
  it("puts the stars on every run that made it, audited", async () => {
    expect(await lab.rateRun(ctx, OWNER, "reel:reel1", 4)).toBe(2);
    expect(m.updateMany).toHaveBeenCalledWith({ where: { resultRef: "reel:reel1" }, data: { rating: 4 } });
    expect(m.audits).toEqual([{ action: "rate_agent_result", target: "result:reel:reel1", after: { rating: 4, runs: 2 } }]);
    await lab.rateRun(ctx, OWNER, "batch:abc", null);
    expect(m.updateMany).toHaveBeenLastCalledWith({ where: { resultRef: "batch:abc" }, data: { rating: null } });
  });

  it("refuses others, a bad reference or rating, and says when no run made it", async () => {
    await expect(lab.rateRun(ctx, { ...OWNER, staffId: "s1" }, "reel:reel1", 4)).rejects.toMatchObject({ code: "forbidden" });
    await expect(lab.rateRun(ctx, OWNER, "reel:../x", 4)).rejects.toThrow("That result could not be rated.");
    await expect(lab.rateRun(ctx, OWNER, "reel:reel1", 6)).rejects.toThrow("Rate it from 1 to 5 stars.");
    m.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(lab.rateRun(ctx, OWNER, "reel:gone", 3)).rejects.toThrow("No team run made that. Refresh the page.");
    expect(m.audits).toHaveLength(0);
  });

  it("names each result in words: a reel by its title", async () => {
    m.reelFindMany.mockResolvedValueOnce([{ id: "reel1", plan }]);
    const labels = await lab.resultLabels(["reel:reel1", "reel:gone", "batch:1234567890", null, "nonsense"]);
    expect(Object.fromEntries(labels)).toEqual({ "reel:reel1": 'Reel "Grow at home"', "reel:gone": 'Reel "no longer there"', "batch:1234567890": "Picture batch 12345678" });
  });
});

describe("finished reels into the Lab", () => {
  it("lists the newest finished reels and which are in the Lab already", async () => {
    m.reelFindMany.mockResolvedValueOnce([
      { id: "reel1", plan, language: "Kinyarwanda", createdAt: new Date(), business: { name: "LEAF" } },
      { id: "reel2", plan: {}, language: "English", createdAt: new Date(), business: { name: "Shop" } },
    ]);
    m.exampleFindMany.mockResolvedValueOnce([{ tags: ["reel:reel1"] }]);
    const out = await lab.finishedReels();
    expect(m.reelFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "done" }, orderBy: { createdAt: "desc" }, take: 20 }));
    expect(out.map((r) => [r.id, r.title, r.inLab])).toEqual([["reel1", "Grow at home", true], ["reel2", "Untitled reel", false]]);
  });

  it("says how the reel was made from its plan", () => {
    expect(lab.reelHowMade(plan)).toBe('BuPulse\'s AI reel "Grow at home": a montage: 3 talking clips of the presenter with 2 product shots cut in on the music\'s beat, filmed by Veo and edited in the browser. Hook sticker: No land? No problem. Filmed in a home greenhouse in Kigali.');
    expect(lab.reelHowMade({ title: "T", clips: [{ kind: "talk" }, {}, {}, {}] })).toContain("a talking reel: 4 clips of the presenter");
  });

  it("More like this: a 5-star reel example for the reel and video engines, the MP4 copied privately, the runs rated", async () => {
    const out = await lab.exampleFromReel(ctx, OWNER, "reel1", "more");
    expect(m.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "reel", title: "Reel: Grow at home", whatIsGood: "The owner rated this reel: more like this", neverThis: null, language: "Kinyarwanda", tags: ["reel:reel1"], rating: 5, engines: ["reel", "video"], createdById: OWNER.id }),
    });
    expect(m.buckets["gallery-videos"].download).toHaveBeenCalledWith("u1/clips/reels/reel1.mp4");
    const path = `${OWNER.id}/ex1/reel.mp4`;
    expect(m.buckets["training-lab"].upload).toHaveBeenCalledWith(path, expect.any(Uint8Array), { contentType: "video/mp4", upsert: false });
    expect(m.update).toHaveBeenCalledWith({ where: { id: "ex1" }, data: { path, mime: "video/mp4", bytes: 6 } });
    expect(m.updateMany).toHaveBeenCalledWith({ where: { resultRef: "reel:reel1" }, data: { rating: 5 } });
    expect(out).toEqual({ id: "ex1", copied: true, runs: 2 });
    // The client's reel is only read, never changed or removed.
    expect(m.buckets["gallery-videos"].upload).not.toHaveBeenCalled();
    expect(m.buckets["gallery-videos"].remove).not.toHaveBeenCalled();
    expect(m.audits[0]).toMatchObject({ action: "create_training_example", target: "training:ex1" });
  });

  it("Never this: needs a one-line reason, then a 1-star example with it", async () => {
    await expect(lab.exampleFromReel(ctx, OWNER, "reel1", "never", "  ")).rejects.toThrow("Say in one line what the engines must never do again.");
    expect(m.create).not.toHaveBeenCalled();
    await lab.exampleFromReel(ctx, OWNER, "reel1", "never", " The presenter walks  through the tower ");
    expect(m.create.mock.calls[0][0].data).toMatchObject({ rating: 1, neverThis: "The presenter walks through the tower", whatIsGood: "The owner rated this reel: never this" });
    expect(m.updateMany).toHaveBeenCalledWith({ where: { resultRef: "reel:reel1" }, data: { rating: 1 } });
  });

  it("keeps the example without a file when the copy fails, and says so", async () => {
    m.buckets["training-lab"].upload.mockResolvedValueOnce({ error: new Error("too big") });
    expect(await lab.exampleFromReel(ctx, OWNER, "reel1", "more")).toMatchObject({ id: "ex1", copied: false });
    expect(m.update).not.toHaveBeenCalled();
    m.reel.value = { ...reel, path: null };
    expect((await lab.exampleFromReel(ctx, OWNER, "reel1", "more")).copied).toBe(false);
  });

  it("refuses a reel that is not finished, one already in the Lab, and anyone but the owner", async () => {
    m.reel.value = null;
    await expect(lab.exampleFromReel(ctx, OWNER, "reel1", "more")).rejects.toMatchObject({ code: "not_found" });
    m.reel.value = reel;
    m.existing.value = { id: "old" };
    await expect(lab.exampleFromReel(ctx, OWNER, "reel1", "more")).rejects.toMatchObject({ code: "conflict" });
    await expect(lab.exampleFromReel({ ...ctx, viaApi: true }, OWNER, "reel1", "more")).rejects.toMatchObject({ code: "forbidden" });
    expect(m.create).not.toHaveBeenCalled();
  });
});

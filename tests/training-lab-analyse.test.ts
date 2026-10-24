import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const tx = { trainingExample: { update: vi.fn() }, auditLog: {} };
  return {
    tx,
    audits: [] as { action: string; target: string | null; before: unknown; after: unknown }[],
    spent: { value: 0 },
    findUnique: vi.fn(),
    download: vi.fn(),
    ledger: vi.fn(),
    recordRun: vi.fn(async () => "run1"),
  };
});

vi.mock("@/lib/admin/audit", () => ({
  writeAudit: async (_db: unknown, _ctx: unknown, action: string, target: string | null, before: unknown, after: unknown) => {
    m.audits.push({ action, target, before, after });
  },
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    aiCall: { aggregate: vi.fn(async () => ({ _sum: { costUsd: m.spent.value } })) },
    trainingExample: { findUnique: m.findUnique },
    $transaction: async (fn: (t: typeof m.tx) => unknown) => fn(m.tx),
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ download: m.download }) } }) }));
vi.mock("@/lib/ai/ledger", () => ({
  withLedger: async (ctx: unknown, meta: unknown, call: () => unknown) => {
    m.ledger(ctx, meta);
    return call();
  },
}));
vi.mock("@/lib/training-lab/runs", () => ({ recordRun: m.recordRun }));

const lab = await import("@/lib/training-lab/analyse");
const { Prisma } = await import("@/lib/generated/prisma/client");
const { saveExampleNotes } = await import("@/lib/training-lab/examples");

const ON = { TRAINING_LAB_ANALYSIS: "1", TRAINING_LAB_ANALYSIS_CAP_USD: "2", GEMINI_API_KEY: "g" };
const ctx = { actor: "admin", ip: null, viaApi: false };
const OWNER = { id: "0b6f3c1e-1111-4222-8333-444455556666", isOwner: true, staffId: null };
const reel = { id: "ex1", kind: "reel", title: "Kigali car seller", howMade: "Phone clips.", whatIsGood: "The hook.", path: `${OWNER.id}/ex1/a.mp4`, mime: "video/mp4", bytes: 1000, transcript: null, notes: null };
const good = { hook: "A car door slams in the first second", shots: ["wide street", "close on the price"], cuts_per_second: 0.8, beat_sync: "yes, on every beat", music: "afrobeats", captions: "big white words", stickers: "none", setting: "a Kigali car lot", people: "the seller", why_it_works: "fast and honest" };
const answer = (text: string, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 } }), { status }));

beforeEach(() => {
  m.audits.length = 0;
  m.spent.value = 0;
  for (const f of [m.tx.trainingExample.update, m.findUnique, m.download, m.ledger, m.recordRun]) f.mockClear();
  m.download.mockResolvedValue({ data: new Blob([new Uint8Array([0, 0, 0, 24])]), error: null });
  m.findUnique.mockResolvedValue(reel);
});

describe("the switch and the cap", () => {
  it("is off by default, and with the switch on but no budget", async () => {
    expect(await lab.analysisStatus({})).toMatchObject({ allowed: false, reason: expect.stringContaining("off until the owner sets a budget") });
    expect(await lab.analysisStatus({ TRAINING_LAB_ANALYSIS: "1", GEMINI_API_KEY: "g" })).toMatchObject({ allowed: false, capUsd: 0 });
    expect(await lab.analysisStatus({ TRAINING_LAB_ANALYSIS: "0", TRAINING_LAB_ANALYSIS_CAP_USD: "5", GEMINI_API_KEY: "g" })).toMatchObject({ allowed: false });
  });

  it("needs the Gemini key", async () => {
    expect(await lab.analysisStatus({ ...ON, GEMINI_API_KEY: "" })).toMatchObject({ allowed: false, reason: expect.stringContaining("Gemini key") });
  });

  it("stops when the trainingLab spend reaches the cap", async () => {
    m.spent.value = 1.5;
    expect(await lab.analysisStatus(ON)).toMatchObject({ allowed: true, spentUsd: 1.5, capUsd: 2 });
    m.spent.value = 2;
    expect(await lab.analysisStatus(ON)).toMatchObject({ allowed: false, reason: "The AI notes budget is used: $2.00 of $2.00. You can write the notes yourself below." });
  });

  it("never calls Gemini or reads the file while off", async () => {
    const fetchImpl = answer(JSON.stringify(good));
    const out = await lab.analyseExample(reel, { fetchImpl, env: {} });
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining("off until the owner sets a budget") });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(m.download).not.toHaveBeenCalled();
    expect(m.recordRun).not.toHaveBeenCalled();
  });
});

describe("what can be analysed", () => {
  it("refuses files over 20 MB, links and other kinds in plain words", async () => {
    const fetchImpl = answer(JSON.stringify(good));
    expect(await lab.analyseExample({ ...reel, bytes: 21 * 1024 * 1024 }, { fetchImpl, env: ON })).toEqual({ ok: false, error: "The file is over 20 MB, too big for the AI to watch. Write the notes yourself, or upload a shorter cut." });
    expect(await lab.analyseExample({ ...reel, path: null, mime: null }, { fetchImpl, env: ON })).toMatchObject({ ok: false, error: expect.stringContaining("not a link") });
    expect(await lab.analyseExample({ ...reel, kind: "actor" }, { fetchImpl, env: ON })).toMatchObject({ ok: false, error: expect.stringContaining("not for actor clip or portrait") });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a file that turns out bigger than recorded", async () => {
    m.download.mockResolvedValueOnce({ data: { arrayBuffer: async () => new ArrayBuffer(21 * 1024 * 1024) }, error: null });
    const fetchImpl = answer(JSON.stringify(good));
    expect(await lab.analyseExample(reel, { fetchImpl, env: ON })).toMatchObject({ ok: false, error: expect.stringContaining("over 20 MB") });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("drafts a recording's notes from its transcript, with no call, even while off", async () => {
    const fetchImpl = answer("{}");
    expect(await lab.analyseExample({ ...reel, kind: "voice", transcript: "  Muraho  neza " }, { fetchImpl, env: {} })).toEqual({ ok: true, notes: { captions: "Muraho neza" }, costUsd: 0 });
    expect(await lab.analyseExample({ ...reel, kind: "voice", transcript: null }, { fetchImpl, env: {} })).toMatchObject({ ok: false, error: expect.stringContaining("Write what is said") });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the Gemini answer", () => {
  it("reads a good answer into plain-text notes, in the ledger as trainingLab and the run log as the Checker", async () => {
    const fetchImpl = answer(JSON.stringify(good));
    const out = await lab.analyseExample(reel, { fetchImpl, env: ON });
    expect(out.ok).toBe(true);
    expect(out.ok && out.notes).toMatchObject({ hook: "A car door slams in the first second", shots: "wide street, close on the price", cuts_per_second: "0.8" });
    const [url, init] = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toContain(":generateContent");
    const body = JSON.parse(String(init.body));
    expect(body.contents[0].parts[0].inline_data).toEqual({ mime_type: "video/mp4", data: Buffer.from([0, 0, 0, 24]).toString("base64") });
    expect(body.contents[0].parts[1].text).toContain("<<<DATA");
    expect(m.ledger).toHaveBeenCalledWith({ feature: "trainingLab" }, expect.objectContaining({ provider: "gemini" }));
    expect(m.recordRun).toHaveBeenCalledWith(expect.objectContaining({ agentId: "checker", brain: "gemini", feature: "trainingLab", ok: true, exampleIds: ["ex1"], resultRef: "example:ex1" }));
  });

  it("says so for an answer it cannot read, and logs the run as failed", async () => {
    const out = await lab.analyseExample(reel, { fetchImpl: answer("not json at all"), env: ON });
    expect(out).toEqual({ ok: false, error: "The AI's answer could not be read. Try again, or write the notes yourself." });
    expect(m.recordRun).toHaveBeenCalledWith(expect.objectContaining({ ok: false, resultRef: "example:ex1" }));
    expect((await lab.analyseExample(reel, { fetchImpl: answer(JSON.stringify({ hook: "  ", shots: [] })), env: ON })).ok).toBe(false);
  });

  it("says so when Gemini fails", async () => {
    const out = await lab.analyseExample(reel, { fetchImpl: answer("{}", 500), env: ON });
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining("could not draft") });
    expect(m.recordRun).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: "Gemini answered 500." }));
  });
});

describe("saving notes", () => {
  it("keeps only the note fields as plain text", () => {
    expect(lab.readNotes({ hook: " Fast ", music: ["afro", 120], unknown: "x", setting: "" })).toEqual({ hook: "Fast", music: "afro, 120" });
    expect(lab.readNotes({ hook: "" })).toBeNull();
    expect(lab.readNotes("nope")).toBeNull();
    expect(lab.readNotes({ hook: "x".repeat(900) })?.hook).toHaveLength(600);
  });

  it("saves the owner's corrections with an audit row, and clears empty notes", async () => {
    await saveExampleNotes(ctx, OWNER, "ex1", { hook: "Door slam", shots: "" });
    expect(m.tx.trainingExample.update).toHaveBeenCalledWith({ where: { id: "ex1" }, data: { notes: { hook: "Door slam" } } });
    expect(m.audits[0]).toMatchObject({ action: "update_training_notes", target: "training:ex1", after: { notes: { hook: "Door slam" } } });
    await saveExampleNotes(ctx, OWNER, "ex1", { hook: " " });
    expect(m.tx.trainingExample.update).toHaveBeenLastCalledWith({ where: { id: "ex1" }, data: { notes: Prisma.DbNull } });
  });

  it("is for the owner only", async () => {
    await expect(saveExampleNotes(ctx, { ...OWNER, staffId: "s1" }, "ex1", { hook: "x" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(lab.draftExampleNotes({ ...ctx, viaApi: true }, OWNER, "ex1")).rejects.toMatchObject({ code: "forbidden" });
    expect(m.tx.trainingExample.update).not.toHaveBeenCalled();
  });

  it("saves a draft for the owner to correct, and refuses while off", async () => {
    vi.stubEnv("TRAINING_LAB_ANALYSIS", "");
    await expect(lab.draftExampleNotes(ctx, OWNER, "ex1")).rejects.toThrow(/off until the owner sets a budget/);
    vi.unstubAllEnvs();
    m.findUnique.mockResolvedValueOnce({ ...reel, kind: "voice", transcript: "Muraho neza" });
    expect(await lab.draftExampleNotes(ctx, OWNER, "ex1")).toEqual({ captions: "Muraho neza" });
    expect(m.audits.at(-1)).toMatchObject({ action: "draft_training_notes", after: { notes: { captions: "Muraho neza" }, costUsd: 0 } });
  });
});

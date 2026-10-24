import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ADMIN = "0b6f3c1e-1111-4222-8333-444455556666";
const DRAFT = "11111111-2222-4333-8444-555555555555";

const m = vi.hoisted(() => {
  const files = new Map<string, { bytes: Uint8Array; type: string; created: string }>();
  const bucket = {
    createSignedUploadUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://storage/sign/${path}?token=t`, token: "t", path }, error: null })),
    info: vi.fn(async (path: string) => {
      const f = files.get(path);
      return f ? { data: { size: f.bytes.length, contentType: f.type }, error: null } : { data: null, error: new Error("not found") };
    }),
    download: vi.fn(async (path: string) => {
      const f = files.get(path);
      return f ? { data: new Blob([new Uint8Array(f.bytes)]), error: null } : { data: null, error: new Error("not found") };
    }),
    move: vi.fn(async (from: string, to: string) => {
      const f = files.get(from);
      if (!f) return { data: null, error: new Error("not found") };
      files.delete(from);
      files.set(to, f);
      return { data: {}, error: null };
    }),
    remove: vi.fn(async (paths: string[]) => {
      for (const p of paths) files.delete(p);
      return { data: [], error: null };
    }),
    list: vi.fn(async (prefix: string) => {
      const names = new Map<string, { id: string | null; name: string; created_at: string | null }>();
      for (const [path, f] of files) {
        if (!path.startsWith(`${prefix}/`)) continue;
        const rest = path.slice(prefix.length + 1).split("/");
        names.set(rest[0], rest.length > 1 ? { id: null, name: rest[0], created_at: null } : { id: "file", name: rest[0], created_at: f.created });
      }
      return { data: [...names.values()], error: null };
    }),
  };
  return {
    files,
    bucket,
    audits: [] as { action: string; after: unknown }[],
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: "ex1" })),
    update: vi.fn(async () => ({})),
    spent: { value: 0 },
    recordRun: vi.fn(async () => "run1"),
  };
});

vi.mock("@/lib/admin/audit", () => ({
  writeAudit: async (_db: unknown, _ctx: unknown, action: string, _t: unknown, _b: unknown, after: unknown) => {
    m.audits.push({ action, after });
  },
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    trainingExample: { update: m.update },
    aiCall: { aggregate: async () => ({ _sum: { costUsd: m.spent.value } }) },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ trainingExample: { create: m.create }, auditLog: {} }),
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => m.bucket } }) }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: async (_c: unknown, _m: unknown, call: () => unknown) => call() }));
vi.mock("@/lib/training-lab/runs", () => ({ recordRun: m.recordRun }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/admin/auth", () => ({ requireAdmin: async () => ({ id: "0b6f3c1e-1111-4222-8333-444455556666", isOwner: true, staffId: null }) }));
vi.mock("@/lib/admin/console", () => ({ adminAction: async () => ({ actor: "admin", ip: null, viaApi: false }), actionMessage: (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.") }));

const ex = await import("@/lib/training-lab/examples");
const { readDraft, readDraftFields, draftPrompt } = await import("@/lib/training-lab/analyse");
const kinds = await import("@/app/admin/(console)/(ai)/training-lab/drop/kinds");

const ctx = { actor: "admin", ip: null, viaApi: false };
const OWNER = { id: ADMIN, isOwner: true, staffId: null };
const draftOf = (name = "reel.mp4") => `drafts/${ADMIN}/${DRAFT}/${name}`;
const put = (path: string, type = "video/mp4", created = new Date().toISOString()) => m.files.set(path, { bytes: new Uint8Array([0, 0, 0, 24]), type, created });
const form = { kind: "reel", title: "Kigali car seller", howMade: "Phone clips cut on the beat.", whatIsGood: "The hook.", technique: ["beat sync"], engines: ["reel", "video"], rating: 5, notes: { hook: "A door slam" } };

beforeEach(() => {
  m.files.clear();
  m.audits.length = 0;
  m.spent.value = 0;
  for (const f of [m.create, m.update, m.recordRun, ...Object.values(m.bucket)]) f.mockClear();
});

describe("what a dropped file is", () => {
  it("takes its kind from the file: a video is a reel, an image an image, a sound a recording", () => {
    expect(kinds.kindFromMime("video/mp4")).toBe("reel");
    expect(kinds.kindFromMime("image/jpeg")).toBe("image");
    expect(kinds.kindFromMime("audio/x-m4a")).toBe("voice");
    expect(kinds.kindFromMime("application/pdf")).toBeNull();
    expect(kinds.typeOf({ name: "Voice note.M4A", type: "" })).toBe("audio/x-m4a");
  });

  it("offers only the kinds that take that file, and any for a link", () => {
    expect(kinds.kindsFor("video/mp4")).toEqual(["reel", "video", "actor", "voice"]);
    expect(kinds.kindsFor("image/png")).toEqual(["image", "actor", "schedule"]);
    expect(kinds.kindsFor("audio/mpeg")).toEqual(["voice"]);
    expect(kinds.kindsFor(null)).toEqual(["reel", "video", "image", "voice", "actor"]);
  });

  it("asks for consent when the AI saw people", () => {
    expect(kinds.peopleSeen({ people: "A woman holding the tower" })).toBe(true);
    for (const none of ["none", "No people.", "", "n/a"]) expect(kinds.peopleSeen({ people: none })).toBe(false);
    expect(kinds.peopleSeen(null)).toBe(false);
  });
});

describe("drafts", () => {
  it("live in the owner's own draft folder, and nothing else counts as one", () => {
    expect(ex.draftPath(ADMIN, DRAFT, "My Reel.MP4")).toBe(draftOf("my-reel.mp4"));
    expect(ex.draftPath(ADMIN, "not-a-uuid", "a.mp4")).toBeNull();
    expect(ex.ownDraft(draftOf(), ADMIN)).toEqual({ draftId: DRAFT, name: "reel.mp4" });
    expect(ex.ownDraft(draftOf(), "someone-else")).toBeNull();
    expect(ex.ownDraft(`drafts/${ADMIN}/${DRAFT}/../x.mp4`, ADMIN)).toBeNull();
    expect(ex.ownDraft(`${ADMIN}/${DRAFT}/reel.mp4`, ADMIN)).toBeNull();
  });

  it("start with the file checked for its kind, then an upload address in a fresh folder", async () => {
    const d = await ex.startDraft(ctx, OWNER, { name: "Reel.mp4", type: "video/mp4", size: 1000 }, "reel");
    expect(d.path).toMatch(new RegExp(`^drafts/${ADMIN}/[0-9a-f-]{36}/reel\\.mp4$`));
    expect(d).toMatchObject({ token: "t", signedUrl: expect.stringContaining("token=t") });
    await expect(ex.startDraft(ctx, OWNER, { name: "a.jpg", type: "image/jpeg", size: 10 }, "reel")).rejects.toThrow("a.jpg is not a video. A reel needs a video.");
    await expect(ex.startDraft(ctx, { ...OWNER, staffId: "s1" }, { name: "a.mp4", type: "video/mp4", size: 10 }, "reel")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("are deleted on Discard (only the owner's own) and after a day", async () => {
    put(draftOf());
    await ex.discardDraft(ctx, OWNER, draftOf());
    expect(m.files.has(draftOf())).toBe(false);
    await expect(ex.discardDraft(ctx, OWNER, `drafts/other/${DRAFT}/reel.mp4`)).rejects.toThrow("That draft could not be found.");
    const old = `drafts/${ADMIN}/22222222-2222-4333-8444-555555555555/old.mp4`;
    put(old, "video/mp4", new Date(Date.now() - 2 * 86_400_000).toISOString());
    put(draftOf("new.mp4"));
    expect(await ex.cleanupDrafts(ADMIN)).toBe(1);
    expect(m.files.has(old)).toBe(false);
    expect(m.files.has(draftOf("new.mp4"))).toBe(true);
  });
});

describe("Save to the Lab", () => {
  it("creates the example from the checked form and moves the file into its folder", async () => {
    put(draftOf());
    expect(await ex.createExampleFromDraft(ctx, OWNER, draftOf(), form)).toEqual({ id: "ex1" });
    expect(m.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "reel", title: "Kigali car seller", technique: ["beat sync"], rating: 5, notes: { hook: "A door slam" }, createdById: ADMIN }) });
    expect(m.bucket.move).toHaveBeenCalledWith(draftOf(), `${ADMIN}/ex1/reel.mp4`);
    expect(m.update).toHaveBeenCalledWith({ where: { id: "ex1" }, data: { path: `${ADMIN}/ex1/reel.mp4`, mime: "video/mp4", bytes: 4 } });
    expect(m.audits[0]).toMatchObject({ action: "create_training_example", after: { from: "drop" } });
  });

  it("takes a link without a file", async () => {
    expect(await ex.createExampleFromDraft(ctx, OWNER, null, { ...form, sourceUrl: "https://www.tiktok.com/@a/video/1" })).toEqual({ id: "ex1" });
    expect(m.bucket.move).not.toHaveBeenCalled();
    expect(m.audits[0]).toMatchObject({ after: { from: "link" } });
  });

  it("keeps the example and says so when the file cannot be moved", async () => {
    put(draftOf());
    m.bucket.move.mockResolvedValueOnce({ data: null, error: new Error("busy") });
    expect(await ex.createExampleFromDraft(ctx, OWNER, draftOf(), form)).toMatchObject({ id: "ex1", warning: expect.stringContaining("could not be moved") });
  });

  it("refuses someone else's draft, a draft that never arrived, a wrong file for the kind, and the form's own mistakes", async () => {
    await expect(ex.createExampleFromDraft(ctx, OWNER, `drafts/other/${DRAFT}/reel.mp4`, form)).rejects.toThrow("Drop the file again.");
    await expect(ex.createExampleFromDraft(ctx, OWNER, draftOf(), form)).rejects.toThrow("The file did not arrive. Drop it again.");
    put(draftOf("a.jpg"), "image/jpeg");
    await expect(ex.createExampleFromDraft(ctx, OWNER, draftOf("a.jpg"), form)).rejects.toThrow("is not a video");
    put(draftOf());
    await expect(ex.createExampleFromDraft(ctx, OWNER, draftOf(), { ...form, whatIsGood: "" })).rejects.toThrow("Say what is good about it.");
    expect(m.create).not.toHaveBeenCalled();
  });
});

describe("the AI reads a dropped file", () => {
  const ON = { TRAINING_LAB_ANALYSIS: "1", TRAINING_LAB_ANALYSIS_CAP_USD: "2", GEMINI_API_KEY: "g" };
  const d = { draftId: DRAFT, path: draftOf(), mime: "video/mp4", bytes: 4, kind: "reel" as const };
  const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof body === "string" ? body : JSON.stringify(body) }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 300 } }), { status }));
  const good = { title: "Car seller walks up", how_made: "One phone, quick cuts.", what_is_good: "A hook in the first second.", techniques: ["Beat Sync", "beat sync", "whip pan", "none"], sector: "car-rental", language: "kinyarwanda", transcript: "", hook: "He slams the door", shots: "walk-up, spin", cuts_per_second: "1.2", beat_sync: "yes", music: "afrobeats", captions: "big words", stickers: "none", setting: "a car lot", people: "the seller", why_it_works: "energy" };

  it("fills in the form and the notes in one call, logged as the Checker", async () => {
    put(draftOf());
    const fetchImpl = answer(good);
    const out = await readDraft(d, { fetchImpl, env: ON });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ ok: true, fields: { title: "Car seller walks up", howMade: "One phone, quick cuts.", techniques: ["beat sync", "whip pan"], sector: "car-rental", language: "Kinyarwanda", transcript: "" }, notes: { hook: "He slams the door", people: "the seller" } });
    expect(m.recordRun).toHaveBeenCalledWith(expect.objectContaining({ agentId: "checker", feature: "trainingLab", ok: true, resultRef: `draft:${DRAFT}` }));
  });

  it("says why in plain words when it cannot read, and never calls Gemini then", async () => {
    const fetchImpl = answer(good);
    expect(await readDraft(d, { fetchImpl, env: {} })).toEqual({ ok: false, error: "AI notes are off until the owner sets a budget (TRAINING_LAB_ANALYSIS and its cap). Fill in the form yourself." });
    m.spent.value = 2;
    expect((await readDraft(d, { fetchImpl, env: ON })).ok).toBe(false);
    expect(await readDraft({ ...d, kind: "schedule" }, { fetchImpl, env: ON })).toMatchObject({ ok: false, error: expect.stringContaining("posting habits") });
    expect(await readDraft({ ...d, bytes: 21 * 1024 * 1024 }, { fetchImpl, env: ON })).toMatchObject({ ok: false, error: expect.stringContaining("over 20 MB") });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("gives an empty form when the answer cannot be read", async () => {
    put(draftOf());
    expect(await readDraft(d, { fetchImpl: answer("not json"), env: ON })).toEqual({ ok: false, error: "The AI's answer could not be read. Fill in the form yourself." });
    expect(await readDraft(d, { fetchImpl: answer({}, 500), env: ON })).toMatchObject({ ok: false });
  });

  it("keeps only what the form takes", () => {
    expect(readDraftFields({ title: "x".repeat(200), sector: "spaceships", language: "Klingon", techniques: Array.from({ length: 9 }, (_, i) => `t${i}`) })).toMatchObject({ sector: "", language: "", techniques: ["t0", "t1", "t2", "t3", "t4", "t5"] });
    expect(readDraftFields({ title: "x".repeat(200) })!.title).toHaveLength(120);
    expect(readDraftFields({})).toBeNull();
    expect(readDraftFields("no")).toBeNull();
  });

  it("asks a recording for what is said, and nothing else for it", () => {
    expect(draftPrompt("voice")).toContain("exactly what is said, word for word");
    expect(draftPrompt("reel")).toContain('- transcript: "" (only recordings get one).');
  });
});

describe("the drop box and its actions", () => {
  it("shows one friendly drop box with a link field", async () => {
    const { DropZone } = await import("@/app/admin/(console)/(ai)/training-lab/drop/drop-zone");
    const html = renderToStaticMarkup(createElement(DropZone));
    expect(html).toContain("Drop a reel, video, photo or voice note here");
    expect(html).toContain("or paste a link");
    expect(html).toContain('accept="video/*,image/*,audio/*"');
  });

  it("reads only the owner's own draft", async () => {
    const actions = await import("@/app/admin/(console)/(ai)/training-lab/drop/actions");
    expect(await actions.readDraftAction(`drafts/other/${DRAFT}/reel.mp4`, "reel")).toEqual({ ok: false, error: "That draft could not be found. Drop the file again." });
    expect(await actions.readDraftAction(draftOf(), "song")).toMatchObject({ ok: false });
    expect(await actions.readDraftAction(draftOf(), "reel")).toEqual({ ok: false, error: "The file did not arrive. Drop it again." });
  });

  it("saves and says so in plain words", async () => {
    const actions = await import("@/app/admin/(console)/(ai)/training-lab/drop/actions");
    put(draftOf());
    expect(await actions.saveDraftAction(draftOf(), form)).toEqual({ ok: true, id: "ex1", message: "Saved to the Lab. The engines you switched on learn from it from now on." });
    expect(await actions.discardDraftAction("nonsense")).toEqual({ ok: false });
  });
});

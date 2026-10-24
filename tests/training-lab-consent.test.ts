import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const files = new Map<string, Uint8Array>();
  const bucket = (name: string) => ({
    download: vi.fn(async (path: string) => {
      const bytes = files.get(`${name}/${path}`);
      return bytes ? { data: new Blob([new Uint8Array(bytes)]), error: null } : { data: null, error: new Error("not found") };
    }),
    remove: vi.fn(async () => ({ error: null })),
    list: vi.fn(async () => ({ data: [], error: null })),
  });
  return {
    files,
    buckets: { "training-lab": bucket("training-lab"), designs: bucket("designs") } as Record<string, ReturnType<typeof bucket>>,
    audits: [] as { action: string; target: string | null; after: unknown }[],
    runs: [] as { resultRef: string; exampleIds: string[] }[],
    presenters: [] as { businessId: string; path: string }[],
    examples: [] as Record<string, unknown>[],
    update: vi.fn(async () => ({})),
    deleteRow: vi.fn(async () => ({})),
  };
});

vi.mock("@/lib/admin/audit", () => ({
  writeAudit: async (_db: unknown, _ctx: unknown, action: string, target: string | null, _before: unknown, after: unknown) => {
    m.audits.push({ action, target, after });
  },
}));
vi.mock("@/lib/db", () => {
  const trainingExample = {
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const fromVideo = (where.notes as { equals?: string } | undefined)?.equals;
      if (fromVideo) return m.examples.filter((e) => (e.notes as { from_video?: string } | null)?.from_video === fromVideo);
      return m.examples.filter((e) => e.kind === "actor" && e.consentGiven && e.path);
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => m.examples.find((e) => e.id === where.id) ?? null),
    update: m.update,
    delete: m.deleteRow,
  };
  return {
    prisma: {
      agentRun: { findMany: vi.fn(async ({ where }: { where: { exampleIds: { has: string } } }) => m.runs.filter((r) => r.exampleIds.includes(where.exampleIds.has))) },
      reelPresenter: {
        findMany: vi.fn(async ({ where }: { where: { businessId?: { in: string[] }; path?: { contains: string } } }) =>
          m.presenters.filter((p) => (where.path ? p.path.includes(where.path.contains) : where.businessId!.in.includes(p.businessId))),
        ),
        deleteMany: vi.fn(async ({ where }: { where: { businessId: string; path: string } }) => {
          const before = m.presenters.length;
          m.presenters = m.presenters.filter((p) => !(p.businessId === where.businessId && p.path === where.path));
          return { count: before - m.presenters.length };
        }),
      },
      trainingExample,
      $transaction: async (fn: (tx: unknown) => unknown) => fn({ trainingExample, auditLog: {} }),
    },
  };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: (name: string) => m.buckets[name] } }) }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/admin/auth", () => ({ requireAdmin: async () => ({ id: "0b6f3c1e-1111-4222-8333-444455556666", isOwner: true, staffId: null }) }));
vi.mock("@/lib/admin/console", () => ({
  adminAction: async () => ({ actor: "admin", ip: null, viaApi: false }),
  actionMessage: (e: unknown) => (e instanceof Error ? e.message : "Something went wrong."),
  finish: vi.fn(),
}));

const consent = await import("@/lib/training-lab/consent");
const { updateExample, deleteExample, createExample } = await import("@/lib/training-lab/examples");
const { labPresenters } = await import("@/lib/training-lab/reader");
const { exampleInputProblem, notesFit } = await import("@/lib/training-lab/types");
const { withdrawText } = await import("@/lib/training-lab/consent-text");
const { isOwnDesignPath } = await import("@/lib/designs/assets");

const ctx = { actor: "admin", ip: null, viaApi: false };
const OWNER = { id: "0b6f3c1e-1111-4222-8333-444455556666", isOwner: true, staffId: null };
const PORTRAIT = new Uint8Array([0xff, 0xd8, 1, 2, 3]);
const actor = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  kind: "actor",
  title: "Aline",
  howMade: "Phone portrait.",
  whatIsGood: "A warm smile.",
  neverThis: null,
  notes: null,
  tags: [],
  sector: null,
  language: null,
  technique: [],
  rating: null,
  consentGiven: true,
  consentName: "Aline Uwase",
  consentNote: null,
  consentAt: new Date("2026-10-20T10:00:00Z"),
  engines: ["presenter"],
  transcript: null,
  path: "admin1/a1/aline.jpg",
  mime: "image/jpeg",
  bytes: 5,
  sourceUrl: null,
  createdById: "admin1",
  createdAt: new Date("2026-10-20T10:00:00Z"),
  ...over,
});
const edit = (over: Record<string, unknown> = {}) => ({ title: "Aline", howMade: "Phone portrait.", whatIsGood: "A warm smile.", engines: ["presenter"], consentGiven: false, ...over });

beforeEach(() => {
  m.files.clear();
  m.audits.length = 0;
  m.files.set("training-lab/admin1/a1/aline.jpg", PORTRAIT);
  m.files.set("designs/u1/designs/copy.jpg", PORTRAIT);
  m.files.set("designs/u2/designs/painted.png", new Uint8Array([9, 9, 9]));
  m.runs = [{ resultRef: "presenter:b1", exampleIds: ["a1"] }, { resultRef: "presenter:b2", exampleIds: ["a1"] }];
  // b4 has a copy named after the example; b1 an older copy (a plain name, the same bytes); b2's presenter was painted
  // afterwards (a different file); b3 never had the actor.
  m.presenters = [{ businessId: "b1", path: "u1/designs/copy.jpg" }, { businessId: "b2", path: "u2/designs/painted.png" }, { businessId: "b3", path: "u3/designs/x.png" }, { businessId: "b4", path: "u4/designs/lab-a1-0000.jpg" }];
  m.examples = [actor()];
  m.update.mockClear();
  m.deleteRow.mockClear();
  for (const b of Object.values(m.buckets)) {
    b.remove.mockClear();
    b.download.mockClear();
  }
});

describe("consent rules", () => {
  it("a new actor still needs consent; an existing one may have it withdrawn", () => {
    const base = { kind: "actor", title: "Aline", hasFile: true, howMade: "x", whatIsGood: "y" };
    expect(exampleInputProblem(base)).toBe("Only add an actor who agreed to be used: tick the consent box.");
    expect(exampleInputProblem({ ...base, existing: true })).toBeNull();
  });

  it("keeps the notes small and shallow, with a plain message", () => {
    expect(notesFit({ hook: "x", shots: ["a", "b"] })).toBe(true);
    expect(notesFit({ a: { b: { c: { d: 1 } } } })).toBe(false);
    expect(notesFit({ big: "x".repeat(21 * 1024) })).toBe(false);
    expect(exampleInputProblem({ kind: "reel", title: "r", hasFile: true, howMade: "x", whatIsGood: "y", notes: { big: "x".repeat(21 * 1024) } })).toBe("The notes are too big: keep them under 20 KB and at most 3 levels deep.");
  });

  it("never offers an actor without consent, or one rated 1 or 2 stars, as a presenter", async () => {
    m.examples = [actor({ id: "ok" }), actor({ id: "low", rating: 2 }), actor({ id: "one", rating: 1 }), actor({ id: "good", rating: 4 }), actor({ id: "none", consentGiven: false })];
    expect((await labPresenters()).map((a) => a.id)).toEqual(["good", "ok"]);
  });
});

describe("the presenter copies of an actor", () => {
  it("are named after the example, in the company's designs folder", () => {
    const path = consent.labCopyPath("u1", "a1", "jpg");
    expect(path).toMatch(/^u1\/designs\/lab-a1-[0-9a-f-]{36}\.jpg$/);
    expect(isOwnDesignPath("u1", path)).toBe(true);
    expect(path).toContain(consent.labCopyMark("a1"));
  });

  it("are found by that name with no download (the page's count)", async () => {
    expect(await consent.presenterCopies({ id: "a1", path: "admin1/a1/aline.jpg" })).toEqual([{ businessId: "b4", path: "u4/designs/lab-a1-0000.jpg" }]);
    expect(await consent.presenterUses({ id: "a1", path: "admin1/a1/aline.jpg" })).toBe(1);
    expect(m.buckets["training-lab"].download).not.toHaveBeenCalled();
    expect(m.buckets.designs.download).not.toHaveBeenCalled();
  });

  it("include older copies only when asked: the painter's runs name them and the bytes match", async () => {
    expect(await consent.presenterCopies({ id: "a1", path: "admin1/a1/aline.jpg" }, { older: true })).toEqual([{ businessId: "b4", path: "u4/designs/lab-a1-0000.jpg" }, { businessId: "b1", path: "u1/designs/copy.jpg" }]);
    // Without a file to compare, only the named copies.
    expect(await consent.presenterCopies({ id: "a1", path: null }, { older: true })).toEqual([{ businessId: "b4", path: "u4/designs/lab-a1-0000.jpg" }]);
    expect(await consent.presenterCopies({ id: "other", path: "admin1/a1/aline.jpg" }, { older: true })).toEqual([]);
  });
});

describe("withdrawing consent", () => {
  it("removes the presenter that is still the copy, row and file, and audits the businesses", async () => {
    const out = await consent.withdrawActorConsent(ctx, { id: "a1", path: "admin1/a1/aline.jpg" });
    expect(out).toEqual({ businesses: ["b4", "b1"], portraits: [] });
    expect(m.presenters.map((p) => p.businessId)).toEqual(["b2", "b3"]);
    expect(m.buckets.designs.remove).toHaveBeenCalledWith(["u4/designs/lab-a1-0000.jpg"]);
    expect(m.buckets.designs.remove).toHaveBeenCalledWith(["u1/designs/copy.jpg"]);
    expect(m.audits).toEqual([{ action: "revoke_actor_consent", target: "training:a1", after: { businesses: ["b4", "b1"], portraits: [] } }]);
  });

  it("reaches the portraits taken from the actor's video: their consent goes and so do their copies", async () => {
    m.examples = [actor({ id: "v1", path: "admin1/v1/clip.mp4", mime: "video/mp4" }), actor({ id: "p1", notes: { from_video: "v1", at_seconds: 2 } })];
    m.files.set("training-lab/admin1/v1/clip.mp4", new Uint8Array([7]));
    m.runs = [{ resultRef: "presenter:b1", exampleIds: ["p1"] }];
    const out = await consent.withdrawActorConsent(ctx, { id: "v1", path: "admin1/v1/clip.mp4" });
    expect(m.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { consentGiven: false, consentAt: null } });
    expect(out).toEqual({ businesses: ["b1"], portraits: ["p1"] });
    expect(m.presenters.find((p) => p.businessId === "b1")).toBeUndefined();
  });

  it("on edit: unticking an actor's consent is saved, the example kept, and its copies removed", async () => {
    const out = await updateExample(ctx, OWNER, "a1", edit());
    expect(m.update.mock.calls[0]).toEqual([expect.objectContaining({ where: { id: "a1" }, data: expect.objectContaining({ consentGiven: false, consentAt: null }) })]);
    expect(out).toEqual({ withdrawn: true, removedFrom: 2 });
    expect(m.deleteRow).not.toHaveBeenCalled();
  });

  it("on edit with consent kept, nothing else happens", async () => {
    expect(await updateExample(ctx, OWNER, "a1", edit({ consentGiven: true, consentName: "Aline Uwase" }))).toEqual({ withdrawn: false, removedFrom: 0 });
    expect(m.presenters).toHaveLength(4);
  });

  it("on delete: the copies go first, while the file is there to compare", async () => {
    expect(await deleteExample(ctx, OWNER, "a1")).toEqual({ removedFrom: 2 });
    expect(m.deleteRow).toHaveBeenCalledWith({ where: { id: "a1" } });
    expect(m.audits.map((a) => a.action)).toEqual(["revoke_actor_consent", "delete_training_example"]);
  });

  it("is for the owner only, and a new actor without consent is still refused", async () => {
    await expect(updateExample(ctx, { ...OWNER, staffId: "s1" }, "a1", edit())).rejects.toMatchObject({ code: "forbidden" });
    await expect(createExample(ctx, OWNER, { kind: "actor", title: "New", howMade: "x", whatIsGood: "y", sourceUrl: "https://x.example/a" })).rejects.toThrow("Only add an actor who agreed to be used: tick the consent box.");
    expect(m.presenters).toHaveLength(4);
  });

  it("tells the owner first, and after, in plain words", () => {
    expect(withdrawText(3)).toEqual({ confirm: "This also removes them as the presenter of 3 businesses. Reels already made are not changed.", done: "Consent withdrawn: removed from 3 businesses' presenters. Reels already made are not changed." });
    expect(withdrawText(1).confirm).toContain("presenter of 1 business.");
    expect(withdrawText(0).done).toBe("Consent withdrawn: this actor stays in the Lab but is never used.");
  });
});

describe("what the actions tell the owner", () => {
  it("says how many businesses really lost the actor, on withdrawing and on deleting", async () => {
    const { updateExampleAction, deleteExampleAction } = await import("@/app/admin/(console)/(ai)/training-lab/actions");
    expect(await updateExampleAction("a1", edit())).toEqual({ ok: true, message: "Consent withdrawn: removed from 2 businesses' presenters. Reels already made are not changed." });
    m.examples = [actor()];
    m.presenters = [{ businessId: "b4", path: "u4/designs/lab-a1-0000.jpg" }];
    const form = new FormData();
    form.set("id", "a1");
    expect(await deleteExampleAction(form)).toEqual({ ok: true, message: "Example and its file deleted. Consent withdrawn: removed from 1 business's presenter. Reels already made are not changed." });
  });

  it("says nothing extra for an ordinary edit", async () => {
    const { updateExampleAction } = await import("@/app/admin/(console)/(ai)/training-lab/actions");
    expect(await updateExampleAction("a1", edit({ consentGiven: true, consentName: "Aline Uwase" }))).toEqual({ ok: true });
  });
});

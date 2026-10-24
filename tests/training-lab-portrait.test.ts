import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const audits: { action: string; target: string | null; before: unknown; after: unknown }[] = [];
  const tx = { trainingExample: { create: vi.fn(), update: vi.fn(), delete: vi.fn() }, auditLog: {} };
  const bucket = {
    createSignedUploadUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://storage/${path}`, token: "tok", path }, error: null })),
    info: vi.fn(),
    remove: vi.fn(async () => ({ error: null })),
    list: vi.fn(async () => ({ data: [] as { id: string | null; name: string }[], error: null })),
    createSignedUrls: vi.fn(),
  };
  return { audits, tx, bucket, findUnique: vi.fn() };
});

vi.mock("@/lib/admin/audit", () => ({
  writeAudit: async (_db: unknown, _ctx: unknown, action: string, target: string | null, before: unknown, after: unknown) => {
    m.audits.push({ action, target, before, after });
  },
}));
vi.mock("@/lib/db", () => ({
  prisma: { trainingExample: { findUnique: m.findUnique }, $transaction: async (fn: (t: typeof m.tx) => unknown) => fn(m.tx) },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => m.bucket } }) }));

const lab = await import("@/lib/training-lab/examples");
const ctx = { actor: "admin", ip: "1.2.3.4", viaApi: false };
const OWNER = { id: "0b6f3c1e-1111-4222-8333-444455556666", isOwner: true, staffId: null };
const SRC = "cmh4actorvideo1";
const AGREED = new Date("2026-10-20T10:00:00Z");

const source = (over: Record<string, unknown> = {}) => ({
  id: SRC, kind: "actor", title: "Aline, presenter", mime: "video/mp4", path: `${OWNER.id}/${SRC}/a.mp4`, whatIsGood: "Warm smile.", neverThis: null, sector: "farming", language: "Kinyarwanda", tags: ["woman"],
  consentGiven: true, consentName: "Aline U.", consentNote: "On WhatsApp, 20 October", consentAt: AGREED, createdById: OWNER.id, ...over,
});

beforeEach(() => {
  m.audits.length = 0;
  for (const f of [m.tx.trainingExample.create, m.tx.trainingExample.update, m.findUnique]) f.mockReset();
  m.tx.trainingExample.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: "cmh4portrait01" }));
  m.findUnique.mockResolvedValue(source());
});

const file = { name: "portrait.jpg", type: "image/jpeg", size: 200_000 };

describe("createPortraitFromVideo", () => {
  it("makes a new actor example for the presenters with the same consent, and a slot for the still", async () => {
    const out = await lab.createPortraitFromVideo(ctx, OWNER, SRC, 12.34, file);
    expect(out.id).toBe("cmh4portrait01");
    expect(out.upload?.path).toContain(`${OWNER.id}/cmh4portrait01/`);
    const data = m.tx.trainingExample.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: "actor", title: "Aline, presenter (portrait)", engines: ["presenter"], consentGiven: true, consentName: "Aline U.", consentNote: "On WhatsApp, 20 October", sector: "farming", language: "Kinyarwanda", tags: ["woman"], notes: { from_video: SRC, at_seconds: 12.3 } });
    expect(m.tx.trainingExample.update).toHaveBeenCalledWith({ where: { id: "cmh4portrait01" }, data: { consentAt: AGREED } });
  });
  it("audits the portrait", async () => {
    await lab.createPortraitFromVideo(ctx, OWNER, SRC, 3, file);
    expect(m.audits.map((a) => a.action)).toEqual(["create_training_example", "create_training_portrait"]);
    expect(m.audits[1]).toMatchObject({ target: "training:cmh4portrait01", after: { from_video: SRC, at_seconds: 3, consentName: "Aline U." } });
  });
  it("refuses anyone but the owner", async () => {
    await expect(lab.createPortraitFromVideo(ctx, { ...OWNER, staffId: "s1" }, SRC, 1, file)).rejects.toMatchObject({ code: "forbidden" });
    await expect(lab.createPortraitFromVideo({ ...ctx, viaApi: true }, OWNER, SRC, 1, file)).rejects.toMatchObject({ code: "forbidden" });
    expect(m.tx.trainingExample.create).not.toHaveBeenCalled();
  });
  it("refuses a source that is not an actor with consent and a video", async () => {
    m.findUnique.mockResolvedValueOnce(source({ kind: "reel" }));
    await expect(lab.createPortraitFromVideo(ctx, OWNER, SRC, 1, file)).rejects.toMatchObject({ message: "Only an actor's video can give a portrait." });
    m.findUnique.mockResolvedValueOnce(source({ consentGiven: false }));
    await expect(lab.createPortraitFromVideo(ctx, OWNER, SRC, 1, file)).rejects.toMatchObject({ message: expect.stringMatching(/no consent recorded/) });
    m.findUnique.mockResolvedValueOnce(source({ mime: "image/jpeg" }));
    await expect(lab.createPortraitFromVideo(ctx, OWNER, SRC, 1, file)).rejects.toMatchObject({ message: "This example is not a video." });
    m.findUnique.mockResolvedValueOnce(null);
    await expect(lab.createPortraitFromVideo(ctx, OWNER, "gone", 1, file)).rejects.toMatchObject({ code: "not_found" });
    expect(m.tx.trainingExample.create).not.toHaveBeenCalled();
  });
  it("refuses a still that is not an image", async () => {
    await expect(lab.createPortraitFromVideo(ctx, OWNER, SRC, 1, { name: "x.exe", type: "application/x-msdownload", size: 10 })).rejects.toMatchObject({ code: "invalid" });
  });
});

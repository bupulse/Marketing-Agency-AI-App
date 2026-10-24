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
const ID = "cmh4example0001";

const reel = { kind: "reel", title: "Kigali car seller", howMade: "Phone clips, cut on the beat.", whatIsGood: "The hook.", engines: ["reel", "video"] };
const row = (over: Record<string, unknown> = {}) => ({
  id: ID,
  kind: "reel",
  title: "Kigali car seller",
  path: null as string | null,
  mime: null,
  bytes: null,
  sourceUrl: null,
  rating: null as number | null,
  engines: ["reel"],
  consentGiven: false,
  consentAt: null as Date | null,
  createdById: OWNER.id,
  ...over,
});

beforeEach(() => {
  m.audits.length = 0;
  for (const f of [m.tx.trainingExample.create, m.tx.trainingExample.update, m.tx.trainingExample.delete, m.findUnique, m.bucket.info, m.bucket.remove, m.bucket.list]) f.mockClear();
  m.tx.trainingExample.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: ID }));
  m.findUnique.mockResolvedValue(row());
});

describe("owner only", () => {
  it("refuses staff, even with the owner role, and Jarvis", async () => {
    expect(() => lab.assertLabOwner(ctx, OWNER)).not.toThrow();
    expect(() => lab.assertLabOwner(ctx, { ...OWNER, staffId: "s1" })).toThrow(/Only the owner/);
    expect(() => lab.assertLabOwner(ctx, { ...OWNER, isOwner: false })).toThrow(/Only the owner/);
    expect(() => lab.assertLabOwner({ ...ctx, viaApi: true }, OWNER)).toThrow(/admin console/);
    await expect(lab.createExample(ctx, { ...OWNER, staffId: "s1" }, reel, null)).rejects.toMatchObject({ code: "forbidden" });
    await expect(lab.deleteExample(ctx, { ...OWNER, staffId: "s1" }, ID)).rejects.toMatchObject({ code: "forbidden" });
    expect(m.tx.trainingExample.create).not.toHaveBeenCalled();
    expect(m.tx.trainingExample.delete).not.toHaveBeenCalled();
  });
});

describe("filters", () => {
  it("keeps only known kinds and engines", () => {
    expect(lab.parseFilter({ kind: "reel", engine: "presenter", sector: " Cars ", language: ["Kinyarwanda", "x"] })).toEqual({ kind: "reel", engine: "presenter", sector: "Cars", language: "Kinyarwanda" });
    expect(lab.parseFilter({ kind: "song", engine: "tiktok", sector: "" })).toEqual({});
  });

  it("turns them into a query", () => {
    expect(lab.filterWhere({ kind: "voice", engine: "language", sector: "cars", language: "kinyarwanda" })).toEqual({
      kind: "voice",
      engines: { has: "language" },
      sector: { equals: "cars", mode: "insensitive" },
      language: { equals: "kinyarwanda", mode: "insensitive" },
    });
    expect(lab.filterWhere({})).toEqual({});
  });
});

describe("createExample", () => {
  it("saves the row first, then gives an upload address in its folder under the owner", async () => {
    const out = await lab.createExample(ctx, OWNER, reel, { name: "My Reel.MP4", type: "video/mp4", size: 1000 });
    expect(m.tx.trainingExample.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "reel", title: "Kigali car seller", engines: ["reel", "video"], createdById: OWNER.id, consentAt: null }),
    });
    expect(m.tx.trainingExample.create.mock.calls[0][0].data).not.toHaveProperty("path");
    expect(out).toEqual({ id: ID, upload: { path: `${OWNER.id}/${ID}/my-reel.mp4`, token: "tok" } });
    expect(m.audits[0]).toMatchObject({ action: "create_training_example", target: `training:${ID}` });
  });

  it("takes a link without a file, and records when consent was given", async () => {
    const out = await lab.createExample(ctx, OWNER, { ...reel, kind: "actor", sourceUrl: "https://example.com/clip", consentGiven: true, consentName: "Actor One" }, null);
    expect(out).toEqual({ id: ID, upload: null });
    expect(m.tx.trainingExample.create.mock.calls[0][0].data.consentAt).toBeInstanceOf(Date);
  });

  it("refuses a wrong file or missing words before saving anything", async () => {
    await expect(lab.createExample(ctx, OWNER, reel, { name: "a.jpg", type: "image/jpeg", size: 10 })).rejects.toThrow("a.jpg is not a video. A reel needs a video.");
    await expect(lab.createExample(ctx, OWNER, reel, null)).rejects.toThrow("Add a file or a link to the example.");
    await expect(lab.createExample(ctx, OWNER, { ...reel, howMade: " " }, { name: "a.mp4", type: "video/mp4", size: 10 })).rejects.toThrow("Say how it was made, in your own words.");
    expect(m.tx.trainingExample.create).not.toHaveBeenCalled();
  });

  it("keeps the row and says so when Storage gives no address", async () => {
    m.bucket.createSignedUploadUrl.mockResolvedValueOnce({ data: null, error: new Error("down") } as never);
    const out = await lab.createExample(ctx, OWNER, reel, { name: "a.mp4", type: "video/mp4", size: 10 });
    expect(out.id).toBe(ID);
    expect(out.upload).toBeNull();
    expect(out.uploadError).toMatch(/upload address/);
  });
});

describe("confirmExampleFile", () => {
  const path = `${OWNER.id}/${ID}/my-reel.mp4`;

  it("refuses a path outside the example's folder", async () => {
    await expect(lab.confirmExampleFile(ctx, OWNER, ID, `${OWNER.id}/other/my-reel.mp4`)).rejects.toThrow("That upload could not be used.");
    await expect(lab.confirmExampleFile(ctx, OWNER, ID, `${OWNER.id}/${ID}/../x.mp4`)).rejects.toThrow("That upload could not be used.");
    expect(m.bucket.info).not.toHaveBeenCalled();
  });

  it("checks what Storage recorded and deletes a file that does not suit the kind", async () => {
    m.bucket.info.mockResolvedValueOnce({ data: { size: 500, contentType: "image/png" }, error: null });
    await expect(lab.confirmExampleFile(ctx, OWNER, ID, path)).rejects.toThrow(/is not a video/);
    expect(m.bucket.remove).toHaveBeenCalledWith([path]);
    expect(m.tx.trainingExample.update).not.toHaveBeenCalled();
  });

  it("says when nothing arrived", async () => {
    m.bucket.info.mockResolvedValueOnce({ data: null, error: new Error("not found") });
    await expect(lab.confirmExampleFile(ctx, OWNER, ID, path)).rejects.toThrow("The file did not arrive. Upload it again.");
  });

  it("points the example at the file and deletes the one it replaced", async () => {
    m.findUnique.mockResolvedValueOnce(row({ path: `${OWNER.id}/${ID}/old.mp4` }));
    m.bucket.info.mockResolvedValueOnce({ data: { size: 2048, contentType: "video/mp4" }, error: null });
    await lab.confirmExampleFile(ctx, OWNER, ID, path);
    expect(m.tx.trainingExample.update).toHaveBeenCalledWith({ where: { id: ID }, data: { path, mime: "video/mp4", bytes: 2048 } });
    expect(m.bucket.remove).toHaveBeenCalledWith([`${OWNER.id}/${ID}/old.mp4`]);
  });
});

describe("updateExample", () => {
  it("keeps the kind and the AI notes, and the first consent date", async () => {
    const at = new Date("2026-10-20T10:00:00Z");
    m.findUnique.mockResolvedValueOnce(row({ kind: "actor", path: `${OWNER.id}/${ID}/a.mp4`, consentGiven: true, consentAt: at }));
    await lab.updateExample(ctx, OWNER, ID, { ...reel, kind: "image", consentGiven: true, consentName: "Actor One", notes: { hook: "x" } });
    const data = m.tx.trainingExample.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("kind");
    expect(data).not.toHaveProperty("notes");
    expect(data.consentAt).toBe(at);
  });

  it("clears the consent date when consent is unticked", async () => {
    m.findUnique.mockResolvedValueOnce(row({ path: `${OWNER.id}/${ID}/a.mp4`, consentGiven: true, consentAt: new Date() }));
    await lab.updateExample(ctx, OWNER, ID, { ...reel, consentGiven: false });
    expect(m.tx.trainingExample.update.mock.calls[0][0].data.consentAt).toBeNull();
  });

  it("says when the example is gone", async () => {
    m.findUnique.mockResolvedValueOnce(null);
    await expect(lab.updateExample(ctx, OWNER, ID, reel)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("rating and engines", () => {
  it("rates from 1 to 5 or clears", async () => {
    await lab.rateExample(ctx, OWNER, ID, 4);
    expect(m.tx.trainingExample.update).toHaveBeenCalledWith({ where: { id: ID }, data: { rating: 4 } });
    await lab.rateExample(ctx, OWNER, ID, null);
    expect(m.tx.trainingExample.update).toHaveBeenLastCalledWith({ where: { id: ID }, data: { rating: null } });
    await expect(lab.rateExample(ctx, OWNER, ID, 6)).rejects.toThrow("Rate it from 1 to 5 stars.");
  });

  it("switches one engine on or off", async () => {
    expect(await lab.setExampleEngine(ctx, OWNER, ID, "presenter", true)).toEqual({ engines: ["reel", "presenter"] });
    expect(await lab.setExampleEngine(ctx, OWNER, ID, "reel", false)).toEqual({ engines: [] });
    expect(await lab.setExampleEngine(ctx, OWNER, ID, "reel", true)).toEqual({ engines: ["reel"] });
    await expect(lab.setExampleEngine(ctx, OWNER, ID, "tiktok", true)).rejects.toThrow("That engine does not exist.");
  });
});

describe("deleteExample", () => {
  it("deletes the row, its file and anything else left in its folder", async () => {
    m.findUnique.mockResolvedValueOnce(row({ path: `${OWNER.id}/${ID}/a.mp4` }));
    m.bucket.list.mockResolvedValueOnce({ data: [{ id: "1", name: "a.mp4" }, { id: "2", name: "unconfirmed.mp4" }], error: null });
    await lab.deleteExample(ctx, OWNER, ID);
    expect(m.tx.trainingExample.delete).toHaveBeenCalledWith({ where: { id: ID } });
    expect(m.bucket.list).toHaveBeenCalledWith(`${OWNER.id}/${ID}`, { limit: 100 });
    expect(m.bucket.remove).toHaveBeenCalledWith([`${OWNER.id}/${ID}/a.mp4`, `${OWNER.id}/${ID}/unconfirmed.mp4`]);
    expect(m.audits[0]).toMatchObject({ action: "delete_training_example", after: null });
  });
});

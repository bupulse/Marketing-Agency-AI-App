import { beforeEach, describe, expect, it, vi } from "vitest";
// Plans are not part of this test's database: every plan feature is granted (tests/stubs/entitlements.ts).
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));
import { Prisma } from "@/lib/generated/prisma/client";
import type { NormalizedProduct } from "@/lib/stores/types";
import { StoreApiError } from "@/lib/stores/types";


const state = vi.hoisted(() => ({
  products: new Map<string, Record<string, unknown>>(),
  syncs: new Map<string, Record<string, unknown>>(),
  // Gallery photos by path, and album links (ProductPhoto rows).
  assets: new Map<string, { id: string; path: string; source: string | null; businessId: string; folderId?: string | null; bytes?: number }>(),
  /** Photos already in the company's gallery besides the ones the test makes (to fill the quota). */
  otherPhotos: 0,
  /** Paths used by posts or Autopilot designs. */
  usedPaths: new Set<string>(),
  links: [] as { productId: string; assetId: string; position: number }[],
  store: new Map<string, unknown>(),
  getProductsError: null as unknown,
  conns: [] as { id: string; businessId: string; lastAttemptAt: Date | null }[],
  seq: 0,
  clock: 1_000,
  lock: Promise.resolve() as Promise<void>,
}));
const markNeedsAttention = vi.hoisted(() => vi.fn());

vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/knowledge/products", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/knowledge/products")>()), MAX_PRODUCTS_PER_BUSINESS: 3 }));
vi.mock("@/lib/knowledge/service", () => ({ defaultCurrency: async () => "USD" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/stores/connection", () => ({
  providerFor: () => ({
    getProducts: async (_c: unknown, ids: string[]) => {
      if (state.getProductsError) throw state.getProductsError;
      return new Map(ids.flatMap((id) => (state.store.has(id) ? [[id, state.store.get(id)]] : [])));
    },
  }),
  credentialsOf: async () => ({ provider: "shopify", storeUrl: "s.myshopify.com", secret: "x" }),
  markNeedsAttention,
}));
vi.mock("@/lib/db", () => {
  const syncKey = (c: string, e: string) => `${c}|${e}`;
  const albumOf = (productId: string) => state.links.filter((l) => l.productId === productId).sort((a, b) => a.position - b.position);
  const assetById = (id: string) => [...state.assets.values()].find((a) => a.id === id)!;
  const prisma = {
    business: { findUnique: async () => ({ userId: "u1" }) },
    storeConnection: {
      update: async () => ({}),
      findMany: async ({ where, orderBy, take }: { where: { OR: [unknown, { lastAttemptAt: { lt: Date } }] }; orderBy: unknown; take: number }) => {
        void orderBy;
        const before = where.OR[1].lastAttemptAt.lt.getTime();
        return state.conns.filter((c) => c.lastAttemptAt === null || c.lastAttemptAt.getTime() < before)
          .sort((a, b) => (a.lastAttemptAt?.getTime() ?? -1) - (b.lastAttemptAt?.getTime() ?? -1) || a.id.localeCompare(b.id)).slice(0, take);
      },
      count: async ({ where }: { where: { OR: [unknown, { lastAttemptAt: { lt: Date } }] } }) => {
        const before = where.OR[1].lastAttemptAt.lt.getTime();
        return state.conns.filter((c) => c.lastAttemptAt === null || c.lastAttemptAt.getTime() < before).length;
      },
      updateMany: async ({ where, data }: { where: { id: string }; data: { lastAttemptAt: Date } }) => {
        const c = state.conns.find((x) => x.id === where.id);
        if (c) c.lastAttemptAt = data.lastAttemptAt;
        return { count: c ? 1 : 0 };
      },
    },
    product: {
      count: async () => {
        await new Promise((r) => setTimeout(r, 1)); // yields, so an unlocked count-then-create would race
        return state.products.size;
      },
      create: async ({ data }: { data: Record<string, unknown> & { storeSync?: { create: Record<string, unknown> } } }) => {
        const { storeSync, ...fields } = data;
        const id = `p${++state.seq}`;
        if (storeSync) {
          const key = syncKey(String(storeSync.create.connectionId), String(storeSync.create.externalId));
          if (state.syncs.has(key)) throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });
          state.syncs.set(key, { id: `s${state.seq}`, productId: id, ...storeSync.create, sourceMissing: false, lastSyncedAt: new Date(0) });
        }
        await new Promise((r) => setTimeout(r, 1));
        state.products.set(id, { id, updatedAt: new Date(++state.clock), ...fields });
        return { id, businessId: fields.businessId, name: fields.name };
      },
      update: async ({ where, data }: { where: { id: string; updatedAt?: Date }; data: Record<string, unknown> }) => {
        const p = state.products.get(where.id)!;
        if (where.updatedAt && (p.updatedAt as Date).getTime() !== where.updatedAt.getTime()) throw new Prisma.PrismaClientKnownRequestError("not found", { code: "P2025", clientVersion: "x" });
        Object.assign(p, data);
        p.updatedAt = new Date(++state.clock);
        return p;
      },
    },
    mediaAsset: {
      upsert: async ({ where, create }: { where: { path: string }; create: { id: string; path: string; source: string | null; businessId: string; bytes: number } }) => {
        if (!state.assets.has(where.path)) state.assets.set(where.path, { id: create.id, path: create.path, source: create.source, businessId: create.businessId, folderId: null, bytes: create.bytes });
        return state.assets.get(where.path);
      },
      aggregate: async ({ where }: { where?: unknown }) => {
        const rows = [...state.assets.values()];
        const bytes = rows.reduce((n, a) => n + (a.bytes ?? 0), 0);
        return where ? { _count: { _all: rows.filter((a) => a.source !== "project-migration").length + state.otherPhotos }, _sum: { bytes } } : { _sum: { bytes } };
      },
      findMany: async ({ where }: { where: { path: { in: string[] } } }) => where.path.in.flatMap((p) => (state.assets.has(p) ? [state.assets.get(p)!] : [])),
      deleteMany: async ({ where }: { where: { id: string } }) => {
        const a = assetById(where.id);
        if (a) state.assets.delete(a.path);
        return { count: a ? 1 : 0 };
      },
    },
    productPhoto: {
      findMany: async ({ where }: { where: { productId: string } }) => albumOf(where.productId).map((l) => ({ assetId: l.assetId, asset: assetById(l.assetId) })),
      deleteMany: async ({ where }: { where: { productId: string; assetId: { in: string[] } } }) => {
        const before = state.links.length;
        state.links = state.links.filter((l) => !(l.productId === where.productId && where.assetId.in.includes(l.assetId)));
        return { count: before - state.links.length };
      },
      upsert: async ({ where, create, update }: { where: { productId_assetId: { productId: string; assetId: string } }; create: { productId: string; assetId: string; position: number }; update: { position: number } }) => {
        const l = state.links.find((x) => x.productId === where.productId_assetId.productId && x.assetId === where.productId_assetId.assetId);
        if (l) l.position = update.position;
        else state.links.push({ ...create });
        return {};
      },
      count: async ({ where }: { where: { assetId: string } }) => state.links.filter((l) => l.assetId === where.assetId).length,
    },
    campaignPhoto: { count: async () => 0 },
    post: { count: async ({ where }: { where: { mediaPaths: { has: string } } }) => (state.usedPaths.has(where.mediaPaths.has) ? 1 : 0) },
    design: { count: async ({ where }: { where: { prompt: string } }) => (state.usedPaths.has(where.prompt.replace(/^photo:/, "")) ? 1 : 0) },
    productSync: {
      findUnique: async ({ where }: { where: { connectionId_externalId: { connectionId: string; externalId: string } }; include?: unknown }) => {
        const s = state.syncs.get(syncKey(where.connectionId_externalId.connectionId, where.connectionId_externalId.externalId));
        return s ? { ...s, product: { ...state.products.get(String(s.productId)) } } : null; // a copy, like a database read
      },
      findMany: async ({ where, take }: { where: { lastSyncedAt?: { lt: Date } }; take?: number }) =>
        [...state.syncs.values()].filter((x) => !where.lastSyncedAt || (x.lastSyncedAt as Date).getTime() < where.lastSyncedAt.lt.getTime()).sort((a, b) => (a.lastSyncedAt as Date).getTime() - (b.lastSyncedAt as Date).getTime()).slice(0, take ?? 999),
      count: async ({ where }: { where: { lastSyncedAt: { lt: Date } } }) => [...state.syncs.values()].filter((x) => (x.lastSyncedAt as Date).getTime() < where.lastSyncedAt.lt.getTime()).length,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const s = [...state.syncs.values()].find((x) => x.id === where.id)!;
        Object.assign(s, data);
        return s;
      },
      updateMany: async ({ where, data }: { where: { connectionId: string; externalId: string }; data: Record<string, unknown> }) => {
        const s = state.syncs.get(syncKey(where.connectionId, where.externalId));
        if (s) Object.assign(s, data);
        return { count: s ? 1 : 0 };
      },
    },
    $executeRaw: async () => 0,
    // Function-form transactions run one at a time, like the advisory lock the code takes.
    $transaction: async (arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) => {
      if (typeof arg !== "function") return Promise.all(arg);
      const run = state.lock.then(() => arg(prisma));
      state.lock = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  return { prisma };
});

import { importProducts, newBudget, photosChanged, planUpdate, readImageMap, resyncConnection, runDailyStoreSync, type SyncDeps, type Baseline } from "@/lib/stores/sync";

const conn = { id: "c1", businessId: "b1", provider: "shopify", storeUrl: "s.myshopify.com", credentialsEncrypted: "x", currency: null, status: "ACTIVE" } as never;

const product = (over: Partial<NormalizedProduct> = {}): NormalizedProduct => ({
  externalId: "gid://1",
  title: "Leather bag",
  price: "$20.00",
  description: "Hand made.",
  features: ["Bags", "leather"],
  imageUrls: ["https://cdn.shopify.com/a.jpg", "https://cdn.shopify.com/b.jpg"],
  url: null,
  ...over,
});

let uploads = 0;
let removed: string[] = [];
const deps: SyncDeps = {
  fetchImage: async () => ({ ok: true, bytes: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: "image/jpeg" }) as never,
  uploadPhoto: async (userId) => `${userId}/projects/up${++uploads}.jpg`,
  removePhotos: async (paths) => void removed.push(...paths),
};

const tick = () => new Promise((r) => setTimeout(r, 3)); // timestamps are compared strictly, so let a millisecond pass
const onlyProduct = () => [...state.products.values()][0] as Record<string, unknown> & { id: string };
/** The product's album, as paths in order. */
const album = (productId = onlyProduct().id) => state.links.filter((l) => l.productId === productId).sort((a, b) => a.position - b.position).map((l) => [...state.assets.values()].find((a) => a.id === l.assetId)!.path);
/** The owner puts their own photos in the album (gallery uploads, not store photos). */
function setOwnAlbum(paths: string[]) {
  const productId = onlyProduct().id;
  state.links = state.links.filter((l) => l.productId !== productId);
  paths.forEach((path, position) => {
    if (!state.assets.has(path)) state.assets.set(path, { id: `own-${path}`, path, source: null, businessId: "b1" });
    state.links.push({ productId, assetId: state.assets.get(path)!.id, position });
  });
}

beforeEach(() => {
  state.products.clear();
  state.syncs.clear();
  state.assets.clear();
  state.links = [];
  state.otherPhotos = 0;
  state.usedPaths.clear();
  state.store.clear();
  state.getProductsError = null;
  uploads = 0;
  removed = [];
  markNeedsAttention.mockClear();
});

describe("planUpdate (the overwrite rule)", () => {
  const baseline: Baseline = { title: "A", price: "$1", features: ["x"], notes: "n", photoPaths: ["p1"] };
  const project = { title: "A", price: "$1", features: ["x"], notes: "n", photoPaths: ["p1"] };
  it("updates every field the user left alone", () => {
    const plan = planUpdate(project, baseline, product({ title: "B", price: "$2", features: ["y"], description: "m" }));
    expect(plan.set).toEqual({ title: "B", price: "$2", features: ["y"], notes: "m" });
    expect(plan.kept).toEqual([]);
    expect(plan.nextBaseline).toMatchObject({ title: "B", price: "$2" });
  });
  it("keeps a field the user edited and says so", () => {
    const plan = planUpdate({ ...project, title: "My own title" }, baseline, product({ title: "B", price: "$2" }));
    expect(plan.set).toEqual({ price: "$2", features: ["Bags", "leather"], notes: "Hand made." });
    expect(plan.kept).toEqual(["title"]);
    expect(plan.nextBaseline.title).toBe("A"); // stays protected
  });
  it("does nothing when the store did not change", () => {
    const same = product({ title: "A", price: "$1", features: ["x"], description: "n" });
    const plan = planUpdate(project, baseline, same);
    expect(plan.set).toEqual({});
    expect(plan.kept).toEqual([]);
  });
  it("treats a cleared description as an edit", () => {
    expect(planUpdate({ ...project, notes: null }, baseline, product({ title: "A", price: "$1", features: ["x"], description: "new" })).kept).toEqual(["description"]);
  });
  it("only lets sync replace photos the user never touched", () => {
    expect(planUpdate(project, baseline, product()).photosEditable).toBe(true);
    expect(planUpdate({ ...project, photoPaths: ["p1", "mine"] }, baseline, product()).photosEditable).toBe(false);
  });
});

describe("import and re-sync", () => {
  it("creates a product with an album of store photos and a mapping", async () => {
    state.store.set("gid://1", product());
    const [r] = await importProducts(conn, ["gid://1"], deps);
    expect(r.status).toBe("created");
    const p = onlyProduct();
    expect(p).toMatchObject({ businessId: "b1", kind: "PHYSICAL", name: "Leather bag", summary: "Hand made.", description: "Hand made.", priceModel: "FIXED", priceAmount: 2000, currency: "USD", priceNote: "$20.00", features: ["Bags", "leather"], usps: [] });
    expect(album()).toEqual(["u1/projects/up1.jpg", "u1/projects/up2.jpg"]);
    expect([...state.assets.values()].every((a) => a.source === "store" && a.businessId === "b1")).toBe(true);
    expect(state.syncs.size).toBe(1);
    expect([...state.syncs.values()][0]).toMatchObject({ productId: p.id });
  });

  it("keeps a price it cannot read as the note, on request", async () => {
    state.store.set("gid://1", product({ price: "Call us" }));
    await importProducts(conn, ["gid://1"], deps);
    expect(onlyProduct()).toMatchObject({ priceModel: "ON_REQUEST", priceAmount: null, priceNote: "Call us" });
  });

  it("importing the same product again does not duplicate it or re-download photos", async () => {
    state.store.set("gid://1", product());
    await importProducts(conn, ["gid://1"], deps);
    const [r] = await importProducts(conn, ["gid://1", "gid://1"], deps);
    expect(r.status).toBe("unchanged");
    expect(state.products.size).toBe(1);
    expect(state.syncs.size).toBe(1);
    expect(uploads).toBe(2);
  });

  it("a parallel import that loses the race becomes an update instead of a duplicate", async () => {
    state.store.set("gid://1", product());
    await Promise.all([importProducts(conn, ["gid://1"], deps), importProducts(conn, ["gid://1"], deps)]);
    expect(state.products.size).toBe(1);
  });

  it("re-sync updates untouched fields and swaps changed photos", async () => {
    state.store.set("gid://1", product());
    await importProducts(conn, ["gid://1"], deps);
    state.store.set("gid://1", product({ price: "$25.00", title: "Leather bag XL", imageUrls: ["https://cdn.shopify.com/a.jpg", "https://cdn.shopify.com/c.jpg"] }));
    await tick();
    const summary = await resyncConnection(conn, {}, deps);
    expect(summary).toMatchObject({ checked: 1, updated: 1, kept: 0 });
    expect(onlyProduct()).toMatchObject({ name: "Leather bag XL", priceNote: "$25.00", priceAmount: 2500 });
    expect(album()).toEqual(["u1/projects/up1.jpg", "u1/projects/up3.jpg"]);
    expect(removed).toEqual(["u1/projects/up2.jpg"]);
    expect(state.assets.has("u1/projects/up2.jpg")).toBe(false); // a store photo in no album any more is deleted
    expect(state.products.size).toBe(1);
  });

  it("does not overwrite the user's edits", async () => {
    state.store.set("gid://1", product());
    await importProducts(conn, ["gid://1"], deps);
    Object.assign(onlyProduct(), { name: "My title", description: "My own words" });
    setOwnAlbum(["u1/projects/up1.jpg", "u1/gallery/mine.jpg"]);
    state.store.set("gid://1", product({ title: "Store title", price: "$30.00", description: "Store words", imageUrls: ["https://cdn.shopify.com/z.jpg"] }));
    await tick();
    const summary = await resyncConnection(conn, {}, deps);
    const p = onlyProduct();
    expect(p.name).toBe("My title");
    expect(p.description).toBe("My own words");
    expect(album()).toEqual(["u1/projects/up1.jpg", "u1/gallery/mine.jpg"]);
    expect(p.priceNote).toBe("$30.00"); // untouched by the user, so it follows the store
    expect(p.priceAmount).toBe(3000);
    expect(summary.kept).toBe(1);
    expect(removed).toEqual([]);
    expect(uploads).toBe(2); // nothing new downloaded for protected photos
    // a later sync still protects the edit
    state.store.set("gid://1", product({ title: "Another", price: "$30.00", description: "Store words", imageUrls: ["https://cdn.shopify.com/z.jpg"] }));
    await tick();
    await resyncConnection(conn, {}, deps);
    expect(onlyProduct().name).toBe("My title");
  });

  it("an amount the owner set in the form protects the price", async () => {
    state.store.set("gid://1", product());
    await importProducts(conn, ["gid://1"], deps);
    // Saving the product form turns the store's price text into an amount and clears the note.
    Object.assign(onlyProduct(), { priceNote: null, priceAmount: 1800 });
    state.store.set("gid://1", product({ price: "$30.00" }));
    await tick();
    expect(await resyncConnection(conn, {}, deps)).toMatchObject({ kept: 1 });
    expect(onlyProduct()).toMatchObject({ priceNote: null, priceAmount: 1800 });
  });

  it("skips store photos when the gallery is full, says how many, and imports them on a later sync once there is room", async () => {
    state.otherPhotos = 499; // one place left of 500
    state.store.set("gid://1", product());
    const [r] = await importProducts(conn, ["gid://1"], deps);
    expect(r).toMatchObject({ status: "created", skippedPhotos: 1 });
    expect(album()).toHaveLength(1);
    expect(uploads).toBe(1); // the skipped photo was never downloaded or stored

    state.otherPhotos = 0;
    await tick();
    const summary = await resyncConnection(conn, {}, deps);
    expect(summary).toMatchObject({ updated: 1, skippedPhotos: 0 });
    expect(album()).toHaveLength(2);
  });

  it("reports skipped photos in a re-sync too", async () => {
    state.store.set("gid://1", product());
    await importProducts(conn, ["gid://1"], deps);
    state.otherPhotos = 600;
    state.store.set("gid://1", product({ imageUrls: ["https://cdn.shopify.com/a.jpg", "https://cdn.shopify.com/new.jpg"] }));
    await tick();
    expect(await resyncConnection(conn, {}, deps)).toMatchObject({ skippedPhotos: 1 });
  });

  it("never deletes a store photo the owner filed in a folder or used in a post or design", async () => {
    state.store.set("gid://1", product({ imageUrls: ["https://cdn.shopify.com/a.jpg", "https://cdn.shopify.com/b.jpg", "https://cdn.shopify.com/c.jpg"] }));
    await importProducts(conn, ["gid://1"], deps);
    const [up1, up2, up3] = album();
    state.assets.get(up1)!.folderId = "f1";
    state.usedPaths.add(up2); // in a post
    state.usedPaths.add(up3); // in an Autopilot design
    state.store.set("gid://1", product({ imageUrls: ["https://cdn.shopify.com/z.jpg"] }));
    await tick();
    await resyncConnection(conn, {}, deps);
    expect(album()).toEqual(["u1/projects/up4.jpg"]);
    expect([up1, up2, up3].every((p) => state.assets.has(p))).toBe(true); // unlinked, kept in the gallery
    expect(removed).toEqual([]);
  });

  it("keeps the product when it leaves the store", async () => {
    state.store.set("gid://1", product());
    await importProducts(conn, ["gid://1"], deps);
    state.store.delete("gid://1");
    await tick();
    const summary = await resyncConnection(conn, {}, deps);
    expect(summary.missing).toBe(1);
    expect(state.products.size).toBe(1);
    expect([...state.syncs.values()][0].sourceMissing).toBe(true);
  });

  it("keeps existing photos when every download fails", async () => {
    state.store.set("gid://1", product());
    await importProducts(conn, ["gid://1"], deps);
    state.store.set("gid://1", product({ imageUrls: ["https://cdn.shopify.com/new.jpg"] }));
    await tick();
    await resyncConnection(conn, {}, { ...deps, fetchImage: async () => ({ ok: false, reason: "no" }) });
    expect(album()).toHaveLength(2);
  });

  it("reports a product that is gone, and flags the connection when access is revoked", async () => {
    const [missing] = await importProducts(conn, ["gid://nope"], deps);
    expect(missing.status).toBe("missing");
    state.getProductsError = new StoreApiError("nope", 401);
    const [failed] = await importProducts(conn, ["gid://1"], deps);
    expect(failed.status).toBe("failed");
    expect(markNeedsAttention).toHaveBeenCalledWith("c1", expect.any(String));
  });
});

describe("image map order (M1)", () => {
  const urls = ["https://cdn.shopify.com/a.jpg", "https://cdn.shopify.com/b.jpg", "https://cdn.shopify.com/c.jpg"];

  it("is stored as an ordered array, so a JSONB round trip cannot reorder it", async () => {
    state.store.set("gid://1", product({ imageUrls: urls }));
    await importProducts(conn, ["gid://1"], deps);
    const stored = [...state.syncs.values()][0].imageMap;
    expect(Array.isArray(stored)).toBe(true);
    expect(readImageMap(JSON.parse(JSON.stringify(stored))).entries.map((e) => e.url)).toEqual(urls);
    expect(photosChanged(urls, readImageMap(stored))).toBe(false);
  });

  it("a multi-image product is 'unchanged' on every re-sync", async () => {
    state.store.set("gid://1", product({ imageUrls: urls }));
    await importProducts(conn, ["gid://1"], deps);
    for (let i = 0; i < 3; i++) {
      await tick();
      const s = await resyncConnection(conn, {}, deps);
      expect(s).toMatchObject({ updated: 0, unchanged: 1, kept: 0 });
    }
    expect(uploads).toBe(3);
  });

  it("rows written in the old object form, whose key order JSONB scrambled, are compared as sets (no false change)", async () => {
    state.store.set("gid://1", product({ imageUrls: urls }));
    await importProducts(conn, ["gid://1"], deps);
    const row = [...state.syncs.values()][0];
    const entries = readImageMap(row.imageMap).entries;
    row.imageMap = Object.fromEntries([...entries].reverse().map((e) => [e.url, e.path])); // old format, scrambled order
    await tick();
    const s = await resyncConnection(conn, {}, deps);
    expect(s).toMatchObject({ updated: 0, unchanged: 1, kept: 0 });
    expect(uploads).toBe(3);
  });

  it("still notices a real change in order or content", () => {
    const stored = readImageMap([{ url: "a", path: "pa" }, { url: "b", path: "pb" }]);
    expect(photosChanged(["b", "a"], stored)).toBe(true);
    expect(photosChanged(["a"], stored)).toBe(true);
    expect(photosChanged(["a", "c"], stored)).toBe(true);
    expect(photosChanged(["b", "a"], readImageMap({ a: "pa", b: "pb" }))).toBe(false);
  });
});

describe("daily sync rotation (M3)", () => {
  it("visits every store once per run, never-tried and stalest first, however many there are", async () => {
    const day = 86_400_000;
    const t0 = Date.now() - 3 * day;
    state.conns = Array.from({ length: 23 }, (_, i) => ({ id: `s${String(i).padStart(2, "0")}`, businessId: "b", lastAttemptAt: i < 5 ? null : new Date(t0 + (23 - i) * 1000) }));
    const visited: string[] = [];
    const resync = vi.fn(async (c: { id: string }) => (visited.push(c.id), { checked: 0, updated: 1, unchanged: 0, kept: 0, missing: 0, failed: 0, remaining: 0, done: true }));
    let cursor: string | null = null;
    let calls = 0;
    do {
      const r: Awaited<ReturnType<typeof runDailyStoreSync>> = await runDailyStoreSync({ cursor, resync: resync as never });
      cursor = r.nextCursor;
      calls++;
    } while (cursor && calls < 50);
    expect(calls).toBe(5); // 23 stores, 5 per call
    expect([...visited].sort()).toEqual(state.conns.map((c) => c.id).sort());
    expect(new Set(visited).size).toBe(23); // each exactly once
    expect(visited.slice(0, 5).sort()).toEqual(["s00", "s01", "s02", "s03", "s04"]); // never-tried first
    expect(visited[5]).toBe("s22"); // then the oldest attempt
  });

  it("a store that always fails is tried once per run and does not hold up the rest", async () => {
    state.conns = Array.from({ length: 7 }, (_, i) => ({ id: `f${i}`, businessId: "b", lastAttemptAt: null }));
    const seen: string[] = [];
    const resync = async (c: { id: string }) => {
      seen.push(c.id);
      if (c.id === "f0") throw new Error("boom");
      return { checked: 0, updated: 0, unchanged: 0, kept: 0, missing: 0, failed: 0, remaining: 0, done: true };
    };
    let cursor: string | null = null;
    let calls = 0;
    do {
      cursor = (await runDailyStoreSync({ cursor, resync: resync as never })).nextCursor;
    } while (cursor && ++calls < 20);
    expect(seen.sort()).toEqual(["f0", "f1", "f2", "f3", "f4", "f5", "f6"]);
  });

  it("stamps and skips a store of a company without store import, but leaves one whose plan cannot be checked due", async () => {
    const grant = await import("@/tests/stubs/entitlements");
    const resync = vi.fn(async () => ({ checked: 0, updated: 0, unchanged: 0, kept: 0, missing: 0, failed: 0, remaining: 0, done: true }));
    try {
      state.conns = [{ id: "np", businessId: "b", lastAttemptAt: null }];
      grant.missing.add("storeImport");
      await runDailyStoreSync({ resync: resync as never });
      expect(resync).not.toHaveBeenCalled();
      expect(state.conns[0].lastAttemptAt).toBeInstanceOf(Date);
      grant.missing.clear();
      grant.state.planUnknown = true;
      state.conns = [{ id: "unk", businessId: "b", lastAttemptAt: null }];
      await runDailyStoreSync({ resync: resync as never });
      expect(resync).not.toHaveBeenCalled();
      expect(state.conns[0].lastAttemptAt).toBeNull();
    } finally {
      grant.missing.clear();
      grant.state.planUnknown = false;
    }
  });

  it("tomorrow's run starts again with the stalest", async () => {
    state.conns = [{ id: "a", businessId: "b", lastAttemptAt: new Date(Date.now() - 1000) }];
    const resync = vi.fn(async () => ({ checked: 0, updated: 0, unchanged: 0, kept: 0, missing: 0, failed: 0, remaining: 0, done: true }));
    const r = await runDailyStoreSync({ now: new Date(Date.now() + 86_400_000), resync: resync as never });
    expect(r.connections).toBe(1);
  });
});

describe("race and budget protections (L3, L4, L6)", () => {
  it("L3: an edit saved between our read and our write wins and is reported as kept", async () => {
    state.store.set("gid://1", product());
    await importProducts(conn, ["gid://1"], deps);
    state.store.set("gid://1", product({ title: "Store renamed", price: "$99.00", imageUrls: ["https://cdn.shopify.com/new.jpg"] }));
    // The user saves a new name while we are downloading the new photo (between reading and writing the product).
    const racing: SyncDeps = { ...deps, fetchImage: async (u, p) => { const prod = onlyProduct(); prod.name = "My edit, saved just now"; prod.updatedAt = new Date(++state.clock); return deps.fetchImage(u, p); } };
    await tick();
    const summary = await resyncConnection(conn, {}, racing);
    const p = onlyProduct();
    expect(p.name).toBe("My edit, saved just now");
    expect(p.priceNote).toBe("$20.00"); // nothing of this sync was written
    expect(album()).toHaveLength(2);
    expect(summary).toMatchObject({ updated: 0, kept: 1 });
    expect(removed.length).toBe(1); // the photo we had just uploaded is cleaned up
    // the next sync decides again from the fresh project: the title edit is protected, the price now updates
    await tick();
    await resyncConnection(conn, {}, deps);
    expect(onlyProduct()).toMatchObject({ name: "My edit, saved just now", priceNote: "$99.00" });
  });

  it("L4: parallel imports cannot go past the product cap (cap is 3 in this file)", async () => {
    for (let i = 0; i < 6; i++) state.store.set(`gid://p${i}`, product({ externalId: `gid://p${i}`, title: `P${i}`, imageUrls: [] }));
    const results = (await Promise.all([0, 1, 2, 3, 4, 5].map((i) => importProducts(conn, [`gid://p${i}`], deps)))).flat();
    expect(state.products.size).toBe(3);
    expect(results.filter((r) => r.status === "created")).toHaveLength(3);
    expect(results.filter((r) => r.status === "failed").every((r) => /limit of 3 products/.test(r.error ?? ""))).toBe(true);
    expect(state.syncs.size).toBe(3); // no orphan mappings
  });

  it("L6: a pass is split into slices that each stay inside the subrequest budget, and every product is visited once", async () => {
    // cap is 3 in this file, so use 3 products with 4 images each; a budget of 14 fits only one product's worth of work
    for (let i = 0; i < 3; i++) state.store.set(`gid://p${i}`, product({ externalId: `gid://p${i}`, title: `P${i}`, imageUrls: [`https://cdn.shopify.com/o${i}.jpg`] }));
    await importProducts(conn, ["gid://p0", "gid://p1", "gid://p2"], deps);
    for (let i = 0; i < 3; i++) state.store.set(`gid://p${i}`, product({ externalId: `gid://p${i}`, title: `P${i}`, imageUrls: [1, 2, 3, 4].map((n) => `https://cdn.shopify.com/n${i}${n}.jpg`) }));
    const since = new Date();
    let updated = 0;
    let calls = 0;
    for (;;) {
      await tick();
      const budget = newBudget(14);
      const r = await resyncConnection(conn, { since, budget }, deps);
      calls++;
      updated += r.updated;
      expect(budget.used).toBeLessThanOrEqual(14);
      if (r.done) break;
      expect(r.checked).toBeGreaterThan(0);
      expect(calls).toBeLessThan(10);
    }
    expect(calls).toBeGreaterThan(1);
    expect(updated).toBe(3);
    // a finished pass has nothing left
    expect((await resyncConnection(conn, { since }, deps)).done).toBe(true);
  });

  it("L6: the daily run shares one budget across stores and carries on in the next call", async () => {
    state.conns = Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, businessId: "b", lastAttemptAt: null }));
    const budget = newBudget(800);
    const resync = vi.fn(async (_c: unknown, o: { budget?: { used: number } }) => {
      if (o.budget) o.budget.used += 500;
      return { checked: 1, updated: 1, unchanged: 0, kept: 0, missing: 0, failed: 0, remaining: 0, done: true };
    });
    const first = await runDailyStoreSync({ budget, resync: resync as never });
    expect(first.connections).toBe(2); // 500 then 1000 >= 800: the third store waits
    expect(first.nextCursor).not.toBeNull();
    const second = await runDailyStoreSync({ cursor: first.nextCursor, budget: newBudget(800), resync: resync as never });
    expect(second.connections).toBe(2);
    expect(second.nextCursor).toBeNull();
  });

  it("L6: a store whose pass is not finished stays due and is continued by the next call", async () => {
    state.conns = [{ id: "big", businessId: "b", lastAttemptAt: null }];
    let slices = 0;
    const resync = vi.fn(async (_c: unknown, o: { budget?: { used: number } }) => {
      slices++;
      if (o.budget) o.budget.used += 700;
      return { checked: 1, updated: 1, unchanged: 0, kept: 0, missing: 0, failed: 0, remaining: 5 - slices, done: slices >= 5 };
    });
    let cursor: string | null = null;
    let calls = 0;
    do {
      cursor = (await runDailyStoreSync({ cursor, budget: newBudget(800), resync: resync as never })).nextCursor;
      calls++;
    } while (cursor && calls < 20);
    expect(slices).toBe(5);
    expect(state.conns[0].lastAttemptAt).not.toBeNull();
  });
});

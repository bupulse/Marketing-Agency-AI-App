import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  prisma: {
    bioPage: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    bioPageItem: { deleteMany: vi.fn(), upsert: vi.fn() },
    business: { findUniqueOrThrow: vi.fn() },
    product: { findMany: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
  block: null as string | null,
  download: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  smallJpeg: vi.fn(),
  limit: vi.fn(),
  salt: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/entitlements", () => ({ companyEntitlements: async () => ({ block: mocks.block }) }));
vi.mock("@/lib/widget/config", () => ({ resolveAccent: () => "#2F6BFF" }));
vi.mock("@/lib/publishing/jpeg", () => ({ smallJpeg: mocks.smallJpeg }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: () => ({ download: mocks.download, upload: mocks.upload, remove: mocks.remove }) } }),
}));
vi.mock("@/lib/analytics/salt", () => ({ getDailySalt: () => mocks.salt() }));
vi.mock("@/lib/rate-limit", () => {
  class RateLimitError extends Error { constructor(public retryAfterSeconds: number) { super("limit"); } }
  return { RateLimitError, rateLimit: (...a: unknown[]) => mocks.limit(...a) };
});

import { BioError, bioPhotoPath, fillDays, loadPublicBio, saveBioPage } from "@/lib/bio/service";
import type { BioSettings } from "@/lib/bio/view";
import { POST as hit } from "@/app/b/[slug]/hit/route";
import { GET as page } from "@/app/b/[slug]/route";
import { RateLimitError } from "@/lib/rate-limit";

const USER = "00000000-0000-4000-8000-000000000001";
const BUSINESS = {
  id: "biz1",
  userId: USER,
  name: "TEST Shop",
  description: "Shoes",
  profile: null,
  knowledge: { contacts: [{ type: "whatsapp_call", value: "+250788123456", primary: true }], locations: [{ kind: "head", address: "KN 4 Ave, Kigali" }], openingHours: [], faqs: [] },
  timezone: "Africa/Kigali",
  brandColors: [],
  logoUrl: `${USER}/logo/logo.png`,
};
const product = (id: string, photo: string | null) => ({ id, name: `TEST ${id}`, summary: "", priceModel: "FIXED", priceAmount: 1000, currency: "RWF", priceNote: null, photos: photo ? [{ asset: { path: photo } }] : [] });
const SETTINGS: BioSettings = { enabled: true, slug: "test-shop", tagline: "", whatsapp: "+250788123456", message: "", phone: "+250788123456", location: "KN 4 Ave, Kigali", landmark: "", showHours: true, links: [], productIds: ["p1", "p2"] };
const OWNER = { suspendedAt: null, deletionScheduledFor: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.block = null;
  mocks.prisma.business.findUniqueOrThrow.mockResolvedValue(BUSINESS);
  mocks.prisma.bioPage.findUnique.mockResolvedValue(null);
  mocks.prisma.product.findMany.mockResolvedValue([product("p1", `${USER}/gallery/a.jpg`), product("p2", null)]);
  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: typeof mocks.prisma) => unknown) => fn(mocks.prisma));
  mocks.download.mockResolvedValue({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.smallJpeg.mockResolvedValue(new Uint8Array([0xff, 0xd8]));
  mocks.salt.mockResolvedValue("salt");
  mocks.limit.mockResolvedValue(undefined);
});

describe("saving a page", () => {
  it("makes small copies of the logo and photos in the company's bio folder and saves the items in order", async () => {
    expect(await saveBioPage({ userId: USER, businessId: "biz1" }, SETTINGS)).toEqual({ missingPhotos: [] });
    expect(mocks.smallJpeg).toHaveBeenCalledTimes(2);
    const paths = mocks.upload.mock.calls.map((c) => c[0] as string);
    for (const p of paths) expect(p).toMatch(new RegExp(`^${USER}/bio/[0-9a-f-]{36}\\.jpg$`));
    const page = mocks.prisma.bioPage.upsert.mock.calls[0][0];
    expect(page.create).toMatchObject({ businessId: "biz1", enabled: true, slug: "test-shop", logoPath: paths[0], logoSource: BUSINESS.logoUrl });
    const items = mocks.prisma.bioPageItem.upsert.mock.calls.map((c) => c[0].create);
    expect(items).toEqual([
      { businessId: "biz1", productId: "p1", position: 0, photoPath: paths[1], photoSource: `${USER}/gallery/a.jpg` },
      { businessId: "biz1", productId: "p2", position: 1, photoPath: null, photoSource: null },
    ]);
    expect(mocks.prisma.bioPageItem.deleteMany).toHaveBeenCalledWith({ where: { businessId: "biz1", productId: { notIn: ["p1", "p2"] } } });
  });

  it("keeps copies whose original did not change and removes the ones nobody uses", async () => {
    mocks.prisma.bioPage.findUnique.mockResolvedValue({
      logoPath: `${USER}/bio/old-logo.jpg`,
      logoSource: BUSINESS.logoUrl,
      items: [
        { productId: "p1", photoPath: `${USER}/bio/p1.jpg`, photoSource: `${USER}/gallery/a.jpg` },
        { productId: "p3", photoPath: `${USER}/bio/p3.jpg`, photoSource: `${USER}/gallery/c.jpg` },
      ],
    });
    await saveBioPage({ userId: USER, businessId: "biz1" }, SETTINGS);
    expect(mocks.smallJpeg).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith([`${USER}/bio/p3.jpg`]);
  });

  it("says which photos could not be copied, and saves the page anyway", async () => {
    mocks.smallJpeg.mockImplementation(async () => {
      throw new Error("bad image");
    });
    expect(await saveBioPage({ userId: USER, businessId: "biz1" }, { ...SETTINGS, productIds: ["p1"] })).toEqual({ missingPhotos: ["TEST p1"] });
    expect(mocks.prisma.bioPage.upsert).toHaveBeenCalled();
  });

  it("refuses numbers, places and products that are not the company's, and a read-only account", async () => {
    const save = (s: Partial<BioSettings>) => saveBioPage({ userId: USER, businessId: "biz1" }, { ...SETTINGS, ...s });
    await expect(save({ whatsapp: "+250700000009" })).rejects.toMatchObject({ field: "whatsapp" });
    await expect(save({ phone: "+250700000009" })).rejects.toMatchObject({ field: "phone" });
    await expect(save({ location: "Somewhere else" })).rejects.toMatchObject({ field: "location" });
    await expect(save({ productIds: ["p1", "someone-elses"] })).rejects.toMatchObject({ field: "products" });
    mocks.block = "trial_expired";
    await expect(save({})).rejects.toBeInstanceOf(BioError);
    expect(mocks.prisma.bioPage.upsert).not.toHaveBeenCalled();
  });

  it("explains a taken address and removes the copies it just made", async () => {
    mocks.prisma.$transaction.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    await expect(saveBioPage({ userId: USER, businessId: "biz1" }, SETTINGS)).rejects.toMatchObject({ field: "slug", message: expect.stringMatching(/already uses that address/) });
    expect(mocks.remove).toHaveBeenCalledWith(mocks.upload.mock.calls.map((c) => c[0]));
  });
});

describe("the public page", () => {
  const live = (over: Record<string, unknown> = {}) => ({
    businessId: "biz1",
    enabled: true,
    slug: "test-shop",
    tagline: null,
    whatsapp: "+250788123456",
    message: null,
    phone: null,
    location: null,
    landmark: null,
    showHours: false,
    links: [],
    logoPath: `${USER}/bio/11111111-1111-4111-8111-111111111111.jpg`,
    business: { ...BUSINESS, user: OWNER },
    items: [{ productId: "p1", photoPath: null, product: { ...product("p1", null), status: "ACTIVE" } }, { productId: "p2", photoPath: null, product: { ...product("p2", null), status: "ARCHIVED" } }],
    ...over,
  });

  it("is shown only while switched on, for an active account whose owner is not suspended or leaving", async () => {
    mocks.prisma.bioPage.findUnique.mockResolvedValue(live());
    const page = await loadPublicBio("test-shop");
    expect(page?.source.products.map((p) => p.id)).toEqual(["p1"]); // archived products drop off
    expect(page?.ogImage).toBe("/b/test-shop/photo/11111111-1111-4111-8111-111111111111.jpg");
    for (const over of [{ enabled: false }, { business: { ...BUSINESS, user: { ...OWNER, suspendedAt: new Date() } } }, { business: { ...BUSINESS, user: { ...OWNER, deletionScheduledFor: new Date() } } }]) {
      mocks.prisma.bioPage.findUnique.mockResolvedValue(live(over));
      expect(await loadPublicBio("test-shop")).toBeNull();
    }
    mocks.prisma.bioPage.findUnique.mockResolvedValue(live());
    mocks.block = "past_due";
    expect(await loadPublicBio("test-shop")).toBeNull();
    expect(await loadPublicBio("Not A Slug")).toBeNull();
  });

  it("answers the same 404 for an unknown and a switched-off page, and draws a live one", async () => {
    mocks.prisma.bioPage.findUnique.mockResolvedValue(null);
    const ctx = { params: Promise.resolve({ slug: "test-shop" }) };
    const off = await page(new Request("http://localhost:3202/b/test-shop"), ctx);
    expect(off.status).toBe(404);
    expect(await off.text()).toContain("This page is not available.");
    mocks.prisma.bioPage.findUnique.mockResolvedValue(live());
    const on = await page(new Request("http://localhost:3202/b/test-shop", { headers: { "user-agent": "Instagram 300" } }), ctx);
    expect(on.status).toBe(200);
    expect(on.headers.get("content-security-policy")).toContain("script-src 'self'");
    const html = await on.text();
    expect(html).toContain("Hello%2C%20I%20saw%20your%20page%20on%20Instagram.");
    expect(html).toContain("TEST p1");
    expect(html).not.toContain("TEST p2");
  });

  it("serves only copies that are on a live page", async () => {
    const file = "11111111-1111-4111-8111-111111111111.jpg";
    mocks.prisma.bioPage.findUnique.mockResolvedValue({ ...live(), items: [{ photoPath: null }] });
    expect(await bioPhotoPath("test-shop", file)).toBe(`${USER}/bio/${file}`);
    expect(await bioPhotoPath("test-shop", "22222222-2222-4222-8222-222222222222.jpg")).toBeNull();
    expect(await bioPhotoPath("test-shop", "../gallery/a.jpg")).toBeNull();
    mocks.prisma.bioPage.findUnique.mockResolvedValue({ ...live({ enabled: false }), items: [] });
    expect(await bioPhotoPath("test-shop", file)).toBeNull();
  });
});

describe("counting visits and taps", () => {
  const ctx = { params: Promise.resolve({ slug: "test-shop" }) };
  const req = (body: string, headers: Record<string, string> = {}) =>
    new NextRequest("http://localhost:3202/b/test-shop/hit", { method: "POST", body, headers: { "user-agent": "Mozilla/5.0 (iPhone) Instagram 300", "accept-language": "en", origin: "http://localhost:3202", ...headers } });

  beforeEach(() => mocks.prisma.bioPage.findUnique.mockResolvedValue({ enabled: true, businessId: "biz1", business: { user: OWNER } }));

  it("adds one to today's row with one upsert, keyed by a hashed visitor", async () => {
    expect((await hit(req("wa"), ctx)).status).toBe(204);
    expect(mocks.prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const values = mocks.prisma.$executeRaw.mock.calls[0].slice(1);
    expect(values).toEqual(["biz1", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 0, 1, 0]);
    expect(mocks.limit.mock.calls[0][0]).toMatch(/^bio-wa:biz1:[0-9a-f]{64}$/);
  });

  it("counts nothing for bots, other sites, unknown kinds, switched-off pages or a visitor over the limit", async () => {
    const cases = [req("wa", { "user-agent": "Googlebot/2.1" }), req("wa", { origin: "https://evil.example" }), req("wa", { origin: "" }), req("like")];
    for (const c of cases) expect((await hit(c, ctx)).status).toBe(204);
    mocks.prisma.bioPage.findUnique.mockResolvedValue({ enabled: false, businessId: "biz1", business: { user: OWNER } });
    await hit(req("view"), ctx);
    mocks.prisma.bioPage.findUnique.mockResolvedValue({ enabled: true, businessId: "biz1", business: { user: OWNER } });
    mocks.limit.mockRejectedValue(new RateLimitError(60));
    await hit(req("view"), ctx);
    expect(mocks.prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

describe("the results table", () => {
  it("fills the days nobody came with zeros, newest first", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    const days = fillDays([{ date: new Date("2026-10-19T00:00:00Z"), views: 5, whatsapp: 2, calls: 1 }], now, 3);
    expect(days).toEqual([
      { date: "2026-10-20", views: 0, whatsapp: 0, calls: 0 },
      { date: "2026-10-19", views: 5, whatsapp: 2, calls: 1 },
      { date: "2026-10-18", views: 0, whatsapp: 0, calls: 0 },
    ]);
  });
});

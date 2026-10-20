import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    mediaAsset: { findMany: vi.fn() },
    mediaUploadReservation: { findMany: vi.fn() },
    post: { findMany: vi.fn() },
    bioPage: { findMany: vi.fn() },
    bioPageItem: { findMany: vi.fn() },
  },
  list: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: (bucket: string) => ({ list: (prefix: string) => mocks.list(bucket, prefix), remove: (paths: string[]) => mocks.remove(bucket, paths) }) } }),
}));

import { sweepCompanyFiles } from "@/lib/media/storage-sweep";

const USER = "00000000-0000-4000-8000-000000000001";
const OLD = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
const file = (name: string) => ({ id: name, name, created_at: OLD });

describe("the storage sweep and link-in-bio copies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const m of [mocks.prisma.mediaAsset, mocks.prisma.mediaUploadReservation, mocks.prisma.post]) m.findMany.mockResolvedValue([]);
    mocks.prisma.bioPage.findMany.mockResolvedValue([{ logoPath: `${USER}/bio/logo.jpg` }]);
    mocks.prisma.bioPageItem.findMany.mockResolvedValue([{ photoPath: `${USER}/bio/kept.jpg` }]);
    mocks.remove.mockResolvedValue({ error: null });
    mocks.list.mockImplementation(async (bucket: string, prefix: string) => {
      if (bucket === "media" && prefix === USER) return { data: [{ id: null, name: "bio" }], error: null };
      if (prefix === `${USER}/bio`) return { data: [file("logo.jpg"), file("kept.jpg"), file("left-behind.jpg")], error: null };
      return { data: [], error: null };
    });
  });

  it("keeps the copies a page uses and removes the ones left behind", async () => {
    expect(await sweepCompanyFiles(USER, "biz1", { strangers: true })).toBe(1);
    expect(mocks.remove).toHaveBeenCalledWith("media", [`${USER}/bio/left-behind.jpg`]);
    expect(mocks.prisma.bioPageItem.findMany).toHaveBeenCalledWith({ where: { businessId: "biz1", photoPath: { in: expect.arrayContaining([`${USER}/bio/kept.jpg`]) } }, select: { photoPath: true } });
  });
});

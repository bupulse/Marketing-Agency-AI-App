import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ emails: {} as Record<string, string>, fail: false }));
vi.mock("@/lib/db", () => ({
  prisma: {
    business: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (db.fail) throw new Error("database down");
        return db.emails[where.id] ? { user: { email: db.emails[where.id] } } : null;
      }),
    },
  },
}));
vi.mock("@/lib/admin/settings", () => ({ getSetting: vi.fn(async () => 1024) }));

import { clearVideoMaxCache, videoMaxFor } from "@/lib/media/company-video-max";

const MB = 1024 * 1024;

beforeEach(() => {
  clearVideoMaxCache();
  db.fail = false;
  db.emails = { bupulse: "Office@BuPulse.com", client: "owner@shop.rw" };
  vi.unstubAllEnvs();
});

describe("the Gallery video cap per company", () => {
  it("gives the BuPulse company account its own space (1 GB), and every other company the normal 100 MB", async () => {
    expect(await videoMaxFor("bupulse")).toBe(1024 * MB);
    expect(await videoMaxFor("client")).toBe(100 * MB);
    expect(await videoMaxFor("unknown")).toBe(100 * MB);
  });

  it("never lowers the company account below everyone's limit, and falls back to it when the database cannot be read", async () => {
    vi.stubEnv("MEDIA_COMPANY_VIDEO_MAX_BYTES", String(2048 * MB));
    expect(await videoMaxFor("bupulse")).toBe(2048 * MB);
    clearVideoMaxCache();
    vi.unstubAllEnvs();
    db.fail = true;
    expect(await videoMaxFor("bupulse")).toBe(100 * MB);
  });
});

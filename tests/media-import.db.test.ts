import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Runs importAsset against the real database and the real "media" bucket, so it is skipped unless asked for:
//   RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/media-import.db.test.ts
// It creates a throwaway auth user, business and photo, and removes them afterwards. Storage is reached with the
// service key (no signed-in cookie here), so it checks the bucket's own limits but not the per-user policies.
const enabled = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL && process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
const admin = enabled ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => admin }));

// A valid 1x1 PNG.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

describe.skipIf(!enabled)("importAsset against Supabase", { timeout: 60_000 }, () => {
  const userId = randomUUID();
  const businessId = `imp-${userId.slice(0, 8)}`;
  let prisma: typeof import("@/lib/db").prisma;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const { error } = await admin!.auth.admin.createUser({ id: userId, email: `delivered+imp${userId.slice(0, 8)}@resend.dev`, email_confirm: true });
    if (error) throw error;
    await prisma.user.create({ data: { id: userId, email: `delivered+imp${userId.slice(0, 8)}@resend.dev` } });
    await prisma.business.create({ data: { id: businessId, userId, name: "Import test", widgetKey: `k${userId.replace(/-/g, "")}`.slice(0, 20) } as never });
    await prisma.mediaFolder.create({ data: { id: `f${businessId}`, businessId, name: "Imports" } });
  });

  afterAll(async () => {
    const rows = await prisma.mediaAsset.findMany({ where: { businessId }, select: { path: true } });
    if (rows.length) await admin!.storage.from("media").remove(rows.map((r) => r.path));
    await prisma.user.deleteMany({ where: { id: userId } });
    await admin!.auth.admin.deleteUser(userId);
    await prisma.$disconnect();
  });

  it("stores the file, records source/size/dimensions, and signs a URL that serves the same bytes", async () => {
    const { importAsset } = await import("@/lib/media/service");
    const item = await importAsset({ userId, businessId }, { bytes: PNG, name: "dropbox_photo-1.png", destination: `folder:f${businessId}`, source: "dropbox" });
    expect(item.path.startsWith(`${userId}/gallery/`)).toBe(true);
    expect(item).toMatchObject({ name: "dropbox photo 1", mimeType: "image/png", bytes: PNG.length, width: 1, height: 1 });
    const row = await prisma.mediaAsset.findUnique({ where: { path: item.path } });
    expect(row?.source).toBe("dropbox");
    const res = await fetch(item.url);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    const { hasImported } = await import("@/lib/media/service");
    expect(await hasImported(businessId, "dropbox")).toBe(true);
    expect(await hasImported(businessId, "canva")).toBe(false);
  });
});

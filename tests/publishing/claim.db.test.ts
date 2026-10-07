import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs the real claim SQL against the database in DATABASE_URL, so it is skipped unless asked for:
//   RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/publishing/claim.db.test.ts
// It creates a throwaway auth user (User.id references auth.users), business and posts, and deletes them afterwards.
const enabled = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL && process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);

describe.skipIf(!enabled)("claimDuePosts against the database", { timeout: 60_000 }, () => {
  let userId = "";
  const admin = enabled
    ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  const now = new Date();
  let businessId = "";
  let connectionId = "";
  let prisma: typeof import("@/lib/db").prisma;
  let claimDuePosts: typeof import("@/lib/publishing/engine").claimDuePosts;
  let sweepStalePosts: typeof import("@/lib/publishing/engine").sweepStalePosts;

  async function seed(count: number, data: Record<string, unknown> = {}) {
    const ids: string[] = Array.from({ length: count }, () => randomUUID());
    await prisma.post.createMany({
      data: ids.map((id, i) => ({ id, businessId, connectionId, network: "facebook", status: "SCHEDULED" as const, text: `claim test ${i}`, scheduledAt: new Date(now.getTime() - 60_000 * (i + 1)), ...data })),
    });
    return ids;
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ claimDuePosts, sweepStalePosts } = await import("@/lib/publishing/engine"));
    const email = `claim-test-${randomUUID()}@example.com`;
    const created = await (admin as NonNullable<typeof admin>).auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("Could not create the test user");
    userId = created.data.user.id;
    await prisma.user.create({ data: { id: userId, email } });
    const business = await prisma.business.create({ data: { userId, name: "Claim test" } });
    businessId = business.id;
    const connection = await prisma.connection.create({ data: { businessId, kind: "SOCIAL", provider: "facebook", externalAccountId: `claim-${userId}` } });
    connectionId = connection.id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      await admin?.auth.admin.deleteUser(userId);
    }
    await prisma.$disconnect?.();
  });

  it("two runs at the same moment never both get the same post", async () => {
    const ids = await seed(14);
    const runs = await Promise.all([claimDuePosts({ now, limit: 20 }), claimDuePosts({ now, limit: 20 }), claimDuePosts({ now, limit: 20 })]);
    const mine = runs.map((run) => run.filter((id) => ids.includes(id)));
    const all = mine.flat();
    expect(new Set(all).size).toBe(all.length); // no post claimed twice
    expect(new Set(all)).toEqual(new Set(ids)); // and every due post claimed once
    const rows = await prisma.post.findMany({ where: { id: { in: ids } } });
    expect(rows.every((r) => r.status === "PUBLISHING" && r.lockedAt && r.attempts === 1)).toBe(true);
  });

  it("only takes due posts: not future, not waiting out a back-off, not out of attempts, and never a PUBLISHING post", async () => {
    const future = await seed(1, { scheduledAt: new Date(now.getTime() + 3_600_000) });
    const waiting = await seed(1, { nextAttemptAt: new Date(now.getTime() + 600_000), attempts: 1 });
    const fresh = await seed(1, { status: "PUBLISHING", lockedAt: new Date(now.getTime() - 60_000) });
    const stale = await seed(1, { status: "PUBLISHING", lockedAt: new Date(now.getTime() - 11 * 60_000), attempts: 2 });
    const capped = await seed(1, { attempts: 5 });
    const due = await seed(1);
    const claimed = await claimDuePosts({ now, limit: 50 });
    for (const id of [...future, ...waiting, ...fresh, ...stale, ...capped]) expect(claimed).not.toContain(id);
    expect(claimed).toContain(due[0]);
  });

  it("sweeps stale PUBLISHING posts to NEEDS_ACTION and over-attempted posts to FAILED", async () => {
    const stale = await seed(1, { status: "PUBLISHING", lockedAt: new Date(now.getTime() - 11 * 60_000), attempts: 1 });
    const capped = await seed(1, { attempts: 5 });
    await sweepStalePosts(now);
    const rows = await prisma.post.findMany({ where: { id: { in: [...stale, ...capped] } } });
    expect(rows.find((r) => r.id === stale[0])?.status).toBe("NEEDS_ACTION");
    expect(rows.find((r) => r.id === capped[0])?.status).toBe("FAILED");
  });

  it("skips accounts that are scheduled for deletion", async () => {
    const [id] = await seed(1);
    await prisma.user.update({ where: { id: userId }, data: { deletionScheduledFor: new Date(now.getTime() + 86_400_000) } });
    try {
      expect(await claimDuePosts({ now, limit: 50 })).not.toContain(id);
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { deletionScheduledFor: null } });
    }
    expect(await claimDuePosts({ now, limit: 50 })).toContain(id);
  });

  it("claims in order of time and honours the limit", async () => {
    const ids = await seed(6);
    const claimed = await claimDuePosts({ now, limit: 4 });
    const mine = claimed.filter((id) => ids.includes(id));
    expect(claimed.length).toBeLessThanOrEqual(4);
    // seed() makes later ids older, so the four oldest are the last four.
    expect(new Set(mine)).toEqual(new Set(ids.slice(2)));
  });

  it("a manual publish claims only the given posts of that business", async () => {
    const [mineId] = await seed(1);
    const [otherId] = await seed(1);
    const wrongBusiness = await claimDuePosts({ now, limit: 5, ids: [mineId], businessId: "someone-else" });
    expect(wrongBusiness).toEqual([]);
    const claimed = await claimDuePosts({ now, limit: 5, ids: [mineId], businessId });
    expect(claimed).toEqual([mineId]);
    expect((await prisma.post.findUnique({ where: { id: otherId } }))?.status).toBe("SCHEDULED");
  });
});

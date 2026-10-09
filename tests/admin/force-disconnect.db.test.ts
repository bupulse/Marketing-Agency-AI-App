import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Real database, so it is skipped unless asked for (like tests/publishing/claim.db.test.ts):
//   RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/admin/force-disconnect.db.test.ts
// Makes a throwaway auth user, business, connection and post, and deletes them afterwards. AuditLog rows stay (append-only).
const enabled = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL && process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
const mail = vi.hoisted(() => ({ sendEmail: vi.fn(async () => true) }));
vi.mock("@/lib/publishing/email", async () => ({ ...(await vi.importActual<typeof import("@/lib/publishing/email")>("@/lib/publishing/email")), sendEmail: mail.sendEmail }));

describe.skipIf(!enabled)("force disconnect then reconnect, against the database", { timeout: 60_000 }, () => {
  const admin = enabled ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  let userId = "";
  let businessId = "";
  let connectionId = "";
  let prisma: typeof import("@/lib/db").prisma;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const email = `fd-test-${randomUUID()}@example.com`;
    const created = await admin!.auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("no test user");
    userId = created.data.user.id;
    await prisma.user.create({ data: { id: userId, email } });
    businessId = (await prisma.business.create({ data: { userId, name: "Force disconnect test" } })).id;
    connectionId = (await prisma.connection.create({ data: { businessId, kind: "SOCIAL", provider: "facebook", externalAccountId: `fd-${userId}`, accessTokenEncrypted: "not-a-real-token", displayName: "FD page" } })).id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      await admin?.auth.admin.deleteUser(userId);
    }
    await prisma.$disconnect?.();
  });

  it("a post that comes due while disconnected waits, and after the owner reconnects it needs a new time, never FAILED, no email", async () => {
    const { forceDisconnectChannel } = await import("@/lib/admin/actions/connections");
    const { claimDuePosts, publishPostsNow } = await import("@/lib/publishing/engine");
    const { saveConnections, PICK_NEW_TIME } = await import("@/lib/social/connections");
    const { consoleContext } = await import("@/lib/admin/types");

    const post = await prisma.post.create({ data: { businessId, connectionId, network: "facebook", status: "SCHEDULED", text: "due while disconnected", scheduledAt: new Date(Date.now() + 3600_000) } });

    // 10:00: support disconnects; the post is (or becomes) due.
    await forceDisconnectChannel(consoleContext("203.0.113.9"), { connectionId, reason: "db test" });
    // 11:00 arrives. (The post was created in the future so no other publisher run can take it before the disconnect.)
    await prisma.post.update({ where: { id: post.id }, data: { scheduledAt: new Date(Date.now() - 60_000) } });
    const conn = await prisma.connection.findUnique({ where: { id: connectionId } });
    expect(conn).toMatchObject({ status: "REVOKED", accessTokenEncrypted: null, refreshTokenEncrypted: null });

    // 11:00: the publisher runs. The post is not claimed, not failed, nobody is emailed.
    expect(await claimDuePosts({ now: new Date(), limit: 20, ids: [post.id], businessId })).toEqual([]);
    expect(await publishPostsNow(businessId, [post.id])).toMatchObject({ claimed: 0, failed: 0 });
    let row = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(row).toMatchObject({ status: "SCHEDULED", attempts: 0 });
    expect(row.lastError).toMatch(/^Needs reconnect:/);
    expect(mail.sendEmail).not.toHaveBeenCalled();

    // 12:00: the owner reconnects the same account.
    await saveConnections(businessId, "facebook", { accessToken: "new-token", scopes: [], accounts: [{ externalAccountId: `fd-${userId}`, displayName: "FD page", accountType: "page" }] }, [`fd-${userId}`]);
    row = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(row).toMatchObject({ status: "NEEDS_ACTION", lastError: PICK_NEW_TIME, connectionId });
    expect(await claimDuePosts({ now: new Date(), limit: 20, ids: [post.id], businessId })).toEqual([]);
    expect(mail.sendEmail).not.toHaveBeenCalled();
    expect(await prisma.connection.findUnique({ where: { id: connectionId }, select: { status: true } })).toMatchObject({ status: "ACTIVE" });
  });
});

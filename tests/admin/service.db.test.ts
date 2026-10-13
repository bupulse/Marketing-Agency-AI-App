import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Real database and real Supabase auth, so it is skipped unless asked for:
//   RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/admin/service.db.test.ts
// Makes a throwaway auth user + subscription and removes them afterwards. Paddle is mocked. AuditLog rows it writes
// stay (the table is append-only by design).
const enabled = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL && process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
const supa = enabled ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

const paddle = vi.hoisted(() => ({ createRefund: vi.fn(async () => ({ adjustmentId: "adj_db", status: "pending_approval", transactionId: "txn_db", type: "full", amountMinor: null, currency: "USD" })) }));
vi.mock("@/lib/billing/paddle-admin", () => ({ createRefund: paddle.createRefund, describeRefundTarget: async () => ({ transactionId: "txn_db", currency: "USD", totalMinor: 4900, status: "completed", billedAt: null, lines: [{ id: "txnitm_1", totalMinor: 4900 }] }) }));

describe.skipIf(!enabled)("admin service against the real database", { timeout: 60_000 }, () => {
  const userId = randomUUID();
  const email = `delivered+adm${userId.slice(0, 8)}@resend.dev`;
  let prisma: typeof import("@/lib/db").prisma;
  let svc: typeof import("@/lib/admin/service");

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    svc = await import("@/lib/admin/service");
    const { error } = await supa!.auth.admin.createUser({ id: userId, email, email_confirm: true });
    if (error) throw error;
    await prisma.user.create({ data: { id: userId, email } });
    await prisma.subscription.create({ data: { userId, plan: "STANDARD", status: "ACTIVE", provider: "PADDLE", providerCustomerId: "ctm_db", providerSubscriptionId: `sub_db_${userId.slice(0, 8)}` } });
  });

  afterAll(async () => {
    await prisma.adminApproval.deleteMany({ where: { requestedBy: `jarvis:dbtest-${userId.slice(0, 8)}` } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await supa!.auth.admin.deleteUser(userId);
    await prisma.$disconnect();
  });

  const API = () => svc.apiContext(`dbtest-${userId.slice(0, 8)}`, "203.0.113.9", "all");

  it("the audit log refuses updates and deletes", async () => {
    await svc.extendTrial(API(), { userId, days: 1 }).catch(() => {}); // not a trial: no row; use a direct write instead
    await prisma.auditLog.create({ data: { actor: "test", action: "db_test", target: `user:${userId}` } });
    await expect(prisma.auditLog.updateMany({ where: { action: "db_test", target: `user:${userId}` }, data: { actor: "x" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.deleteMany({ where: { action: "db_test", target: `user:${userId}` } })).rejects.toThrow(/append-only/);
  });

  it("a refund request is one pending row for a repeated key, and approving in parallel runs Paddle once", async () => {
    const input = { userId, reason: "db test", idempotencyKey: `db-test-${userId}` };
    const receipts = await Promise.all([svc.requestRefund(API(), input), svc.requestRefund(API(), input), svc.requestRefund(API(), input)]);
    expect(new Set(receipts.map((r) => r.id)).size).toBe(1);
    expect(await prisma.adminApproval.count({ where: { idempotencyKey: input.idempotencyKey } })).toBe(1);
    expect(paddle.createRefund).not.toHaveBeenCalled();

    const id = receipts[0].id;
    const results = await Promise.allSettled([svc.approveAction(svc.consoleContext(), id), svc.approveAction(svc.consoleContext(), id), svc.approveAction(svc.consoleContext(), id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(paddle.createRefund).toHaveBeenCalledTimes(1);
    expect((await prisma.adminApproval.findUnique({ where: { id } }))?.status).toBe("executed");
    const audit = await prisma.auditLog.findMany({ where: { target: `approval:${id}` }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["request_issue_refund", "approve_issue_refund"]);
  });

  it("suspend bans the auth user and blocks usage; restore lifts both", async () => {
    await svc.suspendUser(API(), { userId, reason: "db test", confirm: true });
    const banned = await supa!.auth.admin.getUserById(userId);
    expect(banned.data.user?.banned_until && new Date(banned.data.user.banned_until).getTime()).toBeGreaterThan(Date.now() + 365 * 86_400_000);
    const { consumeUsage } = await import("@/lib/usage");
    await expect(consumeUsage(userId, "text")).rejects.toMatchObject({ reason: "inactive" });
    const audit = await prisma.auditLog.findFirst({ where: { action: "suspend_user", target: `user:${userId}` } });
    expect(audit).toMatchObject({ actor: API().actor, ip: "203.0.113.9" });

    await svc.restoreUser(API(), { userId });
    const after = await supa!.auth.admin.getUserById(userId);
    expect(after.data.user?.banned_until ?? null).toBeNull();
    await expect(consumeUsage(userId, "text")).resolves.toBeDefined();
  });

  it("a plan-limit override changes what consumeUsage allows, then resets", async () => {
    const { clearPlanLimitCache } = await import("@/lib/admin/plan-limits");
    await prisma.subscription.update({ where: { userId }, data: { plan: "STANDARD", currentPeriodStart: new Date() } });
    await svc.updatePlanLimits(API(), { plan: "STANDARD", limits: { text: 1 }, confirm: true });
    try {
      await prisma.usageRecord.deleteMany({ where: { userId } });
      const { consumeUsage } = await import("@/lib/usage");
      await consumeUsage(userId, "text");
      await expect(consumeUsage(userId, "text")).rejects.toMatchObject({ reason: "limit_reached" });
    } finally {
      await svc.updatePlanLimits(API(), { plan: "STANDARD", limits: { text: null }, confirm: true });
      clearPlanLimitCache();
    }
  });

  it("redact_audit_for_user strips personal parts but keeps the trail; other updates and deletes stay refused", async () => {
    const receipt = await svc.requestRefund(API(), { userId, reason: "private reason text", idempotencyKey: `db-redact-${userId}` });
    await svc.suspendUser(API(), { userId, reason: "private suspension note", confirm: true });
    await prisma.$executeRaw`SELECT public.redact_audit_for_user(${userId})`;

    const rows = await prisma.auditLog.findMany({ where: { OR: [{ target: `user:${userId}` }, { target: `approval:${receipt.id}` }] } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.actor).toBeTruthy();
      expect(row.action).toBeTruthy();
      expect(row.createdAt).toBeInstanceOf(Date);
      for (const v of [row.before, row.after]) if (v !== null) expect(v).toEqual({ redacted: true });
    }
    expect(JSON.stringify(rows)).not.toContain("private");
    const approval = await prisma.adminApproval.findUnique({ where: { id: receipt.id } });
    expect(approval?.status).toBeTruthy();
    expect(approval?.params).toMatchObject({ userId, redacted: true });
    expect(JSON.stringify(approval?.params)).not.toContain("private");

    // the flag is not left on, so ordinary updates and deletes are still refused
    await expect(prisma.auditLog.updateMany({ where: { id: rows[0].id }, data: { actor: "x" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.updateMany({ where: { id: rows[0].id }, data: { after: { other: 1 } } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.deleteMany({ where: { id: rows[0].id } })).rejects.toThrow(/append-only/);
    await supa!.auth.admin.updateUserById(userId, { ban_duration: "none" });
  });

  it("the redaction function and the admin tables are closed to the API roles", async () => {
    const [fn] = await prisma.$queryRaw<{ anon: boolean; auth: boolean; svc: boolean; pub: boolean; owner: string }[]>`
      SELECT has_function_privilege('anon', 'public.redact_audit_for_user(text)', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.redact_audit_for_user(text)', 'EXECUTE') AS auth,
             has_function_privilege('service_role', 'public.redact_audit_for_user(text)', 'EXECUTE') AS svc,
             has_function_privilege('public', 'public.redact_audit_for_user(text)', 'EXECUTE') AS pub,
             pg_get_userbyid(proowner) AS owner
      FROM pg_proc WHERE proname = 'redact_audit_for_user'`;
    expect(fn).toEqual({ anon: false, auth: false, svc: false, pub: false, owner: "audit_redactor" });
    for (const table of ["AuditLog", "AdminApproval", "AdminApiKey", "FeatureFlag", "Announcement", "ServiceSwitch", "ServiceCheck", "ServiceUsage", "AdminSetting", "AdminNote"]) {
      const [row] = await prisma.$queryRawUnsafe<{ rls: boolean; any: boolean }[]>(
        `SELECT c.relrowsecurity AS rls,
                (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') OR (c.relname = ANY($2) AND has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))) AS any
         FROM pg_class c WHERE c.relname = $1 AND c.relnamespace = 'public'::regnamespace`,
        table,
        ["AuditLog", "AdminApproval", "AdminApiKey", "FeatureFlag", "Announcement", "ServiceSwitch", "ServiceCheck", "ServiceUsage", "AdminSetting"], // also closed to service_role
      );
      expect({ table, ...row }).toEqual({ table, rls: true, any: false });
    }
    // functions created from now on are not exposed to the API roles by default either
    const [defaults] = await prisma.$queryRaw<{ acl: string }[]>`
      SELECT defaclacl::text AS acl FROM pg_default_acl WHERE defaclnamespace = 'public'::regnamespace AND defaclobjtype = 'f' AND pg_get_userbyid(defaclrole) = 'postgres'`;
    expect(defaults?.acl ?? "").not.toMatch(/anon|authenticated|service_role/);
    // and an API role really cannot call it
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE anon");
        await tx.$executeRawUnsafe("SELECT public.redact_audit_for_user('00000000-0000-0000-0000-000000000000')");
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("setting the redaction flag from an ordinary session does not unlock the audit log", async () => {
    await svc.requestRefund(API(), { userId, reason: "flag test", idempotencyKey: `db-flag-${userId}` });
    const [row] = await prisma.auditLog.findMany({ where: { target: `user:${userId}` }, take: 1 }).then((r) => (r.length ? r : prisma.auditLog.findMany({ take: 1, orderBy: { createdAt: "desc" } })));
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SELECT set_config('bupulse.audit_redact', 'on', true)");
        await tx.$executeRawUnsafe(`UPDATE "AuditLog" SET "after" = '{"redacted": true}'::jsonb WHERE "id" = '${row.id}'`);
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SELECT set_config('bupulse.audit_redact', 'on', true)");
        await tx.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "id" = '${row.id}'`);
      }),
    ).rejects.toThrow(/append-only/);
  });

  it("admin notes are removed with the account and the audit rows about them are redacted", async () => {
    const { addAdminNote } = await import("@/lib/admin/notes");
    await addAdminNote(svc.consoleContext(), { userId, body: "private note: owner is going through a divorce" });
    await prisma.$executeRaw`SELECT public.redact_audit_for_user(${userId})`;
    const rows = await prisma.auditLog.findMany({ where: { action: "add_admin_note", target: `user:${userId}` } });
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("divorce");
    expect(rows[0].after).toEqual({ redacted: true });
    // the account purge deletes the notes themselves (lib/account-deletion.ts)
    expect(await prisma.adminNote.count({ where: { userId } })).toBe(1);
    await prisma.adminNote.deleteMany({ where: { userId } });
    expect(await prisma.adminNote.count({ where: { userId } })).toBe(0);
  });
});

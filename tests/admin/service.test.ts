import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "./fake-db";

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  updateUserById: vi.fn(async () => ({ error: null })),
  createRefund: vi.fn(),
  describe: vi.fn(),
  changePlan: vi.fn(),
  apply: vi.fn(),
  retryPost: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ auth: { admin: { updateUserById: h.updateUserById, getUserById: async () => ({ data: { user: null } }) } } }) }));
vi.mock("@/lib/billing/paddle", () => ({ paddle: { changePlan: h.changePlan } }));
vi.mock("@/lib/billing/apply", () => ({ applyProviderSubscription: h.apply }));
vi.mock("@/lib/billing/paddle-admin", () => ({ createRefund: h.createRefund, describeRefundTarget: h.describe }));
vi.mock("@/lib/publishing/service", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/service")>()), retryPost: h.retryPost }));

import { resetPlanCache } from "@/lib/plan-catalog";
import { flagDecision } from "@/lib/admin/flags";
import * as svc from "@/lib/admin/service";
import { AdminError, apiContext, consoleContext } from "@/lib/admin/types";
import { consumeUsage, UsageLimitError } from "@/lib/usage";

const API = apiContext("key1", "203.0.113.5");
const CONSOLE = consoleContext("198.51.100.1");
const USER = "11111111-1111-4111-8111-111111111111";
const code = async (p: Promise<unknown>) => p.then(() => null, (e: AdminError) => e.code);
const audit = () => h.db.auditLog.rows;
const lastAudit = () => audit()[audit().length - 1];

function seedUser(over: Record<string, unknown> = {}) {
  h.db.user.rows.push({ id: USER, email: "owner@example.com", suspendedAt: null, suspendedReason: null, ...over });
}
function seedSub(over: Record<string, unknown> = {}) {
  const row = { id: "s1", userId: USER, plan: "STANDARD", status: "ACTIVE", provider: "PADDLE", providerCustomerId: "ctm_1", providerSubscriptionId: "sub_1", interval: "MONTH", trialEndsAt: null, currentPeriodStart: new Date("2026-10-01T00:00:00Z"), ...over };
  h.db.subscription.rows.push(row);
  return row;
}

beforeEach(() => {
  h.db = createFakeDb();
  vi.clearAllMocks();
  resetPlanCache();
  process.env.PADDLE_PRICE_PRO_MONTH = "pri_pro_m";
  process.env.PADDLE_PRICE_PRO_YEAR = "pri_pro_y";
  process.env.PADDLE_PRICE_STANDARD_MONTH = "pri_std_m";
  process.env.PADDLE_PRICE_STANDARD_YEAR = "pri_std_y";
  h.createRefund.mockResolvedValue({ adjustmentId: "adj_1", status: "pending_approval", transactionId: "txn_1", type: "full", amountMinor: null, currency: "USD" });
  h.describe.mockImplementation(async ({ transactionId }: { transactionId?: string }) => ({ transactionId: transactionId ?? "txn_latest", currency: "USD", totalMinor: 4900, status: "completed", billedAt: "2026-10-01T00:00:00Z", lines: [{ id: "txnitm_1", totalMinor: 4900 }] }));
  h.changePlan.mockResolvedValue({ providerSubscriptionId: "sub_1" });
  h.apply.mockResolvedValue("applied");
});

describe("money actions only create approvals", () => {
  it("issue_refund from the API makes a pending approval and touches neither Paddle nor the subscription", async () => {
    seedUser();
    const sub = seedSub();
    const receipt = await svc.requestRefund(API, { userId: USER, reason: "double charge", idempotencyKey: "refund-2026-10-001" });
    expect(receipt).toMatchObject({ status: "pending", kind: "issue_refund", replayed: false });
    expect(receipt.message).toMatch(/owner to approve/i);
    expect(h.createRefund).not.toHaveBeenCalled();
    expect(h.db.subscription.rows[0]).toEqual(sub);
    expect(h.db.adminApproval.rows).toHaveLength(1);
    expect(lastAudit()).toMatchObject({ actor: "jarvis:key1", action: "request_issue_refund", target: `approval:${receipt.id}`, before: undefined, ip: "203.0.113.5" });
    expect(lastAudit().after).toMatchObject({ status: "pending" });
  });

  it("the refund request records the exact payment, currency and amount the owner will approve", async () => {
    seedUser();
    seedSub();
    const full = await svc.requestRefund(API, { userId: USER, reason: "double charge", idempotencyKey: "refund-params-001" });
    expect(h.describe).toHaveBeenCalledWith({ customerId: "ctm_1", transactionId: undefined });
    expect(h.db.adminApproval.rows[0].params).toMatchObject({ userId: USER, transactionId: "txn_latest", currency: "USD", transactionTotalMinor: 4900, refundAmountMinor: 4900, refundType: "full", amountMinor: null });
    const part = await svc.requestRefund(API, { userId: USER, transactionId: "txn_7", amountMinor: 1200, reason: "goodwill", idempotencyKey: "refund-params-002" });
    expect(h.db.adminApproval.rows[1].params).toMatchObject({ transactionId: "txn_7", refundAmountMinor: 1200, refundType: "partial", lineItemId: "txnitm_1" });
    expect(full.id).not.toBe(part.id);
    expect(await code(svc.requestRefund(API, { userId: USER, amountMinor: 99_999, reason: "too much", idempotencyKey: "refund-params-003" }))).toBe("invalid");
    h.describe.mockRejectedValueOnce(new Error("Paddle API 500 boom"));
    expect(await code(svc.requestRefund(API, { userId: USER, reason: "x", idempotencyKey: "refund-params-004" }))).toBe("conflict");
    expect(h.db.adminApproval.rows).toHaveLength(2);
  });

  it("partial refunds are checked against one line item and need lineItemId when there are several", async () => {
    seedUser();
    seedSub();
    h.describe.mockResolvedValue({ transactionId: "txn_multi", currency: "USD", totalMinor: 6000, status: "completed", billedAt: null, lines: [{ id: "li_a", totalMinor: 4000 }, { id: "li_b", totalMinor: 2000 }] });
    const base = { userId: USER, reason: "partial" };
    expect(await code(svc.requestRefund(API, { ...base, amountMinor: 500, idempotencyKey: "refund-line-0001" }))).toBe("invalid"); // which line?
    expect(await code(svc.requestRefund(API, { ...base, amountMinor: 3000, lineItemId: "li_b", idempotencyKey: "refund-line-0002" }))).toBe("invalid"); // more than li_b
    expect(await code(svc.requestRefund(API, { ...base, amountMinor: 500, lineItemId: "nope", idempotencyKey: "refund-line-0003" }))).toBe("invalid");
    expect(await code(svc.requestRefund(API, { ...base, lineItemId: "li_a", idempotencyKey: "refund-line-0004" }))).toBe("invalid"); // no amount
    expect(h.db.adminApproval.rows).toHaveLength(0);
    const ok = await svc.requestRefund(API, { ...base, amountMinor: 3500, lineItemId: "li_a", idempotencyKey: "refund-line-0005" });
    expect(h.db.adminApproval.rows[0].params).toMatchObject({ lineItemId: "li_a", refundAmountMinor: 3500, refundType: "partial" });
    await svc.approveAction(CONSOLE, ok.id);
    expect(h.createRefund).toHaveBeenCalledWith(expect.objectContaining({ lineItemId: "li_a", amountMinor: 3500, transactionId: "txn_multi" }));
  });

  it("a replay does not look the payment up again, even if a newer payment exists by then", async () => {
    seedUser();
    seedSub();
    const input = { userId: USER, reason: "double charge", idempotencyKey: "refund-replay-001" };
    const a = await svc.requestRefund(API, input);
    h.describe.mockResolvedValue({ transactionId: "txn_newer", currency: "USD", totalMinor: 9900, status: "completed", billedAt: null, lines: [{ id: "txnitm_1", totalMinor: 4900 }] });
    const b = await svc.requestRefund(API, input);
    expect(b).toMatchObject({ id: a.id, replayed: true });
    expect(h.describe).toHaveBeenCalledTimes(1);
    expect(h.db.adminApproval.rows[0].params.transactionId).toBe("txn_latest");
  });

  it("change_plan to a paid plan makes a pending approval and never calls Paddle", async () => {
    seedUser();
    seedSub();
    const receipt = await svc.requestChangePlan(API, { userId: USER, plan: "PRO", idempotencyKey: "plan-change-0001" });
    expect(receipt).toMatchObject({ status: "pending", kind: "change_plan" });
    expect(h.changePlan).not.toHaveBeenCalled();
    expect(h.db.subscription.rows[0].plan).toBe("STANDARD");
  });

  it("requires an idempotency key from the API", async () => {
    seedUser();
    seedSub();
    expect(await code(svc.requestRefund(API, { userId: USER, reason: "x" }))).toBe("idempotency_required");
    expect(await code(svc.requestChangePlan(API, { userId: USER, plan: "PRO" }))).toBe("idempotency_required");
    expect(h.db.adminApproval.rows).toHaveLength(0);
  });

  it("an idempotency key replay returns the same approval, even for parallel requests", async () => {
    seedUser();
    seedSub();
    const input = { userId: USER, reason: "double charge", idempotencyKey: "refund-2026-10-002" };
    const [a, b, c] = await Promise.all([svc.requestRefund(API, input), svc.requestRefund(API, input), svc.requestRefund(API, input)]);
    expect(new Set([a.id, b.id, c.id]).size).toBe(1);
    expect(h.db.adminApproval.rows).toHaveLength(1);
    expect([a, b, c].filter((r) => r.replayed)).toHaveLength(2);
  });

  it("the same key with different parameters is a conflict", async () => {
    seedUser();
    seedSub();
    await svc.requestRefund(API, { userId: USER, reason: "a", idempotencyKey: "refund-2026-10-003" });
    expect(await code(svc.requestRefund(API, { userId: USER, reason: "b", idempotencyKey: "refund-2026-10-003" }))).toBe("conflict");
  });

  it("changing to the free trial is not a money action: applied now, needs confirm from the API", async () => {
    seedUser();
    seedSub({ plan: "TRIAL", status: "EXPIRED", provider: null, providerSubscriptionId: null });
    expect(await code(svc.requestChangePlan(API, { userId: USER, plan: "TRIAL" }))).toBe("confirm_required");
    const out = await svc.requestChangePlan(API, { userId: USER, plan: "TRIAL", confirm: true });
    expect(out.status).toBe("applied");
    expect(h.db.subscription.rows[0]).toMatchObject({ plan: "TRIAL", status: "TRIALING" });
    expect(lastAudit()).toMatchObject({ action: "change_plan", target: `user:${USER}` });
    expect(lastAudit().before).toMatchObject({ status: "EXPIRED" });
    expect(h.db.adminApproval.rows).toHaveLength(0);
  });

  it("refuses to move a user with a live paid subscription to the trial", async () => {
    seedUser();
    seedSub();
    expect(await code(svc.requestChangePlan(API, { userId: USER, plan: "TRIAL", confirm: true }))).toBe("conflict");
  });
});

describe("approveAction", () => {
  async function pendingRefund() {
    seedUser();
    seedSub();
    return svc.requestRefund(API, { userId: USER, reason: "double charge", idempotencyKey: "refund-approve-001" });
  }

  it("runs the refund exactly once, even when approved twice in parallel", async () => {
    const { id } = await pendingRefund();
    const results = await Promise.allSettled([svc.approveAction(CONSOLE, id), svc.approveAction(CONSOLE, id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.code).toBe("conflict");
    expect(h.createRefund).toHaveBeenCalledTimes(1);
    expect(h.createRefund).toHaveBeenCalledWith({ customerId: "ctm_1", transactionId: "txn_latest", amountMinor: null, lineItemId: null, reason: "double charge" });
    expect(h.db.adminApproval.rows[0].params.transactionId).toBe("txn_latest");
    expect(h.db.adminApproval.rows[0]).toMatchObject({ status: "executed", decidedBy: "admin" });
    expect(h.db.adminApproval.rows[0].result).toMatchObject({ adjustmentId: "adj_1" });
    const entry = audit().find((a) => a.action === "approve_issue_refund")!;
    expect(entry.before).toMatchObject({ status: "pending" });
    expect(entry.after).toMatchObject({ status: "executed" });
    // approving again later still does nothing
    expect(await code(svc.approveAction(CONSOLE, id))).toBe("conflict");
    expect(h.createRefund).toHaveBeenCalledTimes(1);
  });

  it("refunds exactly the transaction recorded at request time, never a newer one", async () => {
    const { id } = await pendingRefund();
    h.describe.mockResolvedValue({ transactionId: "txn_newer", currency: "USD", totalMinor: 1, status: "completed", billedAt: null, lines: [{ id: "txnitm_1", totalMinor: 4900 }] });
    await svc.approveAction(CONSOLE, id);
    expect(h.createRefund).toHaveBeenCalledWith(expect.objectContaining({ transactionId: "txn_latest" }));
    expect(h.describe).toHaveBeenCalledTimes(1); // only at request time
  });

  it("passes a partial amount and transaction id through", async () => {
    seedUser();
    seedSub();
    const { id } = await svc.requestRefund(API, { userId: USER, transactionId: "txn_9", amountMinor: 1500, reason: "goodwill", idempotencyKey: "refund-partial-01" });
    await svc.approveAction(CONSOLE, id);
    expect(h.createRefund).toHaveBeenCalledWith({ customerId: "ctm_1", transactionId: "txn_9", amountMinor: 1500, lineItemId: "txnitm_1", reason: "goodwill" });
  });

  it("approving a plan change updates the Paddle subscription and applies it", async () => {
    seedUser();
    seedSub();
    const { id } = await svc.requestChangePlan(API, { userId: USER, plan: "PRO", interval: "YEAR", idempotencyKey: "plan-change-0002" });
    const done = await svc.approveAction(CONSOLE, id!);
    expect(h.changePlan).toHaveBeenCalledWith("sub_1", "pri_pro_y");
    expect(h.apply).toHaveBeenCalledTimes(1);
    expect(done.status).toBe("executed");
  });

  it("a Paddle failure marks the approval failed and is not retried", async () => {
    const { id } = await pendingRefund();
    h.createRefund.mockRejectedValueOnce(new Error("Paddle API 400"));
    const done = await svc.approveAction(CONSOLE, id);
    expect(done.status).toBe("failed");
    expect(done.result).toMatchObject({ error: "Paddle API 400" });
    expect(await code(svc.approveAction(CONSOLE, id))).toBe("conflict");
    expect(h.createRefund).toHaveBeenCalledTimes(1);
  });

  it("a definite Paddle refusal (4xx) is failed", async () => {
    const { id } = await pendingRefund();
    h.createRefund.mockRejectedValueOnce(new Error("Paddle API 400 on /adjustments: invalid_field"));
    expect((await svc.approveAction(CONSOLE, id)).status).toBe("failed");
  });

  it.each([["a 5xx", new Error("Paddle API 502 on /adjustments: bad gateway")], ["a timeout", Object.assign(new Error("timed out"), { name: "TimeoutError" })], ["a network failure", new TypeError("fetch failed")]])("%s from Paddle is needs_check, not failed, and is never retried", async (_n, err) => {
    const { id } = await pendingRefund();
    h.createRefund.mockRejectedValueOnce(err);
    const done = await svc.approveAction(CONSOLE, id);
    expect(done.status).toBe("needs_check");
    expect(JSON.stringify(done.result)).toMatch(/Check Paddle/);
    expect(await code(svc.approveAction(CONSOLE, id))).toBe("conflict");
    expect(h.createRefund).toHaveBeenCalledTimes(1);
  });

  it("Paddle succeeded but a later step threw: the Paddle result is recorded first and the status is needs_check, not failed", async () => {
    seedUser();
    seedSub();
    const { id } = await svc.requestChangePlan(API, { userId: USER, plan: "PRO", idempotencyKey: "plan-after-paddle-1" });
    h.apply.mockRejectedValueOnce(new Error("database went away"));
    const order: string[] = [];
    const realUpdate = h.db.adminApproval.update.getMockImplementation()!;
    h.db.adminApproval.update.mockImplementation(async (args) => {
      const data = (args as { data: { status?: string; result?: { stage?: string } } }).data;
      order.push(`${data.status ?? "-"}/${data.result?.stage ?? "-"}`);
      return realUpdate(args);
    });
    const done = await svc.approveAction(CONSOLE, id!);
    expect(h.changePlan).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["-/provider_done", "needs_check/provider_done"]);
    expect(done.status).toBe("needs_check");
    expect(done.result).toMatchObject({ stage: "provider_done", plan: "PRO", providerSubscriptionId: "sub_1", error: "database went away" });
    expect(await code(svc.approveAction(CONSOLE, id!))).toBe("conflict");
  });

  it("the refund result is on record even when the final status write is what fails", async () => {
    const { id } = await pendingRefund();
    const realUpdate = h.db.adminApproval.update.getMockImplementation()!;
    h.db.adminApproval.update.mockImplementation(async (args) => {
      if ((args as { data: { status?: string } }).data.status) throw new Error("write failed");
      return realUpdate(args);
    });
    await expect(svc.approveAction(CONSOLE, id)).rejects.toThrow("write failed");
    expect(h.db.adminApproval.rows[0]).toMatchObject({ status: "approved", result: { stage: "provider_done", adjustmentId: "adj_1" } });
    expect(await code(svc.approveAction(CONSOLE, id))).toBe("conflict");
    expect(h.createRefund).toHaveBeenCalledTimes(1);
  });

  it("only the console can approve or reject: the API is forbidden", async () => {
    const { id } = await pendingRefund();
    expect(await code(svc.approveAction(API, id))).toBe("forbidden");
    expect(await code(svc.rejectAction(API, id))).toBe("forbidden");
    expect(await code(svc.approveAction({ actor: "jarvis:key1", viaApi: false }, id))).toBe("forbidden");
    expect(h.createRefund).not.toHaveBeenCalled();
    expect(h.db.adminApproval.rows[0].status).toBe("pending");
  });

  it("a rejected request can never be executed", async () => {
    const { id } = await pendingRefund();
    await svc.rejectAction(CONSOLE, id);
    expect(await code(svc.approveAction(CONSOLE, id))).toBe("conflict");
    expect(h.createRefund).not.toHaveBeenCalled();
  });

  it("an old request expires instead of running", async () => {
    const { id } = await pendingRefund();
    h.db.adminApproval.rows[0].createdAt = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    expect(await code(svc.approveAction(CONSOLE, id))).toBe("conflict");
    expect(h.db.adminApproval.rows[0].status).toBe("rejected");
    expect(h.createRefund).not.toHaveBeenCalled();
  });
});

describe("direct actions: confirm and audit", () => {
  it("suspend_user needs confirm: true from the API and changes nothing without it", async () => {
    seedUser();
    expect(await code(svc.suspendUser(API, { userId: USER }))).toBe("confirm_required");
    expect(await code(svc.suspendUser(API, { userId: USER, confirm: false }))).toBe("confirm_required");
    expect(h.db.user.rows[0].suspendedAt).toBeNull();
    expect(audit()).toHaveLength(0);
  });

  it("suspend_user blocks the account (flag + Supabase ban), audits before/after, and restore undoes it", async () => {
    seedUser();
    const out = await svc.suspendUser(API, { userId: USER, reason: "chargeback", confirm: true });
    expect(out.signInBlocked).toBe(true);
    expect(h.db.user.rows[0]).toMatchObject({ suspendedReason: "chargeback" });
    expect(h.db.user.rows[0].suspendedAt).toBeInstanceOf(Date);
    expect(h.updateUserById).toHaveBeenCalledWith(USER, { ban_duration: "876000h" });
    expect(out.sessionsEnded).toBe(true);
    expect(h.db.$executeRaw).toHaveBeenCalledTimes(1); // DELETE FROM auth.sessions
    expect(lastAudit()).toMatchObject({ actor: "jarvis:key1", action: "suspend_user", target: `user:${USER}` });
    expect(lastAudit().before).toEqual({ suspendedAt: null });
    expect(lastAudit().after).toMatchObject({ reason: "chargeback" });
    expect(await code(svc.suspendUser(API, { userId: USER, confirm: true }))).toBe("conflict");

    await svc.restoreUser(API, { userId: USER });
    expect(h.db.user.rows[0].suspendedAt).toBeNull();
    expect(h.updateUserById).toHaveBeenLastCalledWith(USER, { ban_duration: "none" });
    expect(lastAudit()).toMatchObject({ action: "restore_user" });
    expect(lastAudit().before).toMatchObject({ reason: "chargeback" });
  });

  it("never suspends the admin account", async () => {
    process.env.ADMIN_EMAILS = "admin@bupulse.com";
    h.db.user.rows.push({ id: USER, email: "Admin@BuPulse.com", suspendedAt: null });
    expect(await code(svc.suspendUser(API, { userId: USER, confirm: true }))).toBe("forbidden");
  });

  it("a suspended user is blocked in consumeUsage even with a live subscription", async () => {
    seedUser({ suspendedAt: new Date() });
    const sub = seedSub();
    (sub as Record<string, unknown>).user = { suspendedAt: new Date() };
    await expect(consumeUsage(USER, "text")).rejects.toBeInstanceOf(UsageLimitError);
  });

  it("extend_trial adds days from the later of now and the current end, with audit before/after", async () => {
    seedUser();
    const end = new Date(Date.now() + 2 * 86_400_000);
    seedSub({ plan: "TRIAL", status: "TRIALING", provider: null, providerSubscriptionId: null, trialEndsAt: end });
    const out = await svc.extendTrial(API, { userId: USER, days: 7 });
    expect(out.trialEndsAt.getTime()).toBe(end.getTime() + 7 * 86_400_000);
    expect(lastAudit()).toMatchObject({ action: "extend_trial", target: `user:${USER}` });
    expect((lastAudit().before as { trialEndsAt: string }).trialEndsAt).toBe(end.toISOString());
    expect((lastAudit().after as { trialEndsAt: string }).trialEndsAt).toBe(new Date(end.getTime() + 7 * 86_400_000).toISOString());
  });

  it("extend_trial revives an expired trial and refuses paid users and bad day counts", async () => {
    seedUser();
    seedSub({ plan: "TRIAL", status: "EXPIRED", provider: null, providerSubscriptionId: null, trialEndsAt: new Date(Date.now() - 3 * 86_400_000) });
    const out = await svc.extendTrial(API, { userId: USER, days: 3 });
    expect(out.status).toBe("TRIALING");
    expect(out.trialEndsAt.getTime()).toBeGreaterThan(Date.now() + 2.9 * 86_400_000);
    expect(await code(svc.extendTrial(API, { userId: USER, days: 0 }))).toBe("invalid");
    expect(await code(svc.extendTrial(API, { userId: USER, days: 91 }))).toBe("invalid");
    h.db.subscription.rows[0].plan = "PRO";
    expect(await code(svc.extendTrial(API, { userId: USER, days: 3 }))).toBe("conflict");
  });

  it("set_feature_flag creates, merges overrides, and audits the change", async () => {
    await svc.setFeatureFlag(API, { key: "new-calendar", enabled: true, rolloutPercent: 25 });
    expect(lastAudit()).toMatchObject({ action: "set_feature_flag", target: "flag:new-calendar", before: undefined });
    await svc.setFeatureFlag(API, { key: "new-calendar", userOverrides: { [USER]: true } });
    await svc.setFeatureFlag(API, { key: "new-calendar", userOverrides: { [USER]: null } });
    expect(h.db.featureFlag.rows[0]).toMatchObject({ enabled: true, rolloutPercent: 25, userOverrides: {} });
    expect(lastAudit().before).toMatchObject({ userOverrides: { [USER]: true } });
    expect(await code(svc.setFeatureFlag(API, { key: "Bad Key!", enabled: true }))).toBe("invalid");
    expect(await code(svc.setFeatureFlag(API, { key: "x", rolloutPercent: 101 }))).toBe("invalid");
  });

  it("flagDecision: override beats switch, rollout is stable and proportional", () => {
    const row = { enabled: true, rolloutPercent: 30, userOverrides: { u_off: false, u_on: true } };
    expect(flagDecision("f", row, "u_off")).toBe(false);
    expect(flagDecision("f", { ...row, enabled: false }, "u_on")).toBe(true);
    expect(flagDecision("f", { ...row, enabled: false }, "other")).toBe(false);
    expect(flagDecision("f", null, "x")).toBe(false);
    const users = Array.from({ length: 2000 }, (_, i) => `user-${i}`);
    const on = users.filter((u) => flagDecision("f", row, u));
    expect(on.length).toBeGreaterThan(450);
    expect(on.length).toBeLessThan(750);
    expect(users.filter((u) => flagDecision("f", row, u))).toEqual(on);
    expect(flagDecision("f", { ...row, rolloutPercent: 100 }, null)).toBe(true);
    expect(flagDecision("f", row, null)).toBe(false);
  });

  it("send_announcement validates, audits, and getActiveAnnouncements filters by window and plan", async () => {
    const now = new Date();
    await svc.sendAnnouncement(API, { title: "Maintenance", body: "Tonight at 22:00 UTC", audience: "all" });
    await svc.sendAnnouncement(API, { title: "Pro only", body: "New thing", audience: "plan", plans: ["PRO"] });
    await svc.sendAnnouncement(API, { title: "Future", body: "Later", startsAt: new Date(now.getTime() + 86_400_000) });
    await svc.sendAnnouncement(API, { title: "Old", body: "Gone", startsAt: new Date(now.getTime() - 5 * 86_400_000), endsAt: new Date(now.getTime() - 86_400_000) });
    // the fake cannot run the nested OR/AND filter against arrays, so check the stored rows and the audit instead
    expect(h.db.announcement.rows.map((r) => r.title)).toEqual(["Maintenance", "Pro only", "Future", "Old"]);
    expect(audit().filter((a) => a.action === "send_announcement")).toHaveLength(4);
    expect(lastAudit().target).toMatch(/^announcement:/);
    expect(await code(svc.sendAnnouncement(API, { title: "x", body: "y", audience: "plan" }))).toBe("invalid");
    expect(await code(svc.sendAnnouncement(API, { title: "", body: "y" }))).toBe("invalid");
    expect(await code(svc.sendAnnouncement(API, { title: "x", body: "y", startsAt: "2026-10-10", endsAt: "2026-10-09" }))).toBe("invalid");
  });

  it("update_plan_limits needs confirm from the API, validates, merges, resets with null, and audits", async () => {
    const trial = () => h.db.planDefinition.rows.find((r) => r.key === "TRIAL")!;
    expect(await code(svc.updatePlanLimits(API, { plan: "TRIAL", limits: { text: 20 } }))).toBe("confirm_required");
    expect(trial().limits.text).toBe(10);
    await svc.updatePlanLimits(API, { plan: "TRIAL", limits: { text: 20 }, confirm: true });
    expect(lastAudit()).toMatchObject({ action: "update_plan_limits", target: "plan:TRIAL" });
    expect((lastAudit().before as { text: number }).text).toBe(10);
    expect((lastAudit().after as { text: number }).text).toBe(20);
    await svc.updatePlanLimits(API, { plan: "TRIAL", limits: { image: 9 }, confirm: true });
    expect(trial().limits).toMatchObject({ text: 20, image: 9, chat: 50 });
    expect(await code(svc.updatePlanLimits(API, { plan: "TRIAL", limits: { text: -1 }, confirm: true }))).toBe("invalid");
    expect(await code(svc.updatePlanLimits(API, { plan: "TRIAL", limits: { bogus: 1 } as never, confirm: true }))).toBe("invalid");
    expect(await code(svc.updatePlanLimits(API, { plan: "NOPE", limits: { text: 1 }, confirm: true }))).toBe("not_found");
    const reset = await svc.updatePlanLimits(API, { plan: "TRIAL", limits: { text: null, image: null }, confirm: true });
    expect(trial().limits).toMatchObject({ text: 10, image: 5 });
    expect(reset.overrides).toEqual({});
  });
});

describe("plan catalog cache", () => {
  it("keeps the last good plans when the database errors, even right after a cache clear", async () => {
    const { getPlans, clearPlanCache } = await import("@/lib/plan-catalog");
    h.db.planDefinition.rows.find((r) => r.key === "TRIAL")!.limits.text = 3;
    expect((await getPlans({ force: true })).find((p) => p.key === "TRIAL")!.limits.text).toBe(3);
    clearPlanCache();
    h.db.planDefinition.findMany.mockRejectedValueOnce(new Error("connection reset"));
    expect((await getPlans()).find((p) => p.key === "TRIAL")!.limits.text).toBe(3);
    // and it recovers on the next call
    h.db.planDefinition.rows.find((r) => r.key === "TRIAL")!.limits.text = 4;
    expect((await getPlans()).find((p) => p.key === "TRIAL")!.limits.text).toBe(4);
  });

  it("force reads fresh data without pushing the cache clock", async () => {
    const { getPlans, clearPlanCache } = await import("@/lib/plan-catalog");
    const pro = () => h.db.planDefinition.rows.find((r) => r.key === "PRO")!;
    pro().limits.chat = 1;
    await getPlans({ force: true });
    pro().limits.chat = 2;
    expect((await getPlans()).find((p) => p.key === "PRO")!.limits.chat).toBe(1); // still cached
    expect((await getPlans({ force: true })).find((p) => p.key === "PRO")!.limits.chat).toBe(2);
    clearPlanCache();
    pro().limits.chat = 3;
    expect((await getPlans()).find((p) => p.key === "PRO")!.limits.chat).toBe(3); // stale after clear
  });
});

describe("plan limits apply in consumeUsage", () => {
  it("a lowered limit blocks sooner, a raised limit allows more", async () => {
    seedUser();
    seedSub({ plan: "TRIAL", status: "TRIALING", provider: null, providerSubscriptionId: null, trialEndsAt: new Date(Date.now() + 86_400_000) });
    await svc.updatePlanLimits(API, { plan: "TRIAL", limits: { text: 2 }, confirm: true });
    await consumeUsage(USER, "text");
    await consumeUsage(USER, "text");
    await expect(consumeUsage(USER, "text")).rejects.toMatchObject({ reason: "limit_reached" });
    await svc.updatePlanLimits(API, { plan: "TRIAL", limits: { text: 3 }, confirm: true });
    await expect(consumeUsage(USER, "text")).resolves.toBeDefined();
    await expect(consumeUsage(USER, "text")).rejects.toMatchObject({ reason: "limit_reached" });
  });

  it("without a change the seeded limits apply", async () => {
    seedUser();
    seedSub({ plan: "TRIAL", status: "TRIALING", provider: null, providerSubscriptionId: null, trialEndsAt: new Date(Date.now() + 86_400_000) });
    for (let i = 0; i < 10; i++) await consumeUsage(USER, "text");
    await expect(consumeUsage(USER, "text")).rejects.toMatchObject({ reason: "limit_reached" });
  });
});

describe("rerun_failed_post", () => {
  const post = (status: string) => h.db.post.rows.push({ id: "p1", businessId: "b1", status, attempts: 3, lastError: "boom", scheduledAt: new Date(), business: { userId: USER } });

  it("refuses NEEDS_ACTION: it may already be live", async () => {
    post("NEEDS_ACTION");
    const err = (await svc.rerunFailedPost(API, { postId: "p1" }).catch((e) => e)) as AdminError;
    expect(err.code).toBe("conflict");
    expect(err.message).toMatch(/NEEDS_ACTION/);
    expect(h.retryPost).not.toHaveBeenCalled();
    expect(audit()).toHaveLength(0);
  });

  it.each(["PUBLISHED", "SCHEDULED", "PUBLISHING", "DRAFT", "CANCELLED"])("refuses %s", async (status) => {
    post(status);
    expect(await code(svc.rerunFailedPost(API, { postId: "p1" }))).toBe("conflict");
    expect(h.retryPost).not.toHaveBeenCalled();
  });

  it("resets a FAILED post through the engine's retry and audits before/after", async () => {
    post("FAILED");
    h.retryPost.mockImplementation(async () => Object.assign(h.db.post.rows[0], { status: "SCHEDULED", attempts: 0, lastError: null }));
    const out = await svc.rerunFailedPost(API, { postId: "p1" });
    expect(h.retryPost).toHaveBeenCalledWith({ businessId: "b1", userId: USER }, "p1");
    expect(out.status).toBe("SCHEDULED");
    expect(lastAudit()).toMatchObject({ action: "rerun_failed_post", target: "post:p1", before: { status: "FAILED", attempts: 3, lastError: "boom" } });
    expect(lastAudit().after).toMatchObject({ status: "SCHEDULED", attempts: 0 });
    expect(await code(svc.rerunFailedPost(API, { postId: "nope" }))).toBe("not_found");
  });
});

describe("monthly costs", () => {
  it("set_monthly_cost writes the cost and an audit row with before and after in one transaction", async () => {
    await svc.setMonthlyCost(CONSOLE, { month: "2026-10", category: "Hosting", amountCents: 500, note: "Cloudflare" });
    expect(h.db.monthlyCost.rows[0]).toMatchObject({ month: "2026-10", category: "hosting", amountCents: 500, note: "Cloudflare" });
    expect(lastAudit()).toMatchObject({ actor: "admin", action: "set_monthly_cost", target: "cost:2026-10:hosting", before: undefined, after: { amountCents: 500, note: "Cloudflare" } });
    await svc.setMonthlyCost(CONSOLE, { month: "2026-10", category: "hosting", amountCents: 700 });
    expect(h.db.monthlyCost.rows).toHaveLength(1);
    expect(lastAudit().before).toEqual({ amountCents: 500, note: "Cloudflare" });
    expect(lastAudit().after).toEqual({ amountCents: 700, note: null });
    expect(h.db.$transaction).toHaveBeenCalledTimes(2);
  });

  it("validates month, category, amount and a 120 character note, changing and auditing nothing when invalid", async () => {
    const ok = { month: "2026-10", category: "email", amountCents: 100 };
    for (const bad of [{ ...ok, month: "2026-13" }, { ...ok, category: "" }, { ...ok, category: "x".repeat(41) }, { ...ok, amountCents: -1 }, { ...ok, amountCents: 1.5 }, { ...ok, note: "n".repeat(121) }]) {
      expect(await code(svc.setMonthlyCost(CONSOLE, bad))).toBe("invalid");
    }
    await svc.setMonthlyCost(CONSOLE, { ...ok, note: "n".repeat(120) });
    expect(h.db.monthlyCost.rows).toHaveLength(1);
    expect(audit()).toHaveLength(1);
  });

  it("delete_monthly_cost removes it with the old value in the audit row, and refuses a missing one", async () => {
    await svc.setMonthlyCost(CONSOLE, { month: "2026-09", category: "domain", amountCents: 1200 });
    await svc.deleteMonthlyCost(CONSOLE, { month: "2026-09", category: "Domain" });
    expect(h.db.monthlyCost.rows).toHaveLength(0);
    expect(lastAudit()).toMatchObject({ action: "delete_monthly_cost", target: "cost:2026-09:domain", before: { amountCents: 1200, note: null }, after: undefined });
    expect(await code(svc.deleteMonthlyCost(CONSOLE, { month: "2026-09", category: "domain" }))).toBe("not_found");
    expect(audit()).toHaveLength(2);
  });
});

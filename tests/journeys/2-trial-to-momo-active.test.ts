import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";
import { authUser, code, companyOf, DAY, installSignUp, recipients, seedCatalog, subjects } from "./world";

// Journey 2: a client on its trial pays by Mobile Money. The payment gets a BP- reference and the RWF price, the client
// reports the transaction id, the owner approves it (ACTIVE with a period end), a replayed transaction id is refused,
// renewal notices go out before the period ends, and after the grace days the account becomes read-only (nothing is
// deleted) until the client pays again. docs/MOMO.md, docs/RWANDA_LAUNCH_PLAN.md section 12.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  sendEmail: vi.fn<(email: { to: string; subject: string; html: string; text: string }) => Promise<boolean>>(async () => true),
  track: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.sendEmail }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: { signup: "signup" }, trackEvent: h.track }));

import { ensureAccount } from "@/lib/account";
import { accountBlock, companyEntitlements, hasFeature } from "@/lib/entitlements";
import { consumeUsage } from "@/lib/usage";
import { cancelManualPayment, confirmManualPayment, rejectManualPayment, startManualPayment, submitManualProof } from "@/lib/billing/momo";
import { processMomoRenewals } from "@/lib/billing/momo-renewals";
import { clearMomoSettingsCache } from "@/lib/billing/momo-settings";
import { MOMO_SETTING_KEY } from "@/lib/billing/momo-shared";
import { resetPlanCache } from "@/lib/plan-catalog";
import { resetRegionCache } from "@/lib/region";
import { resetRegionPriceCache } from "@/lib/region-prices";
import { clearSwitchCache } from "@/lib/admin/switch";
import { apiContext, consoleContext } from "@/lib/admin/types";

const CONSOLE = consoleContext("198.51.100.1");
const API = apiContext("key1", "203.0.113.5");
const PAID_AT = new Date("2026-10-14T10:00:00Z");
const audits = (action: string) => h.db.auditLog.rows.filter((r) => r.action === action);

/** A Rwandan company in the middle of its trial, having chosen Business. */
async function trialingCompany(n: number) {
  await ensureAccount(authUser(n, "Rwanda") as never);
  const company = companyOf(h.db, n);
  Object.assign(company.subscription, { status: "TRIALING", chosenPlan: "BUSINESS", trialEndsAt: new Date(PAID_AT.getTime() + 1 * DAY), currentPeriodStart: new Date(PAID_AT.getTime() - 2 * DAY), currentPeriodEnd: new Date(PAID_AT.getTime() + 1 * DAY) });
  return company;
}
const proof = (userId: string, paymentId: string, over: Record<string, string> = {}) =>
  submitManualProof(userId, { paymentId, transactionId: "MP2610140001", payerPhone: "078 123 4567", network: "MTN", ...over }, PAID_AT);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(PAID_AT);
  h.db = createFakeDb();
  installSignUp(h.db);
  h.sendEmail.mockClear();
  h.track.mockClear();
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  clearSwitchCache();
  seedCatalog(h.db);
  h.db.adminSetting.rows.push({ key: MOMO_SETTING_KEY, value: { merchantCode: "123456", momoNumber: "0788000000", accountName: "BuPulse" } });
  clearMomoSettingsCache();
  vi.stubEnv("ADMIN_EMAILS", "owner@bupulse.com, second@bupulse.com");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bupulse.test");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("journey: trial -> Mobile Money -> ACTIVE -> renewal -> grace -> read-only", () => {
  it("pays, is approved once, gets reminders, and lapses read-only after the grace days", async () => {
    const { userId, businessId, subscription } = await trialingCompany(1);
    expect(await hasFeature(businessId, "webhooks")).toBe(true); // trial: the chosen plan's features

    // 1. Start: one pending payment with a BP- reference and the RWF price of the plan in the company's region.
    const payment = await startManualPayment({ userId, plan: "BUSINESS", interval: "MONTH", now: PAID_AT });
    expect(payment).toMatchObject({ planKey: "BUSINESS", interval: "MONTH", amountMinor: 35000, currency: "RWF", status: "pending", submitted: false });
    expect(payment.reference).toMatch(/^BP-[A-Z2-9]{4}$/);
    expect((await startManualPayment({ userId, plan: "BUSINESS", interval: "MONTH", now: PAID_AT })).id).toBe(payment.id); // a reload makes no second one
    expect(h.db.manualPayment.rows).toHaveLength(1);

    // The owner cannot confirm money nobody reported yet, and the API cannot confirm at all.
    expect(await code(confirmManualPayment(CONSOLE, payment.id, PAID_AT))).toMatch(/^conflict: The client has not said they paid/);
    expect(await code(confirmManualPayment(API, payment.id, PAID_AT))).toMatch(/^forbidden/);
    expect(subscription).toMatchObject({ status: "TRIALING", plan: "TRIAL" });

    // 2. The client reports the transaction id: bad input is refused, a good one alerts every admin.
    await expect(proof(userId, payment.id, { transactionId: "x" })).rejects.toThrow();
    h.sendEmail.mockClear();
    const submitted = await proof(userId, payment.id);
    expect(submitted).toMatchObject({ submitted: true, status: "pending", transactionId: "MP2610140001", network: "MTN" });
    expect(recipients(h.sendEmail.mock.calls)).toEqual(["owner@bupulse.com", "second@bupulse.com"]);
    expect(h.track).toHaveBeenCalledWith("momo_payment_submitted", expect.objectContaining({ userId, props: expect.objectContaining({ plan: "BUSINESS", amountMinor: 35000 }) }));
    expect(subscription).toMatchObject({ status: "TRIALING", plan: "TRIAL" }); // reporting is not paying
    // A submitted payment cannot be cancelled by the client: the owner decides it.
    expect(await cancelManualPayment(userId, payment.id, PAID_AT)).toBe(false);

    // 3. Another company replays the same transaction id while it is waiting: refused.
    const other = await trialingCompany(2);
    const otherPayment = await startManualPayment({ userId: other.userId, plan: "BUSINESS", interval: "MONTH", now: PAID_AT });
    await expect(proof(other.userId, otherPayment.id)).rejects.toThrow(/already been used/);
    await expect(proof(other.userId, otherPayment.id, { transactionId: "mp2610140001" })).rejects.toThrow(/already been used/); // case does not matter
    expect(h.db.manualPayment.rows.find((r) => r.id === otherPayment.id)).toMatchObject({ submittedAt: null, transactionId: null });

    // 4. The owner approves: ACTIVE on MANUAL_MOMO with the plan and a period end one month on.
    h.sendEmail.mockClear();
    const done = await confirmManualPayment(CONSOLE, payment.id, PAID_AT);
    const periodEnd = new Date("2026-11-14T10:00:00Z");
    expect(done).toMatchObject({ status: "confirmed", plan: "BUSINESS", periodMode: "fresh", periodEnd, emailed: true });
    expect(subscription).toMatchObject({ status: "ACTIVE", plan: "BUSINESS", provider: "MANUAL_MOMO", interval: "MONTH", trialEndsAt: null, cancelAtPeriodEnd: false, currentPeriodEnd: periodEnd });
    expect(h.db.manualPayment.rows.find((r) => r.id === payment.id)).toMatchObject({ status: "confirmed", decidedBy: "admin", periodEnd });
    expect(subjects(h.sendEmail.mock.calls)).toEqual(["Your BuPulse Business plan is active"]);
    expect(recipients(h.sendEmail.mock.calls)).toEqual(["owner1@example.com"]);
    expect(audits("confirm_momo_payment")).toHaveLength(1);
    expect(audits("confirm_momo_payment")[0]).toMatchObject({ target: `payment:${payment.id}`, before: { status: "pending" }, after: { status: "confirmed", reference: payment.reference, amountMinor: 35000, currency: "RWF", period: "fresh" } });
    const revenue = h.db.billingEvent.rows.filter((r) => r.type === "manual_payment.confirmed");
    expect(revenue).toHaveLength(1);
    expect(revenue[0]).toMatchObject({ provider: "MANUAL_MOMO", eventId: payment.id, userId });
    expect(revenue[0].payload.data).toMatchObject({ amount_minor: 35000, currency: "RWF", usd_cents: Math.round((35000 / 1450) * 100) });
    // Entitlements: the paid plan's limits now (Business: 200 texts), not the trial's 10.
    expect((await companyEntitlements(businessId)).block).toBeNull();
    for (let i = 0; i < 12; i++) await consumeUsage(userId, "text");

    // 5. Approving twice changes nothing; the transaction id cannot pay again, for anyone.
    const writes = h.db.auditLog.rows.length;
    expect(await code(confirmManualPayment(CONSOLE, payment.id, PAID_AT))).toMatch(/^conflict: This payment is already confirmed/);
    expect(await code(rejectManualPayment(CONSOLE, payment.id, "too late", PAID_AT))).toMatch(/^conflict: This payment is already confirmed/);
    expect(h.db.auditLog.rows).toHaveLength(writes);
    expect(subscription.currentPeriodEnd).toEqual(periodEnd);
    const again = await startManualPayment({ userId, plan: "BUSINESS", interval: "MONTH", now: PAID_AT });
    await expect(proof(userId, again.id)).rejects.toThrow(/already been used/);
    await expect(proof(other.userId, otherPayment.id)).rejects.toThrow(/already been used/);
    expect(await cancelManualPayment(userId, again.id, PAID_AT)).toBe(true);

    // 6. Renewal notices: nothing early, the 5-day notice once with the amount and where to pay, the 1-day notice once.
    h.sendEmail.mockClear();
    expect(await processMomoRenewals({ now: new Date(periodEnd.getTime() - 10 * DAY) })).toMatchObject({ checked: 0 });
    expect(await processMomoRenewals({ now: new Date(periodEnd.getTime() - 4.5 * DAY) })).toMatchObject({ checked: 1, reminded5d: 1, reminded1d: 0, pastDue: 0 });
    expect(await processMomoRenewals({ now: new Date(periodEnd.getTime() - 4 * DAY) })).toMatchObject({ reminded5d: 0, skipped: 1 });
    expect(await processMomoRenewals({ now: new Date(periodEnd.getTime() - 0.5 * DAY) })).toMatchObject({ reminded1d: 1 });
    expect(await processMomoRenewals({ now: new Date(periodEnd.getTime() - 0.25 * DAY) })).toMatchObject({ reminded1d: 0 });
    expect(subjects(h.sendEmail.mock.calls)).toEqual(["Your BuPulse Business plan ends in 5 days", "Your BuPulse Business plan ends tomorrow"]);
    expect(recipients(h.sendEmail.mock.calls)).toEqual(["owner1@example.com", "owner1@example.com"]);
    expect((h.sendEmail.mock.calls[0][0] as { text: string }).text).toContain("35,000 RWF");
    expect(h.db.renewalNotice.rows.map((r) => r.kind)).toEqual(["5d", "1d"]);

    // 7. The period ends. During the grace days the plan still works; after them it is read-only (PAST_DUE), with a
    // "paused" email, one audit row, and nothing deleted.
    expect(await processMomoRenewals({ now: new Date(periodEnd.getTime() + 2 * DAY) })).toMatchObject({ pastDue: 0 });
    expect(subscription.status).toBe("ACTIVE");
    expect(await hasFeature(businessId, "content")).toBe(true);
    h.sendEmail.mockClear();
    expect(await processMomoRenewals({ now: new Date(periodEnd.getTime() + 3 * DAY) })).toMatchObject({ pastDue: 1 });
    expect(subscription.status).toBe("PAST_DUE");
    expect(subjects(h.sendEmail.mock.calls)).toEqual(["Your BuPulse Business plan is paused"]);
    expect(audits("momo_past_due")).toHaveLength(1);
    expect(audits("momo_past_due")[0]).toMatchObject({ actor: "system:cron", target: `user:${userId}`, after: { status: "PAST_DUE" } });
    expect(accountBlock({ plan: subscription.plan, status: subscription.status, chosenPlan: null })).toBe("past_due");
    expect((await companyEntitlements(businessId)).block).toBe("past_due");
    expect(await hasFeature(businessId, "content")).toBe(false);
    await expect(consumeUsage(userId, "text")).rejects.toMatchObject({ reason: "past_due" });
    expect(h.db.business.rows.find((b) => b.id === businessId)).toBeTruthy();
    // Not paused twice.
    expect(await processMomoRenewals({ now: new Date(periodEnd.getTime() + 5 * DAY) })).toMatchObject({ pastDue: 0 });
    expect(subjects(h.sendEmail.mock.calls)).toHaveLength(1);

    // 8. Paying again (with a new transaction id) brings it back from the date of approval.
    const lateAt = new Date(periodEnd.getTime() + 6 * DAY);
    const late = await startManualPayment({ userId, plan: "BUSINESS", interval: "MONTH", now: lateAt });
    await submitManualProof(userId, { paymentId: late.id, transactionId: "MP2610200002", payerPhone: "0781234567", network: "MTN" }, lateAt);
    expect(await confirmManualPayment(CONSOLE, late.id, lateAt)).toMatchObject({ periodMode: "fresh" });
    expect(subscription).toMatchObject({ status: "ACTIVE", currentPeriodEnd: new Date("2026-12-20T10:00:00Z") });
    expect((await companyEntitlements(businessId)).block).toBeNull();
    expect(await hasFeature(businessId, "content")).toBe(true);
  });

  it("an early renewal extends the running period instead of wasting the days left; a rejected payment can be retried", async () => {
    const { userId, subscription } = await trialingCompany(1);
    const first = await startManualPayment({ userId, plan: "BUSINESS", interval: "MONTH", now: PAID_AT });
    await proof(userId, first.id);
    await confirmManualPayment(CONSOLE, first.id, PAID_AT);
    const end1 = new Date(subscription.currentPeriodEnd);

    const early = new Date(end1.getTime() - 3 * DAY);
    const second = await startManualPayment({ userId, plan: "BUSINESS", interval: "MONTH", now: early });
    expect(second.periodNote).toMatchObject({ mode: "extend", daysLeft: 3 });
    await submitManualProof(userId, { paymentId: second.id, transactionId: "MP2610200003", payerPhone: "0781234567", network: "MTN" }, early);
    // The money did not arrive: rejected with a reason, the client is told and the plan is untouched.
    h.sendEmail.mockClear();
    await rejectManualPayment(CONSOLE, second.id, "Amount received was 3,500 RWF", early);
    expect(subjects(h.sendEmail.mock.calls)).toEqual([`Your BuPulse payment ${second.reference} needs another look`]);
    expect(subscription.currentPeriodEnd).toEqual(end1);
    expect(audits("reject_momo_payment")).toHaveLength(1);

    const retry = await startManualPayment({ userId, plan: "BUSINESS", interval: "MONTH", now: early });
    expect(retry.id).not.toBe(second.id);
    await submitManualProof(userId, { paymentId: retry.id, transactionId: "MP2610200004", payerPhone: "0781234567", network: "MTN" }, early);
    expect(await confirmManualPayment(CONSOLE, retry.id, early)).toMatchObject({ periodMode: "extend" });
    expect(subscription.currentPeriodEnd).toEqual(new Date("2026-12-14T10:00:00Z")); // from the old end, not from today
    expect(subscription.currentPeriodStart).toEqual(new Date(PAID_AT)); // the usage anchor does not move
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// The Mobile Money service (lib/billing/momo.ts) against the in-memory database: one pending payment at a time,
// the proof, the owner's confirm (period, usage, revenue, audit, email) and reject, each exactly once.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  sendEmail: vi.fn<(email: { to: string; subject: string; html: string; text: string }) => Promise<boolean>>(async () => true),
  trackEvent: vi.fn(),
  verify: vi.fn(async () => true),
}));

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.sendEmail }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: {}, trackEvent: h.trackEvent }));
vi.mock("@/lib/billing/signing", () => ({ verifyCheckoutUser: h.verify, signCheckoutUser: async () => "sig" }));

import { resetPlanCache } from "@/lib/plan-catalog";
import { AdminError, apiContext, consoleContext } from "@/lib/admin/types";
import { applyProviderSubscription } from "@/lib/billing/apply";
import * as momo from "@/lib/billing/momo";
import { clearMomoSettingsCache, getMomoPrice, saveMomoSettings } from "@/lib/billing/momo-settings";
import { MOMO_SETTING_KEY } from "@/lib/billing/momo-shared";

const CONSOLE = consoleContext("198.51.100.1");
const API = apiContext("key1", "203.0.113.5");
const USER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-14T10:00:00Z");
const code = async (p: Promise<unknown>) => p.then(() => null, (e: AdminError) => e.code);
const msg = async (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);
const audit = () => h.db.auditLog.rows;
const lastAudit = () => audit()[audit().length - 1];

function seed(sub: Record<string, unknown> = {}) {
  h.db.user.rows.push({ id: USER, email: "owner@example.rw", name: "Aline Uwase", suspendedAt: null });
  h.db.business.rows.push({ id: "biz1", userId: USER, name: "Inzu Fashion", ceoName: "Aline" });
  h.db.subscription.rows.push({ id: "s1", userId: USER, plan: "TRIAL", status: "TRIALING", provider: null, providerCustomerId: null, providerSubscriptionId: null, providerPriceId: null, interval: "MONTH", cancelAtPeriodEnd: false, trialEndsAt: new Date("2026-10-17T00:00:00Z"), currentPeriodStart: new Date("2026-10-10T00:00:00Z"), currentPeriodEnd: null, ...sub });
}
const settings = (over: Record<string, unknown> = {}) =>
  h.db.adminSetting.rows.push({ key: MOMO_SETTING_KEY, value: { merchantCode: "123456", momoNumber: "0788000000", accountName: "BuPulse", usdToRwf: 1450, prices: { STANDARD: { monthlyMinor: 15000, yearlyMinor: 150000 }, PRO: { monthlyMinor: 35000, yearlyMinor: 350000 } }, ...over } });
const start = (over: Partial<Parameters<typeof momo.startManualPayment>[0]> = {}) => momo.startManualPayment({ userId: USER, plan: "STANDARD", interval: "MONTH", now: NOW, ...over });
const proof = (paymentId: string, over: Record<string, string> = {}) => momo.submitManualProof(USER, { paymentId, transactionId: "MP1234567", payerPhone: "078 123 4567", network: "MTN", ...over }, NOW);

beforeEach(() => {
  h.db = createFakeDb();
  vi.clearAllMocks();
  resetPlanCache();
  clearMomoSettingsCache();
  process.env.ADMIN_EMAILS = "owner@bupulse.com, second@bupulse.com";
  process.env.RESEND_API_KEY = "re_test";
});

describe("prices and settings", () => {
  it("uses the owner's RWF prices, else converts the USD price", async () => {
    settings();
    expect(await getMomoPrice("STANDARD", "MONTH")).toEqual({ amountMinor: 15000, currency: "RWF" });
    expect(await getMomoPrice("PRO", "YEAR")).toEqual({ amountMinor: 350000, currency: "RWF" });
    h.db.adminSetting.rows.length = 0;
    clearMomoSettingsCache();
    expect((await getMomoPrice("STANDARD", "MONTH"))?.amountMinor).toBe(71100);
    expect(await getMomoPrice("NOPE", "MONTH")).toBeNull();
  });

  it("saving the settings is console-only and audited with before and after", async () => {
    expect(await code(saveMomoSettings(API, { merchantCode: "1" }))).toBe("forbidden");
    expect(await code(saveMomoSettings(CONSOLE, { usdToRwf: 5 }))).toBe("invalid");
    expect(await code(saveMomoSettings(CONSOLE, { prices: { NOPE: { monthlyMinor: 1, yearlyMinor: 1 } } }))).toBe("invalid");
    const saved = await saveMomoSettings(CONSOLE, { merchantCode: "123456", prices: { STANDARD: { monthlyMinor: 15000, yearlyMinor: 150000 } } });
    expect(saved).toMatchObject({ merchantCode: "123456", prices: { STANDARD: { monthlyMinor: 15000, yearlyMinor: 150000 } } });
    expect(lastAudit()).toMatchObject({ actor: "admin", action: "set_momo_settings", target: "setting:billing.momo" });
    expect((lastAudit().after as { merchantCode: string }).merchantCode).toBe("123456");
    await saveMomoSettings(CONSOLE, { prices: { STANDARD: null } });
    expect((await getMomoPrice("STANDARD", "MONTH"))?.amountMinor).toBe(71100);
  });
});

describe("starting a payment", () => {
  it("needs the owner's payment details and a sellable plan", async () => {
    seed();
    expect(await msg(start())).toMatch(/not available right now/);
    settings();
    expect(await msg(start({ plan: "TRIAL" }))).toMatch(/not available/);
    expect(await msg(start({ plan: "NOPE" }))).toMatch(/not available/);
  });

  it("makes one pending payment with a BP- reference and the RWF price, and reuses it on a second start", async () => {
    seed();
    settings();
    const p = await start();
    expect(p).toMatchObject({ planKey: "STANDARD", planName: "Standard", interval: "MONTH", amountMinor: 15000, currency: "RWF", status: "pending", submitted: false });
    expect(p.reference).toMatch(/^BP-[A-Z2-9]{4}$/);
    const again = await start();
    expect(again.id).toBe(p.id);
    expect(h.db.manualPayment.rows).toHaveLength(1);
  });

  it("a different plan before paying replaces the open payment; after I've paid the open one stays", async () => {
    seed();
    settings();
    const first = await start();
    const second = await start({ plan: "PRO", interval: "YEAR" });
    expect(second.id).not.toBe(first.id);
    expect(second.amountMinor).toBe(350000);
    expect(h.db.manualPayment.rows.find((r) => r.id === first.id)?.status).toBe("expired");
    await proof(second.id);
    const third = await start({ plan: "STANDARD" });
    expect(third.id).toBe(second.id);
  });

  it("retries the reference when it collides", async () => {
    seed();
    settings();
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    h.db.manualPayment.rows.push({ id: "taken", userId: "22222222-2222-4222-8222-222222222222", planKey: "PRO", interval: "MONTH", amountMinor: 1, reference: "BP-AAAA", status: "expired" });
    const p = await start();
    random.mockRestore();
    expect(p.reference).toBe("BP-AAAAAA");
  });

  it("refuses while a card subscription is live, allows once it has ended", async () => {
    seed({ plan: "STANDARD", status: "ACTIVE", provider: "PADDLE", providerSubscriptionId: "sub_1" });
    settings();
    expect(await msg(start())).toMatch(/pay by card at the moment/);
    h.db.subscription.rows[0].status = "CANCELED";
    expect((await start()).status).toBe("pending");
  });
});

describe("the proof", () => {
  it("records the transaction id and phone once, alerts every admin address, and refuses a second submission of a closed payment", async () => {
    seed();
    settings();
    const p = await start();
    expect(await msg(proof(p.id, { transactionId: "ab" }))).toMatch(/transaction id/);
    const done = await proof(p.id);
    expect(done).toMatchObject({ submitted: true, transactionId: "MP1234567", payerPhone: "078 123 4567", network: "MTN", status: "pending" });
    expect(h.sendEmail).toHaveBeenCalledTimes(2);
    const mail = h.sendEmail.mock.calls[0][0] as unknown as { to: string; subject: string; text: string };
    expect(mail.to).toBe("owner@bupulse.com");
    expect(mail.subject).toBe(`New MoMo payment to check: ${p.reference} · 15,000 RWF`);
    expect(mail.text).toContain("Inzu Fashion (owner@example.rw)");
    expect(mail.text).toContain("MP1234567");
    expect(h.trackEvent).toHaveBeenCalledWith("momo_payment_submitted", expect.objectContaining({ userId: USER }));
    // Already submitted: the same payment comes back, no second alert.
    expect((await proof(p.id, { transactionId: "OTHER999" })).transactionId).toBe("MP1234567");
    expect(h.sendEmail).toHaveBeenCalledTimes(2);
    expect(await msg(momo.submitManualProof("33333333-3333-4333-8333-333333333333", { paymentId: p.id, transactionId: "MP1234", payerPhone: "078 123 4567", network: "MTN" }))).toMatch(/could not find/);
  });

  it("the client can cancel before, not after, saying they paid", async () => {
    seed();
    settings();
    const p = await start();
    expect(await momo.cancelManualPayment(USER, p.id, NOW)).toBe(true);
    expect(await momo.currentManualPayment(USER, NOW)).toBeNull();
    const q = await start();
    await proof(q.id);
    expect(await momo.cancelManualPayment(USER, q.id, NOW)).toBe(false);
    expect((await momo.currentManualPayment(USER, NOW))?.id).toBe(q.id);
  });
});

describe("confirming", () => {
  async function submitted(sub: Record<string, unknown> = {}, over: Record<string, unknown> = {}) {
    seed(sub);
    settings();
    const p = await start(over);
    await proof(p.id);
    h.sendEmail.mockClear();
    h.trackEvent.mockClear();
    return p;
  }

  it("is the owner's own decision: console only, and only for a submitted pending payment", async () => {
    seed();
    settings();
    const p = await start();
    expect(await code(momo.confirmManualPayment(API, p.id))).toBe("forbidden");
    expect(await code(momo.confirmManualPayment(CONSOLE, "nope"))).toBe("not_found");
    expect(await msg(momo.confirmManualPayment(CONSOLE, p.id))).toMatch(/not said they paid yet/);
    expect(h.db.subscription.rows[0].status).toBe("TRIALING");
  });

  it("from a trial: switches the plan on for a month from now, resets usage, records the money, audits and emails", async () => {
    h.db.usageRecord.rows.push({ id: "u1", userId: USER, periodStart: new Date("2026-10-10T00:00:00Z"), textGenerations: 9 });
    const p = await submitted();
    const done = await momo.confirmManualPayment(CONSOLE, p.id, NOW);
    expect(done).toMatchObject({ status: "confirmed", plan: "STANDARD", periodStart: NOW, periodEnd: new Date("2026-11-14T10:00:00Z"), emailed: true });
    const sub = h.db.subscription.rows[0];
    expect(sub).toMatchObject({ plan: "STANDARD", status: "ACTIVE", provider: "MANUAL_MOMO", interval: "MONTH", providerSubscriptionId: null, providerCustomerId: null, trialEndsAt: null, cancelAtPeriodEnd: false, currentPeriodStart: NOW, currentPeriodEnd: new Date("2026-11-14T10:00:00Z") });
    expect(h.db.manualPayment.rows[0]).toMatchObject({ status: "confirmed", decidedBy: "admin", periodStart: NOW });
    // Usage counts from the new period start: the old record (periodStart 10 October) is no longer the current window.
    const { usageWindowStart } = await import("@/lib/billing/period");
    expect(usageWindowStart(sub.currentPeriodStart as Date, NOW)).toEqual(NOW);
    expect(h.db.usageRecord.rows.some((r) => r.periodStart.getTime() === NOW.getTime())).toBe(false);
    // Money for the roll-up: one BillingEvent in USD cents at the owner's rate.
    expect(h.db.billingEvent.rows).toHaveLength(1);
    expect(h.db.billingEvent.rows[0]).toMatchObject({ provider: "MANUAL_MOMO", type: "manual_payment.confirmed", eventId: p.id, userId: USER });
    expect((h.db.billingEvent.rows[0].payload as { data: { usd_cents: number; amount_minor: number; id: string } }).data).toMatchObject({ usd_cents: 1034, amount_minor: 15000, id: p.reference });
    const { parseMoneyEvent } = await import("@/lib/analytics/math");
    expect(parseMoneyEvent("manual_payment.confirmed", h.db.billingEvent.rows[0].payload, NOW)).toMatchObject({ kind: "payment", cents: 1034, id: p.reference });
    expect(lastAudit()).toMatchObject({ actor: "admin", action: "confirm_momo_payment", target: `payment:${p.id}`, ip: "198.51.100.1" });
    expect(lastAudit().before).toMatchObject({ status: "pending", subscription: { plan: "TRIAL" } });
    expect(lastAudit().after).toMatchObject({ status: "confirmed", subscription: { plan: "STANDARD", status: "ACTIVE" } });
    expect(h.trackEvent).toHaveBeenCalledWith("upgrade", expect.objectContaining({ userId: USER, businessId: "biz1", props: expect.objectContaining({ plan: "STANDARD", from: "TRIAL", method: "momo" }) }));
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    const mail = h.sendEmail.mock.calls[0][0] as unknown as { to: string; subject: string; text: string };
    expect(mail.to).toBe("owner@example.rw");
    expect(mail.subject).toBe("Your BuPulse Standard plan is active");
    expect(mail.text).toContain("November 14, 2026");
  });

  it("a second click is refused and changes nothing", async () => {
    const p = await submitted();
    await momo.confirmManualPayment(CONSOLE, p.id, NOW);
    expect(await code(momo.confirmManualPayment(CONSOLE, p.id, NOW))).toBe("conflict");
    expect(await code(momo.rejectManualPayment(CONSOLE, p.id, "changed my mind"))).toBe("conflict");
    expect(h.db.billingEvent.rows).toHaveLength(1);
    expect(audit().filter((a) => a.action === "confirm_momo_payment")).toHaveLength(1);
  });

  it("renewing early extends the running Mobile Money period from its end; a yearly payment adds twelve months", async () => {
    const end = new Date("2026-10-20T00:00:00Z");
    const p = await submitted({ plan: "STANDARD", status: "ACTIVE", provider: "MANUAL_MOMO", currentPeriodStart: new Date("2026-09-20T00:00:00Z"), currentPeriodEnd: end }, { plan: "PRO", interval: "YEAR" });
    const done = await momo.confirmManualPayment(CONSOLE, p.id, NOW);
    expect(done.periodStart).toEqual(end);
    expect(done.periodEnd).toEqual(new Date("2027-10-20T00:00:00Z"));
    expect(h.db.subscription.rows[0]).toMatchObject({ plan: "PRO", interval: "YEAR", status: "ACTIVE", currentPeriodStart: end, currentPeriodEnd: new Date("2027-10-20T00:00:00Z") });
    expect(h.trackEvent).toHaveBeenCalledWith("plan_change", expect.anything());
  });

  it("after the grace period (PAST_DUE) the new period starts now and the account is active again", async () => {
    const p = await submitted({ plan: "STANDARD", status: "PAST_DUE", provider: "MANUAL_MOMO", currentPeriodStart: new Date("2026-09-01T00:00:00Z"), currentPeriodEnd: new Date("2026-10-01T00:00:00Z") });
    const done = await momo.confirmManualPayment(CONSOLE, p.id, NOW);
    expect(done.periodStart).toEqual(NOW);
    expect(h.db.subscription.rows[0].status).toBe("ACTIVE");
  });

  it("refuses while a live card subscription exists", async () => {
    seed({ plan: "STANDARD", status: "ACTIVE", provider: "PADDLE", providerSubscriptionId: "sub_1" });
    settings();
    h.db.manualPayment.rows.push({ id: "m1", userId: USER, planKey: "PRO", interval: "MONTH", amountMinor: 35000, reference: "BP-ZZZZ", status: "pending", submittedAt: NOW, transactionId: "X1", payerPhone: "078", network: "MTN" });
    expect(await msg(momo.confirmManualPayment(CONSOLE, "m1", NOW))).toMatch(/live card subscription/);
    expect(h.db.manualPayment.rows[0].status).toBe("pending");
  });

  it("a late card webhook cannot end a live Mobile Money plan, and a new live card subscription is a duplicate", async () => {
    const p = await submitted();
    await momo.confirmManualPayment(CONSOLE, p.id, NOW);
    process.env.PADDLE_PRICE_STANDARD_MONTH = "pri_std_m";
    const base = { providerSubscriptionId: "sub_old", providerCustomerId: "ctm_1", providerPriceId: "pri_std_m", userId: USER, userIdSignature: "sig", currentPeriodStart: NOW, currentPeriodEnd: null, cancelAtPeriodEnd: false, updatedAt: NOW };
    expect(await applyProviderSubscription("PADDLE", { ...base, status: "CANCELED" })).toBe("stale");
    expect(await applyProviderSubscription("PADDLE", { ...base, status: "ACTIVE" })).toBe("duplicate");
    expect(h.db.subscription.rows[0]).toMatchObject({ provider: "MANUAL_MOMO", status: "ACTIVE" });
  });
});

describe("rejecting", () => {
  it("needs a reason, is console only, happens once, is audited and tells the client", async () => {
    seed();
    settings();
    const p = await start();
    await proof(p.id);
    h.sendEmail.mockClear();
    expect(await code(momo.rejectManualPayment(API, p.id, "no money"))).toBe("forbidden");
    expect(await code(momo.rejectManualPayment(CONSOLE, p.id, "no"))).toBe("invalid");
    const done = await momo.rejectManualPayment(CONSOLE, p.id, "No payment with this reference arrived.", NOW);
    expect(done).toEqual({ id: p.id, status: "rejected", emailed: true });
    expect(h.db.manualPayment.rows[0]).toMatchObject({ status: "rejected", rejectReason: "No payment with this reference arrived.", decidedBy: "admin" });
    expect(lastAudit()).toMatchObject({ action: "reject_momo_payment", target: `payment:${p.id}` });
    const mail = h.sendEmail.mock.calls[0][0] as unknown as { subject: string; text: string };
    expect(mail.subject).toBe(`Your BuPulse payment ${p.reference} needs another look`);
    expect(mail.text).toContain("No payment with this reference arrived.");
    expect(await code(momo.rejectManualPayment(CONSOLE, p.id, "again", NOW))).toBe("conflict");
    expect(h.db.subscription.rows[0].status).toBe("TRIALING");
    // The client sees the rejection on Billing for a week, then it is gone; a new confirmed payment hides it sooner.
    expect((await momo.currentManualPayment(USER, NOW))?.status).toBe("rejected");
    expect(await momo.currentManualPayment(USER, new Date("2026-10-22T10:00:00Z"))).toBeNull();
  });
});

describe("reads", () => {
  it("lists payments with company and email, pending ones submitted first, and counts what needs checking", async () => {
    seed();
    settings();
    const a = await start();
    await proof(a.id);
    h.db.manualPayment.rows.push({ id: "b", userId: USER, planKey: "PRO", interval: "MONTH", amountMinor: 35000, reference: "BP-BBBB", status: "pending", createdAt: new Date("2026-10-14T11:00:00Z") });
    h.db.manualPayment.rows.push({ id: "c", userId: USER, planKey: "PRO", interval: "MONTH", amountMinor: 35000, reference: "BP-CCCC", status: "confirmed", createdAt: new Date("2026-10-01T11:00:00Z") });
    const pending = await momo.listManualPayments({ status: "pending" });
    expect(pending.items.map((p) => p.id)).toEqual([a.id, "b"]);
    expect(pending.items[0]).toMatchObject({ company: "Inzu Fashion", email: "owner@example.rw", submitted: true, planName: "Standard" });
    expect(await momo.pendingManualPaymentCount()).toBe(1);
    expect((await momo.listManualPayments({ reference: "bp-cccc" })).items.map((p) => p.id)).toEqual(["c"]);
    expect(await code(momo.listManualPayments({ status: "weird" }))).toBe("invalid");
    expect(await code(momo.listManualPayments({ reference: "nope" }))).toBe("invalid");
    expect((await momo.getManualPayment("c")).status).toBe("confirmed");
    expect(await code(momo.getManualPayment("zzz"))).toBe("not_found");
  });
});

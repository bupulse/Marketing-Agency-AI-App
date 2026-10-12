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
import { clearMomoSettingsCache, getMomoPrice, getMomoSettings, saveMomoSettings } from "@/lib/billing/momo-settings";
import { MOMO_SETTING_KEY } from "@/lib/billing/momo-shared";
import { resetRegionCache } from "@/lib/region";
import { resetRegionPriceCache } from "@/lib/region-prices";

const CONSOLE = consoleContext("198.51.100.1");
const API = apiContext("key1", "203.0.113.5");
const USER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-14T10:00:00Z");
const code = async (p: Promise<unknown>) => p.then(() => null, (e: AdminError) => e.code);
const msg = async (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);
const audit = () => h.db.auditLog.rows;
const lastAudit = () => audit()[audit().length - 1];

/** A Rwandan company (region RW: Mobile Money and card; the regions table is empty, so lib/region serves the seeds). */
function seed(sub: Record<string, unknown> = {}) {
  h.db.user.rows.push({ id: USER, email: "owner@example.rw", name: "Aline Uwase", suspendedAt: null });
  h.db.business.rows.push({ id: "biz1", userId: USER, name: "Inzu Fashion", ceoName: "Aline", pricingRegion: "RW" });
  h.db.subscription.rows.push({ id: "s1", userId: USER, plan: "TRIAL", status: "TRIALING", provider: null, providerCustomerId: null, providerSubscriptionId: null, providerPriceId: null, interval: "MONTH", cancelAtPeriodEnd: false, trialEndsAt: new Date("2026-10-17T00:00:00Z"), currentPeriodStart: new Date("2026-10-10T00:00:00Z"), currentPeriodEnd: null, ...sub });
}
/** The RW prices of the seed plans (PlanRegionPrice): what Mobile Money clients pay (docs/REGIONS.md). */
const prices = () => {
  h.db.planRegionPrice.rows.push(
    { id: "prp_std", planKey: "STANDARD", regionKey: "RW", currency: "RWF", monthlyMinor: 15000, yearlyMinor: 150000 },
    { id: "prp_pro", planKey: "PRO", regionKey: "RW", currency: "RWF", monthlyMinor: 35000, yearlyMinor: 350000 },
  );
  resetRegionPriceCache();
};
// Both are cached for 30 s (lib/billing/momo-settings.ts, lib/region-prices.ts): seeding after a read must clear them.
const settings = (over: Record<string, unknown> = {}) => {
  prices();
  h.db.adminSetting.rows.push({ key: MOMO_SETTING_KEY, value: { merchantCode: "123456", momoNumber: "0788000000", accountName: "BuPulse", ...over } });
  clearMomoSettingsCache();
};
const start = (over: Partial<Parameters<typeof momo.startManualPayment>[0]> = {}) => momo.startManualPayment({ userId: USER, plan: "STANDARD", interval: "MONTH", now: NOW, ...over });
const proof = (paymentId: string, over: Record<string, string> = {}) => momo.submitManualProof(USER, { paymentId, transactionId: "MP1234567", payerPhone: "078 123 4567", network: "MTN", ...over }, NOW);

beforeEach(() => {
  h.db = createFakeDb();
  vi.clearAllMocks();
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  clearMomoSettingsCache();
  process.env.ADMIN_EMAILS = "owner@bupulse.com, second@bupulse.com";
  process.env.RESEND_API_KEY = "re_test";
});

describe("prices and settings", () => {
  it("the Mobile Money price is the plan's price in the company's region; nothing where the region has no Mobile Money", async () => {
    seed();
    prices();
    expect(await getMomoPrice("biz1", "STANDARD", "MONTH")).toEqual({ amountMinor: 15000, currency: "RWF" });
    expect(await getMomoPrice("biz1", "PRO", "YEAR")).toEqual({ amountMinor: 350000, currency: "RWF" });
    expect(await getMomoPrice("biz1", "NOPE", "MONTH")).toBeNull();
    // The same company moved to the catch-all region (card only): no Mobile Money price, whatever the plan.
    h.db.business.rows[0].pricingRegion = "GLOBAL";
    expect(await getMomoPrice("biz1", "STANDARD", "MONTH")).toBeNull();
  });

  it("saving the settings is console-only, refuses malformed codes and numbers, and is audited with before and after", async () => {
    expect(await code(saveMomoSettings(API, { merchantCode: "1" }))).toBe("forbidden");
    expect(await msg(saveMomoSettings(CONSOLE, { merchantCode: "12AB" }))).toMatch(/4 to 12 digits/);
    expect(await msg(saveMomoSettings(CONSOLE, { momoNumber: "0781" }))).toMatch(/phone number/);
    expect(await msg(saveMomoSettings(CONSOLE, { accountName: "x".repeat(81) }))).toMatch(/80 characters/);
    expect(h.db.adminSetting.rows).toHaveLength(0);
    const saved = await saveMomoSettings(CONSOLE, { merchantCode: " 123456 " });
    expect(saved).toEqual({ merchantCode: "123456", momoNumber: "", accountName: "", airtelNumber: "" });
    expect(lastAudit()).toMatchObject({ actor: "admin", action: "set_momo_settings", target: "setting:billing.momo" });
    expect((lastAudit().after as { merchantCode: string }).merchantCode).toBe("123456");
  });

  it("the audit's before comes from the stored row, not the cache, and a changed code or number emails every admin", async () => {
    settings({ merchantCode: "111111" });
    expect((await getMomoSettings()).merchantCode).toBe("111111"); // cached now
    h.db.adminSetting.rows[0].value = { ...h.db.adminSetting.rows[0].value, merchantCode: "222222" }; // changed behind the cache
    await saveMomoSettings(CONSOLE, { accountName: "BuPulse Ltd" });
    expect((lastAudit().before as { merchantCode: string }).merchantCode).toBe("222222");
    expect(h.sendEmail).not.toHaveBeenCalled(); // the name alone is not where clients pay
    await saveMomoSettings(CONSOLE, { momoNumber: "078 999 8888" });
    expect(h.sendEmail).toHaveBeenCalledTimes(2);
    const mail = h.sendEmail.mock.calls[0][0];
    expect(mail.to).toBe("owner@bupulse.com");
    expect(mail.subject).toBe("Mobile Money payment details changed");
    expect(mail.text).toContain("MoMo Pay code 222222");
    expect(mail.text).toContain("MTN number 078 999 8888");
  });
});

describe("starting a payment", () => {
  it("needs the owner's payment details, a sellable plan, and a region that takes Mobile Money for the plan", async () => {
    seed();
    expect(await msg(start())).toMatch(/not available right now/);
    settings();
    expect(await msg(start({ plan: "TRIAL" }))).toMatch(/not available/);
    expect(await msg(start({ plan: "NOPE" }))).toMatch(/not available/);
    // A plan with no price in the company's region, and a company in a card-only region: refused before anything is written.
    h.db.planRegionPrice.rows.splice(1, 1); // PRO no longer priced in RW
    resetRegionPriceCache();
    expect(await msg(start({ plan: "PRO" }))).toMatch(/not available for this plan where your business is/);
    h.db.business.rows[0].pricingRegion = "GLOBAL";
    expect(await msg(start())).toMatch(/not available for this plan where your business is/);
    expect(h.db.manualPayment.rows).toHaveLength(0);
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

  it("starts at most MOMO_DAILY_PAYMENTS new payments a day per company; the open one is still returned", async () => {
    seed();
    settings();
    for (let i = 0; i < momo.MOMO_DAILY_PAYMENTS; i++) {
      const p = await start({ interval: i % 2 === 0 ? "YEAR" : "MONTH" }); // each switch expires the open one and makes a new row
      h.db.manualPayment.rows.find((r) => r.id === p.id)!.createdAt = NOW;
    }
    expect(h.db.manualPayment.rows).toHaveLength(momo.MOMO_DAILY_PAYMENTS);
    const open = h.db.manualPayment.rows.find((r) => r.status === "pending")!;
    // Same plan and period as the open one: no new row, so the cap does not apply.
    expect((await start({ interval: open.interval as "MONTH" | "YEAR" })).id).toBe(open.id);
    expect(await msg(start({ interval: open.interval === "MONTH" ? "YEAR" : "MONTH" }))).toMatch(/many Mobile Money payments today/);
    // A day later the company may start again.
    expect((await start({ interval: open.interval === "MONTH" ? "YEAR" : "MONTH", now: new Date(NOW.getTime() + 25 * 3_600_000) })).status).toBe("pending");
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

  it("refuses while a card subscription still renews; a cancelled one hands over at its period end", async () => {
    seed({ plan: "STANDARD", status: "ACTIVE", provider: "PADDLE", providerSubscriptionId: "sub_1", currentPeriodEnd: new Date("2026-11-01T00:00:00Z") });
    settings();
    expect(await msg(start())).toMatch(/pay by card at the moment/);
    h.db.subscription.rows[0].cancelAtPeriodEnd = true;
    const p = await start();
    expect(p).toMatchObject({ status: "pending", periodNote: { mode: "extend", daysLeft: 18, currentEnd: "2026-11-01T00:00:00.000Z" } });
    h.db.subscription.rows[0] = { ...h.db.subscription.rows[0], status: "CANCELED", cancelAtPeriodEnd: false };
    expect((await start()).periodNote).toBeNull();
  });

  it("two requests racing for the first payment both get the one row (the unique index decides)", async () => {
    seed();
    settings();
    const real = h.db.manualPayment.create.getMockImplementation()!;
    h.db.manualPayment.create.mockImplementationOnce(async (args) => {
      // Another request created the company's pending payment between our read and our write.
      await real({ data: { ...args.data, reference: "BP-RACE" } });
      throw Object.assign(new Error("Unique constraint failed on ManualPayment_one_pending_per_user"), { code: "P2002" });
    });
    const p = await start();
    expect(p.reference).toBe("BP-RACE");
    expect(h.db.manualPayment.rows).toHaveLength(1);
  });

  it("the expire-and-replace race returns whatever is open now", async () => {
    seed();
    settings();
    const first = await start();
    h.db.manualPayment.updateMany.mockImplementationOnce(async () => ({ count: 0 })); // submitted from another tab meanwhile
    const again = await start({ plan: "PRO" });
    expect(again.id).toBe(first.id);
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

  it("a transaction id already used by a pending or confirmed payment of any company is refused; closed ones are not", async () => {
    seed();
    settings();
    const other = "22222222-2222-4222-8222-222222222222";
    h.db.manualPayment.rows.push({ id: "theirs", userId: other, planKey: "PRO", interval: "MONTH", amountMinor: 35000, reference: "BP-THEM", status: "confirmed", network: "MTN", transactionId: "mp1234567", submittedAt: NOW, createdAt: new Date("2026-10-01T00:00:00Z") });
    const p = await start();
    expect(await msg(proof(p.id))).toMatch(/already been used/);
    expect(await msg(proof(p.id, { network: "AIRTEL" }))).toBeNull(); // a different network is a different id space
    h.db.manualPayment.rows[0].status = "rejected";
    const q = await start({ plan: "PRO" });
    h.db.manualPayment.rows.find((r) => r.id === q.id)!.submittedAt = null;
    expect(await msg(proof(q.id, { transactionId: "MP1234567", network: "MTN" }))).toBeNull();
    // The unique index catching a race is reported the same way.
    const r = await start({ plan: "STANDARD", interval: "YEAR" });
    h.db.manualPayment.updateMany.mockImplementationOnce(async () => { throw Object.assign(new Error("Unique constraint failed on ManualPayment_live_transaction_key"), { code: "P2002" }); });
    expect(await msg(proof(r.id, { transactionId: "NEW999" }))).toMatch(/already been used/);
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
    expect(done).toMatchObject({ status: "confirmed", plan: "STANDARD", periodMode: "fresh", periodStart: NOW, periodEnd: new Date("2026-11-14T10:00:00Z"), emailed: true });
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

  it("renewing the same plan early extends the period from its end and keeps the usage anchor; yearly adds twelve months", async () => {
    const end = new Date("2026-10-20T00:00:00Z");
    const anchor = new Date("2026-09-20T00:00:00Z");
    const p = await submitted({ plan: "STANDARD", status: "ACTIVE", provider: "MANUAL_MOMO", currentPeriodStart: anchor, currentPeriodEnd: end });
    expect(p.periodNote).toEqual({ mode: "extend", daysLeft: 6, currentEnd: end.toISOString() });
    const done = await momo.confirmManualPayment(CONSOLE, p.id, NOW);
    expect(done).toMatchObject({ periodMode: "extend", periodStart: end, periodEnd: new Date("2026-11-20T00:00:00Z") });
    // currentPeriodStart is never in the future: usage keeps counting from the anchor, and resets on its monthly rhythm.
    expect(h.db.subscription.rows[0]).toMatchObject({ plan: "STANDARD", status: "ACTIVE", currentPeriodStart: anchor, currentPeriodEnd: new Date("2026-11-20T00:00:00Z") });
    expect(h.db.manualPayment.rows[0]).toMatchObject({ periodStart: end, periodEnd: new Date("2026-11-20T00:00:00Z") });
    const { usageWindowStart, usageWindowEnd } = await import("@/lib/billing/period");
    expect(usageWindowStart(anchor, NOW)).toEqual(anchor);
    expect(usageWindowEnd(anchor, NOW)).toEqual(end);
    expect(h.trackEvent).not.toHaveBeenCalledWith("plan_change", expect.anything());
    // Yearly, same plan: twelve months after the end.
    h.db.manualPayment.rows.length = 0;
    h.db.user.rows.length = 0;
    h.db.business.rows.length = 0;
    h.db.subscription.rows.length = 0;
    h.db.adminSetting.rows.length = 0;
    clearMomoSettingsCache();
    const q = await submitted({ plan: "STANDARD", interval: "YEAR", status: "ACTIVE", provider: "MANUAL_MOMO", currentPeriodStart: anchor, currentPeriodEnd: end }, { interval: "YEAR" });
    expect((await momo.confirmManualPayment(CONSOLE, q.id, NOW)).periodEnd).toEqual(new Date("2027-10-20T00:00:00Z"));
  });

  it("a different plan or interval replaces the running period from now (no free overlap), and says so", async () => {
    const end = new Date("2026-10-20T00:00:00Z");
    const p = await submitted({ plan: "STANDARD", status: "ACTIVE", provider: "MANUAL_MOMO", currentPeriodStart: new Date("2026-09-20T00:00:00Z"), currentPeriodEnd: end }, { plan: "PRO", interval: "YEAR" });
    expect(p.periodNote).toEqual({ mode: "replace", daysLeft: 6, currentEnd: end.toISOString() });
    expect((await momo.getManualPayment(p.id, NOW)).periodNote?.mode).toBe("replace");
    const done = await momo.confirmManualPayment(CONSOLE, p.id, NOW);
    expect(done).toMatchObject({ periodMode: "replace", periodStart: NOW, periodEnd: new Date("2027-10-14T10:00:00Z") });
    expect(h.db.subscription.rows[0]).toMatchObject({ plan: "PRO", interval: "YEAR", status: "ACTIVE", currentPeriodStart: NOW, currentPeriodEnd: new Date("2027-10-14T10:00:00Z") });
    expect(h.trackEvent).toHaveBeenCalledWith("plan_change", expect.anything());
    expect((lastAudit().after as { period: string }).period).toBe("replace");
  });

  it("a cancelled card plan hands over to Mobile Money from its period end", async () => {
    const end = new Date("2026-11-01T00:00:00Z");
    const p = await submitted({ plan: "STANDARD", status: "ACTIVE", provider: "PADDLE", providerSubscriptionId: "sub_1", providerCustomerId: "ctm_1", cancelAtPeriodEnd: true, currentPeriodStart: new Date("2026-10-01T00:00:00Z"), currentPeriodEnd: end });
    const done = await momo.confirmManualPayment(CONSOLE, p.id, NOW);
    expect(done).toMatchObject({ periodMode: "extend", periodStart: end, periodEnd: new Date("2026-12-01T00:00:00Z") });
    expect(h.db.subscription.rows[0]).toMatchObject({ provider: "MANUAL_MOMO", providerSubscriptionId: null, providerCustomerId: null, cancelAtPeriodEnd: false, currentPeriodStart: new Date("2026-10-01T00:00:00Z"), currentPeriodEnd: new Date("2026-12-01T00:00:00Z") });
  });

  it("a subscription that moves between the read and the write is re-read and the period recomputed, once", async () => {
    const p = await submitted();
    const real = h.db.subscription.updateMany.getMockImplementation()!;
    // The fake database has no rollback: undo the payment's claim by hand, as the failed transaction would.
    const rollback = () => Object.assign(h.db.manualPayment.rows.find((r) => r.id === p.id) ?? h.db.manualPayment.rows[0], { status: "pending", decidedAt: null, decidedBy: null, periodStart: null, periodEnd: null });
    h.db.subscription.updateMany.mockImplementationOnce(async (args) => {
      // A confirmation from another tab landed: the client is now on a paid-up MoMo period.
      Object.assign(h.db.subscription.rows[0], { plan: "STANDARD", status: "ACTIVE", provider: "MANUAL_MOMO", currentPeriodStart: NOW, currentPeriodEnd: new Date("2026-11-14T10:00:00Z") });
      const out = await real(args);
      if (out.count === 0) rollback();
      return out;
    });
    const done = await momo.confirmManualPayment(CONSOLE, p.id, NOW);
    expect(done).toMatchObject({ periodMode: "extend", periodStart: new Date("2026-11-14T10:00:00Z"), periodEnd: new Date("2026-12-14T10:00:00Z") });
    expect(h.db.manualPayment.rows[0].status).toBe("confirmed");
    expect(h.db.billingEvent.rows).toHaveLength(1);
    // Moving twice is given up with a conflict and nothing confirmed.
    h.db.manualPayment.rows.length = 0;
    h.db.billingEvent.rows.length = 0;
    const q = await start({ plan: "PRO" });
    await proof(q.id, { transactionId: "MP7654321" });
    h.db.subscription.updateMany.mockImplementation(async () => {
      Object.assign(h.db.manualPayment.rows[0], { status: "pending", decidedAt: null, periodStart: null, periodEnd: null });
      return { count: 0 };
    });
    expect(await code(momo.confirmManualPayment(CONSOLE, q.id, NOW))).toBe("conflict");
    h.db.subscription.updateMany.mockImplementation(real);
    expect(h.db.manualPayment.rows[0].status).toBe("pending");
    expect(h.db.billingEvent.rows).toHaveLength(0);
  });

  it("a transaction id confirmed on another payment meanwhile is caught inside the transaction", async () => {
    const p = await submitted();
    h.db.manualPayment.rows.push({ id: "other", userId: "22222222-2222-4222-8222-222222222222", planKey: "PRO", interval: "MONTH", amountMinor: 1, reference: "BP-OTHR", status: "confirmed", network: "MTN", transactionId: "MP1234567", submittedAt: NOW, createdAt: new Date("2026-10-13T00:00:00Z") });
    expect(await msg(momo.confirmManualPayment(CONSOLE, p.id, NOW))).toMatch(/confirmed on another payment/);
    expect(h.db.manualPayment.rows[0].status).toBe("pending");
    expect(h.db.subscription.rows[0].status).toBe("TRIALING");
  });

  it("a company waiting for its demo (PENDING_DEMO) or whose trial expired pays and is ACTIVE on the plan it paid for", async () => {
    const p = await submitted({ status: "PENDING_DEMO", chosenPlan: "STANDARD", trialEndsAt: null }, { plan: "PRO" });
    expect(p.periodNote).toBeNull();
    const done = await momo.confirmManualPayment(CONSOLE, p.id, NOW);
    expect(done).toMatchObject({ status: "confirmed", plan: "PRO", periodMode: "fresh", periodStart: NOW });
    expect(h.db.subscription.rows[0]).toMatchObject({ plan: "PRO", status: "ACTIVE", provider: "MANUAL_MOMO", trialEndsAt: null, currentPeriodStart: NOW });
    // No longer waiting for the demo and no longer on the trial: the dashboard opens and the paid plan's features apply.
    const { featurePlanKey } = await import("@/lib/entitlements");
    expect(featurePlanKey({ plan: "PRO", status: "ACTIVE", chosenPlan: "STANDARD" })).toBe("PRO");
    const { consumeUsage } = await import("@/lib/usage");
    await expect(consumeUsage(USER, "text")).resolves.toMatchObject({ periodStart: NOW });
    // An expired trial (the trial-reminders cron flipped it) is reopened the same way.
    h.db.manualPayment.rows.length = 0;
    h.db.usageRecord.rows.length = 0;
    Object.assign(h.db.subscription.rows[0], { plan: "TRIAL", status: "EXPIRED", provider: null, trialEndsAt: new Date("2026-10-13T00:00:00Z"), currentPeriodEnd: null });
    const q = await start({ plan: "STANDARD" });
    await proof(q.id, { transactionId: "MP2222222" });
    await momo.confirmManualPayment(CONSOLE, q.id, NOW);
    expect(h.db.subscription.rows[0]).toMatchObject({ plan: "STANDARD", status: "ACTIVE", provider: "MANUAL_MOMO" });
  });

  it("after the grace period (PAST_DUE) the new period starts now and the account is active again", async () => {
    const p = await submitted({ plan: "STANDARD", status: "PAST_DUE", provider: "MANUAL_MOMO", currentPeriodStart: new Date("2026-09-01T00:00:00Z"), currentPeriodEnd: new Date("2026-10-01T00:00:00Z") });
    const done = await momo.confirmManualPayment(CONSOLE, p.id, NOW);
    expect(done.periodStart).toEqual(NOW);
    expect(h.db.subscription.rows[0].status).toBe("ACTIVE");
  });

  it("refuses while a card subscription still renews", async () => {
    seed({ plan: "STANDARD", status: "ACTIVE", provider: "PADDLE", providerSubscriptionId: "sub_1" });
    settings();
    h.db.manualPayment.rows.push({ id: "m1", userId: USER, planKey: "PRO", interval: "MONTH", amountMinor: 35000, reference: "BP-ZZZZ", status: "pending", submittedAt: NOW, transactionId: "X1", payerPhone: "078", network: "MTN" });
    expect(await msg(momo.confirmManualPayment(CONSOLE, "m1", NOW))).toMatch(/card subscription that still renews/);
    expect(h.db.manualPayment.rows[0].status).toBe("pending");
  });

  it("a late card webhook cannot end a paid-up Mobile Money plan, a new live card subscription on it is a duplicate, and a lapsed one is replaced", async () => {
    const p = await submitted();
    // Confirmed with a period end in the real future, so the plan counts as paid up when apply() looks at the clock.
    await momo.confirmManualPayment(CONSOLE, p.id, new Date(Date.now() + 60_000));
    process.env.PADDLE_PRICE_STANDARD_MONTH = "pri_std_m";
    const base = { providerSubscriptionId: "sub_old", providerCustomerId: "ctm_1", providerPriceId: "pri_std_m", userId: USER, userIdSignature: "sig", currentPeriodStart: NOW, currentPeriodEnd: null, cancelAtPeriodEnd: false, updatedAt: NOW };
    expect(await applyProviderSubscription("PADDLE", { ...base, status: "CANCELED" })).toBe("stale");
    expect(await applyProviderSubscription("PADDLE", { ...base, status: "ACTIVE" })).toBe("duplicate");
    expect(h.db.subscription.rows[0]).toMatchObject({ provider: "MANUAL_MOMO", status: "ACTIVE" });
    // Past due (grace over): a new card subscription takes over, no duplicate handling.
    h.db.subscription.rows[0].status = "PAST_DUE";
    expect(await applyProviderSubscription("PADDLE", { ...base, status: "ACTIVE" })).toBe("applied");
    expect(h.db.subscription.rows[0]).toMatchObject({ provider: "PADDLE", status: "ACTIVE", providerSubscriptionId: "sub_old" });
    // Lapsed (period over, grace not yet run): the same.
    Object.assign(h.db.subscription.rows[0], { provider: "MANUAL_MOMO", providerSubscriptionId: null, status: "ACTIVE", currentPeriodEnd: new Date(Date.now() - 60_000) });
    expect(await applyProviderSubscription("PADDLE", { ...base, status: "ACTIVE" })).toBe("applied");
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
  it("lists payments with company and email, orders the queue in the database, warns about a transaction id seen before, and counts what needs checking", async () => {
    seed();
    settings();
    const a = await start();
    await proof(a.id);
    h.db.manualPayment.rows.push({ id: "c", userId: USER, planKey: "PRO", interval: "MONTH", amountMinor: 35000, reference: "BP-CCCC", status: "rejected", network: "MTN", transactionId: "mp1234567", submittedAt: new Date("2026-10-01T12:00:00Z"), createdAt: new Date("2026-10-01T11:00:00Z") });
    const pending = await momo.listManualPayments({ status: "pending" });
    expect(h.db.manualPayment.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: [{ submittedAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }] }));
    expect(pending.items[0]).toMatchObject({ id: a.id, company: "Inzu Fashion", email: "owner@example.rw", submitted: true, planName: "Standard", seenBefore: { id: "c", reference: "BP-CCCC", status: "rejected", sameCompany: true } });
    expect(pending.nextCursor).toBeNull();
    expect(await momo.pendingManualPaymentCount()).toBe(1);
    expect((await momo.listManualPayments({ reference: "bp-cccc" })).items.map((p) => p.id)).toEqual(["c"]);
    expect(await code(momo.listManualPayments({ status: "weird" }))).toBe("invalid");
    expect(await code(momo.listManualPayments({ reference: "nope" }))).toBe("invalid");
    expect(await code(momo.listManualPayments({ cursor: "junk" }))).toBe("invalid");
    expect((await momo.getManualPayment("c")).status).toBe("rejected");
    expect(await code(momo.getManualPayment("zzz"))).toBe("not_found");
  });

  it("pages the history newest first with a (createdAt, id) cursor", async () => {
    seed();
    const at = new Date("2026-10-05T00:00:00Z");
    for (const id of ["p1", "p2", "p3"]) h.db.manualPayment.rows.push({ id, userId: USER, planKey: "PRO", interval: "MONTH", amountMinor: 1, reference: `BP-${id.toUpperCase()}X`, status: "expired", createdAt: at });
    const first = await momo.listManualPayments({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe(`${at.getTime()}~${first.items[1].id}`);
    expect(h.db.manualPayment.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 3 }));
    await momo.listManualPayments({ limit: 2, cursor: first.nextCursor! });
    expect(h.db.manualPayment.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: first.items[1].id } }] } }));
  });
});

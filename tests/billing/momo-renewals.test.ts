import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// The daily Mobile Money job: reminders 5 and 1 day before the end (once each), 3 days of grace, then PAST_DUE and a
// "paused" email, and closing payments nobody submitted.

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, sendEmail: vi.fn<(email: { to: string; subject: string; html: string; text: string }) => Promise<boolean>>(async () => true) }));

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.sendEmail }));

import { resetPlanCache } from "@/lib/plan-catalog";
import { processMomoRenewals } from "@/lib/billing/momo-renewals";
import { clearMomoSettingsCache } from "@/lib/billing/momo-settings";
import { MOMO_SETTING_KEY } from "@/lib/billing/momo-shared";
import { clearSwitchCache } from "@/lib/admin/switch";

const USER = "11111111-1111-4111-8111-111111111111";
const END = new Date("2026-10-20T00:00:00Z");
const at = (s: string) => new Date(s);
const run = (now: Date) => processMomoRenewals({ now });
const mails = () => h.sendEmail.mock.calls.map((c) => (c[0] as unknown as { subject: string }).subject);
const notices = () => h.db.renewalNotice.rows.map((r) => r.kind);

function seed(sub: Record<string, unknown> = {}) {
  h.db.user.rows.push({ id: USER, email: "owner@example.rw", name: "Aline Uwase" });
  h.db.business.rows.push({ id: "biz1", userId: USER, name: "Inzu Fashion" });
  h.db.subscription.rows.push({ id: "s1", userId: USER, plan: "STANDARD", status: "ACTIVE", provider: "MANUAL_MOMO", providerSubscriptionId: null, interval: "MONTH", cancelAtPeriodEnd: false, currentPeriodStart: at("2026-09-20T00:00:00Z"), currentPeriodEnd: END, ...sub });
  h.db.adminSetting.rows.push({ key: MOMO_SETTING_KEY, value: { merchantCode: "123456", accountName: "BuPulse", usdToRwf: 1450, prices: { STANDARD: { monthlyMinor: 15000, yearlyMinor: 150000 } } } });
}

beforeEach(() => {
  h.db = createFakeDb();
  vi.clearAllMocks();
  resetPlanCache();
  clearMomoSettingsCache();
  clearSwitchCache();
  process.env.RESEND_API_KEY = "re_test";
});

describe("reminders", () => {
  it("sends the 5-day reminder once, with the amount, where to pay and a WhatsApp text, then the 1-day one once", async () => {
    seed();
    expect(await run(at("2026-10-10T06:00:00Z"))).toMatchObject({ checked: 0, reminded5d: 0 });
    expect(await run(at("2026-10-15T06:00:00Z"))).toMatchObject({ checked: 1, reminded5d: 1, reminded1d: 0, pastDue: 0 });
    expect(await run(at("2026-10-16T06:00:00Z"))).toMatchObject({ reminded5d: 0, skipped: 1 });
    expect(await run(at("2026-10-19T06:00:00Z"))).toMatchObject({ reminded1d: 1 });
    expect(await run(at("2026-10-19T18:00:00Z"))).toMatchObject({ reminded1d: 0, skipped: 1 });
    expect(mails()).toEqual(["Your BuPulse Standard plan ends in 5 days", "Your BuPulse Standard plan ends tomorrow"]);
    const first = h.sendEmail.mock.calls[0][0] as unknown as { to: string; text: string };
    expect(first.to).toBe("owner@example.rw");
    expect(first.text).toContain("15,000 RWF");
    expect(first.text).toContain("MoMo Pay code 123456");
    expect(first.text).toContain("Hello BuPulse, I am renewing my Standard plan (15,000 RWF)");
    expect(first.text).toContain("/dashboard/billing");
    expect(notices()).toEqual(["5d", "1d"]);
    expect(h.db.subscription.rows[0].status).toBe("ACTIVE");
  });

  it("a 1-day reminder that goes out after the end says the plan has ended and until when the grace lasts", async () => {
    seed();
    expect(await run(at("2026-10-21T06:00:00Z"))).toMatchObject({ reminded1d: 1, pastDue: 0 });
    expect(mails()).toEqual(["Your BuPulse Standard plan has ended: pay to continue"]);
    const mail = h.sendEmail.mock.calls[0][0];
    expect(mail.text).toContain("ended on October 20, 2026");
    expect(mail.text).toContain("You can still create until October 23, 2026");
    expect(mail.text).not.toContain("tomorrow");
  });

  it("a missed day sends only the later reminder; no reminder while a submitted payment waits for the owner", async () => {
    seed();
    h.db.manualPayment.rows.push({ id: "m1", userId: USER, planKey: "STANDARD", interval: "MONTH", amountMinor: 15000, reference: "BP-AAAA", status: "pending", submittedAt: at("2026-10-18T00:00:00Z") });
    expect(await run(at("2026-10-19T06:00:00Z"))).toMatchObject({ reminded1d: 0, skipped: 1 });
    h.db.manualPayment.rows[0].status = "rejected";
    expect(await run(at("2026-10-19T06:00:00Z"))).toMatchObject({ reminded1d: 1 });
    expect(notices()).toEqual(["1d"]);
  });

  it("with Resend switched off nothing is claimed, so the reminder goes out once it is back on", async () => {
    seed();
    h.db.serviceSwitch.rows.push({ service: "resend", enabled: false, changedBy: "admin" });
    expect(await run(at("2026-10-15T06:00:00Z"))).toMatchObject({ reminded5d: 0 });
    expect(notices()).toEqual([]);
    h.db.serviceSwitch.rows.length = 0;
    clearSwitchCache();
    expect(await run(at("2026-10-15T07:00:00Z"))).toMatchObject({ reminded5d: 1 });
  });

  it("a failed send gives the claim back for the next run", async () => {
    seed();
    h.sendEmail.mockResolvedValueOnce(false);
    expect(await run(at("2026-10-15T06:00:00Z"))).toMatchObject({ reminded5d: 0 });
    expect(notices()).toEqual([]);
    expect(await run(at("2026-10-15T07:00:00Z"))).toMatchObject({ reminded5d: 1 });
  });
});

describe("grace and read-only", () => {
  it("3 days after the end the subscription becomes PAST_DUE, audited, and the client is told once", async () => {
    seed();
    expect(await run(at("2026-10-22T23:00:00Z"))).toMatchObject({ pastDue: 0, reminded1d: 1 });
    expect(await run(at("2026-10-23T00:00:00Z"))).toMatchObject({ pastDue: 1 });
    expect(h.db.subscription.rows[0].status).toBe("PAST_DUE");
    expect(mails()).toEqual(["Your BuPulse Standard plan has ended: pay to continue", "Your BuPulse Standard plan is paused"]);
    expect(h.db.auditLog.rows.map((a) => a.action)).toContain("momo_past_due");
    expect(h.db.auditLog.rows.find((a) => a.action === "momo_past_due")).toMatchObject({ actor: "system:cron", target: `user:${USER}` });
    // Already past due: left alone, no second email.
    expect(await run(at("2026-10-24T00:00:00Z"))).toMatchObject({ checked: 0, pastDue: 0 });
    expect(h.sendEmail).toHaveBeenCalledTimes(2);
    // The existing paywall now refuses new generations until a payment is confirmed.
    const { consumeUsage } = await import("@/lib/usage");
    await expect(consumeUsage(USER, "text")).rejects.toMatchObject({ reason: "past_due" });
  });

  it("a payment confirmed meanwhile (new period end) is never overwritten", async () => {
    seed();
    const { prisma } = await import("@/lib/db");
    const real = h.db.subscription.updateMany.getMockImplementation()!;
    // The confirmation lands between the read and the write.
    h.db.subscription.updateMany.mockImplementationOnce(async (args) => {
      h.db.subscription.rows[0].currentPeriodEnd = at("2026-11-20T00:00:00Z");
      return real(args);
    });
    expect(await run(at("2026-10-23T00:00:00Z"))).toMatchObject({ pastDue: 0, skipped: 1 });
    expect(h.db.subscription.rows[0].status).toBe("ACTIVE");
    void prisma;
  });

  it("card subscriptions and ended plans are not touched", async () => {
    seed({ provider: "PADDLE", providerSubscriptionId: "sub_1" });
    expect(await run(at("2026-10-23T00:00:00Z"))).toMatchObject({ checked: 0 });
    h.db.subscription.rows[0] = { ...h.db.subscription.rows[0], provider: "MANUAL_MOMO", providerSubscriptionId: null, status: "CANCELED" };
    expect(await run(at("2026-10-23T00:00:00Z"))).toMatchObject({ checked: 0 });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});

describe("housekeeping and locking", () => {
  it("closes payments started but not submitted after two days, keeps submitted ones, and pages with a cursor", async () => {
    seed({ currentPeriodEnd: at("2027-01-01T00:00:00Z") });
    h.db.manualPayment.rows.push({ id: "old", userId: USER, planKey: "STANDARD", interval: "MONTH", amountMinor: 1, reference: "BP-AAAA", status: "pending", submittedAt: null, createdAt: at("2026-10-10T00:00:00Z") });
    h.db.manualPayment.rows.push({ id: "fresh", userId: USER, planKey: "STANDARD", interval: "MONTH", amountMinor: 1, reference: "BP-BBBB", status: "pending", submittedAt: null, createdAt: at("2026-10-14T00:00:00Z") });
    h.db.manualPayment.rows.push({ id: "said", userId: USER, planKey: "STANDARD", interval: "MONTH", amountMinor: 1, reference: "BP-CCCC", status: "pending", submittedAt: at("2026-10-10T00:00:00Z"), createdAt: at("2026-10-01T00:00:00Z") });
    expect(await run(at("2026-10-14T06:00:00Z"))).toMatchObject({ expiredPayments: 1, checked: 0 });
    expect(h.db.manualPayment.rows.map((r) => r.status)).toEqual(["expired", "pending", "pending"]);
    expect(await processMomoRenewals({ now: at("2026-10-14T06:00:00Z"), cursor: "a" })).toMatchObject({ expiredPayments: 0 });
  });

  it("another run holding the lock makes this one return busy", async () => {
    seed();
    h.db.$queryRaw.mockResolvedValueOnce([{ locked: false }]);
    expect(await run(at("2026-10-15T06:00:00Z"))).toMatchObject({ busy: true, checked: 0 });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});

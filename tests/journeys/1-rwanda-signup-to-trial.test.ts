import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";
import { code, companyOf, DAY, HOUR, installSignUp, NOW, authUser, seedCatalog, subjects } from "./world";

// Journey 1: a Rwandan business signs up, waits for its demo, books it, an admin starts the 3-day trial, the trial
// ends and the account is read-only with a "pay on the Billing page" message (docs/RWANDA_LAUNCH_PLAN.md section 12).

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  email: vi.fn<(email: { to: string; subject: string; text: string; html: string; attachments?: { filename: string; content: string }[] }) => Promise<boolean>>(async () => true),
  track: vi.fn(),
  busy: [] as { startsAt: Date; endsAt: Date }[],
}));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/billing/paddle-catalog", () => ({ paddleConnected: () => false, createPaddleProduct: vi.fn(), createPaddlePrice: vi.fn(), archivePaddlePrice: vi.fn(), updatePaddleProduct: vi.fn() }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.email }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: { signup: "signup", demoBooked: "demo_booked", trialStarted: "trial_started" }, trackEvent: h.track }));
// The owner's Google Calendar: its busy times come out of the free slots.
vi.mock("@/lib/google-calendar/calendar", async (orig) => ({ ...(await orig<typeof import("@/lib/google-calendar/calendar")>()), calendarBusy: vi.fn(async () => h.busy) }));

import { ensureAccount } from "@/lib/account";
import { accountBlock, assertFeature, blockMessage, companyEntitlements, FeatureRequiredError, hasFeature } from "@/lib/entitlements";
import { consumeUsage } from "@/lib/usage";
import { availableSlots, bookDemo, choosePlan } from "@/lib/demo/bookings";
import { startTrial } from "@/lib/admin/demos";
import { processTrialReminders } from "@/lib/demo/trial-reminders";
import { startManualPayment } from "@/lib/billing/momo";
import { clearMomoSettingsCache } from "@/lib/billing/momo-settings";
import { MOMO_SETTING_KEY } from "@/lib/billing/momo-shared";
import { resetPlanCache } from "@/lib/plan-catalog";
import { resetRegionCache } from "@/lib/region";
import { resetRegionPriceCache } from "@/lib/region-prices";
import { clearSwitchCache } from "@/lib/admin/switch";
import { consoleContext } from "@/lib/admin/types";

const CONSOLE = consoleContext("198.51.100.1");
const TUE_10 = new Date("2026-10-13T08:00:00Z"); // Tuesday 10:00 Kigali

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.db = createFakeDb();
  installSignUp(h.db);
  h.busy = [];
  h.email.mockClear();
  h.track.mockClear();
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  clearSwitchCache();
  clearMomoSettingsCache();
  seedCatalog(h.db);
  vi.stubEnv("ADMIN_EMAILS", "admin@bupulse.com");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bupulse.test");
  vi.stubEnv("RESEND_API_KEY", "re_test");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("journey: Rwanda sign-up -> demo -> trial -> trial over", () => {
  it("walks the whole way, with the account's rights changing at every step", async () => {
    // 1. Sign-up: Rwanda -> region RW, a subscription that waits for the demo. No trial, no features.
    expect(await ensureAccount(authUser(1, "Rwanda") as never)).toBe(true);
    const { userId, businessId, business, subscription } = companyOf(h.db, 1);
    expect(business).toMatchObject({ pricingRegion: "RW", country: "Rwanda", timezone: "Africa/Kigali" });
    expect(subscription).toMatchObject({ plan: "TRIAL", status: "PENDING_DEMO", trialEndsAt: null });
    expect(h.track.mock.calls.map((c) => c[0])).toEqual(["signup"]);
    // A returning visit does not make a second account.
    await ensureAccount(authUser(1, "Rwanda") as never);
    expect(h.db.subscription.rows).toHaveLength(1);

    // 2. Blocked from every dashboard feature, in words that point at the demo.
    expect(accountBlock({ plan: subscription.plan, status: subscription.status, chosenPlan: null })).toBe("pending_demo");
    expect((await companyEntitlements(businessId)).block).toBe("pending_demo");
    for (const feature of ["content", "designs", "calendar", "gallery", "webhooks"] as const) expect(await hasFeature(businessId, feature)).toBe(false);
    const refused = await assertFeature(businessId, "content").catch((e) => e);
    expect(refused).toBeInstanceOf(FeatureRequiredError);
    expect(refused.message).toBe(blockMessage("pending_demo"));
    await expect(consumeUsage(userId, "text")).rejects.toMatchObject({ reason: "pending_demo" });
    // ...and it cannot pay or start a trial before choosing a plan and having its demo.
    expect(await code(startTrial(CONSOLE, { businessId }, NOW))).toMatch(/^conflict: The client has not chosen a plan/);

    // 3. The client may choose a plan the region sells and book a demo. STANDARD/PRO are not priced in RW.
    expect(await code(choosePlan({ businessId, planKey: "PRO" }))).toMatch(/^invalid/);
    expect(await choosePlan({ businessId, planKey: "BUSINESS" })).toEqual({ planKey: "BUSINESS", planName: "Business" });
    expect(subscription.chosenPlan).toBe("BUSINESS");
    expect(await hasFeature(businessId, "content")).toBe(false); // choosing a plan opens nothing

    // Slot validation: the owner's Google Calendar busy time, weekend, too soon, and a time off the grid are all refused.
    h.busy = [{ startsAt: TUE_10, endsAt: new Date(TUE_10.getTime() + 30 * 60_000) }];
    expect((await availableSlots(NOW)).slots.some((s) => s.getTime() === TUE_10.getTime())).toBe(false);
    expect(await code(bookDemo({ businessId, startsAt: TUE_10, now: NOW }))).toMatch(/^conflict: That time is no longer free/);
    expect(await code(bookDemo({ businessId, startsAt: new Date("2026-10-17T08:00:00Z"), now: NOW }))).toMatch(/^conflict/); // Saturday
    expect(await code(bookDemo({ businessId, startsAt: new Date("2026-10-12T07:00:00Z"), now: NOW }))).toMatch(/^conflict/); // an hour away
    expect(await code(bookDemo({ businessId, startsAt: new Date("2026-10-13T08:07:00Z"), now: NOW }))).toMatch(/^conflict/); // off the grid
    expect(h.db.demoBooking.rows).toHaveLength(0);

    // The owner's calendar frees up: the same slot books, and the client and every admin get the invite.
    h.busy = [];
    h.email.mockClear();
    const { booking, rescheduled } = await bookDemo({ businessId, startsAt: TUE_10, now: NOW });
    expect(rescheduled).toBe(false);
    expect(booking).toMatchObject({ businessId, planKey: "BUSINESS", status: "booked", startsAt: TUE_10 });
    expect(h.email.mock.calls.map((c) => (c[0] as { to: string }).to)).toEqual(["owner1@example.com", "admin@bupulse.com"]);
    expect(subjects(h.email.mock.calls)[0]).toMatch(/demo is booked: Tuesday 13 October 2026, 10:00/);
    expect(h.track).toHaveBeenCalledWith("demo_booked", expect.objectContaining({ businessId }));
    // Still waiting: a booked demo opens nothing.
    expect((await companyEntitlements(businessId)).block).toBe("pending_demo");
    await expect(consumeUsage(userId, "text")).rejects.toMatchObject({ reason: "pending_demo" });

    // 4. After the demo the admin starts the trial: default 3 days, the booking is done, audited, emailed.
    vi.setSystemTime(new Date("2026-10-13T08:45:00Z"));
    const trialStart = new Date();
    h.email.mockClear();
    const started = await startTrial(CONSOLE, { businessId }, trialStart);
    expect(started.days).toBe(3);
    expect(subscription).toMatchObject({ status: "TRIALING", plan: "TRIAL", chosenPlan: "BUSINESS" });
    const trialEnd = new Date(trialStart.getTime() + 3 * DAY);
    expect(subscription.trialEndsAt).toEqual(trialEnd);
    expect(h.db.demoBooking.rows[0].status).toBe("done");
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ action: "start_trial", target: `business:${businessId}`, before: { status: "PENDING_DEMO" }, after: { status: "TRIALING", days: 3 } });
    expect(subjects(h.email.mock.calls)).toEqual(["Your BuPulse trial has started: Business until Friday 16 October 2026, 10:45"]);
    expect(h.track).toHaveBeenCalledWith("trial_started", expect.objectContaining({ businessId, props: { plan: "BUSINESS", days: 3 } }));
    expect(await code(startTrial(CONSOLE, { businessId }, trialStart))).toMatch(/^conflict: This company is already on its trial/);

    // 5. TRIALING: the chosen plan's features, the trial plan's limits.
    expect((await companyEntitlements(businessId)).block).toBeNull();
    for (const feature of ["content", "designs", "calendar", "gallery", "websiteChat", "webhooks", "apiAccess"] as const) expect(await hasFeature(businessId, feature)).toBe(true);
    expect(await hasFeature(businessId, "autopilot")).toBe(false); // not in Business
    await consumeUsage(userId, "text");

    // 6. The reminders: a day before and on the last day, once each.
    vi.setSystemTime(new Date(trialEnd.getTime() - 20 * HOUR));
    h.email.mockClear();
    expect(await processTrialReminders(new Date())).toMatchObject({ reminded1: 1, reminded2: 0, expired: 0 });
    vi.setSystemTime(new Date(trialEnd.getTime() - 5 * HOUR));
    expect(await processTrialReminders(new Date())).toMatchObject({ reminded1: 0, reminded2: 1, expired: 0 });
    expect(subjects(h.email.mock.calls)).toEqual(["Your BuPulse trial ends tomorrow", "Your BuPulse trial ends today"]);

    // 7. Trial over, before the cron has run: already read-only (the date decides), with the pay prompt.
    vi.setSystemTime(new Date(trialEnd.getTime() + HOUR));
    expect((await companyEntitlements(businessId)).block).toBe("trial_expired");
    expect(await hasFeature(businessId, "content")).toBe(false);
    const expired = await assertFeature(businessId, "content").catch((e) => e);
    expect(expired.message).toBe(blockMessage("trial_expired"));
    expect(expired.message).toMatch(/Choose a plan on the Billing page/);
    await expect(consumeUsage(userId, "text")).rejects.toMatchObject({ reason: "trial_expired" });

    // The cron closes the trial: EXPIRED, one "ended" email, an audit row, and nothing is deleted.
    h.email.mockClear();
    expect(await processTrialReminders(new Date())).toMatchObject({ expired: 1 });
    expect(subscription.status).toBe("EXPIRED");
    expect(subjects(h.email.mock.calls)).toEqual(["Your BuPulse trial has ended"]);
    expect(h.db.auditLog.rows.find((a) => a.action === "trial_expired")).toMatchObject({ actor: "system:cron", target: `user:${userId}`, after: { status: "EXPIRED", emailed: true } });
    // Still the trial's own message (the plan is still TRIAL), not the generic "inactive" one.
    expect((await companyEntitlements(businessId)).block).toBe("trial_expired");
    expect(await hasFeature(businessId, "content")).toBe(false);
    await expect(consumeUsage(userId, "text")).rejects.toMatchObject({ reason: "trial_expired" });
    expect(h.db.business.rows).toHaveLength(1);
    expect(await processTrialReminders(new Date())).toMatchObject({ reminded1: 0, reminded2: 0, expired: 0 });

    // 8. The way out is paying: a Mobile Money payment can be started from the expired account.
    h.db.adminSetting.rows.push({ key: MOMO_SETTING_KEY, value: { merchantCode: "123456", momoNumber: "0788000000", accountName: "BuPulse" } });
    clearMomoSettingsCache();
    const payment = await startManualPayment({ userId, plan: "BUSINESS", interval: "MONTH", now: new Date() });
    expect(payment).toMatchObject({ planKey: "BUSINESS", amountMinor: 35000, currency: "RWF", status: "pending" });
  });
});

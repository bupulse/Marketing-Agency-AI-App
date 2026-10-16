import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// The demo-first trial end to end: sign-up waits for a demo, nothing works until then, the client chooses a plan and
// books a slot (emails and invites), an admin starts the trial (AAL2, audited, trial length from Settings), the trial
// gives the chosen plan's features with the trial limits, reminders go out, and the trial expires to read-only.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  email: vi.fn<(email: { to: string; subject: string; text: string; html: string; attachments?: { filename: string; content: string }[] }) => Promise<boolean>>(async () => true),
  track: vi.fn(),
  adminAction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/billing/paddle-catalog", () => ({ paddleConnected: () => false, createPaddleProduct: vi.fn(), createPaddlePrice: vi.fn(), archivePaddlePrice: vi.fn(), updatePaddleProduct: vi.fn() }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.email }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: { signup: "signup", demoBooked: "demo_booked", trialStarted: "trial_started" }, trackEvent: h.track }));
vi.mock("@/lib/admin/console", () => ({ adminAction: h.adminAction, finish: vi.fn(async (_b: string, _ok: unknown, fn: () => Promise<unknown>) => fn()) }));

import { ensureAccount } from "@/lib/account";
import { companyFeatures, featurePlanKey } from "@/lib/entitlements";
import { consumeUsage, UsageLimitError } from "@/lib/usage";
import { bookDemo, cancelDemo, choosePlan, DemoError, startOfDemoDay } from "@/lib/demo/bookings";
import { demoPanel, listDemos, setDemoStatus, startTrial } from "@/lib/admin/demos";
import { processTrialReminders } from "@/lib/demo/trial-reminders";
import { startTrialAction } from "@/app/admin/(console)/(clients)/demos/actions";
import { cleanSetting, DEFAULT_SETTINGS, setSetting } from "@/lib/admin/settings";
import { resetPlanCache } from "@/lib/plan-catalog";
import { resetRegionCache } from "@/lib/region";
import { resetRegionPriceCache } from "@/lib/region-prices";
import { clearSwitchCache } from "@/lib/admin/switch";
import { consoleContext, type AdminError } from "@/lib/admin/types";

const CONSOLE = consoleContext("198.51.100.1");
const DAY = 86_400_000;
const HOUR = 3_600_000;
// Monday 12 October 2026, 08:00 in Kigali.
const NOW = new Date("2026-10-12T06:00:00Z");
const code = async (p: Promise<unknown>) => p.then(() => null, (e: AdminError | DemoError) => `${e.code}: ${e.message}`);
const UID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function seedCatalog() {
  h.db.pricingRegion.rows.push(
    { key: "RW", name: "Rwanda", currency: "RWF", countries: ["RW"], paymentMethods: ["momo", "card"], active: true, sortOrder: 0 },
    { key: "GLOBAL", name: "Everywhere else", currency: "USD", countries: [], paymentMethods: ["card"], active: true, sortOrder: 20 },
  );
  h.db.planDefinition.rows.push({
    id: "plan_starter", key: "STARTER", name: "Starter", description: "", isTrial: false, trialDays: null, status: "active", sortOrder: 5, highlight: false, monthlyPriceCents: 1200, yearlyPriceCents: 11600, currency: "USD",
    limits: { text: 60, image: 30, chat: 0, videos: 0, voiceCharacters: 0, seats: 1 }, highlights: [], featureKeys: ["content", "designs", "calendar", "gallery"], features: [], capabilities: {}, paddlePrices: [], syncState: "not_synced", syncError: null, createdAt: NOW, updatedAt: NOW,
  });
  h.db.planRegionPrice.rows.push(
    { id: "p1", planKey: "STARTER", regionKey: "RW", currency: "RWF", monthlyMinor: 15000, yearlyMinor: 150000, cardMonthlyUsdCents: 1200, cardYearlyUsdCents: 11600 },
    { id: "p2", planKey: "STANDARD", regionKey: "GLOBAL", currency: "USD", monthlyMinor: 4900, yearlyMinor: 49000 },
  );
  for (const d of [1, 2, 3, 4, 5]) h.db.adminAvailability.rows.push({ id: `a${d}`, weekday: d, startMinute: 540, endMinute: 1020 });
}

/** A signed-up company in a region, waiting for its demo (what ensureAccount creates). */
function company(n: number, region = "RW", sub: Record<string, unknown> = {}) {
  const userId = UID(n);
  const businessId = `b${n}`;
  const subscription: Record<string, unknown> & { trialEndsAt: Date | null; status: string; chosenPlan: string | null; trialReminder1SentAt: Date | null; trialReminder2SentAt: Date | null } = { id: `s${n}`, userId, plan: "TRIAL", status: "PENDING_DEMO", chosenPlan: null, trialEndsAt: null, currentPeriodStart: NOW, currentPeriodEnd: null, providerSubscriptionId: null, trialReminder1SentAt: null, trialReminder2SentAt: null, ...sub };
  h.db.subscription.rows.push(subscription);
  const user = { id: userId, email: `owner${n}@example.com`, name: `Owner ${n}`, suspendedAt: null, subscription, business: { id: businessId, name: `Company ${n}` } };
  h.db.user.rows.push(user);
  h.db.business.rows.push({ id: businessId, userId, name: `Company ${n}`, country: region === "RW" ? "Rwanda" : "France", pricingRegion: region, user });
  return { userId, businessId, subscription };
}

beforeEach(() => {
  h.db = createFakeDb();
  h.email.mockClear();
  h.track.mockClear();
  h.adminAction.mockReset();
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  clearSwitchCache();
  seedCatalog();
  vi.stubEnv("ADMIN_EMAILS", "admin@bupulse.com, owner@bupulse.com");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bupulse.test");
});

describe("sign-up", () => {
  it("creates a company in its country's region and a subscription that waits for a demo (no trial)", async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, business: { id: "b_new" } }));
    h.db.user.upsert = create as never;
    const ok = await ensureAccount({ id: UID(9), email: "new@example.com", email_confirmed_at: "2026-10-12T06:00:00Z", user_metadata: { organisation_name: "Inzu", ceo_name: "Aline", industry: "Retail", country: "Rwanda" }, identities: [{ provider: "email" }] } as never);
    expect(ok).toBe(true);
    // The upsert's argument: { where, update, create: { business: { create }, subscription: { create } }, include }.
    const data = create.mock.calls[0][0] as unknown as { create: { business: { create: Record<string, unknown> }; subscription: { create: Record<string, unknown> } } };
    expect(data.create.business.create).toMatchObject({ pricingRegion: "RW", country: "Rwanda", timezone: "Africa/Kigali" });
    expect(data.create.subscription.create).toEqual({ plan: "TRIAL", status: "PENDING_DEMO", trialEndsAt: null, currentPeriodStart: expect.any(Date), currentPeriodEnd: null });
    expect(h.track.mock.calls.map((c) => c[0])).toEqual(["signup"]); // no trial_started at sign-up
  });
});

describe("while waiting for the demo", () => {
  it("has no features and cannot generate, whatever the plan says", async () => {
    const { userId, businessId } = company(1);
    expect((await companyFeatures(businessId)).size).toBe(0);
    expect(featurePlanKey({ plan: "PRO", status: "PENDING_DEMO", chosenPlan: "STARTER" })).toBeNull();
    await expect(consumeUsage(userId, "text")).rejects.toMatchObject({ reason: "pending_demo" });
    expect(await code(consumeUsage(userId, "text"))).toContain("pending_demo");
  });

  it("chooses a plan offered in its region, then books a free slot and everyone gets an invite", async () => {
    const { businessId, subscription } = company(1);
    expect(await code(choosePlan({ businessId, planKey: "STANDARD" }))).toMatch(/^invalid/); // not offered in RW
    expect(await choosePlan({ businessId, planKey: "STARTER" })).toEqual({ planKey: "STARTER", planName: "Starter" });
    expect(subscription.chosenPlan).toBe("STARTER");

    const slot = new Date("2026-10-13T08:00:00Z"); // Tuesday 10:00 Kigali
    const { booking, rescheduled } = await bookDemo({ businessId, startsAt: slot, now: NOW });
    expect(rescheduled).toBe(false);
    expect(booking).toMatchObject({ businessId, planKey: "STARTER", status: "booked", startsAt: slot });
    expect(booking.endsAt.getTime() - slot.getTime()).toBe(30 * 60_000);
    // One email to the client, one per admin address, each with the .ics attached.
    expect(h.email.mock.calls.map((c) => (c[0] as { to: string }).to)).toEqual(["owner1@example.com", "admin@bupulse.com", "owner@bupulse.com"]);
    const first = h.email.mock.calls[0][0] as { subject: string; text: string; attachments: { filename: string; content: string }[] };
    expect(first.subject).toMatch(/demo is booked: Tuesday 13 October 2026, 10:00/);
    const clientIcs = Buffer.from(first.attachments[0].content, "base64").toString();
    expect(clientIcs).toContain("BEGIN:VCALENDAR");
    // The client's invite names the dedicated organizer address and only the client; the admins' copy adds the admins.
    expect(clientIcs).toContain('ORGANIZER;CN="BuPulse":mailto:hello@bupulse.com');
    expect(clientIcs).not.toContain("admin@bupulse.com");
    expect(clientIcs).toContain("SEQUENCE:0");
    const adminMail = h.email.mock.calls[1][0] as { attachments: { content: string }[] };
    expect(Buffer.from(adminMail.attachments[0].content, "base64").toString().replace(/\r\n /g, "")).toContain("mailto:admin@bupulse.com");
    expect(booking.icsToken).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url
    expect(first.text).toContain(`/api/demo/ics/${booking.icsToken}`);
    expect(h.track).toHaveBeenCalledWith("demo_booked", expect.objectContaining({ businessId }));
  });

  it("refuses a slot that is taken, outside availability, or too soon, and rescheduling cancels the old booking", async () => {
    const a = company(1);
    const b = company(2);
    await choosePlan({ businessId: a.businessId, planKey: "STARTER" });
    await choosePlan({ businessId: b.businessId, planKey: "STARTER" });
    const slot = new Date("2026-10-13T08:00:00Z");
    const firstBooking = (await bookDemo({ businessId: a.businessId, startsAt: slot, now: NOW })).booking;
    expect(await code(bookDemo({ businessId: b.businessId, startsAt: slot, now: NOW }))).toMatch(/^conflict: That time is no longer free/);
    expect(await code(bookDemo({ businessId: b.businessId, startsAt: new Date("2026-10-13T08:30:00Z"), now: NOW }))).toMatch(/^conflict/); // inside the buffer
    expect(await code(bookDemo({ businessId: b.businessId, startsAt: new Date("2026-10-17T08:00:00Z"), now: NOW }))).toMatch(/^conflict/); // Saturday
    expect(await code(bookDemo({ businessId: b.businessId, startsAt: new Date("2026-10-12T07:00:00Z"), now: NOW }))).toMatch(/^conflict/); // in an hour: lead time
    h.email.mockClear();
    const moved = await bookDemo({ businessId: a.businessId, startsAt: new Date("2026-10-14T09:00:00Z"), now: NOW });
    expect(moved.rescheduled).toBe(true);
    // The one booking moves in place: same row and calendar UID, SEQUENCE + 1, so calendars move the event.
    expect(moved.booking.id).toBe(firstBooking.id);
    expect(h.db.demoBooking.rows).toHaveLength(1);
    expect(h.db.demoBooking.rows[0]).toMatchObject({ status: "booked", sequence: 1, startsAt: new Date("2026-10-14T09:00:00Z"), icsToken: firstBooking.icsToken });
    const movedMail = h.email.mock.calls[0][0] as { subject: string; attachments: { content: string }[] };
    expect(movedMail.subject).toMatch(/demo has moved/);
    expect(Buffer.from(movedMail.attachments[0].content, "base64").toString()).toContain(`UID:${firstBooking.id}@bupulse.com\r\nSEQUENCE:1`);
    // The old slot is free again for the other company.
    await bookDemo({ businessId: b.businessId, startsAt: slot, now: NOW });
  });

  it("cancels up to two hours before, not later", async () => {
    const { businessId } = company(1);
    await choosePlan({ businessId, planKey: "STARTER" });
    const slot = new Date("2026-10-13T08:00:00Z");
    await bookDemo({ businessId, startsAt: slot, now: NOW });
    expect(await code(cancelDemo({ businessId, now: new Date(slot.getTime() - HOUR) }))).toMatch(/^not_allowed/);
    h.email.mockClear();
    const cancelled = await cancelDemo({ businessId, now: new Date(slot.getTime() - 3 * HOUR) });
    expect(cancelled.status).toBe("cancelled");
    expect(h.db.demoBooking.rows[0]).toMatchObject({ status: "cancelled", sequence: 1 });
    const mail = h.email.mock.calls[0][0] as { subject: string; attachments: { content: string }[] };
    expect(mail.subject).toMatch(/cancelled/);
    expect(Buffer.from(mail.attachments[0].content, "base64").toString()).toContain("METHOD:CANCEL");
    expect(await code(cancelDemo({ businessId, now: NOW }))).toMatch(/^invalid/);
  });

  it("lets the client book again once the booked slot has passed without the admin marking it", async () => {
    const { businessId } = company(1);
    await choosePlan({ businessId, planKey: "STARTER" });
    await bookDemo({ businessId, startsAt: new Date("2026-10-13T08:00:00Z"), now: NOW }); // Tuesday 10:00-10:30 Kigali
    expect(await code(bookDemo({ businessId, startsAt: new Date("2026-10-14T09:00:00Z"), now: new Date("2026-10-13T07:30:00Z") }))).toMatch(/^not_allowed/); // 30 minutes before
    const again = await bookDemo({ businessId, startsAt: new Date("2026-10-14T09:00:00Z"), now: new Date("2026-10-13T09:00:00Z") }); // the slot ended at 08:30Z
    expect(again.rescheduled).toBe(true);
    expect(h.db.demoBooking.rows).toHaveLength(1);
    expect(h.db.demoBooking.rows[0]).toMatchObject({ status: "booked", sequence: 1, startsAt: new Date("2026-10-14T09:00:00Z") });
  });

  it("two first bookings racing for one company end with the one row (the per-company index decides)", async () => {
    const { businessId } = company(1);
    await choosePlan({ businessId, planKey: "STARTER" });
    const real = h.db.demoBooking.create.getMockImplementation()!;
    h.db.demoBooking.create.mockImplementationOnce(async (args) => {
      await real({ data: { ...args.data, startsAt: new Date("2026-10-14T09:00:00Z"), icsToken: "tokenfromtheotherrequest_________________" } });
      throw Object.assign(new Error("Unique constraint failed on DemoBooking_live_business_key"), { code: "P2002" });
    });
    const { booking, rescheduled } = await bookDemo({ businessId, startsAt: new Date("2026-10-13T08:00:00Z"), now: NOW });
    expect(rescheduled).toBe(false);
    expect(booking.startsAt).toEqual(new Date("2026-10-14T09:00:00Z"));
    expect(h.db.demoBooking.rows).toHaveLength(1);
  });

  it("stops new bookings once the day's cap is reached (all companies together); moving a booking still works", async () => {
    h.db.adminSetting.rows.push({ key: "demo.dailyCap", value: 1 });
    const a = company(1);
    const b = company(2);
    await choosePlan({ businessId: a.businessId, planKey: "STARTER" });
    await choosePlan({ businessId: b.businessId, planKey: "STARTER" });
    await bookDemo({ businessId: a.businessId, startsAt: new Date("2026-10-13T08:00:00Z"), now: NOW });
    h.db.demoBooking.rows[0].createdAt = NOW;
    expect(await code(bookDemo({ businessId: b.businessId, startsAt: new Date("2026-10-14T08:00:00Z"), now: NOW }))).toMatch(/^not_allowed: We have reached today's limit/);
    expect((await bookDemo({ businessId: a.businessId, startsAt: new Date("2026-10-14T09:00:00Z"), now: NOW })).rescheduled).toBe(true);
    // The next Kigali day starts at 22:00 UTC: the cap counts again from zero.
    expect((await bookDemo({ businessId: b.businessId, startsAt: new Date("2026-10-15T08:00:00Z"), now: new Date("2026-10-12T22:30:00Z") })).rescheduled).toBe(false);
    expect(startOfDemoDay(NOW).toISOString()).toBe("2026-10-11T22:00:00.000Z");
  });

  it("caps new bookings at 12 a day by default", () => {
    expect(DEFAULT_SETTINGS.demoDailyCap).toBe(12);
    expect(cleanSetting.demoDailyCap("20")).toBe(20);
    expect(() => cleanSetting.demoDailyCap("0")).toThrow(/from 1 to 200/);
  });

  it("is only for companies waiting for their demo", async () => {
    const { businessId } = company(3, "RW", { status: "ACTIVE" });
    expect(await code(choosePlan({ businessId, planKey: "STARTER" }))).toMatch(/^not_allowed/);
  });
});

describe("admin: start trial", () => {
  it("needs the admin gate (adminAction) before anything runs", async () => {
    h.adminAction.mockRejectedValueOnce(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;/admin/verify" }));
    const f = new FormData();
    f.set("businessId", "b1");
    await expect(startTrialAction(f)).rejects.toThrow("NEXT_REDIRECT");
    expect(h.db.subscription.rows).toHaveLength(0);
  });

  it("moves the company onto the trial for the configured days, audited, and the chosen plan's features apply with the trial limits", async () => {
    const { userId, businessId, subscription } = company(1);
    expect(await code(startTrial(CONSOLE, { businessId }, NOW))).toMatch(/^conflict: The client has not chosen a plan/);
    await choosePlan({ businessId, planKey: "STARTER" });
    await bookDemo({ businessId, startsAt: new Date("2026-10-13T08:00:00Z"), now: NOW });
    await setSetting(CONSOLE, "trialDays", 5);
    h.email.mockClear();
    h.adminAction.mockResolvedValue(CONSOLE);
    const f = new FormData();
    f.set("businessId", businessId);
    await startTrialAction(f);
    expect(h.adminAction).toHaveBeenCalledTimes(1);
    expect(subscription).toMatchObject({ status: "TRIALING", plan: "TRIAL", chosenPlan: "STARTER" });
    expect(Math.round(((subscription.trialEndsAt as Date).getTime() - Date.now()) / DAY)).toBe(5);
    expect(h.db.demoBooking.rows[0].status).toBe("done");
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ action: "start_trial", target: `business:${businessId}`, before: { status: "PENDING_DEMO" }, after: { status: "TRIALING", days: 5 } });
    expect((h.email.mock.calls[0][0] as { subject: string }).subject).toMatch(/trial has started: Starter/);
    expect(h.track).toHaveBeenCalledWith("trial_started", expect.objectContaining({ businessId, props: { plan: "STARTER", days: 5 } }));
    // Features: the chosen plan's; limits: the TRIAL plan's (10 texts).
    expect([...(await companyFeatures(businessId))]).toEqual(["content", "designs", "calendar", "gallery"]);
    for (let i = 0; i < 10; i++) await consumeUsage(userId, "text");
    await expect(consumeUsage(userId, "text")).rejects.toMatchObject({ reason: "limit_reached" });
    // Twice is refused.
    expect(await code(startTrial(CONSOLE, { businessId }, NOW))).toMatch(/^conflict: This company is already on its trial/);
  });

  it("defaults to 3 days and lists demos for the admin", async () => {
    const { businessId, subscription } = company(1);
    await choosePlan({ businessId, planKey: "STARTER" });
    await bookDemo({ businessId, startsAt: new Date("2026-10-13T08:00:00Z"), now: NOW });
    const upcoming = await listDemos({ when: "upcoming" }, NOW);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]).toMatchObject({ businessName: "Company 1", email: "owner1@example.com", planKey: "STARTER", status: "booked", subscriptionStatus: "PENDING_DEMO", when: "Tuesday 13 October 2026, 10:00" });
    await setDemoStatus(CONSOLE, { id: upcoming[0].id, status: "no_show", notes: "Did not join" });
    expect(h.db.demoBooking.rows[0]).toMatchObject({ status: "no_show", notes: "Did not join" });
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ action: "update_demo" });
    expect(await code(setDemoStatus(CONSOLE, { id: upcoming[0].id, status: "booked" }))).toMatch(/^invalid/);
    // The chosen plan must be one the company's region sells; the admin may pick another that is.
    h.db.business.rows.find((b) => b.id === businessId)!.pricingRegion = "GLOBAL";
    expect(await code(startTrial(CONSOLE, { businessId }, NOW))).toMatch(/^conflict: The Starter plan is not offered in Everywhere else/);
    h.db.business.rows.find((b) => b.id === businessId)!.pricingRegion = "RW";
    const result = await startTrial(CONSOLE, { businessId }, NOW);
    expect(result.days).toBe(3);
    expect(subscription.trialEndsAt?.toISOString()).toBe("2026-10-15T06:00:00.000Z");
    expect((await demoPanel(businessId)).chosenPlanName).toBe("Starter");
  });
});

describe("trial end", () => {
  it("reminds MoMo clients a day before and on the last day, once each, and expires finished trials to read-only", async () => {
    const start = new Date(NOW.getTime() - 2 * DAY);
    const trial = (n: number, endsIn: number, extra: Record<string, unknown> = {}) => company(n, "RW", { status: "TRIALING", chosenPlan: "STARTER", currentPeriodStart: start, trialEndsAt: new Date(NOW.getTime() + endsIn), ...extra });
    const dayBefore = trial(1, 20 * HOUR);
    const lastDay = trial(2, 5 * HOUR);
    const over = trial(3, -1 * HOUR);
    const card = trial(4, 5 * HOUR, { providerSubscriptionId: "sub_paddle" }); // Paddle's business
    const notYet = trial(5, 3 * DAY);
    const legacy = trial(6, -3 * DAY); // ended days ago (before this cron existed): closed without an email
    const run = await processTrialReminders(NOW);
    expect(run).toEqual({ reminded1: 1, reminded2: 1, expired: 2, paused: false });
    expect(legacy.subscription.status).toBe("EXPIRED");
    expect(h.db.auditLog.rows.find((a) => a.action === "trial_expired" && a.target === `user:${legacy.userId}`)!.after).toMatchObject({ status: "EXPIRED", emailed: false });
    expect(dayBefore.subscription.trialReminder1SentAt).toEqual(NOW);
    expect(lastDay.subscription.trialReminder2SentAt).toEqual(NOW);
    expect(over.subscription.status).toBe("EXPIRED");
    expect(card.subscription).toMatchObject({ status: "TRIALING", trialReminder2SentAt: null });
    expect(notYet.subscription.trialReminder1SentAt).toBeNull();
    const subjects = h.email.mock.calls.map((c) => (c[0] as { subject: string; to: string }).subject);
    expect(subjects).toEqual(["Your BuPulse trial has ended", "Your BuPulse trial ends tomorrow", "Your BuPulse trial ends today"]);
    expect(h.db.auditLog.rows.find((a) => a.action === "trial_expired" && a.target === `user:${over.userId}`)).toMatchObject({ actor: "system:cron", after: { status: "EXPIRED", emailed: true } });
    // The expired account is read-only: generation answers trial_expired, nothing was deleted.
    await expect(consumeUsage(over.userId, "text")).rejects.toBeInstanceOf(UsageLimitError);
    await expect(consumeUsage(over.userId, "text")).rejects.toMatchObject({ reason: "trial_expired" });
    // A second run does nothing.
    expect(await processTrialReminders(NOW)).toEqual({ reminded1: 0, reminded2: 0, expired: 0, paused: false });
    // Later the day-before client reaches the last day: the second reminder, once. By then the last-day client's trial
    // (5 hours from NOW) is over too, so it expires in the same run.
    expect(await processTrialReminders(new Date(NOW.getTime() + 14 * HOUR))).toEqual({ reminded1: 0, reminded2: 1, expired: 1, paused: false });
  });

  it("claims nothing while Resend is switched off, and a failed send is retried next time", async () => {
    h.db.serviceSwitch.rows.push({ service: "resend", enabled: false });
    clearSwitchCache();
    const c = company(1, "RW", { status: "TRIALING", chosenPlan: "STARTER", currentPeriodStart: new Date(NOW.getTime() - 2 * DAY), trialEndsAt: new Date(NOW.getTime() + 5 * HOUR) });
    expect(await processTrialReminders(NOW)).toMatchObject({ reminded2: 0, paused: true });
    expect(c.subscription.trialReminder2SentAt).toBeNull();
    h.db.serviceSwitch.rows.length = 0;
    clearSwitchCache();
    h.email.mockResolvedValueOnce(false);
    expect(await processTrialReminders(NOW)).toMatchObject({ reminded2: 0, paused: false });
    expect(c.subscription.trialReminder2SentAt).toBeNull();
    expect(await processTrialReminders(NOW)).toMatchObject({ reminded2: 1 });
  });
});

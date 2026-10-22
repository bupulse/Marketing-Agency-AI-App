import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// Trial first (docs/REGIONS.md): a company that has not started (PENDING_DEMO) picks the plan it wants to try and its
// trial starts at once (lib/trial/start.ts startOwnTrial), the same steps as the admin's "Start trial": the region's
// plans only, guarded against double starts, audited as the client, trial_started tracked, the client emailed (a
// failed email never undoes the start), and a live demo booking closed without the booking emails.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  email: vi.fn<(email: { to: string; subject: string; text: string; html: string }) => Promise<boolean>>(async () => true),
  track: vi.fn(),
  logError: vi.fn(async () => {}),
  sync: vi.fn(async () => ({ status: "ok" as const, googleEventId: "gev_1", meetLink: null })),
}));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: h.logError }));
vi.mock("@/lib/billing/paddle-catalog", () => ({ paddleConnected: () => false, createPaddleProduct: vi.fn(), createPaddlePrice: vi.fn(), archivePaddlePrice: vi.fn(), updatePaddleProduct: vi.fn() }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.email }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: { signup: "signup", demoBooked: "demo_booked", trialStarted: "trial_started" }, trackEvent: h.track }));
vi.mock("@/lib/google-calendar/events", async (orig) => ({ ...(await orig<typeof import("@/lib/google-calendar/events")>()), syncDemoEvent: h.sync }));

import { startOwnTrial, TrialError } from "@/lib/trial/start";
import { startTrial } from "@/lib/admin/demos";
import { companyFeatures } from "@/lib/entitlements";
import { setSetting } from "@/lib/admin/settings";
import { resetPlanCache } from "@/lib/plan-catalog";
import { resetRegionCache } from "@/lib/region";
import { resetRegionPriceCache } from "@/lib/region-prices";
import { clearSwitchCache } from "@/lib/admin/switch";
import { consoleContext } from "@/lib/admin/types";

const DAY = 86_400_000;
const HOUR = 3_600_000;
// Monday 12 October 2026, 08:00 in Kigali.
const NOW = new Date("2026-10-12T06:00:00Z");
const UID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const codeOf = async (p: Promise<unknown>) => p.then(() => null, (e: TrialError) => e.code);

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
}

/** A signed-up company in a region that has not started its trial (what ensureAccount creates). */
function company(n: number, sub: Record<string, unknown> = {}) {
  const userId = UID(n);
  const businessId = `b${n}`;
  const subscription: Record<string, unknown> & { status: string; chosenPlan: string | null; trialEndsAt: Date | null } = { id: `s${n}`, userId, plan: "TRIAL", status: "PENDING_DEMO", chosenPlan: null, trialEndsAt: null, currentPeriodStart: NOW, currentPeriodEnd: null, providerSubscriptionId: null, trialReminder1SentAt: null, trialReminder2SentAt: null, ...sub };
  h.db.subscription.rows.push(subscription);
  const user = { id: userId, email: `owner${n}@example.com`, name: `Aline ${n}`, suspendedAt: null, subscription, business: { id: businessId, name: `Company ${n}` } };
  h.db.user.rows.push(user);
  h.db.business.rows.push({ id: businessId, userId, name: `Company ${n}`, country: "Rwanda", pricingRegion: "RW", user });
  return { userId, businessId, subscription };
}

function booking(businessId: string, startsAt: Date, extra: Record<string, unknown> = {}) {
  const row = { id: `bk_${businessId}`, businessId, kind: "demo", status: "booked", startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000), googleEventId: null, meetingLink: null, sequence: 0, notes: null, ...extra };
  h.db.demoBooking.rows.push(row);
  return row;
}

beforeEach(() => {
  h.db = createFakeDb();
  h.email.mockReset();
  h.email.mockResolvedValue(true);
  h.track.mockClear();
  h.logError.mockClear();
  h.sync.mockClear();
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  clearSwitchCache();
  seedCatalog();
  vi.stubEnv("ADMIN_EMAILS", "admin@bupulse.com");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bupulse.test");
});

describe("startOwnTrial", () => {
  it("starts the trial at once on the picked plan: trial days from Settings, audited as the client, tracked, emailed without demo talk", async () => {
    const { userId, businessId, subscription } = company(1);
    expect((await companyFeatures(businessId)).size).toBe(0);
    await setSetting(consoleContext(), "trialDays", 5);
    const started = await startOwnTrial({ businessId, actorId: "person_1", planKey: "STARTER", ip: "203.0.113.4" }, NOW);
    expect(started).toMatchObject({ businessId, userId, status: "TRIALING", plan: "TRIAL", chosenPlan: "STARTER", days: 5, demo: "none" });
    expect(subscription).toMatchObject({ status: "TRIALING", plan: "TRIAL", chosenPlan: "STARTER", trialEndsAt: new Date(NOW.getTime() + 5 * DAY), currentPeriodStart: NOW });
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ actor: "client:person_1", ip: "203.0.113.4", action: "start_trial", target: `business:${businessId}`, before: { status: "PENDING_DEMO" }, after: { status: "TRIALING", chosenPlan: "STARTER", days: 5 } });
    expect(h.track).toHaveBeenCalledWith("trial_started", expect.objectContaining({ userId, businessId, props: { plan: "STARTER", days: 5 } }));
    expect(h.email).toHaveBeenCalledTimes(1);
    const mail = h.email.mock.calls[0][0];
    expect(mail.to).toBe("owner1@example.com");
    expect(mail.subject).toMatch(/^Your BuPulse trial has started: Starter until /);
    expect(mail.text).toMatch(/Your 5-day free trial has started/);
    expect(mail.text).toMatch(/Hi Aline, Company 1 now has the Starter plan's features free/);
    expect(mail.text).not.toMatch(/demo/i);
    // The chosen plan's features are open now.
    expect([...(await companyFeatures(businessId))]).toEqual(["content", "designs", "calendar", "gallery"]);
  });

  it("only takes a plan the company's region offers; nothing changes when it is refused", async () => {
    const { businessId, subscription } = company(1);
    expect(await codeOf(startOwnTrial({ businessId, actorId: "u", planKey: "STANDARD" }, NOW))).toBe("not_in_region"); // GLOBAL only
    expect(await codeOf(startOwnTrial({ businessId, actorId: "u", planKey: "NOPE" }, NOW))).toBe("plan_gone");
    expect(await codeOf(startOwnTrial({ businessId, actorId: "u", planKey: "" }, NOW))).toBe("no_plan");
    expect(subscription).toMatchObject({ status: "PENDING_DEMO", chosenPlan: null, trialEndsAt: null });
    expect(h.db.auditLog.rows).toHaveLength(0);
    expect(h.email).not.toHaveBeenCalled();
    expect(h.track).not.toHaveBeenCalled();
    const refused = await startOwnTrial({ businessId, actorId: "u", planKey: "STANDARD" }, NOW).catch((e) => e);
    expect(refused).toBeInstanceOf(TrialError);
    expect(refused.message).toBe("Choose one of the plans shown.");
  });

  it("a company from the demo-first days: its earlier choice is used when none is sent", async () => {
    const { businessId, subscription } = company(1, { chosenPlan: "STARTER" });
    await startOwnTrial({ businessId, actorId: "u", planKey: "" }, NOW);
    expect(subscription).toMatchObject({ status: "TRIALING", chosenPlan: "STARTER" });
  });

  it("never starts twice: a second tap finds the trial running, and two at once start one trial with one email", async () => {
    const { businessId, subscription } = company(1);
    await startOwnTrial({ businessId, actorId: "u", planKey: "STARTER" }, NOW);
    const endsAt = subscription.trialEndsAt;
    const again = await startOwnTrial({ businessId, actorId: "u", planKey: "STARTER" }, new Date(NOW.getTime() + HOUR)).catch((e) => e);
    expect(again).toMatchObject({ code: "not_pending", message: "Your free trial has already started." });
    expect(subscription.trialEndsAt).toEqual(endsAt); // not moved
    expect(h.email).toHaveBeenCalledTimes(1);
    expect(h.db.auditLog.rows).toHaveLength(1);

    const other = company(2);
    const both = await Promise.allSettled([startOwnTrial({ businessId: other.businessId, actorId: "u", planKey: "STARTER" }, NOW), startOwnTrial({ businessId: other.businessId, actorId: "u", planKey: "STARTER" }, NOW)]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = both.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(["changed", "not_pending"]).toContain(lost.reason.code);
    expect(other.subscription.status).toBe("TRIALING");
    expect(h.email).toHaveBeenCalledTimes(2); // one per company
    expect(h.track).toHaveBeenCalledTimes(2);
  });

  it("an email that fails does not undo or block the start", async () => {
    const { businessId, subscription } = company(1);
    h.email.mockRejectedValueOnce(new Error("Resend is down"));
    const started = await startOwnTrial({ businessId, actorId: "u", planKey: "STARTER" }, NOW);
    expect(started.status).toBe("TRIALING");
    expect(subscription.status).toBe("TRIALING");
    expect(h.track).toHaveBeenCalledWith("trial_started", expect.anything());
    expect(h.logError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ source: "trial.start.email", businessId }));
  });

  it("closes a live demo booking: a coming one is cancelled (and its Google event), a past one is done; no booking emails", async () => {
    const coming = company(1, { chosenPlan: "STARTER" });
    const row = booking(coming.businessId, new Date(NOW.getTime() + DAY), { googleEventId: "gev_1" });
    const started = await startOwnTrial({ businessId: coming.businessId, actorId: "u", planKey: "STARTER" }, NOW);
    expect(started.demo).toBe("cancelled");
    expect(row).toMatchObject({ status: "cancelled", sequence: 1 });
    expect(h.sync).toHaveBeenCalledWith("cancelled", expect.objectContaining({ id: row.id, googleEventId: "gev_1" }), expect.objectContaining({ name: "Company 1" }), null);
    // Only the trial email, to the client: nothing to the admin addresses about a cancellation.
    expect(h.email.mock.calls.map((c) => c[0].to)).toEqual(["owner1@example.com"]);
    expect(h.email.mock.calls[0][0].text).toMatch(/Your demo call\s+No longer needed, so we cancelled it/i);

    const past = company(2, { chosenPlan: "STARTER" });
    const old = booking(past.businessId, new Date(NOW.getTime() - DAY));
    expect((await startOwnTrial({ businessId: past.businessId, actorId: "u", planKey: "STARTER" }, NOW)).demo).toBe("done");
    expect(old.status).toBe("done");
    expect(h.sync).toHaveBeenCalledTimes(1);
  });

  it("not when an admin sent an invoice instead (the dashboard shows it); the admin may still start a trial", async () => {
    const { businessId, subscription } = company(1, { chosenPlan: "STARTER" });
    h.db.invoice.rows.push({ id: "inv1", businessId, status: "sent", number: "BP-INV-0001", createdAt: NOW });
    expect(await codeOf(startOwnTrial({ businessId, actorId: "u", planKey: "STARTER" }, NOW))).toBe("invoice_open");
    expect(subscription.status).toBe("PENDING_DEMO");
    await startTrial(consoleContext(), { businessId }, NOW);
    expect(subscription.status).toBe("TRIALING");
  });

  it("the admin's Start trial runs the same steps, marks a live demo done and keeps its own wording", async () => {
    const { businessId, subscription } = company(1);
    const row = booking(businessId, new Date(NOW.getTime() + DAY));
    await expect(startTrial(consoleContext(), { businessId }, NOW)).rejects.toMatchObject({ code: "conflict", message: expect.stringMatching(/^The client has not chosen a plan yet/) });
    await expect(startTrial(consoleContext(), { businessId, planKey: "STANDARD" }, NOW)).rejects.toMatchObject({ message: expect.stringMatching(/^The Standard plan is not offered in Rwanda \(RW\), the company's region\. Pick one of: Starter/) });
    const result = await startTrial(consoleContext("198.51.100.1"), { businessId, planKey: "STARTER", days: 7 }, NOW);
    expect(result).toMatchObject({ days: 7, demo: "done" });
    expect(row.status).toBe("done");
    expect(h.sync).not.toHaveBeenCalled();
    expect(subscription.trialEndsAt).toEqual(new Date(NOW.getTime() + 7 * DAY));
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ actor: "admin", action: "start_trial" });
    await expect(startTrial(consoleContext(), { businessId }, NOW)).rejects.toMatchObject({ message: expect.stringMatching(/already on its trial/) });
  });
});

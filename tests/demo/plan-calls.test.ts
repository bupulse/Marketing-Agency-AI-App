import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";
import { googleFake } from "../google-calendar/google-fake";

// The short call an existing client may book right after a custom plan request (lib/demo/plan-calls.ts): the demo's
// slots, buffer, daily cap and lead time, the Google Meet invite (or the .ics and reusable link without Google), linked
// to its request for Admin -> Requests and Demos, and never part of the PENDING_DEMO -> trial steps.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  email: vi.fn<(email: { to: string; subject: string; text: string; html: string; attachments?: { filename: string; content: string }[] }) => Promise<boolean>>(async () => true),
  track: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/billing/paddle-catalog", () => ({ paddleConnected: () => false, createPaddleProduct: vi.fn(), createPaddlePrice: vi.fn(), archivePaddlePrice: vi.fn(), updatePaddleProduct: vi.fn() }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.email }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: { demoBooked: "demo_booked", trialStarted: "trial_started" }, trackEvent: h.track }));

import { bookDemo, choosePlan, currentBooking, type DemoError } from "@/lib/demo/bookings";
import { bookPlanCall, cancelPlanCall, currentPlanCall, PLAN_CALL_EVENT } from "@/lib/demo/plan-calls";
import { demoPanel, listDemos, startTrial } from "@/lib/admin/demos";
import { listPlanRequests } from "@/lib/offers/requests";
import { encrypt } from "@/lib/crypto";
import { CONNECTION_KEY, resetGoogleCalendarCache } from "@/lib/google-calendar/calendar";
import { EVENTS_SCOPE, FREEBUSY_SCOPE } from "@/lib/google-calendar/oauth";
import { resetPlanCache } from "@/lib/plan-catalog";
import { resetRegionCache } from "@/lib/region";
import { resetRegionPriceCache } from "@/lib/region-prices";
import { clearSwitchCache } from "@/lib/admin/switch";
import { consoleContext } from "@/lib/admin/types";

// Monday 12 October 2026, 08:00 in Kigali.
const NOW = new Date("2026-10-12T06:00:00Z");
const HOUR = 3_600_000;
const TUE_10 = new Date("2026-10-13T08:00:00Z"); // Tuesday 10:00 Kigali
const WED_11 = new Date("2026-10-14T09:00:00Z");
const EVENTS = "POST https://www.googleapis.com/calendar/v3/calendars/primary/events";
const PATCH = "PATCH https://www.googleapis.com/calendar/v3/calendars/primary/events/";
const DELETE = "DELETE https://www.googleapis.com/calendar/v3/calendars/primary/events/";
const REUSABLE = "https://meet.google.com/reusable-link";
const code = async (p: Promise<unknown>) => p.then(() => null, (e: DemoError) => `${e.code}: ${e.message}`);
const ics = (mail: { attachments?: { content: string }[] }) => Buffer.from(mail.attachments![0].content, "base64").toString().replace(/\r\n /g, "");
let google: ReturnType<typeof googleFake>;

function seed() {
  h.db.pricingRegion.rows.push({ key: "RW", name: "Rwanda", currency: "RWF", countries: ["RW"], paymentMethods: ["momo", "card"], active: true, sortOrder: 0 });
  h.db.planDefinition.rows.push({
    id: "plan_starter", key: "STARTER", name: "Starter", description: "", isTrial: false, trialDays: null, status: "active", sortOrder: 5, highlight: false, monthlyPriceCents: 1200, yearlyPriceCents: 11600, currency: "USD",
    limits: { text: 60, image: 30, chat: 0, videoSeconds: 0, voiceCharacters: 0, seats: 1 }, highlights: [], featureKeys: ["content", "designs", "calendar", "gallery"], features: [], capabilities: {}, paddlePrices: [], syncState: "not_synced", syncError: null, createdAt: NOW, updatedAt: NOW,
  });
  h.db.planRegionPrice.rows.push({ id: "p1", planKey: "STARTER", regionKey: "RW", currency: "RWF", monthlyMinor: 15000, yearlyMinor: 150000, cardMonthlyUsdCents: 1200, cardYearlyUsdCents: 11600 });
  for (const d of [1, 2, 3, 4, 5]) h.db.adminAvailability.rows.push({ id: `a${d}`, weekday: d, startMinute: 540, endMinute: 1020 });
  h.db.adminSetting.rows.push({ key: "demo.meetingLink", value: REUSABLE });
}

/** A company: paying on Starter by default (an existing client), or waiting for its demo. */
function company(n: number, sub: Record<string, unknown> = {}) {
  const userId = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const subscription: Record<string, unknown> = { id: `s${n}`, userId, plan: "STARTER", status: "ACTIVE", chosenPlan: "STARTER", trialEndsAt: null, currentPeriodStart: NOW, currentPeriodEnd: null, providerSubscriptionId: null, ...sub };
  h.db.subscription.rows.push(subscription);
  const user = { id: userId, email: `owner${n}@nova.rw`, name: `Patrick ${n}`, subscription };
  h.db.user.rows.push(user);
  h.db.business.rows.push({ id: `b${n}`, userId, name: n === 1 ? "Nova Phones Kigali" : `Company ${n}`, country: "Rwanda", pricingRegion: "RW", phone: "+250 788 000 111", industry: "Electronics", website: null, description: "Phones and accessories in Kigali.", user });
  return { businessId: `b${n}`, userId, subscription };
}

/** A custom plan request of the company, as createPlanRequest stores it. */
function request(businessId: string, id = `req_${businessId}`, createdAt = NOW) {
  h.db.customPlanRequest.rows.push({ id, businessId, userId: null, name: "Patrick", email: "owner1@nova.rw", phone: null, companyName: "Nova Phones Kigali", description: "Phones and accessories.", goals: null, featureKeys: ["autopilot", "websiteChat"], budget: null, source: "billing", status: "new", handledBy: null, demoBookingId: null, createdAt, updatedAt: createdAt });
  return id;
}

async function connect() {
  h.db.adminSetting.rows.push({ key: CONNECTION_KEY, value: { refreshToken: await encrypt("1//refresh"), email: "demos@bupulse.com", calendarId: "primary", scopes: [EVENTS_SCOPE, FREEBUSY_SCOPE], connectedAt: NOW.toISOString() } });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  h.db = createFakeDb();
  h.email.mockClear();
  h.track.mockClear();
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  clearSwitchCache();
  resetGoogleCalendarCache();
  seed();
  vi.stubEnv("ADMIN_EMAILS", "admin@bupulse.com");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bupulse.test");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "client-id");
  vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "client-secret");
  google = googleFake();
  vi.stubGlobal("fetch", google.fetch);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("booking a call after a custom plan request", () => {
  it("is a custom_plan booking linked to the request, with a Google Meet invite and emails that point at the call page", async () => {
    await connect();
    const { businessId, userId } = company(1);
    const requestId = request(businessId);
    const { booking, rescheduled } = await bookPlanCall({ businessId, startsAt: TUE_10, requestId, now: NOW });
    expect(rescheduled).toBe(false);
    expect(booking).toMatchObject({ businessId, kind: "custom_plan", requestId, planKey: "STARTER", status: "booked", startsAt: TUE_10, meetingLink: "https://meet.google.com/abc-defg-hij", googleEventId: "evt1" });
    expect(booking.endsAt.getTime() - TUE_10.getTime()).toBe(30 * 60_000);

    // Google's own invite to the client, titled as a custom plan call; the description says what the call is for.
    const body = google.to(EVENTS)[0].body as { summary: string; description: string; attendees: unknown[]; conferenceData: unknown };
    expect(body.summary).toBe("BuPulse custom plan call — Nova Phones Kigali");
    expect(body.description).toContain("A short call about a custom plan for Nova Phones Kigali.");
    expect(body.description).toContain("Current plan: Starter");
    expect(body.description).toContain("https://bupulse.test/custom-plan/call");
    expect(body.description).not.toContain("Plan chosen");
    expect(body.attendees).toEqual([{ email: "owner1@nova.rw", displayName: "Patrick 1" }]);
    expect(body.conferenceData).toBeTruthy();

    // The client's email: the Meet link, calendar links, and the call page to move or cancel it.
    const [client, admin] = h.email.mock.calls.map((c) => c[0]);
    expect(client.to).toBe("owner1@nova.rw");
    expect(client.subject).toMatch(/^Your BuPulse call is booked: Tuesday 13 October 2026, 10:00/);
    expect(client.text).toContain("GOOGLE MEET\nhttps://meet.google.com/abc-defg-hij");
    expect(client.text).toContain("thanks for your custom plan request");
    expect(client.text).toContain("/custom-plan/call");
    expect(client.text).not.toContain("free trial");
    expect(client.attachments![0].filename).toBe("bupulse-call.ics");
    expect(ics(client)).toContain("SUMMARY:BuPulse custom plan call: Nova Phones Kigali");
    // The admins' email: what was asked for and a link to the request.
    expect(admin.to).toBe("admin@bupulse.com");
    expect(admin.subject).toMatch(/^New custom plan call: Nova Phones Kigali, Tuesday 13 October 2026/);
    expect(admin.text).toContain("INTERESTED IN\nWebsite chat and leads, Autopilot");
    expect(admin.text).toContain(`/admin/requests?open=${requestId}#request-${requestId}`);
    expect(h.track).toHaveBeenCalledWith(PLAN_CALL_EVENT, { userId, businessId, props: { rescheduled: false, google: "ok" } });
    expect(h.track).not.toHaveBeenCalledWith("demo_booked", expect.anything());
  });

  it("without Google Calendar: the reusable link and the .ics invite", async () => {
    const { businessId } = company(1);
    request(businessId);
    const { booking } = await bookPlanCall({ businessId, startsAt: TUE_10, now: NOW }); // no request given: the latest
    expect(booking).toMatchObject({ kind: "custom_plan", requestId: "req_b1", meetingLink: REUSABLE });
    expect(booking.googleEventId ?? null).toBeNull();
    expect(google.to(EVENTS)).toHaveLength(0);
    const client = h.email.mock.calls[0][0];
    expect(client.text).toContain(`WHERE\n${REUSABLE}`);
    expect(ics(client)).toContain(`LOCATION:${REUSABLE}`);
    expect(ics(client)).toContain("METHOD:REQUEST");
  });

  it("needs a request of this company, and is not for a company still waiting for its demo", async () => {
    const { businessId } = company(1);
    expect(await code(bookPlanCall({ businessId, startsAt: TUE_10, now: NOW }))).toMatch(/^not_allowed: Send your custom plan request first/);
    const other = company(2);
    const theirs = request(other.businessId);
    expect(await code(bookPlanCall({ businessId, startsAt: TUE_10, requestId: theirs, now: NOW }))).toMatch(/^invalid/);
    const pending = company(3, { status: "PENDING_DEMO", plan: "TRIAL" });
    request(pending.businessId);
    expect(await code(bookPlanCall({ businessId: pending.businessId, startsAt: TUE_10, now: NOW }))).toMatch(/^not_allowed: We talk your request through in your demo/);
    expect(h.db.demoBooking.rows).toHaveLength(0);
  });
});

describe("the demo's rules", () => {
  it("shares the slots and buffer with demos, and the daily cap", async () => {
    const pending = company(1, { status: "PENDING_DEMO", plan: "TRIAL", chosenPlan: null });
    await choosePlan({ businessId: pending.businessId, planKey: "STARTER" });
    await bookDemo({ businessId: pending.businessId, startsAt: TUE_10, now: NOW });
    const client = company(2);
    request(client.businessId);
    expect(await code(bookPlanCall({ businessId: client.businessId, startsAt: TUE_10, now: NOW }))).toMatch(/^conflict: That time is no longer free/);
    expect(await code(bookPlanCall({ businessId: client.businessId, startsAt: new Date("2026-10-13T08:30:00Z"), now: NOW }))).toMatch(/^conflict/); // inside the buffer
    expect(await code(bookPlanCall({ businessId: client.businessId, startsAt: new Date("2026-10-17T08:00:00Z"), now: NOW }))).toMatch(/^conflict/); // Saturday
    expect(await code(bookPlanCall({ businessId: client.businessId, startsAt: new Date("2026-10-12T07:00:00Z"), now: NOW }))).toMatch(/^conflict/); // in an hour

    // One new booking a day (demos and calls together): the demo above used it.
    h.db.adminSetting.rows.push({ key: "demo.dailyCap", value: 1 });
    expect(await code(bookPlanCall({ businessId: client.businessId, startsAt: WED_11, now: NOW }))).toMatch(/^not_allowed: We have reached today's limit for new calls/);
  });

  it("reschedules in place (same invite, Google event moved) and cancels up to two hours before, not later", async () => {
    await connect();
    const { businessId } = company(1);
    const requestId = request(businessId);
    const first = (await bookPlanCall({ businessId, startsAt: TUE_10, requestId, now: NOW })).booking;
    h.email.mockClear();
    const moved = await bookPlanCall({ businessId, startsAt: WED_11, now: NOW });
    expect(moved.rescheduled).toBe(true);
    expect(moved.booking).toMatchObject({ id: first.id, requestId, sequence: 1, startsAt: WED_11, icsToken: first.icsToken, meetingLink: "https://meet.google.com/abc-defg-hij" });
    expect(h.db.demoBooking.rows).toHaveLength(1);
    expect(google.to(EVENTS)).toHaveLength(1);
    expect(google.to(PATCH)[0].body).toMatchObject({ summary: "BuPulse custom plan call — Nova Phones Kigali", start: { dateTime: WED_11.toISOString() } });
    expect(h.email.mock.calls[0][0].subject).toMatch(/^Your BuPulse call has moved: Wednesday 14 October 2026, 11:00/);
    expect(ics(h.email.mock.calls[0][0])).toContain(`UID:${first.id}@bupulse.com\r\nSEQUENCE:1`);

    expect(await code(cancelPlanCall({ businessId, now: new Date(WED_11.getTime() - HOUR) }))).toMatch(/^not_allowed: Your call starts in less than 2 hours/);
    expect(await code(bookPlanCall({ businessId, startsAt: TUE_10, now: new Date(WED_11.getTime() - HOUR) }))).toMatch(/^not_allowed: Your call starts in less than 2 hours/);
    h.email.mockClear();
    const cancelled = await cancelPlanCall({ businessId, now: NOW });
    expect(cancelled).toMatchObject({ status: "cancelled", sequence: 2 });
    expect(google.to(DELETE)[0].url.pathname).toBe("/calendar/v3/calendars/primary/events/evt1");
    expect(h.email.mock.calls[0][0].subject).toMatch(/^Your BuPulse call is cancelled/);
    expect(h.email.mock.calls[0][0].attachments![0].filename).toBe("bupulse-call-cancelled.ics");
    expect(ics(h.email.mock.calls[0][0])).toContain("METHOD:CANCEL");
    expect(await currentPlanCall(businessId)).toBeNull();
    expect(await code(cancelPlanCall({ businessId, now: NOW }))).toMatch(/^invalid: There is no call to cancel/);
  });
});

describe("kept apart from the demo -> trial steps", () => {
  it("a live call is neither the company's demo nor marked done by Start trial", async () => {
    // A company waiting for its demo with a call row (from before it was allowed, or written by hand): every demo step
    // looks at its demo only.
    const { businessId, subscription } = company(1, { status: "PENDING_DEMO", plan: "TRIAL", chosenPlan: null });
    h.db.demoBooking.rows.push({ id: "call1", businessId, kind: "custom_plan", requestId: null, planKey: "TRIAL", status: "booked", startsAt: WED_11, endsAt: new Date(WED_11.getTime() + 30 * 60_000), sequence: 0, icsToken: "call_token", meetingLink: null, notes: null, createdAt: NOW, updatedAt: NOW });
    expect(await currentBooking(businessId)).toBeNull();
    await choosePlan({ businessId, planKey: "STARTER" });
    expect(h.db.demoBooking.rows[0].planKey).toBe("TRIAL"); // choosing the demo plan leaves the call alone
    const { booking: demo } = await bookDemo({ businessId, startsAt: TUE_10, now: NOW });
    expect(demo.kind).toBe("demo");
    expect((await currentBooking(businessId))?.id).toBe(demo.id);
    expect((await demoPanel(businessId)).booking?.id).toBe(demo.id);
    await startTrial(consoleContext(), { businessId }, NOW);
    expect(subscription.status).toBe("TRIALING");
    expect(h.db.demoBooking.rows.find((r) => r.id === demo.id)!.status).toBe("done");
    expect(h.db.demoBooking.rows.find((r) => r.id === "call1")!.status).toBe("booked");
  });
});

describe("admin", () => {
  it("Requests shows the call with its request, and Demos lists it as a custom plan call", async () => {
    const { businessId } = company(1);
    const requestId = request(businessId);
    const other = request(businessId, "req_other", new Date(NOW.getTime() - HOUR));
    const { booking } = await bookPlanCall({ businessId, startsAt: TUE_10, requestId, now: NOW });
    const requests = await listPlanRequests();
    expect(requests.find((r) => r.id === requestId)?.call).toEqual({ id: booking.id, status: "booked", startsAt: TUE_10, when: "Tuesday 13 October 2026, 10:00", meetingLink: REUSABLE });
    expect(requests.find((r) => r.id === other)?.call).toBeNull();
    const demos = await listDemos({ when: "upcoming" }, NOW);
    expect(demos).toHaveLength(1);
    expect(demos[0]).toMatchObject({ id: booking.id, kind: "custom_plan", requestId, businessName: "Nova Phones Kigali", subscriptionStatus: "ACTIVE" });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";
import { googleFake } from "./google-fake";

// Demo bookings with the owner's Google Calendar connected: busy times there come out of the free slots (cached two
// minutes, availability alone when Google fails), and each booking is a Google event with a Meet link that moves on
// reschedule and is deleted on cancel, with sendUpdates=all. Whatever Google does, the booking itself never fails.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  email: vi.fn<(email: { to: string; subject: string; text: string; html: string; attachments?: { filename: string; content: string }[] }) => Promise<boolean>>(async () => true),
  logError: vi.fn(async () => {}),
}));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: h.logError }));
vi.mock("@/lib/billing/paddle-catalog", () => ({ paddleConnected: () => false, createPaddleProduct: vi.fn(), createPaddlePrice: vi.fn(), archivePaddlePrice: vi.fn(), updatePaddleProduct: vi.fn() }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.email }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: { demoBooked: "demo_booked", trialStarted: "trial_started" }, trackEvent: vi.fn() }));

import { availableSlots, bookDemo, cancelDemo, choosePlan } from "@/lib/demo/bookings";
import { retryDemoCalendar, setDemoStatus } from "@/lib/admin/demos";
import { encrypt } from "@/lib/crypto";
import { calendarBusy, CONNECTION_KEY, googleCalendarStatus, resetGoogleCalendarCache, saveGoogleConnection, SLOT_TIMEOUT_MS } from "@/lib/google-calendar/calendar";
import { retryPendingDemoSyncs } from "@/lib/google-calendar/events";
import { EVENTS_SCOPE, FREEBUSY_SCOPE } from "@/lib/google-calendar/oauth";
import { resetPlanCache } from "@/lib/plan-catalog";
import { resetRegionCache } from "@/lib/region";
import { resetRegionPriceCache } from "@/lib/region-prices";
import { clearSwitchCache } from "@/lib/admin/switch";
import { consoleContext } from "@/lib/admin/types";

// Monday 12 October 2026, 08:00 in Kigali.
const NOW = new Date("2026-10-12T06:00:00Z");
const TUE_10 = new Date("2026-10-13T08:00:00Z"); // Tuesday 10:00 Kigali
const EVENTS = "POST https://www.googleapis.com/calendar/v3/calendars/primary/events";
const PATCH = "PATCH https://www.googleapis.com/calendar/v3/calendars/primary/events/";
const DELETE = "DELETE https://www.googleapis.com/calendar/v3/calendars/primary/events/";
const FREEBUSY = "POST https://www.googleapis.com/calendar/v3/freeBusy";
const REUSABLE = "https://meet.google.com/reusable-link";
let google: ReturnType<typeof googleFake>;

function seed() {
  h.db.pricingRegion.rows.push({ key: "RW", name: "Rwanda", currency: "RWF", countries: ["RW"], paymentMethods: ["momo", "card"], active: true, sortOrder: 0 });
  h.db.planDefinition.rows.push({
    id: "plan_starter", key: "STARTER", name: "Starter", description: "", isTrial: false, trialDays: null, status: "active", sortOrder: 5, highlight: false, monthlyPriceCents: 1200, yearlyPriceCents: 11600, currency: "USD",
    limits: { text: 60, image: 30, chat: 0, videoSeconds: 0, voiceCharacters: 0, seats: 1 }, highlights: [], featureKeys: ["content"], features: [], capabilities: {}, paddlePrices: [], syncState: "not_synced", syncError: null, createdAt: NOW, updatedAt: NOW,
  });
  h.db.planRegionPrice.rows.push({ id: "p1", planKey: "STARTER", regionKey: "RW", currency: "RWF", monthlyMinor: 15000, yearlyMinor: 150000, cardMonthlyUsdCents: 1200, cardYearlyUsdCents: 11600 });
  for (const d of [1, 2, 3, 4, 5]) h.db.adminAvailability.rows.push({ id: `a${d}`, weekday: d, startMinute: 540, endMinute: 1020 });
  h.db.adminSetting.rows.push({ key: "demo.meetingLink", value: REUSABLE });
}

async function company() {
  const userId = "00000000-0000-4000-8000-000000000001";
  const subscription = { id: "s1", userId, plan: "TRIAL", status: "PENDING_DEMO", chosenPlan: null, trialEndsAt: null };
  h.db.subscription.rows.push(subscription);
  const user = { id: userId, email: "aline@inzu.rw", name: "Aline Uwase", subscription };
  h.db.user.rows.push(user);
  h.db.business.rows.push({ id: "b1", userId, name: "Inzu Fashion", country: "Rwanda", pricingRegion: "RW", phone: "+250 788 123 456", industry: "Retail", website: "https://inzu.rw", description: "Dresses and kitenge, made in Kigali.", user });
  await choosePlan({ businessId: "b1", planKey: "STARTER" });
  return "b1";
}

async function connect(calendarId = "primary") {
  h.db.adminSetting.rows.push({ key: CONNECTION_KEY, value: { refreshToken: await encrypt("1//refresh"), email: "demos@bupulse.com", calendarId, scopes: [EVENTS_SCOPE, FREEBUSY_SCOPE], connectedAt: NOW.toISOString() } });
}

const iso = (d: Date) => d.toISOString();
const slotIsos = async (now = NOW, ignore?: string) => (await availableSlots(now, ignore)).slots.map(iso);

beforeEach(() => {
  h.db = createFakeDb();
  h.email.mockClear();
  h.logError.mockClear();
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
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("free slots", () => {
  it("take the Google Calendar busy times out, with the buffer, over the 14-day window", async () => {
    await connect();
    const without = await slotIsos();
    resetGoogleCalendarCache();
    // Busy 10:00-11:00 Kigali on Tuesday. 15-minute buffer: 09:30, 10:00, 10:30 and 11:00 go; 09:00 and 11:30 stay.
    google.on(FREEBUSY, () => ({ json: { calendars: { primary: { busy: [{ start: "2026-10-13T08:00:00Z", end: "2026-10-13T09:00:00Z" }] } } } }));
    const withBusy = await slotIsos();
    const gone = without.filter((s) => !withBusy.includes(s));
    expect(gone).toEqual(["2026-10-13T07:30:00.000Z", "2026-10-13T08:00:00.000Z", "2026-10-13T08:30:00.000Z", "2026-10-13T09:00:00.000Z"]);
    expect(withBusy).toContain("2026-10-13T07:00:00.000Z");
    expect(withBusy).toContain("2026-10-13T09:30:00.000Z");

    const [query] = google.to(FREEBUSY);
    expect(query.body).toMatchObject({ timeMin: NOW.toISOString(), items: [{ id: "primary" }] });
    expect(new Date((query.body as { timeMax: string }).timeMax).getTime() - NOW.getTime()).toBe(15 * 86_400_000);
    expect(google.to("POST https://oauth2.googleapis.com/token")[0].body).toMatchObject({ grant_type: "refresh_token", refresh_token: "1//refresh" });
  });

  it("are cached for two minutes, then read again", async () => {
    await connect();
    const t0 = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(t0);
    await slotIsos();
    await slotIsos();
    expect(google.to(FREEBUSY)).toHaveLength(1);
    clock.mockReturnValue(t0 + 2 * 60_000 + 1);
    await slotIsos();
    expect(google.to(FREEBUSY)).toHaveLength(2);
    expect(google.to("POST https://oauth2.googleapis.com/token")).toHaveLength(1); // the access token is reused
  });

  it("fall back to the availability alone when Google fails, logged", async () => {
    const plain = await slotIsos(); // not connected: Google is never asked
    expect(google.calls).toHaveLength(0);
    await connect();
    google.on(FREEBUSY, () => ({ status: 500, json: { error: { message: "backend error" } } }));
    expect(await slotIsos()).toEqual(plain);
    expect(h.logError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/freeBusy failed \(500: backend error\)/) }), expect.objectContaining({ source: "google-calendar.freebusy" }));
    // A revoked login (invalid_grant) is the same: slots from availability, and the reason is kept for Settings.
    resetGoogleCalendarCache();
    google.on("POST https://oauth2.googleapis.com/token", () => ({ status: 400, json: { error: "invalid_grant" } }));
    expect(await slotIsos()).toEqual(plain);
    expect(h.db.adminSetting.rows.find((r) => r.key === CONNECTION_KEY)!.value.lastError).toMatch(/Reconnect Google Calendar/);
  });

  it("cut the booking's own interval out of Google's merged busy block when rescheduling", async () => {
    await connect();
    const businessId = await company();
    const { booking } = await bookDemo({ businessId, startsAt: TUE_10, now: NOW });
    // Google merges another event (09:00-10:00 Kigali) with the demo event itself (10:00-10:30) into one block.
    google.on(FREEBUSY, () => ({ json: { calendars: { primary: { busy: [{ start: "2026-10-13T07:00:00Z", end: iso(booking.endsAt) }] } } } }));
    resetGoogleCalendarCache("busy");
    expect(await slotIsos(NOW)).not.toContain("2026-10-13T08:30:00.000Z");
    // Rescheduling: 10:00-10:30 is cut out, 09:00-10:00 stays busy, so 10:30 is free again but 10:00 is not (buffer).
    const moving = await slotIsos(NOW, booking.id);
    expect(moving).toContain("2026-10-13T08:30:00.000Z");
    expect(moving).not.toContain("2026-10-13T08:00:00.000Z");
    expect((await bookDemo({ businessId, startsAt: new Date("2026-10-13T08:30:00Z"), now: NOW })).rescheduled).toBe(true);
  });

  it("are not asked again for a minute after Google failed (busy times or sign-in), and wait at most 3 s on the slot path", async () => {
    await connect();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const t0 = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(t0);
    google.on(FREEBUSY, () => ({ status: 503, json: { error: { message: "unavailable" } } }));
    await slotIsos();
    expect(timeout).toHaveBeenCalledWith(SLOT_TIMEOUT_MS);
    expect(SLOT_TIMEOUT_MS).toBe(3000);
    await slotIsos();
    clock.mockReturnValue(t0 + 59_000);
    await slotIsos();
    expect(google.to(FREEBUSY)).toHaveLength(1);
    clock.mockReturnValue(t0 + 61_000);
    await slotIsos();
    expect(google.to(FREEBUSY)).toHaveLength(2);

    // A failed token refresh (not invalid_grant) is left alone for a minute too.
    resetGoogleCalendarCache();
    const tokensBefore = google.to("POST https://oauth2.googleapis.com/token").length;
    google.on("POST https://oauth2.googleapis.com/token", () => ({ status: 500, json: { error: "internal" } }));
    await calendarBusy(NOW, new Date(NOW.getTime() + 86_400_000));
    clock.mockReturnValue(t0 + 61_000 + 30_000);
    await calendarBusy(NOW, new Date(NOW.getTime() + 86_400_000));
    expect(google.to("POST https://oauth2.googleapis.com/token")).toHaveLength(tokensBefore + 1);
  });

  it("stop calling Google after invalid_grant until the owner reconnects", async () => {
    await connect();
    google.on("POST https://oauth2.googleapis.com/token", () => ({ status: 400, json: { error: "invalid_grant" } }));
    await slotIsos();
    expect((await googleCalendarStatus()).needsReconnect).toBe(true);
    resetGoogleCalendarCache(); // even with every cache cleared
    const before = google.calls.length;
    await slotIsos();
    const businessId = await company();
    const { booking } = await bookDemo({ businessId, startsAt: TUE_10, now: NOW });
    expect(google.calls.length).toBe(before);
    // The booking went through with the reusable link and waits for the calendar.
    expect(booking).toMatchObject({ meetingLink: REUSABLE, googleSyncPending: true, googleSyncError: expect.stringMatching(/reconnecting/) });

    // Reconnecting (same account) clears the state; the pending event is then made by the retry.
    google.on("POST https://oauth2.googleapis.com/token", () => ({ json: { access_token: "ya29.new", expires_in: 3600 } }));
    await saveGoogleConnection(consoleContext(), { refreshToken: "1//new", accessToken: "ya29.new", expiresAt: Date.now() + 3_600_000, scopes: [EVENTS_SCOPE, FREEBUSY_SCOPE], email: "demos@bupulse.com" });
    expect((await googleCalendarStatus()).needsReconnect).toBe(false);
    h.db.demoBooking.rows[0].googleSyncAttemptAt = new Date(Date.now() - 120_000);
    expect(await retryPendingDemoSyncs()).toEqual({ tried: 1, fixed: 1, failed: 0 });
    expect(h.db.demoBooking.rows[0]).toMatchObject({ googleEventId: "evt1", googleSyncPending: false });
  });
});

describe("booking with Google Calendar", () => {
  it("checks the chosen slot against Google afresh, not the page's cached busy times", async () => {
    await connect();
    const businessId = await company();
    expect(await slotIsos()).toContain(iso(TUE_10)); // cached: Tuesday 10:00 free
    google.on(FREEBUSY, () => ({ json: { calendars: { primary: { busy: [{ start: iso(TUE_10), end: "2026-10-13T09:00:00Z" }] } } } }));
    await expect(bookDemo({ businessId, startsAt: TUE_10, now: NOW })).rejects.toMatchObject({ code: "conflict" });
    expect(google.to(FREEBUSY)).toHaveLength(2);
    expect(google.to(EVENTS)).toHaveLength(0);
  });

  it("creates the event with a Meet link and Google's invite, and the emails carry the Meet link and calendar links", async () => {
    await connect();
    const businessId = await company();
    const { booking } = await bookDemo({ businessId, startsAt: TUE_10, now: NOW });

    const [create] = google.to(EVENTS);
    expect(Object.fromEntries(create.url.searchParams)).toEqual({ conferenceDataVersion: "1", sendUpdates: "all" });
    const body = create.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body).toMatchObject({
      summary: "BuPulse demo — Inzu Fashion",
      start: { dateTime: "2026-10-13T08:00:00.000Z", timeZone: "Africa/Kigali" },
      end: { dateTime: "2026-10-13T08:30:00.000Z", timeZone: "Africa/Kigali" },
      attendees: [{ email: "aline@inzu.rw", displayName: "Aline Uwase" }],
      iCalUID: `${booking.id}@bupulse.com`,
      conferenceData: { createRequest: { requestId: expect.stringContaining(booking.id), conferenceSolutionKey: { type: "hangoutsMeet" } } },
      reminders: { useDefault: false, overrides: [{ method: "email", minutes: 1440 }, { method: "popup", minutes: 15 }] },
      extendedProperties: { private: { bupulseBookingId: booking.id, client360: "https://bupulse.test/admin/companies/b1" } },
    });
    expect(body.description).toContain("Plan chosen: Starter");
    expect(body.description).toContain("Phone: +250 788 123 456");
    expect(body.description).toContain("Industry: Retail");
    expect(body.description).toContain("About: Dresses and kitenge, made in Kigali.");
    // The client sees the description, so the admin console link stays in the private properties only.
    expect(body.description).not.toContain("/admin/");

    expect(booking).toMatchObject({ googleEventId: "evt1", meetLink: "https://meet.google.com/abc-defg-hij", meetingLink: "https://meet.google.com/abc-defg-hij" });
    expect(h.db.demoBooking.rows[0]).toMatchObject({ googleEventId: "evt1", meetingLink: "https://meet.google.com/abc-defg-hij" });

    const client = h.email.mock.calls[0][0];
    expect(client.to).toBe("aline@inzu.rw");
    expect(client.text).toContain("GOOGLE MEET\nhttps://meet.google.com/abc-defg-hij");
    expect(client.text).toContain("https://calendar.google.com/calendar/render?action=TEMPLATE");
    expect(client.text).toContain(`/api/demo/ics/${booking.icsToken}`);
    // The .ics carries the same UID as the Google event and the Meet link as its location.
    const ics = Buffer.from(client.attachments![0].content, "base64").toString().replace(/\r\n /g, "");
    expect(ics).toContain(`UID:${booking.id}@bupulse.com`);
    expect(ics).toContain("LOCATION:https://meet.google.com/abc-defg-hij");
  });

  it("moves the same event on reschedule and keeps its Meet link", async () => {
    await connect();
    const businessId = await company();
    await bookDemo({ businessId, startsAt: TUE_10, now: NOW });
    const moved = await bookDemo({ businessId, startsAt: new Date("2026-10-14T09:00:00Z"), now: NOW });
    expect(google.to(EVENTS)).toHaveLength(1);
    const [patch] = google.to(PATCH);
    expect(patch.url.pathname).toBe("/calendar/v3/calendars/primary/events/evt1");
    expect(patch.url.searchParams.get("sendUpdates")).toBe("all");
    expect(patch.body).toMatchObject({ start: { dateTime: "2026-10-14T09:00:00.000Z", timeZone: "Africa/Kigali" }, end: { dateTime: "2026-10-14T09:30:00.000Z" } });
    expect(moved.booking).toMatchObject({ googleEventId: "evt1", meetingLink: "https://meet.google.com/abc-defg-hij", sequence: 1 });
  });

  it("makes a new event when the old one was deleted in Google, and a new UID when Google already knows it", async () => {
    await connect();
    const businessId = await company();
    await bookDemo({ businessId, startsAt: TUE_10, now: NOW });
    google.on(PATCH, () => ({ status: 404, json: { error: { message: "Not Found" } } }));
    let inserts = 0;
    google.on(EVENTS, (call) => {
      inserts++;
      if ((call.body as { iCalUID?: string }).iCalUID) return { status: 409, json: { error: { message: "The requested identifier already exists." } } };
      return { json: { id: "evt2", conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/new-link-xyz" }] } } };
    });
    const moved = await bookDemo({ businessId, startsAt: new Date("2026-10-14T09:00:00Z"), now: NOW });
    expect(inserts).toBe(2);
    expect(moved.booking).toMatchObject({ googleEventId: "evt2", meetLink: "https://meet.google.com/new-link-xyz" });
  });

  it("deletes the event on cancel (client or admin), telling the attendee", async () => {
    await connect();
    const businessId = await company();
    await bookDemo({ businessId, startsAt: TUE_10, now: NOW });
    await cancelDemo({ businessId, now: NOW });
    const [del] = google.to(DELETE);
    expect(del.url.pathname).toBe("/calendar/v3/calendars/primary/events/evt1");
    expect(del.url.searchParams.get("sendUpdates")).toBe("all");

    // An admin cancelling from Demos does the same.
    h.db.subscription.rows[0].status = "PENDING_DEMO";
    const again = await bookDemo({ businessId, startsAt: new Date("2026-10-15T08:00:00Z"), now: NOW });
    await setDemoStatus(consoleContext(), { id: again.booking.id, status: "cancelled" });
    expect(google.to(DELETE)).toHaveLength(2);
    // An event Google already lost is fine.
    google.on(DELETE, () => ({ status: 410, json: { error: { message: "Gone" } } }));
    const third = await bookDemo({ businessId, startsAt: new Date("2026-10-16T08:00:00Z"), now: NOW });
    await expect(cancelDemo({ businessId, now: NOW })).resolves.toMatchObject({ id: third.booking.id, status: "cancelled" });
    expect(h.logError).not.toHaveBeenCalled();
  });

  it("falls back to the reusable link and .ics when Google fails: the booking goes through, logged", async () => {
    await connect();
    google.on(EVENTS, () => ({ status: 500, json: { error: { message: "backend error" } } }));
    const businessId = await company();
    const { booking } = await bookDemo({ businessId, startsAt: TUE_10, now: NOW });
    expect(booking).toMatchObject({ status: "booked", meetingLink: REUSABLE });
    expect(booking.googleEventId ?? null).toBeNull();
    expect(h.logError).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: "google-calendar.booked", bookingId: booking.id }));
    const client = h.email.mock.calls[0][0];
    expect(client.text).toContain(`WHERE\n${REUSABLE}`);
    expect(client.attachments).toHaveLength(1);

    // A network failure (timeout) is the same.
    google.on(EVENTS, () => Promise.reject(new Error("The operation was aborted due to timeout")));
    await cancelDemo({ businessId, now: NOW });
    expect(google.to(DELETE)).toHaveLength(0); // no Google event to cancel
    const second = await bookDemo({ businessId, startsAt: new Date("2026-10-14T09:00:00Z"), now: NOW });
    expect(second.booking).toMatchObject({ status: "booked", meetingLink: REUSABLE });
  });

  it("leaves Google alone when it is not connected or not configured", async () => {
    const businessId = await company();
    await bookDemo({ businessId, startsAt: TUE_10, now: NOW });
    await cancelDemo({ businessId, now: NOW });
    await connect();
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "");
    await bookDemo({ businessId, startsAt: new Date("2026-10-14T09:00:00Z"), now: NOW });
    expect(google.calls).toHaveLength(0);
    expect(h.db.demoBooking.rows.at(-1)).toMatchObject({ meetingLink: REUSABLE });
  });
});

describe("pending calendar changes", () => {
  const ago = (ms: number) => new Date(Date.now() - ms);

  it("a failed cancel is marked on the booking, then retried by the next booking request until Google has it", async () => {
    await connect();
    const businessId = await company();
    await bookDemo({ businessId, startsAt: TUE_10, now: NOW });
    google.on(DELETE, () => ({ status: 500, json: { error: { message: "backend error" } } }));
    const cancelled = await cancelDemo({ businessId, now: NOW });
    expect(cancelled.status).toBe("cancelled");
    expect(h.db.demoBooking.rows[0]).toMatchObject({ status: "cancelled", googleSyncPending: true, googleSyncError: expect.stringMatching(/DELETE calendars failed \(500/) });

    // Google is back; the next booking-related request (here: the company books a new time) retries the old row.
    google.on(DELETE, () => ({ status: 204 }));
    h.db.demoBooking.rows[0].googleSyncAttemptAt = ago(120_000);
    await bookDemo({ businessId, startsAt: new Date("2026-10-14T09:00:00Z"), now: NOW });
    expect(google.to(DELETE)).toHaveLength(2);
    expect(h.db.demoBooking.rows[0]).toMatchObject({ googleSyncPending: false, googleSyncError: null });
  });

  it("a failed move is retried with the booking's current time (cron), spaced a minute apart", async () => {
    await connect();
    const businessId = await company();
    await bookDemo({ businessId, startsAt: TUE_10, now: NOW });
    google.on(PATCH, () => ({ status: 503, json: { error: { message: "unavailable" } } }));
    const moved = await bookDemo({ businessId, startsAt: new Date("2026-10-14T09:00:00Z"), now: NOW });
    expect(moved.booking).toMatchObject({ googleEventId: "evt1", googleSyncPending: true, meetingLink: "https://meet.google.com/abc-defg-hij" });
    expect(await retryPendingDemoSyncs()).toEqual({ tried: 0, fixed: 0, failed: 0 }); // tried just now

    google.on(PATCH, () => ({ json: { id: "evt1", hangoutLink: "https://meet.google.com/abc-defg-hij" } }));
    h.db.demoBooking.rows[0].googleSyncAttemptAt = ago(120_000);
    expect(await retryPendingDemoSyncs()).toEqual({ tried: 1, fixed: 1, failed: 0 });
    expect(google.to(PATCH).at(-1)!.body).toMatchObject({ start: { dateTime: "2026-10-14T09:00:00.000Z" } });
    expect(h.db.demoBooking.rows[0].googleSyncPending).toBe(false);
  });

  it("a failed create is retried without a new Meet link, pointing at the link the client already has", async () => {
    await connect();
    google.on(EVENTS, () => ({ status: 500, json: { error: { message: "backend error" } } }));
    const businessId = await company();
    await bookDemo({ businessId, startsAt: TUE_10, now: NOW });
    expect(h.db.demoBooking.rows[0]).toMatchObject({ googleSyncPending: true, meetingLink: REUSABLE });
    google.on(EVENTS, () => ({ json: { id: "evt9" } }));
    h.db.demoBooking.rows[0].googleSyncAttemptAt = ago(120_000);
    await retryPendingDemoSyncs();
    const body = google.to(EVENTS).at(-1)!.body as Record<string, unknown>;
    expect(body.conferenceData).toBeUndefined();
    expect(body.location).toBe(REUSABLE);
    expect(h.db.demoBooking.rows[0]).toMatchObject({ googleEventId: "evt9", googleSyncPending: false, meetingLink: REUSABLE });
  });

  it("Admin -> Demos Retry pushes it now, audited, and says when Google still refuses", async () => {
    await connect();
    const businessId = await company();
    const { booking } = await bookDemo({ businessId, startsAt: TUE_10, now: NOW });
    google.on(DELETE, () => ({ status: 500, json: { error: { message: "backend error" } } }));
    await setDemoStatus(consoleContext(), { id: booking.id, status: "cancelled" });
    expect(h.db.demoBooking.rows[0].googleSyncPending).toBe(true);
    await expect(retryDemoCalendar(consoleContext(), booking.id)).rejects.toThrow(/still not updated: .*500/);
    google.on(DELETE, () => ({ status: 204 }));
    expect(await retryDemoCalendar(consoleContext(), booking.id)).toEqual({ ok: true, already: false });
    expect(await retryDemoCalendar(consoleContext(), booking.id)).toEqual({ ok: true, already: true });
    expect(h.db.auditLog.rows.filter((r) => r.action === "retry_demo_calendar").map((r) => r.after.ok)).toEqual([false, true]);
  });

  it("disconnecting clears the marks (nothing will sync them)", async () => {
    await connect();
    google.on(EVENTS, () => ({ status: 500, json: { error: { message: "backend error" } } }));
    const businessId = await company();
    await bookDemo({ businessId, startsAt: TUE_10, now: NOW });
    const { disconnectGoogleCalendar } = await import("@/lib/google-calendar/calendar");
    await disconnectGoogleCalendar(consoleContext());
    expect(h.db.demoBooking.rows[0].googleSyncPending).toBe(false);
  });
});

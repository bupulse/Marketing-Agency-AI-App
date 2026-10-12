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
import { setDemoStatus } from "@/lib/admin/demos";
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
    expect(h.db.adminSetting.rows.find((r) => r.key === CONNECTION_KEY)!.value.lastError).toMatch(/Connect Google Calendar again/);
  });

  it("do not count the booking's own Google event against it when rescheduling", async () => {
    await connect();
    const businessId = await company();
    const { booking } = await bookDemo({ businessId, startsAt: TUE_10, now: NOW });
    // Google now reports the demo event itself as busy.
    google.on(FREEBUSY, () => ({ json: { calendars: { primary: { busy: [{ start: iso(booking.startsAt), end: iso(booking.endsAt) }] } } } }));
    resetGoogleCalendarCache("busy");
    expect(await slotIsos(NOW)).not.toContain("2026-10-13T08:30:00.000Z");
    expect(await slotIsos(NOW, booking.id)).toContain("2026-10-13T08:30:00.000Z");
    const moved = await bookDemo({ businessId, startsAt: new Date("2026-10-13T08:30:00Z"), now: NOW });
    expect(moved.rescheduled).toBe(true);
  });
});

describe("booking with Google Calendar", () => {
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

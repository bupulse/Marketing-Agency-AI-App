import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { decrypt, encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import type { Busy } from "@/lib/demo/slots";
import { googleCalendarConfig, GoogleOAuthError, refreshGoogleToken, revokeGoogleToken, type GoogleGrant } from "./oauth";

// The owner's Google Calendar connection and the few Calendar API calls the demo booking makes. The connection is one
// AdminSetting row (an internal table: RLS on, no Data API grants) holding the refresh token encrypted with
// lib/crypto.ts, the connected account's email and the calendar to use. Access tokens live in memory only.

export const CONNECTION_KEY = "google.calendar";
export const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
/** Busy times are read again after this long (the booking page shares them; the booking check reads fresh). */
export const BUSY_CACHE_MS = 2 * 60 * 1000;
/** After a failed token refresh or busy-time read, Google is not asked again for this long (slots use availability). */
export const NEGATIVE_CACHE_MS = 60 * 1000;
/** Busy times sit on the public booking page and the booking check: a slow Google must not hold them up. */
export const SLOT_TIMEOUT_MS = 3_000;
/** Event writes (create, move, delete). */
const TIMEOUT_MS = 10_000;

type StoredConnection = {
  /** lib/crypto.ts payload of the refresh token. */
  refreshToken: string;
  email: string | null;
  calendarId: string;
  scopes: string[];
  connectedAt: string;
  lastError?: string | null;
  lastErrorAt?: string | null;
  /** Google answered invalid_grant (access revoked or expired): no more calls until the owner reconnects. */
  needsReconnect?: boolean;
};

export type GoogleCalendarStatus = {
  /** GOOGLE_CALENDAR_CLIENT_ID and _SECRET are set. */
  configured: boolean;
  connected: boolean;
  email: string | null;
  calendarId: string;
  connectedAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  needsReconnect: boolean;
};

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

function isStored(value: unknown): value is StoredConnection {
  const v = value as StoredConnection | null;
  return !!v && typeof v === "object" && typeof v.refreshToken === "string" && typeof v.calendarId === "string";
}

async function readConnection(): Promise<StoredConnection | null> {
  const row = await prisma.adminSetting.findUnique({ where: { key: CONNECTION_KEY } }).catch(() => null);
  return isStored(row?.value) ? row.value : null;
}

async function writeConnection(db: Pick<typeof prisma, "adminSetting">, value: StoredConnection) {
  const json = value as unknown as Prisma.InputJsonValue;
  await db.adminSetting.upsert({ where: { key: CONNECTION_KEY }, create: { key: CONNECTION_KEY, value: json }, update: { value: json } });
}

// ---- memory caches (per isolate) --------------------------------------------------------------------------------------

let token: { forRefresh: string; accessToken: string; expiresAt: number } | null = null;
let busyCache: { calendarId: string; fetchedAt: number; from: number; to: number; busy: Busy[] } | null = null;
/** Negative caches: no token refresh / busy-time read before these instants (ms). */
let tokenDownUntil = 0;
let busyDownUntil = 0;

/**
 * Forgets the busy times ("busy": after a booking change), or everything including the access token and the negative
 * caches ("all": after a connect, a disconnect or a test).
 */
export function resetGoogleCalendarCache(what: "all" | "busy" = "all") {
  busyCache = null;
  if (what === "all") {
    token = null;
    tokenDownUntil = 0;
    busyDownUntil = 0;
  }
}

export async function googleCalendarStatus(): Promise<GoogleCalendarStatus> {
  const c = await readConnection();
  return {
    configured: googleCalendarConfig() !== null,
    connected: c !== null,
    email: c?.email ?? null,
    calendarId: c?.calendarId ?? "primary",
    connectedAt: c ? new Date(c.connectedAt) : null,
    lastError: c?.lastError ?? null,
    lastErrorAt: c?.lastErrorAt ? new Date(c.lastErrorAt) : null,
    needsReconnect: c?.needsReconnect === true,
  };
}

/**
 * Saves a fresh connection (OAuth callback) and clears "needs reconnect". The calendar chosen before is kept only when
 * the same Google account connects again: another account's calendar ids mean nothing, so it starts at "primary"
 * (events made in the old account stay there; see docs/GOOGLE_CALENDAR.md). Audited without the token.
 */
export async function saveGoogleConnection(ctx: AdminContext, grant: GoogleGrant, now = new Date()) {
  const before = await readConnection();
  const sameAccount = !!before && !!grant.email && before.email === grant.email;
  const next: StoredConnection = {
    refreshToken: await encrypt(grant.refreshToken),
    email: grant.email,
    calendarId: sameAccount ? before.calendarId : "primary",
    scopes: grant.scopes,
    connectedAt: now.toISOString(),
    lastError: null,
    lastErrorAt: null,
    needsReconnect: false,
  };
  await prisma.$transaction(async (tx) => {
    await writeConnection(tx, next);
    await writeAudit(tx, ctx, "connect_google_calendar", `setting:${CONNECTION_KEY}`, before ? { email: before.email, calendarId: before.calendarId } : null, { email: next.email, calendarId: next.calendarId, scopes: next.scopes, accountChanged: !!before && !sameAccount });
  });
  resetGoogleCalendarCache();
  token = { forRefresh: next.refreshToken, accessToken: grant.accessToken, expiresAt: grant.expiresAt };
  return { email: next.email, calendarId: next.calendarId, accountChanged: !!before && !sameAccount };
}

/** Revokes the refresh token at Google and forgets the connection. Bookings fall back to the .ics flow. Audited. */
export async function disconnectGoogleCalendar(ctx: AdminContext) {
  const c = await readConnection();
  if (!c) throw new AdminError("conflict", "Google Calendar is not connected.");
  let revoked = false;
  try {
    revoked = await revokeGoogleToken(await decrypt(c.refreshToken));
  } catch (error) {
    await logError(error, { source: "google-calendar.revoke" });
  }
  await prisma.$transaction(async (tx) => {
    await tx.adminSetting.deleteMany({ where: { key: CONNECTION_KEY } });
    // Nothing will sync these any more: the Demos page stops offering a retry.
    await tx.demoBooking.updateMany({ where: { googleSyncPending: true }, data: { googleSyncPending: false, googleSyncError: null } });
    await writeAudit(tx, ctx, "disconnect_google_calendar", `setting:${CONNECTION_KEY}`, { email: c.email, calendarId: c.calendarId }, { revoked });
  });
  resetGoogleCalendarCache();
  return { email: c.email, revoked };
}

/** "primary" or a calendar's id (an address like abc@group.calendar.google.com). */
export function cleanCalendarId(value: unknown): string {
  const v = String(value ?? "").trim() || "primary";
  if (v.length > 200 || !/^[^\s/?#]+$/.test(v)) throw new AdminError("invalid", 'The calendar id must be "primary" or an id like team@group.calendar.google.com.');
  return v;
}

export async function setGoogleCalendarId(ctx: AdminContext, value: unknown) {
  const calendarId = cleanCalendarId(value);
  const c = await readConnection();
  if (!c) throw new AdminError("conflict", "Connect Google Calendar first.");
  if (c.calendarId === calendarId) return { calendarId, changed: false };
  await prisma.$transaction(async (tx) => {
    await writeConnection(tx, { ...c, calendarId });
    await writeAudit(tx, ctx, "update_setting", `setting:${CONNECTION_KEY}`, { calendarId: c.calendarId }, { calendarId });
  });
  resetGoogleCalendarCache("busy");
  return { calendarId, changed: true };
}

/** Keeps the last failure on the connection so Settings can show it; cleared by the next successful test. Best effort. */
async function noteError(c: StoredConnection, message: string | null, now = new Date(), extra: Partial<StoredConnection> = {}) {
  if ((c.lastError ?? null) === message && Object.entries(extra).every(([k, v]) => c[k as keyof StoredConnection] === v)) return;
  const next = { ...c, ...extra, lastError: message, lastErrorAt: message ? now.toISOString() : null };
  Object.assign(c, next);
  await writeConnection(prisma, next).catch(() => {});
}

export const RECONNECT_MESSAGE = "Google no longer accepts the saved login. Reconnect Google Calendar in Settings.";

async function accessToken(c: StoredConnection, timeoutMs: number): Promise<string> {
  if (c.needsReconnect) throw new GoogleOAuthError("invalid_grant", RECONNECT_MESSAGE);
  if (token && token.forRefresh === c.refreshToken && token.expiresAt - 60_000 > Date.now()) return token.accessToken;
  if (Date.now() < tokenDownUntil) throw new GoogleApiError(0, "Google sign-in failed less than a minute ago; not tried again yet.");
  const config = googleCalendarConfig();
  if (!config) throw new GoogleApiError(0, "GOOGLE_CALENDAR_CLIENT_ID / _SECRET are not set.");
  try {
    const fresh = await refreshGoogleToken(config, await decrypt(c.refreshToken), Date.now(), timeoutMs);
    token = { forRefresh: c.refreshToken, ...fresh };
    return fresh.accessToken;
  } catch (error) {
    if (error instanceof GoogleOAuthError && error.code === "invalid_grant") {
      // Revoked or expired for good: stop calling Google until the owner reconnects (Settings and Demos say so).
      await noteError(c, RECONNECT_MESSAGE, new Date(), { needsReconnect: true });
      throw new GoogleOAuthError("invalid_grant", RECONNECT_MESSAGE);
    }
    tokenDownUntil = Date.now() + NEGATIVE_CACHE_MS;
    if (error instanceof GoogleOAuthError) await noteError(c, error.message);
    throw error;
  }
}

/** One Calendar API call for the stored connection. Throws GoogleApiError on a non-2xx answer. */
async function call<T>(c: StoredConnection, path: string, init: { method: string; body?: unknown; query?: Record<string, string>; timeoutMs?: number }): Promise<T | null> {
  const timeoutMs = init.timeoutMs ?? TIMEOUT_MS;
  const url = new URL(`${CALENDAR_API}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method,
    headers: { authorization: `Bearer ${await accessToken(c, timeoutMs)}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 204) return null;
  const json = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok) {
    const message = `Google Calendar ${init.method} ${path.split("/")[1] ?? path} failed (${res.status}${json?.error?.message ? `: ${json.error.message}` : ""}).`;
    if (res.status === 401 || res.status === 403) await noteError(c, message);
    throw new GoogleApiError(res.status, message);
  }
  return json;
}

const calendarPath = (c: StoredConnection) => `/calendars/${encodeURIComponent(c.calendarId)}`;

type FreeBusyResponse = { calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }> };

async function freeBusy(c: StoredConnection, from: Date, to: Date, timeoutMs: number): Promise<Busy[]> {
  const res = await call<FreeBusyResponse>(c, "/freeBusy", { method: "POST", body: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: c.calendarId }] }, timeoutMs });
  const cal = res?.calendars?.[c.calendarId] ?? Object.values(res?.calendars ?? {})[0];
  if (!cal) throw new GoogleApiError(200, "Google Calendar sent no busy times for the calendar.");
  if (cal.errors?.length) throw new GoogleApiError(200, `Google Calendar could not read the calendar (${cal.errors.map((e) => e.reason).join(", ")}).`);
  return (cal.busy ?? [])
    .map((b) => ({ startsAt: new Date(b.start), endsAt: new Date(b.end) }))
    .filter((b) => !Number.isNaN(b.startsAt.getTime()) && !Number.isNaN(b.endsAt.getTime()));
}

/**
 * Busy times in the owner's Google Calendar between `from` and `to`. Never throws: when Google is not connected, needs
 * reconnecting or fails, the answer is [] (slots come from the availability and the bookings alone) and the failure is
 * logged. Cached for BUSY_CACHE_MS unless `fresh` (the booking check); after a failure Google is left alone for
 * NEGATIVE_CACHE_MS. Each read waits at most `timeoutMs` (SLOT_TIMEOUT_MS by default).
 */
export async function calendarBusy(from: Date, to: Date, opts: { fresh?: boolean; timeoutMs?: number } = {}): Promise<Busy[]> {
  if (!googleCalendarConfig()) return [];
  const c = await readConnection();
  if (!c || c.needsReconnect) return [];
  const now = Date.now();
  if (!opts.fresh && busyCache && busyCache.calendarId === c.calendarId && now - busyCache.fetchedAt < BUSY_CACHE_MS && busyCache.from <= from.getTime() && busyCache.to + BUSY_CACHE_MS >= to.getTime()) {
    return busyCache.busy;
  }
  if (now < busyDownUntil) return [];
  try {
    const busy = await freeBusy(c, from, to, opts.timeoutMs ?? SLOT_TIMEOUT_MS);
    busyCache = { calendarId: c.calendarId, fetchedAt: now, from: from.getTime(), to: to.getTime(), busy };
    return busy;
  } catch (error) {
    busyDownUntil = Date.now() + NEGATIVE_CACHE_MS;
    await logError(error, { source: "google-calendar.freebusy", level: "warn" });
    return [];
  }
}

/** The Test button: reads busy times now (no cache) and reports what it saw. Throws AdminError with Google's reason. */
export async function testGoogleCalendar(now = new Date()) {
  if (!googleCalendarConfig()) throw new AdminError("unavailable", "Set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET first (docs/GOOGLE_CALENDAR.md).");
  const c = await readConnection();
  if (!c) throw new AdminError("conflict", "Connect Google Calendar first.");
  if (c.needsReconnect) throw new AdminError("conflict", RECONNECT_MESSAGE);
  // An explicit test asks Google now, whatever failed a minute ago.
  resetGoogleCalendarCache();
  try {
    const busy = await freeBusy(c, now, new Date(now.getTime() + 14 * 86_400_000), TIMEOUT_MS);
    await noteError(c, null);
    return { email: c.email, calendarId: c.calendarId, busy: busy.length };
  } catch (error) {
    if (error instanceof GoogleApiError || error instanceof GoogleOAuthError) throw new AdminError("unavailable", error.message);
    throw error;
  }
}

// ---- events -------------------------------------------------------------------------------------------------------

export type GoogleEvent = {
  id: string;
  status?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
};

/** The Meet link of an event: hangoutLink, else the conference's video entry point. https only. */
export function meetLinkOf(event: GoogleEvent | null): string | null {
  const link = event?.hangoutLink ?? event?.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
  return link && /^https:\/\/[^\s]+$/.test(link) ? link : null;
}

export type CalendarConnection = StoredConnection;

/** The connection to write events with, or null (not configured or not connected). It may need reconnecting (callers check `needsReconnect`). */
export async function eventConnection(): Promise<CalendarConnection | null> {
  return googleCalendarConfig() ? readConnection() : null;
}

/** Creates an event with a Meet link; sendUpdates=all so the attendee gets Google's invite. */
export async function insertEvent(c: CalendarConnection, body: Record<string, unknown>): Promise<GoogleEvent> {
  const event = await call<GoogleEvent>(c, `${calendarPath(c)}/events`, { method: "POST", body, query: { conferenceDataVersion: "1", sendUpdates: "all" } });
  if (!event?.id) throw new GoogleApiError(200, "Google Calendar created no event.");
  return event;
}

export async function patchEvent(c: CalendarConnection, eventId: string, body: Record<string, unknown>): Promise<GoogleEvent> {
  const event = await call<GoogleEvent>(c, `${calendarPath(c)}/events/${encodeURIComponent(eventId)}`, { method: "PATCH", body, query: { conferenceDataVersion: "1", sendUpdates: "all" } });
  if (!event?.id) throw new GoogleApiError(200, "Google Calendar returned no event.");
  return event;
}

/** Deletes (cancels) an event and tells the attendees. An event already gone (404 / 410) counts as done. */
export async function deleteEvent(c: CalendarConnection, eventId: string): Promise<void> {
  try {
    await call(c, `${calendarPath(c)}/events/${encodeURIComponent(eventId)}`, { method: "DELETE", query: { sendUpdates: "all" } });
  } catch (error) {
    if (error instanceof GoogleApiError && (error.status === 404 || error.status === 410)) return;
    throw error;
  }
}

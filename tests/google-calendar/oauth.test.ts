import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeDb, type FakeDb } from "../admin/fake-db";
import { googleFake, idToken } from "./google-fake";

// Connecting the owner's Google Calendar: admins only (requireAdmin, AAL2), PKCE + a sealed state cookie tied to the
// admin, both calendar scopes required, the refresh token stored encrypted, connect and disconnect audited.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  requireAdmin: vi.fn(),
  logError: vi.fn(async () => {}),
}));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/admin/auth", () => ({ requireAdmin: h.requireAdmin, adminEmails: () => [] }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: h.logError }));

import { GET as connect } from "@/app/api/admin/google-calendar/connect/route";
import { GET as callback } from "@/app/api/admin/google-calendar/callback/route";
import { decrypt, encrypt } from "@/lib/crypto";
import { codeChallenge } from "@/lib/canva/pkce";
import { CONNECTION_KEY, disconnectGoogleCalendar, googleCalendarStatus, resetGoogleCalendarCache, saveGoogleConnection, setGoogleCalendarId } from "@/lib/google-calendar/calendar";
import { EVENTS_SCOPE, FREEBUSY_SCOPE, idTokenEmail, openGoogleState, sealGoogleState, STATE_COOKIE } from "@/lib/google-calendar/oauth";
import { consoleContext } from "@/lib/admin/types";

const SITE = "https://bupulse.test";
const ADMIN = "11111111-1111-4111-8111-111111111111";
let google: ReturnType<typeof googleFake>;

beforeEach(() => {
  h.db = createFakeDb();
  h.requireAdmin.mockReset().mockResolvedValue({ id: ADMIN, email: "admin@bupulse.com" });
  h.logError.mockClear();
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "client-id.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "client-secret");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
  google = googleFake();
  vi.stubGlobal("fetch", google.fetch);
  resetGoogleCalendarCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const location = (r: Response) => new URL(r.headers.get("location")!);

async function callbackWith(query: string, state: { state: string; verifier?: string; adminId?: string; now?: number } | null) {
  const headers: Record<string, string> = {};
  if (state) {
    const sealed = await sealGoogleState({ state: state.state, verifier: state.verifier ?? "v".repeat(43), adminId: state.adminId ?? ADMIN }, state.now);
    headers.cookie = `${STATE_COOKIE}=${encodeURIComponent(sealed)}`;
  }
  return callback(new NextRequest(`${SITE}/api/admin/google-calendar/callback${query}`, { headers }));
}

describe("connect", () => {
  it("sends the admin to Google with PKCE (S256), offline access, consent and both calendar scopes; the state cookie is sealed and httpOnly", async () => {
    const response = await connect();
    const url = location(response);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "client-id.apps.googleusercontent.com",
      redirect_uri: `${SITE}/api/admin/google-calendar/callback`,
      access_type: "offline",
      prompt: "consent",
      code_challenge_method: "S256",
    });
    expect(url.searchParams.get("scope")!.split(" ")).toEqual(["openid", "email", EVENTS_SCOPE, FREEBUSY_SCOPE]);
    const setCookie = response.headers.get("set-cookie")!;
    expect(setCookie).toContain(`${STATE_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie).toContain("Path=/api/admin/google-calendar");
    // The cookie holds the same state and the verifier behind the challenge; the browser cannot read either.
    const sealed = decodeURIComponent(/bp_gcal_oauth=([^;]+)/.exec(setCookie)![1]);
    expect(sealed).not.toContain(url.searchParams.get("state")!);
    const opened = await openGoogleState(sealed, ADMIN);
    expect(opened.ok && opened.data.state).toBe(url.searchParams.get("state"));
    expect(opened.ok && (await codeChallenge(opened.data.verifier))).toBe(url.searchParams.get("code_challenge"));
  });

  it("needs the admin gate first, and shows the setup steps when the client is not configured", async () => {
    h.requireAdmin.mockRejectedValueOnce(new Error("NEXT_NOT_FOUND"));
    await expect(connect()).rejects.toThrow("NEXT_NOT_FOUND");
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "");
    const url = location(await connect());
    expect(url.pathname).toBe("/admin/settings");
    expect(url.searchParams.get("error")).toMatch(/GOOGLE_CALENDAR_CLIENT_ID/);
    expect(google.calls).toHaveLength(0);
  });

  it("opens the state only for the same admin and within 10 minutes", async () => {
    const sealed = await sealGoogleState({ state: "s", verifier: "v".repeat(43), adminId: ADMIN }, 0);
    expect((await openGoogleState(sealed, "someone-else", 1000)).ok).toBe(false);
    expect(await openGoogleState(sealed, ADMIN, 11 * 60 * 1000)).toEqual({ ok: false, reason: "expired" });
    expect(await openGoogleState("v1:1:forged:payload", ADMIN)).toEqual({ ok: false, reason: "invalid" });
    expect(await openGoogleState(undefined, ADMIN)).toEqual({ ok: false, reason: "missing" });
  });
});

describe("callback", () => {
  it("refuses a missing, mismatched, expired or another admin's state without calling Google", async () => {
    for (const [query, state, message] of [
      ["?state=abc&code=c", null, /could not be matched/],
      ["?state=other&code=c", { state: "abc" }, /could not be matched/],
      ["?state=abc&code=c", { state: "abc", adminId: "22222222-2222-4222-8222-222222222222" }, /could not be matched/],
      ["?state=abc&code=c", { state: "abc", now: Date.now() - 11 * 60 * 1000 }, /took too long/],
      ["?state=abc&error=access_denied", { state: "abc" }, /declined/],
    ] as const) {
      const url = location(await callbackWith(query, state));
      expect(url.searchParams.get("error")).toMatch(message);
    }
    expect(google.calls).toHaveLength(0);
    expect(h.db.adminSetting.rows).toHaveLength(0);
  });

  it("swaps the code with the PKCE verifier, stores the refresh token encrypted and audits the connection without it", async () => {
    google.on("POST https://oauth2.googleapis.com/token", () => ({
      json: { access_token: "ya29.first", refresh_token: "1//refresh-secret", expires_in: 3599, scope: `openid ${EVENTS_SCOPE} ${FREEBUSY_SCOPE} https://www.googleapis.com/auth/userinfo.email`, id_token: idToken({ email: "Demos@BuPulse.com" }) },
    }));
    const response = await callbackWith("?state=abc&code=4/0Acode", { state: "abc", verifier: "x".repeat(43) });
    const url = location(response);
    expect(url.pathname).toBe("/admin/settings");
    expect(url.hash).toBe("#google-calendar");
    expect(url.searchParams.get("notice")).toMatch(/connected \(demos@bupulse.com\)/);
    expect(response.headers.get("set-cookie")).toMatch(/bp_gcal_oauth=;.*Path=\/api\/admin\/google-calendar/);

    const [exchange] = google.to("POST https://oauth2.googleapis.com/token");
    expect(exchange.body).toEqual({ grant_type: "authorization_code", code: "4/0Acode", code_verifier: "x".repeat(43), client_id: "client-id.apps.googleusercontent.com", client_secret: "client-secret", redirect_uri: `${SITE}/api/admin/google-calendar/callback` });

    const row = h.db.adminSetting.rows.find((r) => r.key === CONNECTION_KEY)!;
    expect(row.value).toMatchObject({ email: "demos@bupulse.com", calendarId: "primary" });
    expect(row.value.refreshToken).toMatch(/^v1:1:/);
    expect(JSON.stringify(row.value)).not.toContain("refresh-secret");
    expect(await decrypt(row.value.refreshToken)).toBe("1//refresh-secret");

    expect(h.db.auditLog.rows).toHaveLength(1);
    expect(h.db.auditLog.rows[0]).toMatchObject({ actor: "admin", action: "connect_google_calendar", target: `setting:${CONNECTION_KEY}` });
    expect(JSON.stringify(h.db.auditLog.rows[0])).not.toMatch(/refresh-secret|ya29/);
    expect(await googleCalendarStatus()).toMatchObject({ configured: true, connected: true, email: "demos@bupulse.com", calendarId: "primary" });
  });

  it("refuses a login without both calendar scopes, or without a refresh token, and stores nothing", async () => {
    google.on("POST https://oauth2.googleapis.com/token", () => ({ json: { access_token: "a", refresh_token: "r", scope: `openid ${EVENTS_SCOPE}` } }));
    expect(location(await callbackWith("?state=abc&code=c", { state: "abc" })).searchParams.get("error")).toMatch(/tick both calendar permissions/);
    google.on("POST https://oauth2.googleapis.com/token", () => ({ json: { access_token: "a", scope: `${EVENTS_SCOPE} ${FREEBUSY_SCOPE}` } }));
    expect(location(await callbackWith("?state=abc&code=c", { state: "abc" })).searchParams.get("error")).toMatch(/no refresh token/);
    google.on("POST https://oauth2.googleapis.com/token", () => ({ status: 400, json: { error: "invalid_grant" } }));
    expect(location(await callbackWith("?state=abc&code=c", { state: "abc" })).searchParams.get("error")).toMatch(/could not be connected/);
    expect(h.logError).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: "google-calendar.callback" }));
    expect(h.db.adminSetting.rows).toHaveLength(0);
    expect(h.db.auditLog.rows).toHaveLength(0);
  });

  it("reads the account email from the id_token, and nothing from a broken one", () => {
    expect(idTokenEmail(idToken({ email: "A@B.com" }))).toBe("a@b.com");
    expect(idTokenEmail("not-a-jwt")).toBeNull();
    expect(idTokenEmail(undefined)).toBeNull();
  });
});

describe("disconnect and calendar choice", () => {
  async function connected(calendarId = "primary") {
    h.db.adminSetting.rows.push({ key: CONNECTION_KEY, value: { refreshToken: await encrypt("1//refresh-secret"), email: "demos@bupulse.com", calendarId, scopes: [EVENTS_SCOPE, FREEBUSY_SCOPE], connectedAt: "2026-10-12T06:00:00.000Z" } });
  }

  it("revokes the refresh token at Google, forgets the connection and audits it", async () => {
    await connected();
    expect(await disconnectGoogleCalendar(consoleContext("203.0.113.1"))).toEqual({ email: "demos@bupulse.com", revoked: true });
    expect(google.to("POST https://oauth2.googleapis.com/revoke")[0].body).toEqual({ token: "1//refresh-secret" });
    expect(h.db.adminSetting.rows).toHaveLength(0);
    expect(h.db.auditLog.rows[0]).toMatchObject({ action: "disconnect_google_calendar", ip: "203.0.113.1", after: { revoked: true } });
    expect((await googleCalendarStatus()).connected).toBe(false);
  });

  it("still forgets the connection when Google does not answer the revoke", async () => {
    await connected();
    google.on("POST https://oauth2.googleapis.com/revoke", () => ({ status: 503 }));
    expect((await disconnectGoogleCalendar(consoleContext())).revoked).toBe(false);
    expect(h.db.adminSetting.rows).toHaveLength(0);
  });

  it("changes the calendar, audited, and refuses ids that are not one", async () => {
    await connected();
    expect(await setGoogleCalendarId(consoleContext(), "team@group.calendar.google.com")).toEqual({ calendarId: "team@group.calendar.google.com", changed: true });
    expect(h.db.auditLog.rows[0]).toMatchObject({ action: "update_setting", before: { calendarId: "primary" }, after: { calendarId: "team@group.calendar.google.com" } });
    await expect(setGoogleCalendarId(consoleContext(), "a b")).rejects.toThrow(/calendar id/);
    await expect(setGoogleCalendarId(consoleContext(), "../x")).rejects.toThrow(/calendar id/);
  });

  it("keeps the chosen calendar when the same account reconnects, and goes back to primary for another account", async () => {
    await connected("team@group.calendar.google.com");
    const grant = (email: string) => ({ refreshToken: "1//r", accessToken: "a", expiresAt: Date.now() + 3_600_000, scopes: [EVENTS_SCOPE, FREEBUSY_SCOPE], email });
    expect(await saveGoogleConnection(consoleContext(), grant("demos@bupulse.com"))).toEqual({ email: "demos@bupulse.com", calendarId: "team@group.calendar.google.com", accountChanged: false });
    expect(await saveGoogleConnection(consoleContext(), grant("owner@bupulse.com"))).toEqual({ email: "owner@bupulse.com", calendarId: "primary", accountChanged: true });
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ action: "connect_google_calendar", before: { email: "demos@bupulse.com" }, after: { calendarId: "primary", accountChanged: true } });
    expect((await googleCalendarStatus()).needsReconnect).toBe(false);
  });
});

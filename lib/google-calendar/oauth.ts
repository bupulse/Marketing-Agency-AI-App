import { decrypt, encrypt } from "@/lib/crypto";
import { siteUrl } from "@/lib/auth/site-url";
import { codeChallenge, newCodeVerifier, randomToken, sameString } from "@/lib/canva/pkce";

// Connecting the owner's Google Calendar (Admin -> Settings): OAuth 2.0 for a web server app, with PKCE and a sealed
// state cookie like the social and Canva flows. Only the refresh token is kept (encrypted, lib/google-calendar/store.ts);
// access tokens are fetched from it when needed. Setup: docs/GOOGLE_CALENDAR.md.

export { codeChallenge, newCodeVerifier, sameString };

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
/**
 * calendar.events creates, moves and deletes the demo events; calendar.freebusy reads busy times without event
 * details. "openid email" only names the connected account (the id_token's email), shown in Settings.
 */
export const GOOGLE_CALENDAR_SCOPES = ["openid", "email", EVENTS_SCOPE, FREEBUSY_SCOPE];

export const STATE_COOKIE = "bp_gcal_oauth";
export const STATE_COOKIE_PATH = "/api/admin/google-calendar";
const STATE_TTL_MS = 10 * 60 * 1000;

export type GoogleCalendarConfig = { clientId: string; clientSecret: string; redirectUri: string };

/** The OAuth client from the environment, or null when it is not set up (Settings then shows the setup steps). */
export function googleCalendarConfig(): GoogleCalendarConfig | null {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: `${siteUrl()}/api/admin/google-calendar/callback` };
}

/** Admin -> Settings, at the Google Calendar panel, with a notice or an error to show. */
export function googleSettingsUrl(key: "notice" | "error", message: string): URL {
  const url = new URL("/admin/settings", siteUrl());
  url.searchParams.set(key, message);
  url.hash = "google-calendar";
  return url;
}

export type GoogleOAuthState = { state: string; verifier: string; adminId: string; expiresAt: number };

export const newState = () => randomToken(24);

/** The pending login, sealed with AES-GCM (the browser can neither read the verifier nor forge or reuse it for another admin). */
export async function sealGoogleState(data: Omit<GoogleOAuthState, "expiresAt">, now = Date.now()): Promise<string> {
  return encrypt(JSON.stringify({ ...data, expiresAt: now + STATE_TTL_MS } satisfies GoogleOAuthState));
}

export type GoogleStateResult = { ok: true; data: GoogleOAuthState } | { ok: false; reason: "missing" | "expired" | "invalid" };

export async function openGoogleState(sealed: string | undefined, adminId: string, now = Date.now()): Promise<GoogleStateResult> {
  if (!sealed) return { ok: false, reason: "missing" };
  try {
    const data = JSON.parse(await decrypt(sealed)) as GoogleOAuthState;
    if (typeof data.state !== "string" || typeof data.verifier !== "string" || data.adminId !== adminId) return { ok: false, reason: "invalid" };
    if (typeof data.expiresAt !== "number" || data.expiresAt < now) return { ok: false, reason: "expired" };
    return { ok: true, data };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/** Google's consent page. access_type=offline and prompt=consent so Google always returns a refresh token. */
export async function googleAuthorizeUrl(config: GoogleCalendarConfig, state: string, verifier: string, loginHint?: string): Promise<string> {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
    code_challenge: await codeChallenge(verifier),
    code_challenge_method: "S256",
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return url.toString();
}

export class GoogleOAuthError extends Error {
  constructor(
    public code: "exchange" | "no_refresh_token" | "scopes" | "invalid_grant" | "refresh",
    message: string,
  ) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string; error?: string; error_description?: string };

async function postForm(url: string, body: Record<string, string>, timeoutMs = 10_000): Promise<{ status: number; json: TokenResponse }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  return { status: res.status, json };
}

/**
 * The email in an id_token. The token comes straight from Google's token endpoint over TLS, so its signature need not be
 * checked here (OpenID Connect Core 3.1.3.7); it only labels the connection in Settings.
 */
export function idTokenEmail(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { email?: unknown };
    return typeof json.email === "string" ? json.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

export type GoogleGrant = { refreshToken: string; accessToken: string; expiresAt: number; scopes: string[]; email: string | null };

/** Swaps the authorization code (with the PKCE verifier) for tokens. Both calendar scopes must have been granted. */
export async function exchangeGoogleCode(config: GoogleCalendarConfig, code: string, verifier: string, now = Date.now()): Promise<GoogleGrant> {
  const { status, json } = await postForm(GOOGLE_TOKEN_URL, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
  });
  if (status !== 200 || !json.access_token) throw new GoogleOAuthError("exchange", `Google refused the code (${status}${json.error ? ` ${json.error}` : ""}).`);
  if (!json.refresh_token) throw new GoogleOAuthError("no_refresh_token", "Google sent no refresh token.");
  const scopes = (json.scope ?? "").split(/\s+/).filter(Boolean);
  // Google's consent page lets people untick scopes; without both the booking flow cannot work.
  if (!scopes.includes(EVENTS_SCOPE) || !scopes.includes(FREEBUSY_SCOPE)) throw new GoogleOAuthError("scopes", "Both calendar permissions are needed.");
  return { refreshToken: json.refresh_token, accessToken: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000, scopes, email: idTokenEmail(json.id_token) };
}

/** A fresh access token from the refresh token. invalid_grant means the owner revoked access (or it expired): reconnect. */
export async function refreshGoogleToken(config: GoogleCalendarConfig, refreshToken: string, now = Date.now(), timeoutMs = 10_000): Promise<{ accessToken: string; expiresAt: number }> {
  const { status, json } = await postForm(GOOGLE_TOKEN_URL, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret }, timeoutMs);
  if (json.error === "invalid_grant") throw new GoogleOAuthError("invalid_grant", "Google no longer accepts the saved login. Connect Google Calendar again.");
  if (status !== 200 || !json.access_token) throw new GoogleOAuthError("refresh", `Google token refresh failed (${status}).`);
  return { accessToken: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000 };
}

/** Revokes the refresh token (and every access token made from it). True when Google confirmed it. */
export async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const { status } = await postForm(GOOGLE_REVOKE_URL, { token });
    // 400 invalid_token: already revoked or expired, which is what we wanted.
    return status === 200 || status === 400;
  } catch {
    return false;
  }
}

import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { safeNext } from "./safe-next";

// Google sign-in through BuPulse's own address. Google's account chooser says "to continue to <the address Google
// returns to>". With Supabase's own Google flow that is <project>.supabase.co; here Google returns to
// <site>/auth/google, the server swaps the code for Google's ID token and hands it to Supabase (signInWithIdToken), so
// Google names bupulse.com, and "BuPulse" once Google has verified the brand.
//
// Needs GOOGLE_SIGNIN_CLIENT_ID and GOOGLE_SIGNIN_CLIENT_SECRET: the same Google OAuth client as the Google provider
// in Supabase (Authentication -> Sign In / Providers), so Supabase accepts its ID tokens, with <site>/auth/google added
// to the client's authorised redirect URIs. Either can be saved in Admin -> Services as a custom key. Without both,
// signInWithGoogle keeps Supabase's flow (/auth/callback).

export const GOOGLE_COOKIE = "bp_google";
const COOKIE_MAX_AGE_S = 10 * 60;
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const VISIT = /^[A-Za-z0-9_-]{8,40}$/;

/** What the sign-in start keeps for the return: the state Google must echo, the raw nonce, where to go after. */
export type GoogleStart = { state: string; nonce: string; next: string; vs?: string };

function credentials() {
  const id = process.env.GOOGLE_SIGNIN_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_SIGNIN_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

/** True when sign-in goes through /auth/google. Read after createClient(), which loads keys saved in Admin. */
export function googleSignInConfigured(): boolean {
  return credentials() !== null;
}

export const googleRedirectUri = (origin: string) => `${origin}/auth/google`;

export function googleCookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/auth/google", maxAge: COOKIE_MAX_AGE_S };
}

/** Google's sign-in address and the cookie value that proves the return belongs to this browser. */
export function startGoogleSignIn(origin: string, next: string, visit: string): { url: string; cookie: string } {
  const client = credentials();
  if (!client) throw new Error("Google sign-in is not configured.");
  const start: GoogleStart = {
    state: randomBytes(24).toString("base64url"),
    nonce: randomBytes(24).toString("base64url"),
    next: safeNext(next),
    ...(VISIT.test(visit) ? { vs: visit } : {}),
  };
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: client.id,
    redirect_uri: googleRedirectUri(origin),
    response_type: "code",
    scope: "openid email profile",
    state: start.state,
    // Google puts this in the ID token; Supabase checks it against the SHA-256 of the raw nonce kept in the cookie.
    nonce: createHash("sha256").update(start.nonce).digest("hex"),
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), cookie: Buffer.from(JSON.stringify(start)).toString("base64url") };
}

/** The cookie written by startGoogleSignIn, or null when it is missing or not ours. */
export function readGoogleStart(cookie: string | undefined): GoogleStart | null {
  if (!cookie) return null;
  try {
    const value = JSON.parse(Buffer.from(cookie, "base64url").toString("utf8")) as Partial<GoogleStart>;
    if (typeof value.state !== "string" || typeof value.nonce !== "string" || typeof value.next !== "string") return null;
    return { state: value.state, nonce: value.nonce, next: safeNext(value.next), ...(typeof value.vs === "string" && VISIT.test(value.vs) ? { vs: value.vs } : {}) };
  } catch {
    return null;
  }
}

/** Swaps Google's one-time code for the ID token, or null when Google refuses it. */
export async function googleIdToken(code: string, origin: string): Promise<string | null> {
  const client = credentials();
  if (!client) return null;
  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: client.id,
        client_secret: client.secret,
        redirect_uri: googleRedirectUri(origin),
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { id_token?: unknown };
    return typeof body.id_token === "string" ? body.id_token : null;
  } catch {
    return null;
  }
}

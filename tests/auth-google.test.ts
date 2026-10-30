import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { signInWithIdToken, signOut, ensureAccount, allowGoogleSignIn } = vi.hoisted(() => ({
  signInWithIdToken: vi.fn(),
  signOut: vi.fn(),
  ensureAccount: vi.fn(),
  allowGoogleSignIn: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithIdToken, signOut } }),
}));
vi.mock("@/lib/account", () => ({ ensureAccount, allowGoogleSignIn }));

import { GET } from "@/app/auth/google/route";
import { GOOGLE_COOKIE, googleSignInConfigured, readGoogleStart, startGoogleSignIn } from "@/lib/auth/google-signin";

const ORIGIN = "https://bupulse.test";
const fetchMock = vi.fn();

function begin(next = "/dashboard", visit = "") {
  const { url, cookie } = startGoogleSignIn(ORIGIN, next, visit);
  return { url: new URL(url), cookie, start: readGoogleStart(cookie)! };
}

async function back(query: string, cookie?: string) {
  const request = new NextRequest(`${ORIGIN}/auth/google${query}`, cookie ? { headers: { cookie: `${GOOGLE_COOKIE}=${cookie}` } } : {});
  const response = await GET(request);
  return { location: response.headers.get("location"), cleared: response.headers.get("set-cookie")?.includes(`${GOOGLE_COOKIE}=;`) ?? false };
}

describe("Google sign-in through /auth/google", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", ORIGIN);
    vi.stubEnv("GOOGLE_SIGNIN_CLIENT_ID", "client-1.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_SIGNIN_CLIENT_SECRET", "secret-1");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id_token: "id-token-1" }), { status: 200 }));
    signInWithIdToken.mockReset();
    signInWithIdToken.mockResolvedValue({ data: { user: { id: "u1", email: "ana@example.com" } }, error: null });
    signOut.mockReset();
    ensureAccount.mockReset();
    allowGoogleSignIn.mockReset();
    allowGoogleSignIn.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is off until both the client id and secret are set", () => {
    expect(googleSignInConfigured()).toBe(true);
    vi.stubEnv("GOOGLE_SIGNIN_CLIENT_SECRET", "");
    expect(googleSignInConfigured()).toBe(false);
  });

  it("sends Google back to the site's own address, with the hashed nonce", () => {
    const { url, start } = begin("/dashboard/settings", "visit_12345678");
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/auth/google`);
    expect(url.searchParams.get("client_id")).toBe("client-1.apps.googleusercontent.com");
    expect(url.searchParams.get("state")).toBe(start.state);
    expect(url.searchParams.get("nonce")).toBe(createHash("sha256").update(start.nonce).digest("hex"));
    expect(start).toMatchObject({ next: "/dashboard/settings", vs: "visit_12345678" });
  });

  it("keeps only a same-site next path and a well-formed visit id", () => {
    const { start } = begin("https://evil.com", "bad id!");
    expect(start.next).toBe("/dashboard");
    expect(start.vs).toBeUndefined();
  });

  it("signs in with Google's ID token and the raw nonce, then goes on", async () => {
    const { cookie, start } = begin("/dashboard/settings", "visit_12345678");
    const result = await back(`?code=abc&state=${start.state}`, cookie);
    expect(result.location).toBe(`${ORIGIN}/dashboard/settings`);
    expect(result.cleared).toBe(true);
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("redirect_uri")).toBe(`${ORIGIN}/auth/google`);
    expect(body.get("code")).toBe("abc");
    expect(signInWithIdToken).toHaveBeenCalledWith({ provider: "google", token: "id-token-1", nonce: start.nonce });
    expect(ensureAccount).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), { visitSession: "visit_12345678" });
  });

  it("refuses a return whose state does not match this browser's cookie", async () => {
    const { cookie } = begin();
    expect((await back("?code=abc&state=someone-else", cookie)).location).toBe(`${ORIGIN}/login?error=callback`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a return without the cookie", async () => {
    const { start } = begin();
    expect((await back(`?code=abc&state=${start.state}`)).location).toBe(`${ORIGIN}/login?error=callback`);
  });

  it("goes back to sign-in quietly when the person cancels on Google's page", async () => {
    const { cookie } = begin();
    expect((await back("?error=access_denied", cookie)).location).toBe(`${ORIGIN}/login`);
  });

  it("returns to login when Google refuses the code", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 400 }));
    const { cookie, start } = begin();
    expect((await back(`?code=bad&state=${start.state}`, cookie)).location).toBe(`${ORIGIN}/login?error=callback`);
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  it("returns to login when Supabase refuses the token", async () => {
    signInWithIdToken.mockResolvedValue({ data: { user: null }, error: new Error("bad token") });
    const { cookie, start } = begin();
    expect((await back(`?code=abc&state=${start.state}`, cookie)).location).toBe(`${ORIGIN}/login?error=callback`);
  });

  it("refuses Google for an account created with a password", async () => {
    allowGoogleSignIn.mockResolvedValue(false);
    const { cookie, start } = begin();
    expect((await back(`?code=abc&state=${start.state}`, cookie)).location).toBe(`${ORIGIN}/login?error=use_password&email=ana%40example.com`);
    expect(signOut).toHaveBeenCalled();
    expect(ensureAccount).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import { SESSION_COOKIE, SESSION_SECONDS, clearSessionCookieHeader, clientSession, safeStudioNext, sessionCookieHeader, sessionSecret, signInUrl, signSession, verifySession } from "@/video-lab/session";
import { redeemTicket, setTicketRedeemer } from "@/video-lab/tickets";

const SECRET = "s".repeat(40);
const id = { userId: "u-1", businessId: "b-1", companyUserId: "u-0", role: "MEMBER" };
const T0 = Date.UTC(2026, 9, 19, 10, 0, 0);

describe("studio client session cookie", () => {
  it("round-trips an identity and lasts 12 hours", () => {
    const v = verifySession(signSession(id, SECRET, T0), SECRET, T0 + 1000);
    expect(v).toMatchObject(id);
    expect(SESSION_SECONDS).toBe(43200);
    expect(verifySession(signSession(id, SECRET, T0), SECRET, T0 + 43199_000)).not.toBeNull();
    expect(verifySession(signSession(id, SECRET, T0), SECRET, T0 + 43201_000)).toBeNull();
  });

  it("refuses a forged, edited, other-secret, malformed or empty cookie", () => {
    const token = signSession(id, SECRET, T0);
    const [body, mac] = token.split(".");
    const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), businessId: "b-2" })).toString("base64url");
    expect(verifySession(`${edited}.${mac}`, SECRET, T0)).toBeNull();
    expect(verifySession(token, "x".repeat(40), T0)).toBeNull();
    expect(verifySession(`${body}.`, SECRET, T0)).toBeNull();
    expect(verifySession("garbage", SECRET, T0)).toBeNull();
    expect(verifySession("", SECRET, T0)).toBeNull();
    expect(verifySession(token, null, T0)).toBeNull();
    expect(verifySession(null, SECRET, T0)).toBeNull();
  });

  it("refuses a cookie made for a time in the future", () => {
    expect(verifySession(signSession(id, SECRET, T0 + 3600_000), SECRET, T0)).toBeNull();
  });

  it("reads the session cookie by its own name only (not the owner's)", () => {
    const token = signSession(id, SECRET, T0);
    expect(clientSession({ cookie: `bp_studio=${token}` }, SECRET, T0)).toBeNull();
    expect(clientSession({ cookie: `a=1; ${SESSION_COOKIE}=${encodeURIComponent(token)}` }, SECRET, T0)?.businessId).toBe("b-1");
  });

  it("sets the cookie httpOnly and Lax, Secure over https, and clears it", () => {
    const set = sessionCookieHeader("t", { "x-forwarded-proto": "https" });
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("; Secure");
    expect(set).toContain("Max-Age=43200");
    expect(sessionCookieHeader("t", {})).not.toContain("Secure");
    expect(clearSessionCookieHeader({})).toContain("Max-Age=0");
  });

  it("needs a secret of 32 or more characters", () => {
    expect(sessionSecret({ STUDIO_SESSION_SECRET: SECRET })).toBe(SECRET);
    expect(sessionSecret({ STUDIO_SESSION_SECRET: "short" })).toBeNull();
    expect(sessionSecret({})).toBeNull();
  });
});

describe("where a sign-in may send the client", () => {
  const page = (first: string) => ["create", "showcase", "app", "videos"].includes(first);
  const next = (x: unknown) => safeStudioNext(x, page);
  it("keeps studio pages with their query and hash", () => {
    expect(next("/create")).toBe("/create");
    expect(next("/app/video/motion?prompt=a%20b#x")).toBe("/app/video/motion?prompt=a%20b#x");
    expect(next("/showcase#abc")).toBe("/showcase#abc");
  });
  it("falls back to /create for anything else", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "/\\/evil", "/create/../..//x\\", "/create\n/x", "/create x", "/nope", "/", "", null, undefined, 5, "/login", "/logout", "/auth/bupulse", "/" + "a".repeat(400), "/create\u0000"]) expect(next(bad)).toBe("/create");
  });
  it("builds BuPulse's sign-in link with the path encoded", () => {
    expect(signInUrl("https://bupulse.com/", "/app/video/motion?x=1")).toBe("https://bupulse.com/dashboard/video/open?next=%2Fapp%2Fvideo%2Fmotion%3Fx%3D1");
  });
});

describe("tickets", () => {
  it("uses the redeemer it is given (the real one when ticket.ts lands) and the test tickets stay off without the switch", async () => {
    expect(await redeemTicket("dev-b-1")).toBeNull();
    setTicketRedeemer(async (t) => (t === "good-ticket" ? id : null));
    expect(await redeemTicket("good-ticket")).toEqual(id);
    expect(await redeemTicket("used-ticket")).toBeNull();
  });
});

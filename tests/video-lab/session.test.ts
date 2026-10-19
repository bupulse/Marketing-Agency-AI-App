import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, SESSION_SECONDS, clearSessionCookieHeader, clientSession, safeStudioNext, sessionCookieHeader, sessionSecret, signSession, verifySession } from "@/video-lab/session";
import { BLOCK_MESSAGE, blockFor, redeemTicket, setTicketRedeemer } from "@/video-lab/tickets";

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
});

const ticket = vi.hoisted(() => ({ redeemStudioTicket: vi.fn(), studioBlock: vi.fn() }));
vi.mock("@/lib/video-studio/ticket", () => ticket);

describe("tickets", () => {
  const HEX = "a".repeat(64);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("hands a real ticket to redeemStudioTicket and a used or made-up one gets nothing", async () => {
    ticket.redeemStudioTicket.mockImplementation(async (t: string) => (t === HEX ? id : null));
    expect(await redeemTicket(HEX)).toEqual(id);
    expect(await redeemTicket("b".repeat(64))).toBeNull();
    expect(ticket.redeemStudioTicket).toHaveBeenCalledTimes(2);
  });

  it("never treats a dev- ticket as real, and the test tickets stay off without the switch", async () => {
    expect(await redeemTicket("dev-b-1")).toBeNull();
    expect(ticket.redeemStudioTicket).not.toHaveBeenCalled();
    vi.stubEnv("STUDIO_ENV", "production");
    vi.stubEnv("STUDIO_DEV_TICKETS", "1");
    expect(await redeemTicket("dev-b-1")).toBeNull();
  });

  it("uses a fake redeemer when a test sets one", async () => {
    setTicketRedeemer(async (t) => (t === "good-ticket" ? id : null));
    expect(await redeemTicket("good-ticket")).toEqual(id);
    expect(await redeemTicket("used-ticket")).toBeNull();
  });
});

describe("when the studio is closed to a person", () => {
  const who = { ...id, companyUserId: "company-1" };
  it("asks studioBlock, remembers the answer for 30 seconds, and says why in plain English", async () => {
    ticket.studioBlock.mockResolvedValue("plan");
    expect(await blockFor(who, 1_000)).toBe("plan");
    ticket.studioBlock.mockResolvedValue(null);
    expect(await blockFor(who, 20_000)).toBe("plan");
    expect(await blockFor(who, 31_001)).toBeNull();
    expect(ticket.studioBlock).toHaveBeenCalledTimes(2);
    expect(ticket.studioBlock).toHaveBeenCalledWith({ role: "MEMBER", companyUserId: "company-1" });
    expect(BLOCK_MESSAGE.off).toContain("switched off");
    expect(BLOCK_MESSAGE.permission).toContain("company owner");
    expect(BLOCK_MESSAGE.plan).toContain("video credits");
  });

  it("is not asked for test tickets", async () => {
    vi.stubEnv("STUDIO_DEV_TICKETS", "1");
    vi.stubEnv("STUDIO_ENV", "");
    expect(await blockFor({ ...who, companyUserId: "company-2" })).toBeNull();
    expect(ticket.studioBlock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

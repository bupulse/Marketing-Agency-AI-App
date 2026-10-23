import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  prisma: {
    supportAgent: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  },
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: m.rateLimit,
  RateLimitError: class RateLimitError extends Error { constructor(public retryAfterSeconds: number) { super("rl"); } },
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

import { jwtClaims, requireSupportAgent, type VerifiedToken } from "@/lib/support/agent-auth";
import { canSee } from "@/lib/support/agent-inbox";
import { SupportError } from "@/lib/support/http";
import { RateLimitError } from "@/lib/rate-limit";

vi.mock("@/lib/support/ai", () => ({}));
vi.mock("@/lib/support/answer", () => ({ historyFor: vi.fn() }));
vi.mock("@/lib/support/facts", () => ({}));
vi.mock("@/lib/support/guide", () => ({}));
vi.mock("@/lib/support/realtime", () => ({ broadcast: vi.fn() }));
vi.mock("@/lib/support/views", () => ({}));
vi.mock("@/lib/support/emails", () => ({ JOB_REPLY_EMAIL: "support.reply_email" }));
vi.mock("@/lib/support/stats", () => ({}));
vi.mock("@/lib/jobs/due", () => ({ scheduleJob: vi.fn(), registerJobHandler: vi.fn() }));

const TOKEN = "header.payload.signature-long-enough";
const req = (auth?: string) => new Request("https://bupulse.com/api/support/v1/agent/me", { headers: auth ? { authorization: auth } : {} });
const PASSWORD_AND_CODE = [{ method: "password", timestamp: 1 }, { method: "totp", timestamp: 2 }];
const token = (over: Partial<VerifiedToken> = {}): VerifiedToken => ({
  userId: "11111111-1111-1111-1111-111111111111", email: "agent@example.com", emailConfirmed: true,
  aal: { currentLevel: "aal2", nextLevel: "aal2" }, methods: PASSWORD_AND_CODE, hasVerifiedTotp: true, ...over,
});
const verifyWith = (t: VerifiedToken | null) => vi.fn().mockResolvedValue(t);
const agentRow = (over: Record<string, unknown> = {}) => ({
  id: "a1", userId: "11111111-1111-1111-1111-111111111111", name: "Jean Mugisha", email: "agent@example.com", role: "AGENT", status: "active", availability: "online", maxChats: 5, lockedAt: null, lastSeenAt: new Date(),
  departments: [{ department: { id: "d1", key: "technical" } }],
  ...over,
});

async function error(p: Promise<unknown>): Promise<SupportError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof SupportError) return e;
    throw e;
  }
  throw new Error("expected a SupportError");
}

beforeEach(() => {
  vi.clearAllMocks();
  m.rateLimit.mockResolvedValue(undefined);
  m.prisma.supportAgent.findFirst.mockReset().mockResolvedValue(agentRow());
  m.prisma.supportAgent.findUnique.mockReset().mockResolvedValue(agentRow());
  m.prisma.supportAgent.updateMany.mockResolvedValue({ count: 1 });
  m.prisma.supportAgent.update.mockResolvedValue({});
});

const call = (t: VerifiedToken | null = token()) => requireSupportAgent(req(`Bearer ${TOKEN}`), verifyWith(t));

describe("requireSupportAgent", () => {
  it("needs a Bearer token", async () => {
    for (const auth of [undefined, "Basic abc", "Bearer short", `Token ${TOKEN}`]) {
      const e = await error(requireSupportAgent(req(auth), verifyWith(token())));
      expect([e.status, e.code]).toEqual([401, "unauthorized"]);
    }
  });

  it("a token Supabase does not accept (expired, revoked, forged) is 401", async () => {
    expect([(await error(call(null))).status, (await error(call(null))).code]).toEqual([401, "unauthorized"]);
    const thrown = await error(requireSupportAgent(req(`Bearer ${TOKEN}`), vi.fn().mockRejectedValue(new Error("network"))));
    expect(thrown.status).toBe(401);
  });

  it("aal1 (no authenticator code yet) is refused before any database read", async () => {
    const e = await error(call(token({ aal: { currentLevel: "aal1", nextLevel: "aal2" } })));
    expect([e.status, e.code]).toEqual([403, "mfa_required"]);
    expect((await error(call(token({ aal: { currentLevel: null, nextLevel: null } })))).code).toBe("mfa_required");
    expect(m.prisma.supportAgent.findFirst).not.toHaveBeenCalled();
  });

  it("aal2 without a verified authenticator app is refused (the shared app rules)", async () => {
    expect((await error(call(token({ hasVerifiedTotp: false })))).code).toBe("mfa_required");
  });

  it("an account that is no agent is refused", async () => {
    m.prisma.supportAgent.findFirst.mockResolvedValue(null);
    const e = await error(call());
    expect([e.status, e.code]).toEqual([403, "not_agent"]);
  });

  it("a locked agent is refused (status locked or lockedAt set)", async () => {
    m.prisma.supportAgent.findFirst.mockResolvedValue(agentRow({ status: "locked", lockedAt: new Date() }));
    expect((await error(call())).code).toBe("locked");
    m.prisma.supportAgent.findFirst.mockResolvedValue(agentRow({ status: "active", lockedAt: new Date() }));
    const e = await error(call());
    expect([e.status, e.code]).toEqual([403, "locked"]);
  });

  it("an invited agent's first full sign-in links the account and activates them", async () => {
    m.prisma.supportAgent.findFirst.mockResolvedValue(agentRow({ userId: null, status: "invited" }));
    m.prisma.supportAgent.findUnique.mockResolvedValue(agentRow());
    const agent = await call();
    expect(m.prisma.supportAgent.findFirst.mock.calls[0][0].where).toEqual({ OR: [{ userId: token().userId }, { email: "agent@example.com", userId: null }] });
    expect(m.prisma.supportAgent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "a1" }), data: { userId: token().userId, status: "active" } }));
    expect(agent.id).toBe("a1");
  });

  it("an unconfirmed email never links to an invited agent", async () => {
    m.prisma.supportAgent.findFirst.mockResolvedValue(agentRow({ userId: null, status: "invited" }));
    const e = await error(call(token({ emailConfirmed: false })));
    expect(e.code).toBe("not_agent");
    expect(m.prisma.supportAgent.updateMany).not.toHaveBeenCalled();
  });

  it("a row linked to another sign-in is not taken over", async () => {
    m.prisma.supportAgent.findFirst.mockResolvedValue(agentRow({ userId: "someone-else" }));
    expect((await error(call())).code).toBe("not_agent");
    expect(m.prisma.supportAgent.updateMany).not.toHaveBeenCalled();
  });

  it("a sign-in by Google alone (no password or emailed code) is refused", async () => {
    expect((await error(call(token({ methods: [{ method: "oauth", timestamp: 1 }] })))).code).toBe("not_agent");
  });

  it("an active agent passes with their role and departments", async () => {
    const agent = await call();
    expect(agent).toMatchObject({ id: "a1", name: "Jean Mugisha", role: "AGENT", availability: "online", departments: [{ id: "d1", key: "technical" }] });
    expect(m.prisma.supportAgent.updateMany).not.toHaveBeenCalled();
    expect(m.rateLimit).toHaveBeenCalledWith("support:agent:a1", expect.objectContaining({ limit: expect.any(Number) }));
  });

  it("too many calls are a 429 with Retry-After", async () => {
    m.rateLimit.mockRejectedValue(new RateLimitError(30));
    const e = await error(call());
    expect([e.status, e.code]).toEqual([429, "rate_limited"]);
    expect(e.headers?.["retry-after"]).toBe("30");
  });
});

describe("jwtClaims", () => {
  const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  it("reads the payload of a JWT", () => {
    expect(jwtClaims(`x.${b64url({ aal: "aal2", sub: "u1" })}.y`)).toEqual({ aal: "aal2", sub: "u1" });
  });
  it("is null for garbage", () => {
    expect(jwtClaims("nothing")).toBeNull();
    expect(jwtClaims("a.%%%.c")).toBeNull();
  });
});

describe("canSee", () => {
  it("supervisors see every chat", () => {
    expect(canSee({ id: "a1", role: "SUPERVISOR" }, { assigneeId: "a2" })).toBe(true);
  });
  it("agents see unassigned chats and their own only", () => {
    expect(canSee({ id: "a1", role: "AGENT" }, { assigneeId: null })).toBe(true);
    expect(canSee({ id: "a1", role: "AGENT" }, { assigneeId: "a1" })).toBe(true);
    expect(canSee({ id: "a1", role: "AGENT" }, { assigneeId: "a2" })).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  process.env.ENCRYPTION_KEY ||= "test-encryption-key"; // topic secrets are derived from it
  return {
  prisma: {
    supportConversation: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    supportMessage: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    supportEvent: { create: vi.fn() },
    supportVisit: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  answer: vi.fn(),
  rateLimit: vi.fn(),
  broadcast: vi.fn(),
  scheduleJob: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: m.rateLimit,
  RateLimitError: class extends Error { constructor(public retryAfterSeconds: number) { super("rl"); } },
}));
vi.mock("@/lib/jobs/due", () => ({ scheduleJob: m.scheduleJob, registerJobHandler: vi.fn() }));
vi.mock("@/lib/widget/turnstile", () => ({ turnstileEnabled: () => false, needsChallenge: () => false, verifyTurnstile: vi.fn(), warnTurnstileOff: vi.fn() }));
vi.mock("@/lib/support/answer", () => ({ answerVisitor: m.answer, JOB_JUDGE: "support.judge" }));
vi.mock("@/lib/support/realtime", () => ({ broadcast: m.broadcast }));
vi.mock("@/lib/support/handover", () => ({ handOver: vi.fn(), handoverText: () => "A person will reply." }));
vi.mock("@/lib/support/emails", () => ({ scheduleTranscript: vi.fn() }));
vi.mock("@/lib/support/prechat", () => ({ noteLeadQuestion: vi.fn() }));
vi.mock("@/lib/support/jobs", () => ({ scheduleSweep: vi.fn() }));
vi.mock("@/lib/support/identity", () => ({ signedInPerson: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/support/settings", () => ({ getSupportSettings: vi.fn().mockResolvedValue({ hours: {} }), teamHours: () => ({ open: true }) }));
vi.mock("@/lib/support/views", () => ({
  conversationSelect: {},
  messageSelect: {},
  agentOf: () => null,
  toMessageViews: async (rows: { id: string }[]) => rows.map((r) => ({ id: r.id })),
  toConversationView: async (c: { id: string }, messages: { id: string }[]) => ({ id: c.id, messages }),
}));

import { endConversation, ownConversation, rateConversation, sendMessage, startConversation, visitorMessages } from "@/lib/support/conversations";
import { SupportError } from "@/lib/support/http";
import { RESUME_WINDOW_MS } from "@/lib/support/limits";
import { requireVisit, type VisitorSession } from "@/lib/support/visits";

const ctx = { ip: "1.1.1.1", ipHash: "h" };
const visitor = { id: "v1", name: "Test Visitor", email: "visitor@example.com", phone: null, businessName: "Sample Shop Ltd", userId: null, businessId: null, creatorProfileId: null, leadId: null };
const session = (over: Partial<VisitorSession> = {}, v: Partial<VisitorSession["visitor"]> = {}): VisitorSession => ({ visitId: "visit1", visitorId: "v1", surface: "public", country: "RW", ...over, visitor: { ...visitor, ...v } });
const conv = (over: Record<string, unknown> = {}) => ({ id: "c1", number: 1001, status: "AI", aiActive: true, rating: null, assignee: null, department: null, visitorId: "v1", lastVisitorMessageAt: null, visitor: { userId: null }, ...over });
const body = { text: "hello", clientMsgId: "client-msg-1" };

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
  m.prisma.supportConversation.findUnique.mockResolvedValue(conv());
  m.prisma.supportConversation.findUniqueOrThrow.mockResolvedValue(conv());
  m.prisma.supportConversation.findFirst.mockResolvedValue(null);
  m.prisma.supportConversation.update.mockResolvedValue({ status: "AI", aiActive: true });
  m.prisma.supportConversation.updateMany.mockResolvedValue({ count: 1 });
  m.prisma.supportMessage.findUnique.mockResolvedValue(null);
  m.prisma.supportMessage.findFirst.mockResolvedValue(null);
  m.prisma.supportMessage.findMany.mockResolvedValue([]);
  m.prisma.supportMessage.create.mockResolvedValue({ id: "m1" });
  m.prisma.supportMessage.count.mockResolvedValue(1);
  m.prisma.supportEvent.create.mockResolvedValue({});
  m.prisma.$transaction.mockResolvedValue([]);
  m.answer.mockResolvedValue(undefined);
});

describe("idempotent sends", () => {
  it("stores a new message once and lets the AI answer it", async () => {
    await sendMessage(session(), "c1", body, ctx);
    expect(m.prisma.supportMessage.create).toHaveBeenCalledTimes(1);
    expect(m.prisma.supportMessage.create.mock.calls[0][0].data).toMatchObject({ conversationId: "c1", author: "VISITOR", kind: "TEXT", body: "hello", clientMsgId: "client-msg-1" });
    expect(m.answer).toHaveBeenCalledWith("c1", ctx, expect.any(Date));
  });

  it("a retry with the same clientMsgId stores nothing and gets no second AI answer", async () => {
    m.prisma.supportMessage.findUnique.mockResolvedValue({ id: "m1" });
    const res = await sendMessage(session(), "c1", body, ctx);
    expect(m.prisma.supportMessage.create).not.toHaveBeenCalled();
    expect(m.answer).not.toHaveBeenCalled();
    expect(res.conversation.id).toBe("c1");
  });

  it("two sends racing (unique violation P2002) count as one", async () => {
    m.prisma.supportMessage.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(sendMessage(session(), "c1", body, ctx)).resolves.toBeTruthy();
    expect(m.answer).not.toHaveBeenCalled();
    expect(m.prisma.supportConversation.update).not.toHaveBeenCalled();
  });

  it("other database errors still fail", async () => {
    m.prisma.supportMessage.create.mockRejectedValue(new Error("db down"));
    await expect(sendMessage(session(), "c1", body, ctx)).rejects.toThrow("db down");
  });

  it("startConversation with a retried clientMsgId returns the existing chat and creates none", async () => {
    m.prisma.supportMessage.findFirst.mockResolvedValue({ conversationId: "c1" });
    const res = await startConversation(session(), body, ctx);
    expect(res.conversation.id).toBe("c1");
    expect(m.prisma.supportConversation.create).not.toHaveBeenCalled();
    expect(m.prisma.supportMessage.create).not.toHaveBeenCalled();
  });

  it("startConversation reuses the visitor's open chat instead of making a second", async () => {
    m.prisma.supportConversation.findFirst.mockResolvedValue({ id: "c1" });
    await startConversation(session(), body, ctx);
    expect(m.prisma.supportConversation.create).not.toHaveBeenCalled();
    expect(m.prisma.supportMessage.create.mock.calls[0][0].data.conversationId).toBe("c1");
  });

  it("startConversation makes a new chat when there is none", async () => {
    m.prisma.supportConversation.create.mockResolvedValue({});
    m.prisma.supportConversation.findUniqueOrThrow.mockImplementation(async ({ where }: { where: { id: string } }) => conv({ id: where.id }));
    const res = await startConversation(session(), body, ctx);
    expect(m.prisma.supportConversation.create).toHaveBeenCalledTimes(1);
    const data = m.prisma.supportConversation.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ visitorId: "v1", visitId: "visit1", surface: "public" });
    expect(data.topicTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.conversation.id).toBe(data.id);
  });
});

describe("pre-chat form rule", () => {
  it("public pages need a name and email first", async () => {
    const e = await error(startConversation(session({}, { name: null, email: null }), body, ctx));
    expect([e.status, e.code]).toEqual([403, "form_required"]);
    const bio = await error(startConversation(session({ surface: "bio" }, { email: null }), body, ctx));
    expect(bio.code).toBe("form_required");
    expect(m.prisma.supportMessage.create).not.toHaveBeenCalled();
  });

  it("signed-in people and the dashboard skip the form", async () => {
    await expect(startConversation(session({}, { name: null, email: null, userId: "u1" }), body, ctx)).resolves.toBeTruthy();
    await expect(startConversation(session({ surface: "dashboard" }, { name: null, email: null }), body, ctx)).resolves.toBeTruthy();
  });
});

describe("visitor ownership", () => {
  const other = () => m.prisma.supportConversation.findUnique.mockResolvedValue(conv({ visitorId: "someone-else", visitor: { userId: null } }));

  it("another visitor's chat answers 404, the same as a missing one", async () => {
    other();
    for (const call of [
      () => ownConversation(session(), "c1"),
      () => visitorMessages(session(), "c1", null),
      () => sendMessage(session(), "c1", body, ctx),
      () => rateConversation(session(), "c1", { score: 1 }),
      () => endConversation(session(), "c1"),
    ]) {
      const e = await error(call());
      expect([e.status, e.code]).toEqual([404, "not_found"]);
    }
    m.prisma.supportConversation.findUnique.mockResolvedValue(null);
    const missing = await error(ownConversation(session(), "nope"));
    expect([missing.status, missing.code, missing.message]).toEqual([404, "not_found", "This chat was not found."]);
    expect(m.prisma.supportMessage.create).not.toHaveBeenCalled();
    expect(m.prisma.supportConversation.update).not.toHaveBeenCalled();
  });

  it("nothing of another visitor's chat is read or marked seen", async () => {
    other();
    await error(visitorMessages(session(), "c1", null));
    expect(m.prisma.supportMessage.findMany).not.toHaveBeenCalled();
    expect(m.prisma.supportMessage.updateMany).not.toHaveBeenCalled();
  });

  it("a signed-in person reaches their own chat from another browser (same userId)", async () => {
    m.prisma.supportConversation.findUnique.mockResolvedValue(conv({ visitorId: "v-other-browser", visitor: { userId: "u1" } }));
    await expect(ownConversation(session({}, { userId: "u1" }), "c1")).resolves.toMatchObject({ id: "c1" });
  });

  it("a different signed-in person does not, and anonymous never matches a null userId", async () => {
    m.prisma.supportConversation.findUnique.mockResolvedValue(conv({ visitorId: "v-other-browser", visitor: { userId: "u2" } }));
    expect((await error(ownConversation(session({}, { userId: "u1" }), "c1"))).status).toBe(404);
    m.prisma.supportConversation.findUnique.mockResolvedValue(conv({ visitorId: "v-other-browser", visitor: { userId: null } }));
    expect((await error(ownConversation(session({}, { userId: null }), "c1"))).status).toBe(404);
  });

  it("visitorMessages marks only non-visitor messages as seen", async () => {
    m.prisma.supportMessage.findMany.mockResolvedValue([
      { id: "a", author: "AGENT", seenByVisitorAt: null },
      { id: "b", author: "VISITOR", seenByVisitorAt: null },
      { id: "c", author: "AI", seenByVisitorAt: new Date() },
    ]);
    await visitorMessages(session(), "c1", null);
    expect(m.prisma.supportMessage.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["a"] } }, data: { seenByVisitorAt: expect.any(Date) } });
    expect(m.prisma.supportMessage.findMany.mock.calls[0][0].where.kind).toEqual({ not: "NOTE" });
  });
});

describe("requireVisit", () => {
  const h = (token?: string) => new Headers(token ? { "x-support-visit": token } : {});

  it("needs the visit header", async () => {
    const e = await error(requireVisit(h()));
    expect([e.status, e.code]).toEqual([401, "visit_required"]);
    expect((await error(requireVisit(h("short")))).code).toBe("visit_required");
  });

  it("an unknown token has expired", async () => {
    m.prisma.supportVisit.findUnique.mockResolvedValue(null);
    const e = await error(requireVisit(h("x".repeat(43))));
    expect([e.status, e.code]).toEqual([401, "visit_expired"]);
  });

  it("a visit older than the resume window has expired; a recent one names the visitor", async () => {
    const row = { id: "visit1", visitorId: "v1", surface: "public", country: "RW", visitor };
    m.prisma.supportVisit.findUnique.mockResolvedValue({ ...row, lastSeenAt: new Date(Date.now() - RESUME_WINDOW_MS - 1000) });
    expect((await error(requireVisit(h("x".repeat(43))))).status).toBe(401);
    m.prisma.supportVisit.findUnique.mockResolvedValue({ ...row, lastSeenAt: new Date(Date.now() - 60_000) });
    await expect(requireVisit(h("x".repeat(43)))).resolves.toMatchObject({ visitId: "visit1", visitorId: "v1", surface: "public" });
    // Looked up by the token's SHA-256, never the token itself.
    expect(m.prisma.supportVisit.findUnique.mock.calls[0][0].where.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  prisma: {
    chatSession: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    chatMessage: { create: vi.fn(), findMany: vi.fn() },
    lead: { findUnique: vi.fn() },
    serviceSwitch: { findMany: vi.fn() },
  },
  rateLimit: vi.fn(),
  consumeUsage: vi.fn(),
  refundUsage: vi.fn(),
  createLead: vi.fn(),
  generate: vi.fn(),
  widget: vi.fn(),
  turnstile: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: m.rateLimit,
  RateLimitError: class extends Error { constructor(public retryAfterSeconds: number) { super("rl"); } },
}));
vi.mock("@/lib/usage", () => ({
  consumeUsage: m.consumeUsage,
  refundUsage: m.refundUsage,
  UsageLimitError: class extends Error { constructor(public reason: string) { super(reason); } },
}));
vi.mock("@/lib/leads/service", () => ({ createLeadFromChat: m.createLead }));
vi.mock("@/lib/widget/ai", () => ({ generateChatReply: m.generate }));
vi.mock("@/lib/widget/config", () => ({ loadPublicWidget: m.widget, loadProjectFacts: vi.fn().mockResolvedValue([]), loadFaqs: vi.fn().mockResolvedValue([]) }));
// The inbox is tested in tests/inbox; here the plan has no inbox, so the chat behaves as before.
vi.mock("@/lib/inbox/website", () => ({ ingestWebsiteMessage: vi.fn().mockResolvedValue(null), linkLeadToContact: vi.fn(), mirrorWebsiteReply: vi.fn(), websiteMessagesSince: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/widget/turnstile", async (orig) => ({ ...(await orig<typeof import("@/lib/widget/turnstile")>()), turnstileEnabled: m.turnstile, verifyTurnstile: vi.fn().mockResolvedValue(true) }));

import { handleChat, handleLead } from "@/lib/widget/chat";
import { RateLimitError } from "@/lib/rate-limit";
import { UsageLimitError } from "@/lib/usage";
import { clearSwitchCache } from "@/lib/admin/switch";

const widget = {
  businessId: "b1", userId: "u1", key: "KEY12345", enabled: true, name: "Glow", contentLanguage: "English",
  allowedDomains: ["shop.com"], facts: { name: "Glow", knowledge: { faqs: [] } },
};
const ctx = { ip: "1.1.1.1", ipHash: "h", originHeader: "https://bupulse.com", referer: null, ownHosts: ["bupulse.com"] };
const body = { key: "KEY12345", visitorId: "visitor-12345", message: "hello there", origin: "shop.com" };
const session = { id: "s1", businessId: "b1", visitorId: "visitor-12345", messageCount: 0, lastMessageAt: new Date(0), pageUrl: null, language: null };
const aiReply = { reply: "Hi!", wantsContact: false, language: "English", detected: {} };

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.serviceSwitch.findMany.mockResolvedValue([]);
  clearSwitchCache();
  m.widget.mockResolvedValue(widget);
  m.rateLimit.mockResolvedValue(undefined);
  m.consumeUsage.mockResolvedValue({ periodStart: new Date("2026-10-01") });
  m.generate.mockResolvedValue(aiReply);
  m.turnstile.mockReturnValue(false);
  m.prisma.chatSession.create.mockResolvedValue(session);
  m.prisma.chatMessage.create.mockResolvedValue({ id: "cm1" });
  m.prisma.chatSession.findFirst.mockResolvedValue(session);
  m.prisma.chatMessage.findMany.mockResolvedValue([{ role: "visitor", content: "hello there" }]);
  m.prisma.lead.findUnique.mockResolvedValue(null);
  m.createLead.mockResolvedValue({ id: "l1", created: true });
  m.refundUsage.mockResolvedValue(undefined);
  m.prisma.chatSession.updateMany.mockResolvedValue({ count: 1 });
  m.prisma.$queryRaw.mockResolvedValue([{ count: 2, previous: new Date(0) }]);
});

describe("handleChat", () => {
  it("rejects bad input, unknown keys and disabled widgets", async () => {
    expect((await handleChat({ ...body, message: "" }, ctx)).status).toBe(400);
    expect((await handleChat({ ...body, message: "x".repeat(1001) }, ctx)).status).toBe(400);
    m.widget.mockResolvedValueOnce(null);
    expect((await handleChat(body, ctx)).status).toBe(404);
    m.widget.mockResolvedValueOnce({ ...widget, enabled: false });
    expect((await handleChat(body, ctx)).status).toBe(404);
  });

  it("blocks sites that are not allowed and cross-site browser calls", async () => {
    expect((await handleChat({ ...body, origin: "evil.com" }, ctx)).status).toBe(403);
    expect((await handleChat(body, { ...ctx, originHeader: "https://evil.com" })).status).toBe(403);
    expect(m.generate).not.toHaveBeenCalled();
  });

  it("answers, charges one chat credit and saves both messages", async () => {
    const r = await handleChat(body, ctx);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sessionId: "s1", reply: "Hi!", askContact: false });
    expect(m.consumeUsage).toHaveBeenCalledWith("u1", "chat");
    expect(m.generate).toHaveBeenCalledOnce();
    expect(m.prisma.chatMessage.create.mock.calls.map((c) => c[0].data.role)).toEqual(["visitor", "assistant"]);
  });

  it("refunds the credit and asks for contact details when the AI fails", async () => {
    m.generate.mockRejectedValue(new Error("boom"));
    const r = await handleChat(body, ctx);
    expect(m.refundUsage).toHaveBeenCalledWith("u1", "chat", new Date("2026-10-01"));
    expect(r.body).toMatchObject({ askContact: true, limited: true });
  });

  it("AI switched off in the admin console: no AI call and no credit used, the visitor is asked for contact details", async () => {
    m.prisma.serviceSwitch.findMany.mockResolvedValue([{ service: "gemini" }]);
    clearSwitchCache();
    const result = await handleChat(body, ctx);
    expect(result.status).toBe(200);
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.consumeUsage).not.toHaveBeenCalled();
    expect(result.body.askContact).toBe(true);
    // switched back on: the AI answers again
    m.prisma.serviceSwitch.findMany.mockResolvedValue([]);
    clearSwitchCache();
    await handleChat(body, ctx);
    expect(m.generate).toHaveBeenCalledTimes(1);
  });

  it("the widget always uses Gemini: it follows the Gemini switch, not AI_TEXT_PROVIDER", async () => {
    const previous = process.env.AI_TEXT_PROVIDER;
    process.env.AI_TEXT_PROVIDER = "claude";
    try {
      m.prisma.serviceSwitch.findMany.mockResolvedValue([{ service: "claude" }]);
      clearSwitchCache();
      await handleChat(body, ctx);
      expect(m.generate).toHaveBeenCalledTimes(1); // Claude off does not stop the widget
      m.generate.mockClear();
      m.prisma.serviceSwitch.findMany.mockResolvedValue([{ service: "gemini" }]);
      clearSwitchCache();
      await handleChat(body, ctx);
      expect(m.generate).not.toHaveBeenCalled(); // Gemini off does
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, "AI_TEXT_PROVIDER");
      else process.env.AI_TEXT_PROVIDER = previous;
    }
  });

  it("over the limit: no AI call, friendly message, contact card", async () => {
    m.consumeUsage.mockRejectedValue(new UsageLimitError("limit_reached", "chat"));
    const r = await handleChat(body, ctx);
    expect(m.generate).not.toHaveBeenCalled();
    expect(r.body).toMatchObject({ reply: "Leave your details and the team will get back to you.", askContact: true, limited: true });
  });

  it("rate limits return 429 with Retry-After", async () => {
    m.rateLimit.mockRejectedValue(new RateLimitError(42));
    const r = await handleChat(body, ctx);
    expect(r.status).toBe(429);
    expect(r.headers?.["Retry-After"]).toBe("42");
    expect(m.generate).not.toHaveBeenCalled();
  });

  it("checks ip, business and visitor limits with separate keys", async () => {
    await handleChat(body, ctx);
    const keys = m.rateLimit.mock.calls.map((c) => c[0]);
    expect(keys).toEqual(["widget:ipall:h", "widget:ip:b1:h", "widget:visitor:b1:visitor-12345", "widget:biz:b1", "widget:aiday:b1:h"]);
  });

  it("requires Turnstile on a new session when enabled", async () => {
    m.turnstile.mockReturnValue(true);
    expect((await handleChat(body, ctx)).body).toMatchObject({ error: "challenge_required" });
    const ok = await handleChat({ ...body, turnstileToken: "t" }, ctx);
    expect(ok.status).toBe(200);
  });

  it("stops at the session message cap (the atomic claim returns nothing)", async () => {
    m.prisma.$queryRaw.mockResolvedValue([]);
    const r = await handleChat({ ...body, sessionId: "s1" }, ctx);
    expect(r.body).toMatchObject({ limited: true, askContact: true });
    expect(m.generate).not.toHaveBeenCalled();
  });

  it("H1: claims the message slot atomically and re-challenges on the claimed count", async () => {
    m.turnstile.mockReturnValue(true);
    m.prisma.$queryRaw.mockResolvedValue([{ count: 11, previous: new Date(0) }]); // 10 messages before this one
    const r = await handleChat({ ...body, sessionId: "s1" }, ctx);
    expect(r.body).toMatchObject({ error: "challenge_required" });
    expect(m.prisma.$queryRaw).toHaveBeenCalledOnce();
    // the claimed slot is given back, and nothing was saved or charged
    expect(m.prisma.chatSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ messageCount: { decrement: 1 } }) }));
    expect(m.prisma.chatMessage.create).not.toHaveBeenCalled();
    expect(m.consumeUsage).not.toHaveBeenCalled();
  });

  it("H1: bot-fast messages (claimed previous time) need Turnstile again", async () => {
    m.turnstile.mockReturnValue(true);
    m.prisma.$queryRaw.mockResolvedValue([{ count: 3, previous: new Date() }]);
    expect((await handleChat({ ...body, sessionId: "s1" }, ctx)).body).toMatchObject({ error: "challenge_required" });
    expect((await handleChat({ ...body, sessionId: "s1", turnstileToken: "t" }, ctx)).status).toBe(200);
  });

  it("H1: 20 parallel requests cannot pass the cap together", async () => {
    let count = 38;
    m.prisma.$queryRaw.mockImplementation(async () => (count < 40 ? [{ count: ++count, previous: new Date(0) }] : []));
    const results = await Promise.all(Array.from({ length: 20 }, () => handleChat({ ...body, sessionId: "s1" }, ctx)));
    expect(m.generate).toHaveBeenCalledTimes(2);
    expect(results.filter((r) => r.body.limited === true)).toHaveLength(18);
  });

  it("H2: token-less requests do not count against the business limit", async () => {
    m.turnstile.mockReturnValue(true);
    await handleChat(body, ctx);
    m.prisma.$queryRaw.mockResolvedValue([{ count: 2, previous: new Date() }]); // bot-fast, no token
    await handleChat({ ...body, sessionId: "s1" }, ctx);
    expect(m.rateLimit.mock.calls.map((c) => c[0])).not.toContain("widget:biz:b1");
  });

  it("H2: a busy business turns the request away and releases the slot", async () => {
    m.rateLimit.mockImplementation(async (k: string) => {
      if (k.startsWith("widget:biz:")) throw new RateLimitError(30);
    });
    const r = await handleChat({ ...body, sessionId: "s1" }, ctx);
    expect(r.status).toBe(429);
    expect(m.prisma.chatSession.updateMany).toHaveBeenCalled();
    expect(m.generate).not.toHaveBeenCalled();
  });

  it("M1: past the daily AI allowance per visitor address it falls back to collecting details", async () => {
    m.rateLimit.mockImplementation(async (k: string) => {
      if (k.startsWith("widget:aiday:")) throw new RateLimitError(3600);
    });
    const r = await handleChat(body, ctx);
    expect(r.status).toBe(200);
    expect(m.consumeUsage).not.toHaveBeenCalled();
    expect(m.generate).not.toHaveBeenCalled();
    expect(r.body).toMatchObject({ limited: true, askContact: true });
  });

  it("L4: the address limit is per business, with a separate global flood guard", async () => {
    await handleChat(body, ctx);
    const calls = m.rateLimit.mock.calls;
    expect(calls[0][0]).toBe("widget:ipall:h");
    expect(calls[0][1].limit).toBeGreaterThanOrEqual(600);
    const perBusiness = calls.find((c) => c[0] === "widget:ip:b1:h");
    expect(perBusiness?.[1].limit).toBe(60);
  });

  it("L4: one business's busy address does not block the same address on another business", async () => {
    m.rateLimit.mockImplementation(async (k: string) => {
      if (k === "widget:ip:b1:h") throw new RateLimitError(60);
    });
    expect((await handleChat(body, ctx)).status).toBe(429);
    m.widget.mockResolvedValue({ ...widget, businessId: "b2", userId: "u2" });
    expect((await handleChat(body, ctx)).status).toBe(200);
  });

  it("L3: fallback texts follow the visitor's language (browser hint on the first message)", async () => {
    m.consumeUsage.mockRejectedValue(new UsageLimitError("limit_reached", "chat"));
    const first = await handleChat({ ...body, lang: "fr-FR" }, ctx);
    expect(first.body.reply).toBe("Laissez vos coordonnées et l'équipe vous répondra.");
    expect(m.prisma.chatSession.create.mock.calls[0][0].data.language).toBe("French");
  });

  it("L3: the session's language (set from what the AI saw) wins over the hint and the business language", async () => {
    m.consumeUsage.mockRejectedValue(new UsageLimitError("limit_reached", "chat"));
    m.prisma.chatSession.findFirst.mockResolvedValue({ ...session, language: "Spanish" });
    const r = await handleChat({ ...body, sessionId: "s1", lang: "fr" }, ctx);
    expect(r.body.reply).toBe("Deja tus datos y el equipo te responderá.");
  });

  it("L3: an unsupported or missing hint falls back to the business language; junk is rejected", async () => {
    m.consumeUsage.mockRejectedValue(new UsageLimitError("limit_reached", "chat"));
    expect((await handleChat({ ...body, lang: "xx-YY" }, ctx)).body.reply).toBe("Leave your details and the team will get back to you.");
    expect((await handleChat({ ...body, lang: "<script>" }, ctx)).status).toBe(400);
  });

  it("does not use another visitor's session", async () => {
    m.prisma.chatSession.findFirst.mockResolvedValue(null);
    expect((await handleChat({ ...body, sessionId: "s9" }, ctx)).status).toBe(404);
    expect(m.prisma.chatSession.findFirst.mock.calls[0][0].where).toMatchObject({ id: "s9", businessId: "b1", visitorId: "visitor-12345" });
  });

  it("creates the lead when the visitor types contact details", async () => {
    const r = await handleChat({ ...body, message: "call me on +250 788 111 222" }, ctx);
    expect(m.createLead).toHaveBeenCalledWith(expect.objectContaining({ businessId: "b1", sessionId: "s1", phone: "+250 788 111 222" }));
    expect(r.body).toMatchObject({ leadCaptured: true, askContact: false });
  });

  it("creates the lead from AI-detected details and confirms in the content language when AI is off", async () => {
    m.generate.mockResolvedValue({ ...aiReply, detected: { name: "Ann", email: "ann@x.com" } });
    await handleChat(body, ctx);
    expect(m.createLead).toHaveBeenCalledWith(expect.objectContaining({ name: "Ann", email: "ann@x.com" }));

    m.consumeUsage.mockRejectedValue(new UsageLimitError("limit_reached", "chat"));
    const r = await handleChat({ ...body, message: "me: a@b.co" }, ctx);
    expect(r.body.reply).toBe("Thank you! The team will get back to you soon.");
  });

  it("asks for contact after interest and does not create a lead without contact details", async () => {
    const r = await handleChat({ ...body, message: "how much does it cost?" }, ctx);
    expect(r.body.askContact).toBe(true);
    expect(m.createLead).not.toHaveBeenCalled();
  });
});

describe("handleLead", () => {
  const lead = { key: "KEY12345", visitorId: "visitor-12345", sessionId: "s1", name: "Ann", phone: "0788111222", origin: "shop.com" };
  it("saves the lead for the visitor's own session", async () => {
    const r = await handleLead(lead, ctx);
    expect(r.status).toBe(200);
    expect(m.createLead).toHaveBeenCalledWith(expect.objectContaining({ businessId: "b1", sessionId: "s1", name: "Ann", phone: "0788111222" }));
  });
  it("needs a valid phone or email", async () => {
    expect((await handleLead({ ...lead, phone: undefined }, ctx)).status).toBe(422);
    expect((await handleLead({ ...lead, phone: "abc" }, ctx)).status).toBe(422);
    expect((await handleLead({ ...lead, email: "nope" }, ctx)).status).toBe(422);
    expect(m.createLead).not.toHaveBeenCalled();
  });
  it("works with no chat credit left and rejects foreign sessions and origins", async () => {
    m.consumeUsage.mockRejectedValue(new UsageLimitError("limit_reached", "chat"));
    expect((await handleLead(lead, ctx)).status).toBe(200);
    m.prisma.chatSession.findFirst.mockResolvedValue(null);
    expect((await handleLead(lead, ctx)).status).toBe(404);
    expect((await handleLead({ ...lead, origin: "evil.com" }, ctx)).status).toBe(403);
  });
});

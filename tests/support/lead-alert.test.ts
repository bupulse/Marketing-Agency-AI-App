import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  alertInBackground: vi.fn<(alert: unknown, label?: string, channels?: unknown, opts?: unknown) => Promise<void>>(async () => {}),
  findVisit: vi.fn(async () => ({ currentPath: "/pricing" }) as { currentPath: string | null } | null),
  findConversation: vi.fn(),
  findMessage: vi.fn(async () => ({ body: "Can a person help me with my invoice?" }) as { body: string } | null),
  findBusiness: vi.fn(async () => ({ name: "Client Shop Ltd" }) as { name: string } | null),
  pushToAgents: vi.fn(async () => 1),
  waitUntil: vi.fn(() => false),
  telegram: { id: "telegram", send: vi.fn() },
  email: { id: "email", send: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    supportVisit: { findUnique: m.findVisit },
    supportConversation: { findUnique: m.findConversation },
    supportMessage: { findFirst: m.findMessage },
    business: { findUnique: m.findBusiness },
  },
}));
vi.mock("@/lib/lead-alerts/channels", () => ({ alertInBackground: m.alertInBackground, telegramChannel: m.telegram, ALERT_CHANNELS: [m.email, m.telegram] }));
vi.mock("@/lib/platform/background", () => ({ waitUntil: m.waitUntil }));
vi.mock("@/lib/auth/site-url", () => ({ publicSiteUrl: () => "https://test.bupulse.com" }));
vi.mock("@/lib/support/alerts", () => ({ chatLink: (id: string) => `https://test.bupulse.com/support/?c=${id}`, pushToAgents: m.pushToAgents }));

import { alertNewSupportChat, alertWaitingChat, shouldAlertSupportChat, supportChatAlert, waitingChatAlert } from "@/lib/support/lead-alert";
import { alertSubject, telegramText, type LeadAlert } from "@/lib/lead-alerts/format";
import type { VisitorSession } from "@/lib/support/visits";

const session = (over: Partial<VisitorSession> = {}, v: Partial<VisitorSession["visitor"]> = {}): VisitorSession => ({
  visitId: "visit1",
  visitorId: "v1",
  surface: "public",
  country: "RW",
  ...over,
  visitor: { id: "v1", name: "Test Visitor", email: "visitor@example.com", phone: "0788 123 456", businessName: "Sample Shop Ltd", userId: null, businessId: null, creatorProfileId: null, leadId: "lead1", ...v },
});

beforeEach(() => vi.clearAllMocks());

describe("which chats alert the owner", () => {
  it("only a new chat on the marketing site", () => {
    expect(shouldAlertSupportChat({ surface: "public", newConversation: true })).toBe(true);
    expect(shouldAlertSupportChat({ surface: "public", newConversation: false })).toBe(false);
    for (const surface of ["dashboard", "creator", "bio"] as const) expect(shouldAlertSupportChat({ surface, newConversation: true })).toBe(false);
  });
});

describe("the chat alert", () => {
  it("carries the pre-chat form's details, the first message and a link to the chat", () => {
    const a = supportChatAlert(session(), "c9", " How much is Pro? ", new Date("2026-10-31T12:05:00Z"));
    expect(a).toMatchObject({ kind: "support_chat", name: "Test Visitor", phone: "+250788123456", email: "visitor@example.com", company: "Sample Shop Ltd", note: "How much is Pro?", openUrl: "https://test.bupulse.com/support/?c=c9" });
  });

  it("leaves out a WhatsApp number it cannot read", () => {
    expect(supportChatAlert(session({}, { phone: "call me" }), "c9", "hi", new Date()).phone).toBeNull();
    expect(supportChatAlert(session({}, { phone: null, name: null }), "c9", "hi", new Date())).toMatchObject({ phone: null, name: "A visitor" });
  });

  it("is sent in the background with the page the visitor is on", async () => {
    await alertNewSupportChat(session(), "c9", "hello");
    expect(m.alertInBackground).toHaveBeenCalledTimes(1);
    const build = m.alertInBackground.mock.calls[0][0] as () => Promise<LeadAlert>;
    expect(typeof build).toBe("function");
    expect(await build()).toMatchObject({ kind: "support_chat", page: "https://test.bupulse.com/pricing", note: "hello" });
  });

  it("pushes every new chat to the agents on duty, on any surface", async () => {
    await alertNewSupportChat(session(), "c9", "hello");
    await alertNewSupportChat(session({ surface: "dashboard" }), "c10", "hello");
    expect(m.pushToAgents).toHaveBeenCalledWith("c9", "New chat");
    expect(m.pushToAgents).toHaveBeenCalledWith("c10", "New chat");
    expect(m.waitUntil).toHaveBeenCalledTimes(2);
  });

  it("does not email or Telegram the owner for chats elsewhere, nor for a message in an existing chat", async () => {
    await alertNewSupportChat(session({ surface: "dashboard" }), "c9", "hello");
    await alertNewSupportChat(session(), "c9", "hello", false);
    expect(m.alertInBackground).not.toHaveBeenCalled();
    expect(m.pushToAgents).toHaveBeenCalledTimes(1); // the dashboard chat's push only
  });
});

describe("the waiting-for-a-person alert (hand-over)", () => {
  const chat = { number: 1042, surface: "dashboard", visitId: "visit1", visitor: { name: "Test Client", email: "client@example.com", phone: "+250788123456", businessName: null, businessId: "b1" } };

  it("names the chat, why it was handed over and where it started", () => {
    const a = waitingChatAlert({ ...chat, company: "Client Shop Ltd" }, "c9", " Help please ", "asked for a person", false, new Date("2026-11-09T08:00:00Z"));
    expect(a).toMatchObject({ kind: "support_waiting", name: "Test Client", company: "Client Shop Ltd", note: "Help please", source: "client dashboard chat", openUrl: "https://test.bupulse.com/support/?c=c9", chat: { number: 1042, reason: "asked for a person", away: false } });
    expect(alertSubject(a)).toBe("Chat #1042 is waiting for a person: Client Shop Ltd — reply to Test Client now");
    const text = telegramText(a);
    expect(text.split("\n")[0]).toBe("🔔 <b>Test Client from Client Shop Ltd is waiting for a person (chat #1042)</b>");
    expect(text).toContain("<i>Why: asked for a person</i>");
    expect(alertSubject({ ...a, chat: { number: 1042, reason: "asked for a person", away: true } })).toMatch(/^Chat #1042 left for the team: Client Shop Ltd/);
  });

  it("in team hours goes on Telegram only, quietly when Telegram is not set up (agents get a push and the 2-minute email)", async () => {
    m.findConversation.mockResolvedValue(chat);
    await alertWaitingChat("c9", "asked for a person", false);
    expect(m.alertInBackground).toHaveBeenCalledTimes(1);
    const [build, , channels, opts] = m.alertInBackground.mock.calls[0];
    expect(channels).toEqual([m.telegram]);
    expect(opts).toEqual({ quietIfNone: true });
    const alert = await (build as () => Promise<LeadAlert>)();
    expect(alert).toMatchObject({ kind: "support_waiting", company: "Client Shop Ltd", note: "Can a person help me with my invoice?", page: "https://test.bupulse.com/pricing", chat: { number: 1042, away: false } });
  });

  it("outside team hours (a ticket) goes by email and Telegram, and an alert that reaches nobody is an error", async () => {
    m.findConversation.mockResolvedValue({ ...chat, visitor: { ...chat.visitor, businessName: "Typed Shop" } });
    await alertWaitingChat("c9", "outside team hours", true);
    const [build, , channels, opts] = m.alertInBackground.mock.calls[0];
    expect(channels).toEqual([m.email, m.telegram]);
    expect(opts).toEqual({ quietIfNone: false });
    expect(await (build as () => Promise<LeadAlert>)()).toMatchObject({ company: "Typed Shop", chat: { away: true } });
    expect(m.findBusiness).not.toHaveBeenCalled();
  });
});

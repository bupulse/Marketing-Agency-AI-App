import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  alertInBackground: vi.fn<(alert: unknown, label?: string) => Promise<void>>(async () => {}),
  findVisit: vi.fn(async () => ({ currentPath: "/pricing" }) as { currentPath: string | null } | null),
}));

vi.mock("@/lib/db", () => ({ prisma: { supportVisit: { findUnique: m.findVisit } } }));
vi.mock("@/lib/lead-alerts/channels", () => ({ alertInBackground: m.alertInBackground }));
vi.mock("@/lib/auth/site-url", () => ({ publicSiteUrl: () => "https://test.bupulse.com" }));
vi.mock("@/lib/support/alerts", () => ({ chatLink: (id: string) => `https://test.bupulse.com/support/?c=${id}` }));

import { alertNewSupportChat, shouldAlertSupportChat, supportChatAlert } from "@/lib/support/lead-alert";
import type { LeadAlert } from "@/lib/lead-alerts/format";
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

  it("is not sent for chats elsewhere", async () => {
    await alertNewSupportChat(session({ surface: "dashboard" }), "c9", "hello");
    await alertNewSupportChat(session(), "c9", "hello", false);
    expect(m.alertInBackground).not.toHaveBeenCalled();
  });
});

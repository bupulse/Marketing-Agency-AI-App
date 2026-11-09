import { beforeEach, describe, expect, it, vi } from "vitest";

// A chat handed over to people always reaches someone: the owner's Telegram ping at the hand-over (lead-alert.ts),
// and the 2-minute email goes to the admin addresses when no agent is on duty (alerts.ts).

const m = vi.hoisted(() => ({
  prisma: {
    supportAgent: { findMany: vi.fn() },
    supportDepartment: { findUnique: vi.fn() },
    supportConversation: { findUnique: vi.fn(), updateMany: vi.fn() },
    supportMessage: { create: vi.fn() },
    supportEvent: { create: vi.fn() },
    $transaction: vi.fn(async () => []),
  },
  sendEmail: vi.fn<(e: { to: string; subject: string; html: string; text: string }) => Promise<boolean>>(async () => true),
  adminEmails: vi.fn(() => ["owner@example.com"]),
  alertWaitingChat: vi.fn(async () => {}),
  scheduleJob: vi.fn(async () => ({})),
  broadcast: vi.fn(async () => {}),
  hours: { open: true, label: "Mon-Sat 8:00-20:00", opensAt: "08:00" } as { open: boolean; label: string; opensAt: string | null },
}));

vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/admin/auth", () => ({ adminEmails: m.adminEmails }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: m.sendEmail }));
vi.mock("@/lib/push/service", () => ({ vapidKeys: () => null, allowedEndpoint: () => true }));
vi.mock("@/lib/push/web-push", () => ({ sendWebPush: vi.fn() }));
vi.mock("@/lib/auth/site-url", () => ({ publicSiteUrl: () => "https://test.bupulse.com" }));
vi.mock("@/lib/jobs/due", () => ({ scheduleJob: m.scheduleJob, registerJobHandler: vi.fn() }));
vi.mock("@/lib/support/realtime", () => ({ broadcast: m.broadcast }));
vi.mock("@/lib/support/settings", () => ({ getSupportSettings: vi.fn(async () => ({})), teamHours: () => m.hours }));
vi.mock("@/lib/support/lead-alert", () => ({ alertWaitingChat: m.alertWaitingChat }));
vi.mock("@/lib/platform/background", () => ({ waitUntil: vi.fn(() => false) }));

import { emailWaitingChat } from "@/lib/support/alerts";
import { handOver } from "@/lib/support/handover";

const chat = { id: "c1", number: 1042, departmentId: null, visitorName: "Test Visitor", preview: "Can someone help?" };

beforeEach(() => {
  vi.clearAllMocks();
  m.hours = { open: true, label: "Mon-Sat 8:00-20:00", opensAt: "08:00" };
  m.prisma.supportConversation.findUnique.mockResolvedValue({ tags: [] });
  m.prisma.supportConversation.updateMany.mockResolvedValue({ count: 1 });
});

describe("the 2-minute email", () => {
  it("goes to the agents on duty", async () => {
    m.prisma.supportAgent.findMany.mockResolvedValue([{ id: "a1", email: "agent@example.com", name: "Agent" }]);
    expect(await emailWaitingChat(chat)).toBe(1);
    expect(m.sendEmail.mock.calls.map((c) => c[0].to)).toEqual(["agent@example.com"]);
  });

  it("falls back to the admin addresses when nobody is on duty", async () => {
    m.prisma.supportAgent.findMany.mockResolvedValue([]);
    expect(await emailWaitingChat(chat)).toBe(1);
    const email = m.sendEmail.mock.calls[0][0];
    expect(email.to).toBe("owner@example.com");
    expect(email.subject).toBe("Chat #1042 is waiting for a reply");
    expect(email.text).toContain("nobody is on duty");
  });

  it("and when none of the agents' emails went out", async () => {
    m.prisma.supportAgent.findMany.mockResolvedValue([{ id: "a1", email: "agent@example.com", name: "Agent" }]);
    m.sendEmail.mockResolvedValueOnce(false);
    expect(await emailWaitingChat(chat)).toBe(1);
    expect(m.sendEmail.mock.calls.map((c) => c[0].to)).toEqual(["agent@example.com", "owner@example.com"]);
  });
});

describe("a hand-over alerts the owner", () => {
  it("in team hours, as a chat waiting now", async () => {
    expect(await handOver("c1", "asked")).toBe(true);
    expect(m.alertWaitingChat).toHaveBeenCalledWith("c1", "asked for a person", false);
  });

  it("outside team hours, as a ticket", async () => {
    m.hours = { open: false, label: "Mon-Sat 8:00-20:00", opensAt: "08:00" };
    await handOver("c1", "upset");
    expect(m.alertWaitingChat).toHaveBeenCalledWith("c1", "the visitor sounds upset", true);
  });

  it("not when the chat was not with the AI (already handed over)", async () => {
    m.prisma.supportConversation.updateMany.mockResolvedValue({ count: 0 });
    expect(await handOver("c1", "asked")).toBe(false);
    expect(m.alertWaitingChat).not.toHaveBeenCalled();
  });
});

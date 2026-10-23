import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  prisma: {
    contactRequest: { findMany: vi.fn() },
    supportVisitor: { findMany: vi.fn() },
    supportAgent: { findMany: vi.fn() },
    supportConversation: { groupBy: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/support/prechat", () => ({ SUPPORT_LEAD_KIND: "support_chat" }));

import { listSupportLeads } from "@/lib/support/leads";
import { team } from "@/lib/support/agent-account";

const lead = (id: string, at: string) => ({ id, name: "Test Visitor", email: "visitor@example.com", phone: null, businessName: "Sample Shop Ltd", message: "How much is Pro?", createdAt: new Date(at) });

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.supportVisitor.findMany.mockResolvedValue([]);
});

describe("listSupportLeads", () => {
  it("lists support_chat leads newest first with their latest chat", async () => {
    m.prisma.contactRequest.findMany.mockResolvedValue([lead("leadaaaaaaaa1", "2026-10-23T09:00:00Z")]);
    m.prisma.supportVisitor.findMany.mockResolvedValue([
      { leadId: "leadaaaaaaaa1", conversations: [{ id: "older", createdAt: new Date("2026-10-20T00:00:00Z") }] },
      { leadId: "leadaaaaaaaa1", conversations: [{ id: "newer", createdAt: new Date("2026-10-22T00:00:00Z") }] },
    ]);
    const page = await listSupportLeads();
    expect(m.prisma.contactRequest.findMany.mock.calls[0][0]).toMatchObject({ where: { kind: "support_chat" }, take: 51 });
    expect(page).toEqual({ items: [expect.objectContaining({ id: "leadaaaaaaaa1", createdAt: "2026-10-23T09:00:00.000Z", conversationId: "newer" })], next: null });
  });

  it("pages with a cursor and caps the page size", async () => {
    m.prisma.contactRequest.findMany.mockResolvedValue([lead("leadaaaaaaaa1", "2026-10-23T09:00:00Z"), lead("leadaaaaaaaa2", "2026-10-22T09:00:00Z")]);
    const page = await listSupportLeads({ after: "leadaaaaaaaa0", limit: 1 });
    expect(m.prisma.contactRequest.findMany.mock.calls[0][0]).toMatchObject({ take: 2, cursor: { id: "leadaaaaaaaa0" }, skip: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.next).toBe("leadaaaaaaaa1");
    await listSupportLeads({ after: "bad id!", limit: 500 });
    expect(m.prisma.contactRequest.findMany.mock.calls[1][0]).not.toHaveProperty("cursor");
    expect(m.prisma.contactRequest.findMany.mock.calls[1][0].take).toBe(101);
  });
});

describe("team", () => {
  it("lists active agents with their open chats", async () => {
    m.prisma.supportAgent.findMany.mockResolvedValue([{ id: "a1", name: "Jean Mugisha", availability: "online", maxChats: 5, departments: [{ department: { key: "sales" } }] }, { id: "a2", name: "Aline Uwase", availability: "busy", maxChats: 3, departments: [] }]);
    m.prisma.supportConversation.groupBy.mockResolvedValue([{ assigneeId: "a1", _count: { _all: 2 } }]);
    expect(await team()).toEqual({
      agents: [
        { id: "a1", name: "Jean Mugisha", availability: "online", departments: ["sales"], openChats: 2, maxChats: 5 },
        { id: "a2", name: "Aline Uwase", availability: "offline", departments: [], openChats: 0, maxChats: 3 },
      ],
    });
    expect(m.prisma.supportAgent.findMany.mock.calls[0][0].where).toEqual({ status: "active", lockedAt: null });
  });
});

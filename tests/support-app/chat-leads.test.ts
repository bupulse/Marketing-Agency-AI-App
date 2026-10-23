import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ findMany: vi.fn(), visitors: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { contactRequest: { findMany: m.findMany }, supportVisitor: { findMany: m.visitors } } }));

import { LeadsView } from "@/components/admin/live-chat/leads-view";
import { chatLeads, SUPPORT_LEAD_KIND } from "@/lib/support/admin-leads";

const row = (id: string, minAgo: number) => ({ id, kind: SUPPORT_LEAD_KIND, name: `Name ${id}`, email: `${id}@example.com`, phone: id === "lead00000001" ? "+250 788 000 000" : null, businessName: "Sample Shop", industry: null, message: `Question ${id}`, handled: false, createdAt: new Date(Date.parse("2026-10-23T10:00:00Z") - minAgo * 60_000) });

beforeEach(() => {
  m.findMany.mockReset();
  m.visitors.mockReset();
});

describe("chat leads (Admin -> Live chat)", () => {
  it("lists help-chat leads newest first, a page at a time, with the chat to open", async () => {
    m.findMany.mockResolvedValue([row("lead00000001", 1), row("lead00000002", 5), row("lead00000003", 9)]);
    m.visitors.mockResolvedValue([{ leadId: "lead00000001", conversations: [{ id: "conv1" }] }, { leadId: "lead00000002", conversations: [] }]);
    const out = await chatLeads({ limit: 2 });
    expect(m.findMany).toHaveBeenCalledWith({ where: { kind: "support_chat" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 3 });
    expect(out.items.map((l) => [l.id, l.conversationId])).toEqual([["lead00000001", "conv1"], ["lead00000002", null]]);
    expect(out.next).toBe("lead00000002");
  });
  it("continues after a page and ignores a cursor that is not an id", async () => {
    m.findMany.mockResolvedValue([]);
    await chatLeads({ after: "lead00000002" });
    expect(m.findMany.mock.calls[0][0]).toMatchObject({ cursor: { id: "lead00000002" }, skip: 1 });
    await chatLeads({ after: "'; drop" });
    expect(m.findMany.mock.calls[1][0]).not.toHaveProperty("cursor");
    expect(m.visitors).not.toHaveBeenCalled();
  });
  it("shows each lead with their question, contact and a link to the chat in the support app", () => {
    const html = renderToStaticMarkup(
      createElement(LeadsView, {
        leads: [
          { id: "l1", name: "Aline Uwase", email: "aline@example.com", phone: "+250 788 000 000", businessName: "Sample Beauty Salon", message: "How much is Pro?", createdAt: "2026-10-23T08:00:00Z", conversationId: "c1042" },
          { id: "l2", name: "Eric N.", email: "eric@example.com", phone: null, businessName: null, message: "Do you post on TikTok?", createdAt: "2026-10-23T07:00:00Z", conversationId: null },
        ],
        next: "l2",
        appUrl: "https://support.bupulse.com",
        first: true,
      }),
    );
    expect(html).toContain("How much is Pro?");
    expect(html).toContain("https://support.bupulse.com?c=c1042");
    expect(html).toContain("https://wa.me/250788000000");
    expect(html).toContain("No chat found");
    expect(html).toContain("/admin/live-chat?tab=leads&amp;after=l2");
    expect(renderToStaticMarkup(createElement(LeadsView, { leads: [], next: null, appUrl: "x", first: true }))).toContain("No chat leads yet");
  });
});

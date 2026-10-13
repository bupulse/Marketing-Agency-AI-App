import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The sales screens render from plain data: empty (a fresh install) and with some data.

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/sales", useRouter: () => ({ push: vi.fn() }) }));

import { LeaderboardView, MyClientsView, TeamView, type MyClientsData, type TeamData } from "@/components/admin/sales/sales-views";
import type { SalesClient } from "@/lib/sales/clients";
import { ToastProvider } from "@/components/ui";

// The copy button uses the toasts, which the root layout provides.
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(ToastProvider, null, el));
const now = Date.parse("2026-10-13T12:00:00Z");

const client = (over: Partial<SalesClient> = {}): SalesClient => ({
  businessId: "b1", userId: "u1", name: "Kigali Bakery", contactName: "Aline", phone: "0788123456", email: "aline@example.com", plan: "TRIAL", status: "TRIALING",
  trialEndsAt: "2026-10-18T12:00:00Z", lastSignInAt: "2026-10-12T08:00:00Z", posts: 7, lastPayment: null, agentId: "s1", ...over,
});

const mine = (over: Partial<MyClientsData> = {}): MyClientsData => ({ isStaff: true, clients: [], link: null, month: "2026-10", board: [], staffId: "s1", canViewClients: false, now, ...over });
const team = (over: Partial<TeamData> = {}): TeamData => ({ members: [], board: [], clients: [], reassignments: [], month: "2026-10", canViewClients: false, canReassign: false, now, ...over });

describe("My clients", () => {
  it("renders with no clients", () => {
    const out = html(createElement(MyClientsView, { d: mine() }));
    expect(out).toContain("No clients yet");
    expect(out).toContain("My numbers, October 2026");
  });

  it("tells an owner without a staff record what the page is for", () => {
    expect(html(createElement(MyClientsView, { d: mine({ isStaff: false, staffId: null }) }))).toContain("for sales staff");
  });

  it("shows the link, the numbers and the clients without links into the companies", () => {
    const out = html(createElement(MyClientsView, {
      d: mine({ link: { code: "K7Q2", url: "https://bupulse.com/?ref=K7Q2" }, clients: [client()], board: [{ staffId: "s1", name: "Sam", ownCents: 2000, teamShareCents: 500, totalCents: 2500, clients: 1 }] }),
    }));
    for (const text of ["https://bupulse.com/?ref=K7Q2", "Copy link", "Share on WhatsApp", "wa.me/?text=", "Kigali Bakery", "Aline", "5 days", "Yesterday", "$25.00", "1 of 1", "wa.me/250788123456"]) expect(out).toContain(text);
    expect(out).not.toContain("/admin/companies/");
  });

  it("links to the company for staff who may see all clients", () => {
    expect(html(createElement(MyClientsView, { d: mine({ clients: [client()], canViewClients: true }) }))).toContain("/admin/companies/b1");
  });
});

describe("Sales team", () => {
  it("renders with nothing", () => {
    const out = html(createElement(TeamView, { d: team() }));
    for (const text of ["No sales staff yet", "No clients yet", "No reassignments yet"]) expect(out).toContain(text);
  });

  it("shows agents, clients with their agent and the reassign form", async () => {
    const out = html(createElement(TeamView, {
      d: team({
        canReassign: true,
        members: [{ staffId: "s1", name: "Sam", email: "sam@example.com", roleName: "Sales agent", status: "active", refCode: "K7Q2" }],
        clients: [client(), client({ businessId: "b2", name: "Musanze Tools", agentId: null })],
        reassignments: [{ id: "r1", at: "2026-10-10T10:00:00Z", client: "Musanze Tools", agent: null, reason: "Agent left", by: "staff:m1" }],
      }),
      reassignAction: async () => {},
    }));
    for (const text of ["Sam", "K7Q2", "Unassigned", "Reassign", 'name="reason"', "Agent left", "2 companies, 1 unassigned"]) expect(out).toContain(text);
  });

  it("hides the reassign form without clients.reassign", () => {
    const out = html(createElement(TeamView, { d: team({ clients: [client()] }), reassignAction: async () => {} }));
    expect(out).not.toContain('name="reason"');
  });
});

describe("Leaderboard", () => {
  it("renders an empty month with the month picker and how it is calculated", () => {
    const out = html(createElement(LeaderboardView, { rows: [], month: "2026-10", months: ["2026-10", "2026-09"] }));
    for (const text of ["No sales agents that month", "September 2026", "How we calculate this", "split equally"]) expect(out).toContain(text);
  });

  it("ranks the rows and marks the signed-in agent", () => {
    const out = html(createElement(LeaderboardView, {
      rows: [
        { staffId: "s2", name: "Bea", ownCents: 9000, teamShareCents: 100, totalCents: 9100, clients: 3 },
        { staffId: "s1", name: "Sam", ownCents: 0, teamShareCents: 100, totalCents: 100, clients: 0 },
      ],
      month: "2026-10",
      months: ["2026-10"],
      me: "s1",
    }));
    expect(out.indexOf("Bea")).toBeLessThan(out.indexOf("Sam"));
    expect(out).toContain("$91.00");
    expect(out).toContain("Sam (you)");
  });
});

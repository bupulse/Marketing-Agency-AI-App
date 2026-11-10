import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/support/owner", () => ({ SUPPORT_OWNER_EMAIL: "admin@bupulse.com", isSupportOwnerEmail: (e: string) => e === "admin@bupulse.com" }));

import { staffTotals, type LinkRow } from "@/lib/links/service";

const row = (id: string, by: LinkRow["by"], s: Partial<LinkRow["stats"]>): LinkRow => ({
  id, code: id, label: id, channel: "instagram", destination: "/", createdAt: "2026-11-10T00:00:00Z", archived: false, by,
  stats: { clicks: 0, visitors: 0, quotes: 0, chats: 0, signups: 0, paid: 0, countries: [], ...s },
});

describe("leads by staff", () => {
  it("puts the company's links in one row first, adds up each person's links, and adds chat leads", () => {
    const rows = [
      row("ig", { id: "owner", name: "Admin", owner: true }, { clicks: 100, quotes: 5 }),
      row("tt", { id: "owner", name: "Admin", owner: true }, { clicks: 50, quotes: 1 }),
      row("jean1", { id: "jean", name: "Jean", owner: false }, { clicks: 10, quotes: 2 }),
      row("jean2", { id: "jean", name: "Jean", owner: false }, { clicks: 5, paid: 1 }),
    ];
    const totals = staffTotals(rows, new Map([["aline", { name: "Aline", count: 3 }], ["jean", { name: "Jean", count: 1 }]]));
    expect(totals.map((t) => t.name)).toEqual(["BuPulse (company)", "Jean", "Aline"]);
    expect(totals[0]).toMatchObject({ company: true, links: 2, clicks: 150, quotes: 6 });
    expect(totals[1]).toMatchObject({ links: 2, clicks: 15, quotes: 2, paid: 1, chatLeads: 1 });
    expect(totals[2]).toMatchObject({ links: 0, chatLeads: 3 });
  });
});

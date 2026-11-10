import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: () => { throw new Error("db not available in this test"); } }) }));

import { ADMIN_NAV, breadcrumbsFor, groupHref, hubFor, hubGroup, hubPermissions, inGroup, navFor, phoneTabsFor } from "@/components/admin/nav";
import { hubFiguresFrom } from "@/app/admin/(console)/hub/hub-content";
import { ALL_PERMISSIONS, BUILT_IN_ROLES, type Permission } from "@/lib/staff/permissions";

const role = (key: string) => BUILT_IN_ROLES.find((r) => r.key === key)!.permissions;
const CONSOLE = join(process.cwd(), "app/admin/(console)");

/** Where each hub's route file lives. */
const HUB_FILES: Record<string, string> = {
  "/admin/money": "(money)/money/page.tsx",
  "/admin/clients": "(clients)/clients/page.tsx",
  "/admin/system": "(system)/system/page.tsx",
  "/admin/hub/sales": "hub/[group]/page.tsx",
  "/admin/hub/content": "hub/[group]/page.tsx",
  "/admin/hub/ai": "hub/[group]/page.tsx",
  "/admin/hub/organisation": "hub/[group]/page.tsx",
};

describe("group hubs", () => {
  it("every group of more than one page has a hub with a route, a hint and a tone", () => {
    for (const g of ADMIN_NAV.filter((x) => x.title && x.items.length > 1)) {
      expect(g.hub, g.id).toBeDefined();
      expect(HUB_FILES[g.hub!], g.hub).toBeDefined();
      expect(existsSync(join(CONSOLE, HUB_FILES[g.hub!])), g.hub).toBe(true);
      expect(g.hint?.length ?? 0, g.id).toBeGreaterThan(20);
      expect(g.tone, g.id).toBeDefined();
    }
  });

  it("a hub never takes the path of an existing page", () => {
    const pages = new Set(ADMIN_NAV.flatMap((g) => g.items.map((i) => i.href)));
    for (const g of ADMIN_NAV) if (g.hub) expect(pages.has(g.hub), g.hub).toBe(false);
  });

  it("asks for any one of the group's page permissions, no more and no fewer", () => {
    expect(hubPermissions(hubGroup("money")!).sort()).toEqual(["money.costs", "money.revenue", "payments.approve", "payments.view", "plans.manage", "requests"].sort());
    expect(hubPermissions(hubGroup("organisation")!).sort()).toEqual(["screen.manage", "staff.manage"]);
    for (const g of ADMIN_NAV.filter((x) => x.hub)) {
      const perms = hubPermissions(g);
      for (const i of g.items) expect((typeof i.perm === "string" ? [i.perm] : i.perm).some((p) => perms.includes(p)), i.href).toBe(true);
    }
  });

  it("each hub route checks hubPermissions before rendering", () => {
    for (const file of new Set(Object.values(HUB_FILES))) {
      const src = readFileSync(join(CONSOLE, file), "utf8");
      expect(src, file).toMatch(/await requirePermission\(hubPermissions\(group\)\)/);
      expect(src.indexOf("requirePermission(")).toBeLessThan(src.indexOf("<HubContent"));
    }
  });

  it("finds a hub by path and builds its breadcrumbs; pages link their group crumb to the hub", () => {
    expect(hubFor("/admin/money")?.id).toBe("money");
    expect(hubFor("/admin/hub/sales")?.id).toBe("sales");
    expect(hubFor("/admin/payments")).toBeNull();
    expect(breadcrumbsFor("/admin/money")).toEqual([{ label: "Admin", href: "/admin" }, { label: "Money" }]);
    expect(breadcrumbsFor("/admin/quotes")).toEqual([{ label: "Admin", href: "/admin" }, { label: "Sales", href: "/admin/hub/sales" }, { label: "Quote requests" }]);
    // Live chat has one page and no hub: no crumb for the group.
    expect(breadcrumbsFor("/admin/live-chat")).toEqual([{ label: "Admin", href: "/admin" }, { label: "Live chat" }]);
  });

  it("knows which group a path is in, hub included", () => {
    expect(inGroup("/admin/invoices/abc", "money")).toBe(true);
    expect(inGroup("/admin/money", "money")).toBe(true);
    expect(inGroup("/admin/money", "clients")).toBe(false);
  });

  it("sends someone who can open only one page of a group straight to it", () => {
    // Support opens only Quote requests in Sales; a sales agent opens My clients and the leaderboard.
    expect(groupHref(navFor(role("support")).find((g) => g.id === "sales")!)).toBe("/admin/quotes");
    expect(groupHref(navFor(role("sales_agent")).find((g) => g.id === "sales")!)).toBe("/admin/hub/sales");
    expect(groupHref(navFor(ALL_PERMISSIONS).find((g) => g.id === "sales")!)).toBe("/admin/hub/sales");
    expect(groupHref(navFor(ALL_PERMISSIONS).find((g) => g.id === "livechat")!)).toBe("/admin/live-chat");
  });
});

describe("phone tab bar", () => {
  it("the owner gets Overview, Inbox, Clients and Sales", () => {
    expect(phoneTabsFor(ALL_PERMISSIONS).map((t) => t.label)).toEqual(["Overview", "Inbox", "Clients", "Sales"]);
    expect(phoneTabsFor(ALL_PERMISSIONS).find((t) => t.label === "Clients")?.href).toBe("/admin/clients");
  });

  it("only shows places the person may open, topped up with their other groups", () => {
    const tabs = (p: Permission[]) => phoneTabsFor(p).map((t) => t.label);
    expect(tabs(role("sales_agent"))).toEqual(["Sales"]);
    expect(tabs(role("finance"))).toEqual(["Overview", "Inbox", "Clients", "Sales"]);
    expect(tabs(role("marketing"))).toEqual(["Content"]);
    // Never a tab to a page the menu hides.
    for (const r of BUILT_IN_ROLES) {
      const hrefs = new Set(navFor(r.permissions).flatMap((g) => [...g.items.map((i) => i.href), ...(g.hub ? [g.hub] : [])]));
      for (const t of phoneTabsFor(r.permissions)) expect(hrefs.has(t.href), `${r.key}: ${t.href}`).toBe(true);
    }
  });
});

describe("hub figures", () => {
  it("shows to-do bubbles and key numbers only on the cards present", () => {
    const money = navFor(role("finance")).find((g) => g.id === "money")!;
    const f = hubFiguresFrom(money, { payments: 2, invoices: 1, offers: 0, errors: 5 });
    expect(f["/admin/payments"]).toMatchObject({ count: 2, countLabel: "2 payments to check", value: "2" });
    expect(f["/admin/invoices"]).toMatchObject({ value: "1", valueLabel: "invoice to check" });
    expect(f["/admin/offers"]).toMatchObject({ value: "0" });
    expect(f["/admin/errors"]).toBeUndefined(); // not a Money page
  });

  it("adds the client counts on the Clients hub", () => {
    const clients = navFor(ALL_PERMISSIONS).find((g) => g.id === "clients")!;
    const f = hubFiguresFrom(clients, { requests: 0, reports: 3 }, { total: 45, pastDue: 2, trial: 9 });
    expect(f["/admin/companies"]).toMatchObject({ value: "45", valueLabel: "companies" });
    expect(f["/admin/client-health"]).toMatchObject({ value: "2", valueLabel: "late paying" });
    expect(f["/admin/creators"]).toMatchObject({ count: 3 });
    expect(f["/admin/requests"]).toBeUndefined();
  });
});

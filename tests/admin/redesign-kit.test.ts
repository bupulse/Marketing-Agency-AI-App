import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/money", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { Coins, Users } from "lucide-react";
import { chosen, hrefWith } from "@/components/admin/kit/url";
import { DataList, EmptyState, ExpandCard, FilterChips, ChoiceTiles, PageHeader, SectionCard, StatTile, StatusPill, TodoList } from "@/components/admin/kit";
import { AreaCards, areaFigures, greeting, needsYouItems, OverviewDashboard, type OverviewData } from "@/components/admin/overview-dashboard";
import { TodayTimeline } from "@/components/admin/overview-today";
import { Panel, notice } from "@/components/admin/ui";
import { AdminShell } from "@/components/admin/shell";
import { ThemeProvider } from "@/components/theme";
import { navFor } from "@/components/admin/nav";
import { ALL_PERMISSIONS, BUILT_IN_ROLES } from "@/lib/staff/permissions";

// Loosely typed: these checks pass children the classic way.
const el = (type: unknown, props: unknown, ...children: unknown[]) => createElement(type as never, props as never, ...(children as never[]));
const html = (node: ReturnType<typeof createElement>) => renderToStaticMarkup(node);

describe("filter links", () => {
  it("sets one parameter, keeps the others, drops messages and paging", () => {
    expect(hrefWith("/admin/payments", { q: "salon", notice: "Saved", page: "3", status: "old" }, "status", "late")).toBe("/admin/payments?q=salon&status=late");
    expect(hrefWith("/admin/payments", { status: "late" }, "status", "")).toBe("/admin/payments");
    expect(hrefWith("/admin/x", { tag: ["a", "b"] }, "range", "all", "all")).toBe("/admin/x?tag=a");
    expect(hrefWith("/admin/x", undefined, "range", "7d", "30d")).toBe("/admin/x?range=7d");
  });
  it("reads only a known choice", () => {
    expect(chosen({ status: "late" }, "status", ["late", "paid"])).toBe("late");
    expect(chosen({ status: "<script>" }, "status", ["late", "paid"], "all")).toBe("all");
    expect(chosen({ status: ["paid", "late"] }, "status", ["late", "paid"])).toBe("paid");
  });
  it("marks the chosen chip and tile for screen readers, as links", () => {
    const opts = [{ value: "", label: "All", count: 4 }, { value: "late", label: "Past due", count: 1 }];
    const chips = html(el(FilterChips, { label: "Show companies", param: "status", options: opts, current: "late", base: "/admin/companies", params: { q: "a" } }));
    expect(chips).toContain('aria-label="Show companies"');
    expect(/<a[^>]*aria-current="true"[^>]*>/.exec(chips)?.[0]).toContain('href="/admin/companies?q=a&amp;status=late"');
    expect(chips).toContain('href="/admin/companies?q=a"');
    const tiles = html(el(ChoiceTiles, { label: "Period", param: "period", options: [{ value: "week", label: "This week", hint: "Monday to now" }], current: "week", base: "/admin/x" }));
    expect(tiles).toContain("Monday to now");
    expect(tiles).toContain('aria-current="true"');
  });
});

describe("kit pieces", () => {
  it("page header, section card and stat tile", () => {
    expect(html(el(PageHeader, { icon: Coins, title: "Money", description: "Revenue and payments.", back: { href: "/admin", label: "Back" } }))).toMatch(/<h1[^>]*>Money<\/h1>.*[\s\S]*Revenue and payments/);
    const card = html(el(SectionCard, { href: "/admin/payments", icon: Coins, title: "Payments", hint: "To confirm", value: "2", valueLabel: "to check", count: 2, countLabel: "2 to check" }));
    expect(card).toContain('href="/admin/payments"');
    expect(card).toContain('aria-label="2 to check"');
    expect(card).toContain("motion-reduce:transform-none");
    const tile = html(el(StatTile, { icon: Users, label: "Paying", value: "34", hint: "On a paid plan.", delta: { now: 34, before: 30, against: "vs October" }, href: "/admin/companies" }));
    expect(tile).toContain("Up 13%");
    expect(tile).toContain('href="/admin/companies"');
    expect(html(el(StatTile, { icon: Users, label: "Costs", value: "9", delta: { now: 9, before: 6, against: "vs last month", upIsGood: false } }))).toContain("bg-danger-bg");
  });
  it("expand card is a real button with the details in the page", () => {
    const out = html(el(ExpandCard, { title: "Clients", summary: "34 paying" }, el("a", { href: "/admin/companies" }, "See them")));
    expect(out).toMatch(/<button[^>]*aria-expanded="false"/);
    expect(out).toContain("focus-within:grid-rows-[1fr]");
    expect(out).toContain("[@media(hover:hover)]:group-hover/expand:grid-rows-[1fr]");
    expect(out).toContain('href="/admin/companies"');
    expect(html(el(ExpandCard, { title: "Open", defaultOpen: true }, "x"))).toContain('aria-expanded="true"');
  });
  it("data list is a table and phone cards from the same columns", () => {
    const out = html(
      createElement(DataList<{ id: string; name: string; plan: string }>, {
        caption: "Companies",
        rows: [{ id: "b1", name: "Kigali Bakery", plan: "Pro" }],
        rowKey: (r) => r.id,
        rowHref: (r) => `/admin/companies/${r.id}`,
        columns: [{ key: "n", header: "Company", cell: (r) => r.name, primary: true }, { key: "p", header: "Plan", cell: (r) => r.plan }],
      }),
    );
    expect(out).toContain("<table");
    expect(out).toContain("hidden md:block");
    expect(out).toContain("md:hidden");
    expect(out.match(/href="\/admin\/companies\/b1"/g)?.length).toBe(2);
    expect(html(createElement(DataList<{ id: string }>, { caption: "x", rows: [], rowKey: (r) => r.id, columns: [], empty: "No companies yet." }))).toContain("No companies yet.");
  });
  it("status pill, empty state and to-do list say it in words", () => {
    expect(html(el(StatusPill, { tone: "bad", dot: true }, "Past due"))).toContain("Past due");
    expect(html(el(EmptyState, { title: "Nothing here", hint: "Add one." }))).toContain('role="status"');
    expect(html(el(TodoList, { items: [] }))).toContain("Nothing needs you right now.");
    expect(html(el(TodoList, { items: [{ key: "q", text: "3 quote requests to call", href: "/admin/quotes", count: 3, tone: "bad" }] }))).toContain('href="/admin/quotes"');
  });
  it("the old pieces keep their props and gain the new look", () => {
    const out = html(el(Panel, { title: "Budget", description: "Cap $100.", action: el("span", null, "ok") }, "body"));
    expect(out).toContain("Budget");
    expect(out).toContain("rounded-[22px]");
    // Pages append layout classes to the notice strings.
    expect(typeof notice.ok).toBe("string");
    expect(notice.bad).toContain("text-danger");
  });
});

const d: OverviewData = {
  monthLabel: "November 2026",
  prevMonthLabel: "October",
  revenue: { monthCents: 10000, prevCents: 8000, lifetimeCents: 50000, customersEver: 3, spark: [] },
  mrrCents: 9000,
  arpuCents: 3000,
  profit: { monthCents: 2000, prevCents: 1000, costCents: 8000, estimateCents: 0, spark: [] },
  clients: { active: 3, trial: 2, pastDue: 1, waitingDemo: 0 },
  todo: { inbox: 4, payments: 2, demosToday: 0, nextDemo: null, errors24h: 5 },
  ai: { spentCents: 500, capCents: 1000, pct: 50, paused: false },
};

describe("overview", () => {
  it("greets by the time of day in Kigali, with a name only when it looks like one", () => {
    expect(greeting(new Date("2026-11-10T06:00:00Z"), "aline.m@example.com")).toBe("Good morning, Aline");
    expect(greeting(new Date("2026-11-10T12:00:00Z"), "office@bupulse.com")).toBe("Good afternoon");
    expect(greeting(new Date("2026-11-10T18:00:00Z"))).toBe("Good evening");
    expect(greeting(new Date("2026-11-10T22:30:00Z"), "admin@bupulse.com")).toBe("Good evening");
  });

  it("needs you: to-dos the person may act on, problems first, no line said twice", () => {
    const items = needsYouItems({
      counts: { quotes: 3, payments: 1, demos: 0, errors: 2 },
      paymentsWaiting: 2,
      attention: [
        { level: "warning", key: "payments", text: "2 payments are waiting", href: "/admin/payments" },
        { level: "problem", key: "service:x", text: "X is failing", href: "/admin/services" },
        { level: "warning", key: "ai-budget", text: "AI at 82%", href: "/admin/ai" },
      ],
    });
    expect(items.map((i) => i.key)).toEqual(["quotes", "payments", "a:service:x", "a:ai-budget", "errors"]);
    expect(items.find((i) => i.key === "payments")?.count).toBe(2);
    expect(items.find((i) => i.key === "quotes")?.text).toBe("3 quote requests to call");
    expect(needsYouItems({ counts: {}, attention: [] })).toEqual([]);
  });

  it("area cards: one per group the person may open, with its key number", () => {
    const groups = navFor(ALL_PERMISSIONS).filter((g) => g.id !== "home");
    const figures = areaFigures({ counts: { quotes: 3, payments: 2, requests: 1 }, d, see: { money: true, clients: true, ai: true, system: true } });
    expect(figures.sales).toMatchObject({ count: 3, value: "3" });
    expect(figures.clients).toMatchObject({ value: "3", valueLabel: "paying clients", count: 1 });
    expect(figures.money).toMatchObject({ value: "$100.00", count: 2 });
    expect(figures.ai).toMatchObject({ value: "50%" });
    expect(figures.system).toMatchObject({ value: "5" });
    const out = html(el(AreaCards, { groups, figures }));
    for (const href of ["/admin/hub/sales", "/admin/clients", "/admin/money", "/admin/live-chat", "/admin/hub/content", "/admin/hub/ai", "/admin/system", "/admin/hub/organisation"]) expect(out).toContain(`href="${href}"`);
    const agent = BUILT_IN_ROLES.find((r) => r.key === "sales_agent")!.permissions;
    const agentOut = html(el(AreaCards, { groups: navFor(agent).filter((g) => g.id !== "home") }));
    expect(agentOut).toContain('href="/admin/hub/sales"'); // My clients and the leaderboard
    const support = BUILT_IN_ROLES.find((r) => r.key === "support")!.permissions;
    // Support opens only Quote requests in Sales: the card goes straight there.
    expect(html(el(AreaCards, { groups: navFor(support).filter((g) => g.id !== "home") }))).toContain('href="/admin/quotes"');
    expect(agentOut).not.toContain("/admin/money");
  });

  it("shows money, clients and AI only when allowed", () => {
    const out = html(el(OverviewDashboard, { d, today: false, show: { money: false, clients: true, ai: false } }));
    expect(out).not.toContain("/admin/revenue");
    expect(out).toContain("/admin/client-health");
    expect(out).not.toContain("AI this month");
  });

  it("keeps the timeline short, the rest one tap away", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, at: "2026-11-10T08:00:00Z", kind: "signup" as const, text: `Company ${i} signed up.`, href: null }));
    const out = html(el(TodayTimeline, { items }));
    expect(out).toContain("Show 3 more");
    expect(out).toContain("Company 8 signed up.");
  });
});

describe("shell", () => {
  it("has the phone tab bar, the More sheet with every group, and the sidebar hub links", () => {
    const out = html(el(ThemeProvider, null, el(AdminShell, { email: "office@example.com", permissions: ALL_PERMISSIONS, badges: { quotes: { count: 3, tone: "danger", label: "3 quote requests to call" } }, currency: "RWF" }, el("p", null, "page"))));
    expect(out).toContain('aria-label="Main sections"');
    for (const label of ["Overview", "Inbox", "Clients", "Sales", "More"]) expect(out).toContain(`>${label}<`);
    expect(out).toContain('aria-label="More"');
    expect(out).toContain('aria-label="All of Money, as cards"');
    // The Money hub is the current page.
    expect(out).toMatch(/href="\/admin\/money"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/admin\/money"/);
    expect(out).toContain("Every area");
    expect(out).toContain("Show amounts in");
    expect(out).toContain('action="/auth/signout"');
  });

  it("hides what a sales agent may not open", () => {
    const agent = BUILT_IN_ROLES.find((r) => r.key === "sales_agent")!.permissions;
    const out = html(el(ThemeProvider, null, el(AdminShell, { email: "agent@example.com", permissions: agent, badges: {} }, el("p", null, "page"))));
    expect(out).toContain('href="/admin/sales"');
    for (const hidden of ["/admin/payments", "/admin/money", "/admin/companies", "/admin/settings", "/admin/quotes"]) expect(out).not.toContain(`href="${hidden}"`);
  });
});

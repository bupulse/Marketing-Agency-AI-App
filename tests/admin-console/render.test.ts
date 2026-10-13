import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The redesigned admin screens render from plain data, so they are checked here without a database: with nothing at
// all (a fresh install) and with some data.

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/invoices/inv1", useRouter: () => ({ push: vi.fn() }) }));

import { AdminShell } from "@/components/admin/shell";
import { ThemeProvider } from "@/components/theme";
import { ALL_PERMISSIONS } from "@/lib/staff/permissions";
import { OverviewDashboard, type OverviewData } from "@/components/admin/overview-dashboard";
import { InboxView } from "@/components/admin/inbox-view";
import { RevenueView } from "@/components/admin/money/revenue-view";
import { CostLinesTable, MonthCostTable } from "@/components/admin/money/cost-tables";
import { ClientHealthView } from "@/components/admin/clients/health-view";
import { UsageView } from "@/components/admin/clients/usage-view";
import type { ClientRow } from "@/lib/admin/client-health";
import { buildMonthCosts } from "@/lib/money/costs-shared";
import type { MoneyReport } from "@/lib/money/report";
import { revenueByMonth } from "@/lib/money/revenue-shared";

const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

const emptyOverview: OverviewData = {
  monthLabel: "October 2026",
  prevMonthLabel: "September",
  revenue: { monthCents: 0, prevCents: 0, lifetimeCents: 0, customersEver: 0, spark: [] },
  mrrCents: 0,
  arpuCents: null,
  profit: { monthCents: 0, prevCents: 0, costCents: 0, estimateCents: 0, spark: [] },
  clients: { active: 0, trial: 0, pastDue: 0, waitingDemo: 0 },
  todo: { inbox: 0, payments: 0, demosToday: 0, nextDemo: null, errors24h: 0 },
  ai: null,
};

function report(over: Partial<MoneyReport> = {}): MoneyReport {
  const months = ["2026-09", "2026-10"];
  const costs = buildMonthCosts({ months, ledger: [], bills: [], recurring: [], entered: [], rwfPerUsd: 1450 });
  const revenue = revenueByMonth([], months);
  return {
    now: "2026-10-13T00:00:00Z",
    thisMonth: "2026-10",
    truncated: false,
    rwfPerUsd: 1450,
    months: months.map((m, i) => ({ month: m, revenue: revenue[i], costs: costs[i], profitCents: 0, rate: null })),
    lifetime: { revenueCents: 0, costCents: 0, profitCents: 0, customersEver: 0, payingNow: 0, churned: 0, firstMonth: null },
    mrrCents: 0,
    arpuCents: null,
    churn: { lost30: 0, pct: null },
    byPlan: [],
    clients: [],
    ...over,
  };
}

const row = (over: Partial<ClientRow> = {}): ClientRow => ({
  businessId: "b1", userId: "u1", name: "Kigali Salon", email: "owner@example.com", phone: "0788123456", plan: "STANDARD", status: "PAST_DUE",
  trialEndsAt: null, periodStart: "2026-10-01T00:00:00Z", lastActiveAt: null,
  used: { text: 5, image: 1, videoSeconds: 0, voiceCharacters: 0, chat: 3 }, limits: { text: 100, image: 30, videoSeconds: 0, voiceCharacters: 0, chat: 1000 },
  usageShare: 0.05, aiCostMonthCents: 250, mrrCents: 2000, flags: ["past_due", "inactive"], risk: "high", score: 5, ...over,
});

describe("admin shell", () => {
  it("shows the folders, counts, breadcrumbs and search", () => {
    const out = html(createElement(ThemeProvider, null, createElement(AdminShell, { email: "admin@bupulse.com", permissions: ALL_PERMISSIONS, badges: { inbox: { count: 3, tone: "danger", label: "3 items" }, payments: { count: 1, tone: "danger", label: "1 payment" } } } as unknown as Parameters<typeof AdminShell>[0], createElement("p", null, "page"))));
    for (const text of ["Clients", "Money", "Content", "AI and usage", "System", "Inbox", "Costs", "Client health", "Usage per client", "Search", "Breadcrumb"]) expect(out).toContain(text);
    expect(out).toContain('aria-label="3 items"');
    // The Invoices page is current, inside Money.
    expect(out).toMatch(/aria-current="page"[^>]*href="\/admin\/invoices"|href="\/admin\/invoices"[^>]*aria-current="page"/);
    expect(out).toContain("Details");
  });
});

describe("overview", () => {
  it("renders a fresh install with zeros and links into each folder", () => {
    const out = html(createElement(OverviewDashboard, { d: emptyOverview }));
    for (const href of ["/admin/inbox", "/admin/payments", "/admin/demos", "/admin/errors", "/admin/revenue", "/admin/costs", "/admin/client-health", "/admin/ai"]) expect(out).toContain(`href="${href}`);
    expect(out).toContain("No paying clients yet");
    expect(out).toContain("could not be read");
  });
  it("shows AI spend against the budget and a paused cap", () => {
    const out = html(createElement(OverviewDashboard, { d: { ...emptyOverview, ai: { spentCents: 2000, capCents: 2000, pct: 100, paused: true }, profit: { ...emptyOverview.profit, monthCents: -500 } } }));
    expect(out).toContain("$20.00 of $20.00");
    expect(out).toContain("AI features are paused");
  });
});

describe("inbox", () => {
  it("says inbox zero when nothing waits", () => {
    expect(html(createElement(InboxView, { sections: [] }))).toContain("Inbox zero");
  });
  it("lists a section with its count and a link to all", () => {
    const out = html(createElement(InboxView, { sections: [{ key: "payments", title: "Payments to confirm", why: "Check them.", href: "/admin/payments", count: 7, tone: "danger", items: [{ id: "p1", text: "Kigali Salon paid RWF 29,000", href: "/admin/payments", at: "2026-10-13T08:00:00Z" }] }] }));
    expect(out).toContain("Payments to confirm");
    expect(out).toContain("See all 7");
  });
});

describe("revenue and costs", () => {
  it("renders with no payments and no costs", () => {
    const out = html(createElement(RevenueView, { r: report() }));
    expect(out).toContain("No payments or costs yet");
    expect(out).toContain("How we calculate this");
    expect(out).toContain("No client has paid yet");
  });
  it("says when the oldest payments were left out", () => {
    expect(html(createElement(RevenueView, { r: report({ truncated: true }) }))).toContain("oldest payments are left out");
  });
  it("lists deleted clients and their lifetime revenue", () => {
    const out = html(createElement(RevenueView, { r: report({ clients: [{ userId: "gone", businessId: null, name: "Deleted account", email: null, plan: null, status: null, paying: false, deleted: true, revenueCents: 4000, payments: 2, firstAt: "2026-01-05T00:00:00Z", lastAt: "2026-02-05T00:00:00Z", aiCostCents: 0, mrrCents: 0 }], lifetime: { revenueCents: 4000, costCents: 0, profitCents: 4000, customersEver: 1, payingNow: 0, churned: 1, firstMonth: "2026-01" } }) }));
    expect(out).toContain("Deleted account");
    expect(out).toContain("$40.00");
  });
  it("marks billed and estimated cost lines", () => {
    const [m] = buildMonthCosts({ months: ["2026-10"], ledger: [{ month: "2026-10", provider: "gemini", cents: 40, calls: 3, estimatedCalls: 1 }, { month: "2026-10", provider: "elevenlabs", cents: 90, calls: 2, estimatedCalls: 0 }], bills: [{ provider: "google_ai", month: "2026-10", usdCents: 100 }], recurring: [], entered: [], rwfPerUsd: 1450 });
    const out = html(createElement(CostLinesTable, { month: m }));
    expect(out).toContain("billed");
    expect(out).toContain("estimate");
    expect(out).toContain("bill is 150% higher");
    expect(out).toContain("1 timed out (estimated)");
    expect(html(createElement(MonthCostTable, { months: [m] }))).toContain("estimated");
    expect(html(createElement(CostLinesTable, { month: undefined }))).toContain("No costs for this month yet");
  });
});

describe("clients", () => {
  it("client health shows who needs a call, with WhatsApp and email", () => {
    const out = html(createElement(ClientHealthView, { rows: [row(), row({ businessId: "b2", name: "Fine Shop", flags: [], risk: "ok", score: 0 })], flag: null, now: Date.parse("2026-10-13T00:00:00Z") }));
    expect(out).toContain("Kigali Salon");
    expect(out).not.toContain("Fine Shop</a>");
    expect(out).toContain("https://wa.me/250788123456");
    expect(out).toContain("mailto:owner@example.com");
    expect(html(createElement(ClientHealthView, { rows: [], flag: null, now: 0 }))).toContain("No companies yet");
  });
  it("usage per client shows cost, what they pay and margin", () => {
    const out = html(createElement(UsageView, { rows: [row({ status: "ACTIVE" })], sort: "cost" }));
    expect(out).toContain("$2.50");
    expect(out).toContain("$17.50");
    expect(out).toContain("88%");
    expect(html(createElement(UsageView, { rows: [], sort: "cost" }))).toContain("No current clients yet");
  });
});

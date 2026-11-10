// Round 2 (part C) of the admin redesign: AI, Content, Inbox and Live chat. Pure helpers and server-rendered views.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/components/ui/toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/toast")>()), useToast: () => ({ toast: () => {} }) }));

import { InboxView, inboxShown } from "@/components/admin/inbox-view";
import { agentCounts, hoursSummary } from "@/components/admin/live-chat/summary";
import { LiveChatHub } from "@/components/admin/live-chat/hub";
import { monthChoices, monthLabel, recentMonths } from "@/components/admin/content-ai/months";
import { announcementState } from "@/components/admin/content-ai/announcements-view";
import { FormChips, FormSwitch } from "@/components/admin/kit/form-chips";
import { DEFAULT_SUPPORT_SETTINGS } from "@/lib/support/settings";
import type { InboxSection } from "@/lib/admin/inbox";
import type { AgentAdminView } from "@/lib/support/agents";

const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

const section = (key: InboxSection["key"], count: number): InboxSection => ({ key, title: `${key} title`, why: "Why.", href: `/admin/${key}`, count, tone: "danger", items: [{ id: `${key}1`, text: `${key} item`, href: `/admin/${key}` }] });

describe("inbox", () => {
  const sections = [section("quotes", 3), section("payments", 2), section("errors", 4)];
  it("shows one chip per kind and counts everything but errors under Everything", () => {
    const out = html(createElement(InboxView, { sections }));
    expect(out).toContain('aria-label="Show to-dos"');
    expect(out).toMatch(/Everything<span[^>]*>5</);
    expect(out).toContain('href="/admin/inbox?show=payments"');
  });
  it("shows only the chosen kind, and ignores an unknown one", () => {
    expect(inboxShown(sections, "payments")).toBe("payments");
    expect(inboxShown(sections, "nope")).toBe("");
    const out = html(createElement(InboxView, { sections, show: "payments" }));
    expect(out).toContain("payments item");
    expect(out).not.toContain("quotes item");
  });
});

describe("live chat hub", () => {
  it("sums up the week Monday first, running same-hour days together", () => {
    expect(hoursSummary(DEFAULT_SUPPORT_SETTINGS.hours)).toBe("Mon–Sat 08:00–20:00 · Sun closed");
    expect(hoursSummary({})).toBe("Closed every day");
    const all = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ from: "09:00", to: "17:00" }]]));
    expect(hoursSummary(all)).toBe("Every day 09:00–17:00");
    expect(hoursSummary({ "1": [{ from: "08:00", to: "12:00" }], "3": [{ from: "08:00", to: "12:00" }, { from: "14:00", to: "18:00" }] })).toBe("Mon 08:00–12:00 · Tue closed · Wed 08:00–12:00 + · Thu–Sun closed");
  });
  it("counts agents by state", () => {
    expect(agentCounts([{ status: "active" }, { status: "pending" }, { status: "pending" }, { status: "locked" }])).toEqual({ total: 4, active: 1, invited: 0, pending: 2, locked: 1 });
  });
  it("puts join requests first and links every card to its ?tab=", () => {
    const agents = [{ status: "active" }, { status: "pending" }] as AgentAdminView[];
    const out = html(createElement(LiveChatHub, { agents, departments: [], settings: DEFAULT_SUPPORT_SETTINGS, leads: { count: 50, more: true } }));
    expect(out.indexOf("1 person asked to join")).toBeLessThan(out.indexOf('href="/admin/live-chat?tab=departments"'));
    for (const tab of ["agents", "departments", "hours", "greetings", "ai", "leads"]) expect(out).toContain(`href="/admin/live-chat?tab=${tab}"`);
    expect(out).toContain("50+");
  });
});

describe("months for the AI spend chips", () => {
  it("labels and lists months, newest first, across a year end", () => {
    expect(monthLabel("2026-11")).toBe("Nov 2026");
    expect(recentMonths("2026-02", 4)).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
    expect(recentMonths("nope")).toEqual([]);
  });
  it("adds an older month that is being shown (a link from Costs)", () => {
    expect(monthChoices("2026-11", "2026-10")).toHaveLength(6);
    expect(monthChoices("2026-11", "2025-01")).toEqual([...recentMonths("2026-11"), "2025-01"]);
  });
});

describe("announcements", () => {
  it("is scheduled, live or ended at a moment", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(announcementState({ startsAt: new Date("2026-11-11T00:00:00Z"), endsAt: null }, now)).toBe("scheduled");
    expect(announcementState({ startsAt: new Date("2026-11-01T00:00:00Z"), endsAt: null }, now)).toBe("live");
    expect(announcementState({ startsAt: new Date("2026-11-01T00:00:00Z"), endsAt: new Date("2026-11-10T11:00:00Z") }, now)).toBe("ended");
  });
});

describe("form chips (kit)", () => {
  it("are real radio buttons or checkboxes with the chosen ones checked", () => {
    const one = html(createElement(FormChips, { name: "mood", legend: "Mood", options: [{ value: "calm", label: "Calm" }, { value: "upbeat", label: "Upbeat" }], defaultValue: "upbeat", required: true }));
    expect(one).toContain("<legend");
    expect(one).toMatch(/<input(?=[^>]*type="radio")(?=[^>]*name="mood")(?=[^>]*value="upbeat")(?=[^>]*checked="")/);
    expect(one).not.toMatch(/<input(?=[^>]*value="calm")(?=[^>]*checked)/);
    const many = html(createElement(FormChips, { name: "plans", legend: "Show to", options: [{ value: "PRO", label: "Pro" }, { value: "BUSINESS", label: "Business" }], defaultValue: ["PRO", "BUSINESS"], multiple: true }));
    expect(many.match(/<input(?=[^>]*type="checkbox")(?=[^>]*name="plans")(?=[^>]*checked)[^>]*>/g)).toHaveLength(2);
  });
  it("a switch is a named checkbox", () => {
    expect(html(createElement(FormSwitch, { name: "aiEnabled", label: "AI answers", defaultChecked: true }))).toMatch(/<input(?=[^>]*type="checkbox")(?=[^>]*name="aiEnabled")(?=[^>]*checked="")/);
  });
});

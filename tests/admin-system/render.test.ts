import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/settings", useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import { RadioChips, SwitchRow } from "@/components/admin/kit/form-choices";
import { SettingsHub, type SettingsHubData } from "@/components/admin/system/settings/settings-hub";
import { SETTINGS_SLUGS } from "@/components/admin/system/settings-areas";
import { ServicesGrid, type ServiceCardData } from "@/components/admin/system/services/services-grid";
import { HealthView, healthTodos } from "@/components/admin/system/health-view";
import { AuditView, ErrorsView } from "@/components/admin/system/logs-view";
import type { SystemHealth } from "@/lib/admin/health";

const html = (type: unknown, props: unknown) => renderToStaticMarkup(createElement(type as never, props as never));

const HUB: SettingsHubData = { momoReady: false, paddleReady: true, paddleLive: true, vatEnabled: true, vatRatePercent: 18, vatTin: "", usdToRwf: 1450, displayCurrency: "RWF", revenueGoalRwf: 9_000_000, dailyPosts: true, skitVideos: false, voicesApproved: 0, voicesTotal: 2, telegram: "connected", google: "reconnect", slotMinutes: 30, windows: 0, trialDays: 14, pageLoader: "bar", canRegions: false };

describe("form choices", () => {
  it("RadioChips posts name=value like the select it replaces, with the default ticked", () => {
    const out = html(RadioChips, { name: "environment", legend: "Which account", defaultValue: "production", options: [{ value: "sandbox", label: "Sandbox" }, { value: "production", label: "Live" }] });
    expect(out).toContain("<fieldset");
    expect(out).toContain("<legend");
    expect(out.match(/type="radio"/g)).toHaveLength(2);
    expect(out).toMatch(/<input type="radio"[^>]*name="environment" checked="" value="production"/);
    expect(out).not.toMatch(/checked="" value="sandbox"/);
  });

  it("SwitchRow is a real checkbox with the switch role", () => {
    const out = html(SwitchRow, { name: "dailyPosts", label: "Make daily posts", defaultChecked: true });
    expect(out).toMatch(/<input type="checkbox" role="switch"[^>]*name="dailyPosts" checked=""/);
    expect(out).toContain("Make daily posts");
  });
});

describe("Settings hub", () => {
  it("has a card for every settings page, plus Updates; Regions only with plans.manage", () => {
    const out = html(SettingsHub, { d: HUB });
    for (const slug of SETTINGS_SLUGS) expect(out).toContain(`href="/admin/settings/${slug}"`);
    expect(out).toContain('href="/admin/settings/updates"');
    expect(out).not.toContain('href="/admin/settings/regions"');
    expect(html(SettingsHub, { d: { ...HUB, canRegions: true } })).toContain('href="/admin/settings/regions"');
  });

  it("flags what needs the owner and shows the save message", () => {
    const out = html(SettingsHub, { d: HUB, ok: "Settings saved." });
    expect(out).toContain('aria-label="Google Calendar needs reconnecting"');
    expect(out).toContain('aria-label="Nobody can book a call"');
    expect(out).toContain('aria-label="Mobile Money is not set up"');
    expect(out).toContain('role="status"');
    expect(out).toContain("Settings saved.");
  });
});

const SERVICES: ServiceCardData[] = [
  { id: "gemini", name: "Google Gemini", purpose: "Writes captions.", health: "ok", whenOff: "AI writing stops.", lastCheck: { ok: true, checkedAt: "2026-11-10T08:00:00Z" } },
  { id: "elevenlabs", name: "ElevenLabs", purpose: "Speaks voiceovers.", health: "down", whenOff: "No voiceover.", lastCheck: { ok: false, checkedAt: "2026-11-10T07:00:00Z" } },
  { id: "canva", name: "Canva", purpose: "Edit in Canva.", health: "not_connected", whenOff: "Button hidden.", lastCheck: null },
];
const EXTRAS = { inbox: { ready: true }, custom: { count: 0, broken: 0 }, robot: { label: "Working", tone: "good" as const } };

describe("Services grid", () => {
  it("links each service to its own page, broken ones first, with the if-off line", () => {
    const out = html(ServicesGrid, { services: SERVICES, extras: EXTRAS, filter: "", sp: {}, unreadable: [], now: new Date("2026-11-10T09:00:00Z") });
    expect(out).toContain('href="/admin/services/gemini"');
    expect(out).toContain('href="/admin/services/inbox"');
    expect(out).toContain('href="/admin/services/custom-keys"');
    expect(out).toContain('href="/admin/services/video-robot"');
    expect(out.indexOf("ElevenLabs")).toBeLessThan(out.indexOf("Google Gemini"));
    expect(out).toContain("No voiceover.");
    expect(out).toContain("2 h ago");
  });

  it("the Needs you chip shows only what needs the owner", () => {
    const out = html(ServicesGrid, { services: SERVICES, extras: EXTRAS, filter: "attention", sp: { show: "attention" }, unreadable: ["X_KEY"] });
    expect(out).toContain('href="/admin/services/elevenlabs"');
    expect(out).not.toContain('href="/admin/services/gemini"');
    expect(out).toContain("X_KEY");
  });
});

const H = {
  generatedAt: "2026-11-10T09:00:00Z",
  status: "problem",
  issues: [
    { level: "warning", key: "approvals", text: "A money request has waited 2 days.", href: "/admin/approvals" },
    { level: "problem", key: "posts-stuck", text: "3 posts are stuck.", href: "/admin/health" },
  ],
  crons: [],
  queues: { postsOverdue: 0, postsStuck: 3, needsAction: 0, webhookPending: 0, webhookFailed24h: 0, webhookTotal24h: 0, pendingApprovals: 1, oldestApprovalHours: 50 },
  errors: { lastHour: 0, last24h: 0, perHour: [], top: [] },
  db: null,
  storage: null,
} as unknown as SystemHealth;

describe("Health", () => {
  it("lists problems first, then failing services, then warnings, then services switched off", () => {
    const todos = healthTodos(H, { failing: [{ key: "meta", label: "Meta", reason: "401" }], off: [{ key: "veo", label: "Veo", reason: "Switched off" }] });
    expect(todos.map((t) => t.key)).toEqual(["posts-stuck", "failing:meta", "approvals", "off:veo"]);
    expect(todos[1].href).toBe("/admin/services/meta");
  });

  it("renders the overall status in words", () => {
    const out = html(HealthView, { h: H, services: { failing: [], off: [] } });
    expect(out).toContain("Problem");
    expect(out).toContain("3 posts are stuck.");
  });
});

describe("Errors and audit log", () => {
  it("errors: kind and period chips keep the URL parameters the page reads", () => {
    const out = html(ErrorsView, { items: [], more: false, next: null, f: { level: "warn", source: "", userId: "", days: "30" }, sp: { level: "warn", days: "30" }, bad: null });
    expect(out).toContain('href="/admin/errors?days=30"'); // "Errors and warnings" drops level
    expect(out).toContain('href="/admin/errors?level=warn"'); // "7 days" is the default: no days
    expect(out).toContain("No errors match.");
  });

  it("audit: an entry opens to show what changed, in words for screen readers", () => {
    const out = html(AuditView, { items: [{ id: "a", createdAt: "2026-11-10T09:00:00Z", actor: "admin", action: "save_setting", target: "user:u1", ip: null, before: { trialDays: 7 }, after: { trialDays: 14 } }], more: false, next: null, f: { actor: "", action: "", target: "", since: "", until: "" }, bad: null });
    expect(out).toContain("<details");
    expect(out).toContain("Before: </span>");
    expect(out).toContain('href="/admin/users/u1"');
  });
});

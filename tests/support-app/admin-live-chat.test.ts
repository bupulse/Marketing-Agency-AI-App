import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
// The confirm buttons show their outcome as a toast; rendered here without the app's ToastProvider.
vi.mock("@/components/ui/toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/toast")>()), useToast: () => ({ toast: () => {} }) }));

import { AgentsView, hasSignedIn } from "@/components/admin/live-chat/agents-view";
import { GreetingsForm, HoursForm } from "@/components/admin/live-chat/settings-forms";
import { LiveChatTabs, liveChatTab } from "@/components/admin/live-chat/tabs";
import { breadcrumbsFor, navFor, searchPages } from "@/components/admin/nav";
import { ALL_PERMISSIONS, permissionsOf } from "@/lib/staff/permissions";
import type { AgentAdminView, DepartmentView } from "@/lib/support/agents";
import { aiFromForm, greetingsFromForm, hoursFromForm } from "@/lib/support/settings-form";

const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const form = (entries: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};

describe("team hours form", () => {
  it("saves ticked days with their times and leaves unticked days out (closed)", () => {
    const f = form({ open_1: "on", from_1: "08:00", to_1: "20:00", from_2: "09:00", to_2: "17:00", open_0: "on", from_0: "10:00", to_0: "14:00" });
    expect(hoursFromForm(f, {})).toEqual({ "1": [{ from: "08:00", to: "20:00" }], "0": [{ from: "10:00", to: "14:00" }] });
  });
  it("keeps further ranges already saved for an open day, and drops them when the day is closed", () => {
    const current = { "3": [{ from: "08:00", to: "12:00" }, { from: "14:00", to: "18:00" }], "4": [{ from: "08:00", to: "12:00" }, { from: "14:00", to: "18:00" }] };
    const out = hoursFromForm(form({ open_3: "on", from_3: "07:30", to_3: "12:00", from_4: "08:00", to_4: "12:00" }), current);
    expect(out).toEqual({ "3": [{ from: "07:30", to: "12:00" }, { from: "14:00", to: "18:00" }] });
  });
  it("asks for both times on an open day", () => {
    expect(() => hoursFromForm(form({ open_5: "on", from_5: "08:00", to_5: "" }), {})).toThrow(/Friday: pick the opening and closing time/);
  });
});

describe("greetings form", () => {
  it("reads rows in page order, skips the blank add row and removed rows, and splits quick replies by line", () => {
    const f = form({
      g_path_0: "/pricing", g_text_0: "  Questions about   plans? ", g_delay_0: "30", g_replies_0: "Which plan fits me?\n\n How does the trial work? \n",
      g_path_1: "/signup", g_text_1: "Need a hand?", g_delay_1: "30", g_replies_1: "", g_remove_1: "on",
      g_path_2: "*", g_text_2: "Hi!", g_delay_2: "", g_replies_2: "",
      g_path_3: "", g_text_3: "", g_delay_3: "15", g_replies_3: "",
    });
    expect(greetingsFromForm(f)).toEqual([
      { path: "/pricing", text: "Questions about plans?", delaySec: 30, quickReplies: ["Which plan fits me?", "How does the trial work?"] },
      { path: "*", text: "Hi!", delaySec: 15, quickReplies: [] },
    ]);
  });
  it("refuses a delay outside 5 to 600 seconds, more than 3 quick replies, or a row without text or page", () => {
    expect(() => greetingsFromForm(form({ g_path_0: "/pricing", g_text_0: "Hi", g_delay_0: "2" }))).toThrow(/5 to 600 seconds/);
    expect(() => greetingsFromForm(form({ g_path_0: "/pricing", g_text_0: "Hi", g_delay_0: "601" }))).toThrow(/5 to 600 seconds/);
    expect(() => greetingsFromForm(form({ g_path_0: "/pricing", g_text_0: "Hi", g_delay_0: "20", g_replies_0: "a\nb\nc\nd" }))).toThrow(/up to 3 quick replies/);
    expect(() => greetingsFromForm(form({ g_path_0: "/pricing", g_text_0: "", g_delay_0: "20", g_replies_0: "a" }))).toThrow(/write the text/);
    expect(() => greetingsFromForm(form({ g_path_0: "", g_text_0: "Hi", g_delay_0: "20" }))).toThrow(/write the page/);
  });
});

describe("AI rules form", () => {
  it("reads the switch, the rules, one topic per line (duplicates dropped) and the number without spaces", () => {
    const out = aiFromForm(form({ aiEnabled: "on", aiRules: "  Be warm.\r\nBe short.  ", handoverTopics: "refunds\n\nRefunds\n legal questions ", whatsapp: "+250 788-000 000" }));
    expect(out).toEqual({ aiEnabled: true, aiRules: "Be warm.\nBe short.", handoverTopics: ["refunds", "legal questions"], whatsapp: "+250788000000" });
    expect(aiFromForm(form({ aiRules: "", handoverTopics: "", whatsapp: "" }))).toEqual({ aiEnabled: false, aiRules: "", handoverTopics: [], whatsapp: "" });
  });
  it("refuses rules over 4000 characters and more than 30 topics", () => {
    expect(() => aiFromForm(form({ aiRules: "x".repeat(4001) }))).toThrow(/4000/);
    expect(() => aiFromForm(form({ handoverTopics: Array.from({ length: 31 }, (_, i) => `topic ${i}`).join("\n") }))).toThrow(/30/);
  });
});

const departments: DepartmentView[] = [
  { key: "sales", name: "Sales", sort: 0, agents: 1 },
  { key: "technical", name: "Technical help", sort: 1, agents: 1 },
  { key: "billing", name: "Billing", sort: 2, agents: 1 },
  { key: "creators", name: "Creators", sort: 3, agents: 1 },
];
const agent = (over: Partial<AgentAdminView>): AgentAdminView => ({ id: "a1", email: "agent@example.com", name: "Agent One", role: "AGENT", status: "active", availability: "offline", maxChats: 5, departments: ["sales"], authenticator: true, lastSeenAt: "2026-10-22T08:00:00Z", createdAt: "2026-10-01T08:00:00Z", ...over });
const actions = { invite: vi.fn(), update: vi.fn(), setLocked: vi.fn(), resend: vi.fn(), resetAuthenticator: vi.fn() };
const row = (out: string, name: string) => out.slice(out.indexOf(name), out.indexOf("</tr>", out.indexOf(name)));

describe("agents table", () => {
  const out = html(createElement(AgentsView, { departments, actions, agents: [
    agent({ id: "s1", name: "Grace Supervisor", role: "SUPERVISOR", departments: [] }),
    agent({ id: "j1", name: "Jean Agent", departments: ["billing", "sales"] }),
    agent({ id: "i1", name: "Samuel Invited", status: "invited", authenticator: false, lastSeenAt: null, departments: ["creators"] }),
    agent({ id: "l1", name: "Locked Lucie", status: "locked" }),
  ] }));

  it("shows departments by name, All for a supervisor with none, and the 6-digit code state", () => {
    expect(row(out, "Grace Supervisor")).toContain(">All<");
    expect(row(out, "Jean Agent")).toContain("Sales, Billing");
    expect(row(out, "Jean Agent")).toContain(">On<");
    expect(row(out, "Samuel Invited")).toContain("Invite sent");
    expect(row(out, "Samuel Invited")).toContain(">Never<");
  });
  it("offers Resend invite only to an invited agent, and no Reset authenticator before a first sign-in", () => {
    expect(row(out, "Samuel Invited")).toContain("Resend invite");
    expect(row(out, "Samuel Invited")).not.toContain("Reset authenticator");
    expect(row(out, "Jean Agent")).not.toContain("Resend invite");
    expect(row(out, "Jean Agent")).toContain("Reset authenticator");
  });
  it("shows Unlock for a locked agent and Lock for the others", () => {
    expect(row(out, "Locked Lucie")).toContain(">Unlock<");
    expect(row(out, "Locked Lucie")).not.toContain(">Lock<");
    expect(row(out, "Jean Agent")).toContain(">Lock<");
  });
  it("has the Add an agent form with the roles and the four departments", () => {
    expect(out).toContain("Add an agent");
    expect(out).toContain("Agent: replies to chats");
    expect(out).toContain("Supervisor: sees all chats and stats");
    for (const d of departments) expect(out).toContain(`value="${d.key}"`);
    expect(out).toContain("Send invite");
  });
  it("knows who has signed in", () => {
    expect(hasSignedIn({ status: "invited", authenticator: false, lastSeenAt: null })).toBe(false);
    expect(hasSignedIn({ status: "locked", authenticator: false, lastSeenAt: "2026-10-22T08:00:00Z" })).toBe(true);
    expect(hasSignedIn({ status: "locked", authenticator: true, lastSeenAt: null })).toBe(true);
  });
});

describe("settings tabs", () => {
  it("lists the week Monday first and ticks only the open days", () => {
    const out = html(createElement(HoursForm, { hours: { "1": [{ from: "08:00", to: "20:00" }, { from: "21:00", to: "22:00" }] }, save: vi.fn() }));
    expect(out.indexOf("Monday")).toBeLessThan(out.indexOf("Sunday"));
    expect(out).toMatch(/name="open_1"[^>]*checked/);
    expect(out).not.toMatch(/name="open_2"[^>]*checked/);
    expect(out).toContain("21:00 to 22:00 (kept)");
  });
  it("shows the saved greetings and one blank row to add another", () => {
    const out = html(createElement(GreetingsForm, { greetings: [{ path: "/pricing", text: "Questions?", delaySec: 30, quickReplies: ["A", "B"] }], save: vi.fn() }));
    expect(out).toContain('value="/pricing"');
    expect(out).toContain("Add a greeting");
    expect(out).toContain('name="g_path_1"');
    expect(out).toContain('name="g_remove_0"');
    expect(out).not.toContain('name="g_remove_1"');
  });
  it("tabs are links with the current one marked", () => {
    const out = html(createElement(LiveChatTabs, { current: "hours" }));
    expect(out).toContain('href="/admin/live-chat?tab=greetings"');
    expect(out).toMatch(/aria-current="page"[^>]*>Team hours</);
    expect(liveChatTab("nope")).toBe("agents");
    expect(liveChatTab("ai")).toBe("ai");
  });
});

describe("admin menu", () => {
  it("shows Live chat only with the liveChat permission", () => {
    const hrefs = (perms: readonly Parameters<typeof navFor>[0][number][]) => navFor(perms).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs(["liveChat"])).toEqual(["/admin/live-chat"]);
    expect(hrefs(ALL_PERMISSIONS)).toContain("/admin/live-chat");
    expect(hrefs(permissionsOf("sales_agent"))).not.toContain("/admin/live-chat");
    expect(hrefs(["overview", "system"])).not.toContain("/admin/live-chat");
  });
  it("sits after Money, is found by search and does not repeat itself in the breadcrumbs", () => {
    const titles = navFor(ALL_PERMISSIONS).map((g) => g.title);
    expect(titles.indexOf("Live chat")).toBe(titles.indexOf("Money") + 1);
    expect(searchPages("helpdesk")[0]?.href).toBe("/admin/live-chat");
    expect(breadcrumbsFor("/admin/live-chat")).toEqual([{ label: "Admin", href: "/admin" }, { label: "Live chat", href: undefined }]);
  });
});

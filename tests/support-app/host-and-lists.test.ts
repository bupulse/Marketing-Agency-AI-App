import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: auth.user } }), getClaims: async () => ({ data: auth.user ? { claims: { sub: (auth.user as { id?: string }).id ?? "user" } } : null }) } }) }));

import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { isSupportHost, supportBaseFor, supportHref, supportRoute } from "@/lib/support/app-host";
import { ago, conversationTags, filterVisitors, inView, matchesSearch, sortConversations, sortVisitors, surfaceOfPath, viewCounts, visitorAction, visitorCounts, waitingTimer } from "@/lib/support/app-client/lists";
import { mockData, MOCK_AGENT } from "@/lib/support/app-client/mock";
import type { ConversationListItem } from "@/lib/support/contract";

// The support app at support.bupulse.com (docs/SUPPORT_CHAT.md "Support app and Admin"): host routing and the list rules.

const request = (url: string, host?: string) => new NextRequest(url, { headers: host ? { host } : {} });

describe("support host routing", () => {
  it("knows the support hosts, with or without a port, and nothing else", () => {
    expect(isSupportHost("support.bupulse.com")).toBe(true);
    expect(isSupportHost("SUPPORT.localhost:3013")).toBe(true);
    expect(isSupportHost("support-test.bupulse.com")).toBe(true);
    expect(isSupportHost("test.bupulse.com")).toBe(false);
    expect(isSupportHost("bupulse.com")).toBe(false);
    expect(isSupportHost("support.bupulse.com.evil.test")).toBe(false);
    expect(isSupportHost(null)).toBe(false);
  });
  it("rewrites the support host's pages under /support and leaves its assets and API alone", () => {
    expect(supportRoute("/", "support.bupulse.com")).toEqual({ action: "rewrite", path: "/support" });
    expect(supportRoute("/visitors", "support.bupulse.com")).toEqual({ action: "rewrite", path: "/support/visitors" });
    expect(supportRoute("/dashboard", "support.bupulse.com")).toEqual({ action: "rewrite", path: "/support/dashboard" }); // not found there
    expect(supportRoute("/admin", "support.bupulse.com")).toEqual({ action: "rewrite", path: "/support/admin" });
    for (const p of ["/_next/static/x.js", "/api/support/v1/agent/me", "/support-sw.js", "/icons/icon-192.png", "/support/visitors"]) expect(supportRoute(p, "support.bupulse.com")).toEqual({ action: "pass" });
    expect(supportRoute("/visitors", "bupulse.com")).toBeNull();
  });
  it("builds links for each base", () => {
    expect(supportBaseFor("support.bupulse.com")).toBe("");
    expect(supportBaseFor("localhost:3013")).toBe("/support");
    expect(supportHref("", "/")).toBe("/");
    expect(supportHref("", "/chats")).toBe("/chats");
    expect(supportHref("/support", "/")).toBe("/support");
    expect(supportHref("/support", "visitors")).toBe("/support/visitors");
  });
  it("the proxy rewrites on the support host, keeps the query, and marks the app noindex", async () => {
    const res = await proxy(request("https://support.bupulse.com/visitors?x=1", "support.bupulse.com"));
    expect(res.headers.get("x-middleware-rewrite")).toBe("https://support.bupulse.com/support/visitors?x=1");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
  it("the support host never sends a signed-out person to the dashboard's login", async () => {
    const res = await proxy(request("https://support.bupulse.com/dashboard", "support.bupulse.com"));
    expect(res.status).not.toBe(307);
    expect(res.headers.get("x-middleware-rewrite")).toBe("https://support.bupulse.com/support/dashboard");
  });
  it("the main site is unchanged, except /support is noindex", async () => {
    const home = await proxy(request("https://bupulse.com/pricing", "bupulse.com"));
    expect(home.headers.get("x-middleware-rewrite")).toBeNull();
    expect(home.headers.get("x-robots-tag")).toBeNull();
    const dash = await proxy(request("https://bupulse.com/dashboard", "bupulse.com"));
    expect(dash.headers.get("location")).toContain("/login?next=%2Fdashboard");
    const app = await proxy(request("https://bupulse.com/support/visitors", "bupulse.com"));
    expect(app.headers.get("x-middleware-rewrite")).toBeNull();
    expect(app.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});

const NOW = Date.parse("2026-10-23T10:00:00Z");
const chat = (over: Partial<ConversationListItem>): ConversationListItem => ({ id: "x", number: 1, status: "AI", visitorName: "V", businessName: null, preview: "", lastMessageAt: new Date(NOW - 60_000).toISOString(), waitingSince: null, department: null, assigneeName: null, tags: [], urgency: null, leadScore: null, language: null, unread: false, ...over });

describe("chat lists", () => {
  it("puts waiting chats first (longest wait first), then upset or hot leads, then the newest; closed last", () => {
    const items = [
      chat({ id: "new", lastMessageAt: new Date(NOW - 10_000).toISOString() }),
      chat({ id: "closed", status: "CLOSED", lastMessageAt: new Date(NOW).toISOString() }),
      chat({ id: "hot", leadScore: 82, lastMessageAt: new Date(NOW - 600_000).toISOString() }),
      chat({ id: "wait-short", status: "WAITING", waitingSince: new Date(NOW - 30_000).toISOString() }),
      chat({ id: "upset", urgency: "upset", lastMessageAt: new Date(NOW - 900_000).toISOString() }),
      chat({ id: "wait-long", status: "WAITING", waitingSince: new Date(NOW - 300_000).toISOString() }),
    ];
    expect(sortConversations(items).map((c) => c.id)).toEqual(["wait-long", "wait-short", "hot", "upset", "new", "closed"]);
  });
  it("counts each tab for the agent: mine are open chats assigned to them", () => {
    const { list } = mockData(NOW);
    expect(viewCounts(list, MOCK_AGENT)).toEqual({ mine: 1, waiting: 1, ai: 3, all: 6 });
    expect(inView(chat({ status: "CLOSED", assigneeName: MOCK_AGENT.name }), "mine", MOCK_AGENT)).toBe(false);
  });
  it("tags urgency, department, hot lead, language and who answers", () => {
    const tags = conversationTags(chat({ urgency: "upset", department: "technical", leadScore: 75, language: "rw", status: "AI" })).map((t) => t.label);
    expect(tags).toEqual(["Upset", "Technical", "Hot lead 75", "Kinyarwanda · translated", "AI answering"]);
    expect(conversationTags(chat({ status: "WAITING" }), "topic").map((t) => t.label)).toContain("Handed over: topic");
    expect(conversationTags(chat({ leadScore: 40, language: "en" }))).toEqual([{ label: "AI answering", tone: "success" }]);
  });
  it("searches names, businesses and messages without caring about case or accents", () => {
    const c = chat({ visitorName: "Aimé Uwase", businessName: "Salon Kigali", preview: "MoMo paid" });
    expect(matchesSearch(c, "aime")).toBe(true);
    expect(matchesSearch(c, "KIGALI")).toBe(true);
    expect(matchesSearch(c, "momo")).toBe(true);
    expect(matchesSearch(c, "pricing")).toBe(false);
    expect(matchesSearch(c, "  ")).toBe(true);
  });
  it("shows the wait as a timer and the age in words", () => {
    expect(waitingTimer(new Date(NOW - 72_000).toISOString(), NOW)).toBe("1:12");
    expect(waitingTimer(new Date(NOW - 3_900_000).toISOString(), NOW)).toBe("1 h 05");
    expect(ago(new Date(NOW - 20_000).toISOString(), NOW)).toBe("now");
    expect(ago(new Date(NOW - 4 * 60_000).toISOString(), NOW)).toBe("4 min");
    expect(ago(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe("3 h");
  });
});

describe("live visitors", () => {
  const { visitors } = mockData(NOW);
  it("groups and sorts: waiting, chatting, browsing, idle; the hottest lead first inside a group", () => {
    expect(sortVisitors(visitors).map((v) => v.group)).toEqual(["waiting", "chatting", "chatting", "browsing", "browsing", "browsing", "idle"]);
    expect(filterVisitors(visitors, "browsing", "all").map((v) => v.name)).toEqual(["Visitor 4830", "Visitor 4821", "Sample Hardware Ltd"]);
  });
  it("filters by the part of the site, read from the page", () => {
    expect(surfaceOfPath("/dashboard/calendar")).toBe("dashboard");
    expect(surfaceOfPath("/creator/payouts")).toBe("creator");
    expect(surfaceOfPath("/b/sample-bakery")).toBe("bio");
    expect(surfaceOfPath("/pricing")).toBe("public");
    expect(filterVisitors(visitors, "all", "dashboard").map((v) => v.name)).toEqual(["Aline Uwase", "Sample Hardware Ltd"]);
    expect(visitorCounts(visitors)).toEqual({ all: 7, waiting: 1, chatting: 2, browsing: 3, idle: 1 });
    expect(visitorCounts(visitors, "bio")).toEqual({ all: 1, waiting: 0, chatting: 0, browsing: 0, idle: 1 });
  });
  it("offers Open chat for a waiting chat, Join chat for one going on, Start chat for someone browsing, nothing when idle", () => {
    expect(visitorAction({ group: "waiting", conversationId: "c1" })).toBe("open");
    expect(visitorAction({ group: "chatting", conversationId: "c1" })).toBe("join");
    expect(visitorAction({ group: "browsing", conversationId: null })).toBe("start");
    expect(visitorAction({ group: "idle", conversationId: null })).toBeNull();
  });
});

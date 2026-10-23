import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { anonymousName, groupLive, liveGroup, toLiveVisitor, type LiveRow } from "@/lib/support/live";
import { DRAFT_FRESH_MS, IDLE_AFTER_MS } from "@/lib/support/limits";

const now = new Date("2026-10-23T10:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

function row(v: Partial<LiveRow> & { visitorId?: string } = {}): LiveRow {
  return {
    visitId: "v1",
    visitorId: "visitor-1",
    startedAt: ago(60_000),
    lastSeenAt: ago(5_000),
    lastPageAt: ago(30_000),
    country: "RW",
    city: "Kigali",
    currentPath: "/pricing",
    pageCount: 3,
    referrer: "google.com",
    device: "phone",
    browser: "Chrome 130",
    visitor: { name: null, businessName: null, email: null, businessId: null, creatorProfileId: null, visitCount: 2 },
    conversation: null,
    ...v,
  };
}

const chat = (status: string, extra: Partial<NonNullable<LiveRow["conversation"]>> = {}) => ({ id: "c1", status, lastMessageAt: ago(10_000), leadScore: 40, visitorDraft: null, visitorDraftAt: null, ...extra });

describe("live-visitor groups", () => {
  it("waiting: a handed-over chat (also outside hours)", () => {
    expect(liveGroup(row({ conversation: chat("WAITING") }), now)).toBe("waiting");
    expect(liveGroup(row({ conversation: chat("PENDING") }), now)).toBe("waiting");
  });
  it("chatting: an open chat with the AI or a person", () => {
    expect(liveGroup(row({ conversation: chat("AI") }), now)).toBe("chatting");
    expect(liveGroup(row({ conversation: chat("OPEN") }), now)).toBe("chatting");
  });
  it("browsing: no open chat and a recent page", () => {
    expect(liveGroup(row(), now)).toBe("browsing");
    expect(liveGroup(row({ conversation: chat("CLOSED", { lastMessageAt: ago(IDLE_AFTER_MS * 3) }) }), now)).toBe("browsing");
  });
  it("idle: no new page or message for 5 minutes", () => {
    expect(liveGroup(row({ lastPageAt: ago(IDLE_AFTER_MS) }), now)).toBe("idle");
    expect(liveGroup(row({ lastPageAt: null, startedAt: ago(IDLE_AFTER_MS + 1) }), now)).toBe("idle");
    // A message in a chat that just closed still counts as activity.
    expect(liveGroup(row({ lastPageAt: ago(IDLE_AFTER_MS * 2), conversation: chat("CLOSED", { lastMessageAt: ago(1000) }) }), now)).toBe("browsing");
  });
});

describe("live-visitor rows", () => {
  it("names people by name, then business, then a stable visitor number", () => {
    expect(toLiveVisitor(row({ visitor: { ...row().visitor, name: "Test Visitor", businessName: "Sample Shop Ltd" } }), now).name).toBe("Test Visitor");
    expect(toLiveVisitor(row({ visitor: { ...row().visitor, businessName: "Sample Shop Ltd" } }), now).name).toBe("Sample Shop Ltd");
    const anon = toLiveVisitor(row(), now).name;
    expect(anon).toMatch(/^Visitor \d{4}$/);
    expect(anon).toBe(anonymousName("visitor-1"));
    expect(anonymousName("visitor-2")).not.toBe(anonymousName("visitor-1"));
  });
  it("tells clients, creators and visitors apart", () => {
    expect(toLiveVisitor(row(), now).kind).toBe("visitor");
    expect(toLiveVisitor(row({ visitor: { ...row().visitor, businessId: "b1" } }), now).kind).toBe("client");
    expect(toLiveVisitor(row({ visitor: { ...row().visitor, businessId: "b1", creatorProfileId: "p1" } }), now).kind).toBe("creator");
  });
  it("shows a fresh draft only", () => {
    expect(toLiveVisitor(row({ conversation: chat("AI", { visitorDraft: "how do I", visitorDraftAt: ago(1000) }) }), now).typing).toBe("how do I");
    expect(toLiveVisitor(row({ conversation: chat("AI", { visitorDraft: "how do I", visitorDraftAt: ago(DRAFT_FRESH_MS) }) }), now).typing).toBeNull();
  });
  it("links only an open chat and gives time on site", () => {
    const v = toLiveVisitor(row({ conversation: chat("OPEN") }), now);
    expect(v.conversationId).toBe("c1");
    expect(v.leadScore).toBe(40);
    expect(v.secondsOnSite).toBe(55);
    expect(toLiveVisitor(row({ conversation: chat("CLOSED") }), now).conversationId).toBeNull();
  });
});

describe("grouped list", () => {
  it("keeps one row per visitor, the freshest", () => {
    const { items } = groupLive([row({ visitId: "old", lastSeenAt: ago(60_000) }), row({ visitId: "new", lastSeenAt: ago(1000) })], now);
    expect(items.map((i) => i.visitId)).toEqual(["new"]);
  });
  it("counts each group and lists waiting first, then the longest on site", () => {
    const rows = [
      row({ visitId: "b1", visitorId: "a", startedAt: ago(100_000) }),
      row({ visitId: "w", visitorId: "b", conversation: chat("WAITING") }),
      row({ visitId: "i", visitorId: "c", lastPageAt: ago(IDLE_AFTER_MS + 1) }),
      row({ visitId: "c", visitorId: "d", conversation: chat("AI") }),
      row({ visitId: "b2", visitorId: "e", startedAt: ago(200_000) }),
    ];
    const { items, counts } = groupLive(rows, now);
    expect(counts).toEqual({ waiting: 1, chatting: 1, browsing: 2, idle: 1 });
    expect(items.map((i) => i.visitId)).toEqual(["w", "c", "b2", "b1", "i"]);
  });
  it("is empty with nobody online", () => {
    expect(groupLive([], now)).toEqual({ items: [], counts: { waiting: 0, chatting: 0, browsing: 0, idle: 0 } });
  });
});

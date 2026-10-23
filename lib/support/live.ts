import "server-only";
import { prisma } from "@/lib/db";
import type { LiveVisitor, Surface } from "./contract";
import { DRAFT_FRESH_MS, IDLE_AFTER_MS, LIVE_WINDOW_MS } from "./limits";

// Who is on the site right now (docs/SUPPORT_CHAT.md section 3), from SupportVisit rows the heartbeat keeps fresh, not
// from Presence (docs/research 3.4): one query, then patches from the staff:visitors pings. Online = a heartbeat in the
// last 90 seconds. Groups: waiting (handed over, no person yet), chatting (an open chat), browsing, and idle (on the
// site but no new page or message for 5 minutes).

export type LiveRow = {
  visitId: string;
  visitorId: string;
  startedAt: Date;
  lastSeenAt: Date;
  lastPageAt: Date | null;
  country: string | null;
  city: string | null;
  currentPath: string | null;
  pageCount: number;
  referrer: string | null;
  device: string | null;
  browser: string | null;
  surface?: Surface;
  visitor: { name: string | null; businessName: string | null; email: string | null; businessId: string | null; creatorProfileId: string | null; visitCount: number };
  conversation: { id: string; status: string; lastMessageAt: Date; leadScore: number | null; visitorDraft: string | null; visitorDraftAt: Date | null } | null;
};

export function liveGroup(r: Pick<LiveRow, "lastPageAt" | "startedAt" | "conversation">, now: Date): LiveVisitor["group"] {
  const c = r.conversation;
  if (c && (c.status === "WAITING" || c.status === "PENDING")) return "waiting";
  if (c && c.status !== "CLOSED") return "chatting";
  const lastActivity = Math.max((r.lastPageAt ?? r.startedAt).getTime(), c?.lastMessageAt.getTime() ?? 0);
  return now.getTime() - lastActivity >= IDLE_AFTER_MS ? "idle" : "browsing";
}

/** "Visitor 4821": a stable short number from the visitor id, for people who never gave a name. */
export function anonymousName(visitorId: string): string {
  let h = 0;
  for (const ch of visitorId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `Visitor ${1000 + (h % 9000)}`;
}

export function toLiveVisitor(r: LiveRow, now: Date): LiveVisitor {
  const c = r.conversation;
  const draftFresh = c?.visitorDraft && c.visitorDraftAt && now.getTime() - c.visitorDraftAt.getTime() < DRAFT_FRESH_MS;
  return {
    visitId: r.visitId,
    visitorId: r.visitorId,
    name: r.visitor.name ?? r.visitor.businessName ?? anonymousName(r.visitorId),
    kind: r.visitor.creatorProfileId ? "creator" : r.visitor.businessId ? "client" : "visitor",
    group: liveGroup(r, now),
    conversationId: c && c.status !== "CLOSED" ? c.id : null,
    typing: draftFresh ? c!.visitorDraft : null,
    country: r.country,
    city: r.city,
    currentPath: r.currentPath,
    pageCount: r.pageCount,
    secondsOnSite: Math.max(0, Math.round((r.lastSeenAt.getTime() - r.startedAt.getTime()) / 1000)),
    visitCount: r.visitor.visitCount,
    referrer: r.referrer,
    device: r.device,
    browser: r.browser,
    leadScore: c?.leadScore ?? null,
    surface: r.surface,
  };
}

const ORDER: LiveVisitor["group"][] = ["waiting", "chatting", "browsing", "idle"];

/** Grouped and counted, waiting first, then the longest on site first within a group. Pure. */
export function groupLive(rows: LiveRow[], now: Date): { items: LiveVisitor[]; counts: Record<LiveVisitor["group"], number> } {
  // One row per visitor (two tabs are two visits): the freshest.
  const latest = new Map<string, LiveRow>();
  for (const r of rows) if (!latest.has(r.visitorId) || latest.get(r.visitorId)!.lastSeenAt < r.lastSeenAt) latest.set(r.visitorId, r);
  const items = [...latest.values()].map((r) => toLiveVisitor(r, now)).sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || b.secondsOnSite - a.secondsOnSite);
  const counts = { waiting: 0, chatting: 0, browsing: 0, idle: 0 };
  for (const v of items) counts[v.group]++;
  return { items, counts };
}

export async function liveVisitors(now = new Date()) {
  const visits = await prisma.supportVisit.findMany({
    where: { lastSeenAt: { gt: new Date(now.getTime() - LIVE_WINDOW_MS) }, endedAt: null },
    orderBy: { lastSeenAt: "desc" },
    take: 500,
    select: {
      id: true, visitorId: true, surface: true, startedAt: true, lastSeenAt: true, country: true, city: true, currentPath: true, pageCount: true, referrer: true, device: true, browser: true,
      pages: { orderBy: { at: "desc" }, take: 1, select: { at: true } },
      visitor: { select: { name: true, businessName: true, email: true, businessId: true, creatorProfileId: true, visitCount: true, optedOut: true } },
    },
  });
  const ids = [...new Set(visits.map((v) => v.visitorId))];
  const chats = ids.length
    ? await prisma.supportConversation.findMany({ where: { visitorId: { in: ids } }, orderBy: { lastMessageAt: "desc" }, distinct: ["visitorId"], select: { id: true, visitorId: true, status: true, lastMessageAt: true, leadScore: true, visitorDraft: true, visitorDraftAt: true } })
    : [];
  const rows: LiveRow[] = visits.map((v) => ({
    visitId: v.id,
    visitorId: v.visitorId,
    startedAt: v.startedAt,
    lastSeenAt: v.lastSeenAt,
    lastPageAt: v.pages[0]?.at ?? null,
    country: v.country,
    city: v.city,
    currentPath: v.visitor.optedOut ? null : v.currentPath,
    pageCount: v.pageCount,
    referrer: v.referrer,
    device: v.device,
    browser: v.browser,
    surface: v.surface as Surface,
    visitor: v.visitor,
    conversation: chats.find((c) => c.visitorId === v.visitorId) ?? null,
  }));
  return groupLive(rows, now);
}

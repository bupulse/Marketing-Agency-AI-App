// The support app's list rules: how chats and live visitors are sorted, grouped, counted and tagged. Pure, so the
// web app, the later desktop and phone apps and the tests read the same rules.
import type { ConversationListItem, DepartmentKey, LiveVisitor, Surface } from "@/lib/support/contract";
import type { ListView, VisitorGroup } from "./api";

export const HOT_LEAD = 70;

export const DEPARTMENT_NAMES: Record<DepartmentKey, string> = { sales: "Sales", technical: "Technical", billing: "Billing", creators: "Creators" };

const LANGUAGES: Record<string, string> = { rw: "Kinyarwanda", fr: "French", sw: "Swahili", en: "English", lg: "Luganda", ln: "Lingala" };
export const languageName = (code: string | null | undefined) => (code ? (LANGUAGES[code] ?? code.toUpperCase()) : null);

export type TagTone = "danger" | "blue" | "violet" | "success" | "neutral" | "warning";
export type Tag = { label: string; tone: TagTone };

const HANDOVER: Record<string, string> = { asked: "asked for a person", not_confident: "AI not sure", upset: "upset", topic: "topic", outside_hours: "outside hours", agent: "agent" };

/** The tags under a chat in the list: urgency first, then department, hot lead, language, and who is answering. */
export function conversationTags(c: Pick<ConversationListItem, "urgency" | "department" | "leadScore" | "language" | "status" | "tags">, handoverReason?: string | null): Tag[] {
  const out: Tag[] = [];
  if (c.urgency) out.push({ label: c.urgency === "upset" ? "Upset" : c.urgency === "urgent" ? "Urgent" : c.urgency, tone: "danger" });
  if (c.department) out.push({ label: DEPARTMENT_NAMES[c.department] ?? c.department, tone: "blue" });
  if (c.leadScore != null && c.leadScore >= HOT_LEAD) out.push({ label: `Hot lead ${c.leadScore}`, tone: "violet" });
  if (c.language && c.language !== "en") out.push({ label: `${languageName(c.language)} · translated`, tone: "neutral" });
  if (c.status === "AI") out.push({ label: "AI answering", tone: "success" });
  if (c.status === "WAITING" && handoverReason) out.push({ label: `Handed over: ${HANDOVER[handoverReason] ?? handoverReason}`, tone: "neutral" });
  if (c.status === "PENDING") out.push({ label: "Ticket", tone: "warning" });
  for (const t of c.tags) if (!out.some((o) => o.label.toLowerCase() === t.toLowerCase())) out.push({ label: t, tone: "neutral" });
  return out;
}

/** True for chats that go to the top: someone upset or urgent, or a hot lead. */
export const isFlagged = (c: Pick<ConversationListItem, "urgency" | "leadScore">) => !!c.urgency || (c.leadScore ?? 0) >= HOT_LEAD;

const time = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);

/**
 * Chat list order: waiting for a person first (longest wait first), then flagged chats (upset, urgent, hot lead), then
 * the rest by latest message. Closed chats go last.
 */
export function sortConversations<T extends Pick<ConversationListItem, "status" | "waitingSince" | "lastMessageAt" | "urgency" | "leadScore">>(items: T[]): T[] {
  const rank = (c: T) => (c.status === "CLOSED" ? 3 : c.status === "WAITING" ? 0 : isFlagged(c) ? 1 : 2);
  return [...items].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? time(a.waitingSince) - time(b.waitingSince) : time(b.lastMessageAt) - time(a.lastMessageAt)));
}

/** Which list tab a chat belongs to for this agent (a chat can be in several: "all" holds every one). */
export function inView(c: Pick<ConversationListItem, "status" | "assigneeName">, view: ListView, me: { name: string }): boolean {
  if (view === "all") return true;
  if (view === "ai") return c.status === "AI";
  if (view === "waiting") return c.status === "WAITING";
  return c.assigneeName === me.name && c.status !== "CLOSED" && c.status !== "AI";
}

export function viewCounts(items: Pick<ConversationListItem, "status" | "assigneeName">[], me: { name: string }): Record<ListView, number> {
  const count = (v: ListView) => items.filter((c) => inView(c, v, me)).length;
  return { mine: count("mine"), waiting: count("waiting"), ai: count("ai"), all: items.length };
}

/** Search across name, business and the last message, ignoring case and accents. */
export function matchesSearch(c: Pick<ConversationListItem, "visitorName" | "businessName" | "preview"> & { email?: string | null }, q: string): boolean {
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const needle = fold(q.trim());
  if (!needle) return true;
  return [c.visitorName, c.businessName ?? "", c.preview, c.email ?? ""].some((s) => fold(s).includes(needle));
}

/** "1:12" for a wait under an hour (minutes:seconds, like a timer), "1 h 05" beyond. */
export function waitingTimer(since: string, now: number): string {
  const s = Math.max(0, Math.floor((now - time(since)) / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "now", "4 min", "2 h", "3 d". */
export function ago(iso: string, now: number): string {
  const m = Math.floor(Math.max(0, now - time(iso)) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} h`;
  return `${Math.floor(m / (24 * 60))} d`;
}

/** "1 m 40 s", "45 s", "2 h 10 m". */
export function duration(sec: number | null): string {
  if (sec == null) return "–";
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} m${s % 60 ? ` ${s % 60} s` : ""}`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} m`;
}

export const minutesOnSite = (sec: number) => (sec < 60 ? "<1 min" : `${Math.floor(sec / 60)} min`);

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

// ---------- Live visitors ----------

export const VISITOR_GROUPS: { value: "all" | VisitorGroup; label: string }[] = [
  { value: "all", label: "All" },
  { value: "waiting", label: "Waiting for a person" },
  { value: "chatting", label: "Chatting" },
  { value: "browsing", label: "Browsing" },
  { value: "idle", label: "Idle" },
];

export const SURFACE_NAMES: Record<Surface, string> = { public: "Public site", dashboard: "Client dashboard", creator: "Creator portal", bio: "Link-in-bio" };

/** Where a page is, from its path (the visitors list filters by it). */
export function surfaceOfPath(path: string | null): Surface {
  const p = path ?? "/";
  if (p === "/dashboard" || p.startsWith("/dashboard/")) return "dashboard";
  if (p === "/creator" || p.startsWith("/creator/")) return "creator";
  if (p.startsWith("/b/")) return "bio";
  return "public";
}

const surfaceOf = (v: LiveVisitor & { surface?: Surface }) => v.surface ?? surfaceOfPath(v.currentPath);

const GROUP_RANK: Record<VisitorGroup, number> = { waiting: 0, chatting: 1, browsing: 2, idle: 3 };

/** Waiting first, then chatting, browsing, idle; inside a group the hottest lead first, then the longest on the site. */
export function sortVisitors<T extends Pick<LiveVisitor, "group" | "leadScore" | "secondsOnSite">>(items: T[]): T[] {
  return [...items].sort((a, b) => GROUP_RANK[a.group] - GROUP_RANK[b.group] || (b.leadScore ?? -1) - (a.leadScore ?? -1) || b.secondsOnSite - a.secondsOnSite);
}

export function filterVisitors(items: LiveVisitor[], group: "all" | VisitorGroup, surface: "all" | Surface): LiveVisitor[] {
  return sortVisitors(items.filter((v) => (group === "all" || v.group === group) && (surface === "all" || surfaceOf(v) === surface)));
}

export function visitorCounts(items: LiveVisitor[], surface: "all" | Surface = "all"): Record<"all" | VisitorGroup, number> {
  const list = surface === "all" ? items : items.filter((v) => surfaceOf(v) === surface);
  const out = { all: list.length, waiting: 0, chatting: 0, browsing: 0, idle: 0 };
  for (const v of list) out[v.group]++;
  return out;
}

/** The action a row offers: open a chat that waits, join one that is going on, or start one with someone browsing. */
export function visitorAction(v: Pick<LiveVisitor, "group" | "conversationId">): "open" | "join" | "start" | null {
  if (v.conversationId) return v.group === "waiting" ? "open" : "join";
  return v.group === "idle" ? null : "start";
}

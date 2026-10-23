import "server-only";
import { prisma } from "@/lib/db";
import type { Stats } from "./contract";
import { SUPPORT_LEAD_KIND } from "./prechat";
import { getSupportSettings, type SupportSettings } from "./settings";

// Supervisor numbers (GET /agent/stats, docs/research 2.6): chats, the AI-resolution rate of chats the AI answered,
// the hand-over rate, the median time to the first human reply counted inside team hours only (a chat handed over at
// 23:00 and answered at 08:05 waited 5 minutes, not 9 hours), the share rated good, and new leads.

const KIGALI_OFFSET_MS = 2 * 60 * 60 * 1000; // Rwanda is UTC+2 all year (no daylight saving)
const DAY_MS = 86_400_000;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Seconds of [start, end) that fall inside team hours (Kigali time). */
export function secondsWithinHours(start: Date, end: Date, hours: SupportSettings["hours"]): number {
  if (end <= start) return 0;
  let total = 0;
  // Walk Kigali days from the one containing `start` to the one containing `end`.
  const localStart = start.getTime() + KIGALI_OFFSET_MS;
  const localEnd = end.getTime() + KIGALI_OFFSET_MS;
  for (let day = Math.floor(localStart / DAY_MS) * DAY_MS; day < localEnd; day += DAY_MS) {
    const weekday = new Date(day).getUTCDay();
    for (const r of hours[String(weekday)] ?? []) {
      const from = Math.max(day + minutes(r.from) * 60_000, localStart);
      const to = Math.min(day + minutes(r.to) * 60_000, localEnd);
      if (to > from) total += to - from;
    }
  }
  return Math.round(total / 1000);
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

type ChatRow = { aiReplyCount: number; aiResolved: boolean | null; handoverAt: Date | null; rating: number | null; assigneeId: string | null };

/** The numbers from the period's chats and first-reply times. Pure. */
export function summarize(chats: ChatRow[], firstReplyInHours: number[]) {
  const involved = chats.filter((c) => c.aiReplyCount > 0);
  const judged = involved.filter((c) => c.aiResolved !== null);
  const rated = chats.filter((c) => c.rating !== null);
  return {
    chats: chats.length,
    aiSolvedPercent: percent(judged.filter((c) => c.aiResolved).length, judged.length),
    handoverPercent: percent(chats.filter((c) => c.handoverAt).length, chats.length),
    firstHumanReplySec: median(firstReplyInHours),
    ratedGoodPercent: percent(rated.filter((c) => c.rating === 1).length, rated.length),
  };
}

export async function loadStats(from: Date, to: Date): Promise<Stats> {
  const [chats, replies, leads, agents, open] = await Promise.all([
    prisma.supportConversation.findMany({ where: { createdAt: { gte: from, lt: to } }, select: { aiReplyCount: true, aiResolved: true, handoverAt: true, rating: true, assigneeId: true }, take: 20_000 }),
    prisma.supportEvent.findMany({ where: { name: "first_human_reply", at: { gte: from, lt: to } }, select: { valueInHours: true }, take: 20_000 }),
    prisma.contactRequest.count({ where: { kind: SUPPORT_LEAD_KIND, createdAt: { gte: from, lt: to } } }),
    prisma.supportAgent.findMany({ where: { status: { not: "invited" } }, orderBy: { name: "asc" }, select: { id: true, name: true, availability: true, maxChats: true } }),
    prisma.supportConversation.groupBy({ by: ["assigneeId"], where: { status: { in: ["OPEN", "WAITING", "PENDING"] }, assigneeId: { not: null } }, _count: { _all: true } }),
  ]);
  const sums = summarize(chats, replies.flatMap((r) => (r.valueInHours === null ? [] : [r.valueInHours])));
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    ...sums,
    newLeads: leads,
    agents: agents.map((a) => {
      const mine = chats.filter((c) => c.assigneeId === a.id && c.rating !== null);
      return { id: a.id, name: a.name, availability: a.availability, openChats: open.find((o) => o.assigneeId === a.id)?._count._all ?? 0, maxChats: a.maxChats, ratedGoodPercent: percent(mine.filter((c) => c.rating === 1).length, mine.length) };
    }),
  };
}

/** First human reply: seconds since the hand-over (or the chat's start), all of them and inside team hours. */
export async function firstReplyTimes(since: Date, now = new Date()) {
  const settings = await getSupportSettings();
  return { value: Math.max(0, Math.round((now.getTime() - since.getTime()) / 1000)), valueInHours: secondsWithinHours(since, now, settings.hours) };
}

import "server-only";
// Sales performance per agent (Admin -> Sales, and the sales room TV). Performance only: no commission is worked out.
//
// - Own sales: a payment (net of refunds) counts for the agent whose ClientAssignment covered the payment's time
//   (startsAt <= at < endsAt, or still open). A reassignment counts from its moment on; earlier payments stay with the
//   agent who had the client then.
// - Team share: payments of clients with no agent at that time (unassigned, or an agent no longer on the board) go
//   into one pot, split equally across the sales agents active that month.
// - Active that month: a staff member with a sales role (a built-in sales role, or any role with "My clients",
//   clients.own), added before the month ended and not disabled before it began. Invited members count too: their
//   link already works.
// Months are calendar months in Kigali (lib/time/kigali.ts), like the rest of Money.
import { prisma } from "@/lib/db";
import { MONEY_EVENT_TYPES } from "@/lib/analytics/math";
import { dedupe, toRevenueEntry, type RevenueEntry } from "@/lib/money/revenue-shared";
import { isSalesRole, permissionsOf } from "@/lib/staff/permissions";
import { kigaliMonthOf, kigaliMonthRange } from "@/lib/time/kigali";

export type AssignmentSpan = { userId: string; staffId: string | null; startsAt: Date; endsAt: Date | null };
export type BoardAgent = { staffId: string; name: string };
export type LeaderRow = { staffId: string; name: string; ownCents: number; teamShareCents: number; totalCents: number; clients: number };

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Kigali months (lib/time/kigali.ts), like every money page. */
export const monthOf = kigaliMonthOf;
export const monthRange = kigaliMonthRange;

/** The staff member assigned to the client (account user id) at `at`, or null when unassigned. Latest start wins. */
export function agentAt(assignments: readonly AssignmentSpan[], userId: string, at: Date): string | null {
  const t = at.getTime();
  let best: AssignmentSpan | null = null;
  for (const a of assignments) {
    if (a.userId !== userId || a.startsAt.getTime() > t || (a.endsAt && a.endsAt.getTime() <= t)) continue;
    if (!best || a.startsAt.getTime() > best.startsAt.getTime()) best = a;
  }
  return best?.staffId ?? null;
}

/** `cents` split into `n` equal whole-cent parts; the leftover cents go one each to the first parts. */
export function splitEqually(cents: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.trunc(cents / n);
  const rest = cents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < Math.abs(rest) ? Math.sign(rest) : 0));
}

/**
 * The leaderboard from plain data: the month's payments and refunds, the assignments covering them, the agents active
 * that month (in a stable order, which decides who gets a leftover cent) and each agent's current client count.
 * Sorted by total, then name.
 */
export function leaderboard(input: { entries: readonly RevenueEntry[]; assignments: readonly AssignmentSpan[]; agents: readonly BoardAgent[]; clients?: ReadonlyMap<string, number> }): LeaderRow[] {
  const own = new Map(input.agents.map((a) => [a.staffId, 0]));
  let pot = 0;
  for (const e of input.entries) {
    const staffId = e.userId ? agentAt(input.assignments, e.userId, e.at) : null;
    if (staffId && own.has(staffId)) own.set(staffId, (own.get(staffId) ?? 0) + e.usdCents);
    else pot += e.usdCents;
  }
  const shares = splitEqually(pot, input.agents.length);
  return input.agents
    .map((a, i) => {
      const ownCents = own.get(a.staffId) ?? 0;
      const teamShareCents = shares[i] ?? 0;
      return { staffId: a.staffId, name: a.name, ownCents, teamShareCents, totalCents: ownCents + teamShareCents, clients: input.clients?.get(a.staffId) ?? 0 };
    })
    .sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name));
}

export const staffName = (s: { name: string | null; email: string }) => s.name?.trim() || s.email.split("@")[0];

/** Sales staff who count for `month` (see the rule at the top), oldest first so a leftover cent goes to the same people. */
export async function boardAgents(month: string): Promise<BoardAgent[]> {
  const { start, end } = monthRange(month);
  const [staff, roles] = await Promise.all([
    prisma.staffMember.findMany({
      where: { createdAt: { lt: end }, OR: [{ status: { not: "disabled" } }, { disabledAt: { gte: start } }] },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, name: true, email: true, roleKey: true, status: true, disabledAt: true },
    }),
    prisma.staffRole.findMany({ select: { key: true, permissions: true } }),
  ]);
  return staff
    // A member disabled with no date recorded is left out.
    .filter((s) => (s.status !== "disabled" || (s.disabledAt && s.disabledAt >= start)) && isSalesRole(s.roleKey, permissionsOf(s.roleKey, roles)))
    .map((s) => ({ staffId: s.id, name: staffName(s) }));
}

/** The month's payments and refunds (by payment time, UTC month). Events are read a week either side, then filtered. */
export async function monthEntries(month: string): Promise<RevenueEntry[]> {
  const { start, end } = monthRange(month);
  const week = 7 * 86_400_000;
  const rows = await prisma.billingEvent.findMany({
    where: { type: { in: MONEY_EVENT_TYPES }, createdAt: { gte: new Date(start.getTime() - week), lt: new Date(end.getTime() + week) } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { eventId: true, type: true, payload: true, createdAt: true, userId: true },
  });
  return dedupe(rows.map(toRevenueEntry).filter((e): e is RevenueEntry => !!e && e.month === month));
}

/** This month's leaderboard (YYYY-MM, UTC). An invalid month reads as the current one. */
export async function getLeaderboard(month: string): Promise<LeaderRow[]> {
  const m = MONTH.test(month) ? month : monthOf(new Date());
  const { start, end } = monthRange(m);
  const [agents, entries] = await Promise.all([boardAgents(m), monthEntries(m)]);
  if (agents.length === 0) return [];
  const userIds = [...new Set(entries.map((e) => e.userId).filter((u): u is string => !!u))];
  const [assignments, counts] = await Promise.all([
    userIds.length
      ? prisma.clientAssignment.findMany({ where: { userId: { in: userIds }, startsAt: { lt: end }, OR: [{ endsAt: null }, { endsAt: { gt: start } }] }, select: { userId: true, staffId: true, startsAt: true, endsAt: true } })
      : Promise.resolve([] as AssignmentSpan[]),
    prisma.business.groupBy({ by: ["salesAgentId"], where: { salesAgentId: { in: agents.map((a) => a.staffId) } }, _count: { _all: true } }),
  ]);
  const clients = new Map(counts.map((c) => [c.salesAgentId as string, c._count._all]));
  return leaderboard({ entries, assignments, agents, clients });
}

/** The agent a payment counts for: the one assigned to the client at `at`. Null when the client had no agent then. */
export async function agentForPayment(userId: string, at: Date): Promise<{ staffId: string; name: string } | null> {
  const row = await prisma.clientAssignment.findFirst({
    where: { userId, startsAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gt: at } }] },
    orderBy: { startsAt: "desc" },
    select: { staffId: true },
  });
  if (!row?.staffId) return null;
  const staff = await prisma.staffMember.findUnique({ where: { id: row.staffId }, select: { id: true, name: true, email: true } });
  return staff ? { staffId: staff.id, name: staffName(staff) } : null;
}

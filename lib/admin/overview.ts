import "server-only";
// Small counts for the Overview dashboard: clients by subscription state and today's demos.
import { prisma } from "@/lib/db";
import { kigaliDayStart } from "@/lib/time/kigali";

export type ClientCounts = { active: number; trial: number; pastDue: number; waitingDemo: number; ended: number; total: number };

export async function getClientCounts(): Promise<ClientCounts> {
  const groups = await prisma.subscription.groupBy({ by: ["status", "plan"], _count: { _all: true } });
  const c: ClientCounts = { active: 0, trial: 0, pastDue: 0, waitingDemo: 0, ended: 0, total: 0 };
  for (const g of groups) {
    const n = g._count._all;
    c.total += n;
    if (g.status === "PENDING_DEMO") c.waitingDemo += n;
    else if (g.status === "TRIALING" || (g.plan === "TRIAL" && g.status === "ACTIVE")) c.trial += n;
    else if (g.status === "ACTIVE") c.active += n;
    else if (g.status === "PAST_DUE") c.pastDue += n;
    else c.ended += n;
  }
  return c;
}

/** Demos booked for today (UTC) and the next one coming up. */
export async function getDemosToday(now = new Date()): Promise<{ today: number; next: { startsAt: Date; company: string } | null }> {
  const start = kigaliDayStart(now);
  const end = new Date(start.getTime() + 86_400_000);
  const [today, next] = await Promise.all([
    prisma.demoBooking.count({ where: { status: "booked", startsAt: { gte: start, lt: end } } }),
    prisma.demoBooking.findFirst({ where: { status: "booked", startsAt: { gte: now } }, orderBy: { startsAt: "asc" }, select: { startsAt: true, business: { select: { name: true } } } }),
  ]);
  return { today, next: next ? { startsAt: next.startsAt, company: next.business.name } : null };
}

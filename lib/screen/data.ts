// What the sales room TV shows (/screen/<token>, polled every 10 s through /screen/<token>/data). View-only and built
// field by field from names and numbers: no email address or phone number ever leaves here (screenName refuses them).
import "server-only";
import { prisma } from "@/lib/db";
import { MONEY_EVENT_TYPES } from "@/lib/analytics/math";
import { dedupe, toRevenueEntry, type RevenueEntry } from "@/lib/money/revenue-shared";
import { agentForPayment, getLeaderboard, monthOf, staffName } from "@/lib/sales/attribution";
import { defaultMoney } from "@/lib/money/display-server";
import { activeSoundUrls } from "./sounds";
import { ACTIVE_WINDOW_MS, advanceCursor, formatCursor, kigaliDayStart, parseCursor, screenName, kigaliMonthStart, type Celebration, type Cursor, type ScreenData } from "./shared";

const DAY = 86_400_000;
const TRIALS_SHOWN = 12;
const LEADERS_SHOWN = 10;
/** New payments read per poll; more than this in 10 s are celebrated on the next polls. */
const NEW_PER_POLL = 10;

type Snapshot = Omit<ScreenData, "celebrations" | "cursor" | "sounds" | "money">;

const moneyRow = { id: true, eventId: true, type: true, payload: true, createdAt: true, userId: true } as const;

/** Today's and this month's (Kigali) confirmed revenue in US cents, net of refunds, like the Revenue page. */
async function revenue(now: Date): Promise<Snapshot["revenue"]> {
  const month = kigaliMonthStart(now);
  const day = kigaliDayStart(now);
  // A payment's time can sit a little before its event was stored (Paddle's own time): read two days more, then filter.
  // Newest first, in batches, with no cap: a busy month never drops today's payments.
  const since = new Date(Math.min(month.getTime(), day.getTime()) - 2 * DAY);
  const rows: { id: string; eventId: string; type: string; payload: unknown; createdAt: Date; userId: string | null }[] = [];
  for (let cursor: string | undefined; ; ) {
    const batch = await prisma.billingEvent.findMany({
      where: { type: { in: MONEY_EVENT_TYPES }, createdAt: { gte: since } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: moneyRow,
      take: 5_000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    rows.push(...batch);
    if (batch.length < 5_000) break;
    cursor = batch[batch.length - 1].id;
  }
  const entries = dedupe(rows.map(toRevenueEntry).filter((e): e is RevenueEntry => !!e));
  const today = entries.filter((e) => e.at >= day && e.at <= now);
  const month_ = entries.filter((e) => e.month === monthOf(now) && e.at <= now);
  const usd = (list: RevenueEntry[]) => list.reduce((s, e) => s + e.usdCents, 0);
  const rwf = (list: RevenueEntry[]) => list.filter((e) => e.currency === "RWF" && e.localMinor !== null);
  return {
    todayCents: usd(today),
    monthCents: usd(month_),
    todayRwfMinor: rwf(today).reduce((s, e) => s + (e.localMinor as number), 0),
    todayRwfUsdCents: usd(rwf(today)),
    monthRwfMinor: rwf(month_).reduce((s, e) => s + (e.localMinor as number), 0),
    monthRwfUsdCents: usd(rwf(month_)),
  };
}

/** Trials still running (or ending today), soonest end first, with the company's sales agent. */
async function trials(now: Date): Promise<Snapshot["trials"]> {
  const subs = await prisma.subscription.findMany({
    where: { status: "TRIALING", trialEndsAt: { gte: kigaliDayStart(now) } },
    orderBy: { trialEndsAt: "asc" },
    take: TRIALS_SHOWN,
    select: { trialEndsAt: true, user: { select: { business: { select: { name: true, salesAgentId: true } } } } },
  });
  const agentIds = [...new Set(subs.map((s) => s.user.business?.salesAgentId).filter((id): id is string => !!id))];
  const staff = agentIds.length ? await prisma.staffMember.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true, email: true } }) : [];
  const names = new Map(staff.map((s) => [s.id, screenName(staffName(s))]));
  return subs.map((s) => ({
    company: screenName(s.user.business?.name) ?? "A new client",
    daysLeft: Math.max(0, Math.ceil(((s.trialEndsAt as Date).getTime() - now.getTime()) / DAY)),
    agent: (s.user.business?.salesAgentId && names.get(s.user.business.salesAgentId)) || null,
  }));
}

async function leaders(now: Date): Promise<Snapshot["leaderboard"]> {
  const rows = await getLeaderboard(monthOf(now));
  return rows.slice(0, LEADERS_SHOWN).map((r) => ({ agent: screenName(r.name) ?? "Agent", ownCents: r.ownCents, teamShareCents: r.teamShareCents, totalCents: r.totalCents, clients: r.clients, ownRwf: r.ownRwf, teamShareRwf: r.teamShareRwf, totalRwf: r.totalRwf }));
}

/** Everything but the celebrations, for any screen. */
export async function loadSnapshot(now = new Date()): Promise<Snapshot> {
  const [activeNow, activeToday, money, trialList, board] = await Promise.all([
    prisma.user.count({ where: { lastSeenAt: { gte: new Date(now.getTime() - ACTIVE_WINDOW_MS) } } }),
    prisma.user.count({ where: { lastSeenAt: { gte: kigaliDayStart(now) } } }),
    revenue(now),
    trials(now),
    leaders(now),
  ]);
  return { at: now.toISOString(), activeNow, activeToday, revenue: money, trials: trialList, leaderboard: board };
}

const SNAPSHOT_TTL_MS = 8_000;
let snapshotCache: { at: number; value: Promise<Snapshot> } | null = null;

/** loadSnapshot, shared by every screen for 8 s per server instance (each polls every 10 s). */
export function getSnapshot(): Promise<Snapshot> {
  if (snapshotCache && Date.now() - snapshotCache.at < SNAPSHOT_TTL_MS) return snapshotCache.value;
  const value = loadSnapshot();
  snapshotCache = { at: Date.now(), value };
  value.catch(() => (snapshotCache = null));
  return value;
}

/**
 * Confirmed payments stored after `cursor` (oldest first) as celebrations, and the cursor to send next time. Without a
 * cursor (a screen just opened) nothing is celebrated: the cursor starts at the newest money event. Refunds move the
 * cursor on without a celebration.
 */
export async function newPayments(cursor: Cursor | null, now = new Date()): Promise<{ celebrations: Celebration[]; cursor: Cursor }> {
  if (!cursor) {
    const last = await prisma.billingEvent.findFirst({ where: { type: { in: MONEY_EVENT_TYPES } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, createdAt: true } });
    return { celebrations: [], cursor: last ? { at: last.createdAt, id: last.id } : { at: now, id: "" } };
  }
  const rows = await prisma.billingEvent.findMany({
    where: { type: { in: MONEY_EVENT_TYPES }, OR: [{ createdAt: { gt: cursor.at } }, { createdAt: cursor.at, id: { gt: cursor.id } }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: NEW_PER_POLL,
    select: moneyRow,
  });
  const payments = dedupe(rows.map(toRevenueEntry).filter((e): e is RevenueEntry => !!e && e.kind === "payment" && e.usdCents > 0));
  const userIds = [...new Set(payments.map((p) => p.userId).filter((u): u is string => !!u))];
  const businesses = userIds.length ? await prisma.business.findMany({ where: { userId: { in: userIds } }, select: { userId: true, name: true } }) : [];
  const companies = new Map(businesses.map((b) => [b.userId, screenName(b.name)]));
  const celebrations = await Promise.all(
    payments.map(async (p): Promise<Celebration> => {
      const agent = p.userId ? await agentForPayment(p.userId, p.at).catch(() => null) : null;
      return { id: p.id, client: (p.userId && companies.get(p.userId)) || "A new client", usdCents: p.usdCents, localMinor: p.localMinor, currency: p.currency, agent: agent ? screenName(agent.name) ?? "Agent" : null };
    }),
  );
  return { celebrations, cursor: advanceCursor(cursor, rows) };
}

/** One poll's answer. */
export async function screenData(after: string | null): Promise<ScreenData> {
  const [snapshot, fresh, sounds, money] = await Promise.all([getSnapshot(), newPayments(parseCursor(after)), activeSoundUrls(), defaultMoney()]);
  return { ...snapshot, money, sounds, celebrations: fresh.celebrations, cursor: formatCursor(fresh.cursor) };
}

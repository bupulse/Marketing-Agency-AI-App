import "server-only";
// The Overview's "today": payments confirmed today and a plain-sentence timeline of what happened (sign-ups, demos,
// trials, payments, cancellations, plan requests). "Today" starts at midnight in Kigali, like the sales screen.
import { prisma } from "@/lib/db";
import { MONEY_EVENT_TYPES } from "@/lib/analytics/math";
import { EVENT_NAMES } from "@/lib/analytics/events";
import { dedupe, METHOD_LABEL, toRevenueEntry, type RevenueEntry } from "@/lib/money/revenue-shared";
import { agentForPayment } from "@/lib/sales/attribution";
import { kigaliDayStart } from "@/lib/screen/shared";
import { money } from "./format";

export type TodayPayment = { id: string; at: string; company: string; person: string | null; usdCents: number; amount: string; method: string; agent: string | null; href: string | null };
export type TimelineItem = { id: string; at: string; kind: "signup" | "demo" | "trial" | "payment" | "cancel" | "request"; text: string; href: string | null };

const DAY = 86_400_000;

/** Payments (and refunds) confirmed since the start of today, newest first, with the company and the agent. */
export async function getTodayPayments(now = new Date()): Promise<TodayPayment[]> {
  const since = kigaliDayStart(now);
  const rows = await prisma.billingEvent.findMany({
    where: { type: { in: MONEY_EVENT_TYPES }, createdAt: { gte: new Date(since.getTime() - DAY) } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { eventId: true, type: true, payload: true, createdAt: true, userId: true },
  });
  const entries = dedupe(rows.map(toRevenueEntry).filter((e): e is RevenueEntry => !!e && e.at >= since && e.at <= now));
  const userIds = [...new Set(entries.map((e) => e.userId).filter((v): v is string => !!v))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, business: { select: { id: true, name: true } } } }) : [];
  const userOf = new Map(users.map((u) => [u.id, u]));
  return Promise.all(
    entries.map(async (e) => {
      const u = e.userId ? userOf.get(e.userId) : undefined;
      const agent = e.userId ? await agentForPayment(e.userId, e.at).catch(() => null) : null;
      const local = e.localMinor !== null && e.currency !== "USD" ? ` (${money(e.localMinor, e.currency)})` : "";
      return {
        id: e.id,
        at: e.at.toISOString(),
        company: u?.business?.name ?? (e.userId ? "Deleted account" : "Unknown payer"),
        person: u?.name ?? null,
        usdCents: e.usdCents,
        amount: `${money(e.usdCents)}${local}`,
        method: e.kind === "refund" ? "Refund" : METHOD_LABEL[e.method],
        agent: agent?.name ?? null,
        href: u?.business ? `/admin/companies/${u.business.id}` : null,
      };
    }),
  );
}

/** What happened today, as plain sentences, newest first. */
export async function getTodayTimeline(now = new Date(), payments?: TodayPayment[]): Promise<TimelineItem[]> {
  const since = kigaliDayStart(now);
  const range = { gte: since, lte: now };
  const [signups, booked, done, trialsStarted, trialsEnding, cancels, requests, paid] = await Promise.all([
    prisma.business.findMany({ where: { createdAt: range }, take: 50, orderBy: { createdAt: "desc" }, select: { id: true, name: true, createdAt: true, user: { select: { subscription: { select: { chosenPlan: true } } } } } }),
    prisma.demoBooking.findMany({ where: { createdAt: range }, take: 50, select: { id: true, createdAt: true, startsAt: true, business: { select: { id: true, name: true } } } }),
    prisma.demoBooking.findMany({ where: { status: "done", updatedAt: range }, take: 50, select: { id: true, updatedAt: true, business: { select: { id: true, name: true } } } }),
    prisma.analyticsEvent.findMany({ where: { name: EVENT_NAMES.trialStarted, createdAt: range }, take: 50, select: { id: true, createdAt: true, businessId: true } }),
    prisma.subscription.findMany({ where: { status: "TRIALING", trialEndsAt: { gte: since, lt: new Date(since.getTime() + DAY) } }, take: 50, select: { id: true, trialEndsAt: true, user: { select: { business: { select: { id: true, name: true } } } } } }),
    prisma.analyticsEvent.findMany({ where: { name: EVENT_NAMES.cancel, createdAt: range }, take: 50, select: { id: true, createdAt: true, businessId: true } }),
    prisma.customPlanRequest.findMany({ where: { createdAt: range }, take: 50, select: { id: true, createdAt: true, companyName: true } }),
    payments ? Promise.resolve(payments) : getTodayPayments(now),
  ]);
  const ids = [...new Set([...trialsStarted, ...cancels].map((e) => e.businessId).filter((v): v is string => !!v))];
  const names = new Map((ids.length ? await prisma.business.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map((b) => [b.id, b.name]));
  const company = (id: string | null) => (id ? (names.get(id) ?? "A company") : "A company");
  const link = (id: string | null) => (id ? `/admin/companies/${id}` : null);
  const time = (d: Date) => d.toISOString();
  const items: TimelineItem[] = [
    ...signups.map((b) => ({ id: `signup:${b.id}`, at: time(b.createdAt), kind: "signup" as const, text: `${b.name} signed up${b.user.subscription?.chosenPlan ? ` and chose the ${b.user.subscription.chosenPlan.toLowerCase()} plan` : ""}.`, href: link(b.id) })),
    ...booked.map((d) => ({ id: `booked:${d.id}`, at: time(d.createdAt), kind: "demo" as const, text: `${d.business.name} booked a demo for ${d.startsAt.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" })}.`, href: "/admin/demos" })),
    ...done.map((d) => ({ id: `done:${d.id}`, at: time(d.updatedAt), kind: "demo" as const, text: `The demo with ${d.business.name} was done.`, href: link(d.business.id) })),
    ...trialsStarted.map((e) => ({ id: `trial:${e.id}`, at: time(e.createdAt), kind: "trial" as const, text: `${company(e.businessId)} started a free trial.`, href: link(e.businessId) })),
    ...trialsEnding.map((s) => ({ id: `trialend:${s.id}`, at: time(s.trialEndsAt as Date), kind: "trial" as const, text: `${s.user.business?.name ?? "A company"}'s trial ends today.`, href: link(s.user.business?.id ?? null) })),
    ...paid.map((p) => ({ id: `pay:${p.id}`, at: p.at, kind: "payment" as const, text: p.usdCents < 0 ? `${p.company} was refunded ${p.amount}.` : `${p.company} paid ${p.amount} by ${p.method}${p.agent ? ` (brought in by ${p.agent})` : ""}.`, href: p.href })),
    ...cancels.map((e) => ({ id: `cancel:${e.id}`, at: time(e.createdAt), kind: "cancel" as const, text: `${company(e.businessId)} cancelled their plan.`, href: link(e.businessId) })),
    ...requests.map((r) => ({ id: `request:${r.id}`, at: time(r.createdAt), kind: "request" as const, text: `${r.companyName} asked for a custom plan.`, href: "/admin/requests" })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

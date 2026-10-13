import "server-only";
// The admin's to-do list (Admin -> Inbox): everything waiting for a person, one section per kind, newest first, with
// the counts the sidebar shows. Every source is read on its own and a failing one counts as empty, so one broken table
// never hides the rest.
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { APPROVAL_TTL_MS } from "./service";
import { openRegionMismatches } from "@/lib/region-check";
import { money } from "./format";

export type InboxItem = { id: string; text: string; sub?: string; href: string; at?: string };
export type InboxSection = { key: InboxKey; title: string; why: string; href: string; count: number; tone: "danger" | "violet" | "neutral"; items: InboxItem[] };
export type InboxKey = "payments" | "approvals" | "demos" | "requests" | "invoices" | "offers" | "contests" | "regions" | "errors";

const SHOW = 5;
const HOUR = 3_600_000;
const safe = async <T>(p: Promise<T>, empty: T): Promise<T> => p.catch(() => empty);

/** Just the counts, for the sidebar badges (cheap: counts only). */
export async function getInboxCounts(now = new Date()): Promise<Record<InboxKey, number> & { total: number }> {
  const since24h = new Date(now.getTime() - 24 * HOUR);
  const [payments, approvals, demos, requests, invoices, offers, contests, regions, errors] = await Promise.all([
    safe(prisma.manualPayment.count({ where: { status: "pending", submittedAt: { not: null } } }), 0),
    safe(prisma.adminApproval.count({ where: { status: "pending", createdAt: { gt: new Date(now.getTime() - APPROVAL_TTL_MS) } } }), 0),
    safe(prisma.demoBooking.count({ where: demoWhere(now) }), 0),
    safe(prisma.customPlanRequest.count({ where: { status: "new" } }), 0),
    safe(prisma.invoice.count({ where: { status: "sent", OR: [{ paymentReview: { not: Prisma.AnyNull } }, { dueDate: { lt: startOfDay(now) } }] } }), 0),
    safe(prisma.planOffer.count({ where: { status: "accepted" } }), 0),
    safe(contestCount(), 0),
    safe(prisma.business.count({ where: { regionMismatchAt: { not: null } } }), 0),
    safe(prisma.errorLog.count({ where: { level: "error", createdAt: { gte: since24h } } }), 0),
  ]);
  const counts = { payments, approvals, demos, requests, invoices, offers, contests, regions, errors };
  // Errors are shown, but they are not a to-do item of their own (Health and Errors own them).
  return { ...counts, total: payments + approvals + demos + requests + invoices + offers + contests + regions };
}

const startOfDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** Demos from 2 hours ago to 48 hours ahead still "booked", and past ones never marked done or no-show. */
const demoWhere = (now: Date) => ({ status: "booked", startsAt: { lte: new Date(now.getTime() + 48 * HOUR) } });

async function contestCount(): Promise<number> {
  const [row] = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM "Post"
    WHERE "contest" IS NOT NULL AND NOT ("contest" ? 'confirmedAt') AND "status" NOT IN ('PUBLISHED', 'FAILED', 'CANCELLED')`;
  return Number(row?.c ?? 0);
}

/** The whole inbox: sections that have something, in the order the owner should work through them. */
export async function getInbox(now = new Date()): Promise<{ sections: InboxSection[]; total: number; errors24h: number }> {
  const counts = await getInboxCounts(now);
  const since24h = new Date(now.getTime() - 24 * HOUR);
  const [payments, approvals, demos, requests, invoices, offers, contests, regions, errors] = await Promise.all([
    safe(prisma.manualPayment.findMany({ where: { status: "pending", submittedAt: { not: null } }, orderBy: { submittedAt: "asc" }, take: SHOW, select: { id: true, reference: true, amountMinor: true, currency: true, network: true, submittedAt: true, user: { select: { email: true, business: { select: { name: true } } } } } }), []),
    safe(prisma.adminApproval.findMany({ where: { status: "pending", createdAt: { gt: new Date(now.getTime() - APPROVAL_TTL_MS) } }, orderBy: { createdAt: "asc" }, take: SHOW, select: { id: true, kind: true, requestedBy: true, createdAt: true } }), []),
    safe(prisma.demoBooking.findMany({ where: demoWhere(now), orderBy: { startsAt: "asc" }, take: SHOW, select: { id: true, startsAt: true, planKey: true, business: { select: { id: true, name: true } } } }), []),
    safe(prisma.customPlanRequest.findMany({ where: { status: "new" }, orderBy: { createdAt: "asc" }, take: SHOW, select: { id: true, companyName: true, budget: true, createdAt: true } }), []),
    safe(prisma.invoice.findMany({ where: { status: "sent", OR: [{ paymentReview: { not: Prisma.AnyNull } }, { dueDate: { lt: startOfDay(now) } }] }, orderBy: { dueDate: "asc" }, take: SHOW, select: { id: true, number: true, totalMinor: true, currency: true, dueDate: true, paymentReview: true, business: { select: { name: true } } } }), []),
    safe(prisma.planOffer.findMany({ where: { status: "accepted" }, orderBy: { acceptedAt: "asc" }, take: SHOW, select: { id: true, adjustedMinor: true, currency: true, acceptedAt: true, payMethod: true, business: { select: { name: true } } } }), []),
    safe(prisma.$queryRaw<{ businessId: string; name: string; posts: bigint; first: Date }[]>`
      SELECT p."businessId", b."name", COUNT(*)::bigint AS posts, MIN(p."createdAt") AS first FROM "Post" p JOIN "Business" b ON b."id" = p."businessId"
      WHERE p."contest" IS NOT NULL AND NOT (p."contest" ? 'confirmedAt') AND p."status" NOT IN ('PUBLISHED', 'FAILED', 'CANCELLED')
      GROUP BY 1, 2 ORDER BY 4 ASC LIMIT ${SHOW}`, []),
    safe(openRegionMismatches(SHOW), []),
    safe(prisma.errorLog.findMany({ where: { level: "error", createdAt: { gte: since24h } }, orderBy: { createdAt: "desc" }, take: SHOW, select: { id: true, source: true, message: true, createdAt: true } }), []),
  ]);

  const all: InboxSection[] = [
    {
      key: "payments", title: "Payments to confirm", why: "Clients say they paid by Mobile Money. Check the money arrived, then confirm or reject.", href: "/admin/payments", count: counts.payments, tone: "danger",
      items: payments.map((p) => ({ id: p.id, text: `${p.user.business?.name ?? p.user.email} paid ${money(p.amountMinor, p.currency)}`, sub: `${p.network ?? "MoMo"} · reference ${p.reference}`, href: "/admin/payments", at: p.submittedAt?.toISOString() })),
    },
    {
      key: "approvals", title: "Money requests to approve", why: "Refunds, plan changes and offers Jarvis or the console asked for. Nothing happens until you approve.", href: "/admin/approvals", count: counts.approvals, tone: "danger",
      items: approvals.map((a) => ({ id: a.id, text: a.kind.replace(/_/g, " "), sub: `asked by ${a.requestedBy}`, href: "/admin/approvals", at: a.createdAt.toISOString() })),
    },
    {
      key: "demos", title: "Demos", why: "Booked demos in the next 48 hours, and past ones still to mark done or no-show.", href: "/admin/demos", count: counts.demos, tone: "violet",
      items: demos.map((d) => ({ id: d.id, text: d.business.name, sub: `${d.startsAt < now ? "Past, not marked yet" : "Booked"} · ${d.planKey}`, href: `/admin/companies/${d.business.id}`, at: d.startsAt.toISOString() })),
    },
    {
      key: "requests", title: "Plan requests", why: "Businesses asked for a custom plan. Reply with an offer or mark them contacted.", href: "/admin/requests", count: counts.requests, tone: "violet",
      items: requests.map((r) => ({ id: r.id, text: r.companyName, sub: r.budget ? `budget ${r.budget}` : undefined, href: "/admin/requests", at: r.createdAt.toISOString() })),
    },
    {
      key: "invoices", title: "Invoices to check", why: "A payment arrived that did not match the invoice, or the due date has passed.", href: "/admin/invoices", count: counts.invoices, tone: "violet",
      items: invoices.map((i) => ({ id: i.id, text: `${i.number} · ${i.business.name}`, sub: `${money(i.totalMinor, i.currency)} · ${i.paymentReview ? "payment to check" : "overdue"}`, href: `/admin/invoices/${i.id}`, at: i.dueDate.toISOString() })),
    },
    {
      key: "offers", title: "Offers accepted, not paid", why: "The client accepted a custom plan but has not paid yet. A reminder goes out on day 3 and day 7.", href: "/admin/offers?status=accepted", count: counts.offers, tone: "neutral",
      items: offers.map((o) => ({ id: o.id, text: o.business.name, sub: `${money(o.adjustedMinor, o.currency)} by ${o.payMethod ?? "MoMo"}`, href: `/admin/offers/${o.id}`, at: o.acceptedAt?.toISOString() })),
    },
    {
      key: "contests", title: "Contests waiting for the client", why: "The AI suggested a contest; it cannot go out until the client confirms the prize and rules. A nudge may help.", href: "/admin/companies", count: counts.contests, tone: "neutral",
      items: contests.map((c) => ({ id: c.businessId, text: c.name, sub: `${Number(c.posts)} post${Number(c.posts) === 1 ? "" : "s"} waiting`, href: `/admin/companies/${c.businessId}`, at: new Date(c.first).toISOString() })),
    },
    {
      key: "regions", title: "Region mismatches", why: "Paid or signed up from a dearer region than the one on file. Check, and change the region if needed.", href: "/admin/companies", count: counts.regions, tone: "neutral",
      items: regions.map((r) => ({ id: r.businessId, text: r.name, sub: `on ${r.pricingRegion}, seen from ${r.flag.country}`, href: `/admin/companies/${r.businessId}` })),
    },
    {
      key: "errors", title: "Errors in the last 24 hours", why: "Server errors. Open Errors for details; Health shows whether anything is down.", href: "/admin/errors", count: counts.errors, tone: "danger",
      items: errors.map((e) => ({ id: e.id, text: e.source, sub: e.message.slice(0, 120), href: "/admin/errors", at: e.createdAt.toISOString() })),
    },
  ];
  return { sections: all.filter((s) => s.count > 0), total: counts.total, errors24h: counts.errors };
}

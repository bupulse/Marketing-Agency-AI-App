import "server-only";
// What sales staff see of a client (Admin -> Sales): contact, plan, trial, last sign-in, how many posts and how
// payments stand. Never the client's content or settings.
import { prisma } from "@/lib/db";
import { MONEY_EVENT_TYPES } from "@/lib/analytics/math";
import { toRevenueEntry } from "@/lib/money/revenue-shared";
import { builtInRole, isSalesRole, permissionsOf } from "@/lib/staff/permissions";
import { staffName } from "./attribution";

const MAX_CLIENTS = 500;

export type SalesClient = {
  businessId: string;
  userId: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  plan: string | null;
  status: string | null;
  trialEndsAt: string | null;
  lastSignInAt: string | null;
  posts: number;
  lastPayment: { at: string; usdCents: number } | null;
  agentId: string | null;
};

/** Companies of one agent (staffId), or every company (null, for the sales team page), newest first. */
export async function loadSalesClients(staffId: string | null): Promise<SalesClient[]> {
  const rows = await prisma.business.findMany({
    where: staffId ? { salesAgentId: staffId } : {},
    orderBy: { createdAt: "desc" },
    take: MAX_CLIENTS,
    select: {
      id: true, name: true, ceoName: true, phone: true, userId: true, salesAgentId: true,
      _count: { select: { posts: true } },
      user: { select: { email: true, name: true, lastSeenAt: true, subscription: { select: { plan: true, status: true, trialEndsAt: true } } } },
    },
  });
  if (rows.length === 0) return [];
  const userIds = rows.map((r) => r.userId);
  const [signIns, events] = await Promise.all([
    prisma.$queryRaw<{ id: string; at: Date | null }[]>`SELECT id::text AS id, last_sign_in_at AS at FROM auth.users WHERE id = ANY(${userIds}::uuid[])`.catch(() => [] as { id: string; at: Date | null }[]),
    prisma.billingEvent.findMany({
      where: { userId: { in: userIds }, type: { in: MONEY_EVENT_TYPES } },
      orderBy: { createdAt: "desc" },
      take: 2_000,
      select: { eventId: true, type: true, payload: true, createdAt: true, userId: true },
    }),
  ]);
  const signInOf = new Map(signIns.map((s) => [s.id, s.at]));
  const lastPay = new Map<string, { at: string; usdCents: number }>();
  for (const e of events.map(toRevenueEntry)) {
    if (e?.kind !== "payment" || !e.userId) continue;
    const seen = lastPay.get(e.userId);
    if (!seen || seen.at < e.at.toISOString()) lastPay.set(e.userId, { at: e.at.toISOString(), usdCents: e.usdCents });
  }
  return rows.map((r) => {
    const sub = r.user.subscription;
    const signIn = signInOf.get(r.userId) ?? null;
    const seen = r.user.lastSeenAt;
    const last = signIn && seen ? (signIn > seen ? signIn : seen) : (signIn ?? seen);
    return {
      businessId: r.id,
      userId: r.userId,
      name: r.name,
      contactName: r.ceoName ?? r.user.name ?? null,
      phone: r.phone,
      email: r.user.email,
      plan: sub?.plan ?? null,
      status: sub?.status ?? null,
      trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
      lastSignInAt: last ? new Date(last).toISOString() : null,
      posts: r._count.posts,
      lastPayment: lastPay.get(r.userId) ?? null,
      agentId: r.salesAgentId,
    };
  });
}

export type TeamMember = { staffId: string; name: string; email: string; roleName: string; status: string; refCode: string | null };

/** Every staff member who can hold clients: sales roles (built-in, or a custom role with clients.own), any status. */
export async function loadSalesStaff(): Promise<TeamMember[]> {
  const [staff, roles] = await Promise.all([
    prisma.staffMember.findMany({ orderBy: [{ status: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, email: true, roleKey: true, status: true, refCode: true } }),
    prisma.staffRole.findMany({ select: { key: true, name: true, permissions: true } }),
  ]);
  return staff
    .map((s) => {
      if (!isSalesRole(s.roleKey, permissionsOf(s.roleKey, roles))) return null;
      const roleName = builtInRole(s.roleKey)?.name ?? roles.find((r) => r.key === s.roleKey)?.name ?? s.roleKey;
      return { staffId: s.id, name: staffName(s), email: s.email, roleName, status: s.status, refCode: s.refCode };
    })
    .filter((s): s is TeamMember => !!s);
}

export type Reassignment = { id: string; at: string; client: string; agent: string | null; reason: string | null; by: string };

/** The latest reassignments by a manager, newest first. */
export async function loadReassignments(take = 20): Promise<Reassignment[]> {
  const rows = await prisma.clientAssignment.findMany({ where: { source: "manager" }, orderBy: { createdAt: "desc" }, take, select: { id: true, createdAt: true, businessId: true, staffId: true, reason: true, by: true } });
  if (rows.length === 0) return [];
  const [businesses, staff] = await Promise.all([
    prisma.business.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.businessId))] } }, select: { id: true, name: true } }),
    prisma.staffMember.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => (r.staffId ? [r.staffId] : [])))] } }, select: { id: true, name: true, email: true } }),
  ]);
  const bizName = new Map(businesses.map((b) => [b.id, b.name]));
  const staffOf = new Map(staff.map((s) => [s.id, staffName(s)]));
  return rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), client: bizName.get(r.businessId) ?? "Deleted company", agent: r.staffId ? (staffOf.get(r.staffId) ?? "Former staff member") : null, reason: r.reason, by: r.by }));
}

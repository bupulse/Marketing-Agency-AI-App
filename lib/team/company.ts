import "server-only";
import { prisma } from "@/lib/db";
import type { Role } from "./roles";

export type Company = {
  /** The signed-in person (the real Supabase user id). */
  actorId: string;
  role: Role;
  businessId: string;
  /** The company account: Business.userId. Billing, usage and every Storage path belong to it. */
  ownerId: string;
  /** The company account is waiting to be deleted: members are locked out along with it. */
  ownerDeleting: boolean;
  ownerSuspended: boolean;
};

/**
 * The company a signed-in person belongs to, through Membership. A person who has a business but no membership row yet
 * (created before the team migration, or by a race) is made its Owner on the spot, so nothing can fall through.
 * Null when they belong to nothing yet (their account is still being set up).
 */
export async function resolveCompany(actorId: string): Promise<Company | null> {
  const m = await prisma.membership.findUnique({
    where: { userId: actorId },
    select: { role: true, businessId: true, business: { select: { userId: true, user: { select: { deletionScheduledFor: true, suspendedAt: true } } } } },
  });
  if (m) {
    return {
      actorId,
      role: m.role,
      businessId: m.businessId,
      ownerId: m.business.userId,
      ownerDeleting: Boolean(m.business.user.deletionScheduledFor),
      ownerSuspended: Boolean(m.business.user.suspendedAt),
    };
  }
  const own = await prisma.business.findUnique({ where: { userId: actorId }, select: { id: true } });
  if (!own) return null;
  await prisma.membership.createMany({ data: [{ businessId: own.id, userId: actorId, role: "OWNER" }], skipDuplicates: true });
  return { actorId, role: "OWNER", businessId: own.id, ownerId: actorId, ownerDeleting: false, ownerSuspended: false };
}

import "server-only";
// Moving a client to another agent (Admin -> Sales -> Sales team). The open assignment ends now and a new one starts:
// payments from now on count for the new agent, earlier ones stay with the old (./attribution.ts).
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { isSalesRole, permissionsOf } from "@/lib/staff/permissions";
import { cleanReason } from "./assign-rules";

/**
 * Gives a company to a sales staff member (staffId) or leaves it unassigned (null), with a reason: closes the open
 * ClientAssignment at now, opens a new one (source "manager"), sets Business.salesAgentId and writes the audit row,
 * all in one transaction.
 */
export async function reassign(ctx: AdminContext, input: { businessId: string; staffId: string | null; reason: string }, now = new Date()) {
  const reason = cleanReason(input.reason);
  const business = await prisma.business.findUnique({ where: { id: input.businessId }, select: { id: true, userId: true, name: true, salesAgentId: true } });
  if (!business) throw new AdminError("not_found", "That client was not found.");
  if (input.staffId) {
    const staff = await prisma.staffMember.findUnique({ where: { id: input.staffId }, select: { id: true, status: true, roleKey: true } });
    const role = staff ? await prisma.staffRole.findUnique({ where: { key: staff.roleKey }, select: { key: true, permissions: true } }) : null;
    if (!staff || staff.status === "disabled" || !isSalesRole(staff.roleKey, permissionsOf(staff.roleKey, role ? [role] : []))) {
      throw new AdminError("invalid", "Choose a sales agent who is not disabled.");
    }
  }
  if ((business.salesAgentId ?? null) === input.staffId) throw new AdminError("conflict", "The client already has that agent.");
  return prisma.$transaction(async (tx) => {
    await tx.clientAssignment.updateMany({ where: { businessId: business.id, endsAt: null }, data: { endsAt: now } });
    const row = await tx.clientAssignment.create({ data: { businessId: business.id, userId: business.userId, staffId: input.staffId, startsAt: now, source: "manager", reason, by: ctx.actor } });
    await tx.business.update({ where: { id: business.id }, data: { salesAgentId: input.staffId } });
    await writeAudit(tx, ctx, "client.reassign", business.id, { salesAgentId: business.salesAgentId }, { salesAgentId: input.staffId, reason });
    return row;
  });
}

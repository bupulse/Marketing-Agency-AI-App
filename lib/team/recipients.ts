import "server-only";
import { prisma } from "@/lib/db";
import { can } from "./roles";

/**
 * Who gets a company's alert emails (new leads, the daily digest, post reminders and failures, Autopilot's weekly plan):
 * the current OWNER first, then Admins who switched alerts on (Settings → Team). `fallback` is the company account's own
 * email; it is used if the lookup fails or finds nobody, so an alert is never lost to a team lookup problem.
 */
export async function alertRecipients(businessId: string, fallback?: string | null): Promise<string[]> {
  try {
    const rows = await prisma.membership.findMany({
      where: { businessId, OR: [{ role: "OWNER" }, { role: "ADMIN", notifyEmail: true }] },
      orderBy: { createdAt: "asc" },
      select: { role: true, user: { select: { email: true, suspendedAt: true, deletionScheduledFor: true } } },
    });
    const live = rows.filter((r) => r.user.email && !r.user.suspendedAt && !r.user.deletionScheduledFor);
    const ordered = [...live.filter((r) => r.role === "OWNER"), ...live.filter((r) => r.role !== "OWNER")].map((r) => r.user.email);
    const unique = [...new Set(ordered)];
    if (unique.length) return unique;
  } catch {
    // fall through to the company account's email
  }
  return fallback ? [fallback] : [];
}

/**
 * Who may get a company's lead alerts on their own devices (push, lib/push/service.ts): every live member whose role
 * may see leads (Members included: they work the leads too). Each person still opts in per device; this only says who
 * is allowed. A person who left the team, or whose account is suspended or being deleted, gets nothing.
 */
export async function leadAlertMembers(businessId: string): Promise<Set<string>> {
  const rows = await prisma.membership.findMany({
    where: { businessId },
    select: { userId: true, role: true, user: { select: { suspendedAt: true, deletionScheduledFor: true } } },
  });
  return new Set(rows.filter((r) => can(r.role, "content") && !r.user.suspendedAt && !r.user.deletionScheduledFor).map((r) => r.userId));
}

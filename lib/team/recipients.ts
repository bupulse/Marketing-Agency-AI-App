import "server-only";
import { prisma } from "@/lib/db";

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

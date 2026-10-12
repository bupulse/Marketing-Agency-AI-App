import "server-only";
import { prisma } from "@/lib/db";
import { isServiceEnabled } from "@/lib/admin/switch";
import { logError } from "@/lib/errors";
import { sendOfferReminderEmail } from "./emails";
import { DAY_MS } from "./shared";

// Accepted offers that are not paid (docs/OFFERS.md): one reminder to the company owner 3 days after accepting and one
// after 7, from the daily Mobile Money renewals job. Each is claimed before sending (reminder3SentAt / reminder7SentAt,
// a conditional write) and released when the email could not go out, so it goes out once and is retried otherwise.
// An offer that reaches day 7 without its day-3 reminder (the job did not run) gets only the day-7 one.

export const OFFER_REMINDER_DAYS = [3, 7] as const;
/** Accepted this many days ago and still unpaid: shown on the admin Overview. */
export const OFFER_STALE_DAYS = 7;

export async function sendOfferReminders(now: Date = new Date(), limit = 100): Promise<number> {
  if (!(await isServiceEnabled("resend"))) return 0;
  let sent = 0;
  const seen = new Set<string>(); // one reminder per offer per run: a failed day-7 email is not followed by the day-3 one
  for (const day of [7, 3] as const) {
    const field = day === 7 ? "reminder7SentAt" : "reminder3SentAt";
    const due = await prisma.planOffer.findMany({ where: { status: "accepted", acceptedAt: { lte: new Date(now.getTime() - day * DAY_MS) }, [field]: null }, orderBy: { acceptedAt: "asc" }, take: limit });
    for (const offer of due) {
      if (seen.has(offer.id)) continue;
      seen.add(offer.id);
      const claim = await prisma.planOffer.updateMany({ where: { id: offer.id, status: "accepted", [field]: null }, data: { [field]: now, ...(day === 7 && !offer.reminder3SentAt ? { reminder3SentAt: now } : {}) } });
      if (claim.count !== 1) continue;
      const release = () => prisma.planOffer.updateMany({ where: { id: offer.id, [field]: now }, data: { [field]: null, ...(day === 7 && !offer.reminder3SentAt ? { reminder3SentAt: null } : {}) } }).catch(() => undefined);
      try {
        const owner = await prisma.business.findUnique({ where: { id: offer.businessId }, select: { ceoName: true, user: { select: { email: true, name: true } } } });
        const ok = owner?.user?.email
          ? await sendOfferReminderEmail({ email: owner.user.email, name: owner.user.name ?? owner.ceoName }, { day, totalMinor: offer.adjustedMinor, currency: offer.currency, interval: offer.interval, method: offer.payMethod })
          : false;
        if (!ok) {
          await release();
          continue;
        }
        sent++;
      } catch (error) {
        await release();
        await logError(error, { source: "offers.reminders", offerId: offer.id });
      }
    }
  }
  return sent;
}

/** Accepted offers waiting for payment for OFFER_STALE_DAYS or more (admin Overview attention list). */
export async function staleAcceptedOfferCount(now: Date = new Date()): Promise<number> {
  return prisma.planOffer.count({ where: { status: "accepted", acceptedAt: { lte: new Date(now.getTime() - OFFER_STALE_DAYS * DAY_MS) } } });
}

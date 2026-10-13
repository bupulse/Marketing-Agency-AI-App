import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { writeAudit } from "@/lib/admin/audit";
import { consoleContext } from "@/lib/admin/types";
import { isServiceEnabled } from "@/lib/admin/switch";
import { getPlan, priceCents } from "@/lib/plan-catalog";
import { sendInvoiceReminders } from "@/lib/invoices/service";
import { sendOfferReminders } from "@/lib/offers/reminders";
import { sendPlanPausedEmail, sendRenewalReminderEmail } from "./momo-emails";
import { getMomoPrice, getMomoSettings } from "./momo-settings";
import { sweepUnsubmittedProofs } from "./momo";
import { retryCarryOvers } from "./carry-over";
import { DAY_MS, graceEnd, reminderDue, UNSUBMITTED_TTL_HOURS } from "./momo-shared";

// The daily job for Mobile Money subscriptions (nothing renews by itself):
//  - 5 days and 1 day before the paid period ends: a reminder email with the amount, where to pay and a WhatsApp-ready text;
//  - GRACE_DAYS after the end with no confirmed payment: the subscription becomes PAST_DUE (the existing paywall makes the
//    account read-only; nothing is deleted) and the client is told;
//  - payments started but never submitted are closed after UNSUBMITTED_TTL_HOURS.
// Each email is claimed first (a RenewalNotice row, unique per user, period end and kind), so it is never sent twice,
// and the PAST_DUE write is conditional on the state that was read.

export const BATCH_SIZE = 200;

/** The audit actor of the scheduled job. */
const systemContext = () => ({ ...consoleContext(null), actor: "system:cron" });

export type RenewalRun = {
  checked: number;
  reminded5d: number;
  reminded1d: number;
  pastDue: number;
  expiredPayments: number;
  skipped: number;
  /** Due-date reminders of sent invoices (first call of a sweep only; absent when none went out). */
  invoiceReminders?: number;
  /** Payment reminders of accepted, unpaid custom plan offers (first call of a sweep only; absent when none went out). */
  offerReminders?: number;
  /** Card renewals whose paid Mobile Money days were carried over on a retry (first call of a sweep only). */
  carryOvers?: number;
  /** Screenshots of payments that were never submitted, removed (first call of a sweep only; absent when none). */
  proofsRemoved?: number;
  nextCursor: string | null;
  /** True when another run holds the lock; nothing was done. */
  busy?: boolean;
};

type Sub = { userId: string; plan: string; interval: "MONTH" | "YEAR"; status: string; currentPeriodEnd: Date | null };

async function recipient(userId: string) {
  const [user, business] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
    prisma.business.findUnique({ where: { userId }, select: { ceoName: true } }),
  ]);
  return user?.email ? { email: user.email, name: user.name ?? business?.ceoName ?? null } : null;
}

/** Takes the claim for one notice. False when it was sent already (or is being sent by another run). */
async function claim(userId: string, periodEnd: Date, kind: string): Promise<boolean> {
  const { count } = await prisma.renewalNotice.createMany({ data: [{ userId, periodEnd, kind }], skipDuplicates: true });
  return count === 1;
}

/** Gives a claim back when the email could not be sent, so the next run tries again. */
async function release(userId: string, periodEnd: Date, kind: string) {
  await prisma.renewalNotice.deleteMany({ where: { userId, periodEnd, kind } }).catch(() => undefined);
}

/**
 * What the reminder asks for: a custom plan's own price, else the plan's current price in the company's region; when
 * the plan is no longer offered there, what the client paid last time (the owner can still confirm any amount by hand).
 */
async function reminderInput(sub: Sub) {
  const [plan, settings, business] = await Promise.all([getPlan(sub.plan), getMomoSettings(), prisma.business.findUnique({ where: { userId: sub.userId }, select: { id: true } })]);
  // A custom plan renews at its own price (after features were added mid-period, the full new total: docs/OFFERS.md),
  // never at the last payment, which may have been only the prorated add-on.
  const custom = plan?.isCustom ? { amountMinor: priceCents(plan, sub.interval), currency: plan.currency.toUpperCase() } : null;
  const price = custom ?? (business ? await getMomoPrice(business.id, sub.plan, sub.interval) : null) ?? (await lastPaid(sub.userId));
  return { planName: plan?.name ?? sub.plan, interval: sub.interval, amountMinor: price?.amountMinor ?? 0, currency: price?.currency ?? "RWF", periodEnd: sub.currentPeriodEnd as Date, details: settings };
}

async function lastPaid(userId: string) {
  const row = await prisma.manualPayment.findFirst({ where: { userId, status: "confirmed" }, orderBy: { decidedAt: "desc" }, select: { amountMinor: true, currency: true } });
  return row ? { amountMinor: row.amountMinor, currency: row.currency } : null;
}

type Outcome = "reminded5d" | "reminded1d" | "pastDue" | "skipped";

/** One subscription. Never throws: a failure is logged and the client is looked at again on the next run. */
async function processSubscription(sub: Sub, now: Date): Promise<Outcome> {
  const end = sub.currentPeriodEnd;
  if (!end || sub.status !== "ACTIVE") return "skipped";
  try {
    // Grace over: read-only until they pay. Conditional on the period end that was read, so a confirmation landing
    // meanwhile (which moves the end) is never overwritten.
    if (now >= graceEnd(end)) {
      const { count } = await prisma.subscription.updateMany({ where: { userId: sub.userId, provider: "MANUAL_MOMO", status: "ACTIVE", currentPeriodEnd: end }, data: { status: "PAST_DUE", providerUpdatedAt: now } });
      if (count !== 1) return "skipped";
      await writeAudit(prisma, systemContext(), "momo_past_due", `user:${sub.userId}`, { status: "ACTIVE", currentPeriodEnd: end }, { status: "PAST_DUE" }).catch(() => undefined);
      if ((await isServiceEnabled("resend")) && (await claim(sub.userId, end, "paused"))) {
        const to = await recipient(sub.userId);
        const sent = to ? await sendPlanPausedEmail(to, await reminderInput(sub)) : false;
        if (!sent) await release(sub.userId, end, "paused");
      }
      return "pastDue";
    }
    const due = reminderDue(end, now);
    if (!due) return "skipped";
    // A client who already paid and is waiting for the owner needs no reminder.
    const waiting = await prisma.manualPayment.count({ where: { userId: sub.userId, status: "pending", submittedAt: { not: null } } });
    if (waiting > 0) return "skipped";
    // Resend off: wait without claiming, so the reminder goes out once it is back on.
    if (!(await isServiceEnabled("resend"))) return "skipped";
    if (!(await claim(sub.userId, end, due))) return "skipped";
    const to = await recipient(sub.userId);
    const sent = to ? await sendRenewalReminderEmail(to, due, await reminderInput(sub), now) : false;
    if (!sent) {
      await release(sub.userId, end, due);
      return "skipped";
    }
    return due === "5d" ? "reminded5d" : "reminded1d";
  } catch (error) {
    await logError(error, { source: "billing.momo.renewals", userId: sub.userId });
    return "skipped";
  }
}

async function runBatch(opts: { now?: Date; cursor?: string | null; batchSize?: number }): Promise<RenewalRun> {
  const now = opts.now ?? new Date();
  const batch = opts.batchSize ?? BATCH_SIZE;
  const run: RenewalRun = { checked: 0, reminded5d: 0, reminded1d: 0, pastDue: 0, expiredPayments: 0, skipped: 0, nextCursor: null };
  // Housekeeping once per sweep (the first call, without a cursor).
  if (!opts.cursor) {
    const { count } = await prisma.manualPayment.updateMany({
      where: { status: "pending", submittedAt: null, createdAt: { lt: new Date(now.getTime() - UNSUBMITTED_TTL_HOURS * 3_600_000) } },
      data: { status: "expired", decidedAt: now, decidedBy: "system:cron" },
    });
    run.expiredPayments = count;
    // Their screenshots (and those of cancelled or replaced payments) go too. Best effort, never stops the renewals.
    try {
      const removed = await sweepUnsubmittedProofs();
      if (removed > 0) run.proofsRemoved = removed;
    } catch (error) {
      await logError(error, { source: "billing.momo.proofs" });
    }
    // Invoices due today get their one reminder (docs/INVOICES.md). Its own failure never stops the renewals.
    try {
      const reminded = await sendInvoiceReminders(now);
      if (reminded > 0) run.invoiceReminders = reminded;
    } catch (error) {
      await logError(error, { source: "invoices.reminders" });
    }
    // Card renewals of Mobile Money plans whose paid days could not be carried over yet (docs/BILLING.md, "Renewing").
    try {
      const carried = await retryCarryOvers(now);
      if (carried > 0) run.carryOvers = carried;
    } catch (error) {
      await logError(error, { source: "billing.carry_over" });
    }
    // Accepted custom plan offers not paid yet: day 3 and day 7 (docs/OFFERS.md).
    try {
      const reminded = await sendOfferReminders(now);
      if (reminded > 0) run.offerReminders = reminded;
    } catch (error) {
      await logError(error, { source: "offers.reminders" });
    }
  }
  // Only subscriptions whose period ends within the reminder window or has ended: the rest are not looked at.
  const rows = await prisma.subscription.findMany({
    where: { provider: "MANUAL_MOMO", status: "ACTIVE", currentPeriodEnd: { lte: new Date(now.getTime() + 5 * DAY_MS) }, ...(opts.cursor ? { userId: { gt: opts.cursor } } : {}) },
    orderBy: { userId: "asc" },
    take: batch + 1,
    select: { userId: true, plan: true, interval: true, status: true, currentPeriodEnd: true },
  });
  const more = rows.length > batch;
  for (const row of rows.slice(0, batch)) {
    run[await processSubscription(row, now)]++;
    run.checked++;
    run.nextCursor = more ? row.userId : null;
  }
  // One audit row per run that did something (quiet days leave no row).
  if (run.reminded5d + run.reminded1d + run.pastDue + run.expiredPayments + (run.invoiceReminders ?? 0) > 0) {
    const { nextCursor, ...summary } = run;
    await writeAudit(prisma, systemContext(), "momo_renewals_run", "momo-renewals", null, { ...summary, more: nextCursor !== null }).catch(() => undefined);
  }
  return run;
}

/**
 * The daily job. Works on at most BATCH_SIZE subscriptions per call; `nextCursor` says there are more (call again
 * with it). Two runs never overlap: a database advisory lock held for the run makes a second one return { busy: true }.
 */
export async function processMomoRenewals(opts: { now?: Date; cursor?: string | null; batchSize?: number } = {}): Promise<RenewalRun> {
  return prisma.$transaction(
    async (tx) => {
      const [row] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('momo-renewals')) AS locked`;
      if (!row?.locked) return { checked: 0, reminded5d: 0, reminded1d: 0, pastDue: 0, expiredPayments: 0, skipped: 0, nextCursor: null, busy: true };
      return runBatch(opts);
    },
    { timeout: 280_000, maxWait: 10_000 },
  );
}

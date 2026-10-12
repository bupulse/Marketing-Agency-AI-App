import "server-only";
import type { BillingInterval, Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext, type Page } from "@/lib/admin/types";
import { trackEvent } from "@/lib/analytics/events";
import { subscriptionEventsFor } from "@/lib/analytics/math";
import { getSetting } from "@/lib/admin/settings";
import { getPlan } from "@/lib/plan-catalog";
import { companyPlans } from "@/lib/region-prices";
import { invoiceForCardPayment } from "@/lib/invoices/shared";
import { sendPaymentRejectedEmail, sendPaymentToCheckEmail, sendPlanActiveEmail } from "./momo-emails";
import { getMomoPrice, getMomoSettings } from "./momo-settings";
import {
  DAY_MS,
  isReference,
  makeReference,
  MANUAL_PAYMENT_STATUSES,
  momoConfigured,
  planManualPeriod,
  proofSchema,
  REJECTED_SHOWN_DAYS,
  usdCentsOf,
  type ManualPaymentStatus,
  type ManualPaymentView,
  type MomoNetwork,
  type PeriodNote,
  type ProofInput,
} from "./momo-shared";

// Manual Mobile Money payments (docs/MOMO.md). The client side (start, submit the proof, cancel) is keyed on the
// company account id; the owner side (confirm, reject) runs in the admin console only and is audited. Every state
// change is one conditional write on the status, so a double click or two tabs cannot confirm or submit twice, and
// two partial unique indexes back it up: one pending payment per company, one live use of a transaction id.

/** The client-facing message thrown by the client-side functions. Safe to show. */
export class ManualPaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualPaymentError";
  }
}

const LIVE = new Set(["ACTIVE", "PAST_DUE", "TRIALING"]);
const REFERENCE_TRIES = 6;
/** New Mobile Money payments a company may start in 24 hours. */
export const MOMO_DAILY_PAYMENTS = 10;
const TRANSACTION_REUSED = "This transaction id has already been used for another payment. Check the id in your Mobile Money message, or contact support.";

type Row = Prisma.ManualPaymentGetPayload<object>;
type Sub = Prisma.SubscriptionGetPayload<object>;

const isUnique = (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: string }).code === "P2002");

/** How a pending payment meets the client's running period (nothing once it is decided, or nothing is running). */
function periodNoteOf(row: Row, sub: Sub | null, now: Date): PeriodNote | null {
  if (row.status !== "pending" || !sub) return null;
  const plan = planManualPeriod(sub, row.planKey, row.interval, now);
  return plan.mode === "fresh" ? null : { mode: plan.mode, daysLeft: plan.daysLeft, currentEnd: (sub.currentPeriodEnd as Date).toISOString() };
}

async function toView(row: Row, sub: Sub | null, now: Date = new Date()): Promise<ManualPaymentView> {
  return {
    id: row.id,
    planKey: row.planKey,
    planName: (await getPlan(row.planKey))?.name ?? row.planKey,
    interval: row.interval,
    amountMinor: row.amountMinor,
    currency: row.currency,
    reference: row.reference,
    invoiceId: row.invoiceId ?? null,
    status: row.status as ManualPaymentStatus,
    submitted: row.submittedAt !== null,
    transactionId: row.transactionId,
    payerPhone: row.payerPhone,
    network: (row.network as MomoNetwork | null) ?? null,
    rejectReason: row.rejectReason,
    createdAt: row.createdAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    periodEnd: row.periodEnd?.toISOString() ?? null,
    periodNote: periodNoteOf(row, sub, now),
  };
}

const subOf = (userId: string) => prisma.subscription.findUnique({ where: { userId } });
const openOf = (userId: string) => prisma.manualPayment.findFirst({ where: { userId, status: "pending" }, orderBy: { createdAt: "desc" } });

/**
 * A payment that already used this transaction id on this network. `live` only looks at pending and confirmed ones,
 * which is what the unique index enforces; without it, rejected and expired ones count too (the admin's "seen before"
 * note).
 */
async function transactionUse(network: string, transactionId: string, opts: { live: boolean; except?: string; db?: Prisma.TransactionClient }) {
  const db = opts.db ?? prisma;
  return db.manualPayment.findFirst({
    where: {
      network,
      transactionId: { equals: transactionId, mode: "insensitive" },
      ...(opts.live ? { status: { in: ["pending", "confirmed"] } } : {}),
      ...(opts.except ? { id: { not: opts.except } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, reference: true, status: true, userId: true },
  });
}

// ---- client side -------------------------------------------------------------------------------------------

/** The client's open payment, or their last rejected one (for a week), so the Billing page can show where they are. */
export async function currentManualPayment(userId: string, now: Date = new Date()): Promise<ManualPaymentView | null> {
  const pending = await openOf(userId);
  if (pending) return toView(pending, await subOf(userId), now);
  const rejected = await prisma.manualPayment.findFirst({ where: { userId, status: "rejected", decidedAt: { gte: new Date(now.getTime() - REJECTED_SHOWN_DAYS * DAY_MS) } }, orderBy: { decidedAt: "desc" } });
  if (!rejected) return null;
  // Only until the client pays again: a newer confirmed payment hides an old rejection.
  const newer = await prisma.manualPayment.findFirst({ where: { userId, status: "confirmed", createdAt: { gt: rejected.createdAt } }, select: { id: true } });
  return newer ? null : toView(rejected, null, now);
}

/**
 * Starts a payment: a pending row with a fresh reference and the plan's price in the company's region (RWF in Rwanda),
 * for the client to quote when paying. One pending payment per company (also a partial unique index): starting again returns the open one, so a
 * reload or a second tab never makes a second reference.
 */
export async function startManualPayment(input: { userId: string; plan: string; interval: BillingInterval; now?: Date }): Promise<ManualPaymentView> {
  const now = input.now ?? new Date();
  const settings = await getMomoSettings();
  if (!momoConfigured(settings)) throw new ManualPaymentError("Mobile Money payments are not available right now. Please pay by card or contact support.");
  const plan = await getPlan(input.plan);
  if (!plan || plan.isTrial || plan.status !== "active") throw new ManualPaymentError("That plan is not available. Choose one of the plans shown.");
  const [sub, business] = await Promise.all([subOf(input.userId), prisma.business.findUnique({ where: { userId: input.userId }, select: { id: true } })]);
  if (!sub || !business) throw new ManualPaymentError("Your account is still being set up. Please try again in a moment.");
  // The amount is the plan's price in the company's region (docs/REGIONS.md); a region without Mobile Money, or a plan
  // not offered there, cannot be paid this way. Checked before anything is written.
  const price = await getMomoPrice(business.id, plan.key, input.interval);
  if (!price || price.amountMinor <= 0) throw new ManualPaymentError("Mobile Money is not available for this plan where your business is. Choose one of the plans shown, pay by card, or contact support.");
  return openPayment(input.userId, sub, { planKey: plan.key, interval: input.interval, amountMinor: price.amountMinor, currency: price.currency, invoiceId: null, reference: null }, now);
}

/**
 * Starts the Mobile Money payment of an invoice (docs/INVOICES.md): the amount is the invoice total, the reference the
 * invoice number, and confirming it activates the invoice's plan and interval and marks the invoice paid. Only an
 * invoice of the client's own company that has been sent and not paid or voided; the region must take Mobile Money.
 */
export async function startInvoicePayment(input: { userId: string; invoiceId: string; now?: Date }): Promise<ManualPaymentView> {
  const now = input.now ?? new Date();
  const settings = await getMomoSettings();
  if (!momoConfigured(settings)) throw new ManualPaymentError("Mobile Money payments are not available right now. Please pay by card or contact support.");
  const [sub, business] = await Promise.all([subOf(input.userId), prisma.business.findUnique({ where: { userId: input.userId }, select: { id: true } })]);
  if (!sub || !business) throw new ManualPaymentError("Your account is still being set up. Please try again in a moment.");
  const invoice = await prisma.invoice.findFirst({ where: { id: input.invoiceId, businessId: business.id } });
  if (!invoice || invoice.status === "draft") throw new ManualPaymentError("We could not find that invoice. Open it again from the Billing page.");
  if (invoice.status === "paid") throw new ManualPaymentError("This invoice is already paid.");
  if (invoice.status !== "sent") throw new ManualPaymentError("This invoice was cancelled. Contact support if you still want to pay it.");
  if (!invoice.planKey || !invoice.interval || invoice.totalMinor <= 0) throw new ManualPaymentError("This invoice cannot be paid by Mobile Money here. Contact support and we will help you.");
  const { region } = await companyPlans(business.id);
  if (!region.paymentMethods.includes("momo")) throw new ManualPaymentError("Mobile Money is not available where your business is. Pay by card, or contact support.");
  return openPayment(input.userId, sub, { planKey: invoice.planKey, interval: invoice.interval, amountMinor: invoice.totalMinor, currency: invoice.currency, invoiceId: invoice.id, reference: invoice.number }, now);
}

type PaymentTarget = { planKey: string; interval: BillingInterval; amountMinor: number; currency: string; invoiceId: string | null; reference: string | null };

/** The open payment for this target, or a new one (replacing an unsubmitted payment of something else). */
async function openPayment(userId: string, sub: Sub, target: PaymentTarget, now: Date): Promise<ManualPaymentView> {
  // A card subscription that still renews by itself would pay twice. Once the client has cancelled it (it stays active
  // until its period end), Mobile Money takes over from that end.
  if (sub.provider === "PADDLE" && sub.providerSubscriptionId && LIVE.has(sub.status) && sub.plan !== "TRIAL" && !sub.cancelAtPeriodEnd) {
    throw new ManualPaymentError("You pay by card at the moment. Cancel the card plan first (it stays active until the end of the period you paid for); your Mobile Money plan then starts from that date.");
  }
  const open = await openOf(userId);
  if (open) {
    if (open.submittedAt) return toView(open, sub, now);
    // Not paid yet: the client may still change their mind about the plan. Same plan, period and invoice: keep the reference.
    if (open.planKey === target.planKey && open.interval === target.interval && (open.invoiceId ?? null) === target.invoiceId) return toView(open, sub, now);
    const { count } = await prisma.manualPayment.updateMany({ where: { id: open.id, status: "pending", submittedAt: null }, data: { status: "expired", decidedAt: now, decidedBy: "client" } });
    // Submitted or replaced from another tab meanwhile: whatever is open now is the payment.
    if (count !== 1) {
      const current = await openOf(userId);
      if (current) return toView(current, sub, now);
    }
  }
  // A new payment row (the open one was returned above): at most MOMO_DAILY_PAYMENTS a day per company, so a loop of
  // start / cancel cannot fill the table or the admin queue.
  const recent = await prisma.manualPayment.count({ where: { userId, createdAt: { gte: new Date(now.getTime() - DAY_MS) } } });
  if (recent >= MOMO_DAILY_PAYMENTS) throw new ManualPaymentError("You have started many Mobile Money payments today. Please try again tomorrow, or contact support.");
  for (let attempt = 0; attempt < REFERENCE_TRIES; attempt++) {
    try {
      const row = await prisma.manualPayment.create({
        data: { userId, planKey: target.planKey, interval: target.interval, amountMinor: target.amountMinor, currency: target.currency, invoiceId: target.invoiceId, reference: target.reference ?? makeReference(attempt < 3 ? 4 : 6) },
      });
      return toView(row, sub, now);
    } catch (error) {
      if (!isUnique(error)) throw error;
      // Either the company got a pending payment from another request (return it) or the reference is taken (try another).
      const current = await openOf(userId);
      if (current) return toView(current, sub, now);
      // An invoice's reference is fixed: the only other clash is a confirmed payment of that invoice.
      if (target.invoiceId) throw new ManualPaymentError("This invoice is already paid.");
    }
  }
  throw new ManualPaymentError("We could not create a payment reference. Please try again.");
}

/**
 * The client tapped "I've paid": records the transaction id and phone, and alerts the owner. Only the open,
 * not-yet-submitted payment of this company can be submitted, exactly once, and a transaction id that already paid
 * for a pending or confirmed payment of any company is refused (the unique index catches a race).
 */
export async function submitManualProof(userId: string, raw: ProofInput, now: Date = new Date()): Promise<ManualPaymentView> {
  const parsed = proofSchema.safeParse(raw);
  if (!parsed.success) throw new ManualPaymentError(parsed.error.issues[0]?.message ?? "Check the details and try again.");
  const { paymentId, transactionId, payerPhone, network } = parsed.data;
  const sub = await subOf(userId);
  if (await transactionUse(network, transactionId, { live: true, except: paymentId })) throw new ManualPaymentError(TRANSACTION_REUSED);
  let count = 0;
  try {
    ({ count } = await prisma.manualPayment.updateMany({
      where: { id: paymentId, userId, status: "pending", submittedAt: null },
      data: { transactionId, payerPhone, network, submittedAt: now },
    }));
  } catch (error) {
    if (isUnique(error)) throw new ManualPaymentError(TRANSACTION_REUSED);
    throw error;
  }
  const row = await prisma.manualPayment.findFirst({ where: { id: paymentId, userId } });
  if (!row) throw new ManualPaymentError("We could not find that payment. Start again from the Billing page.");
  if (count !== 1) {
    if (row.status === "pending" && row.submittedAt) return toView(row, sub, now); // already submitted: nothing to redo
    throw new ManualPaymentError("This payment is closed. Start again from the Billing page.");
  }
  // The alert is best effort: the payment is on record and shows in the admin queue either way.
  try {
    const [user, business, plan] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
      prisma.business.findUnique({ where: { userId }, select: { name: true } }),
      getPlan(row.planKey),
    ]);
    await sendPaymentToCheckEmail({
      reference: row.reference, amountMinor: row.amountMinor, currency: row.currency, planName: plan?.name ?? row.planKey, interval: row.interval,
      transactionId, payerPhone, network, company: business?.name ?? "A company", email: user?.email ?? "",
    });
  } catch (error) {
    await logError(error, { source: "billing.momo.alert", userId, paymentId });
  }
  await trackEvent("momo_payment_submitted", { userId, props: { plan: row.planKey, interval: row.interval, amountMinor: row.amountMinor } });
  return toView(row, sub, now);
}

/** The client changed their mind before paying. A submitted payment cannot be cancelled: the owner decides it. */
export async function cancelManualPayment(userId: string, paymentId: string, now: Date = new Date()): Promise<boolean> {
  const { count } = await prisma.manualPayment.updateMany({ where: { id: paymentId, userId, status: "pending", submittedAt: null }, data: { status: "expired", decidedAt: now, decidedBy: "client" } });
  return count === 1;
}

// ---- owner side (admin console) ----------------------------------------------------------------------------

function requireConsole(ctx: AdminContext) {
  if (ctx.viaApi || ctx.actor !== "admin") throw new AdminError("forbidden", "Mobile Money payments are confirmed or rejected by the owner, in the admin console.");
}

async function clientOf(userId: string) {
  const [user, business] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
    prisma.business.findUnique({ where: { userId }, select: { id: true, name: true, ceoName: true } }),
  ]);
  return { email: user?.email ?? null, name: user?.name ?? business?.ceoName ?? null, company: business?.name ?? null, businessId: business?.id ?? null };
}

/** Thrown inside the confirm transaction when the subscription moved under us; the caller re-reads and tries once more. */
class SubscriptionMoved extends Error {}

/**
 * The owner saw the money arrive and clicked Confirm. Claims the payment (pending -> confirmed) and, in the same
 * transaction, writes the paid period onto the subscription: provider MANUAL_MOMO, the plan the client paid for,
 * ACTIVE, the interval and no card ids. A company waiting for its demo (PENDING_DEMO), on its trial, expired or past
 * due all become ACTIVE this way: paying is always enough. The period follows planManualPeriod: extending a running period of the same plan only moves
 * currentPeriodEnd (currentPeriodStart, the usage anchor, is never set in the future); a different plan or interval,
 * or nothing running, starts a fresh period now. The payment keeps the exact period it bought. Then the money is
 * recorded for analytics (BillingEvent) and the client is emailed. Idempotent: a second click finds the payment
 * already confirmed and is refused without touching anything; a subscription that changed between the read and the
 * write is re-read and the period recomputed once.
 */
export async function confirmManualPayment(ctx: AdminContext, paymentId: string, now: Date = new Date()) {
  requireConsole(ctx);
  const payment = await prisma.manualPayment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new AdminError("not_found", "No payment with that id.");
  if (payment.status !== "pending") throw new AdminError("conflict", `This payment is already ${payment.status}.`);
  if (!payment.submittedAt || !payment.transactionId || !payment.network) throw new AdminError("conflict", "The client has not said they paid yet (no transaction id). Wait for them, or ask them to tap I've paid.");
  const plan = await getPlan(payment.planKey);
  if (!plan) throw new AdminError("conflict", "The plan of this payment no longer exists.");
  if (payment.invoiceId) {
    const invoice = await prisma.invoice.findUnique({ where: { id: payment.invoiceId }, select: { status: true } });
    if (invoice?.status !== "sent") throw new AdminError("conflict", `Invoice ${payment.reference} is ${invoice ? `already ${invoice.status}` : "gone"}. Reject this payment (and refund it if the money arrived) instead.`);
  }
  // The revenue roll-up is in USD: the one USD->RWF rate of Admin -> Settings (also used for card prices).
  const usdCents = usdCentsOf(payment.amountMinor, payment.currency, await getSetting("usdToRwf"));

  for (let attempt = 0; ; attempt++) {
    const sub = await subOf(payment.userId);
    if (!sub) throw new AdminError("not_found", "This client has no subscription any more.");
    if (sub.provider === "PADDLE" && sub.providerSubscriptionId && LIVE.has(sub.status) && sub.plan !== "TRIAL" && !sub.cancelAtPeriodEnd) {
      throw new AdminError("conflict", "This client has a card subscription that still renews. Cancel it in Paddle first, or reject this payment and refund it by MoMo.");
    }
    const period = planManualPeriod(sub, plan.key, payment.interval, now);
    const before = { plan: sub.plan, status: sub.status, provider: sub.provider, interval: sub.interval, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, currentPeriodStart: sub.currentPeriodStart, currentPeriodEnd: sub.currentPeriodEnd };
    const after = {
      plan: plan.key,
      status: "ACTIVE" as const,
      provider: "MANUAL_MOMO" as const,
      interval: payment.interval,
      providerSubscriptionId: null,
      providerCustomerId: null,
      providerPriceId: null,
      providerUpdatedAt: now,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      // Extending keeps the usage anchor; a fresh or replacing period starts counting now.
      ...(period.mode === "extend" ? {} : { currentPeriodStart: period.start }),
      currentPeriodEnd: period.end,
    };
    try {
      await prisma.$transaction(async (tx) => {
        // The transaction id must still be unused by any other live payment (the index refuses too; this says why).
        if (await transactionUse(payment.network as string, payment.transactionId as string, { live: true, except: paymentId, db: tx })) {
          throw new AdminError("conflict", "This transaction id was confirmed on another payment meanwhile. Reject this one.");
        }
        // The claim: only a pending, submitted payment moves to confirmed, once.
        const claim = await tx.manualPayment.updateMany({
          where: { id: paymentId, status: "pending", submittedAt: { not: null } },
          data: { status: "confirmed", decidedAt: now, decidedBy: ctx.actor, periodStart: period.start, periodEnd: period.end },
        });
        if (claim.count !== 1) throw new AdminError("conflict", "This payment was decided a moment ago. Nothing was changed.");
        // A payment of an invoice (its number is the reference) pays that invoice, once: only a sent invoice moves to
        // paid. A voided or already paid invoice stops the confirmation (nothing is written).
        if (payment.invoiceId) {
          const paid = await tx.invoice.updateMany({ where: { id: payment.invoiceId, status: "sent" }, data: { status: "paid", paidAt: now, paidBy: `manual_payment:${payment.id}` } });
          if (paid.count !== 1) throw new AdminError("conflict", `Invoice ${payment.reference} is no longer open (voided or already paid). Reject this payment and refund it, or look at the invoice first.`);
          await writeAudit(tx, ctx, "invoice_paid", `invoice:${payment.invoiceId}`, { status: "sent" }, { status: "paid", number: payment.reference, paidBy: `manual_payment:${payment.id}`, amountMinor: payment.amountMinor, currency: payment.currency });
        } else {
          // A plain payment (the pay screen's BP- reference) for a plan the client was also invoiced for settles at most
          // one open invoice, by the same rules as a card payment (invoiceForCardPayment): same plan and interval, sent
          // before the payment, an exact amount and currency first, else the newest. The reminder stops with it.
          const business = await tx.business.findUnique({ where: { userId: payment.userId }, select: { id: true } });
          const open = business ? await tx.invoice.findMany({ where: { businessId: business.id, status: "sent" } }) : [];
          const target = invoiceForCardPayment(open, { amountMinor: payment.amountMinor, currency: payment.currency.toUpperCase(), paidAt: now, origin: "web" }, { plan: plan.key, interval: payment.interval });
          if (target) {
            const paidBy = `momo:${payment.reference}`;
            const settled = await tx.invoice.updateMany({ where: { id: target.id, status: "sent" }, data: { status: "paid", paidAt: now, paidBy } });
            if (settled.count === 1) await writeAudit(tx, ctx, "invoice_paid", `invoice:${target.id}`, { status: "sent" }, { status: "paid", number: target.number, paidBy, amountMinor: payment.amountMinor, currency: payment.currency });
          }
        }
        // Guarded on the state we read (ids, status and period end), so a card webhook or another confirmation landing
        // meanwhile is never overwritten blindly.
        const written = await tx.subscription.updateMany({
          where: { userId: payment.userId, providerSubscriptionId: sub.providerSubscriptionId, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd },
          data: after,
        });
        if (written.count !== 1) throw new SubscriptionMoved();
        // The money, for the revenue roll-up and the activity feed (same shape of row as a Paddle payment event).
        await tx.billingEvent.create({
          data: {
            provider: "MANUAL_MOMO",
            eventId: payment.id,
            type: "manual_payment.confirmed",
            userId: payment.userId,
            processedAt: now,
            payload: {
              event_type: "manual_payment.confirmed",
              occurred_at: now.toISOString(),
              data: { id: payment.reference, invoice_id: payment.invoiceId, amount_minor: payment.amountMinor, currency: payment.currency, usd_cents: usdCents, plan: plan.key, interval: payment.interval, transaction_id: payment.transactionId, payer_phone: payment.payerPhone, network: payment.network, period_mode: period.mode, period_start: period.start.toISOString(), period_end: period.end.toISOString() },
            },
          },
        });
        await writeAudit(tx, ctx, "confirm_momo_payment", `payment:${paymentId}`, { status: "pending", subscription: before }, { status: "confirmed", reference: payment.reference, invoiceId: payment.invoiceId, amountMinor: payment.amountMinor, currency: payment.currency, period: period.mode, subscription: after });
      });
    } catch (error) {
      // The subscription changed under us (a webhook, another admin): read it again and recompute the period, once.
      if (error instanceof SubscriptionMoved && attempt === 0) continue;
      if (error instanceof SubscriptionMoved) throw new AdminError("conflict", "The subscription keeps changing while confirming. Look at the client and try again.");
      throw error;
    }
    // After the commit: analytics and the client's email. Neither can undo the confirmation.
    const client = await clientOf(payment.userId);
    for (const name of subscriptionEventsFor(before, after, false)) {
      await trackEvent(name, { userId: payment.userId, businessId: client.businessId, props: { plan: plan.key, interval: payment.interval, from: before.plan, method: "momo" } });
    }
    let emailed = false;
    if (client.email) {
      emailed = await sendPlanActiveEmail({ email: client.email, name: client.name }, { planName: plan.name, interval: payment.interval, amountMinor: payment.amountMinor, currency: payment.currency, reference: payment.reference, periodEnd: period.end }).catch(() => false);
    }
    return { id: paymentId, status: "confirmed" as const, plan: plan.key, periodMode: period.mode, periodStart: period.start, periodEnd: period.end, emailed };
  }
}

/** The money did not arrive, or does not match: the owner says why, and the client sees it and can try again. */
export async function rejectManualPayment(ctx: AdminContext, paymentId: string, reason: string, now: Date = new Date()) {
  requireConsole(ctx);
  const why = reason.trim();
  if (why.length < 3 || why.length > 300) throw new AdminError("invalid", "Give the client a short reason (3 to 300 characters).");
  const payment = await prisma.manualPayment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new AdminError("not_found", "No payment with that id.");
  const { count } = await prisma.manualPayment.updateMany({ where: { id: paymentId, status: "pending" }, data: { status: "rejected", rejectReason: why, decidedAt: now, decidedBy: ctx.actor } });
  if (count !== 1) throw new AdminError("conflict", `This payment is already ${payment.status}.`);
  await writeAudit(prisma, ctx, "reject_momo_payment", `payment:${paymentId}`, { status: "pending", reference: payment.reference }, { status: "rejected", reason: why });
  const client = await clientOf(payment.userId);
  const plan = await getPlan(payment.planKey);
  let emailed = false;
  if (client.email && payment.submittedAt) {
    emailed = await sendPaymentRejectedEmail({ email: client.email, name: client.name }, { planName: plan?.name ?? payment.planKey, amountMinor: payment.amountMinor, currency: payment.currency, reference: payment.reference, reason: why }).catch(() => false);
  }
  return { id: paymentId, status: "rejected" as const, emailed };
}

// ---- reads (admin console and Jarvis) ----------------------------------------------------------------------

export type ManualPaymentAdminView = ManualPaymentView & {
  userId: string;
  company: string | null;
  email: string | null;
  decidedBy: string | null;
  /** An older payment (any status, any company) that used the same transaction id on the same network. */
  seenBefore: { id: string; reference: string; status: string; sameCompany: boolean } | null;
};

async function adminViews(rows: Row[], now: Date): Promise<ManualPaymentAdminView[]> {
  const ids = [...new Set(rows.map((r) => r.userId))];
  const [users, businesses, subs] = ids.length
    ? await Promise.all([
        prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }),
        prisma.business.findMany({ where: { userId: { in: ids } }, select: { userId: true, name: true } }),
        prisma.subscription.findMany({ where: { userId: { in: ids } } }),
      ])
    : [[], [], []];
  const email = new Map(users.map((u) => [u.id, u.email]));
  const company = new Map(businesses.map((b) => [b.userId, b.name]));
  const sub = new Map(subs.map((s) => [s.userId, s]));
  return Promise.all(
    rows.map(async (r) => {
      const seen = r.network && r.transactionId ? await transactionUse(r.network, r.transactionId, { live: false, except: r.id }) : null;
      return {
        ...(await toView(r, sub.get(r.userId) ?? null, now)),
        userId: r.userId,
        company: company.get(r.userId) ?? null,
        email: email.get(r.userId) ?? null,
        decidedBy: r.decidedBy,
        seenBefore: seen ? { id: seen.id, reference: seen.reference, status: seen.status, sameCompany: seen.userId === r.userId } : null,
      };
    }),
  );
}

/** A (createdAt, id) cursor: rows are paged newest first without skipping two rows created in the same millisecond. */
const cursorOf = (r: Pick<Row, "createdAt" | "id">) => `${r.createdAt.getTime()}~${r.id}`;
function parseCursor(cursor: string | undefined): Prisma.ManualPaymentWhereInput | null {
  if (!cursor) return null;
  const i = cursor.indexOf("~");
  const ms = Number(cursor.slice(0, i));
  if (i < 1 || !Number.isFinite(ms) || cursor.length > 120) throw new AdminError("invalid", "That cursor is not one this list gave out.");
  const at = new Date(ms);
  return { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.slice(i + 1) } }] };
}

/**
 * Payments, newest first. `status: "pending"` lists the queue instead: submitted ones first and oldest first (they
 * have waited longest), then started-only ones; ordered by the database.
 */
export async function listManualPayments(opts: { status?: string; userId?: string; reference?: string; cursor?: string; limit?: number } = {}, now: Date = new Date()): Promise<Page<ManualPaymentAdminView>> {
  const status = opts.status && (MANUAL_PAYMENT_STATUSES as readonly string[]).includes(opts.status) ? (opts.status as ManualPaymentStatus) : undefined;
  if (opts.status && !status) throw new AdminError("invalid", `status must be one of: ${MANUAL_PAYMENT_STATUSES.join(", ")}.`);
  if (opts.reference && !isReference(opts.reference.toUpperCase())) throw new AdminError("invalid", "A reference looks like BP-7K3Q.");
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 25) || 25, 1), 100);
  const queue = status === "pending";
  const where: Prisma.ManualPaymentWhereInput = {
    ...(status ? { status } : {}),
    ...(opts.userId ? { userId: opts.userId } : {}),
    ...(opts.reference ? { reference: opts.reference.toUpperCase() } : {}),
    ...(!queue ? (parseCursor(opts.cursor) ?? {}) : {}),
  };
  const rows = await prisma.manualPayment.findMany({
    where,
    orderBy: queue ? [{ submittedAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  return { items: await adminViews(page, now), nextCursor: rows.length > limit && !queue ? cursorOf(page[page.length - 1]) : null };
}

export async function getManualPayment(id: string, now: Date = new Date()): Promise<ManualPaymentAdminView> {
  const row = await prisma.manualPayment.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "No payment with that id.");
  return (await adminViews([row], now))[0];
}

/** Submitted payments waiting for a decision (sidebar badge and the Overview attention list). */
export async function pendingManualPaymentCount(): Promise<number> {
  return prisma.manualPayment.count({ where: { status: "pending", submittedAt: { not: null } } });
}
